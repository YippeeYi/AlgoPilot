import {act,cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {Workspace} from '@/components/practice/workspace';
import {StrictMode,useEffect} from 'react';
import type {TrainingSession, Problem} from '@/lib/validation/m1';

vi.mock('next/link', () => ({default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}/> }));
vi.mock('next/dynamic', () => ({default: () => ({content}: {content:string}) => <p>{content}</p>}));
const id='31000000-0000-4000-8000-000000000001', now='2026-10-28T00:00:00Z';
const initial:TrainingSession={id,user_id:'31000000-0000-4000-8000-000000000002',problem_id:'31000000-0000-4000-8000-000000000003',statement_snapshot:'原合成题面',mode:'practice',phase:'thinking',status:'paused',started_at:now,created_at:now,updated_at:now,active_seconds:0,resumed_at:null,ended_at:null,state_revision:1,code_draft:'',code_revision:0,thought_draft:'原思路',thought_revision:0,outcome:null};
const problem:Problem={id:initial.problem_id!,platform:'codeforces',title:'SYNTHETIC continuity',statement:null,rating:1200,contest_id:1234,problem_index:'A',canonical_url:'https://codeforces.com/problemset/problem/1234/A',created_at:now};
const fetcher=vi.fn<typeof fetch>(),context=vi.fn<typeof fetch>();
let session:TrainingSession;
const calls: {path:string;body:Record<string,unknown>}[]=[];
const body=(init?:RequestInit)=>JSON.parse(String(init?.body??'{}')) as Record<string,unknown>;
const contextField=()=>screen.getByLabelText('补充当前题目的题面、约束与样例');
const thoughtField=()=>screen.getByLabelText('当前思路',{exact:true});
const finish=()=>{fireEvent.click(screen.getByRole('button',{name:'结束训练'}));fireEvent.click(screen.getByRole('button',{name:'确认完成'}));};
async function mount(p:Problem|null=problem){render(<Workspace initialSession={session} problem={p} serverNow={now}/>);await waitFor(()=>expect(screen.getByLabelText('发送给思维教练')).toBeEnabled());}
const denial=()=>Response.json({error:{code:'LLM_FREE_TIER_UNVERIFIED',message:'AI 生成已阻止：免费资格未确认。'}},{status:403});
beforeEach(()=>{
 vi.spyOn(window,'confirm').mockReturnValue(false);
 session={...initial};calls.length=0;context.mockReset();fetcher.mockReset();
 context.mockImplementation(async(_path,init)=>{const b=body(init);session={...session,thought_draft:session.thought_draft+'\n【用户补充的题面上下文】\n'+b.content,thought_revision:session.thought_revision+1};return Response.json({session,thought:{id:'31000000-0000-4000-8000-000000000004',session_id:id,version:1,content:session.thought_draft,created_at:now}});});
 fetcher.mockImplementation(async(path,init)=>{
   const url=String(path), b=body(init);
   if(init?.method && init.method!=='GET')calls.push({path:url,body:b});
   if(url.endsWith('/context'))return context(path,init);
   if(url.endsWith('/thought-draft')){session={...session,thought_draft:String(b.content),thought_revision:session.thought_revision+1};return Response.json({session});}
   if(url.endsWith('/code')){session={...session,code_draft:String(b.content),code_revision:session.code_revision+1};return Response.json({session});}
   if(url===`/api/v1/sessions/${id}` && init?.method==='PATCH'){session={...session,status:'completed',phase:'finished',outcome:b.outcome as TrainingSession['outcome'],state_revision:session.state_revision+1,ended_at:now};return Response.json({session,serverNow:now});}
   if(url.endsWith('/tutor'))return init?.method==='POST'?denial():Response.json({state:{configured:true,allowedLevel:0,maxSeenLevel:0,revision:0,used:0,limit:10},messages:[],nextBefore:null});
   if(url.includes('/thoughts'))return Response.json({items:[],nextOffset:null});
   if(url.includes('/training-feedback'))return Response.json({available:true,items:[],total:0,asOf:now});
   throw new Error('Unexpected synthetic route');
 });vi.stubGlobal('fetch',fetcher);
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});

it('keeps the fetch fixture installed until every mounted effect has been cleaned up',()=>{
 function LifetimeProbe(){useEffect(()=>()=>{expect(globalThis.fetch).toBe(fetcher);},[]);return null;}
 render(<LifetimeProbe/>);
});

