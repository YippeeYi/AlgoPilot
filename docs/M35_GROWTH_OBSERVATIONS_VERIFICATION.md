# M3.5 后续：个性化成长与推荐结果观测

2026-10-28，Asia/Shanghai。本轮交付训练证据 → 成长观测 → 推荐结果 → 显式专项 → 下一次训练的本地纵向切片。**统计正确不等于推荐算法已被实验证明有效。** 最终回归结果见第8节。

## 1. 实际基线与范围

实际 HEAD：`dd9d353eae4e38906396e80e219beb260a40e8e8`（`feat: add recommendation training feedback functionality`），不是交接中的 f5f5cef。上一轮17修改/14新增已在HEAD，未重复实现推荐来源、训练开始/恢复/跳过、用户结果或013。

初始工作区仅 `package.json`、`package-lock.json` 修改，0新增、0暂存。它们是用户既有依赖更新，本轮保留并使用已有 node_modules，不安装/下载依赖。

- 初始/最终 package.json SHA-256：`024a5ef9d3d3fe0530aebbf695368f5a97936ca53c331511eb2fae172ba6dbdd`。
- 初始/最终 package-lock.json SHA-256：`a149cf6db080fee7ba79bee49c02648666ab039cc2affba780640c7ec3fda0fb`。

依据 DEVELOPMENT_PLAN v3.4 的 M3.2 解释性推荐/画像与 M3.3 官方证据，以及 MILESTONES、M35_SKILL_INTELLIGENCE_VERIFICATION、M35_TRAINING_FEEDBACK_VERIFICATION。已有功能能读取窗口诊断、同题最新完成记录和来源快照，但尚无知识方向跨窗门槛变化、新训练结果各阶段观测及成长建议的服务端复算。

选择该缺口，不受B4或原生PostgreSQL阻塞。前置的用户JWT/窄RPC/revision、来源关联、训练状态与结果已存在。不新建能力评分，不调推荐权重，无新表、迁移、后台任务或额外同步。

## 2. 数据来源、窗口与去重

1. 使用 `learning_evidence()` 的已有私人记录（最近500次训练），不进入页面即重新调用CF。已有官方最多500题OK和复盘保留原独立用途。
2. intelligence 层按时间有效性、未来时间过滤、session ID去重、上限500、同题最新**完成**记录处理；较新的未完成训练不替换旧完成记录。成长模块直接消费这份结果，不建第二套数据体系。
3. 有限窗口是读取时刻向前7/30/90个24小时，UTC时间戳，左开右闭；前窗是紧邻的等长区间，不是自然周/月。`all`仅已加载数据，没有前窗。
4. 训练按创建时间分组，不能称为该期间完成量或真实耗时。最新完成记录替换可使旧题退出前窗；两个窗口是不同题目的当前记录分组，**不是历史能力快照或训练前基线**。
5. Tags继续遵守披露边界：仅自报解出或实际已看L5的完成记录可用；未解题隐藏标签不能当成没有训练/薄弱。多标签可重叠，每题每方向至多一次，方向采用既有20类词表。
6. CF官方OK不计入本轮自报分母；无WA序列、独立性或源码一致性结论。AI复盘不充当完成事实。自报和官方重叠也不相加。
7. 来源按013持久快照ID去重；结果仅归属 originated=true 且有session的首次来源，再按session去重。其他轮次恢复同训练只算来源选择/恢复，不新增训练结果。不同的显式重练是不同训练次数，未伪装为不同题目。

## 3. 成长指标与可信度

`growth-observations/1` 为纯确定性计算：同一输入/时刻得到同一输出，不写缓存/历史，不引入综合分。

