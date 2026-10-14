import Link from "next/link";
import type { EvidenceRef } from "@/features/learning/engine";
export function EvidenceLinks({ refs }: {
    refs: EvidenceRef[];
}) {
    const representatives = [...new Set(refs.map(r => r.kind))].map(kind => refs.find(r => r.kind === kind)!);
    const visible = [...representatives, ...refs.filter(r => !representatives.some(s => s.id === r.id))].slice(0, 8);
    return <details className="text-xs leading-6"><summary className="cursor-pointer">主要依据（{refs.length} 条）</summary><ul className="space-y-1">{visible.map(r => <li key={r.id}>{r.kind === "official_submission" ? <a className="text-primary underline break-all" href={`https://codeforces.com/${r.contestId! >= 100000 ? "gym" : "contest"}/${r.contestId}/submission/${r.submissionId}`} target="_blank" rel="noreferrer">CF 官方 OK · 关联公开账号 {r.handle} · 提交 {r.submissionId}（归属/独立性未验证）· 采集 {r.observedAt}</a> : r.kind === "user_feedback" ? <span>用户反馈 · {r.id}</span> : <Link className="text-primary underline break-all" href={r.kind === "training" ? `/practice/${r.id}` : `/reviews?reviewId=${r.reviewId}`}>{r.kind === "training" ? "训练与实际提示记录" : "AI 复盘（未验证）"} · {r.id}</Link>}</li>)}</ul>{refs.length > 8 && <p>显示最多 8 条，包含各来源样例；可通过对应训练、复盘或 CF 官方链接核对。</p>}</details>;
}
