# M3.5 后续：个性化能力证据诊断与训练行动

2026-10-28，Asia/Shanghai。**本地功能切片 PASS：画像专项38/38、全量527/527、推荐36/36、桌面/移动E2E60/60，最终失败0；lint/typecheck/build/diff PASS。** 本轮交付 M3.2/M3.3 既有画像的确定性增量，未启动完整 M4。完成“已有用户证据 → 窗口诊断 → 显式专项推荐 → 新训练”的纵向切片。真实预测能力、教学收益与托管验收不在离线 PASS 范围内。

## 1. 仓库与路线

初始 HEAD 为 `23dc15301349579690f8ea0e61976609b8e613c3`，初始工作区干净。该提交恰好纳入上一轮 11 个原生测试设施文件；没有继续假定这些文件未提交，也没有覆盖旧工作。读取 DEVELOPMENT_PLAN v3.4、MILESTONES、M32/M33 证据和推荐实现、M353 门禁及原生验收。历史报告中的 ee26463 是旧时点。

最终 HEAD 保持不变；工作区 **12 个修改、8 个新增，合计20文件，0暂存/0删除**，全部留待人工审核。

v3.4 已有推荐/画像共享证据、真实来源、样本不足与权限隔离原则；后续真实用户评审与托管验证仍阻塞。本轮按用户新的明确授权完成核心能力分析增量，不调整既有推荐模型，不把功能增加解释为通过真实教学验收。

## 2. 原有能力与真实缺口

原实现已经有：最近500次训练、同题最新完成记录、官方最近500道 OK、方向/难度分布、实际提示、主动授权的最多200题结构化复盘、反馈、自报与官方来源分栏；这些方向已经参与 deterministic/1.3-official 排序。没有重新开发同步、评分或能力综合分。

缺口是时间窗口、可核对分母的诊断、具体训练行动，以及窗口变更/刷新后的页面行为。现有 evidence RPC **不返回全量提交序列、语言、提交次数、解题耗时或训练完成时间**；新实现不补造这些指标。

## 3. 本轮切片及非目标

`GET /api/v1/learning?window=7|30|90|all` 返回原画像及新增 `intelligence`。`/analytics` 展示诊断、来源、样本和操作；用户明确点击“按某方向诊断补充训练”进入 `/dashboard?focus=...&window=...`。推荐 POST 的可选 focus 必须经服务器用当前用户证据重新核对。

不新增数据库表、迁移、后台任务或依赖；不访问上游来刷新画像，不新增提交浏览器、图表库或模型生成。完整稳定性估计、长期训练履历、首次/多次尝试成功率、真实成长预测保留 UNKNOWN，后续需要新的可靠数据契约及验收。

## 4. 数据及计算口径

- 唯一来源仍是用户 JWT/RLS 的 `learning_evidence()`，既有 Auth getUser、窄 RPC 和证据 revision 检查保留。纯函数显式接收分析时刻，输入/时刻相同则结果相同，不修改输入。
- 训练按创建时间规范化、去重请求记录、最多500次；复用 `latestProblems` 每题取最新完成训练，之后应用 `(起点, 分析时刻]` 时间窗口。`all` 是全部已加载证据，不是终身历史。未完成或没有题目关联的训练另列。
- 未自报解出且未看 L5 的题目，即使测试输入带 Tags 也从新诊断移除标签；难度与提示统计仍可保留。缺标签不推断方向薄弱或从未训练。
- 方向明确结果分母只含 solved_self_reported/unsolved/abandoned；not_recorded 不进入比例。少于5题显示 UNKNOWN，不输出完成比例或专项行动。
- “补充训练验证”规则：至少5个明确结果，L3+ 或未解/放弃的并集至少2题且占至少40%。两种信号同题只计一次。规则集中 `skillRules`、版本 `evidence-diagnostics/1`；是透明启发式，不是经过外部验证的统计测量。
- 至少5个明确结果、至少80%自报解出且未命中前项时，只称“较多自报解出证据”，不称掌握、独立完成或稳定实力。置信度仍为有限训练证据。
- 难度使用现有400分区间。自报解出 Rating 至少5题才显示中位数，偶数取中间两项平均。相邻等长窗口各满足5题才比较中位数；差值仅描述选题构成，不能证明进步/退步。
- 训练结构提示：至少10道有可见标签的题，某方向占至少80%才提示检查是否符合专项目标。多标签可重叠，不据此判偏科；没有记录的方向不产生能力缺陷结论。
- 官方 OK 按题号去重、独立展示，窗口使用每题最新已观察 OK 提交时间，不是首次 AC 数。归属/独立性未知；不与自报分母混合、不消除提示信号。WA、未观察 AC 不能推断薄弱。
- AI 复盘继续通过原有主动授权机制显示待验证建议；本诊断不把 AI 文本当成功事实，不读取源码/编辑笔记，不生成新分析。

