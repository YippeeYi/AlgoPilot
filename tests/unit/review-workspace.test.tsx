import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewWorkspace } from "@/components/reviews/review-workspace";
import type { CodeReview, ReviewResult } from "@/lib/validation/review";

const review = {
  id: "10000000-0000-4000-8000-000000000011", user_id: "10000000-0000-4000-8000-000000000012",
  session_id: "10000000-0000-4000-8000-000000000013", problem_id: null,
  problem_url: "", statement_snapshot: "合成题面", code_snapshot: "int main() {}", code_hash: "a".repeat(64),
  source: "paste", file_name: null, submission_id: null, verdict_source: "user_reported", official_verdict: null,
  source_match: "unverified", authorization_event: { status: "paused", outcome: null, allowedLevel: 0,
    maxSeenLevel: 0, confirmation: "fixture", authorizedAt: "2026-10-26T00:00:00Z" },
  notes: "已保存的用户笔记", revision: 0, created_at: "2026-10-26T00:00:00Z", edited_at: null,
} satisfies CodeReview;
const result = {
  id: "10000000-0000-4000-8000-000000000014", review_id: review.id, question: "",
  analysis: { summary: "原有分析", correctness: "未运行代码。", assumptions: "输入前提待核对。", timeComplexity: "O(1)",
    spaceComplexity: "O(1)", lineAnalysis: [{ start: 1, end: 1, analysis: "入口" }], risks: "待核对", improvements: "待核对",
    alternatives: "", transferableKnowledge: "边界", revisionQuestions: ["前提是什么？"], answer: "" },
  model: "fixture", prompt_version: "review/test", created_at: review.created_at,
} satisfies ReviewResult;
const fetcher = vi.fn<typeof fetch>();
const post = vi.fn<typeof fetch>();
const generate = () => screen.getByRole("button", { name: "重新生成 AI 复盘" });
const retry = () => screen.getByRole("button", { name: "重试上次生成请求" });
const question = () => screen.getByLabelText("后续复盘问题", { exact: true });
const error = (status: number, code: string) => Response.json({ error: { code, message: "固定安全错误。" } }, { status });
const body = (index: number) => JSON.parse(post.mock.calls[index]![1]!.body as string);
async function mount() {
  render(<ReviewWorkspace initialReviewId={review.id} />);
  await waitFor(() => expect(generate()).toBeEnabled());
}
beforeEach(() => {
  post.mockReset(); fetcher.mockReset();
  fetcher.mockImplementation(async (path, init) => {
    if (init?.method === "POST") return post(path, init);
    if (path === "/api/v1/reviews") return Response.json({ items: [review] });
    if (path === "/api/v1/sessions?limit=50") return Response.json({ items: [] });
    if (path === `/api/v1/reviews/${review.id}`) return Response.json({ review, results: [result], configured: true });
    throw new Error("Unexpected fixture request");
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());

describe("review generation retries (offline browser contracts)", () => {
  it("gate refusal retains drafts/history and ends the ticket without claiming a timeout or automatic retry", async () => {
    post.mockResolvedValueOnce(error(403, "LLM_FREE_TIER_UNVERIFIED"));
    await mount();
    fireEvent.change(question(), { target: { value: "保留的追问草稿" } });
    fireEvent.click(generate());
    await waitFor(() => expect(generate()).toBeEnabled());
    expect(question()).toHaveValue("保留的追问草稿");
    expect(screen.getByText("原有分析", { exact: true })).toBeVisible();
    expect(screen.queryByRole("button", { name: "重试上次生成请求" })).toBeNull();
    expect(screen.getByRole("alert", { name: "复盘错误" })).not.toHaveTextContent("可能已产生模型用量");
    expect(post).toHaveBeenCalledOnce();
  });
  it("reuses the original request after a lost response; a later explicit regeneration gets a new ID", async () => {
    post.mockRejectedValueOnce(new TypeError("PRIVATE transport details"))
      .mockResolvedValueOnce(Response.json({ results: [result], cached: true }))
      .mockResolvedValueOnce(Response.json({ results: [result], cached: false }));
    await mount();
    fireEvent.change(question(), { target: { value: "检查边界条件。" } });
    fireEvent.click(generate());
    await waitFor(() => expect(screen.getByRole("alert", { name: "复盘错误" })).toBeVisible());
    fireEvent.click(retry());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(body(1)).toEqual(body(0));
    await waitFor(() => expect(generate()).toBeEnabled());
    expect(question()).toHaveValue("");
    fireEvent.change(question(), { target: { value: "检查边界条件。" } });
    fireEvent.click(generate());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(body(2).requestId).not.toBe(body(0).requestId);
    expect(body(2).question).toBe(body(0).question);
    expect(post.mock.calls[1]![0]).toBe(post.mock.calls[0]![0]);
  });

  it.each(["network", "invalid_json", "invalid_contract", "503", "502"])("preserves drafts and history on %s without automatically retrying", async (failure) => {
    post.mockImplementationOnce(async () => {
      if (failure === "network") throw new Error("PRIVATE upstream URL and key");
      if (failure === "invalid_json") return new Response("not json");
      if (failure === "invalid_contract") return Response.json({ results: [{ private: "untrusted" }] });
      return error(Number(failure), failure === "502" ? "REVIEW_OUTPUT_REJECTED" : "DATABASE_UNAVAILABLE");
    });
    await mount();
    fireEvent.change(question(), { target: { value: "原追问草稿" } });
    fireEvent.change(screen.getByLabelText("用户编辑复盘"), { target: { value: "未保存笔记" } });
    fireEvent.click(generate());
    await waitFor(() => expect(retry()).toBeEnabled());
    expect(post).toHaveBeenCalledTimes(1);
    expect(question()).toHaveValue("原追问草稿");
    expect(screen.getByLabelText("用户编辑复盘")).toHaveValue("未保存笔记");
    expect(screen.getByText("原有分析", { exact: true })).toBeVisible();
    expect(screen.getByRole("alert", { name: "复盘错误" })).toHaveTextContent("可能已产生模型用量");
    expect(screen.getByRole("alert", { name: "复盘错误" })).not.toHaveTextContent("PRIVATE");
    expect(generate()).toBeDisabled();
    const navigation = new Event("algopilot-before-navigate", { cancelable: true });
    act(() => { window.dispatchEvent(navigation); });
    expect(navigation.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /复盘 2026-10-26/ }));
    expect(post).toHaveBeenCalledTimes(1);
    expect(question()).toHaveValue("原追问草稿");
  });

  it("keeps the ID while pending, then requires a separate click after confirmed failure", async () => {
    post.mockRejectedValueOnce(new TypeError("lost"))
      .mockResolvedValueOnce(error(409, "TUTOR_BUSY"))
      .mockResolvedValueOnce(error(409, "REVIEW_REQUEST_FAILED"))
      .mockResolvedValueOnce(Response.json({ results: [result] }));
    await mount();
    fireEvent.click(generate()); await waitFor(() => expect(retry()).toBeEnabled());
    fireEvent.click(retry()); await waitFor(() => expect(retry()).toBeEnabled());
    fireEvent.click(retry()); await waitFor(() => expect(generate()).toBeEnabled());
    expect(post).toHaveBeenCalledTimes(3);
    expect(body(1)).toEqual(body(0)); expect(body(2)).toEqual(body(0));
    expect(screen.queryByRole("button", { name: "重试上次生成请求" })).toBeNull();
    expect(screen.getByRole("alert", { name: "复盘错误" })).toHaveTextContent("已确认结束");
    fireEvent.click(generate()); await waitFor(() => expect(post).toHaveBeenCalledTimes(4));
    expect(body(3).requestId).not.toBe(body(0).requestId);
  });

  it("a definitive pre-admission refusal allows a separate new intent", async () => {
    post.mockResolvedValueOnce(error(429, "DAILY_LIMIT_REACHED"))
      .mockResolvedValueOnce(Response.json({ results: [result] }));
    await mount(); fireEvent.click(generate());
    await waitFor(() => expect(generate()).toBeEnabled());
    expect(screen.queryByRole("button", { name: "重试上次生成请求" })).toBeNull();
    fireEvent.click(generate()); await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(body(1).requestId).not.toBe(body(0).requestId);
  });

  it("does not carry an unsent comparison into another review", async () => {
    fetcher.mockImplementation(async path => {
      if (path === "/api/v1/reviews") return Response.json({ items: [review, { ...review, id: "10000000-0000-4000-8000-000000000099", created_at: "2026-10-25T00:00:00Z" }] });
      if (path === "/api/v1/sessions?limit=50") return Response.json({ items: [] });
      return Response.json({ review, results: [result], configured: true });
    });
    await mount();
    fireEvent.change(question(), { target: { value: "只属于当前快照的 WA 对照" } });
    const before = fetcher.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /复盘 2026-10-25/ }));
    expect(fetcher).toHaveBeenCalledTimes(before);
    expect(question()).toHaveValue("只属于当前快照的 WA 对照");
    expect(screen.getByRole("alert", { name: "复盘错误" })).toHaveTextContent("复制并清空追问草稿");
  });

  it("guards repeated clicks synchronously and freezes the request question until settlement", async () => {
    let finish!: (response: Response) => void;
    post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); fireEvent.change(question(), { target: { value: "唯一追问" } });
    const button = generate();
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(post).toHaveBeenCalledTimes(1);
    expect(question()).toBeDisabled();
    await act(async () => finish(Response.json({ results: [result] })));
    expect(question()).toHaveValue(""); expect(generate()).toBeEnabled();
  });
});
