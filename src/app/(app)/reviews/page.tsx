import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";
import { ReviewWorkspace } from "@/components/reviews/review-workspace";
import { pageContext } from "@/server/auth";
import { idSchema } from "@/lib/validation/m1";
export default async function ReviewsPage({ searchParams }: {
    searchParams: Promise<{
        sessionId?: string; reviewId?: string;
    }>;
}) {
    const context = await pageContext();
    const params = await searchParams;
    const selected = idSchema.safeParse(params.reviewId);
    const parsed = idSchema.safeParse(params.sessionId);
    return <><PageHeading eyebrow="REFLECT & REVISIT" title="AC 后深度代码复盘" description="导入你主动提供的 C++ 代码，明确授权后静态分析算法、证明、复杂度和可迁移知识。"/>{context ? <ReviewWorkspace initialSessionId={parsed.success ? parsed.data : ""} initialReviewId={selected.success ? selected.data : ""}/> : <EmptyState title="复盘需要登录并配置数据库" description="无数据预览不读取文件、不保存代码，也不调用 AI。"/>}</>;
}
