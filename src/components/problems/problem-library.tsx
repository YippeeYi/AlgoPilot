"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requestJson } from "@/lib/api-client";
import { cfKey, cfUrl, type CatalogPage, type CatalogProblem, type TrainingPlan, type PlanDetail } from "@/lib/validation/m3";
import type { TrainingSession } from "@/lib/validation/m1";
export function ProblemLibrary() {
    const router = useRouter();
    const [page, setPage] = useState<(CatalogPage & {
        notice?: string | null;
    }) | null>(null);
    const [query, setQuery] = useState("");
    const [min, setMin] = useState("");
    const [max, setMax] = useState("");
    const [tags, setTags] = useState<string[]>([]);
    const [sort, setSort] = useState("newest");
    const [params, setParams] = useState("offset=0");
    const [reload, setReload] = useState(0);
    const [selected, setSelected] = useState<Map<string, CatalogProblem>>(new Map());
    const [plans, setPlans] = useState<TrainingPlan[]>([]);
    const [planId, setPlanId] = useState("");
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [mode, setMode] = useState("practice");
    const attempt = useRef<{
        payload: string;
        requestId: string;
        revision?: number;
    } | null>(null);
    const starts = useRef(new Map<string, string>());
    useEffect(() => { let active = true; requestJson<CatalogPage>(`/api/v1/problems?${params}`).then(r => { if (active) {
        setPage(r);
        setError("");
    } }).catch(e => { if (active)
        setError(e.message); }); return () => { active = false; }; }, [params, reload]);
    useEffect(() => { let active = true; requestJson<{
        items: TrainingPlan[];
    }>("/api/v1/plans").then(r => { if (active)
        setPlans(r.items); }).catch(() => { }); return () => { active = false; }; }, []);
    const offset = Number(new URLSearchParams(params).get("offset") ?? 0);
    function search(e: React.FormEvent) { e.preventDefault(); const p = new URLSearchParams({ q: query, sort, tags: tags.join(";"), offset: "0" }); if (min)
        p.set("min", min); if (max)
        p.set("max", max); setParams(p.toString()); setReload(v => v + 1); }
    function paginate(n: number) { const p = new URLSearchParams(params); p.set("offset", String(n)); setParams(p.toString()); }
    async function refresh() { setBusy(true); setError(""); try {
        const r = await requestJson<CatalogPage & {
            notice: string | null;
        }>("/api/v1/problems/refresh", { method: "POST", body: {} });
        setPage(r);
        setParams("offset=0");
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "刷新失败。");
    }
    finally {
        setBusy(false);
    } }
    async function start(id: string) { setBusy(true); setError(""); const key = `${id}/${mode}`; const requestId = starts.current.get(key) ?? crypto.randomUUID(); starts.current.set(key, requestId); try {
        const r = await requestJson<{
            session: TrainingSession;
        }>("/api/v1/sessions", { method: "POST", body: { problemId: id, mode, timerEnabled: false, requestId } });
        router.push(`/practice/${r.session.id}`);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "训练创建失败。");
    }
    finally {
        setBusy(false);
    } }
    async function add() {
        setBusy(true);
        setError("");
        try {
            const problemIds = Array.from(selected.keys());
            const payload = JSON.stringify({ planId, name, description, problemIds });
            if (attempt.current?.payload !== payload)
                attempt.current = { payload, requestId: crypto.randomUUID() };
            let id: string;
            if (planId) {
                if (attempt.current.revision === undefined) {
                    const d = await requestJson<PlanDetail>(`/api/v1/plans/${planId}`);
                    attempt.current.revision = d.plan.revision;
                }
                await requestJson(`/api/v1/plans/${planId}`, { method: "PATCH", body: { action: "add", problemIds, revision: attempt.current.revision, requestId: attempt.current.requestId } });
                id = planId;
            }
            else {
                const d = await requestJson<PlanDetail>("/api/v1/plans", { method: "POST", body: { name, description, problemIds, requestId: attempt.current.requestId } });
                id = d.plan.id;
            }
            setSelected(new Map());
            attempt.current = null;
            router.push(`/plans/${id}`);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "计划保存失败。");
        }
        finally {
            setBusy(false);
        }
    }
    return <div className="space-y-5">
 <form onSubmit={search} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
 <label className="text-sm lg:col-span-2">题号、题目名称或 Codeforces URL<Input value={query} onChange={e => setQuery(e.target.value)} placeholder="1538D / 1732C1 / 题目名称" maxLength={200}/></label>
 <label className="text-sm">最低 Rating<Input type="number" min={0} max={10000} value={min} onChange={e => setMin(e.target.value)}/></label><label className="text-sm">最高 Rating<Input type="number" min={0} max={10000} value={max} onChange={e => setMax(e.target.value)}/></label>
 <label className="text-sm">Tags（多选，可能揭示算法方向）<select aria-label="Tags 筛选" multiple className="mt-1 block h-24 w-full rounded border bg-background p-2" value={tags} onChange={e => setTags(Array.from(e.target.selectedOptions, o => o.value))}>{page?.tags.map(t => <option key={t}>{t}</option>)}</select></label>
 <label className="text-sm">排序<select className="mt-1 block w-full rounded border bg-background p-2" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">题号降序</option><option value="solved_desc">解题人数从多到少</option><option value="solved_asc">解题人数从少到多</option></select></label>
 <div className="flex flex-wrap items-end gap-2"><Button disabled={busy}>搜索题库</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>刷新官方缓存</Button></div>
 <label className="text-sm">开始训练的模式<select className="mt-1 block w-full rounded border bg-background p-2" value={mode} onChange={e => setMode(e.target.value)}><option value="practice">独立练习</option><option value="contest">比赛模式（AI 禁用）</option></select></label>
 </form>
 <p className="text-xs text-muted-foreground">搜索使用服务器缓存。最后成功同步：{page?.syncedAt ? new Date(page.syncedAt).toLocaleString() : "尚未同步"}{page?.stale ? " · 缓存过期或同步暂不可用" : ""}。缺失 Rating 显示未定级；题面请在官网阅读。</p>
 {page?.notice && <p role="status" className="text-sm">{page.notice}</p>}{error && <p role="alert" className="text-sm text-destructive">{error} <Button variant="outline" onClick={() => setReload(v => v + 1)}>重试加载</Button></p>}
 <section aria-label="批量选题" className="space-y-3 rounded-xl border p-4"><p className="font-medium">已选 {selected.size} 题（跨页保留，最多 200 题）</p><div className="flex flex-wrap gap-2">{Array.from(selected.values()).map(p => <Button size="sm" variant="outline" key={p.id} onClick={() => setSelected(old => { const next = new Map(old); next.delete(p.id); return next; })}>取消 {cfKey(p.contestId, p.index)}</Button>)}</div>
 <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">加入计划<select value={planId} onChange={e => setPlanId(e.target.value)} className="mt-1 block w-full rounded border bg-background p-2"><option value="">创建新计划</option>{plans.filter(p => !p.archived).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{!planId && <><label className="text-sm">新计划名称<Input value={name} maxLength={100} onChange={e => setName(e.target.value)}/></label><label className="text-sm">计划说明（可选）<Input value={description} maxLength={2000} onChange={e => setDescription(e.target.value)}/></label></>}</div>
 <Button onClick={() => void add()} disabled={busy || !selected.size || (!planId && !name.trim())}>{planId ? "加入现有计划" : "创建计划并加入选题"}</Button> <Link className="text-sm underline" href="/plans">我的计划</Link></section>
 {!page && !error && <p role="status">正在加载官方题库…</p>}{page && <p className="text-sm">共 {page.total} 题</p>}{page && page.items.length === 0 && <p>没有匹配的官方题目，请调整筛选。</p>}
 {page?.items.map(p => <Card key={p.id} className="shadow-none"><CardContent className="flex flex-wrap items-center gap-4 py-5"><label className="flex min-w-0 flex-1 items-start gap-3"><input type="checkbox" aria-label={`选择 ${cfKey(p.contestId, p.index)}`} checked={selected.has(p.id)} disabled={!selected.has(p.id) && selected.size >= 200} onChange={e => setSelected(old => { const next = new Map(old); if (e.target.checked)
        next.set(p.id, p);
    else
        next.delete(p.id); return next; })} className="mt-1"/><span><span className="block font-medium">{cfKey(p.contestId, p.index)} · {p.name}</span><span className="mt-2 block text-xs text-muted-foreground">{p.rating ?? "未定级"} · 解题人数 {p.solvedCount ?? "未提供"}</span></span></label><a className="text-sm underline" href={cfUrl(p.contestId, p.index)} target="_blank" rel="noreferrer">官方题面</a><Button variant="outline" size="sm" disabled={busy} onClick={() => void start(p.id)}>开始这道题</Button></CardContent></Card>)}
 <div className="flex items-center justify-between"><Button variant="outline" disabled={offset === 0 || busy} onClick={() => paginate(Math.max(0, offset - 30))}>上一页</Button><span className="text-sm">第 {Math.floor(offset / 30) + 1} 页</span><Button variant="outline" disabled={!page || offset + 30 >= page.total || busy} onClick={() => paginate(offset + 30)}>下一页</Button></div>
 </div>;
}
