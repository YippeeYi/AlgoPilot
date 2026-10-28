import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { skillEvidence,skillId,skillNow } from "../fixtures/skill-intelligence";
import { ApiError } from "@/server/http";
import { defaultPreferences } from "@/lib/validation/learning";
const auth = vi.hoisted(() => vi.fn());
const repo = vi.hoisted(() => ({ evidence: vi.fn(), candidates: vi.fn(), write: vi.fn(), assertRevision: vi.fn() }));
const cf = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth", () => ({ requireContext: auth }));
vi.mock("@/server/learning/repository", () => ({ learningRepository: () => repo }));
vi.mock("@/server/codeforces/repository", () => ({ cfRepository: () => ({}) }));
vi.mock("@/server/codeforces/catalog", () => ({ catalog: cf }));
import { GET as profileRoute } from "@/app/api/v1/learning/route";
const profile = (request = new Request("http://localhost/api/v1/learning")) => profileRoute(request);
import { POST as rec } from "@/app/api/v1/recommendations/route";
import { POST as prefs } from "@/app/api/v1/learning/preferences/route";
import { POST as feedback } from "@/app/api/v1/learning/feedback/route";
const id = "70000000-0000-4000-8000-000000000001";
const req = (body: unknown, origin?: string) => new Request("http://localhost/api/v1/recommendations", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); auth.mockResolvedValue({ client: {}, user: { id } }); repo.evidence.mockResolvedValue({ preferences: null, revision: 0, totalSessions: 0, sessions: [], reviews: [], feedback: [] }); repo.candidates.mockResolvedValue({ items: [], total: 0 }); repo.write.mockResolvedValue(undefined); repo.assertRevision.mockResolvedValue(undefined); cf.mockResolvedValue({ syncedAt: "2026-10-12T00:00:00Z", stale: true, notice: "缓存回退" }); });
describe("learning API Auth, origin, field whitelist and safe output", () => {
    it("refuses unauthenticated reads and mutations without accessing private repositories", async () => { auth.mockRejectedValue(new ApiError(401, "UNAUTHENTICATED", "login")); for (const r of [await profile(), await rec(req({})), await prefs(req({})), await feedback(req({}))])
        expect(r.status).toBe(401); expect(repo.evidence).not.toHaveBeenCalled(); expect(repo.write).not.toHaveBeenCalled(); });
    it("blocks owner/official/mastery mass assignment and cross-origin", async () => { expect((await prefs(req({ requestId: id, revision: 0, preferences: defaultPreferences, userId: id }))).status).toBe(422); expect((await feedback(req({ requestId: id, problemId: id, kind: "too_easy", officialVerdict: "OK" }))).status).toBe(422); expect((await rec(req({}, "https://evil.test"))).status).toBe(403); expect((await rec(req({ target: 3000 }))).status).toBe(422); expect(repo.write).not.toHaveBeenCalled(); });
    it("writes only validated preferences/feedback and uses RPC evidence for ranking", async () => { expect((await prefs(req({ requestId: id, revision: 0, preferences: defaultPreferences }))).status).toBe(200); expect(repo.write).toHaveBeenCalledWith({ action: "preferences", requestId: id, revision: 0, preferences: defaultPreferences }); expect((await feedback(req({ requestId: id, problemId: id, kind: "too_hard" }))).status).toBe(200); const r = await rec(req({})); expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ items: [], stale: true, notice: "缓存回退" }); expect(repo.candidates).toHaveBeenCalledWith(defaultPreferences, 1000); });
    it("safe service errors do not contain sensitive SDK originals or turn unavailable cache into recommendations", async () => { cf.mockRejectedValue(new Error("PRIVATE_API_KEY")); const r = await rec(req({})); expect(r.status).toBe(503); expect(JSON.stringify(await r.json())).not.toContain("PRIVATE_API_KEY"); expect(repo.candidates).not.toHaveBeenCalled(); });
});

it("refuses stale recommendations when preferences or review consent changed during cache refresh",async()=>{
  repo.evidence.mockResolvedValue({preferences:{...defaultPreferences,reviewEvidence:true},revision:1,totalSessions:0,sessions:[],reviews:[],feedback:[]});
  repo.assertRevision.mockRejectedValue(new ApiError(409,"LEARNING_EVIDENCE_CHANGED","retry"));
  const r=await rec(req({}));expect(r.status).toBe(409);expect(await r.json()).not.toHaveProperty("items");expect(repo.assertRevision).toHaveBeenCalledWith(1);
});

