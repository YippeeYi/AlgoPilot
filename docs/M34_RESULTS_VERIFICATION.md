# M3.4 研究结果校验与配对汇总验收

2026-10-28，Asia/Shanghai。本轮完成**原研究冻结输出/观察字段 → 离线校验 → 明确配对 → 选手内统计 → JSON/Markdown**。工具正确不等于已有真实研究数据或已证明推荐/AI改善训练效果。

## 1. 实际Git与既定研究

初始实际HEAD：`64bef8e95e14e8bfc969653549ca49071511d8f4`，工作区干净。交接中的14修改/6新增及依赖文件已提交，无需恢复或覆盖。本轮不改package.json/package-lock.json、不安装或升级依赖。最终HEAD保持不变，所有本轮修改未提交。

已核对DEVELOPMENT_PLAN v3.4、MILESTONES、M35_GROWTH_OBSERVATIONS_VERIFICATION、M34_ACCEPTANCE、M34_RECOMMENDATION_STUDY、m34-study.ts、观察/准备模板、M321/M322人工与AI队列、M34录制/合成结果及相关测试。

M3.4比较A=deterministic/1.3-official个性化排序，B=同一当前授权候选池/目标/主题/限制下的Rating距离＋Tags基线。以选手为配对单位，每人两个block，顺序反转；block内选不同、未见过、主题一致且Rating差≤100的题。Tutor权限、时限和复盘机会共同控制，不是单独AI引导/AC复盘因果实验。

已有m34-study.ts只准备列表、hash和AB/BA顺序；人工/AI评审整合是另一套review-integration/1，不含训练对照结果。原观察模板所有值为空，缺少字段类型、评价版本与共同条件/冻结题对的结果关联契约。采用最小结果侧扩展，保留原study-preparation/1与原模板，不发明新研究假设或数值评分量表。

## 2. 当前真实材料覆盖

本轮只读核对仓库已知材料：

| 材料 | 行数 | 已填写assessment |
| --- | --- | --- |
| docs/m321/manual-review.csv | 40 | 0 |
| docs/m322/human-overrides.csv | 40 | 0 |
| docs/m33/replacements-for-review.csv | 5 | 0 |
| docs/m321/ai-assisted-review.csv | 40 | 40（AI，不算真人） |

M34原观察空模板event_id/participant_id均NULL，真实参与者仍0。既有公开CF录制只证明采集/重放中的公开事实，不是同意、真人评分或训练成果。本轮未搜集私人目录、未招募、未新增真人观察，不提高0/40、0/5或参与者计数。

## 3. 实现与兼容

新增独立 `scripts/m34-results.ts`，只用Node内置模块和已有Zod，不进入src/生产构建调用链，无数据库或网络功能。版本：m34-results-input/1、m34-observation/1、m34-results/1。

结果包原样包含已有prepareStudy输出，追加研究ID/来源、reviewer登记、同意版本/撤权、共同条件、元数据/冻结/解盲时间、X/Y归组和每block一个预登记题对。观察只在原有键上追加criteria_version、conditions_hash。缺字段拒绝，不自动迁移旧空表或猜测历史版本。

conditions_hash是规范JSON摘要，验证内部对应关系，不是来源签名、同意证明或模型调用许可。verified/provenance_verified仅操作者声明；declared_human永久标记“未独立验证”，不能自行证明真人/同意/真实共同执行条件。合成数据始终标记SYNTHETIC_NOT_HUMAN_RESEARCH。

契约与全部字段、退出码、覆盖局限见 [M34_RESULTS.md](M34_RESULTS.md)。原准备输出没有完整池/种子/enrollmentIndex与真实执行轨迹，工具不能重建或认证它们；也不能证明实际盲化、早期评分阶段或随机化。未将声明升级为真实研究证据。

## 4. 校验与追加历史

