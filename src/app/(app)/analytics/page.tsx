import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";

export default function AnalyticsPage() {
  return (
    <>
      <PageHeading
        eyebrow="EVIDENCE OF PROGRESS"
        title="用真实记录理解进步"
        description="统计来自训练记录和 Codeforces 官方数据。没有足够的证据时，不推断你的能力。"
      />
      <div className="mb-7 grid gap-4 sm:grid-cols-3">
        {["有效训练用时", "独立完成率", "最高提示等级分布"].map((title) => (
          <Card key={title} className="shadow-none">
            <CardContent className="py-6">
              <h2 className="text-sm text-muted-foreground">{title}</h2>
              <p className="my-3 text-3xl" aria-label="尚无数据">
                —
              </p>
              <p className="text-xs text-muted-foreground">尚无数据 · 不估算</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <EmptyState
        title="暂无官方 Rating 历史"
        description="关联公开 CF Handle 并实际同步后显示官方记录。公开 Handle 不代表账号归属已验证。"
        href="/settings"
        action="查看关联设置"
      />
    </>
  );
}
