import Link from "next/link";
import { Compass } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

export function AuthPreview({ register = false }: { register?: boolean }) {
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
                ? "留下思考过程，练出独立解题的能力。"
                : "继续思考，记录进步。"}
            </p>
            <div className="mt-7 space-y-5">
              <div>
                <label htmlFor="email" className="mb-2 block text-sm">
                  邮箱
                </label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  disabled
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
                  placeholder="账户接入后可用"
                  disabled
                />
              </div>
              <p
                role="status"
                className="rounded-lg bg-muted p-3 text-xs leading-6 text-muted-foreground"
              >
                账户服务尚未接入（M1）。当前为布局预览，不会提交或保存邮箱与密码。
              </p>
              <Button className="w-full" disabled>
                {register ? "注册" : "登录"}
              </Button>
            </div>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {register ? "已有账户？" : "还没有账户？"}
              <Link
                className="ml-2 font-medium text-primary"
                href={register ? "/login" : "/register"}
              >
                {register ? "前往登录" : "前往注册"}
              </Link>
            </p>
            <Link
              className="mt-4 block text-center text-xs text-muted-foreground underline underline-offset-4"
              href="/dashboard"
            >
              浏览无数据预览
            </Link>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
