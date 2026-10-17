import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CfAccountSettings } from "@/components/learning/cf-account";
import { emptyCfAccount } from "../fixtures/cf-account";

const fetcher = vi.fn<typeof fetch>();
const input = () => screen.getByLabelText("公开 CF Handle");
const bind = () => screen.getByRole("button", { name: /^关联公开账号$/ });
const reload = () => screen.getByRole("button", { name: "重新加载账号状态" });
const type = (value = "Public_Handle") => fireEvent.change(input(), { target: { value } });
const response = (state = emptyCfAccount) => Response.json({ state, notice: null });
function deferred() {
    let resolve!: (response: Response) => void;
    const promise = new Promise<Response>(r => { resolve = r; });
    return { promise, resolve };
}
beforeEach(() => { fetcher.mockReset(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => vi.unstubAllGlobals());

describe("CF Handle draft and authenticated account operations (local HTTP contracts)", () => {
    it("remains editable without configuration and makes no account requests", () => {
        render(<CfAccountSettings configured={false} />); type();
        expect(input()).toHaveValue("Public_Handle"); expect(input()).toBeEnabled();
        expect(bind()).toBeDisabled(); expect(reload()).toBeDisabled();
        expect(screen.getByRole("status")).toHaveTextContent("当前无法完成关联");
        expect(fetcher).not.toHaveBeenCalled();
    });
    it("preserves typing across an in-flight initial load and validates the complete Handle format", async () => {
        const load = deferred(); fetcher.mockReturnValueOnce(load.promise);
        render(<CfAccountSettings configured />); type("Draft_Handle");
        expect(bind()).toBeDisabled(); expect(screen.getByRole("status")).toHaveTextContent("正在加载");
        await act(async () => load.resolve(response()));
        expect(input()).toHaveValue("Draft_Handle"); expect(bind()).toBeEnabled();
        for (const invalid of ["", "ab", "a b", "x".repeat(25), "中文名称", "Public/Handle"]) { type(invalid); expect(bind()).toBeDisabled(); }
        type("  Public_Handle  "); expect(bind()).toBeEnabled();
    });
    it.each([
        [401, "UNAUTHENTICATED", "未登录或登录已过期"],
        [500, "UNKNOWN", "账号请求失败或超时"],
        [503, "DATABASE_UNAVAILABLE", "账号请求失败或超时"],
        [503, "CF_ACCOUNT_RPC_UNAVAILABLE", "账号数据库接口暂不可用"],
        [503, "SUPABASE_NOT_CONFIGURED", "Supabase 未配置或配置不完整"],
    ])("preserves the draft after GET %s/%s and recovers with a real state response", async (status, code, message) => {
        const load = deferred(); fetcher.mockReturnValueOnce(load.promise).mockResolvedValueOnce(response());
        render(<CfAccountSettings configured />); type();
        await act(async () => load.resolve(Response.json({ error: { code, message: "PRIVATE JWT SQL SIGNATURE" } }, { status })));
        expect(screen.getByRole("alert")).toHaveTextContent(message);
        expect(screen.getByRole("alert")).not.toHaveTextContent("PRIVATE");
        expect(input()).toHaveValue("Public_Handle"); expect(bind()).toBeDisabled();
        fireEvent.click(reload()); await waitFor(() => expect(bind()).toBeEnabled());
        expect(input()).toHaveValue("Public_Handle"); expect(screen.queryByRole("alert")).toBeNull();
    });
    it("does not fabricate a usable state from a malformed success response or overwrite typing on reload", async () => {
        const load = deferred(); fetcher.mockResolvedValueOnce(Response.json({ state: { revision: 99 } })).mockReturnValueOnce(load.promise);
        render(<CfAccountSettings configured />); type();
        await screen.findByRole("alert"); expect(bind()).toBeDisabled();
        fireEvent.click(reload()); type("Next_Draft"); expect(bind()).toBeDisabled();
        await act(async () => load.resolve(response({ ...emptyCfAccount, handle: "Server_Handle", revision: 4, status: "never" })));
        expect(input()).toHaveValue("Next_Draft");
        expect(screen.getByRole("link", { name: "Server_Handle" })).toBeVisible();
        expect(screen.getByRole("button", { name: "替换公开账号" })).toBeEnabled();
    });
    it("locks conflicting buttons during binding, accepts edits, and shows only the confirmed server association", async () => {
        const post = deferred(); fetcher.mockResolvedValueOnce(response()).mockReturnValueOnce(post.promise);
        render(<CfAccountSettings configured />); type("  Public_Handle  "); await waitFor(() => expect(bind()).toBeEnabled());
        const button = bind(); fireEvent.click(button); fireEvent.click(button);
        expect(button).toBeDisabled(); expect(reload()).toBeDisabled(); type("New_Draft");
        expect(input()).toBeEnabled(); expect(fetcher).toHaveBeenCalledTimes(2);
        const body = JSON.parse(fetcher.mock.calls[1]![1]!.body as string);
        expect(body).toEqual({ action: "bind", handle: "Public_Handle", revision: 0, requestId: expect.any(String) });
        await act(async () => post.resolve(response({ ...emptyCfAccount, handle: "Canonical_Handle", revision: 1, status: "never" })));
        expect(screen.getByRole("link", { name: "Canonical_Handle" })).toBeVisible(); expect(input()).toHaveValue("New_Draft");
    });
    it("keeps a valid existing association after an invalid Handle and recovers without replaying a stale request", async () => {
        const old = { ...emptyCfAccount, handle: "Old_Handle", revision: 3, status: "never" as const };
        fetcher.mockResolvedValueOnce(response(old)).mockResolvedValueOnce(Response.json({ error: { code: "CF_HANDLE_INVALID", message: "private upstream" } }, { status: 422 })).mockResolvedValueOnce(response(old));
        render(<CfAccountSettings configured />); type("Invalid_Handle");
        const button = await screen.findByRole("button", { name: "替换公开账号" }); fireEvent.click(button);
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("原关联未被替换"));
        await waitFor(() => expect(button).toBeEnabled());
        expect(screen.getByRole("link", { name: "Old_Handle" })).toBeVisible(); expect(input()).toHaveValue("Invalid_Handle");
        expect(screen.queryByRole("button", { name: "重试上次请求" })).toBeNull();
    });
    it("handles login expiry during POST without losing either the draft or the last confirmed association", async () => {
        const old = { ...emptyCfAccount, handle: "Old_Handle", revision: 3, status: "never" as const };
        const expired = () => Response.json({ error: { code: "UNAUTHENTICATED", message: "private JWT" } }, { status: 401 });
        fetcher.mockResolvedValueOnce(response(old)).mockImplementationOnce(async () => expired()).mockImplementationOnce(async () => expired());
        render(<CfAccountSettings configured />); type("New_Draft");
        fireEvent.click(await screen.findByRole("button", { name: "替换公开账号" }));
        await waitFor(() => expect(reload()).toBeEnabled());
        expect(screen.getAllByRole("alert").map(e => e.textContent).join(" ")).toContain("登录已过期");
        expect(input()).toHaveValue("New_Draft"); expect(input()).toBeEnabled();
        expect(screen.getByRole("link", { name: "Old_Handle" })).toBeVisible();
        expect(screen.getByRole("button", { name: "替换公开账号" })).toBeDisabled();
    });
    it("retains the identical pending request after an unknown result, disables writes until recovery, and preserves later edits", async () => {
        const old = { ...emptyCfAccount, handle: "Old_Handle", revision: 3, status: "never" as const };
        fetcher.mockResolvedValueOnce(response(old)).mockRejectedValueOnce(new DOMException("private network", "TimeoutError"))
            .mockRejectedValueOnce(new Error("private refresh"))
            .mockResolvedValueOnce(response(old)).mockResolvedValueOnce(response({ ...old, handle: "Public_Handle", revision: 4 }));
        render(<CfAccountSettings configured />); type();
        fireEvent.click(await screen.findByRole("button", { name: "替换公开账号" }));
        const retry = await screen.findByRole("button", { name: "重试上次请求" });
        await waitFor(() => expect(reload()).toBeEnabled()); expect(retry).toBeDisabled();
        type("Next_Draft"); fireEvent.click(reload()); await waitFor(() => expect(retry).toBeEnabled()); fireEvent.click(retry);
        await screen.findByRole("link", { name: "Public_Handle" });
        expect(fetcher.mock.calls[4]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body);
        expect(input()).toHaveValue("Next_Draft");
    });
});
