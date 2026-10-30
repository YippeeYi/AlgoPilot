# MVP R1：原生 PostgreSQL 验收准备与审计接线

日期：2026-10-30，Asia/Shanghai。**R1 准备范围 PASS；只验证准备设施，未启动 PostgreSQL、未运行原生数据库测试。** 原 20 项和新增 013 的 14 项均 NOT_RUN，环境/授权 BLOCKED；托管、真实模型和 B4 均 NOT_RUN。历史两次网络拦截继续 **UNRESOLVED / UNKNOWN / FAIL**，R1 不解释或改写它们。本轮另一次拦截的 FAIL 也保留，见第 6 节；最终离线 PASS 不等于全部审计历史通过或 MVP 可发布。

## 1. 实际 Git 与边界

起始 HEAD：`c0d6ff0782a38188e78fe18641755fa5a451f89a`，工作区干净。R0 七文件已经提交，不能继续视为未提交修改。本轮未联网核对 main，没有 reset/clean/commit/push/PR 或部署。

已核查 R0 门禁/缺口、M353 原生报告、AGENTS、原生入口及全部 tests/native、原收集器/lifecycle/B3 guard、R0 诊断工具、013 原 SQL 与现有训练反馈 SQL 回归。沿用 DEVELOPMENT_PLAN v3.4 的产品/权限边界，只改测试基础设施和文档，不改产品、门禁、算法、研究定义或历史迁移。

## 2. 审计覆盖差异与结果判定

| 项目 | R0 时入口 | R1 准备实现 |
| --- | --- | --- |
| Node 根/后代/线程 | 直接 B3 guard，缺 .started | 既有 diagnostic preload → lifecycle → 原 B3 guard；继承环境的 Node fork/worker 都留启动/结束与 PID/PPID/threadId |
| 阶段 | 单批 Vitest，缺阶段关联 | `audits/native-state` 和 `audits/native-feedback` 两个独立目录；诊断阶段白名单仅增加这两个固定值 |
| 功能状态 | 仅 Vitest exit | 每阶段退出码/信号 + JSON 计数；原 20、新 14 分栏，必须全部通过且 pending/todo/failed 均 0；缺报告/格式异常不算 PASS |
| 安全审计 | 无完整汇总 | 原 collector 检查启动/结束/待发布/格式/六计数；诊断 collector 检查上下文/拒绝事件关联；另外核对所有 context 都属于预期阶段及实际 spawn PID 的主线程记录 |
| 失败策略 | 功能成功可能被误称审计成功 | `functionalStatus`、`auditStatus`、`rootObserved`、阶段 status 独立；任何一项不满足则阶段 FAIL，记录缺失为 UNKNOWN/counters=NULL，不补零 |
| 后续迁移 | 只到 012 | 001–012 + 原 20 功能/Node 审计/数量均通过后，核对目标，再应用 013、比对历史摘要，再运行独立 14 项；前一门失败不进入下一门 |

`scripts/native-node-audit.ts` 负责受控 Node 启动、等待 close、复用两收集器和独立判定；收集器异常只返回固定 COLLECTION_UNAVAILABLE/UNKNOWN，不输出异常原文。传入现有收集器是为同时兼容 Vitest 和 Node strip-only TypeScript；不改变全局编译设置。新进程 env 来自原 nativeEnvironment 常量及生成目标，不展开 supervisor 的 process.env。目标 JSON 只含本次随机本机目标，不含凭据。

既有原 collector、lifecycle 和 B3 guard **不修改**；无忽略未知记录、补写记录、网络白名单或“测试成功即审计成功”。诊断仅在原 guard 已拒绝后记类别/固定 API 名/脱敏本地帧/单调时间，不记参数、URL/目标、SQL、Key、原始环境或请求正文。

## 3. 合法 loopback 与未覆盖部分