| 指标 | 定义与未知处理 |
| --- | --- |
| 完成记录题数 | 分组中有完成记录的不同题数；不代表都已解出 |
| 明确结果/自报解出 | solved_self_reported、unsolved、abandoned为明确结果；not_recorded/null排除比例分母 |
| 自报解出比例 | 分子为明确结果中的自报解出，分母为该窗明确结果；至少5道题，否则null/UNKNOWN |
| 可见方向覆盖 | 有可见Tags题数与既有方向数；多标签重叠，缺少不等于能力差 |
| 难度构成 | 400分区间的记录/自报数、各自明确结果分母；Rating缺失不当0 |
| 难度中位数 | 至少5道有Rating的自报解出题；偶数取中间两项均值。只是题目构成，不是实力评级 |
| 中位数差 | 两窗各达到上述门槛且输入可比较才计算；不宣称能力进步/退步 |
| 方向样本门槛 | 各方向本窗/前窗明确结果数与引用；少于5到至少5只表示本窗证据可描述，不是由弱变强；反向不表示退步 |

全局比较状态：未选择有限窗 → not_applicable；记录截断、无效/未来时间、相关区间旧完成记录无problemId → incomplete；任一窗明确结果少于5 → insufficient；否则 descriptive。前三者界面明确UNKNOWN；输入不完整时保留各自已加载计数，但停止中位数差、门槛变化判断和新增跨窗行动。没有将截断500条外推全历史。

按方向/难度各自保留门槛和分母，不能因为全局足量就放行小子样本；也不把本窗有5题而前窗不足的情况包装成可靠成长趋势。没有数值能力置信区间、预测准确率或外部测量有效性主张。

## 4. 推荐结果观测

反馈仍读取 `recommendation_training_evidence`，按**推荐生成时间**选择条目、展示当前关联状态，最多200条。数据总量超出加载量时显式提示；不同窗口的记录结果可持续变化，不能跨窗比较完成率。画像与反馈是两份分别通过revision检查的读取，不假装同一事务快照，UI展示各自读取时间。

| 观测 | 单位/分母/限制 |
| --- | --- |
| 生成、选择、当前跳过、未选择 | 来源条目；生成不证明已送达/展示/阅读，选择不证明实际做题 |
| 历史跳过操作 | 有skippedAt的条目，可能后来选择，与当前状态可重叠，不是失败 |
| 恢复 | 有session且originated=false的来源条目，不归因本轮结果 |
| 新建、结束、自报解出、未解、放弃 | originated新训练按session去重的次数；不把重复打开/恢复算成功 |
| 尚无明确结果 | 新建未结束 + 已结束但结果未知；未选择另外统计；不等于失败 |
| 明确结果比例 | 自报解出次数 / 明确结束结果的新训练次数；至少覆盖5道不同题才显示，否则UNKNOWN。重复练习仍是不同次数，不是不同题量 |
| 当前官方OK观察 | 仅新建训练题目按problem去重；有可用同步缓存的题目另列数量，未启用/未同步另列；均不可用则UNKNOWN，不报0 |
| 推荐后官方确认完成 | **UNKNOWN**。现有DTO没有首次OK发生时间，历史OK不能归因本轮推荐；当前观察只表示已有缓存事实，不保证完整/实时或本人独立完成 |
| 曝光、未追踪来源训练 | **UNKNOWN**。没有真实曝光事件或全量训练来源分母，不推算曝光率/转化提升 |

来源缺失的旧训练仍进入原画像，但不强行归因推荐。已知官方OK与自报冲突时两者均保留，不覆盖自报，也不把两种完成相加。

## 5. 确定性建议与原推荐联动

已有 practice_signal 行动保持原规则。本轮仅增两种有边界的显式行动，至多3条，稳定按既有方向顺序：

- 本窗某方向明确结果≥5，已加载前窗<5，没有原诊断困难信号：提示本窗已达到描述门槛，再选同方向题验证记录表现。不证明长期掌握或历史未训练。
- 同方向两窗各≥5道有Rating的自报解出，中位数相同，本窗明确结果≥5、≥80%自报解出且没有原困难信号：提示检查是否继续当前难度；若希望挑战，由用户主动调整目标。不是“长期停滞”判断。

阈值复用 skillRules 的5题、困难并集2题/40%，不是推荐评分权重。输入不完整或all模式不提供新增跨窗建议；原独立诊断仍可呈现已加载证据。

