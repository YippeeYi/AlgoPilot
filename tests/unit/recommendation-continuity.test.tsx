import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {Recommendations} from '@/components/learning/recommendations';
import {ClientError} from '@/lib/api-client';
import {recommend,type RecommendationResult} from '@/features/learning/engine';
import type {LearningPreferences} from '@/lib/validation/learning';
import {skillEvidence,skillId} from '../fixtures/skill-intelligence';
const {request,push}=vi.hoisted(()=>({request:vi.fn(),push:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push})}));
vi.mock('next/link',()=>({default:(props:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}/>}));
vi.mock('@/lib/api-client',async original=>({...await original<typeof import('@/lib/api-client')>(),requestJson:request}));
let saved:LearningPreferences,revision:number;
const rec=vi.fn<()=>Promise<RecommendationResult>>(),write=vi.fn(),learning=vi.fn();
function result():RecommendationResult{return {...recommend({...skillEvidence(),preferences:saved,revision},[{id:skillId(900),contestId:60001,index:'A',name:'SYNTHETIC candidate',rating:1400,tags:['math'],solvedCount:null,inPlan:false,practiced:false}]),syncedAt:null,stale:false,notice:null,candidateCount:1};}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {resolve,promise};}
const min=()=>screen.getByLabelText('愿意挑战的最低难度');
const submit=()=>screen.getByRole('button',{name:'保存目标并推荐'});
const refresh=()=>screen.getByRole('button',{name:'重新推荐'});
const card=()=>screen.queryByRole('heading',{name:'60001A · SYNTHETIC candidate'});
async function mount(){const view=render(<Recommendations/>);await waitFor(()=>expect(submit()).toBeEnabled());return view;}
beforeEach(()=>{
 saved={min:1200,max:1800,themes:[],goal:'balanced',repeat:false,reviewEvidence:true};revision=0;push.mockReset();request.mockReset();
 rec.mockReset().mockImplementation(async()=>result());learning.mockReset().mockImplementation(async()=>({preferences:saved,revision}));
 write.mockReset().mockImplementation(async (body:{preferences:LearningPreferences})=>{saved=body.preferences;revision++;return {saved:true};});
 request.mockImplementation(async(path:string,options?:{body?:unknown})=>{
  if(path==='/api/v1/recommendations')return rec();
  if(path==='/api/v1/learning')return learning();
  if(path==='/api/v1/learning/preferences')return write(options!.body);
  if(path==='/api/v1/plans')return {items:[]};
  if(path==='/api/v1/sessions')return {session:{id:skillId(901)}};
  throw Error('Unexpected synthetic operation');
 });
});
it('locks every goal field until a verified snapshot loads, rather than exposing editable placeholders',async()=>{
 const held=deferred<RecommendationResult>();rec.mockReturnValueOnce(held.promise);render(<Recommendations/>);
 expect(min()).toBeDisabled();expect(screen.getByLabelText(/授权从已生成/)).toBeDisabled();expect(submit()).toBeDisabled();
 await act(async()=>held.resolve(result()));await waitFor(()=>expect(submit()).toBeEnabled());expect(min()).toHaveValue(1200);
});
it('locks submitted goals and synchronously coalesces repeated save intent before React rerenders',async()=>{
 await mount();fireEvent.change(min(),{target:{value:'1300'}});const held=deferred<{saved:boolean}>();write.mockReturnValueOnce(held.promise);
 act(()=>{fireEvent.submit(submit().closest('form')!);fireEvent.submit(submit().closest('form')!);});
 expect(write).toHaveBeenCalledOnce();expect(min()).toBeDisabled();expect(screen.getByLabelText('训练目标')).toBeDisabled();expect(write.mock.calls[0]![0].preferences.min).toBe(1300);
 saved={...saved,min:1300};await act(async()=>held.resolve({saved:true}));await waitFor(()=>expect(min()).toBeEnabled());expect(min()).toHaveValue(1300);
});
it('keeps acknowledged-save feedback when candidate refresh fails; read recovery never saves again',async()=>{
 await mount();rec.mockRejectedValueOnce(new ClientError(503,'candidate unavailable'));fireEvent.change(min(),{target:{value:'1300'}});fireEvent.click(submit());
 await screen.findByText('candidate unavailable');expect(card()).not.toBeInTheDocument();expect(screen.getByText(/目标已保存.*重新推荐/)).toBeVisible();expect(saved.min).toBe(1300);
 fireEvent.click(refresh());await waitFor(()=>expect(card()).toBeVisible());expect(write).toHaveBeenCalledOnce();expect(min()).toHaveValue(1300);
});
it('does not conflate a successful write with a failed subsequent revision read',async()=>{
 await mount();learning.mockRejectedValueOnce(new ClientError(503,'revision read failed'));fireEvent.click(submit());await screen.findByText('revision read failed');
 expect(card()).toBeNull();expect(screen.getByText(/目标已保存.*重新推荐/)).toBeVisible();fireEvent.click(refresh());await waitFor(()=>expect(card()).toBeVisible());expect(write).toHaveBeenCalledOnce();
});
it('an unknown write keeps the identical ID/body, preserves inputs and never claims acknowledgement',async()=>{
 await mount();write.mockRejectedValueOnce(new TypeError('synthetic lost acknowledgement'));fireEvent.change(min(),{target:{value:'1300'}});fireEvent.click(submit());await screen.findByText('synthetic lost acknowledgement');
 expect(card()).toBeNull();expect(screen.queryByText(/目标已保存/)).toBeNull();expect(min()).toHaveValue(1300);expect(write).toHaveBeenCalledOnce();
 fireEvent.click(submit());await waitFor(()=>expect(submit()).toBeEnabled());expect(write.mock.calls[1]![0]).toEqual(write.mock.calls[0]![0]);
});
it('a definitive CAS conflict refreshes revision and the next explicit save gets a new ID',async()=>{
 await mount();write.mockImplementationOnce(async()=>{revision=4;throw new ClientError(409,'CAS conflict');});fireEvent.click(submit());await screen.findByText('CAS conflict');expect(card()).toBeNull();
 fireEvent.click(submit());await waitFor(()=>expect(write).toHaveBeenCalledTimes(2));expect(write.mock.calls[1]![0].revision).toBe(4);expect(write.mock.calls[1]![0].requestId).not.toBe(write.mock.calls[0]![0].requestId);await waitFor(()=>expect(submit()).toBeEnabled());
});
it.each([401,403,409])('a %i refresh refusal clears old actionable evidence and permits only explicit recovery',async status=>{
 await mount();expect(card()).toBeVisible();rec.mockRejectedValueOnce(new ClientError(status,'scope refused','LEARNING_EVIDENCE_CHANGED'));fireEvent.click(refresh());await screen.findByText('scope refused');
 expect(card()).toBeNull();if(status===409)expect(min()).toBeEnabled();else expect(min()).toBeDisabled();
 fireEvent.click(refresh());await waitFor(()=>expect(card()).toBeVisible());expect(write).not.toHaveBeenCalled();
});
it('an authenticated recovery after auth failure rehydrates goals from the current server snapshot',async()=>{
 await mount();rec.mockRejectedValueOnce(new ClientError(401,'expired'));fireEvent.click(refresh());await screen.findByText('expired');expect(min()).toBeDisabled();
 saved={...saved,min:1300,reviewEvidence:false};fireEvent.click(refresh());await waitFor(()=>expect(card()).toBeVisible());expect(min()).toBeEnabled();expect(min()).toHaveValue(1300);expect(screen.getByLabelText(/授权从已生成/)).not.toBeChecked();expect(write).not.toHaveBeenCalled();
});
it('a failed initial recommendation can still load goals from learning and explicitly save',async()=>{
 rec.mockRejectedValueOnce(new ClientError(503,'initial pool failed'));await mount();expect(min()).toHaveValue(1200);expect(card()).toBeNull();fireEvent.click(submit());await waitFor(()=>expect(card()).toBeVisible());expect(write).toHaveBeenCalledOnce();
});
it('when both initial reads fail, recovery verifies server goals before enabling edits',async()=>{
 rec.mockRejectedValueOnce(new ClientError(503,'read failed'));learning.mockRejectedValueOnce(new ClientError(503,'read failed'));render(<Recommendations/>);await screen.findByText('read failed');expect(min()).toBeDisabled();expect(submit()).toBeDisabled();
 fireEvent.click(refresh());await waitFor(()=>expect(submit()).toBeEnabled());expect(min()).toHaveValue(1200);
});
it('an unsaved target remains visibly distinct from the saved recommendation and refresh does not write it',async()=>{
 await mount();fireEvent.change(min(),{target:{value:'1300'}});expect(screen.getByText(/当前目标修改尚未保存/)).toBeVisible();fireEvent.click(refresh());await waitFor(()=>expect(card()).toBeVisible());expect(min()).toHaveValue(1300);expect(saved.min).toBe(1200);expect(write).not.toHaveBeenCalled();
});
it('focus refresh preserves its explicit scope without changing saved themes or weights',async()=>{
 render(<Recommendations focus={{topic:'graphs',window:'7'}}/>);await waitFor(()=>expect(submit()).toBeEnabled());fireEvent.click(refresh());await waitFor(()=>expect(refresh()).toBeEnabled());
 expect(request.mock.calls.filter(c=>c[0]==='/api/v1/recommendations').every(c=>c[1].body.focus.topic==='graphs'&&c[1].body.focus.window==='7')).toBe(true);expect(saved.themes).toEqual([]);expect(write).not.toHaveBeenCalled();
});
it('a permission refusal while starting cannot navigate or leave stale candidates active',async()=>{
 await mount();request.mockImplementationOnce(async()=>{throw new ClientError(409,'start refused');});fireEvent.click(screen.getByRole('button',{name:'进入思维教练'}));await screen.findByText('start refused');expect(card()).toBeNull();expect(push).not.toHaveBeenCalled();
});