- **Node 测试侧仍禁止全部 guard 网络入口，包括 Node loopback connect/fetch。** 新故障注入在连接前确认这一点，没有把本机 HTTP 全面放行，也没有把 networkBlocked 擅自归类为模型访问。
- **合法数据库传输是原生 psql**：原 PsqlConnection/applyMigration 不变，nativeEnvironment 校验随机 `m353_<16hex>`、本轮私有临时集群/home、绝对二进制目录及非特权端口；psql 固定 `-h 127.0.0.1`、本轮端口/随机库、明确角色、`-X`、空 HOME、PGPASSFILE/PSQLRC=/dev/null。迁移和清理前继续实际核对数据库/目录/监听/角色。没有新增 Node PostgreSQL 网络驱动。
- supervisor、initdb/pg_ctl/psql、PostgreSQL daemon、原生绑定/未插桩进程**没有系统调用/网络/凭据读取探针**。Node 审计 PASS 只覆盖声明的插桩 Node 测试阶段；这些原生对象的 HTTP/DNS/凭据读取为 **UNKNOWN**。固定启动参数和数据库 attestation 证明受控目标，不能证明整个原生进程所有流量为零。
- 普通用户认证仍是合成 claims，不是真实 Supabase JWT；三个数据库 backend 不是三个应用实例。系统级原生进程遥测若是正式环境的要求，须由环境负责人额外提供，不能靠本报告升级覆盖。

## 4. 原 20 项保留

`tests/native/recovery.native.test.ts` 与 HEAD 字节相同，Git blob 均为 `30569b91d427ecb6a7bdbd6bf7822110aae0d099`。原 psql 驱动、native config 和原 20 项的任何断言、3 个 authenticated LOGIN、READ COMMITTED、锁屏障、超时、回滚/终止/租约/幂等、跨 Tutor/Review/门禁规则均未改变。

入口第一阶段只过滤运行该原文件，保留单个文件内真实独立连接交错；没有以顺序单连接模拟并发。第二个文件另起 Vitest 阶段，不能把 34 的合计掩盖原 20 少跑。离线动态 list 实际收集 **20 + 14 = 34**，只执行模块加载和测试定义，**不执行 hooks/SQL**；不记为 34 个原生 PASS。

## 5. 013 独立增量：已实现、未原生运行

新增 `tests/native/training-feedback.native.test.ts`，14 个实际参数展开用例。beforeAll 只在获准原生运行时读取生成目标，核验数据目录和 3 个不同 backend 的 authenticated/current_user=session_user、NOINHERIT/NOSUPERUSER/NOBYPASSRLS、READ COMMITTED、实际 loopback 目标；管理连接只做合成 seed、目录观察和约束负例，业务 RPC 使用普通独立角色。CF HMAC 为显式合成 fixture，不读取真实 Key、不访问 CF。

| 项 | 原生增量断言与场景 | 当前状态 |
| --- | --- | --- |
| 1 | RLS 启用；anon/authenticated 表 DML/SELECT 无权限；3 RPC SECURITY DEFINER/search_path/EXECUTE/PUBLIC；FK/唯一/check/部分唯一索引 | NOT_RUN |
| 2 | 同 run 并发签名记录，观察真实锁等待后提交；回放同 receipt，改变意图 PT409、伪签名拒绝 | NOT_RUN |
| 3 | 合法前缀+非法题目后缀整体回滚，无部分来源；修正后重用请求 ID | NOT_RUN |
| 4 | 并发显式 skip，同一时间戳、无训练创建，不作为失败/能力事实 | NOT_RUN |
| 5 | 同 receipt 并发 start，仅一个新训练；重试恢复同 ID，已选择后 skip PT409 | NOT_RUN |
| 6 | 两个 run 同题并发 start，共用一次训练、恰一个 originated；部分唯一索引直接拒绝第二来源 | NOT_RUN |
| 7 | 旧 active 训练恢复，草稿/revision/状态完整不变；无历史来源回填，originated=false | NOT_RUN |
| 8 | 另一用户的 receipt/session/skip/start 拒绝、私表直接访问拒绝；同 runId 按用户隔离；组合 FK 与用户/run/题唯一负例 | NOT_RUN |
| 9 | 持有事务创建训练后回滚，等待 backend 重新取得 receipt，回滚训练/来源不残留 | NOT_RUN |
| 10–12 | self_reported/unsolved/not_recorded 反馈与官方状态分栏；原 receipt 恢复已结束历史；新 solved 选择冲突 | NOT_RUN |
| 13 | 来源记录后偏好 revision 变化，拒绝旧选择，无部分训练归因 | NOT_RUN |
| 14 | 原文件裸重放失败；单独 psql ON_ERROR_STOP=1 退出回滚，函数哈希/ACL/历史不变 | NOT_RUN |

