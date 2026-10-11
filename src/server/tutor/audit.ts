import "server-only";
import { modelOutputSchema, type TutorAction } from "@/lib/validation/m2";
import { ApiError } from "@/server/http";
const questions = {
  premise: "这一步结论依赖哪些条件？请先说明其中最关键的一个。",
  proof: "你能给这一步推导补上一个明确的依据吗？",
  boundary: "把你的思路放到最小规模或边界情况时，这一步还成立吗？",
  complexity: "按你当前的步骤，最频繁的操作会执行多少次？",
  trace: "你能选一个小输入，逐步追踪当前思路或代码的状态吗？",
  invariant: "每次操作前后，你认为哪个条件应始终成立？",
};
const algorithmNames =
  /动态规划|贪心|二分|最短路|Dijkstra|Bellman|Floyd|并查集|线段树|树状数组|拓扑|强连通|Tarjan|网络流|最大流|最小割|倍增|状压|单调栈|单调队列|前缀和|差分数组|KMP|后缀|FFT|NTT|莫队|数位.?DP|欧几里得|中国剩余|快速幂|\b(?:DP|BFS|DFS|DSU|LIS|Fenwick|segment tree|binary search|greedy|dynamic programming)\b/i;
const implementation =
  /```|#include|\b(?:int main|std::|for\s*\(|while\s*\(|return\s+\w+\s*;)|伪代码|完整(?:题解|解法|代码)|逐步实现/;
function rejected(): never {
  throw new ApiError(
    502,
    "TUTOR_OUTPUT_REJECTED",
    "模型输出未通过提示权限或格式审核，未展示内容。请重试或调整已有思路。",
  );
}
export function auditOutput(
  text: string,
  input: {
    allowedLevel: number;
    action: TutorAction;
    thought: string;
    previousAssistant: string[];
    secrets: string[];
  },
) {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return rejected();
  }
  const parsed = modelOutputSchema.safeParse(raw);
  if (!parsed.success) return rejected();
  const out = parsed.data;
  if (
    out.disclosureLevel > input.allowedLevel ||
    (input.action === "explain" &&
      (input.allowedLevel !== 5 || out.disclosureLevel !== 5))
  )
    return rejected();
  if (
    input.secrets.some((key) => key && text.includes(key)) ||
    /<\s*\/?(?:script|iframe|object|embed|style|svg|img|think|analysis)\b[^>]*>|javascript:|data:text\/html|内部(?:推理|思维链)|chain.of.thought/i.test(
      text,
    )
  )
    return rejected();
  if (out.quote && !input.thought.includes(out.quote)) return rejected();
  let content = out.content.trim();
  let level = out.disclosureLevel;
  if (input.allowedLevel <= 1) {
    if (content) return rejected();
    const question =
      input.allowedLevel === 0 && ["boundary", "complexity"].includes(out.focus)
        ? questions.premise
        : questions[out.focus];
    // Quoted user text is plain text, escaped before Markdown; no new model prose at L0/L1.
    const quote = out.quote.replace(/[\\`*_{}[\]()#+.!<>$|~-]/g, "\\$&");
    content = `${quote ? `你写到：“${quote}”\n\n` : ""}${question}`;
    level =
      input.allowedLevel === 0
        ? 0
        : out.focus === "boundary" || out.focus === "complexity"
          ? 1
          : 0;
  } else {
    if (
      !content ||
      /一定错误|显然错误|必定正确|无需证明/.test(content) ||
      (input.allowedLevel < 3 && algorithmNames.test(content)) ||
      (input.allowedLevel < 4 && implementation.test(content))
    )
      return rejected();
    // Estimate a conservative floor independently from the model's self-reported level.
    level = Math.max(
      level,
      algorithmNames.test(content) ? 3 : 2,
      implementation.test(content) ? 4 : 0,
      /完整(?:解析|解法|代码|题解)|\b(?:int|auto|void|signed)\s+main\s*\(/i.test(
        content,
      )
        ? 5
        : 0,
    );
    if (level > input.allowedLevel) return rejected();
    if (
      input.allowedLevel < 5 &&
      /(?:完整解析|完整解法|完整代码|完整题解|(?:int|auto|void|signed)\s+main\s*\()/i.test(
        content,
      )
    )
      return rejected();
  }
  if (input.action === "counterexample") {
    if (
      /已验证|测试通过|运行(?:结果|通过)|经过验证|已执行|verified|tested successfully/i.test(
        content,
      )
    )
      return rejected();
    content = `${input.allowedLevel <= 1 ? "反例探索：尚未生成或验证具体反例。" : "候选反例（未执行程序验证，需自行检查）："}\n\n${content}`;
  }
  if (input.previousAssistant.some((previous) => previous === content))
    throw new ApiError(
      502,
      "TUTOR_REPEATED_GUIDANCE",
      "模型重复了已有引导，未保存重复回答。请补充新的推导后重试。",
    );
  return { content, disclosureLevel: level };
}
