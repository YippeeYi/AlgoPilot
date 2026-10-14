"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { requestJson, ClientError } from "@/lib/api-client";
import { defaultPreferences, learningTopics, type LearningPreferences } from "@/lib/validation/learning";
import { cfKey, cfUrl, type TrainingPlan, type PlanDetail } from "@/lib/validation/m3";
import type { RecommendationResult } from "@/features/learning/engine";
import { EvidenceLinks } from "./evidence-links";
export function Recommendations() {
    const router = useRouter();
    const [result, setResult] = useState<RecommendationResult | null>(null);
    const [prefs, setPrefs] = useState<LearningPreferences>(defaultPreferences);
    const [plans, setPlans] = useState<TrainingPlan[]>([]);
    const [planId, setPlanId] = useState("");
    const [revision, setRevision] = useState(0);
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const attempts = useRef(new Map<string, {
        id: string;
        revision?: number;
    }>());
    function attempt(key: string) { const existing = attempts.current.get(key); if (existing)
        return existing; const next: {
        id: string;
        revision?: number;
    } = { id: crypto.randomUUID() }; attempts.current.set(key, next); return next; }
    useEffect(() => {
        let active = true;
        Promise.allSettled([requestJson<RecommendationResult>("/api/v1/recommendations", { method: "POST", body: {} }), requestJson<{
                items: TrainingPlan[];
            }>("/api/v1/plans"), requestJson<{preferences: LearningPreferences | null; revision: number}>("/api/v1/learning")]).then(([rec, plan, learning]) => {
            if (!active)
                return;
            if (rec.status === "fulfilled") {
                setResult(rec.value);
                setPrefs(rec.value.preferences);
                setRevision(rec.value.revision);
                setPreferencesReady(true);
            }
            else
                setError(rec.reason instanceof Error ? rec.reason.message : "推荐加载失败。");
            if (plan.status === "fulfilled")
                setPlans(plan.value.items.filter(p => !p.archived));
            else
                setNotice("计划暂时无法读取；可稍后重试或打开计划页面。");
            if (learning.status === "fulfilled" && rec.status === "rejected") {
                setPrefs(learning.value.preferences ?? defaultPreferences);
                setRevision(learning.value.revision);
                setPreferencesReady(true);
            } else if (learning.status === "rejected" && rec.status === "rejected") {
                setNotice("学习证据暂时无法读取；保存自评需要先恢复连接。");
            }
            setBusy(false);
        });
        return () => { active = false; };
    }, []);
    async function reload(exclude: string[] = []) { const r = await requestJson<RecommendationResult>("/api/v1/recommendations", { method: "POST", body: { exclude } }); setResult(r); setRevision(r.revision); if (!preferencesReady) { setPrefs(r.preferences); setPreferencesReady(true); } return r; }
    async function run(fn: () => Promise<void>) { setBusy(true); setError(""); setNotice(""); try {
        await fn();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "操作未完成，请重试。");
    }
    finally {
        setBusy(false);
    } }
    async function save() {
        if (!preferencesReady)
            return;
        const key = `preferences/${revision}/${JSON.stringify(prefs)}`;
        try {
            await requestJson("/api/v1/learning/preferences", { method: "POST", body: { requestId: attempt(key).id, revision, preferences: prefs } });
            attempts.current.delete(key);
            const current = await requestJson<{revision:number}>("/api/v1/learning");
            setRevision(current.revision);
            await reload();
            setNotice("目标已保存；推荐与能力画像使用相同证据。 ");
        }
        catch (e) {
            if (e instanceof ClientError && e.status === 409) {
                attempts.current.delete(key);
                const current = await requestJson<{revision:number}>("/api/v1/learning");
                setRevision(current.revision);
            }
            throw e;
        }
    }
    async function feedback(problemId: string, kind: string) { const key = `feedback/${problemId}/${kind}`; await requestJson("/api/v1/learning/feedback", { method: "POST", body: { requestId: attempt(key).id, problemId, kind } }); await reload([problemId]); setNotice("反馈已保存并影响本轮排序；它是偏好信号，不是解题结果或能力结论。"); }
    async function start(problemId: string) { const r = await requestJson<{
        session: {
            id: string;
        };
    }>("/api/v1/sessions", { method: "POST", body: { problemId, mode: "practice", timerEnabled: false, requestId: attempt(`start/${problemId}`).id } }); router.push(`/practice/${r.session.id}`); }
    async function add(problemId: string) {
        const key = `plan/${planId}/${problemId}`;
        const a = attempt(key);
        try {
            if (a.revision === undefined)
                a.revision = (await requestJson<PlanDetail>(`/api/v1/plans/${planId}`)).plan.revision;
            await requestJson(`/api/v1/plans/${planId}`, { method: "PATCH", body: { action: "add", problemIds: [problemId], revision: a.revision, requestId: a.id } });
            await reload();
            setNotice("已加入现有计划；同计划内自动去重，其他计划不受影响。");
            attempts.current.delete(key);
        }
        catch (e) {
            if (e instanceof ClientError && e.status === 409)
                attempts.current.delete(key);
            throw e;
        }
    }
    return <div className="space-y-5">
    <p className="text-sm text-muted-foreground">每次最多推荐 5 题。无需关联 CF Handle；先选择愿意挑战的范围，它是自评偏好，不是官方 Rating。</p>
    <form onSubmit={e => { e.preventDefault(); void run(save); }} className="space-y-4 rounded-xl border p-4">
      <h2 className="font-semibold">简短能力自评与本轮目标</h2>
      <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">愿意挑战的最低难度<Input type="number" min={800} max={3500} required value={prefs.min} onChange={e => setPrefs({ ...prefs, min: Number(e.target.value) })}/></label><label className="text-sm">愿意挑战的最高难度<Input type="number" min={800} max={3500} required value={prefs.max} onChange={e => setPrefs({ ...prefs, max: Number(e.target.value) })}/></label><label className="text-sm">训练目标<select className="mt-2 w-full rounded-md border bg-background p-2" value={prefs.goal} onChange={e => setPrefs({ ...prefs, goal: e.target.value as LearningPreferences["goal"] })}><option value="balanced">难度与知识均衡</option><option value="independence">加强独立解题</option><option value="explore">探索更多知识方向</option></select></label></div>
      <details><summary className="cursor-pointer text-sm">训练主题（可选，最多 5 个；选定主题可能提示算法方向）</summary><div className="mt-3 flex flex-wrap gap-3">{learningTopics.map(topic => <label key={topic} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={prefs.themes.includes(topic)} disabled={!prefs.themes.includes(topic) && prefs.themes.length >= 5} onChange={e => setPrefs({ ...prefs, themes: e.target.checked ? [...prefs.themes, topic] : prefs.themes.filter(t => t !== topic) })}/>{topic}</label>)}</div></details>
      <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={prefs.repeat} onChange={e => setPrefs({ ...prefs, repeat: e.target.checked })}/>主动重新练习已知解出的题目</label>
      <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={prefs.reviewEvidence} onChange={e => setPrefs({ ...prefs, reviewEvidence: e.target.checked })}/>授权从已生成的 AI 复盘提取知识词汇与风险类别，用于画像和推荐（仅本服务内处理，可关闭；AI 建议仍未验证）</label>
      <Button type="submit" disabled={busy || !preferencesReady || prefs.min > prefs.max}>保存目标并推荐</Button>
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={busy} onClick={() => void run(async () => { await reload(result?.items.map(i => i.problem.id) ?? []); })}>重新推荐</Button><Link className="text-sm text-primary underline" href="/analytics">查看能力画像与依据</Link><label className="text-sm">加入计划<select className="ml-2 max-w-full rounded-md border bg-background p-2" value={planId} onChange={e => setPlanId(e.target.value)}><option value="">选择现有计划</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><Link className="text-sm underline" href="/plans">管理计划</Link></div>
    {busy && <p role="status" className="text-sm">正在读取证据与更新推荐…</p>}
    {result && <><p className="text-xs text-muted-foreground">可信缓存最后成功同步：{result.syncedAt ? new Date(result.syncedAt).toLocaleString() : "尚未同步"}{result.stale ? " · 缓存已过期，谨慎使用" : ""} · 过滤后 {result.candidateCount} 个候选</p>{result.notice && <p role="status" className="text-sm">{result.notice}</p>}{result.reused && <p className="text-xs">符合条件的替代题不足；保留部分上一轮题目。</p>}{!result.items.length && <p className="rounded-lg border p-5 text-sm">没有符合条件的推荐。可扩大难度范围、减少主题限制，或主动选择重新练习；系统不会补造题目或难度。</p>}
      <div className="grid gap-4 xl:grid-cols-2">{result.items.map(item => <Card key={item.problem.id}><CardContent className="space-y-4 py-5"><h2 className="text-base font-semibold break-words">{cfKey(item.problem.contestId, item.problem.index)} · {item.problem.name}</h2><ul className="space-y-2 text-sm leading-6">{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul><EvidenceLinks refs={item.refs}/><div className="flex flex-wrap items-center gap-2"><a className="text-sm text-primary underline" href={cfUrl(item.problem.contestId, item.problem.index)} target="_blank" rel="noreferrer">打开 CF 官方题目</a><Button disabled={busy} onClick={() => void run(() => start(item.problem.id))}>进入思维教练</Button><Button variant="outline" disabled={busy || !planId} onClick={() => void run(() => add(item.problem.id))}>加入所选计划</Button></div><div className="flex flex-wrap gap-2" aria-label="推荐反馈">{[["too_easy", "太简单"], ["too_hard", "太难"], ["off_goal", "不符合目标"]].map(([kind, label]) => <Button key={kind} size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => feedback(item.problem.id, kind!))}>{label}</Button>)}</div></CardContent></Card>)}</div><p className="text-xs leading-6 text-muted-foreground">{result.limitations}</p></>}
    <div className="flex flex-wrap gap-4 border-t pt-4 text-sm"><Link href="/problems" className="underline">辅助选题：浏览题库</Link><Link href="/sessions" className="underline">训练记录</Link><Link href="/reviews" className="underline">题目分析 / AC 复盘</Link></div>
  </div>;
}
