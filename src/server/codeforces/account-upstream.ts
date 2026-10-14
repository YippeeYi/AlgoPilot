import "server-only";
import { CfUpstreamError, parseUserInfo, parseUserStatus } from "./account-parser";
export async function fetchCfPublic(method: "user.info" | "user.status", params: Record<string, string>, fetcher: typeof fetch = fetch) {
    const url = new URL(`https://codeforces.com/api/${method}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    // Explicitly exclude private source collection even if a future API default changes.
    if (method === "user.status") url.searchParams.set("includeSources", "false");
    else url.searchParams.set("checkHistoricHandles", "false");
    let response: Response;
    try { response = await fetcher(url.toString(), { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(18000), headers: { Accept: "application/json" } }); }
    catch { throw new CfUpstreamError("network"); }
    if (!response.ok) throw new CfUpstreamError(response.status === 429 ? "rate_limit" : "http");
    if (Number(response.headers.get("content-length")) > 3000000) throw new CfUpstreamError("invalid_response");
    const reader = response.body?.getReader(); if (!reader) throw new CfUpstreamError("invalid_response");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
        for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 3000000) throw new CfUpstreamError("invalid_response"); chunks.push(value); }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch { throw new CfUpstreamError("invalid_response"); }
    finally { await reader.cancel().catch(() => {}); }
}
export async function fetchCfIdentity(handle: string, fetcher: typeof fetch = fetch) { return parseUserInfo(await fetchCfPublic("user.info", { handles: handle }, fetcher), handle); }
export async function fetchCfSubmissions(handle: string, from: number, count: number, fetcher: typeof fetch = fetch) { return parseUserStatus(await fetchCfPublic("user.status", { handle, from: String(from), count: String(count) }, fetcher), handle, count); }
