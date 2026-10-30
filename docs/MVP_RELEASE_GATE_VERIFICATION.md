# MVP 发布就绪 R0：离线异常与独立 P0 验收准备

日期：2026-10-30，Asia/Shanghai。**本轮结论：UNRESOLVED。历史两次网络拦截仍为 FAIL / UNKNOWN；完整 MVP 不具备发布条件。** 原生数据库环境与真实免费资格另为 BLOCKED，托管和 B4 为 NOT_RUN。此报告不是发布、有限试用或下一阶段执行授权。

## 1. Git 基线与检查范围

起始 HEAD：`1ca26d3f8fd1742b4b0e7365d5979e8588c45285`，与用户提供的 main 基线一致；`git status --short` 为空。最近提交已含 Review 列表恢复的 10 个文件，没有将旧报告的未提交状态套用到当前工作区。本轮未联网 fetch，不能据此证明 GitHub 此刻没有新提交。

已读 DEVELOPMENT_PLAN.md **v3.4**、AGENTS.md、CODEX_PROMPT.md、MILESTONES、MVP_RELEASE_GAPS、Review 列表恢复和 M353 原生状态报告；核查 check-offline、audit collector/lifecycle、原 B3 guard、m353-isolated、原生 psql 驱动及 20 项定义、离线 E2E 接线、001–013 文件、生产生成工厂/门禁和 Auth/Cookie 路径。保留历史证据；只改审计诊断工具、对应回归和文档，没有产品功能、模型/权限策略、推荐权重、迁移或研究定义改动。

## 2. 历史两次 FAIL 的原始证据

本轮只读重新核对两份原始 JSON 与旧汇总，未改写：

| 历史批次 | 原审计记录 | 启动/结束 | 计数与结论 |
| --- | --- | --- | --- |
| 256 专项 final-target | `/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-replay-checks-LP7GIk/audits/12752-0.json` | 44/44 | networkBlocked=1，其余五计数=0；FAIL |
| lint/typecheck/专项/全量/推荐/build | `/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-replay-checks-UXVyfe/audits/13343-0.json` | 186/186 | networkBlocked=1，其余五计数=0；FAIL |

这是**不同批次的累计 2 次**，不是一次运行触发两次。旧独立诊断的 24/256/829 项各跑一次未复现，保持其历史事实。原记录只有类别，没有 API、命令阶段或调用栈；不能根据 PID、文件时间或后来的绿色测试，归因于 Review、npm、Next.js、测试框架或模型。

历史的受监控 externalHTTP/realDNS/realCredentialReads 各为 0；这是拒绝入口的计数，不是操作系统抓包或全设备流量测量。M353 更早的不完整退出记录以及旧 E2E 长停顿 UNKNOWN 也未被本轮补齐或解释。

## 3. 实际拒绝与继承路径

`scripts/m353-b3-offline-guard.cjs` 在调用原 API **之前**递增并抛出固定拒绝：

| 计数 | 被替换的入口 |
| --- | --- |
| networkBlocked | http/https.request/get、net.connect/createConnection/Socket.prototype.connect、tls.connect、global fetch |
| dnsBlocked | dns 与 dns.promises 的 lookup/lookupService/resolve*/reverse |
| credentialReadBlocked | fs 与 fs/promises 中存在的 readFile/readFileSync/open/openSync/createReadStream，路径匹配 `.env`、`.aws`、`.ssh` |

同一个被拒绝调用立即抛错，不进入下一层连接 API；不能从 networkBlocked 判断是否到达 HTTP、TLS、DNS 或模型服务。externalHTTP/realDNS/realCredentialReads 是原 guard 的零初始化字段，没有独立系统级探针。Node 原生绑定、未替换入口、非 Node 子进程及浏览器后台不自动在这些计数内。

实际链路为 `check-offline → npm → 生命周期 shell → eslint/next/vitest → Node fork/worker/测试 CLI`。包装器用固定白名单环境、空 HOME 和排除 `.env*` 的私有副本；只复用已有 node_modules。已读本机 npm 的 `@npmcli/run-script/lib/make-spawn-args.js`：生命周期环境展开 process.env，因此保留 NODE_OPTIONS，shell 自身不执行 Node 预载，随后 Node 进程执行。build 的 postbuild 也是独立生命周期 Node。

