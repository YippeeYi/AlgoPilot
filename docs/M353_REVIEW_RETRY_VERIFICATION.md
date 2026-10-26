# M3.5.3 离线复盘重试恢复验收

2026-10-26 启动、2026-10-27 收尾，Asia/Shanghai。范围为既有 AC 复盘的请求幂等与失败恢复。本轮不执行 B4、真实模型请求、生产数据库访问、托管迁移、部署或 Git commit/push/PR。**本地切片 PASS：394/394 全量、36/36 推荐、54/54 浏览器；最终失败 0。** 离线通过不等于托管或教学质量通过，B4 仍 NOT_RUN。

## 1. 仓库核对与路线恢复

实际开始 HEAD 为 `a257716d61e14243635c876a3182af8c7c68a307`，工作区干净。它的父提交为交接给出的 `e11f54794d02374131d4020e79f837a3bab30119`；`a257716` 恰好提交了 B3 报告所列五文件，内容与工作树一致。因此“e11f547 + 五文件未提交”是历史报告时点，不是本轮实际状态。五文件未修改、删除或覆盖，无 reset/clean。本轮结束 HEAD 保持不变，新增变更保留人工审核。

先读 B3 报告，再核对 README、AGENTS、DEVELOPMENT_PLAN v3.4、CODEX_PROMPT、MILESTONES，以及 M3/M32/M33/M34/M35/M352/M353 代码和验收记录。

| 分类 | 可核实的阶段状态 |
| --- | --- |
| 已实现且有本地验收 | M0–M3.3 的训练/分级 Tutor/复盘/计划/推荐/画像/官方证据；M352 可靠性修复；B3 离线探针。已有功能继续回归，未重建 |
| 部分真实验收 | M35 单用户官方同步、撤销/恢复、候选过滤/画像来源、官方与自报同题去重；有效 001–010 结构已实核。真实迁移账本缺失仍独立记录 |
| 历史模型结果 | 用户提供过 1 例混合质量反馈；新版 M353 A/A2 均传输超时，无可评审输出。不能将历史一次成功或 Mock 作为新版质量通过 |
| 外部阻塞 | B4 无新授权；项目免费资格、真实远端可用性/认证/网络/旧请求费用未知。托管双用户/跨实例/账本治理、真人推荐 0/40、替代题 0/5 均未补齐 |
| 尚未实现/未启动 | M4 知识沉淀与复习等后续范围；未为绕过 B4 扩展产品 |
| 已被更新决策替代 | CODEX_PROMPT 的默认提交要求被本轮“不 commit”明确覆盖；M353 历史 USD 1.10 提案/许可不能授权新请求，长期仅免费模型、无收费备用/回退。真实模型调用本轮全部禁止 |

README 的 M3.3 交付摘要、开发计划的“M3.4 当前”和 M35 后续实核属于不同历史时点；本轮按较新的可核实记录分栏，不将旧 NOT_RUN 全部抹掉或将整个 M3.5 宣告通过。B3 不再做重复设计审查，只在全量测试中回归。

## 2. 任务依据、前置与验收标准

顺序靠前的未过门槛首先是 M35/M353 真实复盘质量与 B4；它们需要当前阶段外部授权、免费资格和真实用户评价，本轮不可执行。可并行补齐的既有任务为 DEVELOPMENT_PLAN“深度复盘/数据与安全”的幂等、保留历史与刷新恢复，以及 M352 的失败保留草稿/历史和不自动重试要求。

代码确认两个具体缺口：

1. `ReviewWorkspace.generate()` 每次点击创建新 requestId；第一次已提交结果但响应丢失时，再点击可能再次生成。React busy 尚未渲染前也缺同步防重锁。
2. 旧 `review_reserve` 在同编号分支先返回 AP004；即使 pending 租约已过期，仍永远“处理中”，到不了后面的过期清理。

前置依赖已满足：已有普通 JWT + HMAC reserve/finish、唯一请求 ID、fingerprint、已完成缓存、共享额度与租约、结果读取和页面草稿。不依赖真实 Provider、新服务或生产数据。

本地验收标准：未知响应后沿用同一 reviewId/requestId/question；无自动补发；已完成只恢复缓存，不新计入场/调用；有效租约仍忙、过期同编号明确结束，下一次用户点击才新建 ID；晚到旧结果不能展示或影响新租约；草稿/历史/快照/AC 前提示不变；权限与历史迁移完整保留。

## 3. 实际改动

