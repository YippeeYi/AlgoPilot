# M3.4 准备输入、冻结与结果的离线复算验收

2026-10-28，Asia/Shanghai。**本地复算切片与最终正常验收批次PASS。** 研究定义→原准备输入复算→冻结差异→原结果校验→独立选手级统计→JSON/Markdown核对已实际运行。仅合成验证，不代表真实研究、冻结授权或教学效果。

## 1. 实际基线与范围

实际HEAD `23d860c8e56a0e830736a7828906fa926f680c7d`，初始工作区干净；交接中的4修改/9新增已提交。已读M34_RESULTS/VERIFICATION、原研究设计/准备脚本、模板、结果代码与测试、Roadmap、AGENTS，以及本机Vitest/Playwright的收尾实现。HEAD本轮不变，不改依赖、不安装、不提交/push/PR/reset/clean。

M3.4仍比较共同候选和条件下的个性化A与Rating/Tags基线B，六个描述指标、每人两个block与选手配对单位保持。旧CLI、原模板、模型门禁、推荐权重、001–013及生产代码均不改。原prepare输入与结果v1在既定0/1 block上可直接匹配，无需迁移或补造历史字段。准备器泛化的其他block不被重编号纳入本研究。

## 2. 输入/冻结契约与只读入口

详细字段及限制见 [M34_REPLAY.md](M34_REPLAY.md)。新增私有旁车m34-freeze/1：固定原准备/结果/标准版本、唯一case_id、原prepareStudy完整输入，以及冻结时原样保存的m34-results-input/1（含当时已有原记录，可为空）。不生成或批准正式冻结；仓库没有真实冻结研究数据。

```bash
node scripts/m34-replay.mjs private-freeze.json private-current.json private-existing-report-directory private-new-verification-directory
```

显式读取四份文件，不读Key或数据库。输出replay.json/replay.md/sources.json，独占新目录0700、文件0600，不覆盖或修复原件。解析/IO失败固定脱敏错误；有效解码后按SHA与字段路径定位差异。旧m34-study.ts与m34-results.ts CLI参数、退出码、返回DTO不变。

## 3. 复算与差异规则

- 每个准备输入重新调用原prepareStudy，核对全部prepared字段、完整池摘要、seed/enrollment分配、版本/范围/目标/主题/revision；不以当前画像重建资格。
- 冻结与当前的研究ID/来源/标准、reviewer、案例集合/归属、条件、题对和元数据逐项核对。缺失/重复/多出案例、重新归属、A/B错误或字段变化均拒绝。
- 只允许既定active→withdrawn与NULL→合法解盲时刻；不能更改已存在解盲时间或借修正重新同意。
- 原event_id必须保留且语义不变，新增事件只能追加。原校验器继续验证线性修正、缺父、多根、分叉/循环、来源/归属和版本；非法/必要信息缺失时停止统计。
- 输出逐记录SHA状态：冻结原记录、追加、修正、最新有效、撤权和可入统计，分别标明且可重叠。撤权覆盖该选手全部block，后续false不能恢复。
- 旧JSON与当前重算结果逐值核对，旧Markdown按原格式逐字节核对；差异保留code/path/前后摘要，不回显自由正文或额外字段名。最多显示200项，但保留完整差异总数与截断标志。

integrity与dataStatus分开。正确复核全部无效/不完整数据，不会将其提升为研究可用；冻结失败时独立统计和报告检查NOT_RUN。没有可信独立存档时，工具不能证明有人未将冻结文件及全部原件一起改成自洽内容，hash不是签名/同意或真实冻结时间证据。

## 4. 尽可能独立的核对

复用现有字段schema、来源诊断与错误分类，避免另建研究政策；不宣称所有验证完全独立。新增inspectStudy只供离线读取内部准入证据，不序列化私人原文。

独立实现重新构造叶节点、原始/有效/排除/修正/教师/撤权计数、原始事件与题对分母；对案例归属/共同条件/先修/历史接触/提示/时间/重复题/跨block顺序再次检查，再独立选择唯一A/B。不同选手不合并，未确认来源不入组。

指标命中与缺失双侧重新计算，先选手内A−B，再用BigInt有理数计算选手差中位数/范围；不调用原metric/median汇总函数。六指标各有实际题对/选手/缺失分母，NULL不当0。既定两个block下数值可精确binary64表示，严格比较，无epsilon容差；精确分数以字符串分子/分母留证。