已读已安装 Vitest 的 ForksPoolWorker/ThreadsPoolWorker 与 projectEnvs：worker 的 env 从父进程合并，fork/Worker 接收该 env。新增合成用例实际验证子进程和 worker 继承。测试若重建 env、替换 NODE_OPTIONS 或启动原生程序，则不能自动推断覆盖；例如 m353 的原生程序使用自己的白名单环境。未以扫描到的启动记录宣称发现了所有可能的进程。

原 lifecycle 以 `PID-threadId.started` 标记启动；guard 退出原子发布 pending→json；SIGTERM/SIGINT 显式退出以保留记录。原 collector 按名称、版本、字段、非负整数、启动/结束/待发布对应关系检查，缺失保持 counters=NULL / UNKNOWN / FAIL。**已确认的诊断缺口**是不同命令共用目录、缺父进程/阶段/栈关联；这不证明历史调用本身是收集器误报。

## 4. 最小工具改动与有界复现

新增测试专用 `offline-diagnostic-preload.cjs`：先加载原 lifecycle/guard，再包裹相同入口；只有原 guard 已抛出固定拒绝后，才记录操作类别/API 名、PID/PPID/threadId、阶段、单调纳秒时间及对应 auditRecord。原异常继续抛出、原计数不变、原 guard 文件不变。

调用栈使用 `getCallSites(..., {sourceMap:false})`，只保存白名单本地源码/依赖相对文件及行列；未知位置记 unmapped。无函数名/源代码行/原始异常栈，不读取操作参数、URL/地址、Authorization、正文或原始环境。每 runtime 最多 32 个立即落盘事件，溢出/写失败返回非零；诊断目录独立于原审计目录，未在原 collector 增加忽略规则。

`check-offline` 每条 npm 命令使用独立阶段目录，并同时收集原审计与补充关联。`offline-diagnostics.ts` 对启动标识、事件顺序、单调时间、字段白名单及每 runtime 拒绝计数逐项核对；缺失、孤立、超限、计数不同均 UNKNOWN，使包装器失败。新 `--audit-only` 用于最小诊断；`--quality-only` 用于有界重验 lint/typecheck/build。E2E 仅补齐副本复制清单，原 loopback/路由/生产门禁行为不变。

新增 8 项回归覆盖正常关联、全部网络入口及 DNS/合成敏感路径、参数和 sourceURL 脱敏、本地栈定位、子进程/线程继承、SIGKILL 缺记录、事件丢失、32 条上限及损坏/孤立记录。它们证明诊断工具可用，**不是历史异常的根因回归**。合成拒绝夹具单独目录中审计预期 FAIL，测试断言检查后清理；不能与未预期的历史拦截混同，也不能用上层零计数声称测试中没有主动验证拒绝路径。

执行预算：先 1 次最小审计专项，再 1 轮完整离线检查；新增测试的 `NODE_ENV` 类型错误修正后定向重验。随后发现 V8 的本地 ESM frame 使用 file URL，补充只去除本地 file 前缀的归一化和对应断言，再跑最小专项及质量检查。完整回归只跑一轮，没有为碰运气复现而重复全量。具体结果见第 9 节。

**异常原因：UNKNOWN / UNRESOLVED。** 本轮观测结果不能撤销两次历史 FAIL；没有证据支持产品或依赖的因果修复，因此没有修改产品代码或网络白名单。

## 5. P0-A：原生 PostgreSQL 安全验收准备

**BLOCKED；既有 20 项均 NOT_RUN。** 本轮没有新提供且明确授权的二进制目录，不搜索、下载、安装、拉镜像、启动系统数据库或连接现有库。普通全量测试中的旧基础设施拒绝路径仅验证缺开关/非法路径返回 BLOCKED，不运行原生数据库用例。没有以 PGlite 替代。