it('saves supplemental context together with current notes and legacy code before freezing completion',async()=>{
 await mount();fireEvent.change(thoughtField(),{target:{value:'新的思路'}});fireEvent.change(screen.getByLabelText('C++ 草稿'),{target:{value:'// SYNTHETIC'}});fireEvent.change(contextField(),{target:{value:'新约束 n<=10'}});finish();
 await screen.findByText(/训练已完成，用时不再累计/);
 expect(calls.map(c=>c.path)).toContain(`/api/v1/sessions/${id}/context`);
 expect(calls.at(-1)?.path).toBe(`/api/v1/sessions/${id}`);
 expect(session.thought_draft).toContain('新的思路\n【用户补充的题面上下文】\n新约束 n<=10');expect(session.code_draft).toBe('// SYNTHETIC');
});
it('persists the latest supplemental context before a Tutor request; a production gate refusal preserves the message',async()=>{
 await mount();fireEvent.change(contextField(),{target:{value:'给定 n<=10'}});fireEvent.change(screen.getByLabelText('发送给思维教练'),{target:{value:'请围绕条件提问'}});fireEvent.click(screen.getByRole('button',{name:'发送',hidden:true}));
 await screen.findByText(/AI 生成已阻止/);expect(calls.map(c=>c.path)).toEqual([`/api/v1/sessions/${id}/context`,`/api/v1/sessions/${id}/tutor`]);expect(thoughtField()).toHaveValue('原思路\n【用户补充的题面上下文】\n给定 n<=10');expect(screen.getByLabelText('发送给思维教练')).toHaveValue('请围绕条件提问');
});
it('workspace plan and review links honor unsaved draft protection',async()=>{
 await mount();fireEvent.change(contextField(),{target:{value:'未保存的题面'}});
 for(const name of ['返回我的计划','AC 后导入代码复盘']){
   let cancelled=false;const observe=(event:Event)=>{cancelled=event.defaultPrevented;event.preventDefault();};document.addEventListener('click',observe);
   try{fireEvent.click(screen.getByRole('link',{name}));}finally{document.removeEventListener('click',observe);}
   expect(cancelled).toBe(true);
 }
 expect(contextField()).toHaveValue('未保存的题面');
});

it('does not freeze training or hide context when saving it fails',async()=>{
 context.mockResolvedValueOnce(Response.json({error:{code:'DATABASE_UNAVAILABLE',message:'合成保存故障'}},{status:503}));
 await mount();fireEvent.change(contextField(),{target:{value:'不能丢失的条件'}});finish();
 await screen.findByText(/题面保存结果尚未确认/);expect(session.status).toBe('paused');expect(calls.some(c=>c.path===`/api/v1/sessions/${id}`)).toBe(false);expect(contextField()).toHaveValue('不能丢失的条件');expect(thoughtField()).toHaveValue('原思路');
 expect(contextField()).toHaveAttribute('readonly');expect(thoughtField()).toHaveAttribute('readonly');expect(screen.getByRole('button',{name:'确认完成'})).toBeEnabled();
});

it('recovers an acknowledged-on-server context append with the same immutable ticket before completing',async()=>{
 const persist=context.getMockImplementation()!;let saved:unknown;
 context.mockImplementationOnce(async(...args)=>{const response=await persist(...args);saved=await response.json();throw new TypeError('合成响应丢失');}).mockImplementationOnce(async()=>Response.json(saved));
 await mount();fireEvent.change(contextField(),{target:{value:'只追加一次'}});finish();await screen.findByText(/题面保存结果尚未确认/);
 fireEvent.click(screen.getByRole('button',{name:'确认完成'}));await screen.findByText(/训练已完成，用时不再累计/);
 expect(context).toHaveBeenCalledTimes(2);expect(body(context.mock.calls[0]![1])).toEqual(body(context.mock.calls[1]![1]));expect(session.thought_draft.match(/只追加一次/g)).toHaveLength(1);expect(screen.getAllByRole('button',{name:'版本 1',hidden:true})).toHaveLength(1);expect(session.statement_snapshot).toBe('原合成题面');
});

it('a definitive save refusal leaves editable drafts and a corrected input gets a new ticket',async()=>{
 context.mockResolvedValueOnce(Response.json({error:{code:'INVALID_INPUT',message:'合成输入拒绝'}},{status:400}));
 await mount();fireEvent.change(contextField(),{target:{value:'需要修改的内容'}});fireEvent.click(screen.getByRole('button',{name:'保存题面上下文'}));await screen.findByText(/合成输入拒绝/);
 expect(contextField()).not.toHaveAttribute('readonly');fireEvent.change(contextField(),{target:{value:'修正后的条件'}});fireEvent.click(screen.getByRole('button',{name:'保存题面上下文'}));await screen.findByText('题面上下文已保存为笔记版本。');
 expect(body(context.mock.calls[0]![1]).requestId).not.toBe(body(context.mock.calls[1]![1]).requestId);expect(contextField()).toHaveValue('');
});