并发用例先保存 backend PID，异步发第二请求，管理连接在 1.5 秒屏障内观察 `wait_event_type='Lock'` 且 `pg_blocking_pids` 指向真实持有者，才提交/回滚。没有用 sleep 或顺序调用冒充锁竞争。新增用例默认测试预算未调高，beforeAll 为 30 秒；原 20 的预算原样。

### 迁移/历史/重复应用

固定次序：001–005 后生成原有合成历史 → 006–012 → 原 20 → 013 → 增量 14。013 仅在本次新建隔离库首次应用；**未修改 001–013**，部署仍只追加/只应用确认缺失迁移，不把原 013 当幂等迁移。

report.migrations 只是本次临时库的成功执行列表，不是托管 schema_migrations 状态，更不会补建或 repair 托管历史账本。

013 前后 `nativeHistorySql` 对 14 个 public 历史表生成行数+稳定排序 JSON 的 MD5 摘要（完整会话含兼容 code_draft、思路快照、复盘/请求/提示/usage、计划、偏好/反馈），不输出用户行或私有 settings。MD5 仅用于本机一致性，不作为安全签名。普通历史缺少可信推荐来源不会被补记 receipt。现有串行 PGlite 用例已验证 013 裸重放为 42P07 并回滚；原生负例通过真实原文件执行失败及前后状态核验准备，尚未运行。

013 的官方 WA/OK/撤权语义已有离线合成 SQL 回归；本轮不新增真实 CF 采集、不扩大实际账号预算，不把这些串行结果当原生并发或托管结果。

## 6. 无 PostgreSQL 的验证

新增 **16 项** Node 审计合成用例实际启动受控 Node 根/fork/worker，验证两个阶段、正常结束、SIGTERM/SIGINT、SIGKILL、忽略被杀子进程、缺启动/坏记录/未发布、根 PID、context 错配另一合法阶段、功能失败但审计成功、强行把拒绝进程退出码改 0 仍审计 FAIL、DNS/合成敏感路径/Node loopback 拒绝、测试报告少跑/skip/todo/错误/损坏拒绝。负例只使用假参数和本地私有目录，原 guard 在连接/读取前拒绝；不为故障注入执行真实网络或读取真实文件。

新增 PGlite 准备测试实际执行同一 nativeHistorySql，验证 001–012 的合成旧记录/思路历史经原 013 保留，新增来源表为空，并证明真实后续编辑可被摘要检测。它只证明 SQL/摘要与串行兼容性，不能证明 PostgreSQL 原生行为。

首次准备专项出现 3 个 suite 加载失败：jsdom 的 import.meta.url 经 Vite 成为 HTTP 来源，默认 ESM 加载器拒绝；当批另外 52 项通过。没有实际网络请求/连接、主阶段审计无拒绝。改为显式注入原收集器后，准备专项 68 项通过；随后新增 Node loopback 负例，最终结果见下节。此问题是本轮新测试工具缺陷，与历史两次网络调用无因果证据。

### 本轮实际新拦截及夹具最小修复

首轮完整包装检查的专项阶段功能 264/264、exit 0，但审计 **FAIL：networkBlocked=1**，其他五计数 0，40/40 记录完整。对应 `19986-0.json`、phase=targeted、PPID=19980；脱敏事件 operation=fetch，栈包含 `src/lib/api-client.ts` → `src/components/learning/training-feedback.tsx` → React effect。**这是本轮的新记录，不是历史两份记录的栈。** API 是 fetch、模块调用点已知，实际目标/正文未记录，具体触发时序仍 UNKNOWN；不能据此声称真实外部服务或模型被调用。

只读核查发现已安装 Vitest 默认 sequence.hooks=stack；setup 的 afterEach(cleanup) 先注册，工作台文件 later 注册的 unstub/restore 先执行。因而 fetch 已恢复时组件仍挂载，这是一个可独立证明的夹具生命周期缺陷。一次私有 A/B 强制 teardown tick 的原 20 项各通过、零拦截，**未复现网络事件**，不作为因果证明。

新增真实挂载 effect 的卸载期断言，要求 global fetch 仍是该测试 fixture。私有副本相同 21 项在原顺序下 **20 PASS/1 FAIL**，只把 cleanup 放到 unstub 前后 **21 PASS/0 FAIL**，两个 Node 审计均 PASS；不触发真实网络，不改产品。中间一份私有驱动有重复 import 夹具错误，修正后才使用上述 before/after 结果，不算产品缺陷。源文件只加入 cleanup 前置、必要 import 和 1 项回归，原 20 个工作台断言保留；原生 20 项完全不动。

