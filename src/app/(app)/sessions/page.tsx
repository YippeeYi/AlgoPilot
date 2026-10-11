import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";

export default function SessionsPage() {
  return (
    <>
      <PageHeading
        eyebrow="TRAINING HISTORY"
        title="看见你的思考轨迹"
        description="继续未完成的训练，或回顾每一次的思路、提示使用和最终结果。"
      />
      <EmptyState
        title="还没有训练记录"
        description="真实会话接入后，训练记录将按时间排列。Codeforces AC 将与本次训练的独立完成状态分别记录。"
        href="/practice/preview"
        action="预览训练工作台"
      />
    </>
  );
}