| 执行前项目 | 现有实现与验收输出 |
| --- | --- |
| runtime | 显式绝对 `--bin-dir`，postgres/initdb/pg_ctl/psql 均可执行，完整版本字符串相同且 >=16；已有 npm/Node/依赖，不自动安装 |
| 隔离/目标 | 只新建 `/private/tmp/algopilot-m353-native-*` 的私有集群/空 HOME、随机非特权端口、随机 m353 数据库；只监听 127.0.0.1，不接受现有连接 URL |
| 目标证明 | 首次及每次迁移/清理前核对 database/data_directory/server address/port/listen/current_user；不符即拒绝，禁止转向真实库 |
| 身份/RLS | 3 个独立 authenticated LOGIN backend，NOINHERIT/NOSUPERUSER/NOBYPASSRLS；current_user=session_user、READ COMMITTED；另管理/观察连接，终止用例有额外连接 |
| Auth 边界 | auth.uid 与 request.jwt.claim.sub 为合成 claims；不签发/验证 Supabase JWT，3 backend 不等于多应用实例 |
| 迁移/历史 | 001–005 后创建合成旧记录，再依序 006–012，12 文件数量/顺序受约束；psql -X/ON_ERROR_STOP=1；核对历史不变与 011/012 重放；**不覆盖 013** |
| 事务与并发 | pg_stat_activity/pg_blocking_pids 确认真锁等待后交错提交/回滚；同编号租约/完成幂等、AP004/AP006/PT409、锁超时/事务失败、backend 终止、跨用户/RLS、Tutor/Review 共享配额与门禁 |
| 清理 | finally 先核实目标再 immediate stop，只删除本次已核实 cluster；确认不了目标/停止则 FAIL 并保留。测试失败也可能安全移除已核实 cluster；根目录内报告/日志/副本保留。不要手工清理不明服务 |

未来环境负责人准备好**现成隔离 runtime 并另行授权本地集群启停/合成写入**后，从仓库根执行以下既有入口；本轮未执行：

```sh
M353_ALLOW_DATABASE_TESTS=isolated npm run test:isolated:m353 -- --bin-dir /absolute/existing/postgresql/bin
```

将占位路径替换为负责人确认的四程序目录；不要填生产 URL，不加载真实配置。保存输出 `NATIVE_REPORT` 指向的 native-postgres.json、vitest.json、native-state-evidence.json、audits 和必要日志；预期 20/20、historyPreserved=true、12 migrations、独立角色/backend/锁证据和安全清理。exit 2/BLOCKED 不算执行通过；exit 1/FAIL 先保留证据。

准备限制：当前原生入口直接预载原 B3 guard，未使用 lifecycle，且 native-postgres.json 只按 Vitest 退出值判功能状态，没有完整审计汇总。不能直接用要求 `.started` 的新 collector 把它报 PASS，也不能把缺记录补零；正式验收须分别审阅已有 guard 记录，并将启动覆盖/完整审计接线列入下一阶段执行清单。20 项 PASS 本身仍不证明全部网络覆盖、013、托管 JWT 或多实例。

## 6. P0-B：托管环境一致性（本轮全部只准备）

| 门禁 | 当前证据 | 下一阶段可执行验收及负责人所需授权 |
| --- | --- | --- |
| 目标身份 | 历史为 qmlsgwbiiqpbelgkgsdw/main/PRODUCTION；本轮没有连接，当前状态 UNKNOWN | 环境负责人先明确专用测试项目/分支/用途/数据边界；历史生产同步授权不适用 |
| 001–013 有效结构 | 13 份本地 SQL；历史 001–010 目录匹配不证明当前部署。011–013 托管 NOT_RUN | 经单独只读授权，用仅 SELECT/系统目录材料核对函数签名/哈希、约束、RLS、列权限、ACL/索引；为 011–013 补齐对应只读清单，版本差异逐项解释 |
| 历史账本 | schema_migrations 历史实核缺失 | 与有效结构分栏，不自动 db push/db pull/repair/建账本；负责人决定审计和未来迁移策略，任何写入另列目标/清单批准 |
| 011/012/013 | Review/Tutor 过期恢复及训练反馈仅本地 SQL/替身验证 | 先冻结备份/回退与历史不变断言，独立批准只应用确认缺失迁移；核对 AP006/显式新编号/迟到结算、013 来源/归属/幂等/CAS 和历史兼容 |
| JWT/归属 | SSR Cookie + 服务端 getUser，普通 JWT 窄 RPC；本地 claims/HTTP 替身不能证明实际身份 | 明确创建/登录两个测试用户的 Auth 写入范围；真实签发并由 Supabase 验证 JWT，交叉读写、已知 ID/缓存/恢复、anon/直接 DML 拒绝 |
| Cookie/撤权 | proxy 刷新 Cookie、API 再 getUser；客户端失效 epoch 仅本页防迟到 | 真正过期/刷新/注销/撤销/身份切换，刷新响应 Cookie 和请求身份一致；在途迟到结果不能复活旧用户内容，空闲页面撤权可见性单列 |
| HMAC | 目录/本地配置不证明私有 DB secret 与应用一致 | 负责人在受控通道核验一致性，仅留布尔/结果，不读取、导出或发给聊天真实 Key/nonce；有副作用的挑战 RPC 另批准 |
| 多用户/多实例 | 双用户本机替身覆盖；真实多用户/多实例 NOT_RUN | 至少两个独立应用进程共享指定测试项目，分别报告 app/backend 数；跨实例同编号、额度/锁/租约、重试、撤权/历史/故障恢复与并发记录验证 |

