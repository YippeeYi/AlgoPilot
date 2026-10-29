// Native Chromium traversal and browser dialogs; synthetic local data, never a real model.
import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
async function open(page:Page){
 const email=`navigation-${randomUUID()}@fixture.test`;
 expect((await page.request.post('/api/v1/auth/register',{data:{email,password:'Fixture-password-123'}})).status()).toBe(200);
 await page.goto(`/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=%2Fsessions`);await expect(page).toHaveURL(/\/sessions$/);
 const r=await page.request.post('/api/v1/sessions',{data:{problemId:'50000000-0000-4000-8000-000000000001',statementSnapshot:'[SYNTHETIC] n<=10。',timerEnabled:false,requestId:randomUUID()}});expect(r.status()).toBe(201);const id=(await r.json()).session.id;
 await page.reload();await page.getByRole('link',{name:'重新打开训练',exact:true}).click();await expect(page).toHaveURL(new RegExp('/practice/'+id+'$'));return id as string;
}
async function traverse(page:Page,direction:'back'|'forward'){
 return page.evaluate(async d=>{try{await window.navigation[d]().finished;return 'committed';}catch{return 'cancelled';}},direction);
}
test('native back cancellation keeps an unsent Tutor draft and the original history position',async({page},info)=>{
 const id=await open(page);if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'AI 教练',exact:true}).click();
 const input=page.getByLabel('发送给思维教练');await input.fill('[SYNTHETIC] 未发送的问题');
 if(info.project.name==='m2-mobile'){await page.getByRole('tab',{name:'思路笔记',exact:true}).click();await page.getByRole('tab',{name:'AI 教练',exact:true}).click();await expect(input).toHaveValue('[SYNTHETIC] 未发送的问题');}
 let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss();});
 expect(await traverse(page,'back')).toBe('cancelled');expect(dialogs).toBe(1);await expect(page).toHaveURL(new RegExp('/practice/'+id+'$'));await expect(input).toHaveValue('[SYNTHETIC] 未发送的问题');
 const length=await page.evaluate(()=>history.length);expect(await traverse(page,'back')).toBe('cancelled');expect(await page.evaluate(()=>history.length)).toBe(length);await expect(input).toBeFocused();
 page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());expect(await traverse(page,'back')).toBe('committed');await expect(page).toHaveURL(/\/sessions$/);
 await page.goForward();await expect(page).toHaveURL(new RegExp('/practice/'+id+'$'));expect(await page.evaluate(()=>history.length)).toBe(length);
 // A fresh document is not a durable Tutor draft store, even when forward caching retains a view.
 await page.reload();if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'AI 教练',exact:true}).click();await expect(input).toHaveValue('');
});
test('native forward also protects a fresh unsent draft after returning to the workbench',async({page},info)=>{
 const id=await open(page);await page.getByRole('link',{name:'能力画像',exact:true}).click();await expect(page).toHaveURL(/\/analytics$/);await page.goBack();await expect(page).toHaveURL(new RegExp('/practice/'+id+'$'));await expect(page.getByRole('link',{name:'能力画像',exact:true})).not.toHaveAttribute('aria-current','page');
 if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'AI 教练',exact:true}).click();const input=page.getByLabel('发送给思维教练');await input.fill('[SYNTHETIC] protect forward');
 const length=await page.evaluate(()=>history.length);page.on('dialog',d=>d.dismiss());expect(await traverse(page,'forward')).toBe('cancelled');await expect(input).toHaveValue('[SYNTHETIC] protect forward');await expect(page.getByRole('link',{name:'能力画像',exact:true})).not.toHaveAttribute('aria-current','page');expect(await page.evaluate(()=>history.length)).toBe(length);
 await page.screenshot({path:`/private/tmp/algopilot-navigation-${info.project.name}.png`,fullPage:true});
 page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());expect(await traverse(page,'forward')).toBe('committed');await expect(page).toHaveURL(/\/analytics$/);expect(await page.evaluate(()=>history.length)).toBe(length);
});
test('unsent Tutor text participates in ordinary App Router link protection',async({page},info)=>{
 const id=await open(page);if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'AI 教练',exact:true}).click();
 const input=page.getByLabel('发送给思维教练');await input.fill('[SYNTHETIC] 留在当前页');let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss();});
 await page.getByRole('link',{name:'能力画像',exact:true}).click();expect(dialogs).toBe(1);await expect(page).toHaveURL(new RegExp('/practice/'+id+'$'));await expect(input).toHaveValue('[SYNTHETIC] 留在当前页');
 page.removeAllListeners('dialog');let accepted=0;page.on('dialog',async d=>{accepted++;await d.accept();});await page.getByRole('link',{name:'能力画像',exact:true}).click();await expect(page).toHaveURL(/\/analytics$/);expect(accepted).toBe(1);
});

