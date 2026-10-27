# M3.5.3 数据库恢复与状态一致性验收

2026-10-27，Asia/Shanghai。**原生 PostgreSQL 验收 BLOCKED；20 项原生用例全部 NOT_RUN。离线功能回归 PASS：专项 134/134、全量 495/495、推荐 36/36、桌面/移动 E2E 58/58。核心退出计数汇总有单独 FAIL（1 份不完整记录），不补零。** 本机没有找到可直接复用的 PostgreSQL 或容器运行环境；按用户补充要求停止搜索，不下载、不安装、不拉镜像、不启动系统服务。已实际实现原生专项入口、执行其安全前置检查，并补充可执行的离线状态回归。PGlite/Mock 结果不能替代原生并发、独立登录连接或托管验收。

## 1. Git 与交接核对

实际起始 HEAD：`ee2646334b8d19af8779011fa38c5704723dce7e`，起始 `git status --short` 为空。此提交完整纳入上轮门禁的 33 文件，父提交为交接中的 `59b31be2cbd2756de79228a12914b371dc02d2ec`。因此“59b31be + 22 修改/11 新增未提交”是历史时点，本轮没有覆盖旧修改。

已阅读 M353 门禁、Review 恢复、B3 验收，011/012 迁移、Tutor/Review Repository/Orchestrator/Provider/门禁、现有 M321/M33 原生框架及 PGlite 测试。生产门禁保持默认拒绝，真实免费资格 BLOCKED，B4 未获授权。未做 commit/push/PR/reset/clean、托管操作或部署。

## 2. 本机环境与搜索终点

- 项目现有 `scripts/m321-isolated.mjs`、`scripts/m33-isolated.mjs` 依赖的 `/tmp/algopilot-m321-runtime` 已不存在。
- `postgres/initdb/pg_ctl/psql` 不在 PATH；Homebrew Cellar/opt、`/usr/local`、常见 Postgres.app 路径没有找到可执行文件。用户也独立执行 `command -v` 与 `find ... -name pg_ctl`，结果为空。
- 最后一次核对未发现 Docker/Podman CLI、常见本地 daemon socket、Docker.app/OrbStack.app 或常见运行时目录。没有可用于列举镜像的本地容器运行时；不能据此断言所有磁盘上都不存在镜像。
- 项目依赖、Codex 已有 runtime、npm/pnpm 本地缓存未找到可复用的原生二进制或 embedded-postgres 包；PGlite 存在，但它不提供本任务要求的独立原生 backend。
- 用户明确禁止下载/安装/拉镜像并要求停止继续搜索后，本轮未再扩展搜索。未修改代理、Clash/TUN、数据库配置或系统服务。

实际执行（在排除 `.env*` 的私有副本、空 HOME 和 B3 既有 guard 下）：

```sh
M353_ALLOW_DATABASE_TESTS=isolated npm run test:isolated:m353 -- --bin-dir /usr/local/bin
```

退出 **2**，报告 `status=BLOCKED`、`reason=LOCAL_POSTGRES_BINARIES_UNAVAILABLE`、`target=null`、`migrations=[]`。原生连接数 **0**，没有启动实例、创建数据库或执行原生迁移。证据：[前置检查日志](/private/tmp/algopilot-m353-native-preflight.log)、[原生入口报告](/private/tmp/algopilot-m353-native-XqmQUS/native-postgres.json)。临时证据可能被系统清理，不能因此补造 PASS。

## 3. 原生测试基础设施

`npm run test:isolated:m353 -- --bin-dir /absolute/existing/bin` 只接受显式 `M353_ALLOW_DATABASE_TESTS=isolated` 和已有本地二进制目录，不读取任何数据库 URL、密码、`.pgpass`、`.psqlrc` 或项目 `.env`，不安装依赖。

实现的执行流程（**本机只运行到二进制前置拒绝，以下数据库步骤未执行**）：

