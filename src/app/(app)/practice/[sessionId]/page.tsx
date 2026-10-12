import { notFound } from "next/navigation";
import { Workspace } from "@/components/practice/workspace";
import { idSchema } from "@/lib/validation/m1";
import { pageContext } from "@/server/auth";
import { trainingRepository } from "@/server/db/training";
import { ApiError } from "@/server/http";

export default async function PracticePage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams:Promise<{planId?:string}>;
}) {
  const planId=idSchema.safeParse((await searchParams).planId);
  const parsed = idSchema.safeParse((await params).sessionId);
  if (!parsed.success) notFound();
  const context = await pageContext();
  if (!context)
    return <p>Supabase 未配置，无法打开或保存真实训练。请使用公开预览。</p>;
  const repo = trainingRepository(context.client, context.user.id);
  const session = await repo.get(parsed.data).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const problem = session.problem_id
    ? await repo.problem(session.problem_id)
    : null;
  return (
    <Workspace
      key={session.id}
      initialSession={session}
      planId={planId.success?planId.data:undefined}
      problem={problem}
      serverNow={new Date().toISOString()}
    />
  );
}
