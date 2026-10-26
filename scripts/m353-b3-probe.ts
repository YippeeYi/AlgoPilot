// Standalone B3 library: no CLI, config/env loader, production imports or live transport.
import { request as nativeRequest } from "node:https";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { lstat, open } from "node:fs/promises";
import type { Stats } from "node:fs";
import { isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import { isUint8Array } from "node:util/types";
import { z } from "zod";

export const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
export const REQUEST_MS = 60_000;
export const TOTAL_MS = 120_000;
export const BODY_BYTES = 2_000_000;
export const MARKER_NAME = "B3-generation-dispatch.consumed";
const bodySchema = z.strictObject({
  model: z.literal("gemini-3.8-flash"),
  messages: z.tuple([z.strictObject({ role: z.literal("user"), content: z.literal("Reply with exactly OK.") })]),
  reasoning_effort: z.literal("low"),
  max_completion_tokens: z.literal(256),
  stream: z.literal(false),
});
const specSchema = z.strictObject({ url: z.literal(ENDPOINT), method: z.literal("POST"), body: bodySchema });
export function fixedSpec() {
  return {
    url: ENDPOINT,
    method: "POST",
    body: { model: "gemini-3.8-flash", messages: [{ role: "user", content: "Reply with exactly OK." }], reasoning_effort: "low", max_completion_tokens: 256, stream: false },
  };
}
export function assertFixedSpec(value: unknown): void {
  try {
    if (specSchema.safeParse(value).success) return;
  } catch { /* Never expose Zod inputs, getters or raw exceptions. */ }
  throw new Error("fixed_spec_rejected");
}

export type MarkerResult = "consumed" | "exists" | "create_failed" | "unknown";
export type MarkerIO = { lstat: (path: string) => Promise<Stats>; open: typeof open };
/** Fixed filename in a pre-existing private directory. Never remove/reclaim a marker. */
export async function consumeMarker(directory: string, io: MarkerIO = { lstat, open }): Promise<MarkerResult> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let parent: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  let result: MarkerResult = "create_failed";
  try {
    if (!isAbsolute(directory)) return result;
    const stat = await io.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) return result;
    file = await io.open(join(directory, MARKER_NAME), "wx", 0o600);
    created = true; // Even empty/partial files permanently consume the allowance.
    await file.writeFile("consumed-before-dispatch\n", "utf8");
    await file.sync();
    parent = await io.open(directory, "r");
    await parent.sync(); // Persist the directory entry before permitting dispatch.
    result = "consumed";
  } catch (error) {
    const code = errorCode(error);
    result = created ? "unknown" : code === "EEXIST" ? "exists" : ["EACCES", "EPERM", "ENOENT", "ENOTDIR", "EROFS"].includes(code ?? "") ? "create_failed" : "unknown";
  } finally {
    try { await file?.close(); } catch { result = "unknown"; }
    try { await parent?.close(); } catch { result = "unknown"; }
  }
  return result;
}
function errorCode(error: unknown): string | null {
  try {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
  } catch { return null; }
}

// Same signature as native node:https.request, deliberately no default implementation.
export type HttpsRequest = (url: string, options: RequestOptions, listener: (response: IncomingMessage) => void) => ClientRequest;
export type OfflineHttps = { mode: "offline"; request: HttpsRequest };
/** Count the transport entrance, including a factory that throws before returning. */
export function singleDispatch(request: HttpsRequest) {
  let count = 0;
  return {
    get count() { return count; },
    send: (spec: unknown, listener: (response: IncomingMessage) => void) => {
      if (count !== 0) throw new Error("dispatch_refused");
      assertFixedSpec(spec); // Also guard direct calls to the transport entrance.
      const body = JSON.stringify(fixedSpec().body);
      count++;
      return request(ENDPOINT, {
        method: "POST", agent: false,
        // B3 has no Authorization/key or proxy Agent, including synthetic keys.
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      }, listener);
    },
  };
}

