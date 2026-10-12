import "server-only";
import { catalogQuerySchema, type CatalogPage } from "@/lib/validation/m3";
import type { CfRepository } from "./repository";
import { parseProblemset } from "./parser";
import { ApiError } from "@/server/http";
export const CF_ENDPOINT = "https://codeforces.com/api/problemset.problems";
export const CF_MAX_BYTES = 12000000;
// Fixed official endpoint. Injection is a test seam, never a runtime mock switch.
export async function fetchProblemset(fetcher: typeof fetch = fetch) {
    const response = await fetcher(CF_ENDPOINT, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(18000), headers: { Accept: "application/json" } });
    if (!response.ok)
        throw new Error("CF_UPSTREAM_HTTP");
    if (Number(response.headers.get("content-length")) > CF_MAX_BYTES)
        throw new Error("CF_SIZE");
    const reader = response.body?.getReader();
    if (!reader)
        throw new Error("CF_EMPTY");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done)
                break;
            bytes += value.byteLength;
            if (bytes > CF_MAX_BYTES)
                throw new Error("CF_SIZE");
            chunks.push(value);
        }
    }
    finally {
        await reader.cancel().catch(() => { });
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
    }
    return parseProblemset(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)));
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export async function synchronize(repo: CfRepository, force = false, fetcher: typeof fetch = fetch, sleep = delay) {
    const lease = await repo.sync({ action: "reserve", force });
    if (!lease.acquired || !lease.nonce)
        return "busy" as const;
    const nonce = lease.nonce;
    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            if (attempt)
                await sleep(3000);
            let slot = await repo.sync({ action: "slot", nonce });
            if (slot.waitMs) {
                await sleep(slot.waitMs);
                slot = await repo.sync({ action: "slot", nonce });
            }
            if (slot.waitMs)
                throw new Error("CF_SLOT_BUSY");
            try {
                const problems = await fetchProblemset(fetcher);
                if (!problems.length)
                    throw new Error("CF_EMPTY");
                await repo.sync({ action: "publish", nonce, problems });
                return "synced" as const;
            }
            catch {
                if (attempt === 1)
                    throw new Error("CF_UPSTREAM_UNAVAILABLE");
            }
        }
    }
    catch {
        await repo.sync({ action: "fail", nonce }).catch(() => { });
        return "failed" as const;
    }
    return "failed" as const;
}
export async function catalog(repo: CfRepository, query: ReturnType<typeof catalogQuerySchema.parse>, force = false): Promise<CatalogPage & {
    notice: string | null;
}> {
    let page = await repo.read(query);
    let notice: string | null = null;
    if (force || page.stale) {
        try {
            const result = await synchronize(repo, force);
            page = await repo.read(query);
            if (result === "busy")
                notice = "同步冷却或其他实例正在同步；显示现有缓存。";
            if (result === "failed")
                notice = "Codeforces 暂时不可用；显示上次成功同步的缓存。";
        }
        catch (e) {
            if (!page.syncedAt)
                throw e;
            notice = "同步暂不可用；显示上次成功同步的缓存。";
        }
    }
    if (!page.syncedAt)
        throw new ApiError(503, "CF_CATALOG_UNAVAILABLE", "尚无可信题库缓存，请稍后重试或检查 M3 同步配置。");
    return { ...page, notice };
}
