import {render,screen,waitFor,fireEvent} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
import {TrainingFeedbackPanel} from '@/components/learning/training-feedback';
import {trial} from '../fixtures/training-feedback';
import {skillEvidence,skillNow,skillId} from '../fixtures/skill-intelligence';
import {skillIntelligence} from '@/features/learning/intelligence';
const request=vi.hoisted(()=>vi.fn());vi.mock('@/lib/api-client',()=>({requestJson:request}));
beforeEach(()=>request.mockReset());
it('absent infrastructure is not displayed as zero completed recommendations',async()=>{
  request.mockResolvedValue({available:false,items:[],total:0,asOf:'now'});render(<TrainingFeedbackPanel/>);await screen.findByText(/推荐来源追踪尚未配置/);expect(screen.queryByText(/本轮新建训练/)).not.toBeInTheDocument();
});
it('makes explicit denominators, source snapshot/current comparison and official limitations visible',async()=>{
  const row=trial(1,{sessionId:skillId(2),chosenAt:'now',originated:true,sessionStatus:'completed',outcome:'unsolved',official:'observed_ok',focus:{topic:'graphs',window:'30'},baseline:{samples:5,concerns:3,solved:4}});
  request.mockResolvedValue({available:true,items:[row],total:1,asOf:'now'});render(<TrainingFeedbackPanel window="30" current={skillIntelligence(skillEvidence(6),'30',skillNow)}/>);
  await screen.findByText(/自报暂未解出/);expect(screen.getByText('新训练明确结果内的自报解出比例：UNKNOWN（至少5道不同题目有明确结果）。')).toBeInTheDocument();expect(screen.getByText(/窗口滑动或同题最新记录替换/)).toBeInTheDocument();expect(screen.getByText(/账号归属\/独立性及该训练源码一致性仍未知/)).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'恢复或查看这次训练'})).toHaveAttribute('href','/practice/'+skillId(2));
});
it('old unlinked training stays usable without inferred recommendation attribution',async()=>{
  request.mockResolvedValue({available:true,items:[],total:0,asOf:'now'});render(<TrainingFeedbackPanel sessionId={skillId(3)}/>);await screen.findByText(/旧训练不强行归因/);expect(screen.getByRole('link',{name:/返回能力画像/})).toHaveAttribute('href','/analytics');
});
it('read errors retain unknown status and permit explicit retry',async()=>{
  request.mockRejectedValueOnce(new Error('private')).mockResolvedValueOnce({available:true,items:[],total:0,asOf:'now'});render(<TrainingFeedbackPanel/>);await screen.findByText(/不会据此判断失败或完成/);
  fireEvent.click(screen.getByRole('button',{name:'重试推荐反馈'}));await waitFor(()=>expect(screen.getByText(/本窗口暂无已记录的推荐来源/)).toBeInTheDocument());expect(screen.queryByText('private')).not.toBeInTheDocument();
});
it('return links honor the existing unsaved-draft navigation guard',async()=>{
  request.mockResolvedValue({available:true,items:[],total:0,asOf:'now'});const guard=vi.fn((e:Event)=>e.preventDefault());window.addEventListener('algopilot-before-navigate',guard);
  try{render(<TrainingFeedbackPanel sessionId={skillId(3)}/>);const link=await screen.findByRole('link',{name:/返回能力画像/});expect(fireEvent.click(link)).toBe(false);expect(guard).toHaveBeenCalledTimes(1);}finally{window.removeEventListener('algopilot-before-navigate',guard);}
});