for(const kind of ['thought','code','combined','unknown-context'] as const)test(`native back uses live ${kind} risk during save, failure and recovery`,async({page},info)=>{
 const id=await open(page),path='/practice/'+id;let release!:()=>void;const waiting=new Promise<void>(r=>{release=r;});const bodies:unknown[]=[];
 const context=page.getByLabel('补充当前题目的题面、约束与样例');
 if(kind==='unknown-context'){
   await page.route(`**/api/v1/sessions/${id}/context`,async r=>{bodies.push(r.request().postDataJSON());if(bodies.length===1)await r.fulfill({status:503,json:{error:{code:'DATABASE_UNAVAILABLE',message:'SYNTHETIC unknown'}}});else await r.fallback();});
   await context.fill('[SYNTHETIC] unknown context');await page.getByRole('button',{name:'保存题面上下文',exact:true}).click();await expect(page.getByText(/题面保存结果尚未确认/)).toBeVisible();
 }else{
   if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'思路笔记',exact:true}).click();
   const suffix=kind==='code'?'code':'thought-draft';await page.route(`**/api/v1/sessions/${id}/${suffix}`,async r=>{await waiting;await r.fallback();},{times:1});
   if(kind==='code')await page.getByText('历史代码记录（可选）',{exact:true}).click();
   await page.getByLabel(kind==='code'?'C++ 草稿':'当前思路',{exact:true}).fill('[SYNTHETIC] pending '+kind);
   await page.getByRole('button',{name:kind==='code'?'保存代码草稿':'保存思路草稿',exact:true}).click();
   if(kind==='combined'){if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'AI 教练',exact:true}).click();await page.getByLabel('发送给思维教练').fill('[SYNTHETIC] additional local draft');}
 }
 const messages:string[]=[];page.on('dialog',async d=>{messages.push(d.message());await d.dismiss();});expect(await traverse(page,'back')).toBe('cancelled');await expect(page).toHaveURL(new RegExp(path+'$'));expect(messages).toHaveLength(1);
 expect(messages[0]).toContain(kind==='unknown-context'?'UNKNOWN':kind==='code'?'代码草稿':'思路笔记');
 if(kind==='unknown-context'){await page.getByRole('button',{name:'重试保存题面上下文'}).click();await expect(page.getByText('题面上下文已保存为笔记版本。')).toBeVisible();expect(bodies[1]).toEqual(bodies[0]);}
 else{release();if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'思路笔记',exact:true}).click();await expect(page.getByText(kind==='code'?'代码：已保存到服务器':'思路：已保存到服务器',{exact:true})).toBeVisible();}
 if(kind==='combined'){
   expect(await traverse(page,'back')).toBe('cancelled');expect(messages.at(-1)).toContain('Tutor 未发送');if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'AI 教练',exact:true}).click();await page.getByRole('button',{name:'清空未发送草稿'}).click();
 }
 const count=messages.length;await page.goBack();await expect(page).toHaveURL(/\/sessions$/);expect(messages).toHaveLength(count);
});

