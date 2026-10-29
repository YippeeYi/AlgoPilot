# M3.5 后续：浏览器导航与 Tutor 未发送草稿验收

日期：2026-10-29，Asia/Shanghai。本轮是 DEVELOPMENT_PLAN v3.4 中既有工作台/草稿/历史恢复的可靠性增量，沿 [上一轮连续性验收](M35_TRAINING_CONTINUITY_VERIFICATION.md) 的 P1 后续项，不新设里程碑、不扩展研究体系。

## 1. 实际基线与工作区

实际 HEAD：`8ed5f67a046b9470f3968ea607b9e28ddbca2b5d`，初始工作区干净。交接的 `0502a3b…` 及7修改/3新增已经成为历史，不再作为本轮未提交状态。保留原实现/历史验收；本轮不 commit、push、PR、reset 或 clean。

已核对 AGENTS、README、DEVELOPMENT_PLAN、MILESTONES、核心训练连续性报告、Workspace、Tutor、DraftQueue、AppShell/训练反馈的导航预检及既有单元/浏览器测试。服务端默认拒绝、研究定义、推荐权重、权限/RPC、迁移、依赖均不修改。

## 2. 原覆盖边界与实际复现

原 Workspace 有笔记/代码/题面/忙碌状态的 `beforeunload` 和 `algopilot-before-navigate`，指定 Link 已接事件。其局限是：原生同文档历史遍历不触发该自定义事件；Tutor 输入属于子组件状态，父组件未读取，因此该输入不参与上述两种判断。

先在真实工作台的 Chromium 桌面/移动运行两个新增用例，复现4个失败；另保留当前 HEAD 私有副本重放证据：只在副本恢复 HEAD 的 Workspace/Tutor/DraftQueue 和原单测，不重置源工作区。相同两个用例再次 **0 PASS / 4 FAIL**：

| 操作 | HEAD 实际行为 | 修复后行为 |
| --- | --- | --- |
| Tutor 输入非空→原生 `navigation.back()`→取消 | 未出现警告，遍历返回 committed，离开工作台 | 出现风险确认，返回 cancelled；URL、历史位置、内容和焦点保留 |
| Tutor 输入非空→AppShell 能力画像 Link→取消 | 对话数0，跳转离开 | 对话数1，取消保持工作台；确认后进入原目标 |

重放命令：私有副本中 `npm run test:e2e -- navigation-drafts.spec.ts --grep 'native back cancellation|ordinary App Router link'`。日志 `/private/tmp/algopilot-navigation-repro.log`；运行副本 `/private/tmp/algopilot-gate-e2e-59Tt39/workspace`，trace/error-context 在其 `test-results/`。Node47/47、browser4/4审计完整；功能失败与审计PASS分别记录。

第一次重建副本的接线因临时Git索引包含 node_modules 符号链接出现 ENOTSUP，测试未启动；仅修正临时副本索引后重放。未改用户仓库索引、依赖或测试标准。最早开发曾有 cleanup ref 自增的 ESLint 警告，已改为捕获 effect epoch；不关闭规则。

## 3. Tutor 输入状态与隐私策略

| 状态 | 本轮处理 |
| --- | --- |
| 空输入 | 不单独构成风险；其他未保存内容照常判断 |
| 非空未发送 | 普通输入仅更新组件内存，纳入导航保护；无关重渲染及移动标签切换保留 |
| 提交准备/提交中 | 同步 inFlight 标记，阻止重复提交；取消离开保持原操作 |
| 成功发送 | 清空对应输入及请求票据；正式历史只来自原服务端响应 |
| 门禁明确拒绝/已结束失败 | 保留可编辑原文，清除已结束票据；不自动重试、不误报超时 |
| 网络失败/UNKNOWN | 保留原文及不可变原请求体/ID，输入只读；仅显式查询/重试原请求 |
| 显式清空 | 清空本地未发送文本；忙碌或有未知票据时禁用，不借此遗失原编号 |
| 切换训练/重新进入 | Tutor 内部按 sessionId 分实例，旧异步结果不覆盖新任务；新页面只加载正式历史，不自动生成 |

