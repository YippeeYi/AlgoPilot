# M3.4 人工评审操作与合成演练验收

2026-10-28，Asia/Shanghai。本轮交付案例级本地评审操作闭环，不扩展统计模型、不执行真实研究。操作和数据契约见 [M34_REVIEW_WORKFLOW.md](M34_REVIEW_WORKFLOW.md)。

## 1. 实际基线与缺口

实际HEAD `dfdd11d37041afc0e79bc0dc212ca7a9bb4347dc`，开始工作区干净。交接的5修改/11新增已由用户提交；本轮保留HEAD，不commit/push/PR/reset/clean。已核对README、DEVELOPMENT_PLAN、MILESTONES、原M3.4研究/评分、prepareStudy、RESULTS/REPLAY及两份历史验收、原模板与审计测试设施。

既有工具已经能准备共同A/B列表、验证观察/修正/撤权、按选手配对和独立复算；缺少安全分发X/Y材料、阶段间封存、部分工作持久保存、明确正式提交与任务/人/冻结绑定的操作层。原40项M322人工覆写是另一既有入口，未重复实现。原五题研究包含解法线索，不能直接给独立训练选手。

本轮采用离线CLI和本地文件，未加页面/生产表/迁移/依赖。适合度、难度、目标匹配及后续字段直接pick原observationSchema；只导出原冻结选中题对，列表其余工作留原日志，不增加研究分母。六指标、A/B含义、AB/BA顺序、候选/难度/题数与选手配对单位不改。

## 2. 实际操作闭环

1. prepare：复核已有冻结旁车、原prepare输入、版本/案例/题对、注册归属及材料；新批次必须未解盲、无既有观察。保存不可覆盖的私有setup/manifest。
2. issue：在私有名册中选择合法任务，随机叶目录分发fit包。白名单只含公共题号/Rating/同等题面、共同条件、X/Y及随机任务标识；不包含A/B身份、理由、答案、种子/候选哈希、私人索引或同行评分。
3. view/form/apply save：明确必填字段、进度、草稿和历次正式快照；部分保存后新Node进程能够恢复。草稿缺失不填零、不入观察。
4. submit：必须全部字段明确填写（允许的UNKNOWN须显式null）并confirm_complete=true。相同requestId重试返回原receipt；改正文、旧revision、第二根提交拒绝。
5. release：负责人在正式fit完成后，先封存fit，再发绑定快照的followup理由/训练观察包。不能通过公共apply调用release，封存后不能事后改初评。中断于fit封存与私有收据之间可按原请求恢复。
6. correct：以最新正式receipt为父，保留原始值并追加有变化、时间递增的正式快照；导出为原supersedes链，不覆盖教师/选手记录。未提交修正草稿仍不入统计。
7. unblind/export：明确私有分析解盲，旧结果校验、配对器与独立复算器实际运行。新目录输出current/results/report/replay/workflow；重复导出字节一致。未解盲的正式结果拒绝分析；无训练题对不补配、不造行。
8. withdraw/export：仅本人登记选手可操作，覆盖全部block；后续发包/放理由拒绝，新导出不再读取其原/修正文件，不因随后评分重新同意。旧结果不静默覆盖，复核撤权新输入与过期报告会FAIL。

不是生产Auth系统。文件0700/0600、一人一叶目录、随机ID、哈希链、独占追加与CAS防事故；同OS所有者仍能重写自洽文件树。哈希不证明同意、真实冻结时间、独立评分或实际盲化。关键词检查仅拒绝明显身份/题解标记，负责人仍须人工检查且安全交付；熟悉题号的评审可能推断条件。撤回已有副本、真实保留/删除/匿名化需负责人依同意和授权另行落实，本轮不删历史。

## 3. 合成演练矩阵

新增纯策略15项与原生Node文件CLI4项；不是数据库原生20项。专项同时包含原结果/配对/复算/审计109项，全部原断言保留。

