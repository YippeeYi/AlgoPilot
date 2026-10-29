# M3.5 后续：核心训练连续性审查与验收

2026-10-28开始，2026-10-29收尾，Asia/Shanghai。本轮聚焦已有 M2.5/M3.5 工作台的数据保存与操作边界，不新设M3.6、不扩展M3.4研究体系。结果为本地合成功能验收，不代表真人满意度、真实教学效果或完整生产验收。

## 1. Git、路线及安全基线

实际开始 HEAD `0502a3b8799080bcdb330cb05fb3ccf69db234cb`，工作区干净；上一轮交接的6修改/8新增已提交，不再当作未提交文件。HEAD本轮保持不变，所有本轮修改保留人工审核，无commit/push/PR/reset/clean。

已核对AGENTS、CODEX_PROMPT、README、DEVELOPMENT_PLAN v3.4、MILESTONES、M35训练反馈/成长观测、M34人工工作流、M353免费门禁和复盘重试验收，以及对应组件、API、006上下文RPC和既有测试。CODEX_PROMPT默认提交要求由用户本轮“不提交”覆盖。计划仍要求题面/思路/历史/分级Tutor/独立Review、草稿与历史安全恢复；本轮是其可靠性修复，不宣称M4或M3.5真实验收完成。

仅本地源码、合成数据和离线测试。没有读取真实Key、访问生产数据库、生成模型内容、付费调用、B4、托管迁移/部署、参与者招募或真人研究。推荐权重、研究定义及历史迁移不改。

## 2. 核心路径审查

| 环节 | 实际源码/现有行为 | 本轮处置与验收边界 |
| --- | --- | --- |
| 画像→专项→推荐 | AbilityProfile/SkillInsights/GrowthInsights→focus/window链接；服务端按当前用户证据重新核对，保存目标不自动修改；UNKNOWN及样本门槛明确 | 保留实现；原画像、成长、专项、证据revision和推荐36项回归，不重写推荐算法 |
| 推荐→选择/跳过/训练 | Recommendations→来源RPC，开始和恢复区别，跳过不是失败；题目/理由/证据引用与已解过滤存在 | 保留；已有反馈E2E与新增“推荐→保存→完成→画像”路径验证来源不重复 |
| 工作台保存/完成 | 笔记和旧代码有串行DraftQueue；题面补充是独立输入，保存为历史笔记；完成会冻结编辑 | 复现3个相关缺口并修复，见下节 |
| Tutor | L0–L5/最高已看/双确认、竞赛/完成禁止、默认拒绝、历史与显式重试已有实现 | 只改调用前的工作台准备；不改Tutor组件/服务端。新增生产拒绝路径确认题面先保存、问题保留、拒绝不误报超时，仍能结束训练 |
| AC复盘 | sessionId/reviewId定位、不可变代码快照、笔记/追问/未知请求保护、缓存与显式重试 | 修复进入复盘链接的草稿保护；其余用既有Review单测与桌面/移动E2E回归，未改Review业务 |
| 成长分析 | 7/30/90/all、明确分母/来源、UNKNOWN、统计细项折叠与训练反馈刷新存在 | 新增完成后从复盘返回画像，核对新证据及偏好不变；原官方OK模拟、窗口/双用户隔离保留 |
| 移动显示 | 原三栏在移动端切换题面/笔记/教练；来源反馈在工作区上方 | 实际桌面/移动截图确认保存后笔记可读、无横向溢出；来源说明较长等保留为后续体验候选，不本轮改所有页面 |

没有将“源码能看到某行为”当作真实用户不满意的证据。返回推荐的快照保留、长页面信息层级、复盘按题目定位等尚需单独任务复现/用户验证，未虚构缺陷或宣称已修复。

## 3. 修复前复现证据与优先级

在私有副本安装当前新增测试，**仅副本中的Workspace替换为实际HEAD原文件**，不重置源工作区。真实运行三个断言，3 FAIL / 0 PASS，审计3/3结束、正常受监控计数0。日志 `/private/tmp/algopilot-continuity-confirmed-repro.log`。

| 优先级 | 复现操作 | HEAD实际结果 | 预期/本轮修复 |
| --- | --- | --- | --- |
| P0 数据可见性/冻结 | 填笔记、旧代码与题面补充，直接确认结束 | 只有笔记/代码flush和finish；未写context，完成后补充输入被隐藏，遗留dirty且无法继续保存 | 先保存所有必要草稿和题面，成功后才finish；失败保留输入、不完成 |
| P1 请求证据缺失 | 填新题面补充后直接发送Tutor问题 | 只有Tutor POST，未保存新上下文，模型端读到的证据不包含该补充 | 先写入原上下文RPC；失败不发Tutor POST，生产门禁仍默认拒绝 |
| P1 导航丢草稿 | 填题面后点击工作台“返回我的计划”或“AC后导入代码复盘” | 两条Link未触发既有algopilot-before-navigate，点击未取消 | 复用原事件保护；有草稿/未确认保存/在途操作阻止离开；干净状态直接导航 |