不使用 localStorage、sessionStorage、IndexedDB、URL、分析事件、日志或新远端表保存 Tutor 原文。风险 getter 只向父组件暴露 unsent/submitting/uncertain 三个布尔值；确认文案只含固定风险标签。没有新持久化范围、期限或清理任务；组件释放后不保证内存恢复。返回缓存视图可能保留内存，不能据此承诺持久恢复。

**跨刷新持久恢复未实现。** 取消原生警告后仍在原文档可继续编辑；确认刷新后新的文档输入为空，正式历史独立恢复。对确需保留的未发送文字，界面提示先复制。确认离开不代表发送或重试授权。

## 4. 统一导航实现

新增 `installNavigationGuard`，Workspace effect 只安装一组监听器，通过实时 getter 读取：笔记/代码的当前值、已确认值及 saving；题面输入和 UNKNOWN 票据；训练保存/状态更新；Tutor 的三个状态。任何一项残留都会继续警告，不因另一项保存成功放行。

- 同源、当前标签的 Link：document capture 在 Next Link 处理前询问；确认通过原有预检一次，取消恢复最近的输入焦点。新标签/下载/仅锚点滚动不误拦；外部文档交给原生警告。
- 原生同文档 back/forward：仅在 Navigation API 的 `traverse`、sameDocument、canIntercept、cancelable 均满足时询问；取消在提交历史位置前 preventDefault。确认后让浏览器执行原遍历。
- 不拦截已经发生的 pushState/replaceState，不覆盖 router/history，不插入哨兵条目，不靠 popstate 后反向跳回，不形成无限后退栈。
- reload、关闭标签、地址栏输入/跨文档导航：统一 `beforeunload`，提示内容与是否显示由浏览器决定；不承诺自定义警告文字。
- 无法显示自定义确认时，同文档可取消事件默认拒绝。组件卸载移除全部监听器及点击决策定时器；StrictMode重新安装不累积监听。

现有 Workspace/训练反馈/AppShell 的明确预检仍保留。**任意其他代码直接调用原始 router.push/replace、没有 Link 或预检的程序跳转，不在自动拦截承诺内**；Next可能先更新React再写历史，不能靠阻断该历史写入安全回滚。源工作台的实际离开 Link 已通过测试。服务端强制重定向、浏览器崩溃/OS杀进程、未获用户激活的 beforeunload 不提供完整保护保证。

## 5. 保存、卸载与异步隔离

DraftQueue 增加 activate 与既有 dispose 配套：卸载后已发出的请求可以结算本地 revision，但不继续发送队列里后续内容；StrictMode重新挂载仍可保存。响应仍不把旧文本覆盖新编辑器。

Workspace 为准备、上下文保存、历史版本、完成/暂停操作捕获 lifecycle epoch；卸载后不继续追加上下文、完成或更新新页面。Tutor 在 await prepare 之后重新核对 generation，任务已切换时不构造/发送旧请求；已发出的响应不能改新任务输入。服务器已有请求不承诺取消，原有 requestId/revision、UNKNOWN原编号恢复规则不改。

浏览器竞态用例用显式请求屏障：保存A挂起→编辑B→Tutor等待准备→确认原生后退→释放A并等真实响应结束→前进。实际仅A一次草稿写入、Tutor POST为0；B不再排出。没有靠 sleep 或放宽超时制造通过。

## 6. 验收矩阵

