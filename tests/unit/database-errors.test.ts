import { describe, expect, it, vi } from "vitest";
import { databaseError, handle, json } from "@/server/http";

describe("数据库错误分类与脱敏诊断", () => {
  it.each(["PT409", "40001", "23505"])("精确识别 %s 冲突", async (code) => {
    const response = await handle(async () => {
      databaseError({ code });
      return json({});
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("REVISION_CONFLICT");
  });
  it.each(["", "PGRST000", "PGRST003", "08006", "XX000", "57014"])(
    "不可用或未知错误 %s 仍然为 503", async (code) => {
      const response = await handle(async () => {
        databaseError({ code });
        return json({});
      });
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("DATABASE_UNAVAILABLE");
    },
  );
  it("诊断只保留操作、代码、状态和类别，不记录 SDK 原文", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const error = { code: "PT409", message: "secret draft", details: "secret JWT", hint: "secret key" };
      expect(() => databaseError(error, { operation: "save_training_draft", status: 409 })).toThrow();
      expect(warn).toHaveBeenCalledWith("database_operation_failed", {
        operation: "save_training_draft", code: "PT409", status: 409, category: "postgresql",
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
      warn.mockClear();
      expect(() => databaseError({ code: "private-input-value" }, { operation: "save_training_draft", status: NaN })).toThrow();
      expect(warn).toHaveBeenCalledWith("database_operation_failed", {
        operation: "save_training_draft", code: "UNKNOWN", status: 0, category: "transport_or_unclassified",
      });
    } finally { warn.mockRestore(); }
  });
});