it('context persistence failure prevents a Tutor dispatch, without losing the question or note',async()=>{
 context.mockResolvedValueOnce(Response.json({error:{code:'DATABASE_UNAVAILABLE',message:'合成保存故障'}},{status:503}));
 await mount();fireEvent.change(contextField(),{target:{value:'先保存的条件'}});fireEvent.change(screen.getByLabelText('发送给思维教练'),{target:{value:'保留问题'}});fireEvent.click(screen.getByRole('button',{name:'发送',hidden:true}));await screen.findByText(/题面保存结果尚未确认/);
 expect(calls.filter(c=>c.path.endsWith('/tutor'))).toHaveLength(0);expect(screen.getByLabelText('发送给思维教练')).toHaveValue('保留问题');expect(thoughtField()).toHaveValue('原思路');
});

it('a note save failure stops both context append and completion while keeping every draft',async()=>{
 const base=fetcher.getMockImplementation()!;fetcher.mockImplementation(async(path,init)=>String(path).endsWith('/thought-draft')?Response.json({error:{code:'REVISION_CONFLICT',message:'合成版本冲突'}},{status:409}):base(path,init));
 await mount();fireEvent.change(thoughtField(),{target:{value:'发生冲突的本地思路'}});fireEvent.change(contextField(),{target:{value:'本地题面'}});finish();await screen.findAllByText(/合成版本冲突/);
 expect(context).not.toHaveBeenCalled();expect(session.status).toBe('paused');expect(contextField()).toHaveValue('本地题面');expect(thoughtField()).toHaveValue('发生冲突的本地思路');
});

it('completion uses the returned server state revision after resolving context',async()=>{
 const base=context.getMockImplementation()!;context.mockImplementation(async(...args)=>{session.state_revision=7;return base(...args);});
 await mount();fireEvent.change(contextField(),{target:{value:'同步新状态'}});finish();await screen.findByText(/训练已完成，用时不再累计/);expect(calls.at(-1)!.body.expectedRevision).toBe(7);
});

it('repeated completion clicks cannot append twice or send two finish requests',async()=>{
 await mount();fireEvent.change(contextField(),{target:{value:'唯一条件'}});fireEvent.click(screen.getByRole('button',{name:'结束训练'}));const confirm=screen.getByRole('button',{name:'确认完成'});
 act(()=>{fireEvent.click(confirm);fireEvent.click(confirm);});await screen.findByText(/训练已完成，用时不再累计/);expect(context).toHaveBeenCalledOnce();expect(calls.filter(c=>c.path===`/api/v1/sessions/${id}`)).toHaveLength(1);
});

it('legacy training without supplemental context still saves and finishes normally',async()=>{
 await mount(null);fireEvent.change(thoughtField(),{target:{value:'历史训练笔记'}});finish();await screen.findByText(/训练已完成，用时不再累计/);expect(context).not.toHaveBeenCalled();expect(session.thought_draft).toBe('历史训练笔记');
});

it('blank supplemental input does not disappear into a completed record',async()=>{
 await mount();fireEvent.change(contextField(),{target:{value:'   '}});finish();await screen.findByText(/请填写有效题面上下文/);expect(session.status).toBe('paused');expect(contextField()).toHaveValue('   ');expect(context).not.toHaveBeenCalled();
});

it('saved context releases the guard for ordinary navigation',async()=>{
 await mount();fireEvent.change(contextField(),{target:{value:'已保存条件'}});fireEvent.click(screen.getByRole('button',{name:'保存题面上下文'}));await screen.findByText('题面上下文已保存为笔记版本。');
 await waitFor(()=>expect(contextField()).not.toHaveAttribute('readonly'));
 let cancelled=true;const observe=(event:Event)=>{cancelled=event.defaultPrevented;event.preventDefault();};document.addEventListener('click',observe);
 try{fireEvent.click(screen.getByRole('link',{name:'AC 后导入代码复盘'}));}finally{document.removeEventListener('click',observe);}expect(cancelled).toBe(false);
});