| 要求 | 证据与边界 |
| --- | --- |
| 无草稿后退 | 实际 page.goBack，干净状态无确认 |
| 笔记/代码未确认保存 | 各自挂起保存时原生后退取消；放行响应后干净后退 |
| Tutor未发送/多种风险 | 未发送、笔记+Tutor组合；保存笔记后Tutor仍继续拦截 |
| 取消/确认/连续后退 | 取消两次、焦点与文本保留，确认真正进入sessions，history.length不变 |
| 原生前进 | 能力画像→后退工作台→新草稿→原生前进取消/确认；路径与aria-current一致 |
| 移动视图切换 | AI→笔记→AI，未发送内容不丢失 |
| 刷新/直接URL | 实际 beforeunload，取消保留；确认刷新后新文档为空 |
| 标签关闭 | page.close(runBeforeUnload:true) 取消仍打开，再确认真实关闭 |
| 失败与UNKNOWN | 本地门禁单测及原生产拒绝E2E；丢失Tutor响应后原ID显式恢复缓存 |
| 保存UNKNOWN | context503后取消后退，原体/原编号重试成功后恢复正常导航 |
| 竞态/切换训练/迟到结果 | 显式请求屏障、组件重挂载/卸载、旧响应不覆盖新草稿 |
| 已发送/显式清空 | 单测及浏览器成功恢复后不再拦截；输入不写正式历史 |
| 原Review跳转/训练结束 | 旧连续性E2E与Review恢复专项保留，完整回归验收单列 |

新增单元：导航13、Tutor8、队列2、工作台2，共25。导航单测是假DOM策略测试，不能替代真实浏览器；浏览器专项新增10场景×桌面/移动=20。通过实际 Navigation API 历史遍历、page.goBack/goForward、reload和close验收，不派发伪造popstate、不把Link点击冒充原生后退。

## 7. 运行命令与结果

所有检查在既有脚本的私有临时副本中执行，排除 `.env*`、空HOME、白名单环境、Node离线预载。浏览器再用 macOS sandbox-exec 仅允许 loopback、禁service worker/外部页面路由、关闭后台联网开关；不使用用户浏览器资料。

静态/单元入口 `node scripts/check-offline.mjs` 按顺序实际执行：

| 命令 | 结果 |
| --- | --- |
| npm run lint | PASS，0警告 |
| npm run typecheck | PASS，0类型错误 |
| npm run test -- tests/unit/draft-queue.test.ts tests/unit/navigation-guard.test.ts tests/unit/tutor-draft.test.tsx tests/unit/workspace-continuity.test.tsx tests/unit/m34-review.test.ts tests/unit/m34-review-cli.test.ts tests/unit/m34-replay.test.ts tests/unit/m34-replay-cli.test.ts tests/unit/offline-audit.test.ts tests/unit/m34-results-validation.test.ts tests/unit/m34-results-pairing.test.ts tests/unit/m34-results-cli.test.ts --maxWorkers=1 | 175 PASS / 0 FAIL |
| npm run test -- --maxWorkers=1 | 769 PASS / 0 FAIL，67文件 |
| npm run test:recommendations -- --maxWorkers=1 | 36 PASS / 0 FAIL，8文件 |
| npm run build（含postbuild） | PASS，0构建错误 |
| npm run test:e2e -- navigation-drafts.spec.ts | 20 PASS / 0 FAIL（之后补了路径状态断言）；前进状态追加专项2/2 PASS |
| npm run test:e2e | 88 PASS / 0 FAIL，53.2秒；含最终20项新导航场景 |
| git diff --check | PASS，0空白错误 |

早期 `node scripts/check-offline.mjs --targeted`：lint/typecheck/175专项均PASS，Node39/39审计完整。18项初版浏览器测试、20项扩展及新增前进状态2项均无失败；旧断言、两个worker、retries=0、原30秒/5秒预算不变。没有跳过旧测试、修改推荐参数或放宽任何安全检查。

最终静态/专项/全量/推荐/build日志 `/private/tmp/algopilot-navigation-acceptance.log`；副本 `/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-replay-checks-VngFgf/workspace`，同级 `checks.json` 保存全部命令、exitCode=0与审计。工作台/队列/导航/Tutor专项47项、旧M3.4专项128项合计175；全量769比HEAD增加25。

20项浏览器专项日志 `/private/tmp/algopilot-navigation-browser-final-target.log`，副本 `/private/tmp/algopilot-gate-e2e-3YjvJX/workspace`。之后新增的路径/aria-current断言单独2/2通过，日志 `/private/tmp/algopilot-navigation-forward-state.log`；最终完整88项亦包含该断言，不以较早专项替代完整回归。

