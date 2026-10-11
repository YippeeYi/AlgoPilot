import { describe, expect, it } from "vitest";
import { getConfigurationStatus } from "@/server/config";

describe("服务端配置的公开状态", () => {
  it("无凭据时不宣称服务可用", () => {
    expect(getConfigurationStatus({})).toEqual({
      supabase: "missing",
      llm: "missing",
    });
  });
  it("空值与空白不被视为已配置", () => {
    expect(
      getConfigurationStatus({
        LLM_BASE_URL: " ",
        LLM_API_KEY: "",
        LLM_MODEL: " ",
      }).llm,
    ).toBe("missing");
  });
  it("只有 Key 时配置仍不完整", () => {
    expect(
      getConfigurationStatus({ LLM_API_KEY: "test-only-secret" }).llm,
    ).toBe("incomplete");
  });
  it.each(["not-a-url", "http://model.example/v1", "ftp://model.example/v1"])(
    "拒绝无效或非 HTTPS URL: %s",
    (url) => {
      expect(
        getConfigurationStatus({
          LLM_BASE_URL: url,
          LLM_API_KEY: "test-only-secret",
          LLM_MODEL: "test-model",
        }).llm,
      ).toBe("incomplete");
    },
  );
  it("配置完整仅表示已填写，不执行外部连接", () => {
    expect(
      getConfigurationStatus({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public-key",
        LLM_BASE_URL: "https://model.example/v1",
        LLM_API_KEY: "test-only-secret",
        LLM_MODEL: "test-model",
      }),
    ).toEqual({ supabase: "configured", llm: "configured" });
  });
  it("白名单输出不会携带密钥、模型名称或其他环境变量", () => {
    const status = getConfigurationStatus({
      LLM_API_KEY: "test-only-secret",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-test-secret",
      LLM_MODEL: "private-model-id",
      INTERNAL_TOKEN: "private-token",
    });
    expect(Object.keys(status).sort()).toEqual(["llm", "supabase"]);
    const serialized = JSON.stringify(status);
    for (const secret of [
      "test-only-secret",
      "service-role-test-secret",
      "private-model-id",
      "private-token",
    ])
      expect(serialized).not.toContain(secret);
  });
});
