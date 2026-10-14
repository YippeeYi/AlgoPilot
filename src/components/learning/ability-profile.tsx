"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/api-client";
import type { AbilityProfile as Profile } from "@/features/learning/engine";
import { Card, CardContent } from "@/components/ui/card";
import { EvidenceLinks } from "./evidence-links";
import Link from "next/link";
export function AbilityProfile() {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [error, setError] = useState("");
    useEffect(() => { let active = true; requestJson<{
        profile: Profile;
    }>("/api/v1/learning").then(r => { if (active)
        setProfile(r.profile); }).catch(e => { if (active)
        setError(e.message); }); return () => { active = false; }; }, []);
    if (error)
        return <p role="alert">{error} <Link href="/dashboard" className="underline">返回推荐</Link></p>;
    if (!profile)
        return <p role="status">正在读取学习证据…</p>;
    const names: Record<string, string> = { boundary: "边界处理", overflow: "整数溢出", complexity: "复杂度风险" };
    return <div className="space-y-6">
    <p className="text-sm leading-7 text-muted-foreground">{profile.totalSessions} 次训练记录；画像分析最近 {profile.analyzedSessions} 次，其中 {profile.distinctCompletedProblems} 道不同题目有完成记录。{profile.thoughtRecordedSessions} 次保存过思路版本（记录数量不能衡量思考质量）。能力分析不生成综合分，也不等同于 CF 官方 Rating。</p>
    {!profile.directions.length && <Card><CardContent className="py-6"><h2 className="font-semibold">样本不足</h2><p className="mt-2 text-sm">尚无可分析的已完成题目知识方向。先选择愿意挑战的难度，完成训练后再回看。</p><Link href="/dashboard" className="mt-3 inline-block text-sm text-primary underline">选择下一道题</Link></CardContent></Card>}
    <section><h2 className="mb-3 font-semibold">知识方向与暂定建议</h2><div className="grid gap-4 md:grid-cols-2">{profile.directions.map(d => <Card key={d.topic}><CardContent className="space-y-2 py-5 text-sm"><h3 className="font-semibold">{d.topic} · {d.confidence}</h3><p>{d.samples} 道不同题目 · 自报解出 {d.selfReportedSolved} 道 · 实际 L3+ {d.highHints} 道 · 自报未解/放弃 {d.unresolved} 道</p><p>自报解出且提示 L0/L1：{d.lowHintSolved} 道；外部帮助可能未知。</p><p className="text-muted-foreground">{d.suggestion}</p><EvidenceLinks refs={d.refs}/></CardContent></Card>)}</div></section>
    <section className="space-y-3"><h2 className="font-semibold">难度区间表现</h2>{!profile.bands.length ? <p className="text-sm">样本不足：完成记录缺少 Rating 或尚无完成记录。</p> : profile.bands.map(b => <p key={b.min} className="text-sm">{b.min}–{b.max}：{b.samples} 题，自报解出 {b.selfReportedSolved}，实际 L3+ {b.highHints} · {b.confidence}</p>)}</section>
    <section><h2 className="mb-3 font-semibold">实际最高已看提示</h2><div className="flex flex-wrap gap-3 text-sm">{profile.hintDistribution.map(h => <span key={h.level} className="rounded-lg border px-3 py-2">L{h.level}：{h.samples} 次训练</span>)}</div></section>
    <section className="space-y-3"><h2 className="font-semibold">已授权复盘的待验证建议</h2><p className="text-sm text-muted-foreground">可在推荐页主动授权或关闭证据提取。仅提取已审核结构化分析的知识词汇与风险类别；不分析源码或编辑笔记，不把 AI 判断当作事实。</p>{!profile.reviewDirections.length && !profile.recurringIssues.length && <p className="text-sm">尚无已授权且可识别的复盘证据；保存代码快照不会计作 AI 分析。</p>}{profile.reviewDirections.map(d => <div key={d.topic} className="rounded-lg border p-3 text-sm"><p>{d.topic}：{d.samples} 道题的复盘提及 · {d.source}</p><EvidenceLinks refs={d.refs}/></div>)}{profile.recurringIssues.map(i => <div key={i.key} className="rounded-lg border p-3 text-sm"><p>{names[i.key]}：{i.samples} 道题 · {i.recurring ? "重复出现的待核实问题" : "单次提及，样本不足"} · {i.confidence}</p><EvidenceLinks refs={i.refs}/></div>)}</section>
    <section className="space-y-2 text-xs leading-6 text-muted-foreground"><h2 className="font-semibold text-foreground">来源与可信度边界</h2>{Object.values(profile.sources).map(s => <p key={s}>{s}</p>)}{profile.limitations.map(s => <p key={s}>{s}</p>)}</section>
  </div>;
}
