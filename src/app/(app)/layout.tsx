import { AppShell } from "@/components/app-shell";
import { pageContext } from "@/server/auth";
import { ApiError } from "@/server/http";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/redirect";

export default async function ApplicationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let context;
  try {
    context = await pageContext();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      redirect(
        `/login?next=${encodeURIComponent(safeNext((await headers()).get("x-algopilot-path")))}`,
      );
    throw error;
  }
  return (
    <AppShell authenticated={Boolean(context)}>
      {!context && (
        <p
          role="status"
          className="mb-6 rounded-lg border bg-card p-4 text-sm text-muted-foreground"
        >
          Supabase
          未配置或配置不完整。这里只能浏览无数据布局；登录、保存与真实训练不可用。
        </p>
      )}
      {children}
    </AppShell>
  );
}
