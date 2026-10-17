"use client";
import { useEffect, useRef, useState } from "react";
import { ClientError, requestJson } from "@/lib/api-client";
import { cfAccountStateSchema, cfHandleSchema, type CfAccountState } from "@/lib/validation/cf-account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
type Action = "bind" | "sync" | "consent" | "unlink" | "delete";
type Intent = { url: string; body: Record<string, unknown> };
function safeError(error: unknown, mutation = false) {
    // Display only local copy selected by a public error code/status, never raw transport/SDK text.
    if (error instanceof ClientError) {
        if (error.status === 401) return "未登录或登录已过期，请重新登录后加载账号状态。";
        switch (error.code) {
            case "SUPABASE_NOT_CONFIGURED": return "Supabase 未配置或配置不完整，当前无法完成关联；Handle 仍可编辑。";
            case "CF_ACCOUNT_RPC_UNAVAILABLE": return "账号数据库接口暂不可用，当前无法完成关联。请联系维护者核对迁移和接口缓存，再重新加载账号状态；尚不能确认迁移缺失。";
            case "CF_SYNC_NOT_CONFIGURED": return "官方证据服务配置尚未就绪，当前无法完成操作。请联系维护者检查服务配置。";
            case "CF_HANDLE_INVALID": return "官方 API 未找到此当前 Handle；原关联未被替换，请检查 Handle 后重试。";
            case "CF_IDENTITY_CHANGED": return "公开账号标识已变化，请重新加载状态并重新关联；旧证据不会混入。";
            case "CF_SYNC_BUDGET": return "本轮时间预算已用完，已保存的检查点可继续同步。";
        }
        if (error.status === 409) return "账号状态已变化，请重新加载后再操作。";
        if (error.status === 422) return "请求格式不符合要求，请检查 Handle 后重新提交。";
    }
    return mutation
        ? "账号请求失败或超时，请重新加载账号状态；操作结果可能尚未确认，可重试上次请求。"
        : "账号请求失败或超时，当前无法完成关联；请重新加载账号状态。";
}
async function readState() {
    const result = await requestJson<{ state: unknown }>("/api/v1/codeforces-account", { timeoutMs: 20000 });
    return cfAccountStateSchema.parse(result.state);
}
export function CfAccountSettings({ configured }: { configured: boolean }) {
    // The editable draft is intentionally independent of all network state, including successful loads.
    const [state, setState] = useState<CfAccountState | null>(null), [handle, setHandle] = useState("");
    const [loading, setLoading] = useState(configured), [ready, setReady] = useState(false);
    const [loadError, setLoadError] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
    const [busy, setBusy] = useState<Action | null>(null), [pending, setPending] = useState<Intent | null>(null);
    const locked = useRef(false);
    useEffect(() => {
        if (!configured) return;
        let active = true;
        readState().then(current => {
            if (active) { setState(current); setReady(true); setLoadError(""); }
        }).catch(e => { if (active) { setReady(false); setLoadError(safeError(e)); } })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [configured]);
    async function reload() {
        if (!configured || locked.current || loading) return;
        locked.current = true; setLoading(true); setReady(false); setLoadError("");
        try { setState(await readState()); setReady(true); }
        catch (e) { setLoadError(safeError(e)); }
        finally { setLoading(false); locked.current = false; }
    }
    async function send(intent: Intent, action: Action) {
        if (!configured || !ready || !state || loading || locked.current) return;
        locked.current = true;
        setBusy(action); setError(""); setNotice(""); setPending(intent);
        try {
            const r = await requestJson<{ state: unknown; notice: string | null }>(intent.url, { method: "POST", body: intent.body, timeoutMs: 125000 });
            setState(cfAccountStateSchema.parse(r.state)); setReady(true); setLoadError(""); setNotice(r.notice ?? "已保存。"); setPending(null);
        } catch (e) {
            setError(safeError(e, true)); setReady(false);
            // Refresh even after a lost acknowledgement, keeping the exact request for unknown-result retries.
            // Definitive failures need a new intent after recovery, rather than replaying a stale revision.
            if (e instanceof ClientError && e.status < 500) setPending(null);
            try { setState(await readState()); setReady(true); setLoadError(""); }
            catch (refreshError) { setLoadError(safeError(refreshError)); }
        } finally { setBusy(null); locked.current = false; }
    }
    function act(action: Action) {
        if (!state || (action === "bind" && !cfHandleSchema.safeParse(handle).success)) return;
        void send({ url: action === "sync" ? "/api/v1/codeforces-account/sync" : "/api/v1/codeforces-account", body: { ...(action === "sync" ? {} : { action }), requestId: crypto.randomUUID(), revision: state.revision, ...(action === "bind" ? { handle: handle.trim() } : action === "consent" ? { enabled: !state.enabled } : {}) } }, action);
    }
    const statusNames = { unlinked: "未关联", never: "尚未同步", partial: "部分覆盖", idle: "本轮完成", syncing: "同步中", failed: "失败，可恢复" };
    const disabled = !configured || !ready || !state || loading || busy !== null;
    const validHandle = cfHandleSchema.safeParse(handle).success;
    return <Card className="shadow-none"><CardHeader><CardTitle className="text-base">官方解题证据</CardTitle></CardHeader><CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">关联公开 CF 账号，不代表已验证属于本人。只采集必要的题号、时间和 Verdict；不索取 CF 密码/Cookie，不采集源码。启用分析后可显示该账号已观察 OK 题的知识方向；OK 不能证明独立完成或复盘源码一致。</p>
        {!configured ? <p role="status">Supabase 未配置或配置不完整，当前无法完成关联；Handle 仍可编辑。</p>
            : loading ? <p role="status">正在加载账号状态，Handle 仍可编辑…</p>
            : !loadError && !busy && ready && <p role="status">{state?.handle ? "账号状态已加载，可以管理关联。" : "账号状态已加载，输入有效 Handle 后可以绑定。"}</p>}
        {state && !ready && <p>以下为上次读取的账号状态，请重新加载确认后再操作。</p>}
        <label htmlFor="cf-handle" className="block">公开 CF Handle</label><Input id="cf-handle" value={handle} onChange={e=>setHandle(e.target.value)} placeholder="输入当前 Handle" aria-describedby="cf-handle-help" />
        <p id="cf-handle-help" className="text-xs text-muted-foreground">Handle 为 3–24 位英文字母、数字、下划线、点或短横线。输入不会自动关联。</p>
        <Button disabled={disabled || !validHandle} onClick={()=>act("bind")}>{state?.handle ? "替换公开账号" : "关联公开账号"}</Button>
        <Button variant="outline" disabled={!configured || loading || busy !== null} onClick={() => void reload()}>重新加载账号状态</Button>
        {loadError && <p role="alert">账号状态读取失败：{loadError}</p>}
        {state?.handle && <><p>当前关联：<a className="underline" href={`https://codeforces.com/profile/${encodeURIComponent(state.handle)}`} target="_blank" rel="noreferrer">{state.handle}</a> · 归属未验证</p>
            <div className="flex flex-wrap gap-2"><Button disabled={disabled} onClick={()=>act("sync")}>{state.lastSyncedAt ? "刷新 / 继续同步" : "首次同步"}</Button><Button variant="outline" disabled={disabled} onClick={()=>act("consent")}>{state.enabled ? "关闭官方证据分析" : "启用官方证据分析"}</Button><Button variant="outline" disabled={disabled} onClick={()=>act("unlink")}>解除关联</Button><Button variant="outline" disabled={disabled} onClick={()=>act("delete")}>删除采集数据与关联</Button></div>
            <p>分析参与：{state.enabled ? "已启用" : "已关闭"}；同步状态：{statusNames[state.status]}。成功批次：{state.lastSyncedAt ?? "尚无"}。</p>
            <p>已观察 {state.observedSubmissions} 条公开提交，涉及 {state.acceptedProblems} 道 OK 题，待复查 {state.pendingSubmissions} 条。仅为数据覆盖说明，不是能力评分。</p>
            <p>最早观察：{state.oldestObservedAt ?? "未知"}；历史分页从第 {state.historyFrom} 条位置继续（位置可能随新增提交变化）；{state.historyInProgress ? "本轮历史尚未到尾部" : "本轮已到尾部"}。此前完整扫描：{state.lastFullScanAt ?? "尚无"}（提交上界 {state.fullScanUpperId ?? "未知"}）；最新增量高水位 {state.highWater ?? "尚无"}。覆盖不完整时，不推断没有做过其他题。</p>
            {state.errorCode && <p>上次采集失败，成功批次与检查点保留，可稍后继续。</p>}</>}
        <p className="text-xs text-muted-foreground">更换、解除或删除会清除该关联的提交证据；原训练、计划和复盘保留。关闭分析立即停止使用已采集的官方信号，数据仍可由你删除。</p>
        {busy && <p role="status">{busy === "bind" ? "正在关联公开账号…" : busy === "sync" ? "正在同步公开证据，批次会分别保存…" : "正在更新公开账号设置…"}</p>}
        {notice && <p role="status">{notice}</p>}
        {error && <div role="alert"><p>操作失败，可恢复：{error}</p>{pending && <>
            {pending.body.action === "bind" && <p>重试沿用上次提交的 Handle；当前输入用于新的关联请求。</p>}
            <Button variant="outline" disabled={disabled} onClick={() => void send(pending, pending.url.endsWith("/sync") ? "sync" : pending.body.action as Action)}>重试上次请求</Button>
        </>}</div>}
    </CardContent></Card>;
}
