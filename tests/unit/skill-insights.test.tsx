import { render,screen,fireEvent,waitFor,act } from "@testing-library/react";
import { beforeEach,expect,it,vi } from "vitest";
import { SkillInsights } from "@/components/learning/skill-insights";
import { AbilityProfile } from "@/components/learning/ability-profile";
import { skillIntelligence } from "@/features/learning/intelligence";
import { abilityProfile } from "@/features/learning/engine";
import { skillEvidence,skillNow } from "../fixtures/skill-intelligence";
const request=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/api-client',()=>({requestJson:request}));
const result=(count=0,window:'7'|'30'|'90'|'all'='30')=>({profile:abilityProfile(skillEvidence(count)),intelligence:skillIntelligence(skillEvidence(count),window,skillNow)});
beforeEach(()=>request.mockReset());
it('empty and sparse evidence display UNKNOWN with no diagnosis action',()=>{
  render(<SkillInsights data={result(1).intelligence}/>);expect(screen.getAllByText(/UNKNOWN/).length).toBeGreaterThan(0);
  expect(screen.queryByRole('link',{name:/诊断补充训练/})).not.toBeInTheDocument();expect(screen.getByText(/不等于从未训练或能力差/)).toBeInTheDocument();
});
it('diagnostic has concrete numerator, traceable evidence and an explicit opt-in recommendation link',()=>{
  render(<SkillInsights data={result(5).intelligence}/>);
  expect(screen.getByRole('link',{name:'按 graphs 诊断补充训练'})).toHaveAttribute('href','/dashboard?focus=graphs&window=30');
  expect(screen.getByText(/5 道完成训练/)).toBeInTheDocument();expect(screen.getByText(/仅临时筛选本轮主题/)).toBeInTheDocument();
});
it('prioritizes actionable evidence before sparse incidental tags',()=>{
  const e=skillEvidence(5);e.sessions[0]!.tags=['graphs','implementation'];
  render(<SkillInsights data={skillIntelligence(e,'30',skillNow)}/>);
  expect(screen.getAllByRole('heading',{level:3})[0]).toHaveTextContent('graphs · 可补充训练验证');
});
it('window changes ignore late old responses and refresh fetches newly completed evidence',async()=>{
  let finish!: (v:ReturnType<typeof result>)=>void;request.mockReturnValueOnce(new Promise(r=>{finish=r;})).mockResolvedValueOnce(result(5,'7')).mockResolvedValueOnce(result(6,'7'));
  render(<AbilityProfile/>);fireEvent.change(screen.getByLabelText('诊断时间窗口'),{target:{value:'7'}});
  await screen.findByRole('link',{name:'按 graphs 诊断补充训练'});
  await act(async()=>finish(result(0)));expect(screen.getByRole('link',{name:'按 graphs 诊断补充训练'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'刷新训练证据'}));await waitFor(()=>expect(screen.getByText(/6 道完成训练/)).toBeInTheDocument());
  expect(request.mock.calls.map(c=>c[0])).toEqual(['/api/v1/learning?window=30','/api/v1/learning?window=7','/api/v1/learning?window=7']);
});
it('failed read shows no fabricated diagnosis and allows explicit retry',async()=>{
  request.mockRejectedValueOnce(new Error('读取失败')).mockResolvedValueOnce(result(0));render(<AbilityProfile/>);
  await screen.findByRole('alert');expect(screen.queryByText('本窗口的训练诊断与行动')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'刷新训练证据'}));await screen.findByRole('heading',{name:'本窗口的训练诊断与行动'});
});
