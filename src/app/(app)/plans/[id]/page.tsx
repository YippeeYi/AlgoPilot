import { notFound } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { PlanWorkspace } from "@/components/plans/plan-workspace";
import { pageContext } from "@/server/auth";
import { idSchema } from "@/lib/validation/m1";
export default async function PlanPage({ params }: {
    params: Promise<{
        id: string;
    }>;
}) { const id = idSchema.safeParse((await params).id); if (!id.success)
    notFound(); const context = await pageContext(); return <><PageHeading eyebrow="TRAINING PLAN" title="计划与学习记录" description="每次训练独立保存；手动结束、自报 AC 和官方证据分别记录。"/>{context ? <PlanWorkspace id={id.data}/> : <p>请配置 Supabase 并登录。</p>}</>; }