故意注入“生成器算错但JSON/Markdown彼此一致”的计数/分母/选手数/缺失/中位数/inputHash错误，独立检查仍FAIL；不是只比较两次生成。3题对来自2选手的合成例得到选手差中位数−1/4，未把题目数当人数；撤权后仅其他选手题对保留。辅助分数测试验证1/3与1/2的中位数5/12，不据此增加研究block。

## 5. 哈希、精度与旧版兼容

原字节SHA独立在sources.json；replay.json/md仅含语义指纹与研究内容，不含运行时间。对象键、明确无序集合及eligiblePool排序可等价，排序**保留重复项**并由校验器拒绝，不去重清理数据。排名、时间、条件、版本、Tags顺序与NULL不删除；原准备v1的hash规范仍由原函数执行。

严格UTF-8、拒绝重复解码JSON键、非有限数/非安全整数与过深JSON，不last-key-wins、不替换坏字节、不裁剪真实数值。标准JSON数按原binary64语义解析，词法字节差异仍保留。改变真实内容/版本/条件会失败，格式等价只影响字节收据。Markdown不忽略版本/条件/换行来制造相同。

修改前已实际生成旧版基线，固定合成studyInput的JSON SHA `8a0568978e0031a4e37a9942bb0042249a9b6bf39fb19fdbbe7b9f971a08f2ed`、Markdown SHA `b51561cf62bbf77fbbba433efa9711d3605dfaccf5344ed342e9219ce4848ba6`。新增回归逐字节摘要相等；原66项完整保留。原代码只拆出只读检查出口，结果行为未改。

## 6. 审计缺陷复现与最小修复

实际复现：一个正常子进程加一个发布前SIGKILL的子进程，目录只有1份.json且没有pending。旧的“只扫描已发布/未发布文件”无法知道第二个进程存在，可能少计。新预加载器先写started登记，再使用**未修改的原B3 guard**；新收集器逐份核对启动/结束，缺失/坏记录/pending/冲突/溢出或违规计数均FAIL，缺失时counters=null/UNKNOWN，不能被测试exit0掩盖。

进一步由本机安装源码确认：Vitest fork.stop默认SIGTERM；Node默认信号终止不执行JS exit；Playwright未配置webServer收尾时默认进程组SIGKILL（types/test.d.ts已明确）。这些会绕过/中断原guard发布。

修复仅在测试预加载器：保存框架替换前原exit，SIGTERM/SIGINT走原退出路径并保留143/130，原guard发布真实计数。SIGKILL仍不可捕获，测试必须保持UNKNOWN。没有改guard、伪造、补写或重命名历史审计。

E2E功能初次已64/64，但新生命周期发现10份webServer结束缺失；私有测试配置随后改为SIGTERM→500ms后仍未退出则SIGKILL。**这是审计收尾，不是延长失败测试预算**：测试/启动超时、worker并发与retries=0完全不变；500ms后若发布失败，仍应审计FAIL。最终55/55、浏览器12/12完整。未改系统代理/Clash/TUN或生产进程行为。

故障注入审计目录与正常验收目录分开，其UNKNOWN/违规是预期断言，绝不作为真实计数合并或补0。早期历史缺失记录仍UNKNOWN，不追溯改成PASS。

## 7. 实际执行与失败记录

环境为已有Node v24.19.0/npm11.17.0与node_modules，无依赖安装。最终检查如下：

| 实际命令 | 最终结果 | 数量/边界 |
| --- | --- | --- |
| npm run lint | PASS | 最终静态批次exit0 |
| npm run typecheck | PASS | 最终静态批次exit0 |
| npm run test -- tests/unit/m34-replay.test.ts tests/unit/m34-replay-cli.test.ts tests/unit/offline-audit.test.ts tests/unit/m34-results-validation.test.ts tests/unit/m34-results-pairing.test.ts tests/unit/m34-results-cli.test.ts --maxWorkers=1 | PASS | 109/109，6文件，失败0；新复算/CLI/审计43项＋原66项 |
| npm run test -- --maxWorkers=1 | PASS | 707/707，62文件，失败0，109.37秒 |
| npm run test:recommendations -- --maxWorkers=1 | PASS（独立复跑） | 36/36，8文件，失败0；此前同轮2项超时保留 |
| npm run build（含postbuild） | PASS | 核心批次exit0；最终E2E还实际构建一次 |
| npm run test:e2e | PASS | 桌面/移动64/64，失败0，39.4秒，重试0 |
| git diff --check | PASS | exit0 |
| 最终正常批次审计 | PASS（限定覆盖） | 核心157/157；静态专项28/28；推荐10/10；E2E55/55；合成演示3/3，均无缺尾 |