最终完整E2E日志 `/private/tmp/algopilot-navigation-browser-acceptance.log`；副本 `/private/tmp/algopilot-gate-e2e-OZbUyX/workspace`，收尾 `/private/tmp/algopilot-gate-e2e-OZbUyX/e2e-audits-N6X70O/checks.json`，buildExitCode=0、exitCode=0。截图 `/private/tmp/algopilot-navigation-m2-desktop.png`、`/private/tmp/algopilot-navigation-m2-mobile.png` 已查看，输入、清空按钮和隐私说明可见；不推导真人满意度。曾观察导航背景高亮，额外断言确认实际pathname/aria-current一致，未据视觉悬停状态修改路由。

274份功能源码/脚本/测试/配置与最终静态副本逐字节一致；与最终E2E副本仅有既有私有Provider及14份spec离线路由导入的预期改写，无意外差异。核对记录 `/private/tmp/algopilot-navigation-source-checks.json`。文档收尾不改变功能文件；这些临时日志随本机临时目录清理可能消失，稳定结论及命令留在本报告。

## 8. 上一轮时间停顿调查

保留上一轮报告首轮完整E2E64 PASS/4 FAIL、约463秒共同时间断层、原配置重跑68/68 PASS的事实，不修改原报告。当前检查清理监听器、定时器、组件生命周期与等待prepare的Promise，并增加StrictMode与确定性竞态回归；未取得把旧停顿归因于它们的复现证据，根因仍 **UNKNOWN**。

本轮全量前段约64秒来自既有 m34-acceptance 响应重放（真实3秒槽/30秒冷却），有具体用例输出，不代表再次复现旧463秒停顿。不提高预算、不以当前通过抹去历史失败。浏览器关闭取消、goBack/forward等用例采用可观察的实际对话/页面/响应同步点；不为被取消的导航等待永远不会出现的新文档load事件。

## 9. 浏览器及持久化限制

本机现有 Playwright1.64.0/Chromium缓存（chromium-1248及headless-1248），桌面1440×1000、Pixel7移动仿真。不是实体安卓/Chrome全版本覆盖。WebKit/Safari/Firefox runtime未在现有缓存中，未下载，测试 **NOT_RUN**；真实鼠标侧键/触控板手势、移动OS杀进程、BFCache跨文档恢复专项也NOT_RUN。

当前页面内保留、浏览器原生导航通过、跨刷新持久恢复、所有浏览器通过是不同结论。本轮只验证前两者的指定范围；第三项未实现，第四项未验收。不支持可取消同文档Navigation API的浏览器仍有Link预检和原生beforeunload，但同文档后退无法保证被拦截，UI已说明，不能报告全浏览器无损保护。

## 10. 文件清单

修改：

- `src/components/practice/workspace.tsx`：统一实时风险、安装/清理监听、异步epoch与说明。
- `src/components/practice/tutor-conversation.tsx`：只读风险getter、按任务隔离、prepare后复核、显式清空及隐私说明。
- `src/features/sessions/draft-queue.ts`：StrictMode重新启用与卸载停止队列的配套。
- `tests/unit/workspace-continuity.test.tsx`、`tests/unit/draft-queue.test.ts`：保留原断言，补生命周期与竞态。
- `playwright.config.ts`：新增spec纳入原桌面/移动项目，原预算不变。
- `scripts/check-offline.mjs`、`scripts/test-offline-e2e.mjs`：原入口增加新专项/私有副本文件，不改生产接线。
- `README.md`、`docs/MILESTONES.md`：本轮状态和验收链接。

新增：`src/features/sessions/navigation-guard.ts`、`tests/unit/navigation-guard.test.ts`、`tests/unit/tutor-draft.test.tsx`、`tests/e2e/navigation-drafts.spec.ts`、本报告。

共10修改/5新增，15文件，全部未提交。无server、SQL/迁移、Provider/Prompt/Schema、门禁、B3、推荐engine、研究工具/定义、依赖/锁文件变更。

## 11. 安全、费用与审计

