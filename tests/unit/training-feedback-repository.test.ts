import {beforeEach,it,expect,vi} from 'vitest';
import {ApiError} from '@/server/http';
import {skillId} from '../fixtures/skill-intelligence';
const secret=vi.hoisted(()=>vi.fn());
vi.mock('@/server/codeforces/repository',()=>({cfSigningSecret:secret}));
import {trainingFeedbackRepository} from '@/server/learning/training-feedback';
beforeEach(()=>{secret.mockReset().mockReturnValue('ce'.repeat(32));});
function client(data:unknown=null,error:unknown=null){return {rpc:vi.fn().mockResolvedValue({data,error})} as unknown as Parameters<typeof trainingFeedbackRepository>[0];}
it('known absent migration or signing configuration keeps original recommendations available, never fake tracked success',async()=>{
  for(const code of ['PGRST202','42883','42501'])expect(await trainingFeedbackRepository(client(null,{code}),skillId(1)).record({})).toEqual({available:false,items:[]});
  secret.mockImplementation(()=>{throw new ApiError(503,'CF_SYNC_NOT_CONFIGURED','missing');});const c=client();expect(await trainingFeedbackRepository(c,skillId(1)).record({})).toEqual({available:false,items:[]});expect(c.rpc).not.toHaveBeenCalled();
});
it('unknown write results remain failures so a request is not falsely declared untracked',async()=>{
  await expect(trainingFeedbackRepository(client(null,{code:'503'}),skillId(1)).record({})).rejects.toMatchObject({status:503});
  await expect(trainingFeedbackRepository(client(null,{code:'PT409'}),skillId(1)).record({})).rejects.toMatchObject({status:409});
});
it('attests snapshot scope server-side and returns only public receipt IDs, never signatures',async()=>{
  const c=client({available:true,items:[{id:skillId(2),problemId:skillId(3)}]});const r=await trainingFeedbackRepository(c,skillId(1)).record({runId:skillId(4)});
  const [name,args]=(c.rpc as ReturnType<typeof vi.fn>).mock.calls[0]!;expect(name).toBe('record_recommendation_run');const payload=JSON.parse(args.p_payload);
  expect(payload).toMatchObject({operation:'recommendation_record',userId:skillId(1),runId:skillId(4)});expect(args.p_signature).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(r)).not.toContain(args.p_signature);
});
it('reads unavailable independently of legacy sessions and does not turn an unsupported choice into a success',async()=>{
  const r=trainingFeedbackRepository(client(null,{code:'PGRST202'}),skillId(1));expect(await r.read('30')).toMatchObject({available:false,items:[]});await expect(r.choose(skillId(2),'start')).rejects.toMatchObject({code:'TRACKING_UNAVAILABLE'});
});
it('rejects in-flight evidence after official consent revocation instead of releasing old status',async()=>{
  const c=client();(c.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({data:{available:true,items:[],total:0,asOf:'now',revision:2,officialRevision:8},error:null}).mockResolvedValueOnce({data:null,error:{code:'PT409'}});
  await expect(trainingFeedbackRepository(c,skillId(1)).read('30')).rejects.toMatchObject({code:'LEARNING_EVIDENCE_CHANGED',status:409});
  expect(c.rpc).toHaveBeenLastCalledWith('learning_evidence_guard',{p_revision:2,p_official_revision:8});
});
it('checks current evidence before returning safe DTO and does not expose internal read stamps',async()=>{
  const c=client();(c.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({data:{available:true,items:[],total:0,asOf:'now',revision:2,officialRevision:8},error:null}).mockResolvedValueOnce({data:true,error:null});
  const result=await trainingFeedbackRepository(c,skillId(1)).read('30');expect(result.available).toBe(true);expect(result).not.toHaveProperty('officialRevision');
});
