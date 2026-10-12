import Link from "next/link";
import { ArrowRight, BookOpen, Brain, NotebookPen } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pageContext } from "@/server/auth";
import { SessionList } from "@/components/sessions/session-list";

export default async function DashboardPage() {
  const context = await pageContext();
  return (
    <>
      <PageHeading
        eyebrow="YOUR TRAINING SPACE"
        title="把每一道题，变成自己的能力。"
        description="从独立思考开始，在真正需要时获得一点引导。AlgoPilot 帮你记录过程，理解卡点，再回头验证。"
      />
      <section className="mb-7 grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <Card className="overflow-hidden border-primary/15 bg-primary/5 shadow-none">
          <CardContent className="p-7 sm:p-9">
            <Badge variant="outline" className="border-primary/20 text-primary">
              独立训练优先
            </Badge>
            <h2 className="mt-6 text-2xl font-semibold leading-relaxed">
              先写下一个想法，
              <br />
              再向前走一步。
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-7 text-muted-foreground">
              题面、思路和引导并排放置。默认
              L0，只围绕你已有的思考提问；更多提示需要主动解锁。
            </p>
            <Link
              href={context ? "/sessions" : "/practice/preview"}
              className="mt-7 inline-flex items-center gap-3 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground"
            >
              {context ? "开始或继续训练" : "查看训练工作台"}
              <ArrowRight className="size-4" />
            </Link>
            <p className="mt-3 text-xs text-muted-foreground">
              {context
                ? "私人训练已接入；AI 教练需服务端配置后启用"
                : "布局预览，不会创建训练或调用 AI"}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">你的训练节奏</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {[
              {
                icon: BookOpen,
                title: "选择一道题",
                text: "从 Codeforces 题库选题，单题训练或批量加入计划。",
              },
              {
                icon: Brain,
                title: "保留思考过程",
                text: "记录假设、推论和需要验证的部分。",
              },
              {
                icon: NotebookPen,
                title: "带着证据复盘",
                text: "区分官方结果、自报经历和 AI 推测。",
              },
            ].map(({ icon: Icon, title, text }, index) => (
              <div key={title} className="flex gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                  <Icon className="size-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    <span className="mr-2 text-muted-foreground">
                      0{index + 1}
                    </span>
                    {title}
                  </p>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">
                    {text}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <section>
          <h2 className="mb-4 text-base font-semibold">最近训练</h2>
          {context ? (
            <SessionList />
          ) : (
            <EmptyState
              title="还没有训练记录"
              description="接入账户后，你的思路版本、可选计时和 AC 代码快照将保存在这里。"
              href="/problems"
              action="浏览题库页面"
            />
          )}
        </section>
        <section>
          <h2 className="mb-4 text-base font-semibold">待复习</h2>
          <EmptyState
            title="留给下一次思考"
            description="完成训练并安排复习后，这里会显示有真实记录支持的复习任务。"
            href="/reviews"
            action="查看复盘页面"
          />
        </section>
      </div>
    </>
  );
}