| 请求维度 | 本轮完成与保留限制 |
| --- | --- |
| A 难度能力 | 来源分栏的难度分布、满足样本量的自报解出题目中位数；下一行动沿用原推荐范围。不从最高AC推断实力 |
| B 知识方向 | 可见覆盖、明确分母、自报解出、实际提示、有限证据/不足、最近记录、可执行专项；不把零记录判弱 |
| C 稳定性 | 展示同难度区间的已记录完成与提示口径；首次/多次尝试成功、独立性和真正稳定实力 UNKNOWN，现有 RPC 不支持完整序列 |
| D 成长窗口 | 7/30/90天及全部已加载、等长窗口题目中位数差；完成时间、完整训练量与能力进步/退步未建立 |
| E 训练结构 | 有条件的知识集中提示；不能以已选择样本推断所有训练结构，不自动判偏科或难度跃迁不当 |

## 5. 推荐闭环

focus 只允许已知主题与四种窗口，不接受客户端分数、人数、userId 或能力结论。服务器重新计算；当前证据不支持时返回 409 SKILL_ACTION_STALE，先于题库/候选访问，不自动降级伪造专项。

有效行动只在本请求替换 themes，沿用已保存 min/max/goal/repeat/reviewEvidence 和原参考难度计算。主题在 SQL 600预算前过滤；应用仍再次筛选，保持全历史已解排除、题型过滤、去重、计划关系和最多5题。engine.ts 仅导出原 latestProblems，权重、主排序和版本均不变。

每题理由附窗口、明确结果数、困难信号并集数和训练引用。候选方向仅在用户已明确选择专项后点名。响应的 preferences 保持原已保存值，页面表单不会隐式保存临时主题；退出专项回到普通推荐。旧链接不跨用户授予行动权限。

## 6. 页面与更新

复用 `/analytics`、原 Card/EvidenceLinks 和 `/dashboard` 推荐卡，可从推荐直接进入现有训练工作台。7/30/90天及全部已加载窗口、刷新按钮、空数据/少样本/错误重试均有状态。窗口变更忽略迟到旧响应；专项参数变化重新挂载推荐组件，避免旧卡片混入新专项。

显示比例的分子/分母，不用0分表达 UNKNOWN；诊断和不受窗口筛选的原完整概览明确分区。有行动的方向优先显示，原知识/难度细项改为可展开保留，避免重复占满页面；官方同步时间/覆盖、已授权复盘和权限边界继续直接显示。查看画像不请求 CF；推荐沿用现有题库缓存机制，无额外上游入口或派生持久缓存。

## 7. 性能及隔离

计算有界为500训练、500官方样本与20个已知主题，排序后纯计算，无每题数据库查询。10000条合成输入测试验证500条截断、顺序不变性和输入不变；不是生产负载或延迟 SLA。

SQL 集成用 PGlite、合成 claims 和真实角色/RLS 语义，验证 Alice 的训练不能成为 Bob 的画像/行动。HTTP E2E 再验证另一个用户无诊断且不能使用他人的专项链接。这不等于原生独立连接或托管 JWT 验收。原生20项继续 NOT_RUN，未继续搜索/安装运行环境。

## 8. 实际检查

核心最终检查在排除 `.env*` 的私有副本 `/private/tmp/algopilot-skill-checks-hbSO4b/workspace` 实际执行，环境白名单/空 HOME、既有 B3 guard；只链接已有 node_modules，不安装依赖。临时 caffeinate 包装只在运行期间防止空闲休眠，不修改系统设置，未据此断言早先失败的原因。

