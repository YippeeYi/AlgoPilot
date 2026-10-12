import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { pageContext } from "@/server/auth";
import { ProblemLibrary } from "@/components/problems/problem-library";

export default async function ProblemsPage() {
  const context = await pageContext();
  return (
    <>
      <PageHeading
        eyebrow="PROBLEM LIBRARY"
        title="选一道值得思考的题"
        description="Codeforces API 提供题目元数据。默认在官方网页阅读完整题面，单选开始训练或多选加入计划。"
      />
      {context ? (
        <ProblemLibrary />
      ) : (
        <>
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

              <p className="w-full text-xs text-muted-foreground">
                配置 Supabase 并登录后可搜索题库与管理计划。训练工作台默认隐藏算法标签。
              </p>
            </CardContent>
          </Card>
          <EmptyState
            title="题库尚未连接"
            description="请先配置 Supabase 并登录；题库只使用 Codeforces 官方缓存。"
            href="/practice/preview"
            action="先看看工作台布局"
          />
        </>
      )}
    </>
  );
}
