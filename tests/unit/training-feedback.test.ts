import {describe,it,expect} from 'vitest';
import {trainingFeedbackState,trainingFeedbackSummary} from '@/features/learning/training-feedback';
import {trial} from '../fixtures/training-feedback';
import {skillId} from '../fixtures/skill-intelligence';
import type {TrainingFeedbackItem} from '@/lib/validation/training-feedback';
describe('recommendation state is not a synthetic success funnel',()=>{
  it.each([
    [{},'recommended'],[{skippedAt:'now'},'skipped'],[{sessionId:skillId(20),chosenAt:'now',sessionStatus:'paused'},'restored'],
    [{sessionId:skillId(20),chosenAt:'now',sessionStatus:'paused',originated:true},'started'],
    ...(['solved_self_reported','unsolved','abandoned','not_recorded'] as const).map((outcome,i)=>[{sessionId:skillId(20),chosenAt:'now',sessionStatus:'completed',originated:true,outcome},['self_reported','unsolved','abandoned','ended_unknown'][i]]),
  ] as [Partial<TrainingFeedbackItem>,string][] )('derives status for %j', (changes,state)=>expect(trainingFeedbackState(trial(1,changes))).toBe(state));
  it('official OK alone never creates a local attempt or self-reported outcome',()=>{
    const row=trial(1,{official:'observed_ok'});expect(trainingFeedbackState(row)).toBe('recommended');expect(trainingFeedbackSummary([row])).toMatchObject({attempts:0,solved:0,completion:null});
  });
  it('restoring an old solved session never claims this recommendation caused its success',()=>{
    const row=trial(1,{sessionId:skillId(20),sessionStatus:'completed',outcome:'solved_self_reported',chosenAt:'now'});
    expect(trainingFeedbackSummary([row])).toMatchObject({chosen:1,restored:1,attempts:0,solved:0,ended:0});
  });
  it('deduplicates receipt IDs, requires five different problems and keeps only explicit-result attempts in denominator',()=>{
    const rows=Array.from({length:5},(_,i)=>trial(i+1,{sessionId:skillId(30+i),originated:true,sessionStatus:'completed',outcome:i===0?'unsolved':'solved_self_reported',chosenAt:'now'}));
    const summary=trainingFeedbackSummary([...rows,rows[0]!,trial(9,{sessionId:skillId(90),originated:true,sessionStatus:'completed',outcome:'not_recorded'}),trial(10,{skippedAt:'now'})]);
    expect(summary).toMatchObject({issued:7,attempts:6,solved:4,completion:{numerator:4,denominator:5},skipped:1});
    expect(trainingFeedbackSummary(rows.map(r=>({...r,problemId:rows[0]!.problemId}))).completion).toBeNull();
    expect(trainingFeedbackSummary([...rows].reverse())).toEqual(trainingFeedbackSummary(rows));
  });
  it('cold start is unknown rather than zero ability',()=>expect(trainingFeedbackSummary([])).toMatchObject({attempts:0,completion:null}));
});
