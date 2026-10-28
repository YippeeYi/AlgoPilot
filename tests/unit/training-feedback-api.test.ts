import {beforeEach,it,expect,vi} from 'vitest';
import {ApiError} from '@/server/http';
import {trial} from '../fixtures/training-feedback';
const auth=vi.hoisted(()=>vi.fn());
const repo=vi.hoisted(()=>({read:vi.fn(),choose:vi.fn()}));
vi.mock('@/server/auth',()=>({requireContext:auth}));
vi.mock('@/server/learning/training-feedback',()=>({trainingFeedbackRepository:()=>repo}));
import {GET,POST} from '@/app/api/v1/learning/training-feedback/route';
const get=(q='')=>new Request('http://localhost/api/v1/learning/training-feedback'+q);
const post=(body:unknown,origin?:string)=>new Request('http://localhost/api/v1/learning/training-feedback',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();auth.mockResolvedValue({client:{},user:{id:trial().id}});repo.read.mockResolvedValue({available:true,items:[trial()],total:1,asOf:'now'});repo.choose.mockResolvedValue({sessionId:null,resumed:false});});
it('authenticates all operations before reading or writing private history',async()=>{
  auth.mockRejectedValue(new ApiError(401,'UNAUTHENTICATED','login'));expect((await GET(get())).status).toBe(401);expect((await POST(post({id:trial().id,action:'skip'}))).status).toBe(401);expect(repo.read).not.toHaveBeenCalled();expect(repo.choose).not.toHaveBeenCalled();
});
it('whitelists queries/actions and rejects owner, result, official verdict or source mass assignment',async()=>{
  for(const q of ['?userId=foreign','?window=365'])expect((await GET(get(q))).status).toBe(422);
  for(const extra of [{userId:trial().id},{outcome:'solved_self_reported'},{official:'observed_ok'},{baseline:{samples:500}}])expect((await POST(post({id:trial().id,action:'start',...extra}))).status).toBe(422);
  expect((await POST(post({id:trial().id,action:'finish'}))).status).toBe(422);expect((await POST(post({id:trial().id,action:'skip'},'https://foreign.invalid'))).status).toBe(403);expect(repo.choose).not.toHaveBeenCalled();
});
it('uses private no-store responses and validates owned session lookup without external sync',async()=>{
  const r=await GET(get('?window=7&sessionId='+trial().id));expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('private, no-store');expect(repo.read).toHaveBeenCalledWith('7',trial().id);
  expect((await POST(post({id:trial().id,action:'skip'}))).status).toBe(200);expect(repo.choose).toHaveBeenCalledWith(trial().id,'skip');
});
it('safe errors do not reveal storage details or fabricate an outcome',async()=>{
  repo.read.mockRejectedValue(new Error('PRIVATE_KEY_MATERIAL'));const r=await GET(get());expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain('PRIVATE_KEY_MATERIAL');
  repo.choose.mockRejectedValue(new ApiError(404,'NOT_FOUND','not found'));expect((await POST(post({id:trial().id,action:'start'}))).status).toBe(404);
});
