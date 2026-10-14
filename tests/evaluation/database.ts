import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
import { signTutorPayload } from "@/server/tutor/repository";
export const alice="72000000-0000-4000-8000-000000000001", bob="72000000-0000-4000-8000-000000000002", fixtureSecret="ce".repeat(32);
export async function database(upTo = "999999999999") {
 const db=new PGlite({extensions:{pgcrypto}});
 await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;");
 const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')&&f.slice(0,12)<=upTo).sort();
 for(const f of files)await db.exec(await readFile(`supabase/migrations/${f}`,'utf8'));
 await db.query("insert into auth.users values($1,'alice@fixture.invalid'),($2,'bob@fixture.invalid')",[alice,bob]);
 await db.query("insert into algopilot_private.tutor_settings(signing_secret) values($1)",[fixtureSecret]);
 await db.query("insert into algopilot_private.cf_settings(signing_secret) values($1)",[fixtureSecret]);
 return db;
}
export async function query<T>(db:PGlite,q:string,args:unknown[]=[],uid=alice) {
 return db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);return tx.query<T>(q,args);});
}
export async function publish(db:PGlite, problems: unknown[]) {
 // Test-only stable UUID mapping makes metadata replay independent of random initial DB IDs.
 // The following signed publication still determines every trusted metadata field/version.
 await db.query(`insert into public.problems(id,platform,contest_id,problem_index,title,canonical_url)
 select (substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid,
 'codeforces',(x->>'contestId')::integer,x->>'index',x->>'name','https://codeforces.com/problemset/problem/'||(x->>'contestId')||'/'||(x->>'index')
 from (select x,md5((x->>'contestId')||'/'||(x->>'index')) h from jsonb_array_elements($1::jsonb) x) a
 on conflict(platform,contest_id,problem_index) where platform='codeforces' do nothing`,[JSON.stringify(problems)]);
 const signed=async(p:Record<string,unknown>)=>{const s=signTutorPayload({operation:'cf_sync',...p},alice,fixtureSecret);return query<{v:{nonce?:string}}>(db,'select public.cf_sync($1,$2) v',[s.p_payload,s.p_signature]);};
 await db.exec("update algopilot_private.cf_cache_state set next_attempt_at='-infinity',next_slot_at='-infinity'");
 const nonce=(await signed({action:'reserve',force:true})).rows[0]!.v.nonce;
 await signed({action:'slot',nonce});await signed({action:'publish',nonce,problems});
}
