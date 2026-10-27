"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Dialog } from "radix-ui";
import { MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ClientError, requestJson } from "@/lib/api-client";
import { isGenerationDenied } from "@/lib/validation/generation";
import type {
  TutorAction,
  TutorMessage,
  TutorState,
} from "@/lib/validation/m2";
const Markdown = dynamic(() => import("./tutor-markdown"), {
  loading: () => <p>正在加载消息…</p>,
});
const actions: [TutorAction, string][] = [
  ["hint", "给我一点提示"],
  ["validate", "检查我的思路"],
  ["counterexample", "找候选反例"],
  ["complexity", "分析复杂度"],
  ["debug", "检查代码"],
  ["explain", "完整解析（L5）"],
];
type History = {
  state: TutorState;
  messages: TutorMessage[];
  nextBefore: number | null;
};
export function TutorConversation({
  sessionId,
  mode,
  completed,
  prepare,
}: {
  sessionId: string;
  mode: "practice" | "contest";
  completed: boolean;
  prepare: () => Promise<void>;
}) {
  const [state, setState] = useState<TutorState | null>(null);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [challenge, setChallenge] = useState<{
    id: string;
    requestId: string;
    expiresAt: string;
  } | null>(null);
  const [pending, setPending] = useState<{
    action: TutorAction;
    message: string;
    requestId: string;
  } | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const result = await requestJson<History>(
      `/api/v1/sessions/${sessionId}/tutor`,
    );
    return result;
  }, [sessionId]);
  useEffect(() => {
    let disposed = false;
    const current = ++generation.current;
    void load()
      .then((r) => {
        if (!disposed && generation.current === current) {
          setState(r.state);
          setMessages(r.messages);
          setNextBefore(r.nextBefore);
        }
      })
      .catch((e: unknown) => {
        if (!disposed)
          setError(e instanceof Error ? e.message : "对话加载失败。");
      });
    return () => {
      disposed = true;
      generation.current = current + 1;
    };
  }, [load]);
  const disabled =
    busy || !state?.configured || mode === "contest" || completed;
  async function analyze(action: TutorAction, retry = false) {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      await prepare();
      const body =
        retry && pending
          ? pending
          : {
              action,
              message:
                input.trim() ||
                actions.find(([a]) => a === action)?.[1] ||
                "请围绕我的已有思路提出一个问题。",
              requestId: crypto.randomUUID(),
            };
      setPending(body);
      const r = await requestJson<History>(
        `/api/v1/sessions/${sessionId}/tutor`,
        { method: "POST", body },
      );
      if (generation.current !== current) return;
      setState(r.state);
      setMessages(r.messages);
      setNextBefore(r.messages.length === 50 ? r.messages[0]!.ordinal : null);
      setPending(null);
      setInput("");
    } catch (e) {
      if (generation.current === current) {
        if (e instanceof ClientError && (isGenerationDenied(e.code) || e.code === "TUTOR_REQUEST_FAILED")) setPending(null);
        setError(e instanceof Error ? e.message : "AI 请求失败。");
      }
    } finally {
      inFlight.current = false;
      if (generation.current === current) setBusy(false);
    }
  }
  async function unlock(operation: "upgrade" | "begin_l5" | "confirm_l5") {
    if (!state || busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const requestId =
        operation === "confirm_l5" ? challenge!.requestId : crypto.randomUUID();
      const body = {
        operation,
        revision: state.revision,
        requestId,
        ...(operation === "begin_l5"
          ? { confirmation: "我确认申请完整解析" }
          : operation === "confirm_l5"
            ? {
                confirmation: "我确认完整解析会影响独立完成记录",
                challengeId: challenge!.id,
              }
            : {}),
      };
      const r = await requestJson<{
        allowedLevel: number;
        revision: number;
        challengeId?: string;
        expiresAt?: string;
      }>(`/api/v1/sessions/${sessionId}/hints`, { method: "POST", body });
      setState({
        ...state,
        allowedLevel: r.allowedLevel,
        revision: r.revision,
      });
      if (operation === "begin_l5")
        setChallenge({
          id: r.challengeId!,
          requestId,
          expiresAt: r.expiresAt!,
        });
      if (operation === "confirm_l5") {
        setChallenge(null);
        setConfirmationOpen(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "提示升级失败。");
      const r = await load().catch(() => null);
      if (r) setState(r.state);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <Card className="h-full min-w-0 shadow-none">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <MessageSquare className="size-4" />
            思维教练
          </span>
          <Badge variant="secondary">L{state?.allowedLevel ?? 0}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 py-5">
        <p className="text-xs leading-6 text-muted-foreground">
          当前授权 L{state?.allowedLevel ?? 0} · 已查看最高 L
          {state?.maxSeenLevel ?? 0}。授权升级不会直接算作已查看。
        </p>
        <p role="status" className="text-xs leading-6 text-muted-foreground">
          {mode === "contest"
            ? "比赛模式：服务端禁止题目相关 AI 辅助。"
            : completed
              ? "训练已完成，可查看对话记录。"
              : state?.configurationMessage ||
                (state
                  ? `今日请求 ${state.used} / ${state.limit}（UTC 重置）`
                  : "正在读取 AI 配置与对话…")}
        </p>
        <div
          className="max-h-[32rem] space-y-4 overflow-y-auto break-words"
          aria-label="AI 对话历史"
          aria-live="polite"
        >
          {nextBefore && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void requestJson<History>(
                  `/api/v1/sessions/${sessionId}/tutor?before=${encodeURIComponent(nextBefore)}`,
                )
                  .then((r) => {
                    setMessages((previous) => [...r.messages, ...previous]);
                    setNextBefore(r.nextBefore);
                  })
                  .catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : "历史加载失败。"),
                  );
              }}
            >
              加载更早对话
            </Button>
          )}
          {!messages.length && (
            <p className="rounded-lg bg-primary/5 p-4 text-sm leading-7">
              有思路时围绕具体卡点追问；完全没思路时，从题面、约束和样例开始，一次推进一个小问题。
            </p>
          )}
          {messages.map((m) => (
            <article
              key={m.id}
              className={`min-w-0 rounded-lg border p-3 ${m.role === "user" ? "bg-muted/50" : "bg-primary/5"}`}
            >
              <p className="mb-2 text-xs text-muted-foreground">
                {m.role === "user" ? "你" : `教练 · L${m.disclosure_level}`} ·
                思路版本状态 {m.thought_revision}
              </p>
              {m.role === "user" ? (
                <p className="whitespace-pre-wrap text-sm">{m.content}</p>
              ) : (
                <Markdown content={m.content} />
              )}
            </article>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {actions.map(([action, label]) => (
            <Button
              key={action}
              variant="outline"
              size="sm"
              className="px-1 text-xs"
              disabled={
                disabled || (action === "explain" && state?.allowedLevel !== 5)
              }
              onClick={() => void analyze(action)}
            >
              {label}
            </Button>
          ))}
        </div>
        <label
          htmlFor={`tutor-message-${sessionId}`}
          className="block text-sm font-medium"
        >
          发送给思维教练
        </label>
        <Textarea
          id={`tutor-message-${sessionId}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={6000}
          disabled={disabled}
          placeholder="描述已有推导或卡点；也可以直接说明“完全没有思路”…"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={disabled || !input.trim()}
            onClick={() => void analyze("chat")}
          >
            发送
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || (state?.allowedLevel ?? 0) >= 5}
            onClick={() => {
              if (state?.allowedLevel === 4) {
                setChallenge(null);
                setConfirmationOpen(true);
              } else void unlock("upgrade");
            }}
          >
            升级提示
          </Button>
        </div>
        {busy && (
          <p role="status" className="text-sm">
            正在分析…完整响应审核后才会显示。
          </p>
        )}
        {error && (
          <div
            role="alert"
            aria-label="AI 请求错误"
            className="space-y-2 text-sm text-destructive"
          >
            <p>{error}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  void load()
                    .then((r) => {
                      setState(r.state);
                      setMessages(r.messages);
                      setNextBefore(r.nextBefore);
                      setError("");
                    })
                    .catch((e: unknown) =>
                      setError(e instanceof Error ? e.message : "加载失败。"),
                    );
                }}
              >
                重新加载
              </Button>
              {pending && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => void analyze(pending!.action, true)}
                  >
                    查询 / 重试原请求
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => void analyze(pending!.action)}
                  >
                    发起新请求
                  </Button>
                </>
              )}
            </div>
            <p className="text-xs">
              已失败或过期的请求需重新发起；新请求会占用额度，原请求可能已产生费用。
            </p>
          </div>
        )}
        <p className="text-xs leading-6 text-muted-foreground">
          只静态分析，不执行
          C++。候选反例需要自行验证。自动审核不能保证完全避免剧透或判断错误。
        </p>
        <Dialog.Root
          open={confirmationOpen}
          onOpenChange={(open) => {
            if (!busy) setConfirmationOpen(open);
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border bg-background p-6 shadow-xl">
              <Dialog.Title className="font-semibold">
                完整解析需要两次确认
              </Dialog.Title>
              <Dialog.Description className="text-sm leading-7 text-muted-foreground">
                完整题解和代码会影响独立完成的学习证据。授权后仍须主动请求内容，最高已查看等级才会更新。
              </Dialog.Description>
              {challenge ? (
                <>
                  <p className="text-sm">
                    第一次确认已完成，有效至{" "}
                    {new Date(challenge.expiresAt).toLocaleTimeString()}。
                  </p>
                  <Button
                    disabled={busy}
                    onClick={() => void unlock("confirm_l5")}
                  >
                    第二次确认：授权完整解析
                  </Button>
                </>
              ) : (
                <Button disabled={busy} onClick={() => void unlock("begin_l5")}>
                  第一次确认：申请完整解析
                </Button>
              )}
              <Dialog.Close asChild>
                <Button variant="outline" disabled={busy}>
                  取消
                </Button>
              </Dialog.Close>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </CardContent>
    </Card>
  );
}