上述准备不包含本轮远端 SELECT、配置读取、登录、迁移、清理或部署授权。匿名 RPC 可见性也不能代替管理目录证明。

## 7. P0-C：真实免费模型可用性

**可信资格 BLOCKED；B4 NOT_RUN；生产 Fail-Closed 不变。** `productionGenerationPolicy()` 的资格与独立授权源均 unavailable，approved=[]、projectRef/credentialRef=null。纯策略模拟允许不是真实发送许可；生产工厂不导入测试 Fixture。

| 必要门禁 | 通过标准与后续批准事项 |
| --- | --- |
| 可信资格来源 | 负责人提供可独立验证的 Provider/项目免费且 hard-free-only 证据，包含来源、批准端点/模型、范围、观测及失效时间、撤销/刷新机制；不能生成请求试探资格 |
| 凭据关联 | 在服务器受控通道证明实际 Key 所属项目与批准目标绑定，聊天/仓库/日志不暴露 Key；当前没有资格验证器或授权源，先独立评审实现再接入，不能用环境布尔/自签 JSON/测试 Policy |
| 有效期与授权 | 资格与当前请求授权相互独立；现有策略资格最长 15 分钟、执行授权最长 5 分钟，精确绑定 operation/user/resource/requestId、目标且可撤销；历史 USD 1.10、Flash/模型名或免费标签不构成证据 |
| 真实路径 | 新的独立授权明确 Provider/项目、请求次数、合成或已授权材料、时间窗口、零付费与中止条件；再验证真实 HTTPS/鉴权/超时/429/503/重试前撤权，没有付费回退 |
| Tutor/Review | 分别检查真实响应契约与审核、L0/L1 受限选择、L2+ 人工剧透审查、L5 双操作、比赛禁止、无思路/缺题面、Review 自报 AC/发送授权、快照/追问/历史恢复；不能将固定输出测试当真实质量 |
| usage/费用 | 对实际请求 attempt、缺失 usage=NULL、超时可能已执行/计费与 Provider 账单/免费额度分栏核对；未取得证据为 UNKNOWN，不以本地 token 或无返回宣称费用为零 |

用户数据进入 Provider 还须独立数据发送授权；普通参与/使用产品同意不能替代。全部真实动作本轮未执行，也没有读取真实凭据。

## 8. 发布范围判断

1. **完整 MVP：不能发布。** 历史审计 UNRESOLVED、P0-A/B 未完成、P0-C 缺真实资格及授权；离线功能 PASS 不能提升为 READY_FOR_RELEASE。
2. 推荐/画像的新训练来源与反馈、Tutor 分级与恢复、Review 生成/追问/审核/重试、列表/详情/草稿、成长观测主要是本地合成单测、PGlite 或 HTTP/Chromium 契约证据。M3.5 历史真实单用户 CF 采集/推荐读取的有限证据保留，不能覆盖 011–013、真实教学效果或两用户/多实例。
3. **无需 AI 的有限试用候选**：真实题库缓存检索、确定性推荐及解释、证据画像、计划、训练状态/计时/思路笔记及已保存历史、手动结果/训练反馈、Review 代码快照与人工编辑/历史读取。CF 同步另外依赖真实公开 API、明确作用域和共享限流，不自动沿用旧同步预算。
4. 以上候选仍依赖 Auth、数据库归属/RLS、写入幂等、迁移与历史完整性；禁用 AI **不会取消 P0-A/B**。013 对推荐来源/反馈等非 AI 功能也有依赖，不能当可选模型迁移跳过。有限试用只是待负责人讨论的范围，本轮不招募、部署或接真实数据。
5. 若未来决定禁用 AI，须明确告知：“当前不提供 AI 提示、自动题目/代码分析或新复盘生成/追问；推荐来自确定性规则，能力画像来自有限训练证据，不是官方 Rating；保存快照/自报 AC 不代表已生成分析、运行验证或正确性保证；未保存草稿/未知票据刷新后不保证恢复。”入口与失败文案需准确反映禁用原因，不能宣称真实免费模型已集成；读取已有分析与生成新分析分开说明。此为待批准产品文案要求，本轮未改 UI。
6. **任何新真实用户数据进入系统前**：P0-A 原生事务/角色/历史安全、P0-B 指定托管身份/实际迁移/RLS/跨用户/Cookie/撤权/多实例及安全数据管理须有可审查证据；历史审计异常须继续列为独立发布阻塞，由负责人审阅原因或明确接受剩余风险，不能自动降级。涉及 AI 数据发送再通过 P0-C 和独立发送授权。无需真实数据的公开无数据 preview 可供布局审阅，不能冒充有限试用验收。

