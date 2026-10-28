import type {TrainingFeedback,TrainingFeedbackItem} from '@/lib/validation/training-feedback';
export function trainingFeedbackState(r:TrainingFeedbackItem){
  if(r.sessionId && !r.originated)return 'restored' as const;
  if(!r.sessionId)return r.skippedAt ? 'skipped' as const : 'recommended' as const;
  if(r.sessionStatus!=='completed')return 'started' as const;
  return r.outcome==='solved_self_reported' ? 'self_reported' as const : r.outcome==='unsolved' ? 'unsolved' as const : r.outcome==='abandoned' ? 'abandoned' as const : 'ended_unknown' as const;
}
export const feedbackStateNames={recommended:'已生成推荐，尚未选择训练',skipped:'主动跳过本轮推荐',restored:'恢复既有训练（不归因本轮）',started:'已主动进入训练，尚未确认结束',self_reported:'自报已解出（非官方验证）',unsolved:'自报暂未解出',abandoned:'自报放弃本次训练',ended_unknown:'已结束，结果未记录'};
export function trainingFeedbackSummary(rows:TrainingFeedbackItem[]){
  rows=[...new Map(rows.map(r=>[r.id,r])).values()];
  const origins=rows.filter(r=>r.originated);
  const explicit=origins.filter(r=>r.sessionStatus==='completed'&&['solved_self_reported','unsolved','abandoned'].includes(r.outcome??''));
  return {issued:rows.length,chosen:rows.filter(r=>r.sessionId).length,restored:rows.filter(r=>r.sessionId&&!r.originated).length,
    attempts:origins.length,ended:origins.filter(r=>r.sessionStatus==='completed').length,
    solved:origins.filter(r=>r.sessionStatus==='completed'&&r.outcome==='solved_self_reported').length,
    unsolved:origins.filter(r=>r.sessionStatus==='completed'&&r.outcome==='unsolved').length,
    skipped:rows.filter(r=>trainingFeedbackState(r)==='skipped').length,
    // Only own newly created attempts with explicit results form this descriptive denominator.
    completion:new Set(explicit.map(r=>r.problemId)).size>=5
      ? {numerator:explicit.filter(r=>r.outcome==='solved_self_reported').length,denominator:explicit.length}:null};
}

/** Observations in the supplied receipt cohort. No impression, acquisition or causal metric. */
export function recommendationObservation(data: TrainingFeedback) {
  if (!data.available) return null;
  const rows = [...new Map(data.items.map(r=>[r.id,r])).values()];
  // Recovered associations can repeat a session; only its original creator can own an outcome.
  const origins = [...new Map(rows.filter(r=>r.originated && r.sessionId).map(r=>[r.sessionId!,r])).values()];
  const ended = origins.filter(r=>r.sessionStatus==='completed');
  const explicit = ended.filter(r=>['solved_self_reported','unsolved','abandoned'].includes(r.outcome??''));
  const official = new Map<string,TrainingFeedbackItem['official']>();
  const rank = {disabled:0,not_synced:1,not_observed:2,observed_ok:3};
  for(const r of origins) if(!official.has(r.problemId) || rank[r.official]>rank[official.get(r.problemId)!]) official.set(r.problemId,r.official);
  const checked = [...official.values()].filter(s=>s==='observed_ok'||s==='not_observed').length;
  const solved = explicit.filter(r=>r.outcome==='solved_self_reported').length;
  return { asOf:data.asOf, loaded:rows.length, total:data.total, truncated:data.total>rows.length,
    impressions:null, untrackedTraining:null, officialAfterRecommendation:null,
    selected:rows.filter(r=>r.sessionId).length,
    restored:rows.filter(r=>r.sessionId&&!r.originated).length,
    unselected:rows.filter(r=>!r.sessionId&&!r.skippedAt).length,
    skipped:rows.filter(r=>!r.sessionId&&r.skippedAt).length,
    skipEvents:rows.filter(r=>r.skippedAt).length,
    started:origins.length, ended:ended.length, solved,
    unsolved:explicit.filter(r=>r.outcome==='unsolved').length,
    abandoned:explicit.filter(r=>r.outcome==='abandoned').length,
    active:origins.length-ended.length, unknownEnded:ended.length-explicit.length,
    awaitingResult:origins.length-explicit.length,
    completion:new Set(explicit.map(r=>r.problemId)).size>=5 ? {numerator:solved,denominator:explicit.length}:null,
    official:{checkedProblems:checked,unavailableProblems:official.size-checked,
      observedOK:checked ? [...official.values()].filter(s=>s==='observed_ok').length : null} };
}