it('guards official evidence revision on both profile and recommendations, returning no stale items after revoke',async()=>{
  repo.evidence.mockResolvedValue({preferences:null,revision:0,totalSessions:0,sessions:[],reviews:[],feedback:[],official:{revision:7,enabled:false,handle:'Public_Handle',ownershipVerified:false,totalAcceptedProblems:0,lastSyncedAt:null,lastFullScanAt:null,fullScanUpperId:null,oldestObservedAt:null,items:[]}});
  repo.assertRevision.mockRejectedValue(new ApiError(409,'LEARNING_EVIDENCE_CHANGED','retry'));
  expect((await profile()).status).toBe(409);expect((await rec(req({}))).status).toBe(409);expect(repo.assertRevision).toHaveBeenCalledWith(0,7);
});

describe("windowed diagnosis and explicit one-request training focus",()=>{
  beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(skillNow);repo.evidence.mockResolvedValue(skillEvidence(5));});
  afterEach(()=>vi.restoreAllMocks());
  it("validates window/owner query fields and returns bounded current evidence without invoking CF",async()=>{
    for(const query of ['window=365','window=30&userId=other'])expect((await profile(new Request('http://localhost/api/v1/learning?'+query))).status).toBe(422);
    const r=await profile(new Request('http://localhost/api/v1/learning?window=7'));expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await r.json()).toMatchObject({intelligence:{window:'7',asOf:new Date(skillNow).toISOString(),recent:{completedProblems:5}}});expect(cf).not.toHaveBeenCalled();
  });
  it("derives focus from fresh owned evidence, filters before shortlist, retains target/weights/exclusions and saved preferences",async()=>{
    const candidate=(n:number,tags:string[])=>({id:skillId(n),contestId:30000+n,index:'A',name:'Fixture',rating:1400,tags,inPlan:false,practiced:false,solvedCount:null});
    repo.candidates.mockResolvedValue({total:3,items:[candidate(900,['graphs']),candidate(901,['math']),candidate(10001,['graphs'])]});
    const r=await rec(req({focus:{topic:'graphs',window:'30'}}));expect(r.status).toBe(200);const body=await r.json();
    expect(body.items.map((i:{problem:{id:string}})=>i.problem.id)).toEqual([skillId(900)]);
    expect(body.items[0].reasons.join()).toContain('5 道题有明确结果，其中 5 道');expect(body.items[0].refs).toContainEqual({kind:'training',id:skillId(1)});
    expect(body.preferences.themes).toEqual([]);expect(repo.candidates).toHaveBeenCalledWith(expect.objectContaining({themes:['graphs'],min:1200,max:1800,repeat:false}),1300);
    expect(repo.write).not.toHaveBeenCalled();
  });
  it("rejects forged, insufficient, expired or unsupported actions before touching catalog",async()=>{
    for(const focus of [{topic:'graphs',window:'365'},{topic:'unknown',window:'30'},{topic:'graphs',window:'30',count:5}])expect((await rec(req({focus}))).status).toBe(422);
    expect((await rec(req({focus:{topic:'math',window:'30'}}))).status).toBe(409);
    const e=skillEvidence(4);repo.evidence.mockResolvedValue(e);expect((await rec(req({focus:{topic:'graphs',window:'30'}}))).status).toBe(409);
    e.sessions=skillEvidence(5).sessions.map(s=>({...s,createdAt:'2026-01-01T00:00:00Z'}));expect((await rec(req({focus:{topic:'graphs',window:'7'}}))).status).toBe(409);
    expect(cf).not.toHaveBeenCalled();expect(repo.candidates).not.toHaveBeenCalled();
  });
  it("does not return stale focus recommendations after consent revision changed",async()=>{
    repo.assertRevision.mockRejectedValue(new ApiError(409,'LEARNING_EVIDENCE_CHANGED','retry'));
    const r=await rec(req({focus:{topic:'graphs',window:'30'}}));expect(r.status).toBe(409);expect(await r.json()).not.toHaveProperty('items');
  });
});