这三项涉及同一份训练草稿的生命周期，依赖已满足，无需模型、外部同步、新表或迁移。未选择主观视觉改造或新的功能模块。

## 4. 实现与状态规则

改动集中在Workspace：

- `prepareDrafts`在Tutor发送及finish之前保存笔记、旧代码和非空题面补充；仅有补充时调用原context RPC，无额外CF同步或模型调用。手动保存题面只涉及笔记/题面，不与无关代码草稿耦合；单独保存历史版本保持原意，不顺带多建一个上下文版本。
- 使用原`supplement_cf_context`、普通JWT/Auth/Zod/归属、revision及requestId；原始statement_snapshot不变。补充依然是笔记历史，不伪装为CF官方题面。已有历史不覆盖/删除。
- 上下文请求结果不明确时保留不可变content/revision/requestId。题面与笔记暂只读、停止对应自动保存/历史恢复，避免把另一份草稿混入未知提交；保留复制能力，显示“重试保存题面上下文”。代码草稿独立保留。
- 传输异常、损坏JSON、超时、5xx、408/429不表示“没有写入”；只由显式操作重试原编号，不自动补发。明确的400/401/403/404/405/409/413/415/422拒绝释放票据供用户修正；草稿不清空。
- 上下文传输新增15秒上限，超时仅表示结果未确认，不假定回滚；释放加载状态而保留原票据。不是延长测试超时、模型超时或自动重试。其他旧接口超时策略未全局重写。
- 成功后接纳服务器笔记revision、按thought.id合并历史，并清空已保存补充；finish使用本次返回的真实state_revision，避免React旧闭包误发旧状态版本。
- 工作台保存/版本/暂停继续/完成增加同步在途锁，重复点击不产生第二个上下文追加或finish请求。所有数据库权限/CAS仍由原服务端控制。
- 两条页面内Link复用既有导航事件；错误/在途时不跳走，保存后无需新增确认。正常结束结果仍由用户明确选择，自报与官方OK继续分栏。

票据和未保存文本仍只在当前页面内存，不新增localStorage/sessionStorage或私有草稿缓存。主动绕过离页警告、强制刷新/关闭或进程崩溃不能保证未保存内容恢复；已确认保存的内容可正常刷新恢复。不宣称浏览器跨进程exactly-once或原生数据库并发已验收。

## 5. 用户路径前后变化

以前：补充题面→必须先找到并点击保存→再请求教练/结束；漏保存会使用旧上下文或隐藏输入；工作台两条内链可能直接离开。

现在：补充题面→直接请求教练或确认结束→先安全保存→继续原操作。保存不确定时明确停下，原文可复制、原编号可重试；确认保存后再完成。完成→刷新看到笔记/唯一历史→点击AC复盘保留session关联→返回画像看到一条新的自报证据，保存目标不改变。

新增合成浏览器演练真实经过Next路由与本地SDK/HTTP替身：从推荐开始、两条内链阻止丢草稿、在服务端已追加后中断响应、保持未完成、原编号重试、只有一个历史版本、结束/刷新、复盘关联、画像回流；另一演练在保持生产拒绝工厂的3103端口验证保存题面后Tutor403、没有消息/自动重试、正常结束训练。每项同时在桌面和移动执行。没有真人效果、官方账号归属或源码一致性推断。

截图已实际查看：`/tmp/algopilot-continuity-m2-desktop.png`、`/tmp/algopilot-continuity-m2-mobile.png`。数据及笔记含SYNTHETIC标识；公开题目标题来自既有本地Fixture，不联网取题。截图只证明此次合成布局，无满意度/实际教学质量结论。

## 6. 测试设施兼容修正

发现旧HTTP替身在重放`supplement_cf_context`时，先用已更新笔记再次拼接上下文，再调用append，导致原ID重试错误PT409。原006 SQL已先查requestId并核对后缀，无此缺陷；既有PGlite用例也覆盖幂等/所有者/完成状态。仅修正测试替身，照原SQL先恢复旧行、验证后缀与CF题目、按字符数限制长度，再追加。没有修改006或任何历史迁移，没有用Mock宣称原生数据库PASS。

新增工作台单元18项：完整保存、Tutor前准备/门禁保留、导航、保存失败、提交后丢响应、明确拒绝后修正、阻止后续dispatch、笔记冲突、最新状态revision、同步防重、旧记录、空白输入、保存后正常导航、有界超时与安全错误、408/429、独立历史保存和独立代码草稿。原DraftQueue/Review/免费门禁与M3.4原断言全部保留。

## 7. 实际验收命令与结果

