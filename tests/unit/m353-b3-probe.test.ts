import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, readFile, stat, access, writeFile, lstat, open, chmod } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout as realDelay } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { request as nativeRequest } from "node:https";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ClientRequest, IncomingMessage } from "node:http";
import { assertFixedSpec, BODY_BYTES, consumeMarker, ENDPOINT, fixedSpec, MARKER_NAME, REQUEST_MS, runB3Probe, singleDispatch, TOTAL_MS, type HttpsRequest, type MarkerIO, type Observation, type OfflineHttps } from "../../scripts/m353-b3-probe";

// All objects below are in-memory EventEmitters, never native sockets/requests.
class FakeRequest extends EventEmitter {
  destroyed = false;
  written = "";
  constructor(private script: () => void) { super(); }
  end(body: string) { this.written = body; queueMicrotask(this.script); return this; }
  destroy() { this.destroyed = true; return this; }
}
class FakeResponse extends EventEmitter {
  complete = false;
  destroyed = false;
  constructor(public statusCode: number) { super(); }
  get headers(): never { throw new Error("RAW_HEADERS_MUST_NOT_BE_READ"); }
  destroy() { this.destroyed = true; return this; }
}
type Context = {
  request: FakeRequest;
  socket: EventEmitter;
  connect: () => void;
  headers: (status?: number) => FakeResponse;
  body: (value: string | Buffer, status?: number) => FakeResponse;
};
function simulation(script: (context: Context) => void) {
  let context: Context;
  const request = vi.fn<HttpsRequest>((_url, _options, listener) => {
    const socket = new EventEmitter();
    const fake = new FakeRequest(() => script(context));
    context = {
      request: fake, socket,
      connect: () => {
        fake.emit("socket", socket); socket.emit("lookup", null, "SYNTHETIC_ADDRESS");
        socket.emit("connect"); socket.emit("secureConnect"); fake.emit("finish");
      },
      headers: (status = 200) => { const response = new FakeResponse(status); listener(response as unknown as IncomingMessage); return response; },
      body: (value, status = 200) => {
        const response = context.headers(status);
        response.emit("data", Buffer.isBuffer(value) ? value : Buffer.from(value));
        response.complete = true; response.emit("end"); response.emit("close");
        return response;
      },
    };
    return fake as unknown as ClientRequest;
  });
  return { https: { mode: "offline", request } satisfies OfflineHttps, request, context: () => context };
}
function envelope(content: string | null = "OK", finish = "stop", extras = {}) {
  return JSON.stringify({ model: "gemini-3.8-flash", choices: [{ finish_reason: finish, message: { role: "assistant", content } }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 7 }, ...extras });
}
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 1000; i++) { if (await check()) return; await realDelay(1); }
  throw new Error("offline_fixture_did_not_start");
}
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp("/private/tmp/algopilot-b3-synthetic-");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(0);
  vi.spyOn(performance, "now").mockImplementation(() => Date.now());
});
afterEach(async () => {
  vi.useRealTimers(); vi.restoreAllMocks();
  // Only synthetic test markers in a new mkdtemp directory are removed.
  await rm(directory, { recursive: true, force: true });
});
async function run(sim: ReturnType<typeof simulation>, spec: unknown = fixedSpec()) {
  return runB3Probe({ spec, directory, https: sim.https });
}
function counts(report: Observation, dispatch = 1) {
  expect(report.counts).toEqual({ dispatch, retry: 0, redirect: 0, fallback: 0 });
}

