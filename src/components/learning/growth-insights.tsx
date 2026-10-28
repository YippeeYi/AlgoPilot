import Link from 'next/link';
import type {GrowthObservations} from '@/features/learning/growth';
import {EvidenceLinks} from './evidence-links';
const ratio=(v:{numerator:number;denominator:number}|null)=>v?`${v.numerator}/${v.denominator}`:'UNKNOWN（少于5个明确结果）';
export function GrowthInsights({data}:{data:GrowthObservations}) {
  return <section aria-label="成长观测" className="space-y-4 rounded-lg border p-4 text-sm">
    <h2 className="font-semibold">成长观测：记录变化与下一步</h2>
    <p>本窗 ({data.currentStart??'已加载起点'}, {data.currentEnd}]；{data.previous ? `前窗 (${data.previousStart}, ${data.previousEnd}]。`:'全部已加载模式没有前一等长窗口。'}</p>
    <p className="text-muted-foreground">比较按创建时间分组的不同题目记录，不是当时的能力快照。同题只保留最新完成记录，旧记录可退出前窗；未解题标签仍受披露权限限制。数量、难度构成和能力变化是不同概念。</p>
    <p role="status">比较状态：{data.comparison==='descriptive'?'两窗样本达到门槛，仅描述记录表现':data.comparison==='incomplete'?'UNKNOWN（历史截断、无效时间或旧记录缺少题目关联）':data.comparison==='insufficient'?'UNKNOWN（任一窗口少于5个明确结果）':'UNKNOWN（未选择有限窗口）'}。难度中位数差：{data.medianChange===null?'UNKNOWN':`${data.medianChange>0?'+':''}${data.medianChange}`}；不判定能力进退。</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {[{name:'本窗',value:data.current},{name:'前窗',value:data.previous}].map(({name,value})=><div key={name} className="rounded-lg border p-3"><h3 className="font-medium">{name}已加载训练样本</h3>{value?<><p>不同题目 {value.problems}，明确结果 {value.known}，自报解出 {value.solved}。</p><p>可见标签题 {value.tagged}，覆盖方向 {value.topics}（多标签可重叠）；有 Rating 的自报解出 {value.rated}，中位数 {value.median??'UNKNOWN'}。</p><p>自报解出 / 明确结果：{ratio(value.completion)}。</p></>:<p>UNKNOWN</p>}</div>)}
    </div>
    <details><summary className="cursor-pointer">知识方向证据变化</summary><div className="mt-3 grid gap-3 md:grid-cols-2">{!data.topics.length&&<p>暂无可比较的可见标签，不判定未训练或薄弱。</p>}{data.topics.map(t=><div key={t.topic} className="rounded-lg border p-3"><h3 className="font-medium">{t.topic}</h3><p>前窗已加载：明确结果 {t.previous?.known??'UNKNOWN'}，自报解出 {t.previous?.solved??'UNKNOWN'}；本窗已加载：明确结果 {t.current.known}，自报解出 {t.current.solved}。</p><p>{t.transition==='more_evidence'?'本窗达到描述门槛，前窗样本不足；不是由弱变强。':t.transition==='less_evidence'?'本窗样本不足；不是能力退步。':t.transition==='unknown'?'窗口不可完整比较，变化 UNKNOWN。':'仅比较证据数量，不作掌握判断。'}</p><EvidenceLinks refs={[...(t.previous?.refs??[]),...t.current.refs]}/></div>)}</div></details>
    <details><summary className="cursor-pointer">相同难度区间的记录表现</summary><div className="mt-3 space-y-2">{!data.bands.length&&<p>Rating 数据不足，UNKNOWN。</p>}{data.bands.map(b=><div key={b.min} className="rounded-lg border p-3"><p>{b.min}–{b.max}，前窗 / 本窗：完成记录 {b.previous?.problems??'UNKNOWN'} / {b.current.problems}；自报解出 {b.previous?.solved??'UNKNOWN'} / {b.current.solved}。</p><p>各窗自报解出 / 各窗明确结果：{b.previous?ratio(b.previous.completion):'UNKNOWN'}；{ratio(b.current.completion)}。不将两个不同分母直接合并。</p></div>)}</div></details>
    <div className="space-y-3"><h3 className="font-semibold">下一步训练建议</h3>{!data.actions.length&&<p>当前没有额外的跨窗建议；可使用上方诊断行动或原推荐。证据不足时不自动升难度。</p>}{data.actions.map(a=><div key={a.topic} className="space-y-2 rounded-lg border p-3"><p>{a.topic}：{a.explanation}</p><p>可信度有限：用户自报和可见 Tags；窗口滑动、同题替换与选题构成均可能影响结果。不证明掌握或推荐有效。</p><EvidenceLinks refs={a.refs}/><Link className="inline-block text-primary underline" href={`/dashboard?focus=${encodeURIComponent(a.topic)}&window=${a.window}`}>按 {a.topic} 成长证据选择下一题</Link></div>)}</div>
    <p className="text-xs text-muted-foreground">专项只临时筛选本轮方向，保留目标难度和原推荐权重；方向会提示可能的算法。官方 OK 与 AI 复盘不进入上述自报分母；没有训练前基线或对照，不能评估推荐造成的能力提升。</p>
  </section>;
}
