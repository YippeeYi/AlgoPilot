import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { pageContext } from "@/server/auth";
import { Recommendations } from "@/components/learning/recommendations";
export default async function DashboardPage() {
  const context = await pageContext();
  return <><PageHeading eyebrow="YOUR NEXT PROBLEM" title="现在应该练什么，为什么？" description="根据真实训练、实际提示和已授权复盘，选择少量值得练习的题。"/>{context ? <Recommendations/> : <EmptyState title="登录后获得个性化推荐" description="没有历史也可以通过简短自评开始；无配置预览不生成虚构推荐。" href="/practice/preview" action="预览题目分析工作台"/>}</>;
}
