# 五道替代题：评审者材料（含方向/解法线索，请勿在独立训练前给选手）

2026-10-15，审核来源：Codex AI 对照官方题面与可访问题解/官方发布解法。**不是人类教学评价，五题人工仍 0/5**；不修改线上标注、权重或原 40 条初评。原推荐理由/证据 ID 见 [原表](../m33/replacements-for-review.csv)；合成选手输入见 [scenarios.ts](../../tests/evaluation/scenarios.ts)，当前排序见 [M322 录制](../m322/recorded-catalog-scenarios.json)。

下面“先修”和“适配风险”是 AI 根据题意/解法提出的待人工验证建议，不是对真实选手能力的事实判断。题面网页含“近期修改”提示；本次以查阅页面为准，未来评审需注明查阅日期。官方 Rating 是题目元数据，并非选手能力或个体体验难度。

## advanced：1658/D2，2300

[题面](https://codeforces.com/problemset/problem/1658/D2) 给定异或后的整数区间排列，要求恢复任一可行掩码；标准输入输出，无交互。需区分 Hard 与 Easy，不能只套 Easy 的逐位计数。

[官方题解](https://codeforces.com/blog/entry/101302) 支持位配对/缩减区间的递归方法，也支持枚举候选并用二进制 Trie 校验。核心训练可为 XOR 不变量、候选有效性和位结构；Trie 是可选路线，不是唯一必需算法。先修建议：异或、二进制区间、配对论证；选 Trie 路线还需树上查询与复杂度控制。

原高级合成选手只有 40 道约 2300 的 math 自报完成记录，无提示不证明独立；理由仅支持难度/覆盖，不能证明会 Trie 或位技巧。请人工判断：是合适探索还是先修跳跃？题意还原与证明卡点能否被分开记录？**当前不填“适合”。**

## advanced：1895/E，2300

[题面](https://codeforces.com/problemset/problem/1895/E) 是可重复出牌的双方最优策略、胜/负/平局计数；不是需要用户交互协议的 interactive 题。

[官方发布解法](https://codeforces.com/blog/entry/122034) 可读，展开题解正文显示 loading，未声称完整正文已取得。发布解法使用排序、合法响应的前缀最优选择、二分和后继图遍历来分类结局。先修建议：排序/二分、状态转移、环与胜负传播；“最优响应”的正确性论证须由评审者检查。多种 Tags 不代表必须完整使用所有算法。

原高级场景未选 DP 专项，不能因为本题有 dp 标签就宣称它是 DP 核心训练。请人工检查：循环平局是否造成超出当前训练目标的负担？推荐理由是否应提示先修未知？

## graphs：1106/D，1500

[题面](https://codeforces.com/problemset/problem/1106/D) 允许在连通无向图中重复经过节点，记录首次到访顺序并求字典序最小；含重边/自环。[官方发布解法](https://codeforces.com/blog/entry/64928) 使用图邻接表、已发现集合与小根堆维护全局可选前沿。展开正文未成功取得，算法判断来自题面及官方发布解法，未复制/执行其代码。

支持图遍历＋贪心前沿训练；不等于最短路专项，也不是“邻接表排序后任意 DFS 都可以”。先修建议：图表示、可达性、visited、堆、贪心安全性。原合成场景九道图相关高等级提示，支持暂定加强图方向；不能证明实际卡点恰为堆或贪心。

请人工检查：是否满足“图论独立解题”而非专门 DFS/最短路目标？全局前沿与当前点邻居的差异能否作为复盘问题？线上当前仍为 Tags-only，未因本材料自动升为 core。

## dp：1253/C，1500

[题面](https://codeforces.com/problemset/problem/1253/C) 要求对每个选取数量，求每日容量约束下的最小加权糖分。[官方题解页](https://codeforces.com/blog/entry/71489?locale=en) 可打开，但正文仅显示 loading；本次**未核验官方正文算法**，不以评论区当官方结论。

以下为从题面独立推导的 AI 复核：先选最小的 k 个，再以交换论证把较大值安排较早；排序后可用前缀和与相隔 m 项的答案递推。支持一维递推/DP、贪心证明和前缀和的复合训练，不是背包/区间 DP 的保证。先修建议：排序、交换论证、前缀和、64 位整数与状态含义。

原 DP 场景高提示依赖只支持泛方向；如果目标是复杂状态设计，本题可能更偏贪心＋递推。**算法推导可信度与真人适合程度分开，官方正文核验仍待补。**

## dp：2069/C，1500

[题面](https://codeforces.com/problemset/problem/2069/C) 的值域为 1–3，计数满足两侧大小条件的美丽子序列。[官方发布解法](https://codeforces.com/blog/entry/139774) 使用按读入值更新的少量计数状态；展开正文 loading，未把发布代码当作完整文字证明。

从题面可推导目标形态为 1、至少一个 2、3；有限状态子序列计数是支持的训练任务，也可用组合计数观点。先修建议：子序列、状态不变量、模运算、重复计数和更新顺序；不能宣称 DP 唯一必需。请人工判断：是否符合 1500 的 DP 入门加强？会状态转移与能证明计数不重漏是否应分开记录？

## 真人填写与覆写

1. 先看题面和原场景/理由，再按实际目标与先修评判；题解仅评审者查阅，评审前说明是否看过该题。
2. 从 [M322 当前 40 题人工表](../m322/recommendations-for-review.csv) 复制到私有工作文件，仅填写对应 scenario + problem_key 的 assessment/rationale/suggestion/reviewer/reviewed_at/statement_consulted，review_type=human。可填“适合 / 偏简单 / 偏困难 / 方向不符 / 理由缺乏证据”；不确定就留空并在独立评审备注说明，不强制五题全适合。
3. 原始 AI、人工表和本材料不覆盖。用现有脚本对当前 40 题队列导入，人工结果优先，保留 auditHistory：

```bash
node scripts/m322-review.ts --recorded docs/m322/recorded-catalog-scenarios.json --manual docs/m322/recommendations-for-review.csv --ai docs/m322/current-ai-input.csv --human /private/path/human-review.csv --audit docs/m322/current-source-audit.json --previous /private/path/previous-summary.json --output /private/path/current-review
```

输入可用完整原表（未填行保持空），脚本按键关联。不要向 AI 请求填“真人”列；AI 自核验、来源查阅、真人结果分别记录。评审者署名声明本身不是身份验签，实际身份需研究负责人确认。未取得同意的个人意见/记录不要提交到公开仓库。
