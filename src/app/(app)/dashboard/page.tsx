import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { pageContext } from "@/server/auth";
import { Recommendations } from "@/components/learning/recommendations";
import { skillFocusSchema } from "@/lib/validation/learning";
export default async function DashboardPage({searchParams}: {searchParams: Promise<{focus?: string;window?:string}>}) {
  const context = await pageContext();
  const query=await searchParams;
  const focus=query.focus ? skillFocusSchema.safeParse({topic:query.focus,window:query.window ?? "30"}) : null;
  return <><PageHeading eyebrow="YOUR NEXT PROBLEM" title="现在应该练什么，为什么？" description="根据真实训练、实际提示和已授权复盘，选择少量值得练习的题。"/>{focus && !focus.success ? <p role="alert">专项链接无效，请返回能力画像重新选择。</p> : context ? <Recommendations key={focus?.success ? JSON.stringify(focus.data) : "default"} focus={focus?.success ? focus.data : undefined}/> : <EmptyState title="登录后获得个性化推荐" description="没有历史也可以通过简短自评开始；无配置预览不生成虚构推荐。" href="/practice/preview" action="预览题目分析工作台"/>}</>;
}