这项修复保证已挂载树先清理，再恢复测试替身；**没有证明上述 fetch 事件的完整调度原因，更不能消除历史两次 UNKNOWN 或该轮 FAIL**。故障记录保留，后续绿色检查仅说明相应受控运行结果。

## 7. 实际命令、功能与审计结果

所有 npm 子命令在既有私有副本机制下执行：排除 `.env*`，空 HOME/环境白名单，原 B3 拒绝路径，无安装或真实服务连接。`--native-readiness` 是新增离线入口，**不设置有效数据库目标，不启动集群**，只执行审计/前置保护/PGlite/定义收集。

| 实际执行 | 功能结果 | 主阶段审计 |
| --- | --- | --- |
| `node scripts/check-offline.mjs --native-readiness` 首轮 | 52 项 PASS，3 suite 因新工具加载方式 FAIL；包装器 exit 1 | 13/13，PASS，CORRELATED，六计数 0 |
| 同入口，改用显式收集器后 | **68/68 PASS**，exit 0 | 16/16，PASS/CORRELATED，六计数 0 |
| 同入口，最终原生准备专项 | **70/70 PASS**，7 文件；审计 16、原生前置 22、定义收集 1、历史摘要 SQL 1、原训练反馈 SQL 13、原审计/诊断 17 | 16/16，PASS/CORRELATED，六计数 0。20+14 动态定义收集不是数据库通过 |
| `node scripts/check-offline.mjs` 首个完整轮次 | 相关 **264/264 PASS**；全量 **854/854 PASS**；推荐 **36/36 PASS**；lint FAIL（新文件空 catch）、typecheck/build FAIL（新工具 env 类型缺固定 NODE_ENV），包装器 exit 1 | 共 165/165；其中 targeted 审计 **FAIL/networkBlocked=1**，其余五计数 0；其他阶段 PASS。实际上下文/栈见第 6 节，未删除 |
| 私有组件 teardown A/B 原 20 | 两侧 **20/20 PASS**，没有重现网络事件 | 两侧 PASS；这不是网络因果证明 |
| 私有组件 lifetime 断言前/后 | 原顺序 **20 PASS/1 FAIL**，修正顺序 **21 PASS**；中间错误驱动另保留 | 两侧审计 PASS，网络 0；不为断言制造实际连接 |
| `node scripts/check-offline.mjs` 最终完整轮次 | lint/typecheck **PASS**；相关 **265/265 PASS**（18 文件，13.42 秒）；全量 **856/856 PASS**（74 文件，118.46 秒）；推荐 **36/36 PASS**（8 文件，78.24 秒）；build 含 postbuild **PASS**；包装器 exit 0 | 六阶段 PASS/CORRELATED，记录分别 **2/2、3/3、40/40、105/105、10/10、34/34**，合计 **194/194**；每阶段六计数 0，无新拒绝事件 |
| 仅 loopback 系统沙箱中 `node scripts/test-offline-e2e.mjs`（既有 `npm run test:e2e` 的脚本体） | build PASS；Chromium 桌面/移动 **136/136 PASS**，约 1.3 分钟，retries=0，exit 0 | Node **55/55**、browser **12/12**；原 collector PASS，页面允许 **9684**/拒绝 **0**；Node 六计数 0，原生浏览器后台 HTTP/DNS **UNKNOWN** |
| `git diff --check`、原生/迁移/产品边界核对 | **PASS** | 原 20/psql/native config/B3/lifecycle/原 collector/001–013/全部 src 无差异 |

准备专项的精确子命令：

```sh
npm run test -- tests/unit/native-node-audit.test.ts tests/unit/native-postgres-infrastructure.test.ts tests/unit/native-readiness-plan.test.ts tests/integration/native-r1-readiness.test.ts tests/integration/training-feedback-database.test.ts tests/unit/offline-audit.test.ts tests/unit/offline-diagnostics.test.ts --maxWorkers=1
```

