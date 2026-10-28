import Link from "next/link";
import type { SkillIntelligence } from "@/features/learning/intelligence";
import { Card, CardContent } from "@/components/ui/card";
import { EvidenceLinks } from "./evidence-links";
const statusNames = { insufficient: "证据不足", practice_signal: "可补充训练验证", documented_practice: "较多自报解出证据", mixed: "记录表现混合" };
export function SkillInsights({ data }: { data: SkillIntelligence }) {
  const visible = data.topics.filter(t => t.trainingSamples || t.officialAccepted)
    .sort((a,b)=>Number(Boolean(b.action))-Number(Boolean(a.action)) || b.trainingSamples-a.trainingSamples || a.topic.localeCompare(b.topic));
  return <section className="space-y-4" aria-label="个性化训练诊断">
    <h2 className="font-semibold">本窗口的训练诊断与行动</h2>
    <p className="text-sm text-muted-foreground">截至 {data.asOf}，按训练创建时间筛选，每题只取最新完成记录。{data.window === "all" ? "全部指已加载记录，不能代表终身历史。" : `本窗口：${data.start} 至今；不代表这些题目都在此期间完成。`}</p>
    <p className="text-xs text-muted-foreground">官方窗口按每题最新已观察 OK 的提交时间；不是首次 AC 数或解题耗时。同步覆盖与授权状态见下方完整概览。</p>
    <div className="grid gap-3 sm:grid-cols-3 text-sm">
      <Card><CardContent className="py-4">完成记录 {data.recent.completedProblems} 题 · 自报解出 {data.recent.selfReportedSolved} 题<br/>有 Rating 的自报解出 {data.recent.ratedSolved} 题</CardContent></Card>
      <Card><CardContent className="py-4">自报解出 Rating 中位数：{data.recent.medianSolvedRating ?? "UNKNOWN（至少需5题）"}<br/>这是题目难度分布，不是能力评级。</CardContent></Card>
      <Card><CardContent className="py-4">与前一等长窗口的中位数差：{data.medianChange === null ? "UNKNOWN（样本不足或未选择有限窗口）" : `${data.medianChange > 0 ? "+" : ""}${data.medianChange}`}<br/>题目构成变化不能证明进步或退步。</CardContent></Card>
    </div>
    {data.previous && <p className="text-sm">前一等长窗口：{data.previous.completedProblems} 题有完成记录、{data.previous.ratedSolved} 题为有 Rating 的自报解出。两边各至少5题才比较中位数。</p>}
    <p className="text-sm">窗口内另有 {data.coverage.activeOrPaused} 次未完成训练、{data.coverage.unlinkedCompleted} 次旧训练没有题目关联；完成样本中 {data.coverage.missingRating} 题缺 Rating、{data.coverage.missingVisibleTags} 题无可见标签。没有记录不表示没有训练。</p>
    {data.coverage.truncated && <p role="note" className="text-sm">当前仅加载最近 {data.coverage.loadedTraining} / {data.coverage.totalTraining} 次训练，窗口可能不完整。</p>}
    {!visible.length && <p className="text-sm">暂无可见知识方向证据，无法判断优势或薄弱点。可从现有推荐开始训练。</p>}
    <div className="grid gap-3 md:grid-cols-2">{visible.map(t => <Card key={t.topic}><CardContent className="space-y-2 py-4 text-sm">
      <h3 className="font-semibold">{t.topic} · {statusNames[t.status]}</h3>
      <p>{t.trainingSamples} 道完成训练，{t.knownOutcomes} 道有明确结果；自报解出 {t.selfReportedSolved}，实际 L3+ {t.highHints}。明确结果中 L3+ 或未解/放弃的并集 {t.concernSamples} 题。</p>
      <p>记录内自报解出比例：{t.completion ? `${t.completion.numerator} / ${t.completion.denominator}` : "UNKNOWN（少于5个明确结果）"} · {t.confidence}</p>
      <p>关联公开账号官方 OK：{t.officialAccepted} 题，单独呈现，不计入训练比例；归属与独立性未知。</p>
      <p className="text-muted-foreground">{t.status === "practice_signal" ? "至少5个明确结果，其中至少2题且占比不低于40%出现提示或未解信号，适合补充训练验证；不能证明该知识点造成困难。" : t.status === "documented_practice" ? "至少5个明确结果，至少80%自报解出；只表示本批题目的练习证据较多，不证明掌握或稳定独立完成。" : "继续收集训练证据，不据此判定能力缺陷。"}</p>
      {t.lastTrainingCreatedAt && <p>最近记录创建于 {t.lastTrainingCreatedAt}</p>}
      <EvidenceLinks refs={[...t.refs, ...t.officialRefs]}/>
      {t.action && <><p className="text-xs text-muted-foreground">专项会明确提示算法方向；仅临时筛选本轮主题，沿用已保存难度，不更改已保存目标。</p><Link className="inline-block text-primary underline" href={`/dashboard?focus=${encodeURIComponent(t.topic)}&window=${t.action.window}`}>按 {t.topic} 诊断补充训练</Link></>}
    </CardContent></Card>)}</div>
    <details className="text-sm"><summary className="cursor-pointer">没有可见证据的方向</summary><p className="mt-2">{data.topics.filter(t => !t.trainingSamples && !t.officialAccepted).map(t => t.topic).join("、") || "本窗口各方向均有可见记录"}。这表示当前证据无法判断，不等于从未训练或能力差。</p></details>
    <section className="space-y-2 text-sm"><h3 className="font-semibold">本窗口难度与提示记录</h3>{!data.bands.length && <p>没有可用 Rating 样本，难度表现 UNKNOWN。</p>}{data.bands.map(b => <div key={b.min} className="rounded-lg border p-3"><p>{b.min}–{b.max}：完成训练 {b.trainingSamples} 题，自报解出 {b.selfReportedSolved} 题，实际 L3+ {b.highHints} 题；记录内比例 {b.completion ? `${b.completion.numerator}/${b.completion.denominator}` : "UNKNOWN（样本不足）"}。公开账号 OK {b.officialAccepted} 题另计。</p><EvidenceLinks refs={b.refs}/></div>)}</section>
    {data.concentration && <p className="rounded-lg border p-3 text-sm">训练结构提示：本窗口 {data.concentration.denominator} 道有可见标签的完成训练中，{data.concentration.numerator} 道关联 {data.concentration.topic}（至少10题且占80%）。多标签可重叠；可检查是否符合你的专项目标，不据此判断偏科或其他方向薄弱。</p>}
    <details className="text-xs leading-6 text-muted-foreground"><summary className="cursor-pointer">诊断口径与未知项</summary>{data.limitations.map(s => <p key={s}>{s}</p>)}</details>
  </section>;
}