## 9. 实际命令与结果

所有 npm 子命令均在既有入口创建的私有副本执行，排除 `.env*`、白名单环境/空 HOME/预载拒绝；没有安装依赖、增大单例预算或删跳旧断言。

| 实际执行 | 功能结果 | 审计及限制 |
| --- | --- | --- |
| `node scripts/check-offline.mjs --audit-only`，最小专项 | 原 9 + 新 8 = **17/17 PASS** | 4/4 主阶段记录，审计 PASS、关联 CORRELATED、未知拒绝 0 |
| `node scripts/check-offline.mjs`，唯一完整轮次 | lint PASS；typecheck **FAIL exit 2**；18 文件专项 **264/264 PASS**；全量 **837/837 PASS**（71 文件，113.88 秒）；推荐 **36/36 PASS**（8 文件，78.51 秒）；build **FAIL exit 1**；包装器 exit 1 | 六阶段均审计 PASS、CORRELATED，合计 159/159；每阶段六计数均 0。两个质量失败同为新增测试子进程缺 NODE_ENV 的 TS2769，不是未知网络拦截 |
| `node scripts/check-offline.mjs --quality-only`，补 NODE_ENV 后 | lint/typecheck/build+postbuild **PASS**，包装器 exit 0 | 2/2、3/3、34/34；审计 PASS、CORRELATED，各六计数 0 |
| `node scripts/check-offline.mjs --audit-only`，补 NODE_ENV 后 | **17/17 PASS** | 4/4；PASS、CORRELATED、六计数 0 |
| `node scripts/check-offline.mjs --audit-only`，补本地 ESM 栈归一化后 | **17/17 PASS**，8 项中新加同一断言的 ESM file URL 变体 | 4/4；PASS、CORRELATED、六计数 0 |
| `node scripts/check-offline.mjs --quality-only`，最终源码 | lint/typecheck/build+postbuild **PASS**，exit 0；0 lint 警告/类型错误 | 2/2、3/3、34/34；PASS、CORRELATED、六计数 0 |
| 系统 loopback 沙箱中 `node scripts/test-offline-e2e.mjs`（既有 `npm run test:e2e` 脚本体） | build PASS；Chromium 桌面/移动 **136/136 PASS**，约 1.3 分钟，retries=0 | Node 55/55、browser 12/12，原 collector PASS；页面允许 9678、拒绝 0；Node 六计数 0；原生浏览器后台 HTTP/DNS **UNKNOWN** |
| `git diff --check`；产品/安全边界 diff | **PASS** | src、supabase、原 guard/collector/lifecycle、原生入口/20 项定义均无修改 |

完整轮次中的命令为 `npm run lint`、`npm run typecheck`、`npm run test -- <check-offline 内 targeted 18 文件> --maxWorkers=1`、`npm run test -- --maxWorkers=1`、`npm run test:recommendations -- --maxWorkers=1`、`npm run build`；精确文件列表在脚本及下列日志。最小专项为 `npm run test -- tests/unit/offline-audit.test.ts tests/unit/offline-diagnostics.test.ts --maxWorkers=1`。普通全量仍执行既有 native 基础设施的 4 个**前置拒绝**用例，未执行原生 20 项。

全量 837 的副本在 NODE_ENV/ESM 两项工具修正前冻结；最终相关 17 项与 lint/typecheck/build 都重新通过，没有把旧快照当作最终字节完全相同的全量运行。产品及迁移与全量副本逐字节核对 **152 文件 0 差异**；E2E 的同一 152 文件只有既有私有 runtime-provider Fixture 接线差异，源工厂不变。E2E 完成后未更改产品或 E2E 行为；最后 ESM 诊断变体只由相关专项检验。