检查在排除.env*的私有副本中，以空HOME/白名单环境、原B3禁网/真实凭据读取guard运行，不直接在可能含真实环境的源目录执行Next构建。使用已有依赖，无安装/下载。

最终执行 `node scripts/check-offline.mjs`，在下述副本逐条运行：

| 实际命令 | 通过/失败 | 状态 |
| --- | --- | --- |
| npm run lint | 0错误/0警告 | PASS |
| npm run typecheck | 0类型错误 | PASS |
| npm run test -- tests/unit/workspace-continuity.test.tsx（另列原8个M3.4专项文件，--maxWorkers=1） | 新增18/0；整组146/0 | PASS |
| npm run test -- --maxWorkers=1 | 744/0，65文件 | PASS |
| npm run test:recommendations -- --maxWorkers=1 | 36/0 | PASS |
| npm run build（含postbuild） | 0构建错误 | PASS |
| git diff --check | 0空白错误 | PASS |

完整专项命令为 `npm run test -- tests/unit/workspace-continuity.test.tsx tests/unit/m34-review.test.ts tests/unit/m34-review-cli.test.ts tests/unit/m34-replay.test.ts tests/unit/m34-replay-cli.test.ts tests/unit/offline-audit.test.ts tests/unit/m34-results-validation.test.ts tests/unit/m34-results-pairing.test.ts tests/unit/m34-results-cli.test.ts --maxWorkers=1`。没有改原研究工具或删掉旧专项。

日志 `/private/tmp/algopilot-continuity-acceptance.log`，副本 `/private/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-replay-checks-pVpNRH/workspace`，旁边checks.json保留命令exitCode与审计。271份源码/脚本/测试/配置与最终功能文件逐字节一致；E2E副本的差异仅为既有私有Provider和13份spec的离线路由导入改写，逐项核对预期内容。核对记录 `/private/tmp/algopilot-continuity-source-checks.json`。

新增桌面/移动专项 `npm run test:e2e -- training-continuity.spec.ts` 已4/4、0失败，构建成功，Node47/47及browser4/4审计PASS；日志 `/private/tmp/algopilot-continuity-browser-target.log`，副本 `/private/tmp/algopilot-gate-e2e-7w4IHy/workspace`。完整E2E结果另列下方，不把专项替代完整回归。

最终 `npm run test:e2e` 完整68/68、0失败，buildExitCode=0、exitCode=0，审计PASS。日志 `/private/tmp/algopilot-continuity-browser-acceptance.log`；副本 `/private/tmp/algopilot-gate-e2e-9GfEpU/workspace`；收尾记录 `/private/tmp/algopilot-gate-e2e-9GfEpU/e2e-audits-wToZAk/checks.json`。两次完整运行均使用相同的macOS loopback沙箱、空HOME、两个worker、原断言、retries=0和原超时，无跳过或提高预算。

第一次完整E2E为64 PASS/4 FAIL，失败在m1-mobile题面加载/登录，以及m341-desktop替换Handle、skill-intelligence-desktop提示升级等待，日志 `/private/tmp/algopilot-continuity-browser-full.log`；原trace保留在 `/private/tmp/algopilot-gate-e2e-1b6NLz/workspace/test-results/`。两个独立worker场景同时在约51.17秒到514.03秒之间出现约463秒的时间断层。退出后检查源码/trace未得到支持修改认证或账号绑定业务的证据，原因记UNKNOWN，不能断言是系统休眠或归因于本轮代码。未修改这些测试/业务、未放宽30秒/5秒预算；原配置全量重跑45.2秒、68/68通过。成功不抹去失败历史，时间停顿的环境原因仍待调查。

复现和开发失败均保留：最初测试接线误等空消息的发送按钮启用、误用Testing Library的exact参数；修正测试后才进行原HEAD的三项真实失败复现。中间断言不支持asymmetric toHaveValue及等待保存结束的时序已改为精确值/确定的可编辑状态；未删除断言或提高预算。加入安全错误包装后触发ESLint preserve-caught-error，按规则保留cause、界面只用固定message，不关闭规则。早期739/742通过不代替最终版本验证。

## 8. 文件清单与未改范围

修改：

- `src/components/practice/workspace.tsx`：准备顺序、上下文票据恢复/编辑锁、有界传输、同步防重、状态revision与两条导航保护及说明。
- `tests/fixtures/supabase-http.mjs`：仅上下文RPC的本地契约替身修正。
- `playwright.config.ts`：新增两组各桌面/移动路径；原workers/retries/timeout不改变。
- `scripts/check-offline.mjs`：在原专项前追加工作台测试，仍完整运行旧专项/全量/推荐/build。
- `scripts/test-offline-e2e.mjs`：将新增测试纳入私有副本；原生产拒绝与loopback接线/审计准则不改。
- `README.md`、`docs/MILESTONES.md`：当前增量与验收链接。

