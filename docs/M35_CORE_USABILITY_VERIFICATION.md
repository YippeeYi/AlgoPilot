# M3.5 后续：核心产品全流程可用性审查与优化

2026-10-29，Asia/Shanghai。沿 DEVELOPMENT_PLAN v3.4 的推荐、题目分析、能力分析三条核心及上一轮连续性后续项，不新建M3.6、不扩展M3.4研究平台。本轮是可复现的本地功能/交互验收，不是正式真人可用性研究。

## 1. 实际基线与范围

实际 HEAD **`c9ea443bfb3602180bf7e03a0ebf7882cf9d8bb1`**，开始工作区干净。用户已提交上轮10修改/5新增；交接的 `8ed5f67…` 和未提交清单为历史状态。核对 README、AGENTS、DEVELOPMENT_PLAN、MILESTONES、[导航草稿报告](M35_NAVIGATION_DRAFT_VERIFICATION.md) 及相关组件、API、验证规则与离线测试设施，不重置或覆盖已有工作。

选择一个纵向切片：**可靠读取/编辑推荐目标 → 明确保存结果 → 失败时清除失效候选 → 显式重新推荐 → 继续训练、复盘与成长反馈**。只修改一个生产组件 `Recommendations`，不新增数据库、缓存、持久化或依赖。保留题库候选池、权重、历史排除、来源归因、requestId/CAS、证据revision及上一轮草稿保护。

## 2. 核心用户流程审查

| 环节 | 当前代码/实际验证 | 处置及边界 |
| --- | --- | --- |
| 账号与同步 | CfAccountSettings 独立Handle草稿、授权/绑定/同步状态；旧m33/m341桌面移动用例覆盖部分历史、未知响应、失败恢复 | 保留；只有本地HTTP合成同步，不声称真实CF/托管已验收 |
| 能力画像→专项 | AbilityProfile/SkillInsights/GrowthInsights窗口、UNKNOWN、样本与来源说明，focus/window进入原推荐 | 旧画像/成长用例回归；不新建能力分或自动调目标 |
| 推荐目标/候选 | 初始三个异步读取；保存和重取候选有两个独立成功条件；原表单可编辑、失败保留旧result | 本轮实际复现并修复下列三类问题 |
| 选题/跳过/恢复 | 来源收据→start/skip RPC，恢复旧训练不重复算新来源，失败时不伪造完成 | 新流程跳过后开始，同session来源仅1条 originated；原恢复/双用户用例保留 |
| 训练/Tutor | 笔记/题面准备、结束、幂等恢复；当前页未发送草稿、原生导航保护；默认拒绝独立于训练 | 新流程真实经3103生产拒绝工厂收到403，问题保留后显式清空，仍可正常完成 |
| AC复盘/历史 | 关联session、不可变代码快照、独立授权、保存编辑、缓存/显式重试和历史恢复 | 新流程保存快照，生成被门禁拒绝后仍可保存用户复盘；旧Review恢复全量/E2E回归 |
| 成长反馈 | 完成后按现有去重/窗口重算，官方与自报/AI分开，建议仍显式进入候选池 | 新流程回画像核对1道完成、自报解出、目标不变及新推荐排除该题 |
| 加载/失败/权限变化 | 固定错误、空数据布局、可重试按钮、服务端revision复核 | 新增推荐页401/403/409、初始双读失败、保存后部分失败、未知结果测试 |
| 移动端 | 原移动标签、响应式表单、折行与横向宽度检查 | Chromium Pixel7仿真与桌面真实浏览器；不等同实体设备或Safari |

未把源码中潜在的主观阅读负担当成已确认缺陷。返回推荐当前会重取证据；没有证明安全缓存的必要性前，不把它改为跨页持久缓存，避免绕过授权revision。完整工具链可运行不等于真人已觉得更容易使用。

## 3. 实际缺陷、优先级及复现证据

在修改生产组件前，向原HEAD安装新的离线spec（只增测试接线），实际运行 `npm run test:e2e -- recommendation-continuity.spec.ts`，**0 PASS / 6 FAIL**，每类桌面/移动各1。

| 优先级 | 确定性复现步骤 | 预期 | 实际HEAD结果/影响 |
| --- | --- | --- | --- |
| P1 输入被覆盖 | 已保存最低1300；阻塞首个推荐响应；页面输入1700；释放响应 | 未核对的占位目标不可编辑；提交中也不能悄悄改其输入 | 输入可编辑，1700随后被异步结果替成1300，用户意图丢失 |
| P1 错误候选上下文 | 改难度与复盘证据授权；保存目标200；下一次候选读取503 | 区分写入已成功与推荐未更新，旧候选不可操作，恢复不必再次保存 | 数据库目标已变，仍留下3张旧目标/旧授权快照卡片，只有失败信息 |
| P1 权限错误后仍显示旧候选 | 展示推荐后，显式重取返回409 LEARNING_EVIDENCE_CHANGED | 清除旧快照；只在重新核验成功后提供候选 | 仍保留3张旧卡片；不是服务端权限绕过，但界面仍显示未经当前revision确认的旧依据 |

