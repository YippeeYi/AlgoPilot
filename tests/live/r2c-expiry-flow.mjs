// Bounded J05 regression on the same fresh local stack after the full matrix.
// GoTrue's numeric `code` is an HTTP code; `error_code` is its machine error code.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
const root=process.argv[2],m=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
const c=JSON.parse(await readFile(join(root,'local-synthetic.json'),'utf8'));
const origins=[m.ports.instance1,m.ports.instance2].map(p=>`http://127.0.0.1:${p}`);
const must=(v,label)=>{if(!v)throw Error(label);},sleep=ms=>new Promise(r=>setTimeout(r,ms));
let allowed=0,denied=0,browser,result;
const audit=process.env.M353_B3_AUDIT_DIRECTORY;
async function api(ctx,i,path,body){const r=await ctx.request.fetch(origins[i]+path,{method:'POST',data:body,headers:{Origin:origins[i]}});return {status:r.status(),data:await r.json()};}
async function retained(ctx){const chunks=(await ctx.cookies()).filter(x=>x.name.includes('auth-token')&&!x.name.includes('code-verifier')).sort((a,b)=>a.name.localeCompare(b.name));const text=chunks.map(x=>x.value).join('');must(text.startsWith('base64-'),'ssr_cookie_encoding');return JSON.parse(Buffer.from(text.slice(7),'base64url').toString());}
async function probe(path,token){const r=await fetch(c.api+path,{headers:{apikey:c.anon,Authorization:'Bearer '+token}});return {status:r.status,data:await r.json()};}
try {
  for(const origin of origins){let ready=false;for(let n=0;n<100;n++){try{if((await fetch(origin+'/login')).status===200){ready=true;break;}}catch{ /* Owned server starts asynchronously. */ }await sleep(200);}must(ready,'next_ready');}
  await writeFile(join(audit,`${process.pid}.browser.started`),JSON.stringify({version:'offline-browser-lifecycle/1',pid:process.pid}),{mode:0o600,flag:'wx'});
  browser=await chromium.launch({headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-pings','--no-proxy-server','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost']});
  const contexts=[];
  for(const alias of ['A','B']){
    const ctx=await browser.newContext({serviceWorkers:'block'});contexts.push(ctx);
    await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&Object.values(m.ports).includes(Number(u.port))){allowed++;await route.continue();}else{denied++;await route.abort('blockedbyclient');}});
    must((await api(ctx,0,'/api/v1/auth/login',{email:alias.toLowerCase()+'@r2c.invalid',password:c.password})).status===200,'real_login');
  }
  const [a,b]=contexts,identity=await api(a,0,'/api/v1/r2c-private',{action:'identity'}),bIdentity=await api(b,1,'/api/v1/r2c-private',{action:'identity'});
  must(identity.status===200&&bIdentity.status===200&&identity.data.userId!==bIdentity.data.userId,'distinct_positive_controls');
  const old=await retained(a),claims=JSON.parse(Buffer.from(old.access_token.split('.')[1],'base64url').toString());
  must((await probe('/auth/v1/user',old.access_token)).status===200,'unexpired_auth_positive');
  must((await probe('/rest/v1/profiles?select=id',old.access_token)).status===200,'unexpired_postgrest_positive');
  const started=Date.now();while(Date.now()<claims.exp*1000+1500)await sleep(Math.min(1000,claims.exp*1000+1500-Date.now()));
  const auth=await probe('/auth/v1/user',old.access_token),grace=await probe('/rest/v1/profiles?select=id',old.access_token);
  must(auth.status===403&&auth.data.error_code==='bad_jwt','expired_auth_'+auth.status+'_'+auth.data.error_code);
  // PostgREST 16.5 documents 30s claim clock skew. Observe both sides without
  // changing clocks, claims, platform configuration or the business lease.
  must(grace.status===200,'documented_postgrest_grace_window');
  while(Date.now()<claims.exp*1000+31500)await sleep(Math.min(1000,claims.exp*1000+31500-Date.now()));
  const rest=await probe('/rest/v1/profiles?select=id',old.access_token);
  must(rest.status===401&&['PGRST301','PGRST303'].includes(rest.data.code),'expired_rest_'+rest.status+'_'+rest.data.code);
  const refreshed=await api(a,1,'/api/v1/r2c-private',{action:'identity'});must(refreshed.status===200&&refreshed.data.userId===identity.data.userId,'ssr_refresh_identity');
  const fresh=await retained(a);must(fresh.access_token!==old.access_token,'cookie_rotated');
  must((await api(a,0,'/api/v1/auth/logout',{})).status===200,'local_logout');
  must((await api(a,1,'/api/v1/r2c-private',{action:'identity'})).status===401,'logout_browser_401');
  const window=await probe('/rest/v1/profiles?select=id',fresh.access_token);must(window.status===200&&window.data.length===1,'unexpired_access_window');
  const reuse=await fetch(c.api+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:c.anon,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:fresh.refresh_token})});const reuseError=await reuse.json();
  must(reuse.status===400&&reuseError.error_code==='refresh_token_not_found','revoked_refresh_'+reuse.status+'_'+reuseError.error_code);
  must((await api(a,1,'/api/v1/auth/login',{email:'a@r2c.invalid',password:c.password})).status===200,'relogin');
  must((await api(a,1,'/api/v1/r2c-private',{action:'identity'})).data.userId===identity.data.userId,'same_owner_after_relogin');
  must((await api(b,1,'/api/v1/r2c-private',{action:'identity'})).data.userId===bIdentity.data.userId,'b_not_revoked');
  const page=await a.newPage();await page.goto(origins[1]+'/settings',{waitUntil:'domcontentloaded'});must(new URL(page.url()).pathname==='/settings','browser_after_relogin');
  result={status:'PASS',evidence:{expiredAuth:{status:auth.status,code:auth.data.error_code},expiredPostgrest:{status:rest.status,code:rest.data.code},realWaitMs:Date.now()-started,
    ttl:claims.exp-claims.iat,postgrestDocumentedSkewSeconds:30,withinSkew:grace.status,cookieRefreshed:true,logoutBrowser:401,unexpiredAccessAfterLogout:200,revokedRefresh:{status:reuse.status,code:reuseError.error_code},relogin:true,bUnaffected:true}};
} catch(error){result={status:'FAIL',category:error.message?.match(/^[a-zA-Z0-9_ :.-]{1,140}$/)?.[0]??'driver_failure'};}
finally {
  if(browser){await browser.close();await writeFile(join(audit,`${process.pid}.browser.json`),JSON.stringify({version:'review-browser-routing/1',allowed,denied,nativeBackgroundHTTP:null,nativeBackgroundDNS:null}),{mode:0o600,flag:'wx'});}
  const text=JSON.stringify({J05:result,browserRouting:{allowed,denied}},null,2);await writeFile(join(root,'evidence/j05-retest.json'),text,{mode:0o600});await writeFile(join(process.env.R2C_RUN_DIRECTORY,'j05-retest.json'),text,{mode:0o600});
}
console.log(JSON.stringify(result));process.exitCode=result.status==='PASS'&&denied===0?0:1;
