import type {TrainingFeedbackItem} from '@/lib/validation/training-feedback';
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