选择它们因为涉及同一个推荐操作的输入、提交、重取与恢复，能以一个组件解决真实的状态混淆，且下游训练入口直接受影响。没有重写页面或改算法，也没有为了“返回保留”复用失效的私人候选。

复现日志 `/private/tmp/algopilot-product-repro.log`；副本 `/private/tmp/algopilot-gate-e2e-hQs3c9/workspace`，失败trace/error-context位于 `test-results/`。请求屏障等待真实本地响应，非随机延时；保留失败证据，不用通过结果覆盖历史。

## 4. 最小修复与前后差异

1. 推荐表单统一 fieldset：尚未成功读取目标或当前操作尚未结束时禁用所有字段，而非只禁保存按钮；界面说明状态未确认。保存后的输入不被随后编辑的另一份意图混淆。所有真实修改仍由用户明确保存。
2. `reload` 开始就清除旧result；保存可能改变复盘证据授权，写入前同样清除旧快照。失败时不会继续提供旧卡片及其证据入口；成功只能由当前服务端请求重新生成候选。401/403/409或失效专项拒绝也使旧候选失效；Auth失败后须重新读取当前目标再启用编辑。
3. 写入和后续revision/候选读取分开处理：只有写入200后才可能提示“目标已保存；推荐尚未更新，点击重新推荐恢复，无需再次保存目标”。保存本身失败/UNKNOWN不冒充已保存；原编号/请求体保留供明确重试。
4. 正常成功提示仍在推荐完成后显示，避免用户把“写入成功”误认为整个操作结束。未保存的目标与卡片所用的服务端目标不一致时，显示明确说明；“重新推荐”不会静默保存当前草稿。
5. 同步 inFlight ref 收敛同一事件批次的重复点击；原requestId及revision规则保留。成功刷新重置仅属于旧推荐轮次的本地skip标记，不删除任何训练/历史/来源记录。

修复后的失败恢复只需点一次“重新推荐”，不会重发目标写入；字段值、复盘证据选择以及已保存目标均按实际请求/服务端结果处理，不自动升难度。没有将CF提交、自报解出、跳过或模型拒绝混为训练失败。

## 5. 新增端到端操作路径

新spec使用3103，保持生产默认拒绝工厂，只用合成账号/输入：

设置读取（未关联也可训练）→空画像选择下一题→保存目标→改变难度/关闭复盘证据授权→保存成功、推荐503→旧卡片消失且显示可恢复的部分成功→只重新推荐（目标写入次数仍1）→跳过→进入同一推荐训练→补题面、发Tutor→免费资格门禁403，问题原文保留→显式清空→自报解出并完成→进入关联复盘→保存合成代码快照→生成再次被门禁403→保存用户编辑→返回成长画像。

实际断言：已保存难度/授权未被恢复动作改写；1道完成及1道自报解出；同训练只有1条新来源归因；历史已解题从下一轮候选排除；移动无横向溢出。设置阶段只读取状态，真实CF同步不属于该单条用例；整个回归中的m33/m341另用HTTP契约演练同步及恢复，不混同真实外部采集。

另外两条新场景覆盖加载/保存字段锁定，以及revision拒绝后的显式恢复；合计3×桌面/移动=6。单元15项覆盖初始未确认/备用读取、保存与重复提交、已确认写入后的两种读取失败、UNKNOWN同编号、CAS新编号、401/403/409清除、Auth恢复、未保存目标、专项scope及开始训练拒绝。

## 6. 测试命令与结果

实际使用既有 `node scripts/check-offline.mjs`：私有副本、排除.env、空HOME、白名单环境、Node离线预载，按序执行以下命令，不从源工作区加载真实配置。