it('a bounded context transport abort releases loading but preserves the original recovery ticket',async()=>{
 const controller=new AbortController(),timeout=vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal);
 context.mockImplementationOnce(async(_path,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason))));
 await mount();fireEvent.change(contextField(),{target:{value:'超时仍保留'}});finish();await waitFor(()=>expect(context).toHaveBeenCalledOnce());
 await act(async()=>controller.abort(new DOMException('SYNTHETIC-PRIVATE-TRANSPORT','TimeoutError')));
 await screen.findByText(/题面保存结果尚未确认/);expect(timeout).toHaveBeenCalledWith(15_000);expect(screen.getByRole('button',{name:'确认完成'})).toBeEnabled();expect(contextField()).toHaveValue('超时仍保留');expect(session.status).toBe('paused');expect(screen.getByRole('alert')).not.toHaveTextContent('SYNTHETIC-PRIVATE-TRANSPORT');
});

it.each([408,429])('an intermediary %s response retains the same context ticket instead of assuming no append',async status=>{
 context.mockResolvedValueOnce(Response.json({error:{code:'SYNTHETIC_TRANSIENT',message:'合成暂时失败'}},{status}));
 await mount();fireEvent.change(contextField(),{target:{value:'仍需核对的追加'}});finish();await screen.findByText(/题面保存结果尚未确认/);expect(contextField()).toHaveAttribute('readonly');
 fireEvent.click(screen.getByRole('button',{name:'确认完成'}));await screen.findByText(/训练已完成，用时不再累计/);expect(body(context.mock.calls[0]![1])).toEqual(body(context.mock.calls[1]![1]));
});

it('saving one thought version does not silently append a second context version',async()=>{
 const base=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(path,init)=>{
   if(String(path).endsWith('/thoughts')&&init?.method==='POST'){
     const b=body(init);calls.push({path:String(path),body:b});session={...session,thought_draft:String(b.content),thought_revision:session.thought_revision+1};
     return Response.json({session,thought:{id:'31000000-0000-4000-8000-000000000005',session_id:id,version:1,content:b.content,created_at:now}});
   }
   return base(path,init);
 });
 await mount();fireEvent.change(thoughtField(),{target:{value:'明确保存的笔记版本'}});fireEvent.change(contextField(),{target:{value:'之后再补充的上下文'}});fireEvent.click(screen.getByRole('button',{name:'保存历史版本',hidden:true}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'保存历史版本',hidden:true})).toBeEnabled());expect(context).not.toHaveBeenCalled();expect(contextField()).toHaveValue('之后再补充的上下文');expect(calls.filter(c=>c.path.endsWith('/thoughts'))).toHaveLength(1);expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('manual context save stays independent from an unrelated legacy code draft write',async()=>{
 await mount();fireEvent.change(screen.getByLabelText('C++ 草稿'),{target:{value:'// independent legacy draft'}});fireEvent.change(contextField(),{target:{value:'只保存本题上下文'}});fireEvent.click(screen.getByRole('button',{name:'保存题面上下文'}));await screen.findByText('题面上下文已保存为笔记版本。');
 expect(calls.some(c=>c.path.endsWith('/code'))).toBe(false);expect(context).toHaveBeenCalledOnce();expect(session.thought_draft).toContain('只保存本题上下文');
});

it('StrictMode cleanup does not disable subsequent real draft saves',async()=>{render(<StrictMode><Workspace initialSession={session} problem={problem} serverNow={now}/></StrictMode>);fireEvent.change(thoughtField(),{target:{value:'StrictMode note'}});fireEvent.click(screen.getByRole('button',{name:'保存思路草稿',hidden:true}));await waitFor(()=>expect(session.thought_draft).toBe('StrictMode note'));});
it('leaving while preparing evidence cannot later append context or send Tutor content',async()=>{
 const base=fetcher.getMockImplementation()!;let done!:(r:Response)=>void;
 fetcher.mockImplementation(async(path,init)=>String(path).endsWith('/thought-draft')?new Promise(r=>{done=r;}):base(path,init));
 const view=render(<Workspace initialSession={session} problem={problem} serverNow={now}/>);await waitFor(()=>expect(screen.getByRole('button',{name:'给我一点提示',hidden:true})).toBeEnabled());
 fireEvent.change(thoughtField(),{target:{value:'pending note'}});fireEvent.change(contextField(),{target:{value:'pending context'}});fireEvent.change(screen.getByLabelText('发送给思维教练'),{target:{value:'must not dispatch'}});fireEvent.click(screen.getByRole('button',{name:'发送',hidden:true}));
 await waitFor(()=>expect(done).toBeDefined());view.unmount();await act(async()=>done(Response.json({session:{...session,thought_revision:1}})));
 expect(context).not.toHaveBeenCalled();expect(calls.some(c=>c.path.endsWith('/tutor'))).toBe(false);
});