type CaptureState = "not_occurred" | "not_collected" | "collected" | "collection_failed";
type Capture = { state: CaptureState; atMs: number | null };
const stageNames = ["socket", "dns", "tcp", "tls", "requestFinish", "headers", "firstBody", "bodyEnd", "json", "envelope", "content", "model", "usage"] as const;
type Stage = typeof stageNames[number];
export type Outcome = "ok" | "spec_rejected" | "offline_transport_required" | "marker_exists" | "marker_create_failed" | "marker_unknown" | "dispatch_refused" | "dispatch_failed" | "dns_failed" | "tcp_failed" | "tls_failed" | "request_failed" | "body_incomplete" | "body_failed" | "body_limit" | "request_deadline" | "total_budget" | "caller_abort" | "policy_stop" | "observation_failed" | "http_redirect" | "http_error" | "invalid_status" | "invalid_json" | "invalid_utf8" | "invalid_envelope" | "empty_content" | "content_not_ok" | "length" | "finish_reason" | "model_mismatch" | "internal_failure";
export type Observation = {
  version: "m353-b3/1";
  mode: "offline";
  preflight: { fixedSpec: "not_checked" | "pass" | "fail"; transport: "not_checked" | "pass" | "fail"; marker: "not_checked" | MarkerResult };
  stages: Record<Stage, Capture>;
  outcome: Outcome;
  terminalStage: Stage | "preflight" | "marker" | "dispatch";
  abortSource: "none" | "caller" | "policy_stop" | "request_deadline" | "total_budget";
  httpStatus: number | null;
  httpClass: "not_observed" | "success" | "redirect" | "error";
  bytesReceived: number;
  bytesRetained: number;
  bodyComplete: boolean | null;
  jsonResult: "not_attempted" | "valid" | "invalid_json" | "invalid_utf8";
  envelopeValid: boolean | null;
  contentExactlyOK: boolean | null;
  contentEmpty: boolean | null;
  finishReason: "stop" | "length" | "other" | null;
  model: "gemini-3.8-flash" | null;
  modelMatches: boolean | null;
  usage: { prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null };
  counts: { dispatch: number; retry: 0; redirect: 0; fallback: 0 };
  elapsedMs: number;
};
const token = z.number().int().min(0).max(100_000_000);
const envelope = z.object({
  model: z.string().min(1).max(200),
  choices: z.array(z.object({ finish_reason: z.string(), message: z.object({ role: z.literal("assistant"), content: z.string().nullable() }) })).length(1),
  usage: z.object({ prompt_tokens: token, completion_tokens: token, total_tokens: token }).refine(u => u.total_tokens >= u.prompt_tokens + u.completion_tokens).optional(),
});
export type ProbeInput = {
  spec: unknown;
  directory: string;
  https?: OfflineHttps;
  // Injection exists only for offline fault tests; B4 must use durable filesystem IO.
  markerIO?: MarkerIO;
  caller?: AbortSignal;
  policyStop?: AbortSignal;
};

