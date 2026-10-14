import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { cfAccountInputSchema, cfSyncInputSchema } from "@/lib/validation/cf-account";
import { cfPageSize } from "@/features/learning/cf-cursor";
import type { CfAccountRepository } from "./account-repository";
import { fetchCfIdentity, fetchCfSubmissions } from "./account-upstream";
import { CfUpstreamError } from "./account-parser";
import { ApiError } from "@/server/http";
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
type Runtime = { fetcher?: typeof fetch; sleep?: typeof pause; now?: () => number };
type Lease = { nonce: string; scope: string };
async function requestWithSlot<T>(repo: CfAccountRepository, lease: Lease, call: () => Promise<T>, runtime: Runtime, deadline: number) {
    const now = runtime.now ?? Date.now, sleep = runtime.sleep ?? pause;
    for (let attempt = 0; attempt < 2; attempt++) {
        if (now() + 19000 > deadline) throw new ApiError(503, "CF_SYNC_BUDGET", "本轮时间预算已用完，已保存的检查点可继续同步。");
        let allowed = false;
        for (let wait = 0; wait < 3; wait++) {
            const slot = await repo.command({ action: "slot", ...lease });
            if (!slot.waitMs) { allowed = true; break; }
            await sleep(slot.waitMs);
        }
        if (!allowed) throw new CfUpstreamError("rate_limit");
        // Contention can consume the budget after the initial check. A granted
        // slot must not start another upstream request past the deadline.
        if (now() + 19000 > deadline) throw new ApiError(503, "CF_SYNC_BUDGET", "本轮时间预算已用完，已保存的检查点可继续同步。");
        try { return await call(); }
        catch (error) {
            if (error instanceof CfUpstreamError && error.category === "invalid_handle") throw error;
            if (attempt === 1) throw error;
            await sleep(3000);
        }
    }
    throw new CfUpstreamError("network");
}
function failureCategory(error: unknown) {
    if (error instanceof CfUpstreamError) return error.category;
    if (error instanceof ApiError && error.code === "CF_SYNC_BUDGET") return "budget";
    if (error instanceof ApiError && error.status === 409) return "identity_changed";
    if (error instanceof z.ZodError) return "invalid_response";
    return "database";
}
function unavailable(error: unknown) {
    if (error instanceof ApiError) return error;
    if (error instanceof CfUpstreamError && error.category === "invalid_handle") return new ApiError(422, "CF_HANDLE_INVALID", "官方 API 未找到此当前 Handle；原关联未被替换。");
    return new ApiError(503, "CF_ACCOUNT_UNAVAILABLE", "官方公开数据暂时不可用；成功批次已保存，可稍后继续。");
}
export async function mutateCfAccount(repo: CfAccountRepository, input: z.infer<typeof cfAccountInputSchema>, runtime: Runtime = {}) {
    if (input.action !== "bind" && !(input.action === "consent" && input.enabled)) {
        await repo.command(input); return { state: await repo.state(), notice: null };
    }
    const kind = input.action === "bind" ? "bind" : "enable";
    const start = await repo.command({ action: "reserve", kind, requestId: input.requestId, revision: input.revision, ...(input.action === "bind" ? { handle: input.handle } : {}) });
    if (!start.acquired) return { state: await repo.state(), notice: start.replayed ? "请求已处理，未重复关联。" : "其他操作正在执行或正在冷却，请稍后重试。" };
    if (!start.nonce || !start.scope || !start.handle) throw new ApiError(503, "CF_ACCOUNT_UNAVAILABLE", "关联租约响应不完整。");
    const lease = { nonce: start.nonce, scope: start.scope }, deadline = (runtime.now ?? Date.now)() + 90000;
    try {
        const identity = await requestWithSlot(repo, lease, () => fetchCfIdentity(start.handle!, runtime.fetcher), runtime, deadline);
        if (kind === "enable" && identity.registrationSeconds !== start.registrationSeconds) throw new ApiError(409, "CF_IDENTITY_CHANGED", "当前 Handle 的公开标识已变化，请重新关联；旧证据不会混入。");
        await repo.command({ action: kind, ...lease, ...identity });
        return { state: await repo.state(), notice: kind === "bind" ? "已关联公开账号，尚未验证属于本人。请主动开始同步；官方证据默认不参与分析。" : "已启用官方证据参与分析；账号归属和独立完成仍未验证。" };
    } catch (error) { await repo.command({ action: "fail", ...lease, errorCode: failureCategory(error) }).catch(() => {}); throw unavailable(error); }
}
export async function synchronizeCfAccount(repo: CfAccountRepository, input: z.infer<typeof cfSyncInputSchema>, runtime: Runtime = {}) {
    const start = await repo.command({ action: "reserve", kind: "sync", ...input });
    if (!start.acquired) return { state: await repo.state(), notice: start.replayed ? "本次同步已处理，未重复采集。" : "其他实例正在同步或处于冷却，请稍后继续。" };
    if (!start.nonce || !start.scope || !start.handle) throw new ApiError(503, "CF_ACCOUNT_UNAVAILABLE", "同步租约响应不完整。");
    const lease = { nonce: start.nonce, scope: start.scope }, deadline = (runtime.now ?? Date.now)() + 90000;
    try {
        const identity = await requestWithSlot(repo, lease, () => fetchCfIdentity(start.handle!, runtime.fetcher), runtime, deadline);
        if (identity.registrationSeconds !== start.registrationSeconds) throw new ApiError(409, "CF_IDENTITY_CHANGED", "公开标识已变化，请重新关联；旧证据已停止使用。");
        await repo.command({ action: "identity", ...lease, ...identity });
        // Each invocation commits bounded head/backfill/pending batches independently.
        // Progress survives crashes; a budget is never a completeness assertion.
        for (const purpose of ["head", "history", "pending"] as const) {
            const plan = await repo.command({ action: "plan", ...lease });
            const cursor = purpose === "head" ? plan.head : purpose === "history" ? plan.history : undefined;
            const from = purpose === "pending" ? plan.pendingFrom : cursor?.done ? null : cursor?.from;
            if (!from) continue;
            const submissions = await requestWithSlot(repo, lease, () => fetchCfSubmissions(start.handle!, from, cfPageSize, runtime.fetcher), runtime, deadline);
            const batch = { action: "page", ...lease, requestId: randomUUID(), purpose, from, resetCycle: randomUUID(), submissions };
            // Unknown DB acknowledgement retries the same batch ID; never refetch and attach
            // changed upstream data to the old idempotency key.
            try { await repo.command(batch); }
            catch (error) { if (!(error instanceof ApiError) || error.status !== 503) throw error; await repo.command(batch); }
        }
        await repo.command({ action: "finish", ...lease });
        const state = await repo.state();
        return { state, notice: state.historyInProgress ? "本轮批次已保存，历史仍未到尾部；继续同步将从检查点恢复。" : "历史分页已观察到尾部；后续刷新会增量采集并持续重扫旧 Verdict。" };
    } catch (error) { await repo.command({ action: "fail", ...lease, errorCode: failureCategory(error) }).catch(() => {}); throw unavailable(error); }
}