| 命令 | 最终结果 |
| --- | --- |
| npm run lint | PASS，0警告 |
| npm run typecheck | PASS，0类型错误 |
| npm run test -- tests/unit/recommendation-continuity.test.tsx tests/unit/draft-queue.test.ts tests/unit/navigation-guard.test.ts tests/unit/tutor-draft.test.tsx tests/unit/workspace-continuity.test.tsx tests/unit/m34-review.test.ts tests/unit/m34-review-cli.test.ts tests/unit/m34-replay.test.ts tests/unit/m34-replay-cli.test.ts tests/unit/offline-audit.test.ts tests/unit/m34-results-validation.test.ts tests/unit/m34-results-pairing.test.ts tests/unit/m34-results-cli.test.ts --maxWorkers=1 | 190 PASS / 0 FAIL（含新增15项） |
| npm run test -- --maxWorkers=1 | 784 PASS / 0 FAIL，68文件 |
| npm run test:recommendations -- --maxWorkers=1 | 36 PASS / 0 FAIL，8文件 |
| npm run build（含postbuild） | PASS，0构建错误 |
| npm run test:e2e -- recommendation-continuity.spec.ts | 6 PASS / 0 FAIL；最终截图断言另纳入完整回归 |
| npm run test:e2e | 94 PASS / 0 FAIL，57.7秒，含最终新增6项 |
| git diff --check | PASS，0空白错误 |

保留旧断言和原workers、retries=0及超时。新的单元定位误用了Testing Library不支持的exact选项，初次typecheck失败；移除不合法选项，不删断言。首次修复后浏览器2 PASS/4 FAIL，暴露新增select标签定位不匹配，以及过早成功提示使“目标已保存”先于候选就绪；改正标签定位及产品提示时序后6/6通过。日志 `/private/tmp/algopilot-product-target.log`、`/private/tmp/algopilot-product-browser-target.log`、`/private/tmp/algopilot-product-browser-target-2.log` 均保留。

最终静态/单元/推荐/构建日志 `/private/tmp/algopilot-product-acceptance.log`；私有副本 `/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-replay-checks-Invwdz/workspace`，同级 `checks.json` 含六个命令exitCode=0及审计。全量与推荐批次分别约110.7/78.0秒，既有M3.4冷却重放保留；没有减少并发或放宽原测试配置，命令沿用此前验收的 `--maxWorkers=1`。

最终完整E2E日志 `/private/tmp/algopilot-product-browser-acceptance.log`；副本 `/private/tmp/algopilot-gate-e2e-iU12fs/workspace`，收尾 `/private/tmp/algopilot-gate-e2e-iU12fs/e2e-audits-IhxGWo/checks.json`，buildExitCode=0、exitCode=0。全部旧88项及新增6项通过；两组独立新流程分别约4.8/5.1秒。未再次出现旧463秒停顿，不据此解释其根因。

已查看 `/private/tmp/algopilot-recommendation-recovery-m2-desktop.png` 与 `/private/tmp/algopilot-recommendation-recovery-m2-mobile.png`：1800目标与关闭的证据授权保留，旧卡片消失，失败和已保存提示分开，重新推荐入口可见。桌面1440×1000、Pixel7移动仿真均无横向溢出；完整训练返回画像截图另存 `algopilot-product-continuity-m2-*.png`。不据截图推断真实用户满意度。

276份功能源码/脚本/测试/配置与最终静态副本逐字节相同；E2E仅有既有15份spec路由导入和私有Provider的预期改写，无额外差异。核对记录 `/private/tmp/algopilot-product-source-checks.json`；文档收尾不修改功能文件。临时文件可能随本机清理而消失，本报告保留稳定的定义、结果及重跑命令。

## 7. 时间停顿与生命周期复核

上一轮报告所述更早完整E2E64 PASS/4 FAIL、约463秒时间断层、原配置重跑通过仍保留，根因 **UNKNOWN**。本轮不改导航监听、队列、Tutor生命周期或测试预算；旧导航20项及StrictMode/迟到响应断言随完整回归执行。没有证据将旧停顿归咎于环境、休眠或本轮推荐代码。

推荐输入和请求屏障有具体观察点，不用随机sleep。既有M3.4响应重放保留真实3秒槽与30秒冷却，其正常等待另按用例日志记录，不冒充复现旧停顿。当前测试通过不能解释此前未知失败。

## 8. 文件清单与兼容性

修改6个：

- `src/components/learning/recommendations.tsx`：唯一生产变更；输入锁、失效快照清理、部分成功、显式恢复、同步防重。
- `playwright.config.ts`：新spec纳入原桌面/移动项目。
- `scripts/check-offline.mjs`：在原175项前加入新专项。
- `scripts/test-offline-e2e.mjs`：私有副本补新测试文件。
- `README.md`、`docs/MILESTONES.md`：增量与验收链接。

新增3个：`tests/unit/recommendation-continuity.test.tsx`、`tests/e2e/recommendation-continuity.spec.ts`、本报告。最终共9文件，均留未提交。