/** B3 only. No real key argument, environment access, live switch or real execution entry. */
export async function runB3Probe(input: ProbeInput): Promise<Observation> {
  const started = performance.now();
  const stages = Object.fromEntries(stageNames.map(name => [name, { state: "not_occurred", atMs: null }])) as Record<Stage, Capture>;
  const report: Observation = {
    version: "m353-b3/1", mode: "offline",
    preflight: { fixedSpec: "not_checked", transport: "not_checked", marker: "not_checked" }, stages,
    outcome: "internal_failure", terminalStage: "preflight", abortSource: "none", httpStatus: null, httpClass: "not_observed",
    bytesReceived: 0, bytesRetained: 0, bodyComplete: null, jsonResult: "not_attempted", envelopeValid: null,
    contentExactlyOK: null, contentEmpty: null, finishReason: null, model: null, modelMatches: null,
    usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
    counts: { dispatch: 0, retry: 0, redirect: 0, fallback: 0 }, elapsedMs: 0,
  };
  return new Promise(resolve => {
    let closed = false;
    let phase: Observation["terminalStage"] = "preflight";
    let request: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    let requestDeadline: number | undefined;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    let chunks: Buffer[] = [];
    const now = () => Math.max(0, performance.now() - started);
    const capture = (stage: Stage, state: CaptureState = "collected") => {
      if (!closed) stages[stage] = { state, atMs: state === "not_occurred" ? null : now() };
    };
    const finish = (outcome: Outcome) => {
      if (closed) return;
      closed = true;
      report.outcome = outcome;
      report.terminalStage = phase;
      report.elapsedMs = now();
      clearTimeout(totalTimer);
      clearTimeout(requestTimer);
      input.caller?.removeEventListener("abort", callerAbort);
      input.policyStop?.removeEventListener("abort", policyAbort);
      chunks = []; // Never expose/persist headers, text, reasoning or exceptions.
      try { response?.destroy(); } catch { /* No raw errors. */ }
      try { request?.destroy(); } catch { /* Late events are ignored. */ }
      resolve(structuredClone(report));
    };
    const abort = (source: Observation["abortSource"], outcome: Outcome) => {
      report.abortSource = source;
      finish(outcome);
    };
    const callerAbort = () => { if (!closed) abort("caller", "caller_abort"); };
    const policyAbort = () => { if (!closed) abort("policy_stop", "policy_stop"); };
    const totalTimer = setTimeout(() => abort("total_budget", "total_budget"), TOTAL_MS);
    const active = () => {
      if (closed) return false;
      if (now() >= TOTAL_MS) abort("total_budget", "total_budget");
      else if (requestDeadline !== undefined && now() >= requestDeadline) abort("request_deadline", "request_deadline");
      else if (input.caller?.aborted) callerAbort();
      else if (input.policyStop?.aborted) policyAbort();
      return !closed;
    };
    // All callbacks cross a sanitizing boundary. Exceptions cannot escape as raw errors.
    const observed = (stage: Stage, fn: () => void) => {
      if (!active()) return;
      phase = stage;
      try { fn(); } catch { capture(stage, "collection_failed"); finish("observation_failed"); }
    };
    const networkError = (error: unknown) => {
      if (!active()) return;
      if (stages.headers.state === "collected") { phase = "bodyEnd"; finish("body_failed"); return; }
      const code = errorCode(error);
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") { phase = "dns"; capture("dns", "collection_failed"); finish("dns_failed"); }
      else if (stages.tcp.state !== "collected") { phase = "tcp"; capture("tcp", "collection_failed"); finish("tcp_failed"); }
      else if (stages.tls.state !== "collected") { phase = "tls"; capture("tls", "collection_failed"); finish("tls_failed"); }
      else finish("request_failed");
    };
    const onResponse = (incoming: IncomingMessage) => {
      if (!active()) { incoming.destroy(); return; }
      response = incoming;
      observed("headers", () => {
        capture("headers");
        // A missing predecessor event is unknown capture, never fabricated success.
        for (const stage of ["socket", "dns", "tcp", "tls", "requestFinish"] as const) {
          if (stages[stage].state === "not_occurred") capture(stage, "not_collected");
        }
        const status = incoming.statusCode;
        if (!Number.isInteger(status) || status! < 100 || status! > 599) { finish("invalid_status"); return; }
        report.httpStatus = status!;
        report.httpClass = status! >= 200 && status! < 300 ? "success" : status! >= 300 && status! < 400 ? "redirect" : "error";
        report.bodyComplete = false;
        incoming.on("error", () => observed("bodyEnd", () => finish("body_failed")));
        incoming.on("aborted", () => observed("bodyEnd", () => finish("body_incomplete")));
        incoming.on("close", () => observed("bodyEnd", () => { if (!report.bodyComplete) finish("body_incomplete"); }));
        incoming.on("data", (chunk: unknown) => observed("firstBody", () => {
          if (!isUint8Array(chunk)) { capture("firstBody", "collection_failed"); finish("observation_failed"); return; }
          if (chunk.byteLength === 0) return;
          if (stages.firstBody.state === "not_occurred") capture("firstBody");
          report.bytesReceived += chunk.byteLength;
          if (report.bytesReceived > BODY_BYTES) { finish("body_limit"); return; }
          chunks.push(Buffer.from(chunk));
          report.bytesRetained = report.bytesReceived;
        }));
        incoming.on("end", () => observed("bodyEnd", () => {
          capture("bodyEnd");
          report.bodyComplete = incoming.complete === true;
          if (!report.bodyComplete) { finish("body_incomplete"); return; }
          if (report.httpClass !== "success") {
            for (const stage of ["json", "envelope", "content", "model", "usage"] as const) capture(stage, "not_collected");
            finish(report.httpClass === "redirect" ? "http_redirect" : "http_error");
            return;
          }
          let text: string;
          phase = "json";
          capture("json");
          try { text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, report.bytesRetained)); }
          catch { report.jsonResult = "invalid_utf8"; finish("invalid_utf8"); return; }
          chunks = [];
          let json: unknown;
          try { json = JSON.parse(text); }
          catch { report.jsonResult = "invalid_json"; finish("invalid_json"); return; }
          report.jsonResult = "valid";
          if (!active()) return;
          phase = "envelope";
          capture("envelope");
          const parsed = envelope.safeParse(json);
          report.envelopeValid = parsed.success;
          if (!parsed.success) { finish("invalid_envelope"); return; }
          const data = parsed.data;
          report.modelMatches = data.model === "gemini-3.8-flash";
          report.model = report.modelMatches ? "gemini-3.8-flash" : null;
          capture("model", report.modelMatches ? "collected" : "not_collected");
          if (data.usage) { report.usage = data.usage; capture("usage"); }
          else capture("usage", "not_collected");
          phase = "content";
          capture("content");
          const choice = data.choices[0]!;
          report.finishReason = choice.finish_reason === "stop" || choice.finish_reason === "length" ? choice.finish_reason : "other";
          report.contentExactlyOK = choice.message.content === "OK";
          report.contentEmpty = choice.message.content === null || choice.message.content === "";
          if (!active()) return;
          finish(report.finishReason === "length" ? "length" : report.finishReason !== "stop" ? "finish_reason" : !report.modelMatches ? "model_mismatch" : report.contentEmpty ? "empty_content" : !report.contentExactlyOK ? "content_not_ok" : "ok");
        }));
      });
    };
    async function start() {
      try { assertFixedSpec(input.spec); report.preflight.fixedSpec = "pass"; }
      catch { report.preflight.fixedSpec = "fail"; finish("spec_rejected"); return; }
      if (!input.https || input.https.mode !== "offline" || typeof input.https.request !== "function" || input.https.request === nativeRequest) {
        report.preflight.transport = "fail"; finish("offline_transport_required"); return;
      }
      report.preflight.transport = "pass";
      input.caller?.addEventListener("abort", callerAbort, { once: true });
      input.policyStop?.addEventListener("abort", policyAbort, { once: true });
      if (!active()) return;
      phase = "marker";
      report.preflight.marker = "unknown"; // In-flight IO has no known durable result yet.
      const marker = await consumeMarker(input.directory, input.markerIO);
      if (!active()) return; // A late marker completion can consume, never dispatch.
      report.preflight.marker = marker;
      if (marker !== "consumed") { finish(marker === "exists" ? "marker_exists" : marker === "unknown" ? "marker_unknown" : "marker_create_failed"); return; }
      // Rebuild canonical data after checking the caller input; no mutation/TOCTOU reuse.
      assertFixedSpec(fixedSpec());
      const body = JSON.stringify(fixedSpec().body);
      const transport = singleDispatch(input.https.request);
      phase = "dispatch";
      requestDeadline = now() + REQUEST_MS;
      requestTimer = setTimeout(() => abort("request_deadline", "request_deadline"), REQUEST_MS);
      if (!active()) return;
      try {
        report.counts.dispatch = 1;
        request = transport.send(fixedSpec(), onResponse);
        report.counts.dispatch = transport.count;
        // Handle synchronous injected completion/abort without leaving a live handle.
        if (closed) { request.on("error", () => {}); request.destroy(); return; }
        request.on("error", networkError);
        request.on("close", () => { if (active() && !response) finish("request_failed"); });
        request.on("finish", () => observed("requestFinish", () => capture("requestFinish")));
        request.on("socket", socket => observed("socket", () => {
          capture("socket");
          socket.on("error", networkError);
          socket.on("lookup", error => observed("dns", () => {
            capture("dns", error ? "collection_failed" : "collected");
            if (error) finish("dns_failed");
          }));
          socket.on("connect", () => observed("tcp", () => {
            if (stages.dns.state === "not_occurred") capture("dns", "not_collected");
            capture("tcp");
          }));
          socket.on("secureConnect", () => observed("tls", () => {
            for (const stage of ["dns", "tcp"] as const) if (stages[stage].state === "not_occurred") capture(stage, "not_collected");
            capture("tls");
          }));
        }));
        request.end(body);
      } catch {
        report.counts.dispatch = transport.count;
        if (!closed) finish(phase === "dispatch" ? "dispatch_failed" : "observation_failed");
      }
    }
    void start().catch(() => { if (!closed) finish("internal_failure"); });
  });
}