| 操作/异常 | 实际验证 |
| --- | --- |
| 正常完整评分 | 两阶段正式提交→原观察v1→配对→JSON/Markdown→独立复算 |
| 部分完成、恢复 | save无正式行；另起实际Node CLI view恢复相同草稿 |
| 缺项、错误枚举/类型、错版本 | 字段/任务可定位拒绝，不补默认评分；冻结/包/日志损坏拒绝 |
| 重复与冲突 | 原requestId/body幂等；改body、旧revision、重复根、错父修正拒绝 |
| 不同评审者不同评分 | 随机身份/包绑定不同，跨包提交拒绝；教师单列，不占选手指标分母 |
| 追加修正 | 原/新事件保留、supersedes链正确，最新值用于统计 |
| 先看理由/改已封存初评 | 无正式fit不开放理由；公共release拒绝；fit sealed拒绝后改 |
| 不完整/不归属/已解盲新任务 | 不完整草稿不进入汇总；错所有者拒绝；解盲后新发包拒绝 |
| 崩溃边界 | 实际文件中仅fit seal已提交，模拟协调收据未写入；恢复只一份followup、fit仍封存 |
| 撤权和残留 | 拒绝再发包；撤权后故意损坏其公共包，新导出不读取也不计入；旧统计复核失败 |
| 无题对 | 列表评分可保存，零观察/零配对，workflow标记NON_COMPARABLE_NO_DISTINCT_PAIR |
| 旧CLI与重现 | 实际子进程运行原results/replay CLI；报告字节相同，独立checks全部PASS |
| 错误隐私 | 非法record key用$unknown定位，不回显模拟敏感字符串 |

另实际运行一次保留文件的演练，材料及身份均显式SYNTHETIC：P001（合成案例ID）、R-SYNTHETIC、T-SYNTHETIC，一个block、一对不同题；两人分别初评、正式followup，选手一次修正，再私有解盲与撤权。私有合成产物位于 `/private/tmp/algopilot-m34-review-rehearsal/`，`rehearsal.json`记录操作状态；不加入仓库正式数据。

| 合成导出 | 原始行 | 最新有效行 | 被替代行 | 教师行 | 训练题对 | 指标选手样本 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| active | 6 | 4 | 2 | 2 | 1 | 1 |
| withdrawn | 0 | 0 | 0 | 0 | 0 | 0 |

active两次导出六个文件逐字节相同；冻结、独立复算、JSON、Markdown四项PASS。withdrawn标记撤权选手1，原评审文件保留但未再采集。正式研究要求每人两个block，本例 registeredBlocks=1/expectedBlocks=2，**不能宣称研究完整**。这些自报训练字段只作夹具输入，不是实际训练、官方AC或真人评分。

## 4. 测试与回归

最终结果见本节收尾记录；不引用上轮PASS替代本轮执行。

通过 `node scripts/check-offline.mjs` 在私有副本中实际执行（每个命令exit 0）：

| 命令 | 通过/失败 | 结果 |
| --- | --- | --- |
| npm run lint | 0错误/0警告 | PASS |
| npm run typecheck | 0类型错误 | PASS |
| npm run test -- tests/unit/m34-review.test.ts tests/unit/m34-review-cli.test.ts tests/unit/m34-replay.test.ts tests/unit/m34-replay-cli.test.ts tests/unit/offline-audit.test.ts tests/unit/m34-results-validation.test.ts tests/unit/m34-results-pairing.test.ts tests/unit/m34-results-cli.test.ts --maxWorkers=1 | 128/0 | PASS（新增19，原109） |
| npm run test -- --maxWorkers=1 | 726/0，64文件 | PASS |
| npm run test:recommendations -- --maxWorkers=1 | 36/0 | PASS |
| npm run build（含postbuild） | 0构建错误 | PASS |
| git diff --check | 0空白错误 | PASS |

日志 `/private/tmp/algopilot-review-final.log`，隔离副本 `/private/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-replay-checks-LyShxG/workspace`，旁边checks.json记录各命令与审计。另在审计展示修正后重新执行 `node scripts/check-offline.mjs --targeted`（收尾结果下列）。完整回归的源代码与最终功能文件逐字节核对；269份功能/脚本/测试/配置文件核对见 `/private/tmp/algopilot-review-source-checks.json`；其后唯一脚本差异是E2E的顶层审计计数修正，该脚本另经最终静态/专项及实际E2E运行。

