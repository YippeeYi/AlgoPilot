"use client";

import {
  LockKeyhole,
  Save,
  Timer,
  Code2,
  MessageSquare,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function StatementPanel() {
  return (
    <Card className="h-full shadow-none">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="size-4" />
          题面与条件
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-7 py-6">
        <Badge variant="outline">尚未选择题目</Badge>
        <div>
          <h2 className="font-semibold">先理解问题</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            真实训练中，这里会展示你提供的题面、约束和样例。Codeforces API
            仅用于元数据，不提供完整题面。
          </p>
        </div>
        <div className="rounded-lg border border-dashed p-4 text-xs leading-7 text-muted-foreground">
          可以先问自己：
          <br />
          输入和输出分别是什么？
          <br />
          边界条件有哪些？
          <br />
          我有哪些已经验证的观察？
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LockKeyhole className="size-3.5" />
          训练中默认隐藏算法标签
        </p>
      </CardContent>
    </Card>
  );
}

function ThoughtPanel({ idPrefix }: { idPrefix: string }) {
  return (
    <Card className="h-full shadow-none">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Code2 className="size-4" />
          思路与代码
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 py-6">
        <div>
          <label
            htmlFor={`${idPrefix}-thought-draft`}
            className="mb-3 block text-sm font-medium"
          >
            当前思路
          </label>
          <Textarea
            id={`${idPrefix}-thought-draft`}
            placeholder="记录观察、假设，以及暂时无法证明的部分……"
            className="min-h-40 resize-none"
            disabled
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              版本历史：尚无记录
            </span>
            <Button size="sm" variant="outline" disabled>
              <Save className="size-3.5" />
              保存版本
            </Button>
          </div>
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-code-draft`}
            className="mb-3 block text-sm font-medium"
          >
            C++ 草稿
          </label>
          <Textarea
            id={`${idPrefix}-code-draft`}
            placeholder="// 代码编辑与恢复将在 M1 接入"
            className="min-h-48 resize-none font-mono text-xs"
            disabled
            spellCheck={false}
          />
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            仅编辑与分析代码，不在服务器执行用户程序。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function TutorPanel({ idPrefix }: { idPrefix: string }) {
  return (
    <Card className="h-full shadow-none">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <MessageSquare className="size-4" />
            思维教练
          </span>
          <Badge variant="secondary">L0</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 py-6">
        <div className="rounded-lg bg-primary/5 p-4 text-sm leading-7">
          <p className="font-medium">从你已经想到的地方出发</p>
          <p className="mt-2 text-muted-foreground">
            默认只围绕已有思路提问。提示升级由服务器授权；完整解析需要两次明确确认。
          </p>
        </div>
        <p role="status" className="text-xs leading-6 text-muted-foreground">
          模型未接入。当前预览不会调用 AI，也不会生成模拟回答。
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            "给我一点提示",
            "检查我的思路",
            "找候选反例",
            "分析复杂度",
            "检查代码",
            "完整解析（L5）",
          ].map((action) => (
            <Button
              key={action}
              size="sm"
              variant="outline"
              disabled
              className="text-xs"
            >
              {action}
            </Button>
          ))}
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-tutor-message`}
            className="mb-2 block text-xs font-medium"
          >
            补充你的问题
          </label>
          <Textarea
            id={`${idPrefix}-tutor-message`}
            placeholder="描述你的思考和具体卡点"
            disabled
          />
          <Button className="mt-3 w-full" disabled>
            发送
          </Button>
        </div>
        <div className="border-t pt-4">
          <Button variant="outline" className="w-full" disabled>
            <LockKeyhole className="size-3.5" />
            申请下一提示等级
          </Button>
          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            比赛模式禁止题目相关 AI 辅助。反例与分析在确定性验证前标为待验证。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function WorkspacePreview() {
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-widest text-primary">
            PRACTICE WORKSPACE
          </p>
          <h1 className="text-2xl font-semibold">训练工作台预览</h1>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            尚未创建会话 · 编辑、保存、计时与提示操作将在后续里程碑接入。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
            <Timer className="size-4" />
            未开始
          </span>
          <Button size="sm" variant="outline" disabled>
            暂停
          </Button>
          <Button size="sm" disabled>
            结束训练
          </Button>
        </div>
      </div>
      <div
        className="hidden grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)_minmax(0,1fr)] items-stretch gap-4 lg:grid"
        data-testid="desktop-workspace"
      >
        <StatementPanel />
        <ThoughtPanel idPrefix="desktop" />
        <TutorPanel idPrefix="desktop" />
      </div>
      <Tabs defaultValue="statement" className="lg:hidden">
        <TabsList
          className="mb-4 grid w-full grid-cols-3"
          aria-label="工作台区域"
        >
          <TabsTrigger value="statement">题面</TabsTrigger>
          <TabsTrigger value="thought">思路 / 代码</TabsTrigger>
          <TabsTrigger value="tutor">AI 教练</TabsTrigger>
        </TabsList>
        <TabsContent value="statement">
          <StatementPanel />
        </TabsContent>
        <TabsContent value="thought">
          <ThoughtPanel idPrefix="mobile" />
        </TabsContent>
        <TabsContent value="tutor">
          <TutorPanel idPrefix="mobile" />
        </TabsContent>
      </Tabs>
    </>
  );
}
