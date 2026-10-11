"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Compass,
  History,
  LayoutDashboard,
  Settings,
  Sparkles,
} from "lucide-react";
import { navigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

const icons = {
  dashboard: LayoutDashboard,
  problems: BookOpen,
  sessions: History,
  reviews: Sparkles,
  analytics: Activity,
  settings: Settings,
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[224px_1fr]">
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-background focus:p-4"
        href="#main-content"
      >
        跳到主要内容
      </a>
      <aside className="border-b border-border bg-sidebar lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-r lg:border-b-0">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 px-6 py-7"
          aria-label="AlgoPilot 首页"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Compass className="size-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">
            AlgoPilot
            <span className="block text-[10px] font-medium tracking-[0.18em] text-muted-foreground">
              THINK. SOLVE. GROW.
            </span>
          </span>
        </Link>
        <nav
          aria-label="主导航"
          className="flex gap-1 overflow-x-auto px-3 pb-4 lg:flex-col"
        >
          {navigation.map(({ href, label, icon }) => {
            const Icon = icons[icon];
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-3 rounded-lg px-3 py-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  active && "bg-accent font-semibold text-accent-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden p-5 lg:block">
          <div className="rounded-xl border border-border p-4 text-xs leading-6 text-muted-foreground">
            <span className="mb-1 block font-semibold text-foreground">
              先思考，再求助
            </span>
            记录你的推论和卡点，让每次训练留下可复习的证据。
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            个人训练 · M0 布局预览
          </p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b px-5 py-4 lg:px-9">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-amber-500" />
            布局预览 · 尚未接入账户与数据
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/login"
              className="flex items-center gap-1 text-sm font-medium"
            >
              登录
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
        </header>
        <main
          id="main-content"
          className="mx-auto max-w-[1600px] px-5 py-8 lg:px-9 lg:py-10"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
