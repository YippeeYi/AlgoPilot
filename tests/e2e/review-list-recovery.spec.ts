// Synthetic fixtures; independent list/detail requests; no model generation.
import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
test.use({baseURL:'http://127.0.0.1:3103'});
const confirmation='我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘';
async function seed(page:Page){
 const email=`review-list-${randomUUID()}@fixture.test`;expect((await page.request.post('/api/v1/auth/register',{data:{email,password:'Fixture-password-123'}})).status()).toBe(200);
 await page.goto(`/auth/callback?token_hash=${encodeURIComponent(`confirm:${email}`)}&type=email&next=%2Fdashboard`);await expect(page).toHaveURL(/\/dashboard$/);
 const session=(await(await page.request.post('/api/v1/sessions',{data:{problemId:'50000000-0000-4000-8000-000000000001',timerEnabled:false,requestId:randomUUID()}})).json()).session;
 const records=[];for(const label of ['A','B']){const response=await page.request.post('/api/v1/reviews',{data:{sessionId:session.id,requestId:randomUUID(),code:`// SYNTHETIC ${label}\nint main(){}`,source:'paste',fileName:null,problemUrl:'',statement:'',submissionId:null,confirmation}});expect(response.status()).toBe(201);records.push((await response.json()).review);}
 return records as {id:string;user_id:string;notes:string;revision:number;code_hash:string}[];
}
const listButton=(page:Page,id:string)=>page.getByRole('button',{name:new RegExp(`复盘 .*${id.slice(0,8)}`)});
test('a known history link recovers despite both initial reads failing, without a perpetual loading state',async({page},info)=>{
 const [record]=await seed(page);let lists=0,details=0,writes=0;page.on('request',r=>{if(r.method()!=='GET'&&new URL(r.url()).pathname.startsWith('/api/v1/reviews'))writes++;});
 await page.route('**/api/v1/reviews',async r=>{lists++;await r.fulfill({status:503,json:{error:{code:'DATABASE_UNAVAILABLE',message:'[SYNTHETIC] list unavailable'}}});});
 await page.route(`**/api/v1/reviews/${record!.id}`,async r=>{details++;if(details===1)await r.fulfill({status:503,json:{error:{code:'DATABASE_UNAVAILABLE',message:'[SYNTHETIC] detail unavailable'}}});else await r.fallback();});
 await page.goto(`/reviews?reviewId=${record!.id}`);const recover=page.getByRole('button',{name:'重新核验当前复盘'});await expect(recover).toBeEnabled();await recover.click();await expect(page.getByLabel('用户编辑复盘',{exact:true})).toBeEnabled();
 await expect(page.getByText('正在加载复盘…',{exact:true})).toHaveCount(0);await expect(page.getByRole('alert',{name:'复盘列表状态'})).toBeVisible();
 const note=page.getByLabel('用户编辑复盘',{exact:true}),code=page.getByLabel('C++ 代码快照',{exact:true});await note.fill('[SYNTHETIC] retained local note');await code.fill('// SYNTHETIC unsubmitted');
 const before=details;await page.getByRole('button',{name:'重新读取历史列表'}).click();await expect(page.getByRole('alert',{name:'复盘列表状态'})).toBeVisible();expect(details).toBe(before);expect(lists).toBe(2);await expect(note).toHaveValue('[SYNTHETIC] retained local note');await expect(code).toHaveValue('// SYNTHETIC unsubmitted');expect(writes).toBe(0);
 await page.screenshot({path:`/private/tmp/algopilot-review-list-${info.project.name}.png`,fullPage:true});
});
test('an invalid list response cannot crash an independently readable review',async({page})=>{
 const [record]=await seed(page);await page.route('**/api/v1/reviews',r=>r.fulfill({json:{items:'SYNTHETIC invalid list'}}));await page.goto(`/reviews?reviewId=${record!.id}`);
 await expect(page.getByLabel('用户编辑复盘',{exact:true})).toBeEnabled();await expect(page.getByRole('alert',{name:'复盘列表状态'})).toContainText('格式');
});
test('an unavailable training selector does not erase a successfully loaded review list',async({page})=>{
 const [a,b]=await seed(page);await page.route('**/api/v1/sessions?limit=50',r=>r.fulfill({status:503,json:{error:{code:'DATABASE_UNAVAILABLE',message:'[SYNTHETIC] sessions unavailable'}}}));await page.goto(`/reviews?reviewId=${a!.id}`);
 await expect(page.getByLabel('用户编辑复盘',{exact:true})).toBeEnabled();await expect(listButton(page,b!.id)).toBeVisible();
});
test('a late list from a different owner cannot replace the verified identity or expose private drafts',async({page})=>{
 const [record]=await seed(page);let release!:()=>void,arrive!:()=>void;const held=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{arrive=r;});
 await page.route('**/api/v1/reviews',async r=>{const response=await r.fetch(),body=await response.json();arrive();await held;await r.fulfill({json:{items:body.items.map((row:Record<string,unknown>)=>({...row,user_id:'92000000-0000-4000-8000-000000000099'}))}});});
 await page.goto(`/reviews?reviewId=${record!.id}`);await started;await expect(page.getByLabel('用户编辑复盘',{exact:true})).toBeEnabled();await page.getByLabel('C++ 代码快照',{exact:true}).fill('// SYNTHETIC original owner draft');release();
 await expect(page.getByLabel('C++ 代码快照',{exact:true})).toHaveCount(0);await expect(page.getByRole('alert',{name:'复盘列表状态'})).toContainText('身份');
});
test('a list timeout is recoverable without blocking or re-reading the known record',async({page})=>{
 const [record]=await seed(page);let details=0;page.on('request',r=>{if(r.url().endsWith(`/reviews/${record!.id}`)&&r.method()==='GET')details++;});
 await page.route('**/api/v1/reviews',r=>r.fulfill({status:408,json:{error:{code:'TIMEOUT',message:'[SYNTHETIC] list timeout'}}}),{times:1});await page.goto(`/reviews?reviewId=${record!.id}`);
 await expect(page.getByLabel('用户编辑复盘',{exact:true})).toBeEnabled();await expect(page.getByRole('alert',{name:'复盘列表状态'})).toContainText('超时');const before=details;await page.getByRole('button',{name:'重新读取历史列表'}).click();await expect(listButton(page,record!.id)).toBeVisible();expect(details).toBe(before);
});
test('an inaccessible known ID stays private even after the new user successfully reloads their own list',async({page,browser})=>{
 const [record]=await seed(page),context=await browser.newContext({baseURL:'http://127.0.0.1:3103'});try{
  const other=await context.newPage(),[own]=await seed(other);let posts=0;other.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/v1/reviews'))posts++;});
  const response=other.waitForResponse(r=>r.url().endsWith(`/reviews/${record!.id}`));await other.goto(`/reviews?reviewId=${record!.id}`);expect((await response).status()).toBe(404);await expect(other.getByLabel('用户编辑复盘',{exact:true})).toHaveCount(0);await expect(other.getByRole('alert',{name:'复盘错误'})).toContainText('未找到可访问');
  await other.getByRole('button',{name:'重新读取历史列表'}).click();await expect(listButton(other,own!.id)).toBeVisible();await expect(other.getByLabel('用户编辑复盘',{exact:true})).toHaveCount(0);await expect(listButton(other,record!.id)).toHaveCount(0);expect(posts).toBe(0);
 }finally{await context.close();}
});
test('a late list retry does not override a newer explicit selection or unsaved notes',async({page})=>{
 const [a,b]=await seed(page);await page.goto(`/reviews?reviewId=${a!.id}`);await expect(page.getByLabel('用户编辑复盘',{exact:true})).toBeEnabled();await expect(listButton(page,b!.id)).toBeVisible();let release!:()=>void,arrive!:()=>void;
 const held=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{arrive=r;});await page.route('**/api/v1/reviews',async r=>{const response=await r.fetch();arrive();await held;await r.fulfill({response});},{times:1});
 // Select before retry: a collection read must not become another detail selection.
 await listButton(page,b!.id).click();await expect(page).toHaveURL(new RegExp('reviewId='+b!.id+'$'));const note=page.getByLabel('用户编辑复盘',{exact:true});await note.fill('[SYNTHETIC] B local note');await page.getByLabel('C++ 代码快照',{exact:true}).fill('// SYNTHETIC import still pending');
 await page.getByRole('button',{name:'重新读取历史列表'}).click();await started;release();await expect(listButton(page,a!.id)).toBeVisible();await expect(note).toHaveValue('[SYNTHETIC] B local note');await expect(page.getByLabel('C++ 代码快照',{exact:true})).toHaveValue('// SYNTHETIC import still pending');await expect(page).toHaveURL(new RegExp('reviewId='+b!.id+'$'));
});
test('a malformed history link never attempts guessed record IDs and keeps ordinary history usable',async({page})=>{
 const [record]=await seed(page),ids:string[]=[];page.on('request',r=>{const match=new URL(r.url()).pathname.match(/^\/api\/v1\/reviews\/([^/]+)$/);if(match)ids.push(match[1]!);});await page.goto('/reviews?reviewId=invalid-known-link');
 await expect(page.getByRole('alert',{name:'复盘链接错误'})).toBeVisible();await expect(listButton(page,record!.id)).toBeVisible();expect(ids).toEqual([]);await listButton(page,record!.id).click();await expect(page).toHaveURL(new RegExp('reviewId='+record!.id+'$'));await expect(page.getByLabel('用户编辑复盘',{exact:true})).toBeEnabled();expect(ids.every(id=>id===record!.id)).toBe(true);
});
test('list failure, UNKNOWN generation and native reentry do not create or retry a generation',async({page})=>{
 const [record]=await seed(page);let posts=0;await page.route('**/api/v1/reviews',r=>r.fulfill({status:503,json:{error:{code:'DATABASE_UNAVAILABLE',message:'[SYNTHETIC] list unavailable'}}}));
 await page.route(`**/api/v1/reviews/${record!.id}/generate`,async r=>{posts++;await r.fulfill({status:503,json:{error:{code:'DATABASE_UNAVAILABLE',message:'[SYNTHETIC] unknown generation'}}});});await page.goto(`/reviews?reviewId=${record!.id}`);
 await expect(page.getByRole('button',{name:'生成 AI 复盘',exact:true})).toBeEnabled();await page.getByLabel('后续复盘问题',{exact:true}).fill('[SYNTHETIC] original ticket');await page.getByRole('button',{name:'生成 AI 复盘',exact:true}).click();await expect(page.getByRole('button',{name:'重试上次生成请求'})).toBeEnabled();expect(posts).toBe(1);
 await page.getByRole('button',{name:'重新读取历史列表'}).click();await expect(page.getByRole('alert',{name:'复盘列表状态'})).toBeVisible();await page.getByRole('button',{name:'重新核验当前复盘'}).click();await expect(page.getByRole('button',{name:'重试上次生成请求'})).toBeEnabled();await expect(page.getByLabel('后续复盘问题',{exact:true})).toHaveValue('[SYNTHETIC] original ticket');expect(posts).toBe(1);
 page.on('dialog',d=>d.accept());await page.getByRole('link',{name:'能力画像',exact:true}).click();await expect(page).toHaveURL(/\/analytics$/);await page.goBack();await expect(page.getByLabel('用户编辑复盘',{exact:true})).toBeEnabled();expect(posts).toBe(1);await page.goForward();await expect(page).toHaveURL(/\/analytics$/);expect(posts).toBe(1);
});