describe("B3 fixed native HTTPS request contract (offline injection only)", () => {
  it("uses the exact URL, body and native options with no Authorization", async () => {
    const sim = simulation(c => { c.connect(); c.body(envelope()); });
    const report = await run(sim);
    expect(report.outcome).toBe("ok"); counts(report);
    expect(report.preflight).toEqual({ fixedSpec: "pass", transport: "pass", marker: "consumed" });
    const [url, options] = sim.request.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    const expectedBody = { model: "gemini-3.8-flash", messages: [{ role: "user", content: "Reply with exactly OK." }], reasoning_effort: "low", max_completion_tokens: 256, stream: false };
    expect(JSON.parse(sim.context().request.written)).toEqual(expectedBody);
    expect(options).toEqual({ method: "POST", agent: false, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(JSON.stringify(expectedBody)) } });
    expect(report.bodyComplete).toBe(true);
    expect(report.contentExactlyOK).toBe(true);
    expect(report.jsonResult).toBe("valid"); expect(report.envelopeValid).toBe(true);
    expect(report.model).toBe("gemini-3.8-flash");
    expect(report.usage).toEqual({ prompt_tokens: 5, completion_tokens: 1, total_tokens: 7 });
    for (const stage of Object.values(report.stages)) expect(stage.state).toBe("collected");
    expect(sim.context().request.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  const deviations = [
    ["query", (s: ReturnType<typeof fixedSpec>) => { s.url += "?key=SYNTHETIC"; }],
    ["userinfo", (s: ReturnType<typeof fixedSpec>) => { s.url = s.url.replace("https://", "https://user:pass@"); }],
    ["fragment", (s: ReturnType<typeof fixedSpec>) => { s.url += "#x"; }],
    ["path", (s: ReturnType<typeof fixedSpec>) => { s.url += "/"; }],
    ["host", (s: ReturnType<typeof fixedSpec>) => { s.url = "https://fixture.invalid/v1/chat/completions"; }],
    ["method", (s: ReturnType<typeof fixedSpec>) => { s.method = "GET"; }],
    ["model", (s: ReturnType<typeof fixedSpec>) => { s.body.model = "another-model"; }],
    ["message", (s: ReturnType<typeof fixedSpec>) => { s.body.messages[0]!.content += " "; }],
    ["role", (s: ReturnType<typeof fixedSpec>) => { s.body.messages[0]!.role = "system"; }],
    ["history", (s: ReturnType<typeof fixedSpec>) => { s.body.messages.push({ role: "user", content: "history" }); }],
    ["effort", (s: ReturnType<typeof fixedSpec>) => { s.body.reasoning_effort = "medium"; }],
    ["budget", (s: ReturnType<typeof fixedSpec>) => { s.body.max_completion_tokens = 257; }],
    ["stream", (s: ReturnType<typeof fixedSpec>) => { s.body.stream = true; }],
    ["format", (s: ReturnType<typeof fixedSpec>) => { Object.assign(s.body, { response_format: undefined }); }],
    ["tools", (s: ReturnType<typeof fixedSpec>) => { Object.assign(s.body, { tools: [] }); }],
    ["alternate token field", (s: ReturnType<typeof fixedSpec>) => { Object.assign(s.body, { max_tokens: 256 }); }],
    ["extra headers", (s: ReturnType<typeof fixedSpec>) => { Object.assign(s, { headers: { Authorization: "SYNTHETIC" } }); }],
  ] as const;
  it.each(deviations)("rejects %s before marker or transport", async (_name, change) => {
    const spec = fixedSpec(); change(spec);
    const sim = simulation(() => { throw new Error("must_not_dispatch"); });
    const report = await run(sim, spec);
    expect(report.outcome).toBe("spec_rejected"); counts(report, 0);
    expect(sim.request).not.toHaveBeenCalled();
    await expect(access(join(directory, MARKER_NAME))).rejects.toThrow();
    expect(() => assertFixedSpec(spec)).toThrow("fixed_spec_rejected");
  });
  it("fails closed without injection and when native request is passed", async () => {
    for (const https of [undefined, { mode: "offline" as const, request: nativeRequest as HttpsRequest }]) {
      const report = await runB3Probe({ spec: fixedSpec(), directory, https });
      expect(report.outcome).toBe("offline_transport_required"); counts(report, 0);
    }
    await expect(access(join(directory, MARKER_NAME))).rejects.toThrow();
  });
  it("reconstructs canonical data if the input is mutated during marker IO", async () => {
    const spec = fixedSpec();
    const sim = simulation(c => { c.connect(); c.body(envelope()); });
    const markerIO: MarkerIO = { open, lstat: async (...args) => { spec.body.model = "mutated"; return lstat(...args); } };
    expect((await runB3Probe({ spec, directory, https: sim.https, markerIO })).outcome).toBe("ok");
    expect(JSON.parse(sim.context().request.written).model).toBe("gemini-3.8-flash");
  });
});

describe("B3 bounded response classification and privacy", () => {
  it.each([
    [envelope("NO"), "content_not_ok"], [envelope("OK\n"), "content_not_ok"],
    [envelope(""), "empty_content"], [envelope(null), "empty_content"],
    [envelope("OK", "length"), "length"], [envelope("", "length"), "length"],
    [envelope("OK", "content_filter"), "finish_reason"],
    ["", "invalid_json"], ["{invalid", "invalid_json"], ["{}", "invalid_envelope"],
    [envelope("OK", "stop", { choices: [] }), "invalid_envelope"],
    [envelope("OK", "stop", { usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 1 } }), "invalid_envelope"],
    [envelope("OK", "stop", { model: "SYNTHETIC_SECRET_MODEL" }), "model_mismatch"],
  ])("classifies complete response %#", async (body, outcome) => {
    const sim = simulation(c => { c.connect(); c.body(body); });
    const report = await run(sim);
    expect(report.outcome).toBe(outcome); counts(report);
    expect(report.httpStatus).toBe(200); expect(report.bodyComplete).toBe(true);
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC_SECRET_MODEL");
  });
  it.each([201, 204, 299])("handles %i as 2xx without assuming 200", async status => {
    const sim = simulation(c => { c.connect(); c.body(envelope(), status); });
    expect((await run(sim)).outcome).toBe("ok");
  });
  it.each([400, 401, 403, 429, 500, 502, 503, 504, 599])("preserves HTTP %i without retry or timeout rewriting", async status => {
    const sim = simulation(c => { c.connect(); c.body("SYNTHETIC_PRIVATE_ERROR_BODY", status); });
    const report = await run(sim);
    expect(report.outcome).toBe("http_error"); expect(report.httpStatus).toBe(status);
    expect(report.abortSource).toBe("none"); expect(report.jsonResult).toBe("not_attempted");
    expect(report.stages.json.state).toBe("not_collected"); counts(report);
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC_PRIVATE_ERROR_BODY");
  });
  it.each([301, 302, 307, 308])("never follows HTTP %i", async status => {
    const sim = simulation(c => { c.connect(); c.body("", status); });
    const report = await run(sim);
    expect(report.outcome).toBe("http_redirect"); counts(report);
    expect(sim.request).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid status and invalid UTF-8 separately", async () => {
    const sim = simulation(c => { c.connect(); c.body(Buffer.from([0xff])); });
    const report = await run(sim);
    expect(report.outcome).toBe("invalid_utf8"); expect(report.jsonResult).toBe("invalid_utf8");
    const other = await mkdtemp("/private/tmp/algopilot-b3-synthetic-status-");
    try {
      const invalid = simulation(c => { c.connect(); c.headers(999); });
      expect((await runB3Probe({ spec: fixedSpec(), directory: other, https: invalid.https })).outcome).toBe("invalid_status");
    } finally { await rm(other, { recursive: true }); }
  });
  it("accepts exactly 2000000 bytes but refuses the next byte before retaining it", async () => {
    const valid = envelope();
    const sim = simulation(c => { c.connect(); c.body(valid + " ".repeat(BODY_BYTES - Buffer.byteLength(valid))); });
    const report = await run(sim); expect(report.outcome).toBe("ok"); expect(report.bytesRetained).toBe(BODY_BYTES);
    // A fresh synthetic allowance is necessary even for a failed request.
    const other = await mkdtemp("/private/tmp/algopilot-b3-synthetic-limit-");
    try {
      const large = simulation(c => {
        c.connect(); const response = c.headers();
        response.emit("data", Buffer.alloc(BODY_BYTES)); response.emit("data", Buffer.from("x"));
      });
      const result = await runB3Probe({ spec: fixedSpec(), directory: other, https: large.https });
      expect(result.outcome).toBe("body_limit"); expect(result.bytesReceived).toBe(BODY_BYTES + 1);
      expect(result.bytesRetained).toBe(BODY_BYTES); expect(result.bodyComplete).toBe(false); counts(result);
    } finally { await rm(other, { recursive: true }); }
  });
  it.each(["aborted", "close", "error", "incomplete_end"])("distinguishes %s from timeout and parse failure", async event => {
    const sim = simulation(c => {
      c.connect(); const response = c.headers(); response.emit("data", Buffer.from("{"));
      response.emit(event === "incomplete_end" ? "end" : event, new Error("SYNTHETIC_RAW_EXCEPTION"));
    });
    const report = await run(sim);
    expect(report.outcome).toBe(event === "error" ? "body_failed" : "body_incomplete");
    expect(report.jsonResult).toBe("not_attempted"); expect(report.bodyComplete).toBe(false);
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC_RAW_EXCEPTION");
  });
  it("whitelists model/usage; discards raw body, reasoning, headers and extra fields", async () => {
    const secret = "SYNTHETIC_DO_NOT_PERSIST";
    const sim = simulation(c => {
      c.connect(); c.body(envelope(secret, "stop", { reasoning: secret, usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 7, reasoning_tokens: secret }, headers: { Authorization: secret } }));
    });
    const report = await run(sim);
    expect(report.outcome).toBe("content_not_ok");
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(Object.keys(report.usage).sort()).toEqual(["completion_tokens", "prompt_tokens", "total_tokens"]);
    const marker = await readFile(join(directory, MARKER_NAME), "utf8");
    expect(marker).toBe("consumed-before-dispatch\n");
  });
  it("keeps absent usage unknown and missing predecessor events not_collected", async () => {
    const sim = simulation(c => { c.body(envelope("OK", "stop", { usage: undefined })); });
    const report = await run(sim);
    expect(report.usage).toEqual({ prompt_tokens: null, completion_tokens: null, total_tokens: null });
    expect(report.stages.usage.state).toBe("not_collected");
    for (const stage of ["socket", "dns", "tcp", "tls", "requestFinish"] as const) expect(report.stages[stage].state).toBe("not_collected");
  });
  it("distinguishes collection failure from an event that never happened", async () => {
    const sim = simulation(c => { c.request.emit("socket", { on() { throw new Error("SYNTHETIC_RAW_EXCEPTION"); } }); });
    const report = await run(sim);
    expect(report.outcome).toBe("observation_failed"); expect(report.stages.socket.state).toBe("collection_failed");
    expect(report.stages.headers.state).toBe("not_occurred");
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC_RAW_EXCEPTION");
  });
});

