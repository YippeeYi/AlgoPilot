"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/api-client";
import type { AbilityProfile as Profile } from "@/features/learning/engine";
import { Card, CardContent } from "@/components/ui/card";
import { EvidenceLinks } from "./evidence-links";
import Link from "next/link";
import type { SkillIntelligence } from "@/features/learning/intelligence";
import type { SkillWindow } from "@/lib/validation/learning";
import { SkillInsights } from "./skill-insights";
import {TrainingFeedbackPanel} from './training-feedback';
import {GrowthInsights} from './growth-insights';
export function AbilityProfile() {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [error, setError] = useState("");
    const [window, setWindow] = useState<SkillWindow>("30");
    const [intelligence, setIntelligence] = useState<SkillIntelligence | null>(null);
    const [refresh, setRefresh] = useState(0);
    useEffect(() => { let active = true; requestJson<{
        profile: Profile;
        intelligence: SkillIntelligence;
    }>(`/api/v1/learning?window=${window}`).then(r => { if (active) {
        setProfile(r.profile); setIntelligence(r.intelligence); } }).catch(e => { if (active)
        setError(e.message); }); return () => { active = false; }; }, [window,refresh]);
    const controls = (<div className="flex flex-wrap items-center gap-3 text-sm"><label>诊断时间窗口<select className="ml-2 rounded-md border bg-background p-2" value={window} onChange={e=>{setProfile(null);setIntelligence(null);setError("");setWindow(e.target.value as SkillWindow);}}><option value="7">最近7天</option><option value="30">最近30天</option><option value="90">最近90天</option><option value="all">全部已加载证据</option></select></label><button type="button" className="text-primary underline" onClick={()=>{setProfile(null);setIntelligence(null);setError("");setRefresh(n=>n+1);}}>刷新训练证据</button></div>);
    if (error)
        return <div className="space-y-4">{controls}<p role="alert">{error} <Link href="/dashboard" className="underline">返回推荐</Link></p></div>;
    if (!profile)
        return <div className="space-y-4">{controls}<p role="status">正在读取学习证据…</p></div>;
    const names: Record<string, string> = { boundary: "边界处理", overflow: "整数溢出", complexity: "复杂度风险" };
    return <div className="space-y-6">
    {controls}
    {intelligence && <GrowthInsights data={intelligence.growth}/>}
    <TrainingFeedbackPanel key={`${window}/${refresh}`} window={window} current={intelligence??undefined}/>
    {intelligence && <SkillInsights data={intelligence}/>}
    <h2 className="font-semibold">完整已加载证据概览（不受诊断窗口筛选）</h2>
    <p className="text-sm leading-7 text-muted-foreground">{profile.totalSessions} 次训练记录；画像分析最近 {profile.analyzedSessions} 次，其中 {profile.distinctCompletedProblems} 道不同题目有完成记录。{profile.thoughtRecordedSessions} 次保存过思路版本（记录数量不能衡量思考质量）。能力分析不生成综合分，也不等同于 CF 官方 Rating。</p>
    <section className="space-y-2 text-sm"><h2 className="font-semibold">关联公开账号的官方依据</h2>{profile.official.enabled ? <><p>{profile.official.handle}：已观察到 {profile.official.totalAcceptedProblems} 道不同题目的 OK，本画像取最近 {profile.official.analyzedAccepted} 道。账号归属、独立完成和导入源码一致性均未验证。</p><p>最近成功批次：{profile.official.lastSyncedAt ?? "尚无"}；最近历史到尾部：{profile.official.lastFullScanAt ?? "尚未到尾部，覆盖不完整"}。先前到尾部不代表当前实时完整。</p></> : <p>官方证据未启用，不参与本轮能力判断。</p>}<Link className="text-primary underline" href="/settings">管理公开账号、同步与证据授权</Link></section>
    {!profile.directions.length && <Card><CardContent className="py-6"><h2 className="font-semibold">样本不足</h2><p className="mt-2 text-sm">尚无可分析的已完成题目知识方向。先选择愿意挑战的难度，完成训练后再回看。</p><Link href="/dashboard" className="mt-3 inline-block text-sm text-primary underline">选择下一道题</Link></CardContent></Card>}
    <details className="space-y-3"><summary className="cursor-pointer text-sm font-semibold">展开全部已加载记录的知识与难度细项</summary><section><h2 className="mb-3 font-semibold">知识方向与暂定建议</h2><div className="grid gap-4 md:grid-cols-2">{profile.directions.map(d => <Card key={d.topic}><CardContent className="space-y-2 py-5 text-sm"><h3 className="font-semibold">{d.topic} · {d.confidence}</h3><p>{d.samples} 道不同题目 · 训练 {d.trainingSamples} 道 · 关联公开账号官方 OK {d.officialAccepted} 道（同题可有两个来源）</p><p>自报解出 {d.selfReportedSolved} 道 · 实际 L3+ {d.highHints} 道 · 自报未解/放弃 {d.unresolved} 道</p><p>自报解出且提示 L0/L1：{d.lowHintSolved} 道；外部帮助可能未知。</p><p className="text-muted-foreground">{d.suggestion}</p><EvidenceLinks refs={[...d.refs, ...d.officialRefs]}/></CardContent></Card>)}</div></section>
    <section className="space-y-3"><h2 className="font-semibold">难度区间表现</h2>{!profile.bands.length ? <p className="text-sm">样本不足：完成记录缺少 Rating 或尚无完成记录。</p> : profile.bands.map(b => <p key={b.min} className="text-sm">{b.min}–{b.max}：{b.samples} 题，自报解出 {b.selfReportedSolved}，关联公开账号 OK {b.officialAccepted}，实际 L3+ {b.highHints} · {b.confidence}</p>)}</section></details>
    <section><h2 className="mb-3 font-semibold">实际最高已看提示</h2><div className="flex flex-wrap gap-3 text-sm">{profile.hintDistribution.map(h => <span key={h.level} className="rounded-lg border px-3 py-2">L{h.level}：{h.samples} 次训练</span>)}</div></section>
    <section className="space-y-3"><h2 className="font-semibold">已授权复盘的待验证建议</h2><p className="text-sm text-muted-foreground">可在推荐页主动授权或关闭证据提取。仅提取已审核结构化分析的知识词汇与风险类别；不分析源码或编辑笔记，不把 AI 判断当作事实。</p>{!profile.reviewDirections.length && !profile.recurringIssues.length && <p className="text-sm">尚无已授权且可识别的复盘证据；保存代码快照不会计作 AI 分析。</p>}{profile.reviewDirections.map(d => <div key={d.topic} className="rounded-lg border p-3 text-sm"><p>{d.topic}：{d.samples} 道题的复盘提及 · {d.source}</p><EvidenceLinks refs={d.refs}/></div>)}{profile.recurringIssues.map(i => <div key={i.key} className="rounded-lg border p-3 text-sm"><p>{names[i.key]}：{i.samples} 道题 · {i.recurring ? "重复出现的待核实问题" : "单次提及，样本不足"} · {i.confidence}</p><EvidenceLinks refs={i.refs}/></div>)}</section>
    <section className="space-y-2 text-xs leading-6 text-muted-foreground"><h2 className="font-semibold text-foreground">来源与可信度边界</h2>{Object.values(profile.sources).map(s => <p key={s}>{s}</p>)}{profile.limitations.map(s => <p key={s}>{s}</p>)}</section>
  </div>;
}