1. 检查四个二进制可执行、版本一致且 PostgreSQL >=16；创建私有 `/private/tmp/algopilot-m353-native-*/cluster`，只监听 `127.0.0.1`，使用随机端口和随机 `m353_<16hex>` 数据库名。
2. 在首次迁移及清理前核对实际 `data_directory/current_database/inet_server_addr/inet_server_port/listen_addresses/current_user`，与本次生成目标精确匹配才继续；目标不明则拒绝迁移/删除。
3. 清空子进程环境白名单，使用空 HOME；源文件只复制到私有目录、排除 `.env*`、复用现有 node_modules；迁移通过原生 psql `ON_ERROR_STOP=1`，任何语句失败立即失败，防止末尾 COMMIT 掩盖错误。
4. 先按 001–005 创建合成历史，再应用 006–012 并比对历史；没有修改原迁移。成功/失败后只停止并移除已核实的本次临时集群；目标或停止无法确认时记录 FAIL 并保留目录。
5. Vitest 原生专项与普通测试入口分离，缺少环境明确 BLOCKED，不能以普通测试总数冒充已执行原生专项。Node 测试子进程沿用未修改的 B3 禁网/凭据读取 guard；psql 只使用固定 loopback 参数。

`PsqlConnection` 每实例对应长期独立 psql 进程；SQLSTATE 与 JSON 输出在 stdout 同一流分帧，不依赖 stdout/stderr 顺序，不记录可能含 SQL 的诊断原文。失败、连接关闭、输出超限均拒绝，不返回部分成功。

## 4. 迁移版本与实际应用范围

| 顺序 | 文件 |
| --- | --- |
| 001 | `202610110001_m1_training.sql` |
| 002 | `202610110002_m2_tutor.sql` |
| 003 | `202610110003_gemini_usage.sql` |
| 004 | `202610120004_business_conflicts.sql` |
| 005 | `202610120005_ac_reviews.sql` |
| 006 | `202610120006_cf_catalog_plans.sql` |
| 007 | `202610140007_learning_recommendations.sql` |
| 008 | `202610140008_recommendation_audit.sql` |
| 009 | `202610140009_recommendation_fit.sql` |
| 010 | `202610150010_cf_official_evidence.sql` |
| 011 | `202610260011_review_retry_recovery.sql` |
| 012 | `202610270012_tutor_retry_recovery.sql` |

**本轮原生实际应用：无。** 新 PGlite 测试实际按上述顺序应用全部 12 份原文件，旧训练/草稿快照前后一致；此结果仅为串行 WASM PostgreSQL 兼容性。额外篡改临时函数体后，012 原子拒绝 `23514`，回滚保持该临时定义及 ACL 不变；恢复原定义后重放稳定。没有改 012 来迎合测试，也没有修改 001–011。

## 5. PostgreSQL 版本、角色与协调

| 项目 | 原生实际结果 | 已实现但未执行的专项条件 |
| --- | --- | --- |
| PostgreSQL 版本 | NOT_RUN / 未取得 | 四程序版本一致，>=16 |
| 后端连接 | 0 | 3 个 authenticated 独立 LOGIN + 1 管理/观察连接；终止用例额外短期连接 |
| 普通角色 | NOT_RUN | `authenticated LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS`，核对 current_user=session_user=authenticated |
| JWT | NOT_RUN | 合成 `request.jwt.claim.sub` + `auth.uid()`；不签发或验证 Supabase JWT |
| 隔离级别 | NOT_RUN | 显式 READ COMMITTED |
| 事务屏障 | NOT_RUN | 持有未提交事务，观察另一 backend 的 `pg_stat_activity.wait_event_type='Lock'` 和 `pg_blocking_pids` 后才提交/回滚/终止 |

没有用高权限角色执行普通请求再称原生 RLS PASS。PGlite 使用原有 `SET LOCAL ROLE authenticated` 与合成 claims，和真正独立登录的原生连接分栏。三个 backend 也不代表三个应用实例。

## 6. Tutor / Review 原生矩阵

每个业务各 7 项数据库状态用例、2 项门禁与真实 Orchestrator 集成用例；另有迁移/权限及跨 Tutor/Review 共享入场各 1 项，共 **20 项**，均未运行，未计入普通测试通过数。

实际执行 `node node_modules/vitest/vitest.mjs list --config vitest.native.config.ts --staticParse=false --json` 成功动态收集 20 项，未运行 hooks/SQL/数据库测试；静态 list 只显示 11 个参数化定义，未将其误计为 11 项通过。[收集结果](/private/tmp/algopilot-m353-native-collected.json)。