链接沿用 `/dashboard?focus=topic&window=...`。推荐POST从当前用户证据重新计算建议，不信任客户端计数/理由；证据不再支持则409 SKILL_ACTION_STALE。仍使用原候选SQL、600上限、每轮5题、已解排除、显式重练偏好和revision门禁。仅临时themes=[topic]，保存难度/目标/偏好不写回、权重不变；理由包含真实样本与训练引用。

013继续记录推荐时的明确结果/困难并集/自报基线，训练新证据进入原画像后重新计算本模块，下一轮排除/画像参考自然更新。无新增写接口、权限或测试放行机制。

## 6. 实际用户路径

1. `/analytics` 选择7/30/90天或全部，首先看到成长观测、相邻窗口的样本/难度/方向与UNKNOWN说明。
2. 展开方向或难度明细核对分母/引用；查看推荐快照、选择/恢复/新建/结果与官方证据边界。
3. 符合门槛时点击“按某方向成长证据选择下一题”，进入原推荐，理由展示样本来源；保存目标不变。
4. 明确进入训练，新建或恢复由既有RPC决定。明确结束并自报结果后返回画像，重新读取训练及来源。
5. 成长计数与来源结果更新，下一轮已解题仍被排除；点击“刷新训练证据”可主动重算。未关联/配置不足仍显示专门说明，旧入口保持可用。

桌面/移动E2E通过既有API生成5道低提示自报完成记录→显式成长专项→完成下一题→画像6题/来源1个新结果→多窗口切换→下一轮排除与第二用户隔离。该新增流程不发Tutor/Review请求；旧门禁/训练E2E继续保留。

## 7. 性能、隔离与兼容

新增计算在已去重、最多500条的本地训练集合上按固定20方向和难度区间分组；来源最多200条，使用Map去重，无新I/O/依赖/表/持久化指标。5000条合成输入验证上限、不修改输入；未以合成数据宣称生产延迟SLA。

Auth、用户JWT/RLS/窄RPC及证据revision复用原链路，无userId查询参数或全局私人缓存。新增串行PGlite用例从真实001–013 SQL记录5条来源，实际start/finish/重复恢复后读取画像与来源统计，并以另一 authenticated claim 验证空证据。API与浏览器再验证成长专项的当前用户复算。**这是PGlite与本地HTTP契约，不是原生多连接RLS或托管JWT验收。**

001–013、LLM免费门禁、生产Provider、Tutor/Review/Prompt/Schema、B3五文件和推荐engine运行时均不改。历史数据不覆盖/删除；013仍只在本地测试副本应用。无需迁移，因为所有新指标可由已有证据重新计算。

## 8. 实际测试与修复

环境：Node v24.19.0，npm11.17.0，已有node_modules。源工作区不直接执行会读取.env的Next构建。检查在私有临时副本运行，复制时排除.env*、使用空HOME和白名单环境，Node预加载原B3离线guard；E2E另由macOS sandbox限制loopback，并使用已有私有测试接线。未安装运行时或拉镜像。

| 最终实际命令 | 结果 | 数量 / 失败 |
| --- | --- | --- |
| npm run lint | PASS | exit 0 |
| npm run typecheck | PASS | exit 0 |
| 下方专项命令 | PASS | 106/106，10文件，失败0 |
| npm run test -- --maxWorkers=1 | PASS | 598/598，56文件，失败0；103.09秒 |
| npm run test:recommendations -- --maxWorkers=1 | PASS | 36/36，8文件，失败0；约78秒 |
| npm run build（含postbuild） | PASS | exit 0 |
| npm run test:e2e | PASS | 桌面/移动64/64，失败0，40.9秒，retries=0 |
| git diff --check | PASS | exit 0 |

最终核心工作副本：`/private/tmp/algopilot-growth-checks-1zBF4C/workspace`，命令/退出码与审计：父目录 `checks.json`；日志 `/private/tmp/algopilot-growth-accepted.log`。246个源文件/测试/脚本/配置与最终工作区逐字节一致，差异0（文档随后补写）。

