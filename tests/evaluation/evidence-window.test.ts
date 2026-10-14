import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import { evidenceSchema } from "@/lib/validation/learning";
import { abilityProfile } from "@/features/learning/engine";
import { alice, bob, database, publish, query } from "./database";
vi.mock("server-only",()=>({}));
let db:PGlite;
beforeAll(async()=>{db=await database();},30000);
afterAll(()=>db?.close());
it('measures actual 500/200 window loss, repeated-review deduplication and consent isolation',async()=>{
 const confirmation='我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘';
 await publish(db,Array.from({length:205},(_,i)=>({contestId:50000+i,index:'A',name:'[SYNTHETIC] window probe',rating:1600,tags:[i<5?'graphs':'dp'],solvedCount:null})));
 const ids=(await db.query<{id:string;contest_id:number}>('select id,contest_id from public.problems order by contest_id')).rows;
 for(const [n,p] of ids.entries()) {
  const input={sessionId:null,requestId:randomUUID(),code:'int main(){}',source:'paste',fileName:null,problemUrl:'',statement:'[FIXTURE] controlled record',submissionId:null,confirmation};
  const reviewId=(await query<{v:string}>(db,'select public.create_cf_review($1,$2::jsonb) v',[p.id,JSON.stringify(input)])).rows[0]!.v;
  // Administrator-seeded analysis for window stress only; not a real Provider evaluation.
  await db.query("insert into public.review_requests(id,review_id,user_id,fingerprint,question,status,analysis,model,prompt_version,created_at,finished_at) values($1,$2,$3,$4,'','completed',$5::jsonb,'fixture-not-provider','fixture/window',$6,$6)",[randomUUID(),reviewId,alice,'a'.repeat(64),JSON.stringify({transferableKnowledge:n<5?'图论':'动态规划',risks:''}),new Date(Date.UTC(2026,0,1)+n*60000).toISOString()]);
 }
 const prefs={min:1400,max:1800,themes:[],goal:'independence',repeat:false,reviewEvidence:true};
 await query(db,'select public.learning_write($1::jsonb)',[JSON.stringify({action:'preferences',requestId:randomUUID(),revision:0,preferences:prefs})]);
 const read=async(uid=alice)=>evidenceSchema.parse((await query<{v:unknown}>(db,'select public.learning_evidence() v',[],uid)).rows[0]!.v);
 const before=await read();expect(before.sessions).toHaveLength(205);expect(before.reviews).toHaveLength(200);expect(before.reviews.some(r=>r.knowledge.includes('图论'))).toBe(false);
 const selected=before.reviews[0]!;
 await db.query("insert into public.review_requests(id,review_id,user_id,fingerprint,question,status,analysis,model,prompt_version,created_at,finished_at) values($1,$2,$3,$4,'','completed',$5::jsonb,'fixture-not-provider','fixture/window',clock_timestamp(),clock_timestamp())",[randomUUID(),selected.reviewId,alice,'b'.repeat(64),JSON.stringify({transferableKnowledge:'动态规划（再次生成）',risks:''})]);
 expect((await read()).reviews).toHaveLength(200);
 // 500 legitimate newer attempts on one CF problem can push out all earlier completed samples.
 for(let n=0;n<500;n++)await query(db,'select id from public.start_cf_session($1::jsonb)',[JSON.stringify({problemId:ids.at(-1)!.id,requestId:randomUUID()})]);
 const after=await read();expect(after.totalSessions).toBe(705);expect(after.sessions).toHaveLength(500);expect(abilityProfile(after).distinctCompletedProblems).toBe(0);expect(abilityProfile(after).limitations.join()).toContain('不代表长期全部能力');
 expect((await read(bob)).sessions).toEqual([]);expect((await read(bob)).reviews).toEqual([]);
 await query(db,'select public.learning_write($1::jsonb)',[JSON.stringify({action:'preferences',requestId:randomUUID(),revision:1,preferences:{...prefs,reviewEvidence:false}})]);
 expect((await read()).reviews).toEqual([]);expect((await db.query<{n:number}>('select count(*)::int n from public.review_requests')).rows[0]!.n).toBe(206);
 if(process.env.M321_EVALUATION_OUTPUT) {await mkdir(process.env.M321_EVALUATION_OUTPUT,{recursive:true});await writeFile(`${process.env.M321_EVALUATION_OUTPUT}/evidence-windows.json`,JSON.stringify({source:'SYNTHETIC actual SQL stress; fixed administrator-seeded analyses, no Provider call',training:{total:705,retained:500,earlierCompleted:205,completedInWindow:0},reviews:{distinctProblems:205,analysisRecords:206,retained:200,oldGraphReviews:5,graphReviewsInWindow:0,duplicateRegenerationDidNotInflate:true},revocationPreserves206Analyses:true},null,2)+'\n');}
},30000);
