"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { requestJson } from "@/lib/api-client";
import type { TrainingSession } from "@/lib/validation/m1";
import { formatSeconds } from "@/features/sessions/time";

export function SessionList() {
  const [items, setItems] = useState<TrainingSession[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    requestJson<{ items: TrainingSession[]; nextOffset: number | null }>(
      `/api/v1/sessions?offset=${offset}`,
    )
      .then((result) => {
        if (active) {
          setItems(result.items);
          setNextOffset(result.nextOffset);
          setError("");
        }
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error ? failure.message : "训练列表加载失败。",
          );
      });
    return () => {
      active = false;
    };
  }, [offset, retry]);
  if (error)
    return (
      <div role="alert" className="rounded-lg border bg-card p-5 text-sm">
        <p>{error}</p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => setRetry((old) => old + 1)}
        >
          重试加载
        </Button>
        <Link href="/login?next=%2Fsessions" className="ml-3 text-primary">
          重新登录
        </Link>
      </div>
    );
  if (!items)
    return (
      <p role="status" className="p-5 text-sm text-muted-foreground">
        正在加载个人训练…
      </p>
    );
  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <EmptyState
          title="还没有训练记录"
          description="创建训练后，思路版本、代码草稿和暂停状态会保存在你的账户中。"
        />
      ) : (
        items.map((session) => (
          <Card key={session.id} className="shadow-none">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
              <div>
                <p className="text-sm font-medium">
                  {session.mode === "contest" ? "比赛训练" : "独立训练"} ·{" "}
                  {session.status === "completed"
                    ? "已完成"
                    : session.status === "paused"
                      ? "已暂停"
                      : "计时中"}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {new Date(session.created_at).toLocaleString("zh-CN")} ·
                  已累计 {formatSeconds(session.active_seconds)}
                </p>
                {session.outcome && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    结果来源：用户自报，未验证官方 AC 或独立性。
                  </p>
                )}
              </div>
              <Link
                className="rounded-lg border px-4 py-2 text-sm text-primary"
                href={`/practice/${session.id}`}
              >
                {session.status === "completed" ? "查看训练" : "重新打开训练"}
              </Link>
            </CardContent>
          </Card>
        ))
      )}
      <div className="flex justify-between">
        <Button
          size="sm"
          variant="outline"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 30))}
        >
          上一页
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={nextOffset === null}
          onClick={() => nextOffset !== null && setOffset(nextOffset)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