test('confirming native leave during Tutor preparation cannot dispatch later or drain a disposed save queue',async({page},info)=>{
 const id=await open(page);if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'思路笔记',exact:true}).click();
 let release!:()=>void,arrive!:()=>void;const waiting=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{arrive=r;});let writes=0,posts=0;
 page.on('request',r=>{if(r.url().endsWith(`/sessions/${id}/tutor`)&&r.method()==='POST')posts++;});
 await page.route(`**/api/v1/sessions/${id}/thought-draft`,async r=>{writes++;arrive();await waiting;await r.fallback();});
 await page.getByLabel('当前思路',{exact:true}).fill('[SYNTHETIC] queued A');await page.getByRole('button',{name:'保存思路草稿',exact:true}).click();await started;
 await page.getByLabel('当前思路',{exact:true}).fill('[SYNTHETIC] queued B');
 if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'AI 教练',exact:true}).click();await page.getByLabel('发送给思维教练').fill('[SYNTHETIC] not permission to send');await page.getByRole('button',{name:'发送',exact:true}).click();
 page.on('dialog',d=>d.accept());expect(await traverse(page,'back')).toBe('committed');await expect(page).toHaveURL(/\/sessions$/);
 const settled=page.waitForResponse(r=>r.url().endsWith(`/sessions/${id}/thought-draft`));release();await (await settled).finished();
 // The request already issued may finish. The queued B and Tutor dispatch must not start.
 await page.goForward();await expect(page).toHaveURL(new RegExp('/practice/'+id+'$'));await expect(page.getByRole('button',{name:'结束训练',exact:true})).toBeVisible();
 expect(writes).toBe(1);expect(posts).toBe(0);
});

test('unknown Tutor response stays protected, retries its original ID, and success releases navigation',async({page},info)=>{
 const id=await open(page);if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'AI 教练',exact:true}).click();const input=page.getByLabel('发送给思维教练');let posts=0;const bodies:unknown[]=[];
 await page.route(`**/api/v1/sessions/${id}/tutor`,async r=>{if(r.request().method()!=='POST'){await r.fallback();return;}posts++;bodies.push(r.request().postDataJSON());if(posts===1){const ack=await r.fetch();expect(ack.status()).toBe(200);await r.abort('failed');}else await r.fallback();});
 await input.fill('[SYNTHETIC] check a premise');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByRole('button',{name:'查询 / 重试原请求'})).toBeEnabled();expect(posts).toBe(1);await expect(input).toHaveValue('[SYNTHETIC] check a premise');
 page.on('dialog',d=>d.dismiss());expect(await traverse(page,'back')).toBe('cancelled');await page.getByRole('button',{name:'查询 / 重试原请求'}).click();await expect(input).toHaveValue('');expect(posts).toBe(2);expect(bodies[1]).toEqual(bodies[0]);await page.goBack();await expect(page).toHaveURL(/\/sessions$/);
});

test('refresh, direct URL and tab close use native beforeunload without persisting Tutor text',async({page},info)=>{
 const id=await open(page),path='/practice/'+id;if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'AI 教练',exact:true}).click();const input=page.getByLabel('发送给思维教练');await input.fill('[SYNTHETIC] current document only');
 let next=page.waitForEvent('dialog'),reload=page.evaluate(()=>location.reload()).catch(()=>{});let d=await next;expect(d.type()).toBe('beforeunload');await d.dismiss();await reload;await expect(input).toHaveValue('[SYNTHETIC] current document only');
 next=page.waitForEvent('dialog');const away=page.goto('/analytics').catch(()=>null);d=await next;expect(d.type()).toBe('beforeunload');await d.dismiss();await away;await expect(page).toHaveURL(new RegExp(path+'$'));
 next=page.waitForEvent('dialog');const closing=page.close({runBeforeUnload:true});d=await next;expect(d.type()).toBe('beforeunload');await d.dismiss();await closing;expect(page.isClosed()).toBe(false);
 next=page.waitForEvent('dialog');reload=page.evaluate(()=>location.reload()).catch(()=>{});d=await next;const loaded=page.waitForEvent('load');await d.accept();await reload;await loaded;if(info.project.name==='m2-mobile')await page.getByRole('tab',{name:'AI 教练',exact:true}).click();await expect(input).toHaveValue('');
 await input.fill('[SYNTHETIC] close explicitly');next=page.waitForEvent('dialog');const closed=page.waitForEvent('close'),close=page.close({runBeforeUnload:true});d=await next;await d.accept();await close;await closed;
});