核心副本 `/private/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-replay-checks-xFEdbg/workspace`，父目录checks.json，日志 `/private/tmp/algopilot-replay-accepted.log`。此包装器仍exit1，原因是该轮推荐2项超时，不能把整批标为全成功。

同一核心副本的推荐独立复跑日志 `/private/tmp/algopilot-replay-recommendations.log`、审计 `/private/tmp/algopilot-replay-recommendations-QsogM9/checks.json`，命令及审计均exit0/PASS。

最终静态/专项副本 `algopilot-replay-checks-4yNRB0/workspace`（同临时父目录），日志 `/private/tmp/algopilot-replay-final-static.log`，命令与审计均exit0/PASS。核心全量之后仅E2E私有收尾配置有代码差异；其余源/测试/配置字节一致。最终静态批次260文件与当前工作区字节完全一致。

最终E2E副本 `/tmp/algopilot-gate-e2e-PJFver/workspace`，审计 `/tmp/algopilot-gate-e2e-PJFver/e2e-audits-k33IX5/checks.json`，日志 `/private/tmp/algopilot-replay-browser-verified.log`。按既有12份测试导入和Provider私有接线转换后，260文件额外差异0。后续仅文档补写。

覆盖正常/缺失/重复/多余/跨人案例、冻结版本/字段变化、原始记录删除或修改、重复结果/合法与冲突修正、修正后撤权/旧统计残留、不同可靠性/NULL、顺序及格式变化、实际内容变化、精确分数/原始小数边界、全无效/零真人、JSON/MD分歧、旧报告SHA、多次CLI一致、UTF-8/符号链接/重复JSON键，以及正常/信号退出/强杀/损坏/未发布/溢出审计。

本轮不影响产品UI，无新增UI用例，但现有桌面/移动64项均实际运行。全量仍含串行PGlite，不代替原生20项。代码在排除.env*、空HOME/白名单环境的私有副本验证；E2E另有macOS loopback sandbox、浏览器路由/后台网络限制，正常配置仍默认拒绝LLM。

开发中失败未隐藏：初轮因新CLI与核心模块同名使Vite优先解析.mjs，27项失败；已改核心名为m34-replay-core.ts。另修正CJS加载lint及测试环境NODE_ENV类型。修复后104/104；追加边界后107/107、109/109。严格JSON测试一处无效转义导致lint失败，修正为同等编码输入，断言不删，最终lint通过。

早期生命周期登记发现worker缺尾，27开始/21结束，保持FAIL/null；受控信号修复后27/27。E2E初轮64/64但55开始/45结束，保持FAIL；收尾修复后55/55。证据日志 `/private/tmp/algopilot-replay-early.log`、`algopilot-replay-fixed.log`、`algopilot-replay-audit-fixed.log`、`algopilot-replay-browser.log`均保留。

完整707轮中的推荐专项34通过/2超时（m33-official原30秒、m34-acceptance原120秒），实际耗时异常增长，根因UNKNOWN，不推断休眠/网络或放宽预算；随后同一代码私有副本原预算单独复跑36/36，见上表。更早705与707阶段回归亦留原日志，不将旧PASS替代失败。

## 8. 实际CLI演示与文件清单

实际最终合成演示目录：`/private/tmp/algopilot-replay-demo-pvGyNx`。freeze.synthetic.json/current.synthetic.json和reports为本轮明确合成Fixture；CLI成功输出verified/replay.json、replay.md、sources.json，退出0。另在tampered目录新建错误报告（不改原件），核对输出rejected，退出3并定位RESULT_JSON_MISMATCH。日志 `/private/tmp/algopilot-replay-demo-verified.log`；演示3个Node结束完整。没有生成虚假正式冻结。