稳定结论在本报告；临时产物可能被系统清理，不能据此重建历史 PASS。日志与 checks.json：

| 批次 | 日志（`/private/tmp/` 下） | checks.json 所在目录 |
| --- | --- | --- |
| 最小诊断 | `algopilot-r0-audit-probe.log` | `$T/algopilot-replay-checks-vWFOYf/` |
| 唯一完整轮次 | `algopilot-r0-full-checks.log` | `$T/algopilot-replay-checks-1aQ27K/` |
| NODE_ENV 质量/专项 | `algopilot-r0-quality-final.log`、`algopilot-r0-audit-final.log` | `$T/algopilot-replay-checks-KN0Xos/`、`$T/algopilot-replay-checks-rfbKzS/` |
| 最终 ESM 专项/质量 | `algopilot-r0-audit-esm-final.log`、`algopilot-r0-quality-esm-final.log` | `$T/algopilot-replay-checks-2bpWrg/`、`$T/algopilot-replay-checks-d6pqxl/` |
| E2E | `algopilot-r0-e2e-run.log` | `$T/algopilot-gate-e2e-R4Vrov/e2e-audits-hJxJ7v/` |

此表 `$T` 仅为文档缩写：`/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T`，不要求用户设置环境变量。E2E 首次系统沙箱启动被现有执行沙箱拒绝 `sandbox_apply: Operation not permitted`（exit 71），应用/测试尚未启动，没有采集计数；随后获准在上述**仍拒绝外网、只允许 loopback** 的独立系统沙箱中执行成功，未放行真实连接。该启动失败不记为功能通过或网络零计数。

| 安全/审计对象 | 本轮可证明的结果 |
| --- | --- |
| 未预期网络拒绝 | 上表主阶段记录均 0，诊断事件 0；历史两次仍 FAIL / UNKNOWN |
| 诊断负例子进程 | 独立合成目录中故意触发 network/DNS/敏感路径拒绝、SIGKILL 和事件缺失；原 FAIL/UNKNOWN 由测试断言，不被补零、白名单或合并为主阶段零计数。它们不是历史调用复现 |
| 受监控真实外部 HTTP/DNS/凭据读 | 上表完整主阶段记录的对应计数均 0；不外推为整机/所有子进程抓包结果 |
| 浏览器页面/后台 | 页面路由 9678/0；原生后台流量未计量，保持 UNKNOWN。系统策略拒绝外部网络不等于测得后台尝试 0 |
| 原生/托管/真实模型/账单 | 原生 20 项、托管迁移/真实 JWT/多实例、真实免费资格/Provider/usage/费用与 B4 均 **NOT_RUN**，所需环境/资格/授权保持 BLOCKED；不提供虚构零费用或成功集成 |
| 私人内容/真实 Key | 未执行读取/外发动作；新测试只用合成内容与假路径，未将未覆盖的全设备后台累计补成零 |

最终 HEAD 仍为 `1ca26d3f8fd1742b4b0e7365d5979e8588c45285`；工作区 **3 修改、4 新增、0 暂存、0 删除，共 7 文件**。改动和全部历史证据留供人工审核；本轮总分类仍为 **UNRESOLVED**。

## 10. 文件、审计与停止边界

变更：`scripts/check-offline.mjs`（分阶段/关联收集与有界入口）、`scripts/test-offline-e2e.mjs`（副本复制清单）；新增 `scripts/offline-diagnostic-preload.cjs`、`scripts/offline-diagnostics.ts`、`tests/unit/offline-diagnostics.test.ts`、本报告；更新 `docs/MVP_RELEASE_GAPS.md`。最终状态与验证见第 9 节。

不读取真实 Key/.env/私人材料，不连接真实 Supabase/CF/模型，不运行原生 20 项、托管 011–013、B4、安装/镜像/系统数据库、招募/真人评审、commit/push/PR/部署。原 guard、collector/lifecycle、001–013、生产门禁与全部产品源码保持 HEAD。真人 0/40、替代 0/5、参与者 0 不变。

本轮后停止，所有代码和文档留工作区供人工审核。后续分别由负责人批准：诊断工具及 UNKNOWN 处理；提供现成隔离原生目录并批准本地专项及完整审计接线；指定专用托管目标/只读核验，随后独立批准具体迁移/Auth/回归清单；建立可信免费资格与授权实现后再独立决定真实请求范围。任何一项批准均不自动包含其他门禁或有限试用发布。
