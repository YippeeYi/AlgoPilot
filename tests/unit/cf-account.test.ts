import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { parseUserInfo, parseUserStatus } from "@/server/codeforces/account-parser";
import { fetchCfPublic } from "@/server/codeforces/account-upstream";
import { initialCfCursor, advanceCfCursor } from "@/features/learning/cf-cursor";
import { cfAccountInputSchema, cfSyncInputSchema } from "@/lib/validation/cf-account";
import { abilityProfile, recommend, recommendationTarget } from "@/features/learning/engine";
import { emptyEvidence, training, fixtureId, syntheticCatalog } from "../evaluation/scenarios";
const statusRow = (id: number, verdict?: string) => ({ id, creationTimeSeconds: 10000, problem: { contestId: 100, index: 'A', name: 'Discarded', tags:['dp'] }, author: { members: [{handle:'Public_Handle'}] }, ...(verdict ? {verdict} : {}), programmingLanguage: 'C++', source: 'DO NOT PERSIST', timeConsumedMillis: 42 });
describe("official source validation and stable cursor semantics", () => {
    it("accepts only current public identity, drops unnecessary info, rejects invalid handles and aliases", () => {
        expect(parseUserInfo({status:'OK',result:[{handle:'Public_Handle',registrationTimeSeconds:10,email:'private@example.invalid',rating:3000}]},'public_handle')).toEqual({handle:'Public_Handle',registrationSeconds:10});
        expect(()=>parseUserInfo({status:'FAILED',comment:'handle: User with handle X not found'},'X')).toThrow();
        expect(()=>parseUserInfo({status:'OK',result:[{handle:'Other_Handle',registrationTimeSeconds:10}]},'Public_Handle')).toThrow();
        expect(cfAccountInputSchema.safeParse({action:'bind',handle:'a;b',revision:0,requestId:randomUUID()}).success).toBe(false);
        expect(cfSyncInputSchema.safeParse({revision:0,requestId:randomUUID(),verdict:'OK',userId:randomUUID()}).success).toBe(false);
    });
    it("validates descending IDs, membership, missing metadata/verdict and excludes all source code", () => {
        const rows=parseUserStatus({status:'OK',result:[statusRow(2,'OK'),statusRow(1)]},'Public_Handle',200);
        expect(rows[0]).toEqual({submissionId:2,contestId:100,index:'A',createdSeconds:10000,verdict:'OK'}); expect(rows[1]!.verdict).toBeNull();
        expect(JSON.stringify(rows)).not.toContain('DO NOT PERSIST'); expect(JSON.stringify(rows)).not.toContain('C++');
        expect(parseUserStatus({status:'OK',result:[statusRow(Number.MAX_SAFE_INTEGER,'OK')]},'Public_Handle',200)[0]!.submissionId).toBe(Number.MAX_SAFE_INTEGER);
        expect(parseUserStatus({status:'OK',result:[{...statusRow(3),problem:{index:'A',problemsetName:'unknown'}}]},'Public_Handle',200)[0]).toMatchObject({contestId:null,index:null});
        for(const result of [[statusRow(1),statusRow(2)],[statusRow(2),statusRow(2)],[{...statusRow(1),author:{members:[{handle:'Other_Handle'}]}}]]) expect(()=>parseUserStatus({status:'OK',result},'Public_Handle',200)).toThrow();
    });
    it("uses fixed endpoints, public parameters, no redirects/source/private auth, bounded and valid JSON", async () => {
        const fetcher=vi.fn().mockResolvedValue(Response.json({status:'OK',result:[]}));
        await fetchCfPublic('user.status',{handle:'Public_Handle',from:'1',count:'200'},fetcher);
        const url=new URL(fetcher.mock.calls[0]![0] as string); expect(url.origin).toBe('https://codeforces.com'); expect(url.searchParams.get('includeSources')).toBe('false'); expect(url.searchParams.has('apiKey')).toBe(false);
        expect(fetcher.mock.calls[0]![1]).toMatchObject({redirect:'error',cache:'no-store'});
        await expect(fetchCfPublic('user.info',{},vi.fn().mockResolvedValue(new Response('',{status:429})))).rejects.toMatchObject({category:'rate_limit'});
        await expect(fetchCfPublic('user.info',{},vi.fn().mockRejectedValue(new Error('PRIVATE')))).rejects.toMatchObject({category:'network'});
        await expect(fetchCfPublic('user.info',{},vi.fn().mockRejectedValue(new DOMException('timeout','TimeoutError')))).rejects.toMatchObject({category:'network'});
        expect(fetcher.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
        await expect(fetchCfPublic('user.info',{},vi.fn().mockResolvedValue(new Response('x',{headers:{'content-length':'3000001'}})))).rejects.toMatchObject({category:'invalid_response'});
    });
    it("does not equate a short page or budget with completeness, requires EOF and restarts a lost overlap", () => {
        const cycle=randomUUID(), c=initialCfCursor(cycle), page=Array.from({length:200},(_,i)=>1000-i);
        const next=advanceCfCursor(c,page,randomUUID()); expect(next).toMatchObject({from:161,anchor:801,done:false,probe:false,top:1000});
        const shifted=Array.from({length:200},(_,i)=>870-i); expect(advanceCfCursor(next,shifted,randomUUID())).toMatchObject({from:321,anchor:671,done:false});
        const lost=advanceCfCursor(next,Array.from({length:200},(_,i)=>1500-i),randomUUID()); expect(lost).toMatchObject({from:1,anchor:null,done:false,gaps:1});
        const short=advanceCfCursor(c,[5,4,3],randomUUID());expect(short).toMatchObject({probe:true,from:4,done:false});expect(advanceCfCursor(short,[],randomUUID()).done).toBe(true);
        expect(advanceCfCursor(short,[3,2],randomUUID())).toMatchObject({from:1,done:false,gaps:1});
        expect(advanceCfCursor(initialCfCursor(cycle,900),page,randomUUID(),true)).toMatchObject({done:true,top:1000});
        expect(advanceCfCursor(initialCfCursor(cycle,10),page,randomUUID(),true).done).toBe(false);
    });
});
describe("shared evidence profile and recommendation fusion",()=>{
    it("deduplicates official AC with training, retains conflicts/hints and never raises target from public AC",()=>{
        const e=emptyEvidence();e.preferences={min:800,max:2600,themes:[],goal:'balanced',repeat:false,reviewEvidence:false};
        e.sessions=[{...training(1,1000,'dp',4),problemId:fixtureId(1),outcome:'unsolved'}];e.totalSessions=1;
        const item={id:fixtureId(900001),submissionId:1,contestId:10000,index:'A',problemId:fixtureId(1),rating:1000,tags:['dp'],createdAt:'2026-10-14T00:00:00Z',observedAt:'2026-10-15T00:00:00Z'};
        e.official={revision:1,enabled:true,handle:'Public_Handle',ownershipVerified:false,totalAcceptedProblems:1,lastSyncedAt:'2026-10-15T00:00:00Z',lastFullScanAt:null,fullScanUpperId:null,oldestObservedAt:null,items:[item,{...item,id:fixtureId(900002),submissionId:2}]};
        const p=abilityProfile(e);expect(p.directions[0]).toMatchObject({samples:1,officialAccepted:1,selfReportedSolved:0,highHints:1,unresolved:1,confidence:'样本不足'});
        expect(p.directions[0]!.weakness).toBe(2/3); expect(recommendationTarget(e)).toEqual(recommendationTarget({...e,official:undefined}));
        const pool=syntheticCatalog(2).map(c=>({...c,rating:1000,tags:['dp']}));const r=recommend(e,pool);expect(r.items.map(i=>i.problem.id)).not.toContain(fixtureId(1));
        expect(r.items[0]!.refs.some(ref=>ref.kind==='official_submission')).toBe(true);expect(r.items[0]!.reasons.join()).toContain('不证明属于本人');
        e.official.enabled=false;expect(recommend(e,pool).items).toEqual(recommend({...e,official:undefined},pool).items);expect(abilityProfile(e).official.analyzedAccepted).toBe(0);
    });
    it("many low-difficulty official AC are coverage, not advanced mastery or a dilution of actual hint dependence",()=>{
        const e=emptyEvidence();e.preferences={min:1400,max:1800,themes:[],goal:'independence',repeat:false,reviewEvidence:false};e.sessions=Array.from({length:5},(_,i)=>training(i+1,1600,'dp',4));e.totalSessions=5;
        const base=abilityProfile(e).directions[0]!;
        e.official={revision:2,enabled:true,handle:'Public_Handle',ownershipVerified:false,totalAcceptedProblems:100,lastSyncedAt:null,lastFullScanAt:null,fullScanUpperId:null,oldestObservedAt:null,items:Array.from({length:100},(_,i)=>({id:fixtureId(800000+i),submissionId:i+1,contestId:20000+i,index:'A',problemId:null,rating:800,tags:['dp'],createdAt:'2026-10-14T00:00:00Z',observedAt:'2026-10-15T00:00:00Z'}))};
        expect(abilityProfile(e).directions[0]!.weakness).toBe(base.weakness);expect(recommendationTarget(e).target).toBe(1500);
        const pool=[{...syntheticCatalog(1)[0]!,rating:1500,tags:['dp']}];expect(recommend(e,pool).items).toEqual(recommend({...e,official:undefined},pool).items);
        expect(abilityProfile(e).bands.find(b=>b.min===800)!.officialAccepted).toBe(100);
    });
});