- 严格必填/类型/枚举/数值范围/版本/UUID和CF题目标识，拒绝额外字段；NULL可空但字段不能省略。未注册数值评分，数字5不会被解释为“很好”。
- 冻结列表人数/题数/重复/题目ID与CF键/元数据冲突、范围/主题/交互题、共同池摘要引用和来源声明。
- block/reviewer/pair唯一；观察归属、实际/掩码组、同意/metadata/证据revision/条件hash逐项匹配。
- event_id重复/冲突、同reviewer同对象多根、父事件缺失、分叉、跨对象/组/同意修正、循环或逆时间全部拒绝。合规修正只取最新叶节点，原事件不改写。
- 教师slot独立，不覆盖选手；AI/未核对来源不进主分析。本人撤权或任一block撤权使该选手所有block退出；后续false不隐式重新同意。
- 超过共同提示/训练时限、见过/中止/先修缺失或未知、协议偏离等不能算合格训练题对。

VALID表示输入有可描述的合法成对指标；不是完整真实研究PASS。缺block单列registered/expected；结构必要信息缺少、空数据或所有指标UNKNOWN为INCOMPLETE；无可比题对为NON_COMPARABLE；非法/冲突为INVALID。INVALID或结构必要信息INCOMPLETE整批停止比较，不悄悄过滤坏行后留下有利结果。字段问题输出固定code/path与原记录规范JSON SHA-256定位，不回显非法值或自由正文。

## 5. 配对与统计

只关联同一选手/block/预登记pair、各冻结组中的选中题，不按相近评分拼组。缺A/B、一对多、重复pair、同题、跨block重练、Rating差>100、主题不符、未解盲/来源未核对或顺序未反转时不强配。不同block可按计划共同更新证据，但一个block内两组版本须一致。

6个既定描述维度：适合、目标匹配、实际L3+、偏简单、偏困难、理由有据。每维仅保留A/B均非NULL的合格题对，分别报告A/B命中/题对数、单侧缺失、缺失题对数；先求每位选手内A/B比例与A−B，再求选手差中位数/范围。题目不是独立选手；小样本仅观察，L3+/过简单/困难更高也不是更好。

JSON明确raw/valid/invalid/incomplete/nonComparable、superseded/latest/teacher、paired/unpaired、pairedObservations/notInPairedAnalysis、registered/expected blocks、共同推荐、撤权与重叠排除原因。不同单位不混分母，重叠计数不相加。自报/官方/源码一致性不混为成功或得分；NULL不补0，不输出0/0。

无显著性/置信区间/效应量、预测/因果主张；没有独立多人同题评审面板，不计算一致性。列表层面全候选评审和教师质性结论未包装为训练对照。013训练来源/成长自然变化缺分配/共同条件和训练前基线，不能自动当A/B观察导入。

## 6. 真实执行CLI与可复现报告

```bash
node scripts/m34-results.ts /private/study/approved-results.json /private/study/new-report-directory
```

只读≤5MB显式JSON，不读取环境Key/数据库。独占创建目录0700与results.json/report.md 0600，拒绝覆盖原输入/旧报告；日志仅固定状态。相同输入集合重排记录/block/reviewer和JSON对象键时，JSON/Markdown逐字节相同；列表排名原序保留，使用稳定二进制排序，不生成当前时间。SHA不是独立来源认证或不可撤销匿名化。

已实际在本机运行合成演示：

- 输入：`/private/tmp/algopilot-m34-results-demo-NiLUQc/input.synthetic.json`。
- 输出：同目录 `report/results.json` 与 `report/report.md`，CLI退出0/VALID。
- 仅2条合成记录、1个合成选手/题对、block覆盖1/2。适合与目标A−B=1、L3+=−1等只检验已构造数值；**没有任何真人收益含义**。
- CLI原生执行测试另外验证非法JSON、无效/不完整退出码、目录已存在不覆盖、权限、原件不变与顺序重排字节一致。

报告不输出姓名、同意原件、reviewer ID、自由建议、源码、密钥或完整响应。包括协议目标/版本、输入指纹、规则/排除、分母/缺失、可描述观察及不能支持的结论，适合程序和人工私有审核。

## 7. 测试、失败与修复

