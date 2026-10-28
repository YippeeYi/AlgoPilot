"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {requestJson} from '@/lib/api-client';
import type {TrainingFeedback} from '@/lib/validation/training-feedback';
import type {SkillWindow} from '@/lib/validation/learning';
import type {SkillIntelligence} from '@/features/learning/intelligence';
import {trainingFeedbackState,trainingFeedbackSummary,feedbackStateNames} from '@/features/learning/training-feedback';
function guardNavigation(event:React.MouseEvent<HTMLAnchorElement>){if(!globalThis.window.dispatchEvent(new Event('algopilot-before-navigate',{cancelable:true})))event.preventDefault();}
const outcomeNames={not_recorded:'未记录结果',solved_self_reported:'已解出（用户自报）',unsolved:'暂未解出（用户自报）',abandoned:'放弃本次训练（用户自报）'};
export function TrainingFeedbackPanel({window='all',sessionId,current}:{window?:SkillWindow;sessionId?:string;current?:SkillIntelligence}){
  const [data,setData]=useState<TrainingFeedback|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{let active=true;requestJson<TrainingFeedback>(`/api/v1/learning/training-feedback?window=${window}${sessionId?`&sessionId=${sessionId}`:''}`).then(r=>{if(active)setData(r);}).catch(()=>{if(active)setError('推荐来源与训练反馈暂时无法读取；不会据此判断失败或完成。');});return()=>{active=false;};},[window,sessionId,retry]);
  if(error)return <section className="rounded-lg border p-4 text-sm"><p>{error}</p><button className="text-primary underline" onClick={()=>{setData(null);setError('');setRetry(n=>n+1);}}>重试推荐反馈</button></section>;
  if(!data)return <p className="text-sm" role="status">正在读取推荐训练反馈…</p>;
  if(!data.available)return <p className="text-sm text-muted-foreground">推荐来源追踪尚未配置或迁移未就绪；原训练和画像仍可用，当前不能统计来源。</p>;
  const summary=trainingFeedbackSummary(data.items);
  return <section className="space-y-3 rounded-lg border p-4 text-sm" aria-label="推荐后的训练证据">
    <h2 className="font-semibold">{sessionId?'本次训练的推荐来源':'推荐后的训练反馈'}</h2>
    {!data.items.length ? <p>{sessionId?'没有可验证的推荐关联（旧训练不强行归因），本训练仍按原规则进入画像。':'本窗口暂无已记录的推荐来源；不能据此认定没有训练。'}</p> : <>
      {!sessionId && <><p>本窗口生成推荐条目 {summary.issued}，明确选择 {summary.chosen}，其中恢复旧训练 {summary.restored}；本轮新建训练 {summary.attempts}，已结束 {summary.ended}，自报解出 {summary.solved}，自报未解 {summary.unsolved}，当前跳过 {summary.skipped}。</p><p>新训练明确结果内的自报解出比例：{summary.completion?`${summary.completion.numerator}/${summary.completion.denominator}`:'UNKNOWN（至少5道不同题目有明确结果）'}。</p></>}
      <p className="text-xs text-muted-foreground">窗口按推荐生成时间，统计当前状态；生成不等于展示或点击，选择不等于做题或完成。恢复旧训练不计本轮新尝试/成功，官方 OK 单列；不能证明推荐造成成长。</p>
      {data.total>data.items.length && <p>仅统计本窗口最近 {data.items.length}/{data.total} 条推荐记录，不代表全部历史。</p>}
      {data.items.slice(0,8).map(r=>{const topic=r.focus&&current?.window===r.focus.window?current.topics.find(t=>t.topic===r.focus!.topic):null;return <div key={r.id} className="space-y-1 rounded-lg border p-3">
        <p className="font-medium">{r.contestId}{r.index} · {feedbackStateNames[trainingFeedbackState(r)]}</p>
        <p>{r.focus?`专项 ${r.focus.topic}（${r.focus.window==='all'?'全部已加载':r.focus.window+'天'}）`:'普通个性化推荐'} · 生成于 {r.issuedAt}</p>
        {r.endedAt && <p>训练记录结束于 {r.endedAt}；结果：{r.outcome?outcomeNames[r.outcome]:'UNKNOWN'}。结束时间不是解题耗时。</p>}
        <p>{r.official==='observed_ok'?'关联公开账号有已观察官方 OK；账号归属/独立性及该训练源码一致性仍未知。':r.official==='disabled'?'官方证据未启用。':r.official==='not_synced'?'官方证据尚未成功同步。':'关联账号暂未观察到 OK，不能当作失败。'}{r.officialSyncedAt && ` 最近成功批次 ${r.officialSyncedAt}`}</p>
        {r.baseline && <p>推荐时快照：{r.baseline.samples} 个明确结果、困难信号并集 {r.baseline.concerns}、自报解出 {r.baseline.solved}。{topic?`当前同类窗口：${topic.knownOutcomes}、${topic.concernSamples}、${topic.selfReportedSolved}。变化也可能来自窗口滑动或同题最新记录替换，不是因果结论。`:'切换到该推荐的时间窗口，可与当前诊断比较。'}</p>}
        {r.sessionId && <Link className="text-primary underline" onClick={guardNavigation} href={`/practice/${r.sessionId}`}>恢复或查看这次训练</Link>}
      </div>;})}
      {data.items.length>8 && <p>显示最近8条来源，汇总基于已读取的最多200条；其余训练保留在训练历史。</p>}
    </>}
    <Link className="inline-block text-primary underline" onClick={guardNavigation} href={sessionId?'/analytics':'/dashboard'}>{sessionId?'返回能力画像，查看最新训练证据':'依据最新证据开始下一轮推荐'}</Link>
  </section>;
}
