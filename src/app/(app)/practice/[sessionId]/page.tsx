import { notFound } from "next/navigation";
import { WorkspacePreview } from "@/components/practice/workspace-preview";

// M0 仅允许预览路径；在进入真实会话数据层前，未知 ID 由路由层返回 404。
export const dynamicParams = false;
export function generateStaticParams() {
  return [{ sessionId: "preview" }];
}

export default async function PracticePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  if (sessionId !== "preview") notFound();
  return <WorkspacePreview />;
}