describe("B3 transport failures and absolute deadlines", () => {
  it.each(["dns", "dns_request", "tcp", "tls", "request"])("classifies %s without saving raw errors", async stage => {
    const sim = simulation(c => {
      c.request.emit("socket", c.socket);
      if (stage === "dns") { c.socket.emit("lookup", new Error("SYNTHETIC_SECRET_ERROR")); return; }
      if (stage !== "dns_request") c.socket.emit("lookup", null);
      if (["tls", "request"].includes(stage)) c.socket.emit("connect");
      if (stage === "request") c.socket.emit("secureConnect");
      c.request.emit("error", Object.assign(new Error("SYNTHETIC_SECRET_ERROR"), { code: stage === "dns_request" ? "ENOTFOUND" : "SYNTHETIC_CODE" }));
    });
    const report = await run(sim);
    expect(report.outcome).toBe(stage.startsWith("dns") ? "dns_failed" : `${stage}_failed`);
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC_SECRET_ERROR"); counts(report);
  });
  it.each(["before_socket", "after_finish", "after_headers", "partial_body"])("times out at 60000ms from dispatch: %s", async stage => {
    const sim = simulation(c => {
      if (stage === "before_socket") return;
      c.connect();
      if (stage === "after_headers" || stage === "partial_body") {
        const response = c.headers(); if (stage === "partial_body") response.emit("data", Buffer.from("{"));
      }
    });
    const pending = run(sim); await until(() => sim.request.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(REQUEST_MS - 1);
    expect(sim.context().request.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const report = await pending;
    expect(report.outcome).toBe("request_deadline"); expect(report.abortSource).toBe("request_deadline");
    expect(report.elapsedMs).toBe(REQUEST_MS); counts(report);
    expect(report.stages.requestFinish.state).toBe(stage === "before_socket" ? "not_occurred" : "collected");
    expect(report.stages.headers.state).toBe(["after_headers", "partial_body"].includes(stage) ? "collected" : "not_occurred");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("includes write time and never resets on headers or body arrival", async () => {
    const sim = simulation(() => {});
    const pending = run(sim); await until(() => sim.request.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(59_000);
    sim.context().connect(); const response = sim.context().headers();
    await vi.advanceTimersByTimeAsync(999); response.emit("data", Buffer.from("{"));
    await vi.advanceTimersByTimeAsync(1);
    const report = await pending;
    expect(report.outcome).toBe("request_deadline"); expect(report.stages.headers.atMs).toBe(59_000);
    expect(report.stages.firstBody.atMs).toBe(59_999); expect(report.elapsedMs).toBe(60_000);
    response.emit("data", Buffer.from("SYNTHETIC_LATE_SECRET")); response.complete = true; response.emit("end");
    sim.context().request.emit("error", new Error("SYNTHETIC_LATE_ERROR"));
    expect(report.bytesReceived).toBe(1); expect(report.bodyComplete).toBe(false);
  });
  it("checks monotonic deadline even if the timer callback has not run", async () => {
    const sim = simulation(() => {});
    const pending = run(sim); await until(() => sim.request.mock.calls.length === 1);
    vi.setSystemTime(60_001); sim.context().body(envelope());
    expect((await pending).outcome).toBe("request_deadline");
  });
  it.each([429, 503])("keeps status %i even if its body later times out", async status => {
    const sim = simulation(c => { c.connect(); c.headers(status); });
    const pending = run(sim); await until(() => sim.request.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(REQUEST_MS);
    const report = await pending;
    expect(report.httpStatus).toBe(status); expect(report.httpClass).toBe("error");
    expect(report.outcome).toBe("request_deadline"); counts(report);
  });
  it("enforces 120000ms total while marker IO hangs; late IO never sends", async () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const markerIO: MarkerIO = { open, lstat: async (...args) => { await wait; return lstat(...args); } };
    const sim = simulation(() => {});
    const pending = runB3Probe({ spec: fixedSpec(), directory, https: sim.https, markerIO });
    await vi.advanceTimersByTimeAsync(TOTAL_MS);
    const report = await pending;
    expect(report.outcome).toBe("total_budget"); expect(report.abortSource).toBe("total_budget"); counts(report, 0);
    expect(report.preflight.marker).toBe("unknown");
    release(); await until(() => access(join(directory, MARKER_NAME)).then(() => true, () => false));
    // Wait for durable IO to settle before the synthetic directory is cleaned.
    await realDelay(25); expect(sim.request).not.toHaveBeenCalled();
  });
  it.each(["caller", "policyStop"] as const)("records %s cancellation and never re-dispatches", async source => {
    const signal = new AbortController();
    const sim = simulation(c => { c.connect(); c.headers(); });
    const pending = runB3Probe({ spec: fixedSpec(), directory, https: sim.https, [source]: signal.signal });
    await until(() => sim.request.mock.calls.length === 1); signal.abort(new Error("SYNTHETIC_PRIVATE_ABORT_REASON"));
    const report = await pending;
    expect(report.outcome).toBe(source === "caller" ? "caller_abort" : "policy_stop");
    expect(report.abortSource).toBe(source === "caller" ? "caller" : "policy_stop"); counts(report);
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC_PRIVATE_ABORT_REASON");
    expect((await run(sim)).outcome).toBe("marker_exists"); expect(sim.request).toHaveBeenCalledTimes(1);
  });
  it("includes preflight/marker time in the total budget instead of granting another 60s", async () => {
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const markerIO: MarkerIO = { open, lstat: async path => { await wait; return lstat(path); } };
    const sim = simulation(c => { c.connect(); c.headers(); });
    const pending = runB3Probe({ spec: fixedSpec(), directory, https: sim.https, markerIO });
    await vi.advanceTimersByTimeAsync(70_000); release();
    await until(() => sim.request.mock.calls.length === 1);
    await vi.advanceTimersByTimeAsync(49_999); expect(sim.context().request.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const report = await pending;
    expect(report.outcome).toBe("total_budget"); expect(report.elapsedMs).toBe(120_000); counts(report);
  });
  it("rejects an already-aborted caller before consuming the marker", async () => {
    const caller = new AbortController(); caller.abort();
    const sim = simulation(() => {});
    const report = await runB3Probe({ spec: fixedSpec(), directory, https: sim.https, caller: caller.signal });
    expect(report.outcome).toBe("caller_abort"); counts(report, 0);
    await expect(access(join(directory, MARKER_NAME))).rejects.toThrow();
  });
});

describe("B3 persistent one-shot allowance and crash/restart", () => {
  it("uses an exclusive private durable marker and refuses a fresh invocation", async () => {
    const sim = simulation(c => { c.connect(); c.body(envelope()); });
    expect((await run(sim)).outcome).toBe("ok");
    expect((await stat(join(directory, MARKER_NAME))).mode & 0o777).toBe(0o600);
    expect((await run(sim)).outcome).toBe("marker_exists"); expect(sim.request).toHaveBeenCalledTimes(1);
  });
  it("refuses an empty pre-existing marker (crash immediately after wx)", async () => {
    await writeFile(join(directory, MARKER_NAME), "", { flag: "wx", mode: 0o600 });
    const sim = simulation(() => {}); const report = await run(sim);
    expect(report.outcome).toBe("marker_exists"); counts(report, 0); expect(sim.request).not.toHaveBeenCalled();
  });
  it("permits at most one concurrent invocation for the same marker", async () => {
    const sim = simulation(c => { c.connect(); c.body(envelope()); });
    const reports = await Promise.all([run(sim), run(sim)]);
    expect(reports.map(r => r.outcome).sort()).toEqual(["marker_exists", "ok"]);
    expect(sim.request).toHaveBeenCalledTimes(1);
  });
  it("fails closed on marker creation failure", async () => {
    const markerIO: MarkerIO = { lstat, open: async () => { throw Object.assign(new Error("SYNTHETIC_PRIVATE_ERROR"), { code: "EACCES" }); } };
    const sim = simulation(() => {});
    const report = await runB3Probe({ spec: fixedSpec(), directory, https: sim.https, markerIO });
    expect(report.outcome).toBe("marker_create_failed"); counts(report, 0);
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC_PRIVATE_ERROR");
  });
  it("treats an ambiguous open failure as unknown and never sends", async () => {
    const markerIO: MarkerIO = { lstat, open: async () => { throw Object.assign(new Error("synthetic"), { code: "EIO" }); } };
    const sim = simulation(() => {});
    const report = await runB3Probe({ spec: fixedSpec(), directory, https: sim.https, markerIO });
    expect(report.outcome).toBe("marker_unknown"); counts(report, 0); expect(sim.request).not.toHaveBeenCalled();
  });
  it.each(["writeFile", "sync", "close", "directorySync"])("fails closed if marker state is unknown after %s", async failure => {
    const markerIO: MarkerIO = {
      lstat,
      open: async (...args) => {
        const file = await open(...args);
        const parent = args[0] === directory;
        return {
          writeFile: async (...args: Parameters<typeof file.writeFile>) => { if (failure === "writeFile") throw new Error("synthetic"); return file.writeFile(...args); },
          sync: async () => { if ((failure === "sync" && !parent) || (failure === "directorySync" && parent)) throw new Error("synthetic"); return file.sync(); },
          close: async () => { await file.close(); if (failure === "close") throw new Error("synthetic"); },
        } as Awaited<ReturnType<typeof open>>;
      },
    };
    const sim = simulation(() => {});
    const report = await runB3Probe({ spec: fixedSpec(), directory, https: sim.https, markerIO });
    expect(report.outcome).toBe("marker_unknown"); counts(report, 0);
    expect((await run(sim)).outcome).toBe("marker_exists"); expect(sim.request).not.toHaveBeenCalled();
  });
  it("rejects relative paths and non-private directories", async () => {
    expect(await consumeMarker("relative")).toBe("create_failed");
    await chmod(directory, 0o755);
    expect(await consumeMarker(directory)).toBe("create_failed");
  });
  it("persists consumption when an offline child process crashes during its request", async () => {
    const moduleURL = pathToFileURL(resolve("scripts/m353-b3-probe.ts")).href;
    const source = `
      import { EventEmitter } from 'node:events';
      import { runB3Probe, fixedSpec } from ${JSON.stringify(moduleURL)};
      const request = () => {
        const result = new EventEmitter();
        result.destroy = () => result;
        result.end = () => { result.emit('finish'); process.exit(73); };
        return result;
      };
      const report = await runB3Probe({spec: fixedSpec(), directory: ${JSON.stringify(directory)}, https: {mode:'offline', request}});
      if (report.outcome !== 'marker_exists' || report.counts.dispatch !== 0) process.exit(74);
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
      timeout: 5000, encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", NODE_ENV: "test", NODE_OPTIONS: process.env.NODE_OPTIONS ?? "", M353_B3_AUDIT_DIRECTORY: process.env.M353_B3_AUDIT_DIRECTORY ?? "" },
    });
    expect(child.status, child.stderr).toBe(73);
    expect(await readFile(join(directory, MARKER_NAME), "utf8")).toBe("consumed-before-dispatch\n");
    const newProcess = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
      timeout: 5000, encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", NODE_ENV: "test", NODE_OPTIONS: process.env.NODE_OPTIONS ?? "", M353_B3_AUDIT_DIRECTORY: process.env.M353_B3_AUDIT_DIRECTORY ?? "" },
    });
    expect(newProcess.status, newProcess.stderr).toBe(0);
    const restarted = simulation(() => {}); const report = await run(restarted);
    expect(report.outcome).toBe("marker_exists"); counts(report, 0); expect(restarted.request).not.toHaveBeenCalled();
  });
  it("refuses the second transport entrance, including after a first factory throw", () => {
    const request = vi.fn<HttpsRequest>(() => { throw new Error("SYNTHETIC"); });
    const gate = singleDispatch(request);
    expect(() => gate.send(fixedSpec(), () => {})).toThrow("SYNTHETIC");
    expect(() => gate.send(fixedSpec(), () => {})).toThrow("dispatch_refused");
    expect(gate.count).toBe(1); expect(request).toHaveBeenCalledTimes(1);
  });
  it("checks fixed specification at the transport entrance itself", () => {
    const request = vi.fn<HttpsRequest>();
    const gate = singleDispatch(request);
    expect(() => gate.send({ ...fixedSpec(), url: ENDPOINT + "?x=1" }, () => {})).toThrow("fixed_spec_rejected");
    expect(gate.count).toBe(0); expect(request).not.toHaveBeenCalled();
  });
  it("records factory failure as one dispatch and permanently consumes allowance", async () => {
    const request = vi.fn<HttpsRequest>(() => { throw new Error("SYNTHETIC_RAW_EXCEPTION"); });
    const report = await runB3Probe({ spec: fixedSpec(), directory, https: { mode: "offline", request } });
    expect(report.outcome).toBe("dispatch_failed"); counts(report);
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC_RAW_EXCEPTION");
    expect(await consumeMarker(directory)).toBe("exists");
  });
});
