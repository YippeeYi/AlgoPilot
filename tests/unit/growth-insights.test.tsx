import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi,beforeEach} from 'vitest';
import {GrowthInsights} from '@/components/learning/growth-insights';
import {TrainingFeedbackPanel} from '@/components/learning/training-feedback';
import {skillIntelligence} from '@/features/learning/intelligence';
import {skillEvidence,skillNow,skillId} from '../fixtures/skill-intelligence';
import {trial} from '../fixtures/training-feedback';
const request=vi.hoisted(()=>vi.fn());vi.mock('@/lib/api-client',()=>({requestJson:request}));
beforeEach(()=>request.mockReset());
it('empty cohorts have unknown comparisons rather than a zero skill score',()=>{
  render(<GrowthInsights data={skillIntelligence(skillEvidence(),'30',skillNow).growth}/>);
  expect(screen.getByRole('status')).toHaveTextContent('UNKNOWN');expect(screen.queryByRole('link',{name:/成长证据选择/})).not.toBeInTheDocument();
  expect(screen.getByText(/没有训练前基线或对照/)).toBeInTheDocument();
});
it('new topic evidence links to the original explicit focus and explains counts, limits and unchanged goals',()=>{
  const e=skillEvidence(5);e.sessions=e.sessions.map(s=>({...s,maxHint:0}));
  render(<GrowthInsights data={skillIntelligence(e,'7',skillNow).growth}/>);
  expect(screen.getByRole('link',{name:'按 graphs 成长证据选择下一题'})).toHaveAttribute('href','/dashboard?focus=graphs&window=7');
  expect(screen.getByText(/已加载前窗 0、本窗 5 道明确结果/)).toBeInTheDocument();expect(screen.getByText(/保留目标难度和原推荐权重/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('知识方向证据变化'));expect(screen.getByText(/不是由弱变强/)).toBeVisible();
});
it('truncated records suppress derived growth actions and explicitly describe uncertainty',()=>{
  const e=skillEvidence(5);e.totalSessions=1000;e.sessions=e.sessions.map(s=>({...s,maxHint:0}));render(<GrowthInsights data={skillIntelligence(e,'30',skillNow).growth}/>);
  expect(screen.getByRole('status')).toHaveTextContent('历史截断');expect(screen.queryByRole('link',{name:/成长证据选择/})).not.toBeInTheDocument();
});
it('recommendation observation labels absent exposure, post-recommendation official evidence and all denominators',async()=>{
  request.mockResolvedValue({available:true,total:250,asOf:'2026-10-28T00:00:00Z',items:[trial(1,{sessionId:skillId(2),originated:true,sessionStatus:'completed',outcome:'unsolved',official:'observed_ok'})]});
  render(<TrainingFeedbackPanel window="30"/>);await screen.findByRole('heading',{name:'推荐结果观测（不评估因果效果）'});
  expect(screen.getByText(/真实展示数量：UNKNOWN/)).toBeInTheDocument();expect(screen.getByText(/推荐后官方确认完成数：UNKNOWN/)).toBeInTheDocument();
  expect(screen.getByText(/可用已同步观察覆盖 1 道不同题/)).toBeInTheDocument();expect(screen.getByText(/仅统计本窗口最近 1\/250/)).toBeInTheDocument();
  expect(screen.getByText(/至少覆盖5道不同题/)).toBeInTheDocument();
});
