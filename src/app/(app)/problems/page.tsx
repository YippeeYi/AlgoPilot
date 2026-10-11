import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function ProblemsPage() {
  return (
    <>
      <PageHeading
        eyebrow="PROBLEM LIBRARY"
        title="选一道值得思考的题"
        description="Codeforces API 提供题目元数据。完整题面需要自行提供，或打开官方题页查看。"
      />
      <Card className="mb-6 shadow-none">
        <CardContent className="flex flex-wrap items-end gap-4 py-6">
          <div className="min-w-48 flex-1">
            <label
              htmlFor="problem-query"
              className="mb-2 block text-xs font-medium"
            >
              题目名称 / 编号
            </label>
            <Input id="problem-query" placeholder="搜索题目" disabled />
          </div>
          <div>
            <label
              htmlFor="problem-rating"
              className="mb-2 block text-xs font-medium"
            >
              难度范围
            </label>
            <Input
              id="problem-rating"
              placeholder="不限"
              disabled
              className="w-32"
            />
          </div>
          <Button disabled>导入 CF URL</Button>
          <Button variant="outline" disabled>
            自定义题目
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            题目查询与导入尚未接入。独立训练工作台将默认隐藏算法标签。
          </p>
        </CardContent>
      </Card>
      <EmptyState
        title="题库尚未连接"
        description="此处没有模拟题目。M1 将支持自定义题目，M3 将接入 Codeforces 官方元数据。"
        href="/practice/preview"
        action="先看看工作台布局"
      />
    </>
  );
}
