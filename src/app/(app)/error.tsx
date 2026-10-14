"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="rounded-xl border bg-card p-8">
      <h1 className="text-xl font-semibold">页面暂时无法加载</h1>
      <p className="my-4 text-sm text-muted-foreground">
        请重试。若问题持续，可以返回为你推荐稍后再试。
      </p>
      <Button onClick={reset}>重新加载</Button>
    </div>
  );
}
