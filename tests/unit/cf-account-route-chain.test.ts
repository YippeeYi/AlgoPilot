import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { emptyCfAccount } from "../fixtures/cf-account";

// Real route/Auth/repository/orchestrator; SDK and public HTTP are local substitutes.
const mocks = vi.hoisted(() => ({ create: vi.fn(), getUser: vi.fn(), getSession: vi.fn(), rpc: vi.fn(), fetcher: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));
import { GET, POST } from "@/app/api/v1/codeforces-account/route";
const uid = "70000000-0000-4000-8000-000000000001", secret = "ce".repeat(32);
const request = (extra = {}) => new Request("http://localhost/api/v1/codeforces-account", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "bind", handle: "Public_Handle", revision: 0, requestId: uid, ...extra }),
});
beforeEach(() => {
    vi.resetAllMocks(); vi.stubGlobal("fetch", mocks.fetcher); vi.stubEnv("CODEFORCES_RPC_SIGNING_SECRET", secret);
    mocks.create.mockResolvedValue({ auth: { getUser: mocks.getUser, getSession: mocks.getSession }, rpc: mocks.rpc });
    mocks.getUser.mockResolvedValue({ data: { user: { id: uid } }, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("returns configuration failure separately from actual getUser authentication, never trusting session identity", async () => {
    mocks.create.mockResolvedValueOnce(null);
    expect(await (await GET()).json()).toMatchObject({ error: { code: "SUPABASE_NOT_CONFIGURED" } });
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: uid } } } });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "private JWT" } });
    expect((await GET()).status).toBe(401); expect((await POST(request())).status).toBe(401);
    expect(mocks.getSession).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(["PGRST202", "42883"])("returns safe diagnosable 503 for unavailable state/command RPC (%s)", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE database structure JWT signature" } });
    for (const result of [await GET(), await POST(request())]) {
        expect(result.status).toBe(503); const body = await result.json();
        expect(body.error.code).toBe("CF_ACCOUNT_RPC_UNAVAILABLE"); expect(body.error.message).toContain("核对迁移和接口缓存");
        expect(JSON.stringify(body)).not.toContain("PRIVATE");
    }
    expect(mocks.fetcher).not.toHaveBeenCalled();
});
it("distinguishes command signing configuration, expired JWT, malformed service state and revision conflicts", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect(await (await POST(request())).json()).toMatchObject({ error: { code: "CF_SYNC_NOT_CONFIGURED" } });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST301" } }); expect((await GET()).status).toBe(401);
    mocks.rpc.mockResolvedValue({ data: { revision: 999 }, error: null }); expect((await GET()).status).toBe(503);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PT409" } }); expect((await POST(request())).status).toBe(409);
});
it("executes verified Auth → signed reserve/slot → official identity → signed save → fresh state, without exposing the private lease", async () => {
    const nonce = "80000000-0000-4000-8000-000000000001", scope = "90000000-0000-4000-8000-000000000001";
    const order: string[] = [];
    mocks.rpc.mockImplementation(async (name, args) => {
        if (name === "cf_account_state") { order.push("state"); return { data: { ...emptyCfAccount, handle: "Public_Handle", revision: 1, status: "never" }, error: null }; }
        expect(name).toBe("cf_account_command");
        expect(args.p_signature).toBe(createHmac("sha256", secret).update(args.p_payload).digest("hex"));
        const payload = JSON.parse(args.p_payload); expect(payload.userId).toBe(uid); expect(payload.operation).toBe("cf_account");
        order.push(payload.action);
        return { data: payload.action === "reserve" ? { acquired: true, nonce, scope, handle: "Public_Handle" } : payload.action === "slot" ? { waitMs: 0 } : { accepted: true }, error: null };
    });
    mocks.fetcher.mockImplementation(async (url: string) => { order.push("user.info"); expect(url).toContain("https://codeforces.com/api/user.info?"); return Response.json({ status: "OK", result: [{ handle: "Public_Handle", registrationTimeSeconds: 10 }] }); });
    const result = await POST(request()); expect(result.status).toBe(200);
    expect(order).toEqual(["reserve", "slot", "user.info", "bind", "state"]);
    expect(mocks.getUser).toHaveBeenCalledOnce(); const body = await result.json();
    expect(body.state).toMatchObject({ handle: "Public_Handle", revision: 1, ownershipVerified: false, enabled: false });
    for (const privateValue of [nonce, scope, secret, "p_signature", "registrationSeconds"]) expect(JSON.stringify(body)).not.toContain(privateValue);
    for (const forged of [{ userId: uid }, { p_signature: "forged" }, { nonce }, { revision: -1 }, { requestId: "invalid" }]) expect((await POST(request(forged))).status).toBe(422);
});