| 命令 | 最终结果 |
| --- | --- |
| `npm run lint` | PASS，exit0，0警告 |
| `npm run typecheck` | PASS，exit0 |
| 下方画像专项 | PASS，38/38，4文件；包含原API的6项回归与新增32项 |
| `npm run test -- --maxWorkers=1` | PASS，527/527，49文件，114.80秒；原495项完整保留 |
| `npm run test:recommendations -- --maxWorkers=1` | PASS，36/36，8文件，约82秒 |
| `npm run build` | PASS，exit0，含 postbuild Monaco/旧 sanitizer 检查 |
| `npm run test:e2e` | PASS，60/60，34.1秒，retries=0；原58项保留，新增桌面/移动各1项 |
| `git diff --check` | PASS |
| 原生 PostgreSQL 20项 / 托管 JWT/RLS / 生产部署 | NOT_RUN |

[核心命令与审计](/private/tmp/algopilot-skill-checks-hbSO4b/checks.json)、[完整核心日志](/private/tmp/algopilot-skill-frozen.log)。临时文件可能被系统清理，报告保留实际结论，不以真实请求补证。

[最终E2E审计](/tmp/algopilot-gate-e2e-nPmKzV/e2e-audits-cm92OR/checks.json)、[浏览器日志](/private/tmp/algopilot-skill-browser-frozen.log)。两项新增用例通过现有 Auth/训练/提示/完成 API 创建合成记录，使用隔离 Tutor HTTP Mock 填充实际提示证据，然后执行画像刷新、窗口选择、显式行动、理由/已解排除/偏好不变及进入新训练；第二用户无法获得前者诊断或滥用链接。

桌面/移动的横向溢出断言通过，并实际查看本地截图确认布局与行动优先级：[桌面画像](/tmp/algopilot-skill-profile-m2-desktop.png)、[移动画像](/tmp/algopilot-skill-profile-m2-mobile.png)、[桌面专项推荐](/tmp/algopilot-skill-action-m2-desktop.png)、[移动专项推荐](/tmp/algopilot-skill-action-m2-mobile.png)。原详细数据可展开，未删除。最终325份非文档/非生成源文件与核心已测试副本哈希一致；E2E仅使用既有私有工厂和 browser routing 接线，不改源生产工厂。

本轮专项命令：

```sh
npm run test -- tests/unit/skill-intelligence.test.ts tests/unit/skill-insights.test.tsx tests/unit/learning-api.test.ts tests/integration/skill-intelligence-database.test.ts --maxWorkers=1
```

## 9. 回归及修复记录

首轮新 SQL 集成 2/3 PASS，另1项 INVALID_SUBMISSIONS：合成分页使用递增提交编号。修正夹具为 CF 所需倒序，没有放宽签名、输入校验或旧断言。

首轮 GET 使用可选 Request，早期 typecheck 通过，但 Next 构建生成的路由参数检查拒绝。已改为真实 Next 必传 Request，旧测试通过小包装构建 Request，原断言完整保留。

首轮完整运行新专项37/37，但旧 M34 重放在120秒预算内超时（全量525/526）；推荐专项同一旧重放为状态冲突（35/36）。其整体耗时分别656.82/914.96秒。没有改该旧测试、120秒预算、实际3秒时隙、30秒冷却、时钟或生产代码；保留失败事实并在修正路由后重新运行。无法仅据耗时断言具体系统调度/休眠原因。

中途执行环境被主动中断后，临时日志和运行 session 已不可恢复，源码仍在。后续重新建立私有副本执行完整检查，不把未完成进程计作 PASS。最终以可读取的新日志为准。

首轮浏览器58/60：新增的桌面/移动用例把训练状态 CAS 字段写成 revision，被既有 Zod 白名单以422拒绝。改成正确的 expectedRevision，只修正新测试，未改产品校验或原有58项断言。首轮浏览器日志保留在 `/private/tmp/algopilot-skill-browser.log`。

## 10. 文件清单

修改：`src/lib/validation/learning.ts`、`src/features/learning/engine.ts`、两个 learning/recommendations API 路由、`src/components/learning/ability-profile.tsx`、`recommendations.tsx`、`src/app/(app)/dashboard/page.tsx`、`tests/unit/learning-api.test.ts`、`playwright.config.ts`、`scripts/test-offline-e2e.mjs`，以及 README/MILESTONES。