| 文件 | 变化 |
| --- | --- |
| `src/components/reviews/review-workspace.tsx` | 内存保留未知请求票据，专用显式重试；同步防重；网络/非法 JSON/响应结构/5xx 保留原编号；已完成恢复，AP006 或明确 4xx 拒绝后结束票据，新调用需另点；安全错误不展示原始传输异常；保护追问/笔记和跨快照来源，增加离页提示 |
| `supabase/migrations/202610260011_review_retry_recovery.sql` | 仅替换 review_reserve：已过期 pending 的同编号重试返回 AP006；completed 缓存优先，其他安全/额度逻辑与签名不变；重申 ACL，无数据修复 DML |
| `tests/unit/review-workspace.test.tsx` | 10 个离线组件契约，覆盖丢响应/5xx/不可信响应、同编号、显式新意图、同步连点、草稿/历史/导航与快照来源保护 |
| `tests/integration/review-database.test.ts` | 原 7 项保留，增 3 项：过期重试/新旧租约、真实 orchestrator + SQL 的已提交响应恢复与 Provider 次数、011 重放及 ACL/search_path |
| `tests/e2e/m25.spec.ts` | 保留全部原场景；原审核失败增加显式结束确认；增加桌面/移动“提交后丢响应→同编号缓存恢复→只保留一份分析” |
| `tests/evaluation/m35-structure.test.ts` | 将历史 001–010 结构比较显式固定到 010，避免新的本地 011 污染旧目标核验口径，原目录断言保留 |
| `AGENTS.md`、`CODEX_PROMPT.md` | 保存本轮明确的长期仅免费模型、无收费回退/历史预算授权、禁止本轮真实调用/真实 Key 读取的规则 |
| `README.md`、`docs/MILESTONES.md`、`supabase/migrations/README.md` | 增加当前切片、011 待授权部署、同页面票据与真实验收边界；历史正文保留 |
| `docs/M353_REVIEW_RETRY_VERIFICATION.md` | 本报告 |

生产 Provider、Prompt、输出审核、推荐 1.3-official 权重、Auth/RLS 与 001–010 SQL 均未修改。B3 五文件逐字未改。没有代码运行器、模型切换、付费 fallback、额外模型或线上假回复开关。

票据仅在当前页面内存，不把私人追问/对照代码新增持久化到 localStorage/sessionStorage。离页有提示；主动绕过提示刷新/关闭会失去未确认票据，不能宣称跨标签/进程崩溃的客户端 exactly-once。已保存分析仍可按原 reviewId 刷新恢复。错误结束/过期也可能已有上游用量；同编号核对不是费用归零证明。011 未部署的环境仍存在旧过期分支，不宣称已修复托管状态。

## 4. 实际测试与失败记录

采用私有临时副本，复制 Git 跟踪文件和明确新增文件，排除所有 `.env*`；只链接现有 node_modules，不安装依赖。子进程环境由常量白名单重建，HOME 为空目录。预加载原 B3 禁网/凭据读取 guard。PGlite 是真实本地 PostgreSQL/WASM，无远端连接，Auth claims 为替身。

修改前真实复现：新增组件契约 **7 FAIL / 1 PASS**（含新编号与同步重复发送），SQL 专项 **1 FAIL / 7 PASS**（期望 AP006，实际 AP004）。没有删断言或放宽安全/测试预算。

首轮实现：lint、专项 19/19、全量 393/393、推荐 36/36 PASS；新测试误把 Playwright 的 `exact` 参数用于 Testing Library，导致 typecheck/build FAIL。已移除不支持的参数，未改断言意图；补齐跨快照草稿保护后重新执行最终检查。

| 最终命令 | 结果 |
| --- | --- |
| `npm run lint` | PASS，exit 0，零警告 |
| `npm run typecheck` | PASS，exit 0 |
| `npm run test -- tests/unit/review-workspace.test.tsx tests/integration/review-database.test.ts --maxWorkers=1` | PASS，20/20，2 文件 |
| `npm run test -- --maxWorkers=1` | PASS，394/394，41 文件，94.66 秒；含 B3 原 90 项 |
| `npm run test:recommendations -- --maxWorkers=1` | PASS，36/36，8 文件 |
| `npm run build`（含 postbuild） | PASS，exit 0；无配置构建及合成本机配置构建均实际通过，Monaco 检查通过 |
| `npm run test:e2e -- --config=playwright.offline.config.ts`（临时副本、local-only 沙箱） | 最终 PASS，54/54，28.0 秒；先单独执行 m25 桌面/移动专项 6/6 PASS；retries=0 |
| `git diff --check` 与历史文件不变核对 | PASS；收尾 HEAD 未变，9 个既有文件修改、3 个新增；B3 五文件及 001–010 均与 HEAD 相同 |

使用 1 worker 沿用 B3 已记录的避免 5 秒 PGlite 候选测试争用方式，不修改原测试超时或生产限流。推荐回放保留真实 3 秒时隙和 30 秒冷却；不再次联网采集旧 CF 响应。

`npm run test:review-reliability` 私有 C++ 夹具工具本轮 NOT_RUN，不读取或执行那些用户源码。原生 PostgreSQL 多连接的 011 新分支、托管 Supabase JWT/PostgREST、生产迁移/部署、真实模型/免费资格/教学评价均 NOT_RUN。历史 M321/M33 原生结果不充作本轮成绩。

## 5. 安全、费用与外部行为