| 原生检查 | Tutor | Review |
| --- | --- | --- |
| 同编号竞争，只有一个有效数据库租约；并发 finish 历史只写一次 | NOT_RUN | NOT_RUN |
| 过期同编号 AP006；显式新编号收尾旧记录；迟到结果不污染新租约 | NOT_RUN | NOT_RUN |
| completed 缓存不变；指纹冲突、跨用户读取/占有/结算拒绝 | NOT_RUN | NOT_RUN |
| 入场回滚，等待连接可正常取得同编号 | NOT_RUN | NOT_RUN |
| 真锁超时 55P03 / 事务 25P02；回滚后重试状态正确 | NOT_RUN | NOT_RUN |
| RPC 异常、结算后事务回滚，不产生假 completed | NOT_RUN | NOT_RUN |
| 后端意外终止回滚未提交记录；已提交租约须显式过期恢复 | NOT_RUN | NOT_RUN |
| 新并发请求门禁拒绝；completed 在拒绝态仍可恢复 | NOT_RUN | NOT_RUN |
| 入场后及模拟 503 后撤权，结算 failed、阻止下一 dispatch | NOT_RUN | NOT_RUN |

跨 Tutor/Review 的 advisory lock、共享额度，以及原生函数签名/jsonb/SECURITY DEFINER/search_path/EXECUTE/RLS/私有列/重放与历史保护也为 **NOT_RUN**。

## 7. 可执行的离线状态验证

新增 12 项 PGlite 集成测试真正运行 001–012 与两套真实 Orchestrator、生产默认拒绝 Provider，以及共享 SQL 测试适配器。适配器使用用户角色/合成 claims 与实际 HMAC RPC，直接 SQL 连接，不冒充 PostgREST/Supabase Repository 传输集成。

- 新请求被拒绝时无请求行、无调用；已完成同编号在拒绝态仍恢复原缓存，历史内容不变，新编号仍拒绝。
- 已有有效 pending 返回 AP004；过期同编号重复返回 AP006，无模型 dispatch。该异常事务不回写行，物理状态可仍为 pending+已过期；下一次显式且满足门禁的新编号才清理旧租约，不伪称旧记录已被异常 RPC 持久改成 failed。
- 显式 Mock 新意图可完成替代结果，旧 worker 的迟到 finish accepted=false；不会改变新结果/新租约。数据库租约不等于生成许可。
- 入场提交后策略撤销：0 次 dispatch，failed 安全结算，没有虚构 usage；同编号再试 AP006。
- 模拟 429 和 503 后策略撤销：只发生 1 次内存 fetch，重试前拒绝，没有第二次发送；保留实际模拟失败 attempt，token/费用均 NULL，未新增“门禁拒绝 attempt”。
- 迁移历史保留与 012 未知定义拒绝也在此 12 项内。Mock 中的 allow 只是测试依赖，生产工厂、执行策略和配置接口均未修改。

新增 22 项基础设施单元测试覆盖目标校验、环境白名单、分片帧/错误 SQLSTATE、输出上限，以及 **4 次真正的独立 Node 前置检查**：缺开关、缺路径、相对路径、不存在路径都返回 exit 2/BLOCKED，不会假 PASS；无数据库目标或迁移。

## 8. 发现与修复

没有获得原生事务/锁/并发故障证据，因此**没有声称发现或修复真实并发缺陷**，没有修改生产代码或迁移。

开发期发现并修正的是测试基础设施/夹具问题：Node strip-only 不支持参数属性；Next 的 ProcessEnv 类型要求 NODE_ENV；联合 Promise 类型与未使用导入；Review 合成 submissionId 空串违反旧表约束。改为可擦除 TypeScript、常量 test 环境、明确类型及 NULL 合成字段。初轮新集成 5 FAIL/7 PASS 的失败来自该夹具字段，修正后 12/12；未修改数据库约束、删断言或调高原有测试预算。迁移多语句使用 ON_ERROR_STOP，避免最终事务命令掩盖错误。

## 9. 完整回归

回归在私有临时副本中实际执行，排除 `.env*`，环境白名单/空 HOME，B3 原 guard 不变；没有安装依赖。本轮没有调整旧断言、跳过失败测试或增加原测试预算。

