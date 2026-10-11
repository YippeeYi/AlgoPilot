"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Compass } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requestJson } from "@/lib/api-client";

export function AuthForm({
  register = false,
  next,
  confirmationError = false,
}: {
  register?: boolean;
  next: string;
  confirmationError?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(
    confirmationError
      ? "邮箱验证链接无效或已过期，请重新登录或重新注册获取邮件。"
      : "",
  );
  const [error, setError] = useState(confirmationError);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setError(false);
    try {
      const result = await requestJson<{
        next?: string;
        needsConfirmation?: boolean;
        message?: string;
      }>(`/api/v1/auth/${register ? "register" : "login"}`, {
        method: "POST",
        body: { email, password, next },
      });
      setPassword("");
      if (result.needsConfirmation)
        setMessage(result.message ?? "请查看邮箱完成验证。");
      else {
        router.replace(result.next ?? "/dashboard");
        router.refresh();
      }
    } catch (failure) {
      setError(true);
      setMessage(
        failure instanceof Error ? failure.message : "请求失败，请重试。",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between p-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 font-semibold"
        >
          <Compass className="size-6 text-primary" />
          AlgoPilot
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-5 pb-20">
        <Card className="w-full max-w-md shadow-none">
          <CardContent className="p-7 sm:p-9">
            <p className="mb-3 text-xs font-semibold tracking-widest text-primary">
              THINK. SOLVE. GROW.
            </p>
            <h1 className="text-2xl font-semibold">
              {register ? "开始你的训练旅程" : "回到你的训练空间"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {register
                ? "注册邮箱账户，保存你的训练与思考。"
                : "使用邮箱登录，继续你的独立训练。"}
            </p>
            <form onSubmit={submit} className="mt-7 space-y-5">
              <div>
                <label htmlFor="email" className="mb-2 block text-sm">
                  邮箱
                </label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={pending}
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-2 block text-sm">
                  密码
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={register ? "new-password" : "current-password"}
                  minLength={register ? 8 : 1}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={pending}
                />
              </div>
              {message && (
                <p
                  role={error ? "alert" : "status"}
                  className="rounded-lg bg-muted p-3 text-sm leading-6"
                >
                  {message}
                </p>
              )}
              <Button className="w-full" disabled={pending}>
                {pending ? "正在处理…" : register ? "注册" : "登录"}
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {register ? "已有账户？" : "还没有账户？"}
              <Link
                className="ml-2 text-primary"
                href={`${register ? "/login" : "/register"}?next=${encodeURIComponent(next)}`}
              >
                {register ? "前往登录" : "前往注册"}
              </Link>
            </p>
            <Link
              href="/practice/preview"
              className="mt-4 block text-center text-xs text-muted-foreground underline underline-offset-4"
            >
              查看公开工作台预览
            </Link>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
