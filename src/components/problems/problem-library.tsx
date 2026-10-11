"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { requestJson } from "@/lib/api-client";
import type { Problem, TrainingSession } from "@/lib/validation/m1";

export function ProblemLibrary() {
  const router = useRouter();
  const [items, setItems] = useState<Problem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  const attempt = useRef<{ payload: string; requestId: string } | null>(null);
  const sessionRequests = useRef(new Map<string, string>());
  useEffect(() => {
    let active = true;
    requestJson<{ items: Problem[]; nextOffset: number | null }>(
      `/api/v1/problems?offset=${offset}`,
    )
      .then((data) => {
        if (active) {
          setItems(data.items);
          setNextOffset(data.nextOffset);
          setLoaded(true);
        }
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error ? failure.message : "题目加载失败。",
          );
      });
    return () => {
      active = false;
    };
  }, [offset, reload]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const payload = JSON.stringify({ title, statement });
    if (attempt.current?.payload !== payload)
      attempt.current = { payload, requestId: crypto.randomUUID() };
    try {
      await requestJson("/api/v1/problems", {
        method: "POST",
        body: { title, statement, requestId: attempt.current.requestId },
      });
      setTitle("");
      setStatement("");
      attempt.current = null;
      setOffset(0);
      setReload((old) => old + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "题目创建失败。");
    } finally {
      setPending(false);
    }
  }
  async function start(problemId: string) {
    setPending(true);
    setError("");
    const requestId =
      sessionRequests.current.get(problemId) ?? crypto.randomUUID();
    sessionRequests.current.set(problemId, requestId);
    try {
      const result = await requestJson<{ session: TrainingSession }>(
        "/api/v1/sessions",
        { method: "POST", body: { problemId, mode: "practice", requestId } },
      );
      router.push(`/practice/${result.session.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "训练创建失败。");
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Card className="mb-6 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">创建私人自定义题目</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-4">
            <label htmlFor="custom-title" className="block text-sm">
              题目名称
            </label>
            <Input
              id="custom-title"
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={pending}
            />
            <label htmlFor="custom-statement" className="block text-sm">
              题面、约束与样例
            </label>
            <Textarea
              id="custom-statement"
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              maxLength={64000}
              disabled={pending}
              className="min-h-40"
            />
            <p className="text-xs text-muted-foreground">
              私人题目只属于你的账户，不会成为公共题库记录。CF 同步将在 M3
              接入。
            </p>
            <Button disabled={pending}>
              {pending ? "正在处理…" : "创建题目"}
            </Button>
          </form>
        </CardContent>
      </Card>
      {error && (
        <div role="alert" className="mb-4 text-sm text-destructive">
          {error}
          <Button
            size="sm"
            variant="outline"
            className="ml-3"
            onClick={() => {
              setError("");
              setReload((old) => old + 1);
            }}
          >
            重试加载
          </Button>
        </div>
      )}
      {!loaded && !error && <p role="status">正在加载题目…</p>}
      {loaded && items.length === 0 && (
        <EmptyState
          title="还没有题目"
          description="创建一道私人题目，再开始记录你的思考。"
        />
      )}
      <div className="space-y-4">
        {items.map((problem) => (
          <Card key={problem.id} className="shadow-none">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
              <div>
                <h2 className="font-medium">{problem.title}</h2>
                <p className="mt-2 text-xs text-muted-foreground">
                  {problem.platform === "custom"
                    ? "私人自建题目"
                    : "Codeforces 公开元数据"}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void start(problem.id)}
              >
                开始这道题
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-5 flex justify-between">
        <Button
          size="sm"
          variant="outline"
          disabled={offset === 0 || pending}
          onClick={() => setOffset(Math.max(0, offset - 30))}
        >
          上一页
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={nextOffset === null || pending}
          onClick={() => nextOffset !== null && setOffset(nextOffset)}
        >
          下一页
        </Button>
      </div>
    </>
  );
}