真实模型请求 **0**，真实 Key 读取 **0**，付费 API 调用 **0**，生产数据库访问/修改 **0/0**，托管迁移/部署 **0/0**，Git commit/push/PR **0/0/0**。只使用仓库合成/既有录制夹具，不读取或外发私人源码、题面、用户材料；不会因未知费用再次发送请求。历史 A/A2 usage/费用继续 UNKNOWN。

最终无网络检查有 19 份 Node 审计，invalid/incomplete 均为 0，六计数均 0；两轮合成本机构建共有 11 份完整 Node 审计，计数均 0。最终 E2E 有 14 份 Node 审计，invalid/incomplete=0，networkBlocked/dnsBlocked/credentialReadBlocked/externalHTTP/realDNS/realCredentialReads 均 0；12 份浏览器路由审计仅允许 4470 次 loopback 页面请求，denied=0。这个数字不是服务器所有 loopback 请求总数。

外部 HTTP/DNS **受控 Node 计数为 0，浏览器底层总尝试计数 UNKNOWN**：原生 Chromium 不受 Node preload 覆盖，不能把缺失的系统级计数补零。E2E 使用已通过执行权限审查的 macOS local-only 沙箱（deny network*，仅允许 loopback bind/inbound/outbound）、浏览器路由白名单、禁止外部域名解析/后台联网参数和无代理设置；没有放行外网。程序页面与 Node 均无外部请求记录，不把这点当成真实网络路径/远端可用性验证。

E2E 失败历史保留：普通执行沙箱最初不允许嵌套 sandbox/监听 127.0.0.1，之后通过执行权限审查仅开放本机测试；第一次 preload 拦截了 Node 对字面量 127.0.0.1 的 lookup（dnsBlocked=1、realDNS=0），改为只对固定 loopback 返回内存地址；外部 lookup 仍拒绝。第一轮浏览器禁域名配置误含 127.0.0.1，54/54 在导航前失败，增加精确 loopback 例外后专项 6/6。随后全量 42 PASS/12 FAIL，快照表明无配置构建把 dashboard/sessions/problems 预渲染成布局预览，运行时再注入替身配置无法改变这些静态页；没有修改产品断言。重新以常量合成 Supabase URL/public key/APP_URL 构建动态页面。临时测试包装器初缺 Page 类型导出导致一次构建失败，补齐后构建 PASS，完整 54/54 PASS。全部失败均保留日志，没有以 CI 自动重试、删除断言或放宽超时获得通过。

## 6. 进度与下一步

本切片的代码、SQL、组件/集成/浏览器闭环本地 PASS；011 托管应用仍 BLOCKED（须新目标授权），真实环境未修复验收。本切片只补已有复盘闭环的本地可靠性，不将其命名为 M4 或宣称 M3.5/生产发布完成。B3 保持离线 PASS，B4 NOT_RUN；真人推荐 0/40、替代 0/5、既有个人训练反馈和混合质量反馈计数不变。

可直接继续的具体任务：把长期免费模型约束落实为服务端 fail-closed 配置/防误调用门禁，以合成配置和 Mock 验证 Tutor/Review 在不满足门禁时均不入场；配置检查不能声称验证真实免费资格。仍不需要真实生成。

需独立授权：指定目标的 011 结构核验/迁移及托管双用户/跨实例；核实项目免费资格后的 B4 单次真实实验和之后的真实复盘质量评审。不得沿用历史 USD 1.10、同步预算或旧生产许可。M35 迁移账本治理、真实用户教学评价与整体闭环仍保留 BLOCKED/NOT_RUN。

## 7. 证据文件与复核

- [无网络检查与审计](/private/tmp/algopilot-review-checks-q9BG5R/checks.json)、[完整检查日志](/private/tmp/algopilot-review-final-checks.log)
- [最终 54 项 E2E 与审计](/private/tmp/algopilot-review-checks-q9BG5R/e2e-audits-4mfz1o/checks.json)、[E2E 日志](/private/tmp/algopilot-review-e2e-complete.log)
- [合成本机构建审计](/private/tmp/algopilot-review-checks-q9BG5R/fixture-build-audits/summary.txt)、[构建日志](/private/tmp/algopilot-review-fixture-build-verified.log)
- [源码与受验副本比对](/private/tmp/algopilot-review-checks-q9BG5R/source-attestation.json)：业务组件、新 SQL、组件/集成/目录测试逐字节相同；E2E 只替换测试导入以注入离线保护，全部断言逐字相同。
- [组件旧版失败复现](/private/tmp/algopilot-review-baseline.log)、[SQL 旧版失败复现](/private/tmp/algopilot-review-sql-baseline.log)、[首轮类型错误](/private/tmp/algopilot-review-checks.log)、[无配置构建 E2E 42/54](/private/tmp/algopilot-review-e2e-verified.log)。

复现驱动与临时保护仅留私有临时目录：[无网络检查入口](/private/tmp/algopilot-review-checks-driver.mjs)、[loopback E2E 入口](/private/tmp/algopilot-review-e2e.mjs)。不会提供真实模型调用入口。临时材料可能被系统清理，以本报告保留实际成绩与失败历史；不为补证发送真实请求。