| 实际命令（最终代码） | 结果 | 数量/失败 |
| --- | --- | --- |
| npm run lint | PASS | exit0 |
| npm run typecheck | PASS | exit0 |
| npm run test -- tests/unit/m34-results-validation.test.ts tests/unit/m34-results-pairing.test.ts tests/unit/m34-results-cli.test.ts --maxWorkers=1 | PASS | 66/66，3文件，失败0；校验34、配对/统计28、原生CLI4 |
| npm run test -- --maxWorkers=1 | PASS | 664/664，59文件，失败0；106.68秒 |
| npm run test:recommendations -- --maxWorkers=1 | PASS | 36/36，8文件，失败0；约77.5秒 |
| npm run build（含postbuild） | PASS | exit0 |
| npm run test:e2e | PASS | 桌面/移动64/64，失败0，39.9秒，重试0 |
| git diff --check | PASS | exit0 |
| 核心检查包装器的审计收集 | FAIL | 37完成、1个未发布pending；counters=null，包装器exit1，不是全量命令exit1 |

最终核心工作副本 `/private/tmp/algopilot-m34-results-checks-WFxEON/workspace`；退出码/审计为父目录checks.json，日志 `/private/tmp/algopilot-m34-results-verified.log`。功能命令分别exit0；审计收集不完整，不把包装器宣称PASS。

E2E副本 `/tmp/algopilot-gate-e2e-Molgk5/workspace`，审计 `/tmp/algopilot-gate-e2e-Molgk5/e2e-audits-AbWQu3/checks.json`；日志 `/private/tmp/algopilot-m34-results-browser.log`。E2E构建/测试/审计包装器均exit0。251个源码/测试/脚本/配置与核心副本字节一致；E2E按既有runner的12份测试导入守卫与Provider私有接线转换后额外差异0，源工作区没有测试放行接线。

覆盖：完整/缺失/非法/越界/额外字段、版本、重复与冲突、线性修正/缺父/多根/分叉/循环/跨对象、来源/归属/撤权、单组缺失/一对多/对象不在列表、同题/跨block重练/难度/主题/顺序/条件偏离、空/全UNKNOWN、混合可靠性、自报与官方分离、选手单位而非题目单位的分母、中位数/范围、输入排列及输出字节稳定、原件和权限。

本轮不影响UI/API/生产行为，无需新增UI E2E；仍执行现有完整桌面/移动回归。所有检查在排除.env*的私有副本、空HOME与白名单环境下运行，使用原B3 Node guard；E2E另受macOS loopback sandbox和既有路由守卫限制，retries=0。没有删旧断言、跳测试、放宽权限/预算或改变限流。

中间失败如实保留：首次lint PASS，typecheck发现两处Fixture推断过窄/过宽，专项58通过/1失败（测试中的固定BA可能等于原值）。已修正Fixture类型与让测试确实翻转原顺序，断言不变；修复后59/59。随后增加7个边界用例，专项66/66。首个完整轮664/664、推荐36/36、build均PASS，但有零字节 `14291-0.pending` 未收集，37个已完成审计不能代表缺失项，汇总保持collection_failed/counters=null，未删除/补零/改guard。证据目录 `/private/tmp/algopilot-m34-results-checks-Ey9B6n`，日志 `/private/tmp/algopilot-m34-results-checks.log`。独立复验结果以上表为准，未覆盖旧失败证据；缺失审计的具体终止原因UNKNOWN。

## 8. 文件与安全审计

最终工作区4修改、9新增，共13文件，0暂存/0删除；无commit/push/PR/reset/clean。初始工作区干净，不含既有依赖修改。

| 状态 | 文件 |
| --- | --- |
| 修改 | `README.md` |
| 修改 | `docs/M34_RECOMMENDATION_STUDY.md` |
| 修改 | `docs/MILESTONES.md` |
| 修改 | `scripts/test-offline-e2e.mjs` |
| 新增 | `docs/M34_RESULTS.md` |
| 新增 | `docs/M34_RESULTS_VERIFICATION.md` |
| 新增 | `docs/m34/result-observation.template.json` |
| 新增 | `docs/m34/results-input.template.json` |
| 新增 | `scripts/m34-results.ts` |
| 新增 | `tests/fixtures/m34-results.ts` |
| 新增 | `tests/unit/m34-results-cli.test.ts` |
| 新增 | `tests/unit/m34-results-pairing.test.ts` |
| 新增 | `tests/unit/m34-results-validation.test.ts` |

