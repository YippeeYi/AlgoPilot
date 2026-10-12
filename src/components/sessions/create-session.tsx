"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { requestJson } from "@/lib/api-client";
import type { TrainingSession } from "@/lib/validation/m1";

export function CreateSession() {
  const router = useRouter();
  const [statement, setStatement] = useState("");
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [mode, setMode] = useState("practice");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ payload: string; requestId: string } | null>(null);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const payload = JSON.stringify({ statementSnapshot: statement, mode, timerEnabled });
    if (attempt.current?.payload !== payload)
      attempt.current = { payload, requestId: crypto.randomUUID() };
    try {
      const result = await requestJson<{ session: TrainingSession }>(
        "/api/v1/sessions",
        {
          method: "POST",
          body: {
            statementSnapshot: statement,
            mode,
            timerEnabled,
            requestId: attempt.current.requestId,
          },
        },
      );
      router.push(`/practice/${result.session.id}`);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "创建失败，请重试。",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Card className="mb-6 shadow-none">
      <CardHeader>
        <CardTitle className="text-base">新建自主训练</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={create} className="space-y-4">
          <label htmlFor="new-statement" className="block text-sm">
            题面与约束（仅自己可见）
          </label>
          <Textarea
            id="new-statement"
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
            maxLength={64000}
            className="min-h-28"
            placeholder="粘贴你准备练习的题面；也可以先创建空白训练。"
            disabled={pending}
          />
          <label className="block text-sm" htmlFor="training-mode">
            训练模式
          </label>
          <select
            id="training-mode"
            className="rounded border bg-background p-2 text-sm"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
            disabled={pending}
          >
            <option value="practice">独立练习</option>
            <option value="contest">比赛模式（AI 禁用）</option>
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={timerEnabled} onChange={e=>setTimerEnabled(e.target.checked)} disabled={pending}/>启用可选计时</label>
          <p className="text-xs text-muted-foreground">在本地 VS Code 编写和调试，前往 Codeforces 手动提交。计时由服务器保存，网页无需一直打开。</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div>
            <Button disabled={pending}>
              {pending ? "正在创建…" : "开始训练"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