新增：`tests/unit/workspace-continuity.test.tsx`、`tests/e2e/training-continuity.spec.ts`、本报告。

无依赖/锁文件、SQL迁移、推荐engine/权重、画像统计、M3.4定义/模板/结果工具、Provider/Prompt/Schema/免费门禁、B3五文件、生产Auth/RLS/配额/租约/缓存代码修改。

## 9. 安全、费用与外部访问审计

仅使用合成账户、合成问题文本/代码、已有离线元数据/提交录制。所有Next测试进程使用清空的白名单环境；E2E另在macOS网络沙箱中只许loopback，浏览器路由只许本机合成服务，禁止真实模型端点/托管Supabase。3103保持生产拒绝工厂，3102只在既有私有副本接测试Provider，无新增环境开关或生产放行。

最终完整静态/专项/全量/推荐/build批次173启动/173结束，issues=[]，六项计数（外部HTTP、真实DNS、真实凭据读取及三种拦截）全0。原HEAD复现3/3结束；新增E2E专项47/47 Node、4/4 browser结束，310次允许页面路由、拒绝0；第一次完整E2E虽功能4失败，审计仍59/59 Node、16/16 browser完整，5456次允许本机路由、拒绝0。功能测试成功和审计完整性分别报告，不相互覆盖。

最终完整E2E审计55/55 Node结束、12/12 browser结束，issues=[]；页面允许本机路由5671、拒绝0，六项受监控计数均0。功能退出与审计独立均PASS，原生浏览器HTTP/DNS计数仍UNKNOWN。

| 对象 | 本轮正常受监控范围 | 完整累计/未监控范围 |
| --- | --- | --- |
| 外部HTTP、真实DNS、真实Key读取 | 各0，逐份生命周期完整 | UNKNOWN（原生后台、历史缺失、故障注入不补零） |
| 真实模型、付费API、生产数据库访问 | 未主动执行；本地隔离应用外部网络路径0 | 未独立分项计量的全轮总数UNKNOWN，不声称远端账单/资格/权限已核验 |
| 私人材料发送 | 无主动外发，全部演练仅合成输入/本地文件 | 未监控原生后台累计UNKNOWN |

本轮审计未增加修复/计数回填；历史和合成SIGKILL故障目录保持独立，不能用正常批次覆盖UNKNOWN。

受监控计数与账户费用审计不同：这里没有实际免费资格证明、远端账单或生产JWT权限验证。测试源码中的fixture-*值为合成参数，不读取本机真实API Key。

未主动执行真实模型/付费调用、Key读取、生产库操作、私人材料外发、B4、托管迁移/部署或真实研究。正常受监控的外部HTTP/DNS/真实凭据读取可以报告0；未监控原生/后台层、历史缺失与故障注入的全轮累计仍UNKNOWN，不补写、不将缺失当0。真实模型/付费/生产DB分项未独立计量的全轮总数为UNKNOWN，不以离线功能PASS宣称远端账单、免费资格或生产权限已验证。

## 10. 结论与剩余事项

- PASS：三个明确复现问题的本地修复、18项工作台专项、原全量/推荐回归、构建、保存/恢复/画像联动；完整68项桌面/移动E2E、审计与diff检查全部PASS。
- FAIL历史保留：初始原HEAD复现3项失败、开发测试接线/断言/ESLint失败，以及首次完整浏览器64 PASS/4 FAIL；不将其改写成成功，不补造根因。
- BLOCKED：真实免费资格、真实Provider教学与费用核验、生产/托管独立验收条件。
- NOT_RUN：真实用户满意度/实际训练效果研究、真人评审、B4、原生数据库多连接及托管部署。

最终Git仍为本页HEAD；7修改、3新增，共10文件，全部保留未提交。

保留原生PostgreSQL20项NOT_RUN、B4 NOT_RUN、真实免费资格BLOCKED、011–013托管部署/完整验收NOT_RUN。原人工0/40、替代0/5、参与者0未变，不用合成测试增加计数。

后续优先级：

1. P1候选：专门复现浏览器后退/未发送Tutor草稿/在途模型操作跨页的保护边界；本轮只保证已验证的笔记/代码/题面及指定内链，不能据源码检查宣称所有导航情形都通过。
2. P2：验证从画像专项往返推荐时的结果保留需求；任何缓存仍须遵守用户与授权revision，不持久化过期私人推荐来绕过门禁。
3. P2：结合真实获准反馈审查移动端来源说明占屏、原始题面快照与补充笔记的定位、按题查找复盘；截图显示可读但较长，不直接推导真人使用困难，不本轮大改布局。

下一项可离线开发为第一项的确定性复现与最小草稿保护；真实模型、真人体验研究、原生/托管数据库或部署仍需相应条件与另行授权。本轮开发、验证和报告完成后停止。