| 实际执行命令 | 结果 |
| --- | --- |
| `npm run lint` | PASS，exit 0，0 警告 |
| `npm run typecheck` | PASS，exit 0 |
| 下列 8 文件专项 | PASS，134/134，0 失败，6.09 秒 |
| `npm run test -- --maxWorkers=1` | PASS，495/495，46 文件，0 失败，99.69 秒；原 461 项保留，新加 34 项 |
| `npm run test:recommendations -- --maxWorkers=1` | PASS，36/36，8 文件，0 失败，78.14 秒 |
| `npm run build` | PASS，exit 0，含 postbuild Monaco/旧 sanitizer 检查 |
| `npm run test:e2e` | PASS，58/58，0 失败，29.4 秒；桌面与移动，本地 HTTP 契约替身，retries=0 |
| `git diff --check` | PASS，exit 0 |
| 原生专项入口（第 2 节） | BLOCKED，exit 2；20 项原生用例 NOT_RUN |
| 核心退出计数汇总 | FAIL / collection_failed：27 份已发布、1 份不完整、0 无效；counters=NULL |
| E2E 退出计数汇总 | PASS：17 个 Node runtime，incomplete=0、invalid=0；浏览器原生流量计数 UNKNOWN |

专项的实际完整命令：

```sh
npm run test -- tests/unit/native-postgres-infrastructure.test.ts tests/integration/generation-state-consistency.test.ts tests/unit/generation-gate.test.ts tests/unit/generation-gate-api.test.ts tests/unit/generation-paths.test.ts tests/unit/review-workspace.test.tsx tests/integration/review-database.test.ts tests/integration/m2-database.test.ts --maxWorkers=1
```

证据：[核心命令与退出状态](/private/tmp/algopilot-m353-checks-gpnpFG/checks.json)、[核心日志](/private/tmp/algopilot-m353-regression.log)、[E2E 汇总](/tmp/algopilot-gate-e2e-tgn5fU/e2e-audits-SYVuDH/checks.json)、[E2E 日志](/private/tmp/algopilot-m353-e2e.log)。六项核心命令均 exit 0；私有验证器最终 exit 1 来自退出计数不完整，不能写成验证器完全通过。

完整功能回归的源文件副本与最终源码逐字节核对；唯一工具生成差异是 `next-env.d.ts` 的构建路径，未修改源工作区。E2E 私有副本沿用既有工厂 Fixture 接线及 browser routing；源工作区生产工厂无测试接线。本次新增原生/PGlite 测试由核心回归覆盖，不属于浏览器用例。

## 10. 文件范围

| 文件 | 内容 |
| --- | --- |
| `package.json` | 新增 `test:isolated:m353`；原检查入口不变 |
| `scripts/m353-isolated.mjs` | 无下载的原生临时集群入口、目标核对、迁移/历史/清理与 BLOCKED 报告 |
| `vitest.native.config.ts` | 单独的 node 原生专项入口；不跳过默认用例、不放宽已有预算 |
| `tests/native/psql.ts` | 独立 psql 会话、SQLSTATE 分帧、目标校验与迁移失败保护 |
| `tests/native/setup.ts` | 仅测试环境 server-only mock |
| `tests/native/recovery.native.test.ts` | 20 项原生事务/并发/RLS/门禁用例，NOT_RUN |
| `tests/fixtures/generation-sql.ts` | 原生/PGlite 共用的 SQL 测试适配器，未接入生产 |
| `tests/integration/generation-state-consistency.test.ts` | 12 项完整迁移和门禁状态串行 PGlite 回归 |
| `tests/unit/native-postgres-infrastructure.test.ts` | 22 项基础设施与前置拒绝检查 |
| `docs/MILESTONES.md` | 已验与原生待验进度分栏 |
| `docs/M353_NATIVE_STATE_VERIFICATION.md` | 本报告 |

B3 五文件、001–012 全部迁移、Tutor/Review/Provider/生产工厂/门禁、Prompt/Schema、推荐算法与历史保留规则均保持 HEAD 内容。最终 HEAD 仍为 `ee2646334b8d19af8779011fa38c5704723dce7e`；工作区 **2 个修改、9 个新增、0 暂存、0 删除，合计 11 文件**，全部保留人工审核。

## 11. 网络与安全审计

已执行阶段使用内存 Provider、PGlite 和拒绝优先的原生前置入口；没有真实资格检查、真实模型端点、生产连接字符串或真实用户材料。E2E 额外处于 macOS sandbox-exec 外部网络拒绝、仅 loopback 允许的操作系统沙盒中，浏览器使用临时空上下文及禁外部请求路由。该本地测试执行权限不包含安装、系统数据库服务或外部访问；没有自动审批拒绝事件。

