import { PageHeading } from "@/components/page-heading";
import { EmptyState } from "@/components/empty-state";

export default function ReviewsPage() {
  return (
    <>
      <PageHeading
        eyebrow="REFLECT & REVISIT"
        title="复盘，让收获留得更久"
        description="把卡点、关键证据和下次需要验证的思路写下来，再为自己安排一次重新挑战。"
      />
      <EmptyState
        title="还没有复盘与复习安排"
        description="结束真实训练后可以保存并编辑复盘。官方事实、用户自报和 AI 推测会分别标记。"
      />
    </>
  );
}