`npm run test:e2e` 两次均实际完成64/64桌面/移动断言，最终重跑exit 0、构建exit 0、审计PASS。日志 `/private/tmp/algopilot-review-browser-final.log`，私有副本 `/private/tmp/algopilot-gate-e2e-w3BiJ7/workspace`，正式结束审计 `/private/tmp/algopilot-gate-e2e-w3BiJ7/e2e-audits-wOdttJ/checks.json`。运行命令使用 `sandbox-exec` 拒绝network*、只许localhost入/出，再以 `env -i` 空HOME/白名单环境执行 `npm run test:e2e`；原Playwright两个workers、retries=0、所有原超时不变。最初断言通过但审计不完整的包装FAIL另见安全节。

E2E结束后以完全相同的 `node scripts/check-offline.mjs --targeted` 独立重跑：lint/typecheck exit 0、专项128/128、0失败、审计35启动/35结束PASS。日志 `/private/tmp/algopilot-review-static-serial.log`；最终功能源码与该私有副本相同。先前并行批次的3个5000ms超时记录保留，不以本次成功改写历史，不提高预算。

未新增浏览器评审页；CLI本身用真实文件/独立Node进程完成端到端演练，现有桌面/移动产品E2E仍运行。未改既有断言、超时、重试次数、推荐权重、Provider或迁移。原prepareStudy/模板不变，原结果DTO/CLI golden JSON与Markdown摘要继续通过。

开发初轮保留了失败日志：适配器遗漏verifyReplay、测试环境window配置、类型推断及测试操作时间早于release。修复实际接线/类型并使测试时间符合操作顺序，没有放宽拒绝断言。收尾并行E2E构建的静态/专项批次中，旧复算CLI两项和新增CLI一项触及既有5000ms预算，保留 `/private/tmp/algopilot-review-static-final.log`（125通过/3超时失败，审计35/35完整）；未删除断言或放宽超时，随后E2E结束后按原预算独立重跑128/128通过。错误路径中的用户自定义key另做脱敏。来源只声明不能独立认证的限制如实保留。

## 5. 安全与审计

所有检查在排除.env*的私有副本、空HOME与白名单环境执行；Node preload禁止外部HTTP/DNS与凭据文件读取。E2E仅私有临时副本接本机合成HTTP，浏览器路由禁止外部，macOS沙箱只许loopback；源工作区生产工厂不导入测试Policy。没有读取真实Key、调用模型/付费API、生产库操作、托管迁移/部署或向外发送材料的主动操作。无安装/下载/系统代理变更。

首轮E2E64项断言PASS但审计52 started/46 completed，缺六份结束记录，包装器正确FAIL；没有pending也不能当零。只读检查这六个测试PID已不存活，未能证明退出原因，记UNKNOWN，保留原目录与日志，不补写记录。另发现其顶层nodeCounters仍汇总已结束子集为0、与lifecycle未知矛盾；最小修正为直接使用lifecycleAudit.counters，缺失即null，不修改guard或收集器准则。

最终独立静态/专项正常批次35/35结束、完整检查正常批次171启动/171结束，issues=[]，外部HTTP、真实DNS、真实凭据读取以及三种拦截计数全为0；保留文件演练1/1结束、同样全部0。故障注入合成审计目录继续由原9项测试验证FAIL/UNKNOWN，不进入正常批次。

最终E2E Node 41/41结束、browser 12/12结束，issues=[]；5320次允许的页面路由都是本机合成服务，拒绝0；受监控外部HTTP/DNS/真实凭据读取及拦截计数全部0。两次E2E的实际Node进程数量不同，按逐份启动/结束配对验收，不用固定数量推断覆盖。浏览器原生/后台层仍UNKNOWN。

| 审计对象 | 最终正常受监控范围 | 全轮累计/未监控范围 |
| --- | --- | --- |
| 外部HTTP、真实DNS、真实Key读取 | 各0，完整生命周期记录支持 | UNKNOWN（首轮未发布记录及历史/故障） |
| 真实模型/付费API/生产数据库访问 | 未执行相应操作；隔离应用外部网络路径0，未接入真实账户 | 全轮独立精确分项计数UNKNOWN，不声称远端费用或权限核验 |
| 私人材料外发 | 无主动发送，工作流和演练仅本地合成文件 | 原生/后台累计UNKNOWN |
| 原生浏览器HTTP/DNS | 沙箱限制只许loopback，页面层有路由记录 | 原生尝试次数UNKNOWN |

