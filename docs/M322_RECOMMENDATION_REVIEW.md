# M3.2.2 推荐评审整合与定向修复

实施与验收：2026-10-14–15；预期/实际基线 `341076786b1e6bc8202251f51fef81e95e59b808`。开始时仅 `docs/m321/ai-assisted-review.csv` 为用户新增文件，原人工 CSV 未修改；001–008 未修改，无生产迁移、生产数据变更或部署。

## 评审数据与可信边界

原始 [AI 辅助 CSV](m321/ai-assisted-review.csv) 保留原字节（UTF-8 BOM、CRLF），与 [原人工表](m321/manual-review.csv) 按 scenario + problem_key 关联。40/40 唯一键、题号、Rating、官方 URL、枚举和来源校验通过；AI 初评为 **33 适合、2 偏简单、5 方向不符**。**真人完成仍为 0/40**，每个场景 0/5，真人适合率为 NULL。33/40 的 AI 适合率不是实际教学收益。

[导入汇总](m322/review-summary.json) / [关联 CSV](m322/review-joined.csv) 保留 AI 理由、建议、评审者、日期、题面查阅自报、review_type。真人覆写优先于 AI，来源分栏；[空覆写表](m322/human-overrides.csv) 使用 review_type=human，不改原文件。脚本校验来源并记录真人字段修改前后差异，保留 auditHistory（本轮为空）；评审者身份仍依赖真实填写与 Git 审核，CSV 声明不是身份验签。测试中的合成评审者仅在内存中，不计入交付结果。

[独立来源检查](m322/source-audit.json) 共七项：2 项环境不兼容确认、3 项专项匹配风险有官方依据、2 项相对难度待确认。来源核验由 Codex AI 完成，**不是真人教学评价**；原 AI 适合结论仍待人工复核，未核验项保持 unconfirmed。离线脚本/评测文件不被 src 导入，不作为线上选手能力证据。

## 独立核验与处置