完整入口实际执行 `npm run lint`、`npm run typecheck`、check-offline 内 targeted 文件列表、`npm run test -- --maxWorkers=1`、`npm run test:recommendations -- --maxWorkers=1`、`npm run build`。本轮两次全量的差异来自已记录的新工具类型/阶段归属检查和已证明的 fixture 生命周期修复；没有为碰运气重复全量、提高预算或跳过失败。

最终源码与完整检查副本对比 **305 文件，0 差异**；与 E2E 副本同一 305 文件比较，除既有私有 runtime-provider Fixture 接线与 17 份 spec 的导入重写外相同。源生产工厂无测试接线，原真实模型门禁不变。之后只收尾文档，没有继续改源码。

临时证据（可能被系统清理；稳定结论与条件在本文保留，不补造丢失记录）：

| 日志（`/private/tmp/` 下） | checks.json 所在目录 |
| --- | --- |
| `algopilot-r1-readiness-initial.log` | `$T/algopilot-replay-checks-sqKr6u/` |
| `algopilot-r1-readiness-fixed.log` | `$T/algopilot-replay-checks-K1oTLf/` |
| `algopilot-r1-readiness-final.log` | `$T/algopilot-replay-checks-i3v4Gz/` |
| `algopilot-r1-full-checks.log`（保留 FAIL） | `$T/algopilot-replay-checks-meoH3k/`；事件在 `audits/targeted-diagnostics/19986-0.1.event.json` |
| `algopilot-r1-teardown-probe.log`（未复现） | `/private/tmp/algopilot-r1-teardown-9lRbkx/` |
| `algopilot-r1-teardown-lifetime-fixed-driver.log`（稳定断言） | `/private/tmp/algopilot-r1-teardown-85OY1Q/` |
| `algopilot-r1-full-final.log` | `$T/algopilot-replay-checks-R4647R/` |
| `algopilot-r1-e2e-final.log` | `$T/algopilot-gate-e2e-T6ljxL/e2e-audits-yPerRe/` |

`$T` 仅为文档缩写：`/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T`。不要求设置此环境变量。上述主阶段零计数**不包括**刻意负例的独立临时审计目录；负例原始 FAIL/UNKNOWN 经断言验证后按测试清理，不能据主阶段值声称所有被测调用从未触发拒绝或所有进程流量为零。受监控 externalHTTP/realDNS/realCredentialReads 为 0 只是原 guard 字段，不是系统抓包。原生 daemon/psql 和浏览器后台未测值保留 UNKNOWN。

## 8. 后续负责人的实际执行步骤（本轮不执行）

1. 环境负责人提供现成 `postgres/initdb/pg_ctl/psql` 的**绝对目录**，确认同一个可信 runtime、四程序完整版本一致且 >=16，以及本机一次性测试用途。没有 runtime 时继续 BLOCKED；不下载/安装/搜索/拉镜像/启动系统服务。
2. 新授权明确包括：私有 `/private/tmp/algopilot-m353-native-*` 临时集群启停、仅 loopback 的随机库、合成用户/claims/密钥、001–013 首次迁移、011/012 重放和 013 故意失败裸重放、20+14 用例、必要 backend 终止与清理。该授权不包含已有数据库、托管项目、模型或 B4。
3. 审核本轮代码。已有 npm/Node 依赖从本地使用，不加载真实 `.env`/连接串或 API Key。在仓库根执行（替换占位目录）：

```sh
M353_ALLOW_DATABASE_TESTS=isolated npm run test:isolated:m353 -- --bin-dir /absolute/existing/postgresql/bin
```

4. 入口重新创建私有副本、空 HOME，保留原版本/随机端口/目标 attestation/历史与清理保护，先原 20 再 013 增量。出现 BLOCKED/FAIL 即停止，不绕过审计、手改计数或手工连真实库“补验”。
5. 保存 `NATIVE_REPORT` 指向的 native-postgres.json、vitest.json（20）、vitest-013.json（14）、native-state-evidence.json、native-013-evidence.json、audits 两阶段与对应 `*-diagnostics` 目录、必要本地日志。审阅每阶段 functionalStatus、auditStatus、rootObserved、phaseAssociated、testSummary 完整数、原始六计数与记录数；原生进程及外层 shell/npm/supervisor 流量/读取未完整插桩，保持 UNKNOWN，另列环境级外网拒绝/私有配置与监测证据。
6. 要求原 20/20、013 14/14、两个 Node 审计 PASS/CORRELATED、original20/incremental013 PASS、13 个迁移、historyPreserved=true、history013 前后摘要相同，以及目标/安全清理证明；功能 PASS 不代替审计、角色、锁证据。exit 2 为 BLOCKED，exit 1 为 FAIL，均不能填通过数。
7. finally 仍只停止并删除已 attested 的本次 cluster，报告/副本/日志保留；目标或停止无法确认时 FAIL 并保留，不手工删除不明服务。功能失败时已确认的临时 cluster 也可能安全清除，保留的证据用于定位，不承诺失败库必留。

