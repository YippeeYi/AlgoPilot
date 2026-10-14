"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/api-client";
import { cfAccountStateSchema, type CfAccountState } from "@/lib/validation/cf-account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export function CfAccountSettings({ configured }: { configured: boolean }) {
    const [state, setState] = useState<CfAccountState | null>(null), [handle, setHandle] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
    const [pending, setPending] = useState<{ url: string; body: Record<string, unknown> } | null>(null);
    useEffect(() => { if (!configured) return; let active = true; requestJson<{state:unknown}>("/api/v1/codeforces-account").then(r => { if(active) setState(cfAccountStateSchema.parse(r.state)); }).catch(e => { if(active) setError(e.message); }); return () => { active = false; }; }, [configured]);
    async function send(intent: { url: string; body: Record<string, unknown> }) {
        setBusy(true); setError(""); setNotice(""); setPending(intent);
        try { const r = await requestJson<{state:unknown;notice:string|null}>(intent.url, { method:"POST", body:intent.body }); setState(cfAccountStateSchema.parse(r.state)); setNotice(r.notice ?? "已保存。"); setPending(null); }
        catch(e) {
            setError(e instanceof Error ? e.message : "请求失败。");
            // A failed acknowledgement may follow a committed mutation or identity revocation.
            // Refresh display without changing the saved request body used for a retry.
            try { const current = await requestJson<{state:unknown}>("/api/v1/codeforces-account"); setState(cfAccountStateSchema.parse(current.state)); } catch { /* Keep the last known display and explicit failure. */ }
        }
        finally { setBusy(false); }
    }
    function act(action: "bind" | "sync" | "consent" | "unlink" | "delete") {
        if (!state) return;
        void send({ url: action === "sync" ? "/api/v1/codeforces-account/sync" : "/api/v1/codeforces-account", body: { ...(action === "sync" ? {} : {action}), requestId:crypto.randomUUID(), revision:state.revision, ...(action === "bind" ? {handle} : action === "consent" ? {enabled:!state.enabled} : {}) } });
    }
    const statusNames = { unlinked: "未关联", never: "尚未同步", partial: "部分覆盖", idle: "本轮完成", syncing: "同步中", failed: "失败，可恢复" };
    const disabled = !configured || !state || busy;
    return <Card className="shadow-none"><CardHeader><CardTitle className="text-base">官方解题证据</CardTitle></CardHeader><CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">关联公开 CF 账号，不代表已验证属于本人。只采集必要的题号、时间和 Verdict；不索取 CF 密码/Cookie，不采集源码。启用分析后可显示该账号已观察 OK 题的知识方向；OK 不能证明独立完成或复盘源码一致。</p>
        {!configured && <p>Supabase 未配置；关联、同步和个人写入已禁用。</p>}
        <label htmlFor="cf-handle" className="block">公开 CF Handle</label><Input id="cf-handle" value={handle} onChange={e=>setHandle(e.target.value)} placeholder="输入当前 Handle" disabled={disabled} />
        <Button disabled={disabled || !handle.trim()} onClick={()=>act("bind")}>{state?.handle ? "替换公开账号" : "关联公开账号"}</Button>
        {state?.handle && <><p>当前关联：<a className="underline" href={`https://codeforces.com/profile/${encodeURIComponent(state.handle)}`} target="_blank" rel="noreferrer">{state.handle}</a> · 归属未验证</p>
            <div className="flex flex-wrap gap-2"><Button disabled={disabled} onClick={()=>act("sync")}>{state.lastSyncedAt ? "刷新 / 继续同步" : "首次同步"}</Button><Button variant="outline" disabled={disabled} onClick={()=>act("consent")}>{state.enabled ? "关闭官方证据分析" : "启用官方证据分析"}</Button><Button variant="outline" disabled={disabled} onClick={()=>act("unlink")}>解除关联</Button><Button variant="outline" disabled={disabled} onClick={()=>act("delete")}>删除采集数据与关联</Button></div>
            <p>分析参与：{state.enabled ? "已启用" : "已关闭"}；同步状态：{statusNames[state.status]}。成功批次：{state.lastSyncedAt ?? "尚无"}。</p>
            <p>已观察 {state.observedSubmissions} 条公开提交，涉及 {state.acceptedProblems} 道 OK 题，待复查 {state.pendingSubmissions} 条。仅为数据覆盖说明，不是能力评分。</p>
            <p>最早观察：{state.oldestObservedAt ?? "未知"}；历史分页从第 {state.historyFrom} 条位置继续（位置可能随新增提交变化）；{state.historyInProgress ? "本轮历史尚未到尾部" : "本轮已到尾部"}。此前完整扫描：{state.lastFullScanAt ?? "尚无"}（提交上界 {state.fullScanUpperId ?? "未知"}）；最新增量高水位 {state.highWater ?? "尚无"}。覆盖不完整时，不推断没有做过其他题。</p>
            {state.errorCode && <p>上次采集失败：{state.errorCode}；成功批次与检查点保留，可稍后继续。</p>}</>}
        <p className="text-xs text-muted-foreground">更换、解除或删除会清除该关联的提交证据；原训练、计划和复盘保留。关闭分析立即停止使用已采集的官方信号，数据仍可由你删除。</p>
        {busy && <p role="status">正在处理公开证据，批次会分别保存…</p>}{notice && <p role="status">{notice}</p>}{error && <div role="alert"><p>{error}</p>{pending && <Button variant="outline" disabled={busy} onClick={()=>void send(pending!)}>重试上次请求</Button>}</div>}
    </CardContent></Card>;
}
