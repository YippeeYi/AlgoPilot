import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { AbilityProfile } from "@/components/learning/ability-profile";
import { pageContext } from "@/server/auth";
export default async function AnalyticsPage() {
  const context = await pageContext();
  return <><PageHeading eyebrow="EVIDENCE OF ABILITY" title="用真实证据理解能力" description="知识方向、难度表现与提示依赖：每项判断附样本和来源，证据不足时保持暂定。"/>{context ? <AbilityProfile/> : <EmptyState title="样本不足" description="登录并完成真实训练后生成能力画像；无数据预览不估算能力。" href="/dashboard" action="查看为你推荐"/>}</>;
}
