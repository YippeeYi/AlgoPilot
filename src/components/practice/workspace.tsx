"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TutorPanel } from "@/components/practice/workspace-preview";
import { requestJson } from "@/lib/api-client";
import type { TrainingSession, Problem, Thought } from "@/lib/validation/m1";
import { DraftQueue } from "@/features/sessions/draft-queue";
import { displayedSeconds, formatSeconds } from "@/features/sessions/time";

const CodeEditor = dynamic(() => import("@/components/practice/code-editor"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm">正在加载 C++ 编辑器…</p>,
});
const draftLabels = {
  saved: "已保存到服务器",
  dirty: "有未保存修改",
  saving: "正在保存…",
  error: "保存失败 · 本地内容仍保留",
};
const outcomes = {
  not_recorded: "未记录结果",
  solved_self_reported: "自报已解出（非官方 AC）",
  unsolved: "暂未解出",
  abandoned: "放弃本次训练",
};

function useDraft(queue: DraftQueue, enabled: boolean) {
  const snapshot = useSyncExternalStore(
    queue.subscribe,
    queue.getSnapshot,
    queue.getSnapshot,
  );
  useEffect(() => {
    if (!enabled || snapshot.status !== "dirty") return;
    const timeout = setTimeout(() => {
      void queue.flush().catch(() => {});
    }, 1200);
    return () => clearTimeout(timeout);
  }, [enabled, queue, snapshot.value, snapshot.status]);
  return snapshot;
}

