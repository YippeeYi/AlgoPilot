import { loginSchema, registerSchema } from "@/lib/validation/m1";
import { safeNext } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";
import {
  assertSameOrigin,
  ApiError,
  handle,
  json,
  readJson,
  requestOrigin,
} from "@/server/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return handle(async () => {
    assertSameOrigin(request);
    const { action } = await context.params;
    if (!["login", "register", "logout"].includes(action))
      throw new ApiError(404, "NOT_FOUND", "未找到该操作。");
    const client = await createClient();
    if (!client)
      throw new ApiError(
        503,
        "SUPABASE_NOT_CONFIGURED",
        "Supabase 未配置或配置不完整。",
      );
    if (action === "logout") {
      const verified = await client.auth.getUser();
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error)
        throw new ApiError(503, "SIGNOUT_FAILED", "暂时无法退出，请重试。");
      if (!verified.data.user)
        throw new ApiError(401, "UNAUTHENTICATED", "会话已失效。");
      return json({ next: "/login" });
    }
    const input = await readJson(
      request,
      action === "register" ? registerSchema : loginSchema,
    );
    const next = safeNext(input.next);
    if (action === "login") {
      const { error } = await client.auth.signInWithPassword({
        email: input.email,
        password: input.password,
      });
      if (error)
        throw new ApiError(
          error.status && error.status >= 500 ? 503 : 401,
          "LOGIN_FAILED",
          "登录失败。请检查邮箱、密码及邮箱验证状态。",
        );
      const { data, error: verificationError } = await client.auth.getUser();
      if (verificationError || !data.user)
        throw new ApiError(401, "LOGIN_FAILED", "无法验证登录状态，请重试。");
      return json({ next });
    }
    const callback = new URL("/auth/callback", requestOrigin(request));
    callback.searchParams.set("next", next);
    const { data, error } = await client.auth.signUp({
      email: input.email,
      password: input.password,
      options: { emailRedirectTo: callback.toString() },
    });
    if (error)
      throw new ApiError(
        error.status && error.status >= 500 ? 503 : 422,
        "REGISTRATION_FAILED",
        "注册未完成，请检查输入或稍后重试。",
      );
    if (!data.session)
      return json({
        needsConfirmation: true,
        message: "注册请求已提交，请查看邮箱完成验证。",
      });
    const verified = await client.auth.getUser();
    if (!verified.data.user || verified.error)
      throw new ApiError(401, "LOGIN_FAILED", "请验证邮箱后重新登录。");
    return json({ needsConfirmation: false, next });
  });
}
