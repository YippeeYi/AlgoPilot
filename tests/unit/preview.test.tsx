import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AnalyticsPage from "@/app/(app)/analytics/page";
import { AuthPreview } from "@/components/auth-preview";
import { ThemeProvider } from "@/components/theme-provider";

vi.mock("@/server/auth", () => ({ pageContext: vi.fn().mockResolvedValue(null) }));

describe("无数据与账户预览", () => {
  it("没有训练证据时不虚构统计或 Rating", async () => {
    render(await AnalyticsPage());
    expect(
      screen.getByRole("heading", { name: "样本不足" }),
    ).toBeVisible();
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  });
  it("登录预览禁用凭据输入和提交，并说明未接入", () => {
    render(
      <ThemeProvider>
        <AuthPreview />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText("邮箱")).toBeDisabled();
    expect(screen.getByLabelText("密码")).toBeDisabled();
    expect(screen.getByRole("button", { name: /^登录$/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "不会提交或保存邮箱与密码",
    );
  });
});