export function Workspace({
  initialSession,
  problem,
  serverNow,
}: {
  initialSession: TrainingSession;
  problem: Problem | null;
  serverNow: string;
}) {
  const [session, setSession] = useState(initialSession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [versions, setVersions] = useState<Thought[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [historyError, setHistoryError] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<Thought | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [outcome, setOutcome] = useState<keyof typeof outcomes>("not_recorded");
  const versionRequest = useRef<{
    content: string;
    revision: number;
    id: string;
  } | null>(null);
  const [clock, setClock] = useState(Date.parse(serverNow));
  const baseClock = useRef(Date.parse(serverNow));
  const receiptClock = useRef(0);
  const [thoughtQueue] = useState(
    () =>
      new DraftQueue(
        initialSession.thought_draft,
        initialSession.thought_revision,
        async (content, expectedRevision) => {
          const result = await requestJson<{ session: TrainingSession }>(
            `/api/v1/sessions/${initialSession.id}/thought-draft`,
            { method: "PATCH", body: { content, expectedRevision } },
          );
          return result.session.thought_revision;
        },
      ),
  );
  const [codeQueue] = useState(
    () =>
      new DraftQueue(
        initialSession.code_draft,
        initialSession.code_revision,
        async (content, expectedRevision) => {
          const result = await requestJson<{ session: TrainingSession }>(
            `/api/v1/sessions/${initialSession.id}/code`,
            { method: "PATCH", body: { content, expectedRevision } },
          );
          return result.session.code_revision;
        },
      ),
  );
  const completed = session.status === "completed";
  const thought = useDraft(thoughtQueue, !completed && !busy);
  const code = useDraft(codeQueue, !completed && !busy);
  const dirty =
    thought.value !== thought.savedValue || code.value !== code.savedValue;
  useEffect(() => {
    receiptClock.current = performance.now();
    const interval = setInterval(
      () =>
        setClock(baseClock.current + performance.now() - receiptClock.current),
      1000,
    );
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        thoughtQueue.getSnapshot().value !==
          thoughtQueue.getSnapshot().savedValue ||
        codeQueue.getSnapshot().value !== codeQueue.getSnapshot().savedValue
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const guard = (event: Event) => {
      if (dirty) {
        event.preventDefault();
        setError(
          "还有未保存的修改，请先保存再离开。保存失败时可复制本地内容。",
        );
      }
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("algopilot-before-navigate", guard);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("algopilot-before-navigate", guard);
    };
  }, [dirty, thoughtQueue, codeQueue]);
  async function history(offset: number, append = false) {
    setHistoryError("");
    try {
      const result = await requestJson<{
        items: Thought[];
        nextOffset: number | null;
      }>(`/api/v1/sessions/${session.id}/thoughts?offset=${offset}&limit=30`);
      setVersions((old) => (append ? [...old, ...result.items] : result.items));
      setNextOffset(result.nextOffset);
    } catch (failure) {
      setHistoryError(
        failure instanceof Error ? failure.message : "加载版本失败。",
      );
    }
  }
  useEffect(() => {
    let active = true;
    requestJson<{ items: Thought[]; nextOffset: number | null }>(
      `/api/v1/sessions/${initialSession.id}/thoughts`,
    )
      .then((result) => {
        if (active) {
          setVersions(result.items);
          setNextOffset(result.nextOffset);
        }
      })
      .catch(() => {
        if (active) setHistoryError("思路历史加载失败，请重试。");
      });
    return () => {
      active = false;
    };
  }, [initialSession.id]);
  async function saveVersion() {
    setBusy(true);
    setError("");
    try {
      await thoughtQueue.flush();
      const snapshot = thoughtQueue.getSnapshot();
      if (!snapshot.value.trim())
        throw new Error("请先写下思路，再保存历史版本。");
      if (
        !versionRequest.current ||
        versionRequest.current.content !== snapshot.value ||
        versionRequest.current.revision !== snapshot.revision
      )
        versionRequest.current = {
          content: snapshot.value,
          revision: snapshot.revision,
          id: crypto.randomUUID(),
        };
      const result = await requestJson<{
        session: TrainingSession;
        thought: Thought;
      }>(`/api/v1/sessions/${session.id}/thoughts`, {
        method: "POST",
        body: {
          content: snapshot.value,
          expectedRevision: snapshot.revision,
          requestId: versionRequest.current.id,
        },
      });
      thoughtQueue.acceptVersion(
        result.session.thought_draft,
        result.session.thought_revision,
      );
      versionRequest.current = null;
      await history(0);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "保存版本失败。");
    } finally {
      setBusy(false);
    }
  }
  async function transition(action: "pause" | "resume" | "finish") {
    setBusy(true);
    setError("");
    try {
      if (action === "finish")
        await Promise.all([thoughtQueue.flush(), codeQueue.flush()]);
      const result = await requestJson<{
        session: TrainingSession;
        serverNow: string;
      }>(`/api/v1/sessions/${session.id}`, {
        method: "PATCH",
        body: {
          action,
          expectedRevision: session.state_revision,
          ...(action === "finish" ? { outcome } : {}),
        },
      });
      setSession(result.session);
      baseClock.current = Date.parse(result.serverNow);
      receiptClock.current = performance.now();
      setClock(baseClock.current);
      setFinishOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "状态更新失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-widest text-primary">
            PRACTICE WORKSPACE
          </p>
          <h1 className="text-2xl font-semibold">
            {problem?.title ?? "自主训练"}
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            {session.mode === "contest" ? "比赛模式 · AI 禁用" : "独立训练"} ·{" "}
            {completed
              ? "已完成"
              : session.status === "paused"
                ? "已暂停"
                : "计时中"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span aria-label="有效训练时间" className="font-mono text-sm">
            {formatSeconds(displayedSeconds(session, clock))}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || completed}
            onClick={() =>
              void transition(session.status === "active" ? "pause" : "resume")
            }
          >
            {session.status === "paused" ? "继续计时" : "暂停"}
          </Button>
          <Button
            size="sm"
            disabled={busy || completed}
            onClick={() => setFinishOpen(true)}
          >
            结束训练
          </Button>
        </div>
      </div>
      {completed && (
        <p role="status" className="mb-4 rounded-lg border bg-card p-4 text-sm">
          训练已完成，用时不再累计。结果：
          {outcomes[session.outcome ?? "not_recorded"]}。未推断独立完成状态。
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error} 本地草稿仍保留。
          <Link
            href={`/login?next=${encodeURIComponent(`/practice/${session.id}`)}`}
            target="_blank"
            className="ml-2 underline"
          >
            在新窗口重新登录
          </Link>
        </p>
      )}
      {finishOpen && (
        <Card className="mb-5 shadow-none">
          <CardContent className="space-y-4 py-5">
            <label htmlFor="outcome" className="block text-sm">
              手动记录训练结果（用户自报）
            </label>
            <select
              id="outcome"
              className="max-w-full rounded border bg-background p-2 text-sm"
              value={outcome}
              onChange={(event) =>
                setOutcome(event.target.value as keyof typeof outcomes)
              }
              disabled={busy}
            >
              {Object.entries(outcomes).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              会先保存两种草稿。完成后不能继续计时或修改草稿；不生成 AI 复盘。
            </p>
            <div className="flex gap-3">
              <Button onClick={() => void transition("finish")} disabled={busy}>
                {busy ? "正在保存并完成…" : "确认完成"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setFinishOpen(false)}
                disabled={busy}
              >
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Tabs
        defaultValue="statement"
        className="gap-4 lg:grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)_minmax(0,1fr)]"
      >
        <TabsList
          className="grid w-full grid-cols-3 lg:hidden"
          aria-label="工作台区域"
        >
          <TabsTrigger value="statement">题面</TabsTrigger>
          <TabsTrigger value="thought">思路 / 代码</TabsTrigger>
          <TabsTrigger value="tutor">AI 教练</TabsTrigger>
        </TabsList>
        <TabsContent
          value="statement"
          forceMount
          className="data-[state=inactive]:hidden lg:data-[state=inactive]:block"
        >
          <Card className="h-full shadow-none">
            <CardHeader className="border-b">
              <CardTitle className="text-sm">题面与条件</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 py-6">
              <Badge variant="outline">
                {problem?.platform === "codeforces"
                  ? "公开元数据 · 用户题面快照"
                  : "私人题面"}
              </Badge>
              <p className="whitespace-pre-wrap break-words text-sm leading-7">
                {session.statement_snapshot ||
                  "尚未提供题面。本轮保留该快照，后续可创建新训练补充题面。"}
              </p>
              <p className="text-xs text-muted-foreground">
                算法标签默认隐藏。题面以纯文本安全展示。
              </p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent
          value="thought"
          forceMount
          className="data-[state=inactive]:hidden lg:data-[state=inactive]:block"
        >
          <Card className="h-full shadow-none">
            <CardHeader className="border-b">
              <CardTitle className="text-sm">思路与代码</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 py-6">
              <div>
                <label
                  htmlFor="thought-draft"
                  className="mb-3 block text-sm font-medium"
                >
                  当前思路
                </label>
                <Textarea
                  id="thought-draft"
                  value={thought.value}
                  onChange={(event) =>
                    thoughtQueue.setValue(event.target.value)
                  }
                  maxLength={64000}
                  readOnly={busy || completed}
                  className="min-h-40"
                />
                <p role="status" className="mt-2 text-xs text-muted-foreground">
                  思路：{draftLabels[thought.status]}
                </p>
                {thought.error && (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    {thought.error}{" "}
                    若存在多窗口冲突，先复制本地内容，再重新加载；不会自动覆盖服务器。
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void thoughtQueue.flush().catch(() => {})}
                    disabled={busy || completed}
                  >
                    保存思路草稿
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void saveVersion()}
                    disabled={busy || completed}
                  >
                    保存历史版本
                  </Button>
                </div>
              </div>
              <div>
                <h2 className="mb-3 text-sm font-medium">思路版本历史</h2>
                {historyError && (
                  <p role="alert" className="mb-2 text-xs text-destructive">
                    {historyError}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {versions.map((version) => (
                    <Button
                      key={version.id}
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedVersion(version)}
                    >
                      版本 {version.version}
                    </Button>
                  ))}
                  {versions.length === 0 && !historyError && (
                    <p className="text-xs text-muted-foreground">
                      尚无历史版本。草稿自动保存不会新增历史。
                    </p>
                  )}
                </div>
                {nextOffset !== null && (
                  <Button
                    className="mt-2"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void history(nextOffset, versions.length > 0)
                    }
                  >
                    加载更多版本
                  </Button>
                )}
                {historyError && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void history(0)}
                  >
                    重试加载历史
                  </Button>
                )}
                {selectedVersion && (
                  <div className="mt-3 rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">
                      版本 {selectedVersion.version} ·{" "}
                      {selectedVersion.created_at}
                    </p>
                    <p className="my-3 whitespace-pre-wrap break-words text-sm">
                      {selectedVersion.content}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || completed}
                      onClick={() =>
                        thoughtQueue.setValue(selectedVersion.content)
                      }
                    >
                      恢复到编辑器
                    </Button>
                    <p className="mt-2 text-xs text-muted-foreground">
                      恢复只修改当前草稿，不覆盖历史记录。
                    </p>
                  </div>
                )}
              </div>
              <div>
                <CodeEditor
                  value={code.value}
                  onChange={(value) => codeQueue.setValue(value)}
                  readOnly={busy || completed}
                />
                <p role="status" className="mt-2 text-xs text-muted-foreground">
                  代码：{draftLabels[code.status]}
                </p>
                {code.error && (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    {code.error} 本地内容保留，不自动覆盖服务器。
                  </p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  disabled={busy || completed}
                  onClick={() => void codeQueue.flush().catch(() => {})}
                >
                  保存代码草稿
                </Button>
              </div>
              <p className="text-xs leading-6 text-muted-foreground">
                草稿在停止编辑约 1.2
                秒后保存；请在“已保存到服务器”后刷新。离开页面前有未保存修改时会提醒。每次历史版本由你明确保存。
              </p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent
          value="tutor"
          forceMount
          className="data-[state=inactive]:hidden lg:data-[state=inactive]:block"
        >
          <TutorPanel idPrefix="live" preview={false} />
        </TabsContent>
      </Tabs>
    </>
  );
}