最终E2E副本：`/tmp/algopilot-gate-e2e-5MRYoX/workspace`；审计 `/tmp/algopilot-gate-e2e-5MRYoX/e2e-audits-jB3HAI/checks.json`，日志 `/private/tmp/algopilot-growth-browser-accepted.log`。全部现有用例保留，新增长流程桌面/移动2项。246个功能/测试/配置文件逐字节核对：仅私有副本的12份E2E文件导入loopback守卫与Provider fixture接线是预期差异；按runner规定转换后额外差异0。最初差异核对脚本只豁免Provider而误报测试导入，已纠正核对规则，源文件未因此改写。移动/桌面截图人工核对与横向溢出断言通过，截图为合成数据。

专项实际命令：

```text
npm run test -- tests/unit/growth-observations.test.ts tests/unit/growth-insights.test.tsx tests/unit/skill-intelligence.test.ts tests/unit/skill-insights.test.tsx tests/unit/learning-api.test.ts tests/unit/training-feedback.test.ts tests/unit/training-feedback-api.test.ts tests/unit/training-feedback-repository.test.ts tests/unit/training-feedback-panel.test.tsx tests/integration/training-feedback-database.test.ts --maxWorkers=1
```

覆盖零/少量/大量记录、7/30/90/all边界、重复同步/顺序变化、同题替换/重练、未知结果/恢复/跳过、Rating/Tags缺失、来源缺失、截断、源可靠性混合、官方历史不得归因、新结果刷新、实际SQL关联与用户隔离、保留候选排除/偏好/权限revision，以及桌面移动闭环。

首轮专项105 PASS/1 FAIL：旧UI测试使用宽泛 `getByText(/UNKNOWN/)`，新增多个UNKNOWN后不唯一。已改为原有完整“新训练明确结果内…UNKNOWN（至少5道…）”精确断言，保留并增强原检验；没有删除断言/跳过/放宽安全检查/扩大超时。修复后专项106/106。首轮完整598/598、推荐36/36、build与E2E64/64已通过。将新内容移至页面前部并澄清建议字句后的一次复验发生多套件长耗时：全量584通过/2超时，另一个worker未能启动，12项未执行；推荐34通过/1超时/1因beforeAll超时未执行；E2E63通过/1移动端超时。日志分别为 /private/tmp/algopilot-growth-verified.log、/private/tmp/algopilot-growth-browser-verified.log。实际单例耗时达数百秒、整批数十分钟；根因UNKNOWN，不凭耗时断言为系统休眠或产品缺陷。原断言/worker并发/超时预算/0重试均未改变，随后按顺序对同一最终代码重新执行完整检查与E2E，结果以上表为准。所有中间失败保留，未以先前PASS覆盖失败记录。

## 9. 文件清单与Git

最终HEAD不变。工作区14修改、6新增，共20文件，0暂存/0删除；其中本轮12修改、6新增，另保留初始两个依赖文件修改。

本轮新增：

- `src/features/learning/growth.ts`：纯成长观测。
- `src/components/learning/growth-insights.tsx`：窗口/口径/建议UI。
- `tests/unit/growth-observations.test.ts`：23个统计、分母、去重/缺失与来源用例。
- `tests/unit/growth-insights.test.tsx`：4个UI/行动用例。
- `tests/e2e/growth-observations.spec.ts`：一条流程，桌面/移动各执行一次。
- `docs/M35_GROWTH_OBSERVATIONS_VERIFICATION.md`：本报告。

本轮修改：

- `src/features/learning/intelligence.ts`：同源分组、完整性检查、成长结果。
- `src/features/learning/training-feedback.ts`：来源/训练/官方独立观测。
- `src/components/learning/ability-profile.tsx`：将成长与来源放在前部，复用时间选择/刷新。
- `src/components/learning/training-feedback.tsx`：指标口径、UNKNOWN与独立计数。
- `src/app/api/v1/recommendations/route.ts`：当前证据复算成长专项/真实理由。
- `tests/unit/learning-api.test.ts`：成长专项与截断拒绝、历史排除和保存目标不变。
- `tests/unit/training-feedback-panel.test.tsx`：原比例说明的精确断言。
- `tests/integration/training-feedback-database.test.ts`：追加真实串行SQL→成长/来源联动与隔离用例，原断言保留。
- `playwright.config.ts`、`scripts/test-offline-e2e.mjs`：纳入新增用例与私有复制文件。
- `README.md`、`docs/MILESTONES.md`：产品入口与验收边界。

