# MVP R1 正式原生 PostgreSQL 验收

2026-11-02，Asia/Shanghai。**P0-A 本轮原生范围 PASS：原 20/20、013 增量 14/14 实际执行通过，两个 Node 审计均 PASS。** 使用真正 PostgreSQL 16.15、独立 authenticated LOGIN、真实锁/事务/RLS，不以 PGlite、顺序单连接或列表收集替代。托管 Supabase、真实 JWT、多应用实例、真实免费模型及 B4 **NOT_RUN**；完整 MVP 仍不能发布。

稳定、脱敏的机器证据见 [execution-evidence.json](r1-native/execution-evidence.json)。本报告保留安装/启动/测试失败，历史两次 UNKNOWN/FAIL 及 R1 额外拦截的 FAIL 均未撤销，也未被本轮结果反向归因。

## 1. 基线与授权

起始 HEAD：`e280bfafa10fa9503c537c4fa4e2c1999ae27274`，工作区干净，上一轮 R1 的 13 文件已提交。实际读取 AGENTS、DEVELOPMENT_PLAN v3.4、R1 准备/发布缺口/M353 历史、原入口/驱动/审计、两份原生测试及 001–013。没有 fetch/reset/clean/commit/push/PR。

本轮负责人明确批准本机可信软件安装、新建临时集群、合成数据、001–013、故障注入及清理，覆盖此前本机安装/原生执行禁令；没有扩大为现有数据库、托管、模型、网络配置或发布授权。

## 2. 本机与安装

| 项 | 实际结果 |
| --- | --- |
| 系统/CPU | macOS **27.2 / 26B123**，**arm64 / Apple Silicon** |
| 身份/空间 | uid **501** 普通用户，非 root；开始约 **254 GiB** 可用 |
| Homebrew | 已有 `/opt/homebrew/bin/brew`；prefix/Cellar 由当前用户所有，无需 sudo/安装 Homebrew |
| 初始 PostgreSQL | PATH 无四程序；`/opt/homebrew/Cellar`、opt 无 PostgreSQL/libpq；16/17/18 默认数据目录不存在。系统进程只读检查未发现 postgres/postmaster，不连接或改动已有库 |
| 来源/版本 | 官方 `homebrew/core`，**postgresql@16 16.15_1**；四程序均输出 **PostgreSQL 16.15 (Homebrew)**，实际 Mach-O arm64 |
| 路径 | `/opt/homebrew/opt/postgresql@16/bin` → `/opt/homebrew/Cellar/postgresql@16/16.15_1/bin`；不改 shell/global PATH |
| 完整性 | 实际 bottle SHA-256 **31b8c98844e409376dc0fc7801e09f25c5c7b3c175c77b929ad9bb51aef3095d**，与 Homebrew arm64_golden_gate 官方 manifest 一致 |
| 默认数据/常驻服务 | 安装前后 `/opt/homebrew/var/postgresql@16` 均不存在；未运行 brew services，未创建对应用户 LaunchAgent/系统 LaunchDaemon，未设置自启 |