新增：`src/features/learning/intelligence.ts`、`src/components/learning/skill-insights.tsx`、`tests/fixtures/skill-intelligence.ts`、`tests/unit/skill-intelligence.test.ts`、`tests/unit/skill-insights.test.tsx`、`tests/integration/skill-intelligence-database.test.ts`、`tests/e2e/skill-intelligence.spec.ts`、本报告。

原生产 LLM 工厂、门禁、Tutor/Review、Prompt/Schema、迁移001–012、B3五文件及原生测试设施不改。没有 commit/push/PR、删除或数据迁移。

## 11. 安全审计

完整检查在私有临时副本、空 HOME、常量环境白名单、排除 `.env*`、既有 B3 禁网/凭据读取 guard 下运行，仅链接本地依赖。E2E 使用既有私有副本 Mock 工厂、合成 Key、本地 HTTP Fixture；生产工厂不接测试模块。额外的 macOS sandbox-exec 只允许 loopback，浏览器临时上下文阻断外部请求；未改变系统代理或持久配置。

| 审计对象 | 实际结果与覆盖范围 |
| --- | --- |
| 真实模型生成 / B4 / 付费API或回退 | 0 / 0 / 0；能力诊断无Provider调用，测试仅内存/loopback Mock |
| 生产数据库读取/写入、托管迁移、部署 | 全部0；只用合成数据，生产URL不进入测试环境 |
| 真实凭据主动读取 | 0；未读取 `.env` 或真实Key。完整 Node 观测范围内 realCredentialReads/credentialReadBlocked 均0 |
| 最终核心审计 | PASS，23份完整记录、incomplete=0/invalid=0，networkBlocked/dnsBlocked/credentialReadBlocked/externalHTTP/realDNS/realCredentialReads 六计数均0 |
| 最终E2E Node审计 | PASS，17份完整记录、incomplete=0/invalid=0，上述六计数均0 |
| 最终页面路由 | 12份worker记录，4798个允许的loopback页面请求、0拒绝；不等于全部服务间请求数量 |
| 浏览器原生/后台HTTP、DNS及全进程流量总数 | UNKNOWN；操作系统策略拒绝外部网络，但未生成原生浏览器数量统计，不以Node零计数外推 |
| 全进程真实凭据读取数量 | UNKNOWN；没有主动读取行为，计数覆盖为上述Node进程，不冒充系统级文件访问审计 |
| 私人数据/源码外发 | 未执行；材料仅在本地私有副本。全进程外部流量计数仍为UNKNOWN |
| 下载/安装/拉镜像/系统服务/生产数据删除/Git commit、push、PR | 全部0 |

首轮失败浏览器的17份Node审计也完整且六计数均0；保留失败历史，不使用失败轮替代最终功能结果。没有修改或重跑真实 B3/B4 探针。

## 12. 分类与效果边界

| 问题 | 可验范围 |
| --- | --- |
| 画像计算是否符合明确规则 | PASS，本地单元/SQL/界面契约，38项专项及完整回归 |
| 是否具有可靠实际预测能力 | NOT_RUN，未做外部校准或真人预测评测 |
| 推荐是否正确消费诊断 | PASS，本地 API/SQL/桌面移动闭环；不等于已部署或有效教学 |
| 是否改善训练效果 | NOT_RUN，没有新增真人参与者/教学评价 |
| 真实免费资格 | BLOCKED，无可信验证源；生产默认拒绝 |
| B4 / 生产 / 托管 / 原生多连接 | NOT_RUN |

最终功能 FAIL=0；早期夹具、路由签名与旧重放故障已如实保留，不宣称从未失败。原生环境和真实资格分别 BLOCKED，20项原生测试 NOT_RUN，未把 PGlite/Mock 结果替代它们。

## 13. 后续

下一项可直接开发的是补充“训练完成时间/证据覆盖”契约及相应离线验收，以改善窗口的事件时间口径；应先证明已有结构不足再准备必要增量迁移，本轮未实施。完整提交尝试统计、独立性/耗时和预测性结论需要可靠来源，不能从当前 OK 摘要反推。

真人推荐价值、学习收益、托管 JWT/RLS、实际部署仍需独立安排及相应授权。本轮开发、测试和报告完成后停止，保留变更人工审核。
