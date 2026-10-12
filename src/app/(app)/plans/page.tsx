import { PageHeading } from "@/components/page-heading";
import { PlanWorkspace } from "@/components/plans/plan-workspace";
import { pageContext } from "@/server/auth";
export default async function PlansPage() { const context = await pageContext(); return <><PageHeading eyebrow="TRAINING PLANS" title="我的计划" description="安排多题练习，分别查看手动进度、训练记录、官方状态和复盘。"/>{context ? <PlanWorkspace /> : <p>配置 Supabase 并登录后可创建和管理计划。</p>}</>; }