安装前阅读了 [Homebrew 公式](https://formulae.brew.sh/formula/postgresql@16)、[公式代码](https://github.com/Homebrew/homebrew-core/blob/HEAD/Formula/p/postgresql%4016.rb) 和本机 install 命令实现：默认 postinstall 会初始化默认数据目录，因此明确跳过。Homebrew 的 keg-only 定义和安装行为见[官方手册](https://docs.brew.sh/Manpage)。实际版本/校验来自本机输出与下载文件，不只依赖网页。

在空的本轮 HOME、私有 cache/logs、白名单环境中执行：

```sh
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 \
HOMEBREW_NO_ANALYTICS=1 HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1 \
/opt/homebrew/bin/brew install --skip-post-install --skip-link postgresql@16
```

外围实际还固定了 HOME/PATH/HOMEBREW_CACHE/HOMEBREW_LOGS，完整日志保留在 `/private/tmp/algopilot-r1-brew-install.log`。未执行 sudo、brew update/upgrade 全局操作、cleanup、services、shell 配置或代理/Clash/TUN 改动。已有 PlayCover tap 的不信任警告被 Homebrew忽略，未执行 trust/untap 或相关安装。

| 软件变化 | 本轮结果 |
| --- | --- |
| postgresql@16 | 新增 16.15_1 |
| icu4c@79 | 新增 79.1 |
| ca-certificates | 新增 2026-10-20 |
| openssl@4 | 新增 4.1.0 |
| krb5 | 新增 1.22.2_2 |
| readline | 新增 8.3.6 |
| libunistring | 必要依赖升级至 1.5，原 1.4.2 仍保留，没有 cleanup |

gettext/lz4/zstd 复用现有安装。变化按 Cellar 安装前/后目录逐项比较，保存在证据 JSON；没有无关软件升级。允许保留上述软件供后续测试复用。

**安装阶段确实联网**：Homebrew API/JWS、manifest 和 7 个 bottle 下载/校验，公共来源为 Homebrew/ghcr.io；不是外部流量零。未进行包管理器全链抓包，实际请求/字节总数为 UNKNOWN，不能将测试阶段的零计数套用到安装。

## 3. 隔离与 trust 修正

启动前静态核查发现旧入口的 `--auth-host=trust` 允许其他本机进程冒充任意角色，loopback 本身不足以阻止。最小安全修正为：

- 本轮每次运行新建 `/private/tmp/algopilot-m353-native-*`，根/home 0700，随机 `m353_<16hex>`、随机非特权端口；只监听 127.0.0.1。
- initdb 本地与 TCP 均使用 **scram-sha-256**；随机 256-bit 合成密码，只写入 0600 私有 bootstrap/pgpass 文件，**不放入 env、M353_NATIVE_TARGET、日志或报告**。bootstrap 文件在 initdb 后移除，最终密码文件在确认停止后移除。
- authenticated 仍 LOGIN/NOINHERIT/NOSUPERUSER/NOBYPASSRLS；没有用管理员代替普通请求。真实登录缺少密码被拒绝，实际 pg_hba_file_rules 仅 scram-sha-256。
- 仅使用 TCP，关闭不需要的 Unix socket；不为 PostgreSQL 放开 Node fetch/http/tls。Node 预载仍是原 lifecycle/diagnostic/B3 拒绝规则。
- psql 使用 `-X`、私有 PGPASSFILE、PSQLRC=/dev/null、空 HOME、固定 127.0.0.1/本轮端口/库/角色，不读真实 `.env` 或连接串。
- 引导 CREATE DATABASE 前先在引导 postgres 库核对目标；每次迁移在同一 psql 连接、SQL 文件之前再次核对目录/库/host/port/listen/current_user。故障用例前和租约过期/终止前增加实际目标核对，清理前再核对。

合成 claims/HMAC 和密码均为本轮测试数据；这不证明 Supabase JWT。私有文件控制其他 OS 用户读取，不能宣称抵御同一 OS uid 下可读文件/控制进程的恶意程序；本机账号与测试代码仍是信任边界。

数据库测试实际命令始终为现有入口：

```sh
M353_ALLOW_DATABASE_TESTS=isolated npm run test:isolated:m353 -- \
  --bin-dir /opt/homebrew/opt/postgresql@16/bin
```

外围 `/private/tmp/algopilot-r1-run-native.sh` 仅负责空环境、两个私有空 npm 配置、禁 npm 更新/联网，以及 `sandbox-exec` 的 **deny network、只 allow loopback** 策略；没有替代/简化原 34 项。没有改变系统全局安全或网络配置。实际进程级策略如下，也用于最终 Chromium E2E：

```scheme
(version 1)
(allow default)
(deny network*)
(allow network* (remote ip "localhost:*"))
(allow network* (local ip "localhost:*"))
```

## 4. 失败证据、分类与最小修复

每次失败均保留原报告；失败后先检查原始证据再修复，不靠删除、跳过、改预算或碰运气获得 PASS。

| 尝试/证据 | 实际结果与根因 | 修复 |
| --- | --- | --- |
| `native-first.log` | npm 在集群创建前拒绝 user/global 同时使用 /dev/null，尚无数据库 | 外层改为两个不同的私有空配置文件，未读取个人 npm 配置 |
| `native-run1.log` / **m5B2PM** | initdb 成功；pg_ctl 因系统沙箱拒绝 Unix socket 而退出；无迁移/测试 | 关闭不需要的 Unix socket，只用已有 TCP loopback 许可；不扩大网络规则 |
| `native-run2.log` / **M4QJD5** | 引导目标断言失败；只读实际证据是 inet::text=`127.0.0.1/32`、host(inet)=`127.0.0.1`，其他目标均匹配 | 目标/角色元数据查询改用 host(inet_server_addr())，仍精确比较 127.0.0.1。未接受其他地址或弱化目录/角色检查 |
| `native-run3.log` / **v5Ggkp** | 原 20 中 **16 PASS/4 FAIL**；首个 Review 并发 finish 在管理观察连接读取 code_hash，同时观察锁，触发 busy；后续另有适配器冲突 | 创建 Review 夹具时提前读取不可变 hash，finish 不再占用管理观察连接；真正两用户连接竞争不变 |
| `native-run4.log` / **1EfqvZ** | **17 PASS/3 FAIL**；Orchestrator 的 Promise.all 在同一 psql 测试客户端交错 BEGIN/查询，驱动正确拒绝 busy | 仅测试 SQL reader 按单客户端排队完整事务；a/b/c 各自独立，不存在跨 backend 全局队列。新增单位回归证明另一客户端可并行完成 |
| `native-run5.log` / **6uqVJO** | **19 PASS/1 FAIL**；Tutor 完成后的 composite json_agg 有格式换行，驱动误把每个换行当结果行；实际 SQLSTATE 没有业务错误 | JSON 解码按引号/转义/容器边界识别逻辑行；保留上限和坏/不完整数据拒绝。新增多行与失败前缀回归 |
| `native-run6.log` / **TbEHVa** | 原 **20/20 PASS**；013 **10 PASS/4 FAIL**；save/transition 返回 composite 文本，违反驱动 JSON 协议 | 对测试调用补 to_jsonb，RPC/Auth/事务/业务预期不变，不放宽驱动接受任意文本 |
| `native-run7.log` / **Qq26Y5** | **20/20 + 14/14 PASS**，Node 审计 PASS | 随后加强 013 裸重放的实际 SQLSTATE 证据 |
| `native-final.log` / **d0iGvB** | 原 **20/20 PASS**；013 **13 PASS/1 FAIL**；新增提取器误将五字严重级别 ERROR 当代码，非迁移问题 | 提取器只接受行末 SQLSTATE，新增前缀/隐私内容回归；不把该 ERROR 统计当数据库 SQLSTATE |
| `native-final2.log` / **vvj2HK** | **20/20 + 14/14 PASS**，013 重放真实 **42P07**；全部功能/Node 审计/清理通过 | 最终正式原生证据 |

表内日志完整路径为 `/private/tmp/algopilot-r1-<名称>`，例如 `algopilot-r1-native-run3.log`；集群根为 `/private/tmp/algopilot-m353-native-<标识>/`。原始 native-postgres.json、vitest.json、vitest-013.json、两个 evidence JSON、审计记录、必要日志均在对应根内。

这些是**安装启动、测试基础设施/夹具/诊断**问题；未发现需要修改产品业务逻辑或历史迁移的故障。`src/`、生产免费门禁与 **001–013 字节保持 HEAD**，不需要新的增量迁移。原 20/14 的名称、数量、并发、真实锁屏障、权限/事务/历史断言和预算保留；013 新增的 SQLSTATE 断言更严格。

## 5. 最终真实数据库证据

最终目标：`/private/tmp/algopilot-m353-native-vvj2HK/cluster`，数据库 `m353_b7f579c9107c8556`，127.0.0.1:**49972**，listen_addresses=127.0.0.1，管理角色 fixture_admin。版本 **16.15**；实际目标核对通过后才迁移、故障注入和清理。

| 项 | 实际结果 |
| --- | --- |
| 原 20 项 | **20 PASS / 0 FAIL / 0 SKIP / 0 TODO** |
| 013 增量 | **14 PASS / 0 FAIL / 0 SKIP / 0 TODO** |
| 普通后端 | 原阶段 **52052/52053/52051**；013 阶段 **52100/52099/52101**；每阶段 3 个真实不同 authenticated LOGIN，current_user=session_user，READ COMMITTED，无 superuser/bypassrls |
| 角色 | authenticated LOGIN=true、inherit=false、superuser=false、bypassrls=false；anon LOGIN=false。额外管理观察/故障终止连接另计，不冒充用户连接或应用实例 |
| 真实锁 | 原阶段 **11**、013 阶段 **5** 次 Lock + pg_blocking_pids 观察，共 **16**。代码在实际持有者/等待者屏障后才提交/回滚；没有用顺序调用替代 |
| 真实事务/故障 | 锁超时 55P03 后 25P02、显式 rollback 重试、RPC 后 22012 回滚、backend 终止/未提交释放、已提交租约显式恢复，原有断言均实际执行 |
| 权限/幂等 | 同 requestId/run/receipt 竞争、单训练来源、指纹冲突、归属/私表/私列拒绝、直接 DML 拒绝、FK/唯一/check、CAS/revision 与迟到结算通过 |
| 迁移 | **001–013 依次实际应用**；011/012 真实重放不变；013 裸重放 **42P07**、原子回滚，函数/ACL/历史不变。逐文件 SHA-256 见 JSON；这是临时库执行列表，不是托管账本 |
| 历史 | 005 创建的旧 NULL problem 训练经 006–012 完整不变；013 前/后 **14 表摘要逐项相同**，historyPreserved=true |
| 审计 | 两阶段各 **2 started/2 completed**，rootObserved/phaseAssociated=true，CORRELATED、issues=[]，六计数均 0；Node auditStatus=PASS |

SQLSTATE 为实际 psql 帧/迁移诊断收集，未记录 SQL 正文：

| SQLSTATE | 原 20 次数 | 013 次数 | 断言含义 |
| --- | ---: | ---: | --- |
| 00000 | 1116 | 371 | 成功帧，不是请求/费用统计 |
| AP004 / AP006 | 6 / 8 | — | 活跃租约/过期恢复 |
| AP003 | 1 | — | 共享入场额度 |
| PT409 | 4 | 4 | 指纹/意图/revision 冲突 |
| P0002 | 6 | 3 | 不存在/无归属 |
| 42501 | 12 | 3 | 签名/私表/私列/DML 权限拒绝 |
| 55P03 / 25P02 | 2 / 2 | — | 真锁超时与失败事务 |
| 22012 | 2 | — | 注入 SQL 异常后回滚 |
| 23503 / 23505 / 23514 | — | 1 / 2 / 1 | FK/唯一/CHECK 或业务约束 |
| 42P07 | — | 1 | 013 真实裸重放拒绝 |

13 迁移后历史摘要包含 **23 训练、11 复盘、13 Tutor 请求、13 Review 请求、8 Tutor 消息、4 hint_events、10 authorizations、1 usage**。思路快照/计划及关联/偏好/推荐反馈在该迁移边界是零行，空摘要保持只能证明空集未变，不能冒充非空历史覆盖；这些功能的其他历史用例仍按既有离线证据分栏。013 的旧训练恢复用例另验证了非空草稿/revision/状态不变。

数据库真实角色/锁/事务是本轮原生证据；Orchestrator 生成部分使用显式内存 Mock 或默认拒绝 Provider，没有真实模型传输。两个顺序 Vitest 进程不等于多应用实例；合成 claims 不等于 Supabase 签发/验证 JWT。

## 6. 网络与安全审计

| 范围 | 结果与限制 |
| --- | --- |
| 安装阶段 | 明确发生官方元数据与必要包下载，另留 brew plan/install/changes/hash 证据；总流量/请求/凭据访问系统级计数 UNKNOWN，未伪称零 |
| 原生测试 | 系统 sandbox-exec 不改全局配置，只允许必要 loopback；Node 仍禁止 fetch/http/tls/DNS/敏感路径。合法数据库通信是经目标核验的原生 psql，不放行 Node 网络 |
| 最终 Node | 原生两阶段各 2/2、六计数 0，审计 PASS；生命周期/事件/阶段/根 PID 与功能和 20/14 完整数独立判断 |
| 原生进程 | PostgreSQL/psql/initdb/pg_ctl 和外层启动器没有全系统调用/网络计量，完整 HTTP/DNS/文件读取次数 **UNKNOWN**；OS 拒绝策略不等于测得尝试数 0 |
| 真实服务/私人材料 | 未读取真实 Key、真实 `.env`、生产 URL 或私人用户材料，未连接真实模型/CF/Supabase，未外发私人材料；只使用合成输入和本机实例，不把未测全设备计数补零 |
| 历史审计 | 原两次 UNKNOWN/FAIL 与 R1 额外 fetch FAIL 仍保留。后者已关联 TrainingFeedbackPanel/requestJson，完整触发时序尚未证明；本轮没有新的未知网络尝试，不对历史做新归因 |

## 7. 清理与软件保留

最终成功实例在清理前核对实际随机库、目录、地址/端口/监听/角色，关闭所有测试连接，再 **pg_ctl -m fast stop** 正常停止；status 返回 3 后才删已核验 cluster，stopped/clusterRemoved/syntheticCredentialsRemoved 均 true。本轮额外 SQL 核验失败的引导实例 **M4QJD5** 经 read-only 全目标匹配后正常停止/删除，独立 cleanup-verification.json 保留，未覆盖其原 FAIL。

唯一首轮 **m5B2PM** 是启动被 Unix socket 沙箱阻止的初始化目录：日志明确 shutdown，pg_ctl status=3，无 postmaster 进程；尚未创建随机业务测试库/完成 SQL attestation，按失败保留机制保留该私有初始化目录及日志，不猜测删除未完成 SQL 核验的目标。其合成密码文件已清除。它是本轮失败证据，不是运行中的服务或真实业务数据。

其余完成/失败的已核验运行均按原安全逻辑停止并移除 cluster；报告、代码副本、JSON/审计证据留在各临时根。只读系统进程及最终端口 49972 检查为空，未发现本轮残留 PostgreSQL 进程/监听；不对已有服务发出停止/删除命令。已安装 PostgreSQL/依赖保留，无 brew cleanup/uninstall、默认实例或自启。

## 8. 完整回归与 Git

| 实际命令/阶段 | 最终结果 | 范围 |
| --- | --- | --- |
| `node scripts/check-offline.mjs --native-readiness` | **71/71 PASS**，审计 PASS | 本轮首次离线前置验证；不是原生 34 项。后续新增回归已包含在最终全量 |
| `M353_ALLOW_DATABASE_TESTS=isolated npm run test:isolated:m353 -- --bin-dir /opt/homebrew/opt/postgresql@16/bin` | **20/20 + 14/14 PASS**，两阶段 Node 审计 PASS | 最终 `native-final2.log`，实际 PostgreSQL；外层使用第 3 节环境/沙箱 |
| `node scripts/check-offline.mjs` → `npm run lint` | **PASS**，0 warning | 最终私有副本 |
| 同上 → `npm run typecheck` | **PASS** | next typegen + tsc |
| 同上 → 固定相关专项 | **265/265 PASS** | 审计/诊断、历史恢复与相关交互，18 文件 |
| 同上 → `npm run test -- --maxWorkers=1` | **862/862 PASS**，75 文件 | 单元/集成/离线重放，含 PGlite 与模拟；不将其算入真实原生 34 项 |
| 同上 → `npm run test:recommendations` | **36/36 PASS**，8 文件 | 保留评分权重、原断言和预算 |
| 同上 → `npm run build` | **PASS** | 含 postbuild；未使用真实服务配置 |
| `sandbox-exec` 使用第 3 节策略运行 `node scripts/test-offline-e2e.mjs` | **136/136 PASS**，build PASS，retries=0 | Chromium 桌面/移动、本地 HTTP 契约替身；没有托管/真实模型验收 |
| `git diff --check`，新增文件独立 whitespace 检查 | **PASS** | 最终源码和报告 |

最终完整回归日志 `/private/tmp/algopilot-r1-execution-full-final.log`，报告 `/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-replay-checks-Vx30vY/checks.json`。此前完整回归 **861/861** 也通过，但发生于 SQLSTATE 提取回归加入之前，最终以 **862/862** 为准，不叠加测试数量。首次前置日志为 `/private/tmp/algopilot-r1-execution-preflight.log`。

六个最终离线阶段分别完成 **2/2、3/3、40/40、106/106、10/10、34/34** 个 Node 生命周期，共 **195/195**；各阶段 audit PASS、诊断 CORRELATED、issues=[]，`networkBlocked/dnsBlocked/credentialReadBlocked/externalHTTP/realDNS/realCredentialReads` 均为 0。故障注入专项在独立记录中有意制造阻断、缺失/损坏/未发布/异常结束，并断言 FAIL/UNKNOWN；这些预期拒绝不等于测试期间不存在任何合成拦截，不能抹去专项原始记录。

最终 E2E 日志 `/private/tmp/algopilot-r1-execution-e2e.log`，报告 `/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-gate-e2e-bhKt07/e2e-audits-ZbosK1/checks.json`：Node **55/55**、浏览器 **12/12** 完成，审计 PASS，六个 Node 计数均 0，页面路由允许 **9695**、拒绝 **0**。既有脚本只在私有副本注入 HTTP Mock、loopback 专用保护器与路由审计；源工作区生产 Provider 不变。浏览器原生/后台 HTTP 和 DNS 仍为 **UNKNOWN**。

收尾逐字比较 **307** 个当前源码/配置/测试/迁移文件与最终全量执行副本，无差异；原生执行所需 **12** 个关键源码与 `vvj2HK/workspace` 无差异，SHA-256 已附机器证据。E2E 副本的差异仅为既有脚本生成的 Provider 夹具与 17 个 spec 的审计 import 替换；其余源文件一致。这样可确认测试覆盖的是待审核源码，而非遗漏未跟踪新增测试的旧副本。

最终 HEAD 仍为 **e280bfafa10fa9503c537c4fa4e2c1999ae27274**；起始干净，最终 **8 个已跟踪文件修改 + 3 个新文件，共 11 文件**，全部未提交：

| 文件 | 变更 |
| --- | --- |
| `scripts/m353-isolated.mjs` | SCRAM、引导目标核验、TCP-only、最少日志、正常停止/凭据清理与实际启动状态 |
| `scripts/test-offline-e2e.mjs` | 私有副本纳入新 SQL reader 回归文件 |
| `tests/fixtures/generation-sql.ts` | 导出仅测试使用的单客户端事务队列 |
| `tests/native/psql.ts` | 私有密码文件、同连接目标核验、多行 JSON 解码、脱敏实际 SQLSTATE |
| `tests/native/recovery.native.test.ts` | 目标/SQLSTATE/backend 证据、夹具 hash 提前读取、独立客户端各自事务排队 |
| `tests/native/training-feedback.native.test.ts` | 目标/SQLSTATE 证据、composite JSON 协议、013 重放严格 42P07 |
| `tests/unit/native-postgres-infrastructure.test.ts` | 新增 4 项目标/JSON/SQLSTATE 失败回归，保留原保护断言 |
| `tests/unit/native-sql-reader.test.ts`（新） | 2 项事务队列失败恢复与独立后端并行回归 |
| `docs/MVP_RELEASE_GAPS.md` | P0-A 更新为本轮原生 PASS；P0-B/C 与历史问题保留 |
| `docs/MVP_R1_NATIVE_EXECUTION_VERIFICATION.md`（新） | 本正式报告 |
| `docs/r1-native/execution-evidence.json`（新） | 可版本化脱敏实际证据；不包含密码、SQL 正文、原始用户行或环境对象 |

`git diff --exit-code HEAD -- src supabase/migrations package.json package-lock.json` 无差异；没有修改产品源码、001–013、依赖锁或生产门禁，没有推荐权重/研究定义变动。旧 R0/R1 准备及 M353 报告保持历史原文。本轮到此结束，后续 P0-B/P0-C、其他浏览器和真人验收均需各自条件与负责人授权。

## 9. 发布门禁结论

- **PASS：P0-A 本轮原生范围**。34 项真实执行及数据库身份/锁/事务/RLS/约束/迁移/历史/Node 审计证据具备，可供负责人审查；不再以“缺 PostgreSQL”标记 NOT_RUN。
- **FAIL：历史失败保留**。本轮各次安装/启动/测试失败及修复前结果、旧审计 FAIL 全部保留，不用后续 PASS 删除。
- **BLOCKED / NOT_RUN：P0-B**。托管 001–013 当前状态、缺历史账本、真实 Auth/JWT/Cookie/撤权/多用户/多实例等仍需独立目标与授权，本轮没有托管访问或迁移。
- **BLOCKED / NOT_RUN：P0-C**。可信免费资格/项目与 Key 绑定/独立生成许可未建立；生产 Fail-Closed 不变，真实 Provider、usage/费用与 **B4 NOT_RUN**。
- **UNKNOWN / UNRESOLVED**：未插桩进程及浏览器后台的完整计量、历史两次和 R1 额外拦截的完整原因；无账单核验或真实模型质量结论。
- Safari/WebKit/Firefox、实体设备/硬件导航、真人可用性与教学收益仍未验收；真人 0/40、替代 0/5、参与者 0 不变。原生 PASS 不等于真实产品安全/效果或完整 MVP 可发布。

完成后停止，只保留软件、代码改动和验收材料供人工审核，不部署、不提交、不进入其他 P0 或 B4。