仅合成身份、题面及输入；复用已有录制元数据，不重新访问CF。源生产工厂继续默认拒绝。3102的HTTP Fixture Provider仍只在既有E2E私有副本接线；3103保留生产拒绝工厂。没有为保护草稿新增模型、环境放行、数据发送或持久化路径。

| 对象 | 可确认的受监控离线执行范围 | 整轮未监控/累计范围 |
| --- | --- | --- |
| 外部HTTP、真实DNS、真实Key读取 | 正常已收尾批次均0；具体审计收尾另列 | UNKNOWN：原生浏览器后台/未插桩进程/历史缺失不能补零 |
| 真实模型请求、付费API、生产DB | 未主动执行；受控应用只许loopback、外部路径0 | UNKNOWN：未独立分项计量完整累计，不宣称账单/资格/权限已核验 |
| 私人材料外发 | 无主动发送；测试只有本地合成材料 | 未监控原生后台累计UNKNOWN |

每份预载启动/结束记录均由既有collector校验；损坏/缺失/未发布保持FAIL/UNKNOWN。合成SIGKILL故障注入目录与正常批次分开，不回填计数。原生浏览器HTTP/DNS仍UNKNOWN，路由层允许的loopback计数不能冒充全进程网络审计。

| 批次 | Node启动/结束 | browser启动/结束 | 页面loopback允许/拒绝 | 审计 |
| --- | --- | --- | --- | --- |
| HEAD四项失败复现 | 47/47 | 4/4 | 266/0 | PASS（功能4 FAIL） |
| 最终静态/专项/全量/推荐/build | 178/178 | 不适用 | 不适用 | PASS |
| 20项浏览器专项 | 47/47 | 4/4 | 1527/0 | PASS |
| 最终完整88项E2E | 55/55 | 12/12 | 7192/0 | PASS |

上述正常批次 issues=[]，六项受监控计数（networkBlocked、dnsBlocked、credentialReadBlocked、externalHTTP、realDNS、realCredentialReads）均0。表中只对列出的已收尾范围报0；不把早期未插桩的能力探针/副本准备、原生后台和历史缺失补成零。故障注入只验证拒绝/UNKNOWN传播，不能作为真实外访或费用证据。真实模型、付费调用、生产数据库的全轮独立计量仍UNKNOWN，没有执行这些操作的授权或主动请求。

## 12. 结论与下一步

- **PASS**：两类实际复现缺陷的本地修复、统一风险读取、当前页面Tutor草稿保留、生命周期防迟到、47项工作台相关单元、完整175专项、769全量、36推荐、build、20新场景与完整88项真实Chromium桌面/移动E2E、正常批次审计和diff检查。
- **FAIL历史**：修复前4项原HEAD真实浏览器失败、早期私有副本接线失败/开发lint警告保留；最终功能检查0失败。上一轮4项失败与未知停顿仍保留其原状态。
- **BLOCKED**：真实免费资格及依赖专用环境/当前授权的托管真实验收条件。
- **NOT_RUN/未实现**：Safari/WebKit/Firefox、实体设备与硬件手势/OS杀进程、BFCache专项；跨刷新Tutor持久恢复未实现；B4、原生PostgreSQL20项、011–013托管迁移/完整托管验收、真人评审与真实用户效果NOT_RUN。人工0/40、替代0/5、参与者0不变。

最终HEAD仍为本报告开头值；工作区10修改/5新增，全部留供人工审查。既有PGlite/Mock回归或本轮UI成功都不代表原生多连接/托管部署或生产权限验证通过。合成导航通过也不等于真人满意度或训练效果已提升。

下一项可独立离线开发：按上一轮P2候选，复现画像专项→推荐→训练→返回时的结果保留需求；只有复现后才选择最小修复，继续保留授权revision、历史排除与用户隔离，不自动改权重/目标。跨刷新Tutor持久化需先明确隐私、账户范围和有效期，不把它混入本轮页面内保护。真实浏览器手势/Safari兼容及真人体验研究须分别满足环境/授权条件。

完成本轮后停止，不进入B4、研究采集、迁移或部署。