生产门禁、Provider和源工厂无diff；没有增加测试放行环境变量，Mock只在既有私有E2E副本接线。

正常受监控批次的0不能覆盖失败E2E、历史缺失或SIGKILL故障注入。全轮累计外部HTTP/DNS/真实凭据读取以及未监控原生/后台层次数保持UNKNOWN；缺失与故障测试不并入正常批次补造。真实模型/付费/生产DB没有执行路径或主动操作，但不凭离线计数声称远端账户或计费已验证。浏览器页面路由计数与原生网络次数分开。

## 6. 文件清单

修改：

- `scripts/m34-results.ts`：导出既有observationSchema供操作层复用；给只读inspectStudy明确返回类型，修正其闭包回调导致ledger静态推断为null的问题；旧结果行为不变。
- `scripts/check-offline.mjs`：新增两组评审专项，沿用原隔离/审计。
- `scripts/test-offline-e2e.mjs`：私有副本包含新文件；顶层计数遵从完整审计结果，不能以已发布子集代替全体。
- `README.md`、`docs/MILESTONES.md`、`docs/M34_RESULTS.md`：操作/验收入口及状态说明。

新增：

- `scripts/m34-review-core.ts`：契约、材料白名单、两阶段状态、幂等/修正、原观察转换。
- `scripts/m34-review.mjs`：文件CLI、独占日志、私有协调、导出与撤权。
- `tests/fixtures/m34-review.ts`、`tests/fixtures/m34-review-driver.mjs`：合成身份/材料与原生Node驱动，仅测试使用。
- `tests/unit/m34-review.test.ts`、`tests/unit/m34-review-cli.test.ts`：策略与实际文件闭环。
- `docs/M34_REVIEW_WORKFLOW.md`、本验收文件。

不改src、依赖/锁文件、生产Provider/门禁、原统计实现、研究原定义/模板/prepare、B3五文件、001–013迁移或历史数据。临时演练和失败日志保留在本地私有目录，不进入正式研究/测试计数。

## 7. 结论与下一阶段

- PASS：本地评审工具、合成文件操作闭环、原结果契约/配对/独立复算兼容、撤权排除与重复输出一致性。
- FAIL记录保留：开发初轮接线/类型/测试时间错误已修复；第一轮E2E审计六份结束记录缺失未被补造，其累计仍UNKNOWN。
- BLOCKED：真实研究开展前的授权、同意/安全交付与实际盲化证据、专用托管/JWT等外部条件；真实免费资格仍无可信证明。
- NOT_RUN：真人评审、真实参与/完整两block训练、教学或推荐效果实证、原生PostgreSQL20项、B4及托管部署验收。

| 结论层次 | 验收 |
| --- | --- |
| 本地评审工具可操作 | PASS（CLI功能/文件恢复/追加审计） |
| 合成评审流程通过 | PASS（含原结果工具和独立复算） |
| 真人评审已经完成 | NOT_RUN，原0/40、替代0/5、真实参与者0 |
| 研究结论获得验证 | NOT_RUN，没有真实研究数据/完整研究 |
| 教学效果获得实证支持 | NOT_RUN，不能由离线PASS推出 |

最终HEAD仍为本页基线；工作区6修改、8新增，共14文件，全部保留未提交。

工具可用与合成操作闭环通过，只表示能按原契约规范记录并复核；真人完成、统计外推可靠性和教学效果是独立层次。正式人工仍0/40，替代0/5，真实参与者0。没有真实冻结/评审数据，不生成正式研究结论。原生PostgreSQL20项仍NOT_RUN，B4 NOT_RUN、真实免费资格BLOCKED、托管完整验收NOT_RUN，均未被Mock/PGlite替代。

下一项可离线执行的是负责人用本操作手册做不含真实参与者的材料交付/回收检查（含人工检查潜在解法线索、逐人权限和退出材料保管流程），发现具体缺口再修正；不再扩充指标。真实研究须另获许可并满足专用环境/JWT/恢复、真实同意与撤权处置、合法材料/共同候选与两block可信冻结、盲化与独立交付。任何模型生成、真实免费资格验证、托管迁移和部署继续另授权。本轮完成后停止。
