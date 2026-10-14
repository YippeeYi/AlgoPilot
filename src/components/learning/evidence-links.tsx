import Link from "next/link";
import type { EvidenceRef } from "@/features/learning/engine";
export function EvidenceLinks({ refs }: {
    refs: EvidenceRef[];
}) {
    return <details className="text-xs leading-6"><summary className="cursor-pointer">主要依据（{refs.length} 条）</summary><ul className="space-y-1">{refs.slice(0, 8).map(r => <li key={r.id}>{r.kind === "user_feedback" ? <span>用户反馈 · {r.id}</span> : <Link className="text-primary underline break-all" href={r.kind === "training" ? `/practice/${r.id}` : `/reviews?reviewId=${r.reviewId}`}>{r.kind === "training" ? "训练与实际提示记录" : "AI 复盘（未验证）"} · {r.id}</Link>}</li>)}</ul>{refs.length > 8 && <p>显示前 8 条；完整记录可在训练历史查看。</p>}</details>;
}