两个既有依赖修改单独保留，不计入本轮新增实现。无commit/push/PR、reset/clean或暂存/删除操作。

## 10. 安全与费用审计

最终核心23个Node运行时、E2E17个Node运行时审计完整，无pending残片/无效记录。两份最终审计的 networkBlocked、dnsBlocked、credentialReadBlocked、externalHTTP、realDNS、realCredentialReads 全部0。E2E 12个浏览器worker路由记录共 5341 个允许的loopback页面请求，denied=0；浏览器原生后台HTTP/DNS均UNKNOWN。

| 项目 | 本轮边界内结论 |
| --- | --- |
| 真实模型生成 / B4 | 0；旧全量/E2E的Mock dispatch均为合成，本新增流程不发Tutor/Review请求 |
| 付费API / 计费变更 | 0 |
| 主动读取真实API Key | 0；不读真实.env*，仅既有测试合成密钥；最终Node guard realCredentialReads=0 |
| 生产数据库/托管Supabase访问 | 0；仅进程内PGlite与loopback HTTP契约替身 |
| 外部HTTP/DNS | 最终Node guard计数0；浏览器受控页面路由外部0。浏览器原生后台及进程外全局次数UNKNOWN，不能把有限审计写成全机0 |
| 私人训练/项目源码外发 | 未执行；测试只在本机私有副本使用合成数据，没有外部上传 |
| 部署/托管迁移/安装/拉镜像/Clash或代理变更 | 0 |
| Git commit/push/PR/破坏性操作/历史删除 | 0 |

早期专项失败及中途超时轮的审计也保留：核心 `algopilot-growth-checks-q078ym`、`BK2rX9`、`yDjXjz` 的父目录checks.json，以及E2E `HV58Pu`、`Gzkv7I` 的e2e-audits目录。它们的受监控计数亦为0，测试失败不等于审计缺失，最终新轮PASS不删除/改写旧失败证据。系统级休眠/调度原因未验证，不为其编造诊断。

通过git逐项核对：001–013迁移、推荐engine、生产执行门禁/工厂无差异；包文件哈希与初始完全一致。本轮没有改变免费资格或执行授权来源，生产默认拒绝保持。

## 11. 分类与下一步

- PASS：确定性统计、缺失/截断/来源边界、实际SQL数据联动（串行PGlite）、当前用户成长专项、历史排除与桌面/移动本地产品链路。
- FAIL：最终功能/回归失败0；中间的选择器失败、跨套件超时与worker启动失败如实保留在第8节，不能声称历次运行均PASS。
- BLOCKED：本机原生PostgreSQL运行时仍缺失、真实免费资格未建立；停止环境搜索，不安装/下载或放开门禁。
- NOT_RUN：原生20项、多连接/托管RLS/JWT、011–013托管应用、B4、线上部署、真实用户训练效果或预测效度。未以PGlite/Mock替代。

四层结论分开：画像/成长计算正确与推荐集成在本地PASS；历史关联与统计口径仅在已声明来源/覆盖范围内可解释；实际预测能力、推荐因果收益或用户能力提升均未验证。没有真人评审/参与者新证据，不增加历史真实评审计数。

下一项可直接本地开发：沿既有 M34_RECOMMENDATION_STUDY 的观察模板和 m34-study.ts，核对并补充离线结果校验/汇总：按参与者而非题目作为配对单位，处理追加修正、同题重叠、退出/撤权与缺失分母，先以合成夹具验证，不采集真实参与者数据。真正推荐效果评估还须专用环境验收、知情同意、共同候选/难度与对照顺序，以及新的真实参与授权，不能用合成完成率代替。013托管上线、原生环境、真实JWT、免费资格与B4分别需要条件/新授权；本轮不自动进入。

开发、测试与报告完成后停止，修改留待人工审查。