| 样本 | 官方依据与判断 | 实际处置 |
| --- | --- | --- |
| 130/I | [官方题面](https://codeforces.com/problemset/problem/130/I) 的 Languages 面板限定 Unknown Language Round 4 仅 Befunge；题面是排序。不能证明 Rating 的形成原因。 | 用带来源、版本、AI 核验状态的比赛级限制覆盖该比赛 10 题；不对全体 special 下结论。 |
| 2129/C3 | [官方题面](https://codeforces.com/problemset/problem/2129/C3) 明确交互协议、查询预算和 interactor；Hacks 的输入格式不等于原训练任务无需交互。 | 官方 interactive Tags 在 SQL 候选分层前排除，引擎重复防御。 |
| 1487/C | [题面](https://codeforces.com/problemset/problem/1487/C) / [官方题解](https://codeforces.com/blog/entry/87873) 的解法按循环距离和奇偶构造结果。图的解释有价值，但不能保证练到图搜索。 | constructive/math 为已核验支持的核心任务，graphs/dfs 为相关任务，降专项强度，不全局禁题。 |
| 1553/D | [题面](https://codeforces.com/problemset/problem/1553/D) / [官方题解页面](https://codeforces.com/blog/entry/93105) 发布的解法使用奇偶与扫描跳过，未使用 DP 状态。展开的题解文字显示动态加载，本轮对照的是官方发布解法；未复制/运行其代码。 | greedy/two pointers/strings 为支持的核心任务，dp 为相关任务；不否认其他 DP 解法。 |
| 2053/C | [题面](https://codeforces.com/problemset/problem/2053/C) / [官方题解](https://codeforces.com/blog/entry/136455) 给出对称计数、按长度处理和递归折半等方法；递推不自动意味着 DP 状态设计训练。 | math/divide and conquer 核心任务，dp 相关任务；不全局禁题。 |
| 29/A、672/B | [29/A](https://codeforces.com/problemset/problem/29/A) 的小规模成对枚举与 [672/B](https://codeforces.com/problemset/problem/672/B) 的字符观察/计数可用于摸底；相对简单的判断有合理性。16 条合成历史为同难度 math 自报完成，无可靠独立性/枚举/字符串掌握证明。 | 保留难度模型，两题均未禁用或改 Rating；冷启动和已有记录可能相同参考难度，解释/证据不同。热身与主训练的主观边界待真人验证。 |

正向标注也独立核验：[690/C2 官方教学 PDF](https://assets.codeforces.com/files/690/hc2-2016-editorial.pdf) 支持树直径遍历；[264/B 官方题解](https://codeforces.com/blog/entry/6478) 明确最长序列状态/因子转移；[1526/C1 官方题解](https://codeforces.com/blog/entry/91195) 明确允许二次 DP 和贪心。标注表示“存在经来源核验的合适任务”，**不表示算法唯一或必需**。690/C1 为新增非问题控制样本，同一 PDF 支持连通性/无环判定。小集共七题，无全库 AI 分类。

## 实现与受控实验

- `src/features/learning/problem-annotations.json`：teaching-metadata/1，来源/日期/checkedBy/status、核心与相关任务、小型比赛语言限制。维护标注需来源审核与回归，不记录预定推荐结果。
- `src/features/learning/problem-fit.ts`：统一兼容性与知识匹配；未知 special 保留并提示确认，未提及主题保持未知，不能以不完整标注反证其他知识方向。
- `src/features/learning/engine.ts`：deterministic/1.2；原评分权重与 600/500/200 上限、难度中位数/提示/反馈、用户证据和画像模型均保持。只有专项加权的匹配强度变为核验核心 1、Tags-only 0.75、核验相关 0.25，集中配置。弱项 22 和目标 16 按强度计算；AI 复盘上限仍为 6、不随数量累加。新颖/当轮覆盖仍由 Tags 估计，不能称教学多样性。
- 解释来自实际匹配/因素，标明来源核验由 AI 进行及不确定性。默认不输出隐藏方向、完整标注或题解链接；只返回版本和依据类别。special 未核验限制不被伪装成已确认适合。
- `009_recommendation_fit.sql`：只追加私有例外表和替换候选读取 RPC，interactive/来源确认的语言限制在 filtered CTE 中执行，之后沿用 008 分层和 600 预算。表 RLS、无普通用户 DML/读取授权，空 search_path、auth.uid 与候选 RPC ACL 保持；不修改历史数据。原始 009 DDL 重跑原子拒绝，不宣称可任意重跑。
- `src/server/learning/repository.ts`：要求候选策略 training-fit/1，旧库返回安全 503 CANDIDATE_POLICY_UNAVAILABLE，避免用旧 600 池后过滤导致预算污染。部署应用前须明确授权并核验缺失迁移，不能将新应用直接连旧库视为上线成功。

控制变量：[comparison.json](m322/comparison.json) 固定原八类合成选手、11,450 道元数据、稳定题目 ID、参考难度与原计划集合。冻结 `tests/evaluation/m321-baseline-engine.ts` 的 3410767 算法，分三组：008+旧评分；009+旧评分（只改候选）；009+新匹配强度（候选相同）。改组时历史、计划和所有主权重不变；计划标记按固定 ID 关联，不按变动候选的位置重新分配。重放严格复现原 40 个主键。

候选过滤单独使进阶两题消失，图论/DP 的旧排序不变；评分变更才使三道非核心关联样本退出前五。另用相同 Rating/Tags/历史/无计划候选的实验确认核心、Tags-only、相关匹配分别得到弱项 22、16.5、5.5；主题目标分别完整或折减。任何题目都没有固定名次或直接排序特判。

## 前后结果

以下是结构性自动观察，**不是适合率的新人工测评**。所有场景仍为最多 600 候选/5 题；新池覆盖率以兼容过滤后的 eligible 为分母。

| 场景 | eligible 前→后 | 600 覆盖率前→后 | 参考难度 | Tags 覆盖前→后 | 新推荐外部键 |
| --- | --- | --- | --- | --- | --- |
| 无历史 | 2774 → 2771 | 21.6% → 21.7% | 1000 | 7 → 7 | 1800/B、29/A、1765/E、672/B、2156/B |
| 两题记录 | 3259 → 3229 | 18.4% → 18.6% | 1300 | 13 → 13 | 1381/A1、298/A、1900/C、2129/A、1603/A |
| 初学者 | 2774 → 2771 | 21.6% → 21.7% | 1000 | 7 → 7 | 1800/B、29/A、1765/E、672/B、2156/B |
| 中等 | 2484 → 2430 | 24.2% → 24.7% | 1600 | 12 → 12 | 1861/C、1327/C、253/C、1334/C、322/B |
| 进阶 | 3074 → 2953 | 19.5% → 20.3% | 2300 | 15 → 17 | 2028/E、727/F、1101/G、1658/D2、1895/E |
| 图论高提示 | 2484 → 2430 | 24.2% → 24.7% | 1500 | 10 → 10 | 690/C2、114/B、402/C、177/C1、1106/D |
| DP 高提示 | 2484 → 2430 | 24.2% → 24.7% | 1500 | 13 → 12 | 264/B、1526/C1、1997/D、1253/C、2069/C |
| 多完成/计划/反馈 | 2484 → 2430 | 24.2% → 24.7% | 1600 | 18 → 18 | 2061/C、1980/E、1921/E、727/B、2157/D |

- 已知不兼容出现次数：2 → 0；全录制有 313 道 interactive、130 比赛 10 题（计数包含缺 Rating 题），不都属于本轮范围。560 道 special 中 538 道未被上述已知限制排除；不能证明它们全适合 C++，其他语言限制仍可能遗漏。
- 图论：已核验核心任务 1/5 → 1/5，但该题升到首位；已核验非核心关联 1/5 → 0/5，其他四题仍只有 Tags/待核验。DP：核验核心 2/5 → 2/5，非核心关联 2/5 → 0/5，另三题仍未核验，不能宣称 DP 真匹配率 100%。
- 原 40 条：35 条保留（全部 33 条 AI“适合”与 2 条“偏简单”）；五条来源支持的问题换出，替代 1658/D2、1895/E、1106/D、1253/C、2069/C 仍待教学评审。两条简单题不因局部 AI 标签而全局排除。
- 全部 8 场景：参考难度/推荐 Rating 无变化，重复/已知完成/坏证据引用/已计划推荐均为 0。新候选及倒序输入重放完全一致；分数等于实际因素之和。原 DB 全历史完成/跨计划过滤断言继续通过。
- Tags 覆盖：进阶 15→17，DP 13→12，其他不变。方向数量变化不是教学收益；DP 降 1 不能自动称回归或改进。所有 33 条保留不证明练习顺序/先修知识合适。
- 同题不同水平：1000 分题在无历史及 16 条 1000 分完成时目标同为 1000；改为 3 条 1200 完成时目标 1200、该题难度适配由 40 降为 20；加入 L4 依赖后目标 1100；真实用户偏好反馈太简单也将目标推到 1100，并对该题降权。不能仅增加记录数量伪装掌握。

## 性能与架构

同样 600 候选/合成历史、两次预热后各十次计算，新增来源匹配带来计算成本；逐场景中位/P95 原始值见 comparison.json。本机常规八场景为毫秒量级，采样/并发/GC 会波动，不构成线上 SLA。

构建后满窗口 500/200/600 回归曾在 5 秒测试预算内超时（该测试含 24 次完整算法运行）。实查五轮贪心重复构建相同方向匹配/记录引用，最小修复为每次请求缓存静态信号与引用，动态覆盖仍逐轮计算，原断言保持。独立评测配置原本为 30 秒；缓存优化后全量并行套件仍曾耗时 5.73 秒（冻结基线与当前各 12 次），因此只把这一累计采样测试的超时对齐为 30 秒，其他测试预算未扩大，单次算法耗时继续如实记录。复跑 [满窗口观测](m322/window-performance.json)：当前中位 45.12 ms / P95 52.06 ms（十次/两次预热；对照为冻结 a852af5 的原满窗口基准，中位 89.03 ms / P95 515.26 ms，不能将 GC/并发噪声当成确定比例收益）。3410767 的固定候选评分对照仍见 comparison.json。

原生 PostgreSQL 18.4：三个独立 backend、12 检查组；最近 500 训练读取和 600 候选读取各十次，证据中位 3.48 ms / P95 4.21 ms，候选中位 16.50 ms / P95 17.91 ms，详见 [隔离结果](m322/isolated-postgres.json) 及 EXPLAIN。新增私有小表主键/contest 索引和一次 NOT EXISTS；没有额外上游请求、LLM、向量/训练平台或基础设施。原推荐读 evidence + candidates + 最终 revision，缓存路径不变。

## 复现与人工继续填写

```bash
npm run review:recommendations
M322_EVALUATION_OUTPUT=docs/m322 npm run test:recommendations
M321_ALLOW_DATABASE_TESTS=isolated M321_EVALUATION_OUTPUT=docs/m322 npm run test:isolated:m321
```

原生隔离运行时沿用 [M321 设置](M321_ISOLATED_SETUP.md)，只创建全新 loopback 临时库，不读取生产 URL，结束后停止并删除集群。M321 历史报告不重写。

填 `docs/m322/human-overrides.csv` 可覆写原 40 条，必须真实真人填写，记录 assessment、rationale/建议、reviewer、reviewed_at、statement_consulted、review_type=human。再次运行脚本默认读取上次汇总保留 auditHistory；可用 `--human 路径 --previous 上次汇总 --output 新目录` 做版本快照。人可明确不同意 AI，原 AI 行始终保留。新排序 [40 题评审表](m322/recommendations-for-review.csv) 是另一个待评队列，本轮真人 0/40；[新队列汇总](m322/current-review/review-summary.json) 仅按相同主键关联原 35 条 AI 初评，五道新题为 unreviewed，不继承不同题号的判断。当前 AI 33/35 与原 33/40 的分母不同，不能用它声称质量提高。可复现：

```bash
node scripts/m322-review.ts --recorded docs/m322/recorded-catalog-scenarios.json --manual docs/m322/recommendations-for-review.csv --ai docs/m322/current-ai-input.csv --human docs/m322/recommendations-for-review.csv --audit docs/m322/current-source-audit.json --output docs/m322/current-review
```

## 实际门禁及真实环境边界

2026-10-15 最终顺序执行：

| 命令 | 实际结果 |
| --- | --- |
| npm run lint | 通过，0 warnings |
| npm run typecheck | 通过 |
| npm run test（构建前） | 240/240，29 文件 |
| npm run build | 通过；Monaco/旧 sanitizer 检查通过 |
| npm run test（构建后第一次） | 240/240，29 文件 |
| npm run test（构建后第二次） | 240/240，29 文件 |
| npm run test:recommendations | 30/30 专项（最终全量也包含这 30 项） |
| 原生 test:isolated:m321 | 12 检查组，3 独立连接，临时集群已清理 |
| npm run test:e2e | 44/44，桌面/移动 HTTP 与 Provider 夹具；不是托管验收 |

原人工 CSV 与原录制结果 SHA-256/字节相同，001–008 无 diff。单独提交包含用户新增 AI CSV 原始内容，不生成真人假评审。

初次新增控制测试误把多样性变化也当作匹配强度，断言第二/第三名失败；修正测试固定 Tags 后验证单一因素，没有按错误断言改业务排序。初次 typecheck 的 Map 模板键/评测数组推断与 lint 未用 import 也已修正。原有全部安全/历史断言保留，没有删测试来凑通过。

[目标只读探测](m322/target-readonly.json)：使用已配置项目的公开 key，以匿名身份调用仅授权后才读取的两个 RPC，返回 HTTP 404 / PGRST202。仅能说明匿名 schema 中不可见，不能区分未部署、ACL 隐藏或 schema cache；**007/008 完整部署及函数定义哈希仍未核验**。未使用 service-role、用户 JWT 或生产用户数据，未运行写 RPC/迁移/部署。脚本无秘密输出，可显式 M322_ALLOW_TARGET_READS=read-only 再执行；需要专用只读管理权限才能确认完整 DDL/版本，正式变更仍必须用户明确授权。

原生 PostgreSQL 的 auth.uid/claims 为测试上下文；PGlite/HTTP Mock 也不是真实 Supabase JWT、PostgREST、托管双用户验收。真实选手收益、真人先修知识/教学顺序、AI 来源分类准确性、未知 special 兼容性以及 Provider 教学质量均未证明。

## M3.3 建议

可继续开发官方提交证据的增量采集，保持官方/自报/源码未核实分离，不复制提交列表或 Rating 展示。在生产发布前先补专用只读迁移核验，取得明确授权后只应用缺失 007–009，再做真实 JWT/双用户/反馈/撤销闭环。请真人审阅原与新推荐队列，重点新替代题与未知 special；通过真实训练结果再决定是否细分目标或改难度模型。仅在人工核验显示持续收益时扩展小标注集，不作全库 AI 自动分类。