修改仅研究CLI/合成Fixture/测试、现有E2E复制清单与文档。git核对src/、全部001–013、package.json/lock、m34-study.ts、原准备/观察模板均无差异；不改推荐权重、提示/复盘Schema、生产免费门禁、B3五文件、真实数据或生产权限。

审计范围如实分开：

- 专项修复轮14个Node审计完整，监控六计数均0。
- 最终核心37个已完成Node审计的 networkBlocked/dnsBlocked/credentialReadBlocked/externalHTTP/realDNS/realCredentialReads 均0；另有 `14634-0.pending`（143字节）未发布成.json。其完成状态/最终计数UNKNOWN，整批维持collection_failed/counters=null。没有删除、补零、改guard或把pending重新命名为完成。
- 最终E2E17个Node审计完整，无残片/无效记录，六计数均0；12个浏览器worker记录5347个允许的loopback页面请求、denied=0。浏览器原生后台HTTP/DNS及进程外全机计数UNKNOWN。
- 合成CLI演示子进程另有私有audit目录，只用于本机JSON/Markdown验证，不是研究来源或模型请求证据。

| 安全事项 | 可支持的结论 |
| --- | --- |
| 主动真实模型/B4/付费/生产DB操作 | 本轮未执行；测试和演示只用合成输入/PGlite/本地HTTP替身，无真实端点/数据库连接 |
| 主动真实Key读取 | 未执行；不读真实.env*，原生CLI仅显式合成JSON，配置只用已有测试假值 |
| 外部HTTP/DNS/凭据总次数 | 已完成受监控部分0；核心缺失记录与浏览器原生/进程外部分UNKNOWN，不能声称全进程/全机均0 |
| 私人材料或源码外发 | 未执行；只在本机私有副本读写，不调用外部服务或上传 |
| 模型免费门禁 | 默认拒绝保持；研究verified/hash不是资格/执行许可，不增加测试或环境放行后门 |
| 托管迁移/部署/依赖安装/系统服务/代理改动 | 全部未执行 |
| Git提交/推送/PR/历史删除 | 全部未执行 |

审计收集FAIL是本轮剩余的验证限制，根因UNKNOWN；没有以功能PASS推断审计记录完整或把缺失计数填0。

## 9. 分层结论与下一步

- 离线校验器：PASS，66项专项与现有回归实际执行；仅验证既定输入契约。
- 配对与统计：PASS（离线限定），仅声明规则和输入覆盖内可复算，合成案例证明实现而非真实效度。
- 真实研究数据：仍无参与者/真人评分，不因CLI成功增加计数。
- 研究结论可靠性：独立身份/同意/协议执行、盲化、对照过程和覆盖均需真实审核；当前不主张可靠教学结论。
- 推荐或AI改善训练：NOT_RUN，没有真实效果或因果证明。

功能最终FAIL=0；审计收集FAIL（1未发布记录，汇总UNKNOWN）独立保留。原生PostgreSQL环境/可信免费资格仍BLOCKED；原生20项、B4、托管JWT/迁移/部署与真实研究保持NOT_RUN，不能以PGlite/Mock替代。本轮不自动进入实验或部署。

下一项可本地推进：在用户显式提供的私有准备输入上离线重跑既有prepareStudy，逐字核对结果包中的冻结列表/池摘要/AB/BA分配，先以合成Fixture验证输入→冻结输出关联；不补造历史seed/候选资格或自动采集私人材料。与此同时，准备资料仍需负责人独立核对同意/授权/盲评阶段，工具不能代替实际协议执行。真实研究须先有获准专用环境和当前JWT/隔离验收、参与者独立同意、同组条件与分配记录；若涉及Provider发送或B4，免费资格和当前生成授权仍分别需要，历史许可不能沿用。

完成后停止，保留全部修改供人工审查。