核心汇总时 `42689-0.pending` 为 0 字节且没有匹配 JSON；保留该事实，没有删标记、补零、发布残片或改 B3 guard。没有足够证据断言该进程为何未完成退出写入。其他已发布记录不足以代表全部进程，核心计数汇总为 collection_failed，counters=NULL；之后只读收集原生测试列表也不能补齐这份记录。

| 审计对象 | 本轮结果与范围 |
| --- | --- |
| 真实模型生成 / B4 / 付费 API / 付费回退 | 0 / 0 / 0 / 0；无真实调用动作，生产默认拒绝，测试仅内存或固定 loopback Fixture |
| 生产数据库读取 / 写入 / 托管迁移 / 部署 | 0 / 0 / 0 / 0；无生产 URL，无本机原生实例，只有合成 PGlite/HTTP 数据 |
| 真实凭据主动读取 | 未执行；没有读取真实 Key/.env 的开发或测试动作。全进程读取计数 UNKNOWN：核心退出记录不完整；完整 E2E 的 realCredentialReads/credentialReadBlocked 为 0/0 |
| 外部 HTTP / DNS 全进程计数 | UNKNOWN / UNKNOWN：核心退出记录不完整、原生浏览器/background 不在 Node 计数覆盖内；不据其他进程的零计数外推 |
| E2E Node 外部计数 | 17 份完整记录的 networkBlocked/dnsBlocked/credentialReadBlocked/externalHTTP/realDNS/realCredentialReads 均为 0 |
| E2E 页面路由 | 12 份 worker 记录，共 4669 个允许的 loopback 页面请求、0 个拒绝请求；不含所有服务间调用或 Chromium 原生后台流量 |
| Chromium 原生 HTTP / DNS | UNKNOWN / UNKNOWN，操作系统策略拒绝外部网络但没有生成实际流量数量统计 |
| 私人数据/源码外发 | 未执行外发动作；测试材料只复制到本地私有副本。无法给所有进程提供完整外部流量计数，保持 UNKNOWN 测量边界 |
| 下载 / 安装 / 拉镜像 / 系统服务 / Clash/TUN 改动 | 0 / 0 / 0 / 0 / 0 |
| Git commit / push / PR / 破坏性操作 | 0 / 0 / 0 / 0 |

完整采集的早期离线轮次（包括新增 34 项）计数均为 0；不能用早期轮次取代最终核心计数缺口。失败记录仍保留在临时日志与本报告中。

## 12. 分类结论

- **BLOCKED**：原生运行环境不可用；真实免费资格仍缺可信验证源。
- **NOT_RUN**：20 项原生多连接、独立 authenticated LOGIN/RLS、实际锁超时/连接终止验证；011/012 托管迁移；真实 JWT/PostgREST/多实例；B4、生产部署。
- **PASS**：新增离线 34/34、相关专项 134/134、全量 495/495、推荐 36/36、E2E 58/58、lint/typecheck/build/diff；E2E 有界审计通过。
- **FAIL**：核心退出计数汇总 collection_failed（1 份不完整记录）；开发期夹具/类型错误已修正并记录。最终功能测试失败 0，但不能把审计或原生目标一并称为 PASS。

## 13. 剩余风险

真实锁顺序、竞争/死锁、隔离级别交错、backend 崩溃、角色独立登录/继承、原生 pgcrypto/扩展及本机 PostgreSQL 版本兼容性仍未验证。新原生 psql 驱动的数据通道、集群启停及迁移清理路径仅静态检查与拒绝路径通过，不能声称成功路径已端到端验收。PGlite 通过的是串行 SQL 与应用状态逻辑。

单次数据库入场、单次应用 dispatch 和远端实际执行次数不同。即便未来原生用例 PASS，也不能单独证明远端只执行一次。已进入传输的模拟 attempt 不因后续撤权而抹除；真实使用仍须独立资格/授权，生产默认拒绝继续生效。

## 14. 后续边界

本轮到此停止。若将来已准备好本地原生二进制，可显式指定目录重跑本次 20 项测试；不能在本轮下载补环境。无需原生数据库的门禁/训练/复盘回归可以继续直接执行。

托管目标核对、真实 JWT、011/012 应用、部署和 B4 均须新的相应授权。**本地 PostgreSQL PASS 不等于托管 Supabase 已部署、权限已验证或生产环境已经验收；本轮连本地原生 PostgreSQL PASS 也未取得。**
