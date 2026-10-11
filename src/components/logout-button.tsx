"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ClientError, requestJson } from "@/lib/api-client";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    if (
      !window.dispatchEvent(
        new Event("algopilot-before-navigate", { cancelable: true }),
      )
    )
      return;
    setPending(true);
    setError("");
    try {
      await requestJson("/api/v1/auth/logout", { method: "POST", body: {} });
      router.replace("/login");
      router.refresh();
    } catch (failure) {
      if (failure instanceof ClientError && failure.status === 401) {
        router.replace("/login");
        router.refresh();
      } else setError("退出失败，请重试。");
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <Button variant="outline" size="sm" onClick={logout} disabled={pending}>
        {pending ? "正在退出…" : "退出登录"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
