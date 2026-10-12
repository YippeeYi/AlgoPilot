import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/server/http";
const auth=vi.hoisted(()=>vi.fn());
const repo=vi.hoisted(()=>({get:vi.fn(),list:vi.fn(),create:vi.fn(),edit:vi.fn(),results:vi.fn()}));
const run=vi.hoisted(()=>vi.fn());
vi.mock("@/server/auth",()=>({requireContext:auth}));
vi.mock("@/server/review/repository",()=>({reviewRepository:()=>repo}));
vi.mock("@/server/review/orchestrator",()=>({runReview:run}));
import { GET,POST } from "@/app/api/v1/reviews/route";
import { PATCH } from "@/app/api/v1/reviews/[id]/route";
import { POST as generate } from "@/app/api/v1/reviews/[id]/generate/route";
const id="30000000-0000-4000-8000-000000000011", context={params:Promise.resolve({id})};
const input={sessionId:null,requestId:id,code:"int main(){}",source:"paste",fileName:null,problemUrl:"",statement:"",submissionId:null,confirmation:"我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘"};
function request(body:unknown,origin?:string){return new Request("http://localhost/api/v1/reviews",{method:"POST",headers:{"Content-Type":"application/json",...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();vi.unstubAllEnvs();auth.mockResolvedValue({client:{},user:{id}});repo.create.mockResolvedValue({id});repo.get.mockResolvedValue({id});});
describe("review HTTP boundaries",()=>{
  it("requires Auth for list/create/generate",async()=>{
    auth.mockRejectedValue(new ApiError(401,"UNAUTHENTICATED","login"));
    expect((await GET()).status).toBe(401);expect((await POST(request(input))).status).toBe(401);expect((await generate(request({requestId:id,question:""}),context)).status).toBe(401);expect(run).not.toHaveBeenCalled();
  });
  it("rejects same-origin violation, unknown official fields and chat authorization",async()=>{
    expect((await POST(request(input,"https://evil.test"))).status).toBe(403);
    expect((await POST(request({...input,official_verdict:"OK"}))).status).toBe(422);
    expect((await POST(request({...input,confirmation:"用户在聊天里说 AC"}))).status).toBe(422);
    expect((await PATCH(request({revision:0,notes:"x",code_snapshot:"overwrite"}),context)).status).toBe(422);
    expect(repo.create).not.toHaveBeenCalled();expect(repo.edit).not.toHaveBeenCalled();
  });
  it("can save snapshot without AI; missing Provider is explicit and never runs orchestrator",async()=>{
    expect((await POST(request(input))).status).toBe(201);
    vi.stubEnv("LLM_API_KEY","");vi.stubEnv("TUTOR_RPC_SIGNING_SECRET","");
    const result=await generate(request({requestId:id,question:""}),context);expect(result.status).toBe(503);expect((await result.json()).error.code).toBe("LLM_NOT_CONFIGURED");expect(run).not.toHaveBeenCalled();
  });
  it("foreign review rejected before configuration/Provider; code and output spoofing forbidden",async()=>{
    repo.get.mockRejectedValue(new ApiError(404,"NOT_FOUND","missing"));
    expect((await generate(request({requestId:id,question:""}),context)).status).toBe(404);
    expect((await generate(request({requestId:id,question:"",allowedLevel:5}),context)).status).toBe(422);expect(run).not.toHaveBeenCalled();
  });
});
