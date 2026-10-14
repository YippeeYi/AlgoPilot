"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { requestJson } from "@/lib/api-client";
import { cfKey, cfUrl, type TrainingPlan, type PlanDetail } from "@/lib/validation/m3";
import type { TrainingSession } from "@/lib/validation/m1";
export function PlanWorkspace({ id }: {
    id?: string;
}) {
    const router = useRouter();
    const [plans, setPlans] = useState<TrainingPlan[]>([]);
    const [detail, setDetail] = useState<PlanDetail | null>(null);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [loaded, setLoaded] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [reload, setReload] = useState(0);
    const attempt = useRef<{
        payload: string;
        requestId: string;
    } | null>(null);
    const startRequests = useRef(new Map<string, string>());
    useEffect(() => { let active = true; if (id)
        requestJson<PlanDetail>(`/api/v1/plans/${id}`).then(d => { if (active) {
            setDetail(d);
            setName(d.plan.name);
            setDescription(d.plan.description);
            setLoaded(true);
            setError("");
        } }).catch(e => { if (active)
            setError(e.message); });
    else
        requestJson<{
            items: TrainingPlan[];
        }>("/api/v1/plans").then(r => { if (active) {
            setPlans(r.items);
            setLoaded(true);
            setError("");
        } }).catch(e => { if (active)
            setError(e.message); }); return () => { active = false; }; }, [id, reload]);
    function requestId(payload: string) { if (attempt.current?.payload !== payload)
        attempt.current = { payload, requestId: crypto.randomUUID() }; return attempt.current.requestId; }
    async function create(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(""); try {
        const body = { name, description, problemIds: [] };
        const d = await requestJson<PlanDetail>("/api/v1/plans", { method: "POST", body: { ...body, requestId: requestId(JSON.stringify(body)) } });
        attempt.current = null;
        router.push(`/plans/${d.plan.id}`);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "创建失败。");
    }
    finally {
        setBusy(false);
    } }
    async function mutate(body: Record<string, unknown>) { if (!detail)
        return; setBusy(true); setError(""); try {
        const payload = { ...body, revision: detail.plan.revision };
        const d = await requestJson<PlanDetail & {
            deleted?: boolean;
        }>(`/api/v1/plans/${detail.plan.id}`, { method: "PATCH", body: { ...payload, requestId: requestId(JSON.stringify(payload)) } });
        attempt.current = null;
        if (d.deleted)
            router.push("/plans");
        else {
            setDetail(d);
            setName(d.plan.name);
            setDescription(d.plan.description);
        }
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "更新失败。请加载最新版本。");
    }
    finally {
        setBusy(false);
    } }
    function reorder(index: number, step: number) { if (!detail)
        return; const ids = detail.items.map(i => i.id); [ids[index], ids[index + step]] = [ids[index + step]!, ids[index]!]; void mutate({ action: "reorder", itemIds: ids }); }
    async function start(itemId: string, newSession = false) { if (!detail)
        return; setBusy(true); setError(""); const key = `${itemId}/${newSession}`; const rid = startRequests.current.get(key) ?? crypto.randomUUID(); startRequests.current.set(key, rid); try {
        const r = await requestJson<{
            session: TrainingSession;
        }>(`/api/v1/plans/${detail.plan.id}/start`, { method: "POST", body: { itemId, newSession, requestId: rid } });
        router.push(`/practice/${r.session.id}?planId=${detail.plan.id}`);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "训练打开失败。");
    }
    finally {
        setBusy(false);
    } }
    const completed = detail?.items.filter(i => i.manual_status === "completed").length ?? 0;
    return <div className="space-y-5">{error && <p role="alert" className="text-sm text-destructive">{error} <Button variant="outline" onClick={() => setReload(v => v + 1)}>加载最新版本</Button></p>}{!loaded && !error && <p role="status">正在加载计划…</p>}
 {!id && <><form onSubmit={create} className="space-y-3 rounded-xl border p-5"><label className="block text-sm">计划名称<Input value={name} maxLength={100} required onChange={e => setName(e.target.value)}/></label><label className="block text-sm">说明（可选）<Textarea value={description} maxLength={2000} onChange={e => setDescription(e.target.value)}/></label><Button disabled={busy || !name.trim()}>创建计划</Button></form>{loaded && !plans.length && <p>还没有计划。创建计划后从 CF 题库批量添加题目。</p>}{plans.map(p => <Card key={p.id}><CardContent className="py-5"><Link className="font-medium underline" href={`/plans/${p.id}`}>{p.name}</Link><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{p.description}</p>{p.archived && <p className="text-sm">已归档</p>}</CardContent></Card>)}</>}
 {detail && <><div className="flex flex-wrap gap-4 text-sm"><Link href="/plans" className="underline">返回我的计划</Link><Link href="/problems" className="underline">从题库继续添加题目</Link></div>
 <form onSubmit={e => { e.preventDefault(); void mutate({ action: "edit", name, description, archived: detail.plan.archived }); }} className="space-y-3 rounded-xl border p-5"><label className="block text-sm">计划名称<Input value={name} maxLength={100} required onChange={e => setName(e.target.value)} disabled={busy}/></label><label className="block text-sm">说明（可选）<Textarea value={description} maxLength={2000} onChange={e => setDescription(e.target.value)} disabled={busy}/></label><div className="flex flex-wrap gap-2"><Button disabled={busy || !name.trim()}>保存名称与说明</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void mutate({ action: "edit", name, description, archived: !detail.plan.archived })}>{detail.plan.archived ? "恢复计划" : "归档计划"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmDelete(true)}>删除计划</Button></div>{confirmDelete && <div role="alert" className="space-y-2 rounded border p-3"><p>删除计划及选题列表，题目、训练、笔记和复盘仍保留。确认删除？</p><Button type="button" variant="destructive" disabled={busy} onClick={() => void mutate({ action: "delete" })}>确认删除计划</Button> <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>取消</Button></div>}</form>
 <p className="text-sm">手动计划进度：{completed}/{detail.items.length}（用户记录，不代表官方 AC）{detail.plan.archived ? " · 已归档" : ""}</p><progress aria-label="手动计划完成进度" className="w-full" value={completed} max={Math.max(1, detail.items.length)}/>
 {!detail.items.length && <p>计划中暂无题目，请到题库多选后加入此计划。</p>}{detail.items.map((item, index) => <Card key={item.id}><CardContent className="space-y-4 py-5"><h2 className="font-medium">{index + 1}. {cfKey(item.problem.contestId, item.problem.index)} · {item.problem.name}</h2><p className="text-xs text-muted-foreground">Rating：{item.problem.rating ?? "未定级"} · 官方状态未同步到计划进度（公开账号证据单独用于画像/推荐，不核实此训练或源码） · AI 复盘 {item.reviews.filter(r => r.analyzed).length} 份</p>
 <div className="flex flex-wrap items-center gap-3"><label className="text-sm">手动计划状态<select aria-label={`计划状态 ${cfKey(item.problem.contestId, item.problem.index)}`} className="ml-2 rounded border bg-background p-2" value={item.manual_status} disabled={busy || detail.plan.archived} onChange={e => void mutate({ action: "status", itemId: item.id, status: e.target.value })}><option value="planned">待开始</option><option value="in_progress">进行中</option><option value="completed">已结束（手动）</option></select></label><Button size="sm" variant="outline" disabled={busy || detail.plan.archived || index === 0} onClick={() => reorder(index, -1)} aria-label={`上移 ${cfKey(item.problem.contestId, item.problem.index)}`}>上移</Button><Button size="sm" variant="outline" disabled={busy || detail.plan.archived || index === detail.items.length - 1} onClick={() => reorder(index, 1)} aria-label={`下移 ${cfKey(item.problem.contestId, item.problem.index)}`}>下移</Button><Button size="sm" variant="outline" disabled={busy || detail.plan.archived} onClick={() => void mutate({ action: "remove", itemId: item.id })}>从计划移除</Button></div>
 <div className="flex flex-wrap items-center gap-3"><a className="text-sm underline" href={cfUrl(item.problem.contestId, item.problem.index)} target="_blank" rel="noreferrer">在 Codeforces 打开</a><Button size="sm" disabled={busy || detail.plan.archived} onClick={() => void start(item.id)}>打开或开始训练</Button><Button size="sm" variant="outline" disabled={busy || detail.plan.archived} onClick={() => void start(item.id, true)}>开始新一轮训练</Button></div>
 <details><summary className="cursor-pointer text-sm">训练记录 {item.sessions.length} 次 · 复盘快照 {item.reviews.length} 份</summary><div className="mt-3 space-y-2">{item.sessions.map(s => <p key={s.id} className="text-sm"><Link className="underline" href={`/practice/${s.id}?planId=${detail.plan.id}`}>{new Date(s.created_at).toLocaleString()} · {s.status} · {s.id.slice(0, 8)}</Link> · {s.outcome === "solved_self_reported" ? "AC（自报）" : s.outcome ?? "未记录结果"} · {s.linked ? "由此计划打开" : "同题历史"} <Link className="underline" href={`/reviews?sessionId=${s.id}`}>AC 代码复盘</Link></p>)}{item.reviews.map(r => <p key={r.id} className="text-sm"><Link className="underline" href={`/reviews?reviewId=${r.id}`}>复盘 {r.id.slice(0, 8)} · {r.analyzed ? "已生成 AI 分析" : "仅保存代码快照"}</Link> · 自报 AC，源码匹配未验证</p>)}</div></details>
 </CardContent></Card>)}</>}
 </div>;
}
