// Synthetic data, real Chromium history. Production denying factory on this port.
import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
test.use({baseURL:'http://127.0.0.1:3103'});
const confirmation='我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘';
const historyButton=(page:Page,id:string)=>page.getByRole('button',{name:new RegExp(`复盘 .*${id.slice(0,8)}`)});
async function open(page:Page){
 const email=`review-navigation-${randomUUID()}@fixture.test`;expect((await page.request.post('/api/v1/auth/register',{data:{email,password:'Fixture-password-123'}})).status()).toBe(200);
 await page.goto(`/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=%2Fdashboard`);await expect(page).toHaveURL(/\/dashboard$/);
 const session=(await(await page.request.post('/api/v1/sessions',{data:{problemId:'50000000-0000-4000-8000-000000000001',statementSnapshot:'[SYNTHETIC] n<=10。',timerEnabled:false,requestId:randomUUID()}})).json()).session;
 const response=await page.request.post('/api/v1/reviews',{data:{sessionId:session.id,requestId:randomUUID(),code:'// SYNTHETIC immutable\nint main(){}',source:'paste',fileName:null,problemUrl:'',statement:'',submissionId:null,confirmation}});expect(response.status()).toBe(201);const {review}=await response.json();
 await page.getByRole('link',{name:'题目分析 / 复盘',exact:true}).click();await historyButton(page,review.id).click();await expect(page.getByRole('button',{name:'生成 AI 复盘',exact:true})).toBeEnabled();return review as {id:string;session_id:string;code_hash:string};
}
async function traverse(page:Page,direction:'back'|'forward'){
 return page.evaluate(async d=>{try{await window.navigation[d]().finished;return 'committed';}catch{return 'cancelled';}},direction);
}
for(const field of ['用户编辑复盘','C++ 代码快照','题面、约束与样例（可选，关联训练时默认使用原快照）'])test(`native back protects ${field} without changing the history position`,async({page},info)=>{
 const review=await open(page),input=page.getByLabel(field,{exact:true});await input.fill('[SYNTHETIC] unsaved '+field);const length=await page.evaluate(()=>history.length);let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss();});
 expect(await traverse(page,'back')).toBe('cancelled');await expect(page).toHaveURL(new RegExp('reviewId='+review.id+'$'));await expect(input).toHaveValue('[SYNTHETIC] unsaved '+field);await expect(input).toBeFocused();expect(dialogs).toBe(1);
 expect(await traverse(page,'back')).toBe('cancelled');expect(await page.evaluate(()=>history.length)).toBe(length);
 if(field==='用户编辑复盘')await page.screenshot({path:`/private/tmp/algopilot-review-navigation-${info.project.name}.png`,fullPage:true});
 page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());expect(await traverse(page,'back')).toBe('committed');await expect(page).toHaveURL(/\/dashboard$/);await page.goForward();await expect(page).toHaveURL(new RegExp('reviewId='+review.id+'$'));await expect(page.getByRole('button',{name:'生成 AI 复盘',exact:true})).toBeEnabled();expect(await page.evaluate(()=>history.length)).toBe(length);
});
test('a late snapshot acknowledgement after leaving cannot issue a detail read or rewrite the new page URL',async({page})=>{
 const first=await open(page);await page.getByLabel('关联训练（可选）').selectOption(first.session_id);await page.getByLabel('C++ 代码快照',{exact:true}).fill('// SYNTHETIC second snapshot\nint main(){}');await page.getByLabel(/我确认本次为自报 AC/).check();
 let release!:()=>void,arrive!:()=>void;const held=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{arrive=r;});let id='',lateReads=0,generations=0;
 page.on('request',r=>{if(id&&r.url().endsWith('/reviews/'+id)&&r.method()==='GET')lateReads++;if(r.url().endsWith('/generate')&&r.method()==='POST')generations++;});
 await page.route('**/api/v1/reviews',async r=>{if(r.request().method()!=='POST'){await r.fallback();return;}const ack=await r.fetch();expect(ack.status()).toBe(201);id=(await ack.json()).review.id;arrive();await held;await r.fulfill({response:ack});},{times:1});
 await page.getByRole('button',{name:'确认进入复盘并保存快照'}).click();await started;page.on('dialog',d=>d.accept());expect(await traverse(page,'back')).toBe('committed');await expect(page).toHaveURL(/\/dashboard$/);
 const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/reviews')&&r.request().method()==='POST');release();await(await response).finished();await page.goForward();await expect(page).toHaveURL(new RegExp('reviewId='+first.id+'$'));await expect(page.getByRole('button',{name:'生成 AI 复盘',exact:true})).toBeEnabled();expect(lateReads).toBe(0);expect(generations).toBe(0);
 await historyButton(page,id).click();await expect(page).toHaveURL(new RegExp('reviewId='+id+'$'));expect((await(await page.request.get('/api/v1/reviews')).json()).items).toHaveLength(2);expect(generations).toBe(0);
});
test('an access refusal on revalidation removes the old private snapshot until a successful read',async({page})=>{
 const review=await open(page);await page.getByText('查看本次代码快照与授权记录',{exact:true}).click();await expect(page.locator('pre')).toContainText('SYNTHETIC immutable');
 await page.route(`**/api/v1/reviews/${review.id}`,r=>r.fulfill({status:401,json:{error:{code:'UNAUTHENTICATED',message:'[SYNTHETIC] access revoked'}}}),{times:1});
 await historyButton(page,review.id).click();await expect(page.getByRole('alert',{name:'复盘错误'})).toContainText('access revoked');await expect(page.getByLabel('用户编辑复盘',{exact:true})).toHaveCount(0);await expect(page.locator('pre')).toHaveCount(0);
 await page.getByRole('button',{name:'重新核验当前复盘'}).click();await expect(page.getByRole('button',{name:'生成 AI 复盘',exact:true})).toBeEnabled();
});
test('forward and internal links use one confirmation and preserve an unsent follow-up on cancel',async({page})=>{
 const review=await open(page);let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/generate'))posts++;});
 await page.getByRole('link',{name:'查看原训练和提示历史'}).click();await expect(page).toHaveURL(new RegExp('/practice/'+review.session_id+'$'));await page.goBack();await expect(page.getByRole('button',{name:'生成 AI 复盘',exact:true})).toBeEnabled();
 const question=page.getByLabel('后续复盘问题',{exact:true});await question.fill('[SYNTHETIC] not sent');let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss();});
 expect(await traverse(page,'forward')).toBe('cancelled');await expect(question).toHaveValue('[SYNTHETIC] not sent');await expect(question).toBeFocused();
 await page.getByRole('link',{name:'查看原训练和提示历史'}).click();expect(dialogs).toBe(2);await expect(page).toHaveURL(new RegExp('reviewId='+review.id+'$'));
 page.removeAllListeners('dialog');let confirmations=0;page.on('dialog',async d=>{confirmations++;await d.accept();});await page.getByRole('link',{name:'能力画像',exact:true}).click();await expect(page).toHaveURL(/\/analytics$/);expect(confirmations).toBe(1);expect(posts).toBe(0);
});
test('refresh, direct URL and tab close use native warnings; confirmed refresh restores saved history only',async({page})=>{
 const review=await open(page);const notes=page.getByLabel('用户编辑复盘',{exact:true}),question=page.getByLabel('后续复盘问题',{exact:true});await notes.fill('[SYNTHETIC] durable server note');await page.getByRole('button',{name:'保存用户编辑',exact:true}).click();await expect(notes).toBeEnabled();await question.fill('[SYNTHETIC] memory only');
 let next=page.waitForEvent('dialog'),reload=page.evaluate(()=>location.reload()).catch(()=>{});let d=await next;expect(d.type()).toBe('beforeunload');await d.dismiss();await reload;await expect(question).toHaveValue('[SYNTHETIC] memory only');
 next=page.waitForEvent('dialog');const away=page.goto('/analytics').catch(()=>null);d=await next;expect(d.type()).toBe('beforeunload');await d.dismiss();await away;await expect(page).toHaveURL(new RegExp('reviewId='+review.id+'$'));
 next=page.waitForEvent('dialog');const closing=page.close({runBeforeUnload:true});d=await next;expect(d.type()).toBe('beforeunload');await d.dismiss();await closing;expect(page.isClosed()).toBe(false);
 next=page.waitForEvent('dialog');reload=page.evaluate(()=>location.reload()).catch(()=>{});d=await next;const loaded=page.waitForEvent('load');await d.accept();await reload;await loaded;await expect(notes).toHaveValue('[SYNTHETIC] durable server note');await expect(question).toHaveValue('');
 await question.fill('[SYNTHETIC] close explicitly');next=page.waitForEvent('dialog');const closed=page.waitForEvent('close'),close=page.close({runBeforeUnload:true});d=await next;await d.accept();await close;await closed;
});
test('unknown committed snapshot save retries the frozen original body and creates one new history row',async({page})=>{
 const first=await open(page);const bodies:unknown[]=[];let generations=0;page.on('request',r=>{if(r.url().endsWith('/generate'))generations++;});
 await page.getByLabel('关联训练（可选）').selectOption(first.session_id);const code=page.getByLabel('C++ 代码快照',{exact:true});await code.fill('// SYNTHETIC retained\nint main(){}');await page.getByLabel(/我确认本次为自报 AC/).check();
 await page.route('**/api/v1/reviews',async r=>{if(r.request().method()!=='POST'){await r.fallback();return;}bodies.push(r.request().postDataJSON());if(bodies.length===1){const ack=await r.fetch();expect(ack.status()).toBe(201);await r.abort('failed');}else await r.fallback();});
 await page.getByRole('button',{name:'确认进入复盘并保存快照'}).click();await expect(page.getByRole('button',{name:'重试原快照保存'})).toBeEnabled();await expect(code).toHaveValue('// SYNTHETIC retained\nint main(){}');await expect(code).toBeDisabled();expect(bodies).toHaveLength(1);
 page.on('dialog',d=>d.dismiss());expect(await traverse(page,'back')).toBe('cancelled');await page.getByRole('button',{name:'重试原快照保存'}).click();await expect(code).toHaveValue('');expect(bodies).toHaveLength(2);expect(bodies[1]).toEqual(bodies[0]);expect((await(await page.request.get('/api/v1/reviews')).json()).items).toHaveLength(2);expect(generations).toBe(0);
});
test('unknown committed notes are recovered by a read, then native reentry restores them without another PATCH',async({page})=>{
 const review=await open(page),notes=page.getByLabel('用户编辑复盘',{exact:true});let writes=0;await page.route(`**/api/v1/reviews/${review.id}`,async r=>{if(r.request().method()!=='PATCH'){await r.fallback();return;}writes++;const ack=await r.fetch();expect(ack.status()).toBe(200);await r.abort('failed');},{times:1});
 await notes.fill('[SYNTHETIC] one committed note');await page.getByRole('button',{name:'保存用户编辑',exact:true}).click();await expect(page.getByRole('button',{name:'核对笔记保存状态'})).toBeEnabled();await expect(notes).toBeDisabled();page.on('dialog',d=>d.dismiss());expect(await traverse(page,'back')).toBe('cancelled');
 await page.getByRole('button',{name:'核对笔记保存状态'}).click();await expect(notes).toBeEnabled();await expect(notes).toHaveValue('[SYNTHETIC] one committed note');expect(writes).toBe(1);await page.goBack();await expect(page).toHaveURL(/\/dashboard$/);await page.goForward();await expect(notes).toHaveValue('[SYNTHETIC] one committed note');expect(writes).toBe(1);
});
test('pending and expired generation uses its original ID; only a later explicit intent creates a new denied request',async({page})=>{
 const review=await open(page),question=page.getByLabel('后续复盘问题',{exact:true});await question.fill('[SYNTHETIC] retain on expiry');let release!:()=>void,arrive!:()=>void;const held=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{arrive=r;});const bodies:{requestId:string;question:string}[]=[];
 await page.route(`**/api/v1/reviews/${review.id}/generate`,async r=>{bodies.push(r.request().postDataJSON());if(bodies.length===1){arrive();await held;await r.fulfill({status:503,json:{error:{code:'DATABASE_UNAVAILABLE',message:'[SYNTHETIC] pending outcome'}}});}else if(bodies.length===2)await r.fulfill({status:409,json:{error:{code:'TUTOR_BUSY',message:'[SYNTHETIC] active lease'}}});else if(bodies.length===3)await r.fulfill({status:409,json:{error:{code:'REVIEW_REQUEST_FAILED',message:'[SYNTHETIC] expired'}}});else await r.fallback();});
 const generate=page.getByRole('button',{name:'生成 AI 复盘',exact:true});await generate.dblclick();await started;expect(bodies).toHaveLength(1);page.on('dialog',d=>d.dismiss());expect(await traverse(page,'back')).toBe('cancelled');release();const retry=page.getByRole('button',{name:'重试上次生成请求'});await expect(retry).toBeEnabled();await retry.click();await expect(retry).toBeEnabled();await retry.click();await expect(generate).toBeEnabled();expect(bodies).toHaveLength(3);expect(bodies[1]).toEqual(bodies[0]);expect(bodies[2]).toEqual(bodies[0]);await expect(question).toHaveValue('[SYNTHETIC] retain on expiry');
 await generate.click();await expect(page.getByRole('alert',{name:'复盘错误'})).toContainText('AI 生成已阻止');expect(bodies).toHaveLength(4);expect(bodies[3]!.requestId).not.toBe(bodies[0]!.requestId);await expect(question).toHaveValue('[SYNTHETIC] retain on expiry');expect((await(await page.request.get(`/api/v1/reviews/${review.id}`)).json()).results).toEqual([]);
});
test('completed history reentry revalidates access before showing a cached analysis and never generates automatically',async({page})=>{
 const review=await open(page);expect((await page.request.post(`http://127.0.0.1:3102/api/v1/reviews/${review.id}/generate`,{data:{requestId:randomUUID(),question:''}})).status()).toBe(200);
 await historyButton(page,review.id).click();await expect(page.getByText('[MOCK] 算法总结',{exact:true})).toBeVisible();let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/generate'))posts++;});await page.getByRole('link',{name:'查看原训练和提示历史'}).click();await expect(page).toHaveURL(new RegExp('/practice/'+review.session_id+'$'));
 await page.route(`**/api/v1/reviews/${review.id}`,r=>r.fulfill({status:403,json:{error:{code:'FORBIDDEN',message:'[SYNTHETIC] revoked on return'}}}),{times:1});await page.goBack();await expect(page.getByRole('alert',{name:'复盘错误'})).toContainText('revoked on return');await expect(page.getByText('[MOCK] 算法总结',{exact:true})).toHaveCount(0);await expect(page.getByLabel('用户编辑复盘',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'重新核验当前复盘'}).click();await expect(page.getByText('[MOCK] 算法总结',{exact:true})).toBeVisible();expect(posts).toBe(0);expect((await(await page.request.get(`/api/v1/reviews/${review.id}`)).json()).results).toHaveLength(1);
});
test('a note acknowledgement racing a confirmed departure cannot overwrite history or create a follow-up',async({page})=>{
 const review=await open(page),notes=page.getByLabel('用户编辑复盘',{exact:true});let release!:()=>void,arrive!:()=>void;const held=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{arrive=r;});let writes=0,posts=0;
 page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/v1/reviews'))posts++;});await page.route(`**/api/v1/reviews/${review.id}`,async r=>{if(r.request().method()!=='PATCH'){await r.fallback();return;}writes++;const ack=await r.fetch();arrive();await held;await r.fulfill({response:ack});},{times:1});
 await notes.fill('[SYNTHETIC] raced committed note');await page.getByRole('button',{name:'保存用户编辑',exact:true}).click();await started;page.on('dialog',d=>d.dismiss());expect(await traverse(page,'back')).toBe('cancelled');page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());expect(await traverse(page,'back')).toBe('committed');await expect(page).toHaveURL(/\/dashboard$/);
 const response=page.waitForResponse(r=>r.url().endsWith(`/reviews/${review.id}`)&&r.request().method()==='PATCH');release();await(await response).finished();await page.goForward();await expect(notes).toHaveValue('[SYNTHETIC] raced committed note');await expect(notes).toBeEnabled();expect(writes).toBe(1);expect(posts).toBe(0);
});