最终工作区5修改、11新增，共16文件，0暂存/0删除；HEAD不变，未提交。

| 状态 | 文件 |
| --- | --- |
| 修改 | `README.md` |
| 修改 | `docs/M34_RESULTS.md` |
| 修改 | `docs/MILESTONES.md` |
| 修改 | `scripts/m34-results.ts` |
| 修改 | `scripts/test-offline-e2e.mjs` |
| 新增 | `docs/M34_REPLAY.md` |
| 新增 | `docs/M34_REPLAY_VERIFICATION.md` |
| 新增 | `scripts/check-offline.mjs` |
| 新增 | `scripts/m34-replay-core.ts` |
| 新增 | `scripts/m34-replay.mjs` |
| 新增 | `scripts/offline-audit-lifecycle.cjs` |
| 新增 | `scripts/offline-audit.ts` |
| 新增 | `tests/fixtures/m34-replay.ts` |
| 新增 | `tests/unit/m34-replay-cli.test.ts` |
| 新增 | `tests/unit/m34-replay.test.ts` |
| 新增 | `tests/unit/offline-audit.test.ts` |

m34-results.ts只增加只读内部证据接口；新增核心与CLI/测试/审计工具不进入src。Git核对src、原准备脚本、全部001–013、package/lock、原B3 guard和所有原模板无差异。未引入平行线上画像/推荐/数据库系统。

## 9. 安全、覆盖与分类

最终**正常受控验收批次**的生命周期覆盖完整：核心157/157、最终静态28/28、推荐10/10、E2E55/55、演示3/3。各组已收集的networkBlocked、dnsBlocked、credentialReadBlocked、externalHTTP、realDNS、realCredentialReads均0。E2E浏览器开始/结束12/12，5330个允许的loopback页面请求、denied=0；浏览器原生后台HTTP/DNS和进程外全机次数仍UNKNOWN。

**不能把上述数字扩展为全轮累计0。** 开发早期缺尾记录与预期强杀故障注入仍为UNKNOWN，未回填、补写、改名或删除历史失败批次；含它们的全轮完整网络/凭据累计次数UNKNOWN。故障单元的合成/强杀目录与正常审计严格分开，不把其模拟计数当实际请求证据。

| 事项 | 可支持的结论 |
| --- | --- |
| 主动真实模型/B4/付费API/生产数据库动作 | 本轮未执行；研究CLI无网络/模型/数据库模块；回归仅已有Mock/PGlite/loopback替身 |
| 主动真实Key读取 | 未执行；不读取真实.env*，命令环境白名单/空HOME，输入均合成 |
| 受监控最终正常批次HTTP/DNS/凭据计数 | 如上均0，覆盖限定为已登记运行时/页面路由 |
| 全轮或原生/未监控范围计数 | UNKNOWN，不以缺记录推出0 |
| 私人材料/源码外发 | 未执行，仅本机私有临时副本 |
| Provider/门禁/计费配置 | 未改，生产默认拒绝；研究hash/声明不提供免费资格或执行许可 |
| 托管迁移/部署/系统安装/代理改动/真实研究 | 均未执行 |
| Git发布/破坏性操作、历史删除 | 均未执行 |

最终功能FAIL=0；正常验收审计PASS。开发过程的导入/lint/类型错误、超时与审计缺尾FAIL如第7节保留，不声称历次运行均PASS，也不追溯提升旧轮验收状态。

工具一致性/独立统计在合成规则内PASS；真实冻结授权/实际同意/原始事实仍需独立核验。实际真人评审仍0/40、替代0/5、参与者0；没有收集真人材料或将自然成长当策略因果效果。原生环境/真实免费资格仍BLOCKED；原生20项、B4、托管JWT/迁移/部署、真实研究与教学/推荐效果NOT_RUN。

下一项可离线推进：围绕现有研究负责人流程，为冻结旁车增加外部只读存档摘要与实际盲评阶段资料的核对演练，先确认没有等价工具；不能自行制造可信时间戳或用户同意。正式研究仍须获准专用环境、真实JWT/隔离验收、参与者同意、预登记分配/共同条件与独立保存原件。Provider/B4授权与免费资格保持独立，不因工具PASS放行。

完成开发、验证、报告后停止，修改保留人工审查。