这是未来执行说明，环境与启停授权尚未提供。本轮普通测试只走缺开关/缺目录/非法目录等前置拒绝，不启动临时集群。成功运行这些原生准备用例后，也须另行完成真实 JWT、托管 011–013、多用户/应用实例、免费资格与独立生成许可。

## 9. 文件与结论

| 文件 | 变更 |
| --- | --- |
| `scripts/m353-isolated.mjs` | 两阶段、独立状态、20/14 完整数、013 迁移和历史摘要；原前置/目标/清理保留 |
| `scripts/native-node-audit.ts`（新） | Node 审计运行器、根/阶段判定、原生遥测边界、报告计数及历史 SQL |
| `scripts/offline-diagnostic-preload.cjs`、`scripts/offline-diagnostics.ts` | 仅增加两个固定 native 阶段；原诊断字段与拒绝规则不放宽 |
| `scripts/check-offline.mjs` | 新无 PostgreSQL 的 `--native-readiness`，原完整入口仍保留 |
| `scripts/test-offline-e2e.mjs` | 将新工具/测试包含到私有副本；原生产/loopback 策略不改 |
| `tests/native/training-feedback.native.test.ts`（新） | 14 项 013 原生增量，未运行 |
| `tests/unit/native-node-audit.test.ts`（新） | 16 项真实 Node 合成故障/拒绝/关联检查 |
| `tests/unit/native-readiness-plan.test.ts`（新） | 动态 list 20+14，无 hooks/SQL |
| `tests/integration/native-r1-readiness.test.ts`（新） | 同一历史摘要 SQL 的 PGlite 执行/013 保留/变动检测 |
| `tests/unit/workspace-continuity.test.tsx` | 已证明的 fixture cleanup 顺序修复与 1 项卸载期回归；原 20 保留 |
| 本报告（新）、`docs/MVP_RELEASE_GAPS.md` | 最新证据、执行条件与剩余阻塞；R0 历史报告不改 |

最终 HEAD 仍为 `c0d6ff0782a38188e78fe18641755fa5a451f89a`，工作区 **7 修改 + 6 新增 = 13 文件，0 暂存、0 删除**，均未提交。

| 分类 | 最终结论 |
| --- | --- |
| **PASS：R1 准备范围** | Node 审计接线及故障注入、原生前置保护、013 独立测试准备/串行 SQL、定义收集、最终离线 lint/typecheck/265/856/36/build/E2E/diff |
| **FAIL：保留记录** | 初轮工具加载/类型/lint 失败与稳定 fixture 回归失败已修复；首轮专项那次 networkBlocked=1 的审计 FAIL 保留，调用点已知但具体触发时序未证明 |
| **BLOCKED / NOT_RUN：原生** | 未提供现成目录与临时集群启停授权，原 20 和 013 的 14 项全部 NOT_RUN；没有以 PGlite 或收集列表替代 |
| **NOT_RUN：真实服务** | 托管 011–013/真实 JWT/两用户/多实例、免费资格/真实 Provider/费用/B4；生产默认拒绝。没有真实 Key、生产连接、托管写入、Clash/TUN、安装、镜像、系统服务或招募动作 |
| **UNRESOLVED：历史审计** | 之前两次拦截继续 UNKNOWN/FAIL；本轮新事件和夹具修复不能反向归因历史 |
| **UNKNOWN：监控边界** | 未插桩原生进程/绑定/外层启动层及浏览器后台的完整 HTTP/DNS/凭据读取；不补成零 |

完整 MVP 的 P0 仍未通过，禁用 AI 也不免除真实身份与数据库安全。本轮已停止，所有修改供人工审核；只等待负责人提供原生环境并明确授权正式运行，不自动进入 R2/R3、托管操作或模型实验。