server/API/数据库/RLS/SQL迁移、推荐engine/权重/目标计算、M3.4定义与冻结工具、Provider/Prompt/Schema/免费门禁、B3、依赖与锁文件、原导航草稿组件全部不改。没有增加缓存或删除历史；结果只在组件内存中失效，下游仍由原服务端归属/证据revision及幂等规则控制。

## 9. 安全、费用与审计

禁止事项均未主动执行：真实模型、付费服务、真实Key读取、B4、生产DB、托管迁移/部署、私人材料外发、真人采集、commit/push/PR。仅合成身份/题面/代码/评审输入及既有离线元数据。3102只在既有私有副本接HTTP Fixture，源工厂默认拒绝；新主流程3103实际验证Tutor和Review拒绝，未放行生产。

浏览器测试通过系统沙箱仅允许loopback，关闭后台联网开关、禁service worker，页面路由只许本机；Node预载拦外网/DNS/真实凭据路径。collector校验每份启动/结束，不把未发布/缺失记录当零，故障注入目录独立。

| 指标 | 受监控离线范围 | 未监控/整轮累计 |
| --- | --- | --- |
| 外部HTTP、真实DNS、真实Key读取 | 已完整收尾的正常批次均0 | UNKNOWN：原生浏览器后台、未插桩准备/工具及历史缺失不补零 |
| 真实模型、付费API、生产DB | 无主动执行；隔离应用只许本机，外部路径0 | 未独立分项计量的累计UNKNOWN，不声称账单或真实免费资格已核验 |
| 私人材料发送 | 无主动外发；全部合成输入/本地保存 | 原生后台累计UNKNOWN |

| 批次 | Node启动/结束 | browser启动/结束 | loopback页面允许/拒绝 | 审计与功能分别记录 |
| --- | --- | --- | --- | --- |
| HEAD真实复现 | 49/49 | 6/6 | 248/0 | 审计PASS；功能6 FAIL |
| 开发静态/190专项 | 40/40 | 不适用 | 不适用 | 审计PASS；typecheck FAIL，随后修复 |
| 修复后6项浏览器专项 | 47/47 | 4/4 | 328/0 | 审计/功能PASS |
| 最终静态/专项/全量/推荐/build | 180/180 | 不适用 | 不适用 | 审计/功能PASS |
| 最终完整94项E2E | 55/55 | 12/12 | 7500/0 | 审计/功能PASS |

上述列出的正常批次issues=[]，六项受监控计数均0（networkBlocked、dnsBlocked、credentialReadBlocked、externalHTTP、realDNS、realCredentialReads）。未把未监控原生浏览器HTTP/DNS、故障注入或历史缺失记为零，不以测试PASS声称远端账单或免费资格已经验证。没有新增审计补写或绕过机制。

## 10. 结论、剩余问题及下一步

- **PASS**：三类确认缺陷的最小本地修复；15新增单元与190专项、784全量、36推荐、lint/typecheck/build、94完整Chromium桌面/移动E2E、源文件一致性、审计与diff检查。既有导航/Tutor草稿、权限/来源/历史排除和Review恢复均未回归。
- **FAIL历史**：原HEAD6项失败、开发typecheck错误和首次修复后4项浏览器失败保留；最终0失败。旧未知停顿及4项历史失败未抹去。
- **BLOCKED**：真实免费资格及依赖专用环境/当前授权的托管真实验收。
- **NOT_RUN**：下列浏览器/原生数据库/真实服务与真人研究；不以合成通过替代。

最终HEAD仍为本报告开头值；6修改/3新增，共9文件，未commit/push/PR。真人满意度、教学/推荐效果未验证；本地合成可操作性与真实用户收益是不同结论。

后续候选：

1. P1待专门复现：Review目前仍使用独立的beforeunload/内链预检，未共用Workspace的Navigation API边界；检查其原生后退与未保存追问/编辑保护，不据本轮成功宣称覆盖全部Review导航。
2. P2待验证：推荐和画像往返时用户需要保留哪些选择/滚动上下文；先用合成流程/获准反馈复现，避免用长期缓存绕过新证据及授权revision。当前整轮刷新采用清除旧卡片后重取，优先保证依据有效，未另实现布局位置恢复。
3. P2待真人验证：移动长页面中来源/局限说明的阅读成本、按题找历史训练/复盘；本轮不把审美意见当作缺陷，不修改所有页面。

Safari/WebKit/Firefox、硬件导航/实体移动设备、原生PostgreSQL20项、B4、011–013托管迁移/托管验收、真实训练效果仍保持实际 **NOT_RUN**；真实免费资格 **BLOCKED**。不下载runtime，不以PGlite/Mock或Chromium结果替代。人工评审0/40、替代0/5、真实参与者0不变。

本轮完成后停止，不自动进入上述后续或真实服务验收。
