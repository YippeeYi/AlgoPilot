import { describe, expect, it, vi } from "vitest";
import { DraftQueue } from "@/features/sessions/draft-queue";

describe("草稿串行队列（业务单测）", () => {
  it("旧响应不会覆盖后来输入，随后用新 revision 保存最新内容", async () => {
    let release!: (revision: number) => void;
    const persist = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce(2);
    const queue = new DraftQueue("", 0, persist);
    queue.setValue("old");
    const saving = queue.flush();
    queue.setValue("new");
    release(1);
    await saving;
    expect(queue.getSnapshot()).toMatchObject({
      value: "new",
      savedValue: "new",
      revision: 2,
      status: "saved",
    });
    expect(persist.mock.calls).toEqual([
      ["old", 0],
      ["new", 1],
    ]);
  });
  it("重复保存共用同一请求且失败保留未保存内容", async () => {
    const persist = vi.fn().mockRejectedValue(new Error("conflict"));
    const queue = new DraftQueue("server", 4, persist);
    queue.setValue("local");
    const one = queue.flush();
    expect(queue.flush()).toBe(one);
    await expect(one).rejects.toThrow("conflict");
    expect(queue.getSnapshot()).toMatchObject({
      value: "local",
      savedValue: "server",
      revision: 4,
      status: "error",
    });
    expect(persist).toHaveBeenCalledTimes(1);
  });
  it("已经保存的草稿不再次写入；恢复历史仅使草稿变为未保存", async () => {
    const persist = vi.fn();
    const queue = new DraftQueue("latest", 3, persist);
    await queue.flush();
    expect(persist).not.toHaveBeenCalled();
    queue.setValue("historical");
    expect(queue.getSnapshot()).toMatchObject({
      value: "historical",
      savedValue: "latest",
      revision: 3,
      status: "dirty",
    });
  });
  it("切换会话使用独立队列与独立保存目标", async () => {
    const saveA = vi.fn().mockResolvedValue(1),
      saveB = vi.fn().mockResolvedValue(8);
    const a = new DraftQueue("A", 0, saveA),
      b = new DraftQueue("B", 7, saveB);
    a.setValue("A-new");
    b.setValue("B-new");
    await Promise.all([a.flush(), b.flush()]);
    expect(saveA).toHaveBeenCalledWith("A-new", 0);
    expect(saveB).toHaveBeenCalledWith("B-new", 7);
  });
});
