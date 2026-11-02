# R2C：本机完整 Supabase 实际验收

2026-11-02，Asia/Shanghai。**PASS：最后一次完整 J01–J16 为 16/16，功能与受监控审计分别通过；完整 MVP 仍不可发布。**本文只评价本轮新建的本机平台；生产托管项目没有连接、写入或配置变更。

## 1. Git、授权与资料保护

实际 HEAD：`40fd472e46525eafba396b941d94152f07204ec3`，最终仍相同。初始工作区干净；最终 1 个既有文档修改、8 个新增文件，均未提交；没有 reset、clean、commit、push、PR 或部署。读取 R2A/R2B/R2B-0/R1 报告、当前计划、迁移链、Auth/Cookie、Repository、生成恢复、推荐来源及测试入口。原 34 项原生设施、生产源码、依赖/锁文件、001–013 迁移、推荐权重和 M3.4 定义没有修改。

本轮负责人已批准普通用户权限的本机安装、容器/合成 Auth/业务数据及清理。没有使用 sudo、管理员密码、系统安全设置、常驻服务或收费资源。所有资源均属于本轮专属目录 `/private/tmp/algopilot-r2c-58aaf00f`，在写原始结果前建立并核验根目录 **0700**、测试/CLI 原始结果文件 **0600**；每次运行使用新的私有 attempt。没有 TextEdit、Dashboard、iCloud 文件访问/扫描/清理，也没有读取真实 `.env`、用户 SSH/云凭据、CLI 登录缓存或真实 API Key。

原始材料仅留私有目录；入仓库的 [执行摘要](r2c/execution-evidence.json) 是字段受限的脱敏数据，已检查不含本轮实际合成密钥、密码、JWT、Cookie、邮箱、用户 UUID、签名/nonce 或正文。Lima 自行创建的宿主代理启动日志曾是 0644，但始终在 0700 私有根下；最终统一收紧至 0600。不把这类第三方日志冒充“从创建即全部 0600”。旧 iCloud 留存 **FAIL**、是否同步 **UNKNOWN** 原样保留。

## 2. 安装与实际平台

| 项目 | 实测 |
| --- | --- |
| macOS / CPU / 用户 | 27.2 / arm64 / uid 501 非 root；24 GiB 内存；开始时约 250 GiB 可用磁盘 |
| 已有运行环境 | 初查没有可用 supabase/docker/colima/podman，也未观察到相关运行服务；没有停止已有数据库或容器 |
| 安装渠道 | 已有 `/opt/homebrew/bin/brew`，`homebrew/core` 稳定 bottle；Colima 0.10.3、Docker CLI 29.9.2、Supabase CLI 2.122.0，唯一新增运行依赖 Lima 2.2.1 |
| 本轮 VM | Colima profile `r2c`，独立 COLIMA_HOME/DOCKER_CONFIG/HOME，VZ/aarch64、4 CPU、8 GiB、40 GiB 虚拟盘、host mounts=none、activate=false |
| Docker Engine | 29.5.2，位于本轮 VM；没有改变用户全局 context、代理、PATH/shell 配置或现有 PostgreSQL 16 |
| 本地项目 | 唯一 `algopilot-r2c-58aaf00f`；没有 login/link/远端 pull/push/repair |
| 实际服务 | PostgreSQL 17.11、GoTrue 2.197.0、PostgREST 16.5、Kong 2.8.1、Mailpit 1.31.3；Studio、Storage、Realtime、Analytics、Edge Runtime 未启用/未验收 |

安装前核对 formula 来源、依赖和服务定义；实际命令为 `brew install --skip-post-install colima docker supabase`，配合 NO_AUTO_UPDATE、NO_ANALYTICS、NO_INSTALL_CLEANUP、NO_INSTALLED_DEPENDENTS_CHECK 与本轮私有缓存/日志。没有 brew services、Homebrew cleanup 或无关升级。`brew cat` 曾自动设置 Homebrew 自身 developer 标志，已恢复该次新设置；CLI 版本探测在源目录产生的空 `.temp/cli-latest` 也仅按本轮创建证据移除。没有信任已有不受信任 tap。

四个 bottle 的来源/校验元数据、安装日志和 VM 配置在私有 evidence。来源分别为 [Colima](https://github.com/abiosoft/colima)、[Lima](https://github.com/lima-vm/lima)、[Docker CLI](https://github.com/docker/cli)、[Supabase CLI](https://github.com/supabase/cli) 的 Homebrew 稳定包。安装和镜像下载发生过真实外部网络，不能报告整轮 HTTP/DNS 为零。

官方镜像全部为 `public.ecr.aws/supabase`，arm64：

| 镜像 | 实际 RepoDigest SHA-256 |
| --- | --- |
| postgres:17.11.0.006 | `c141fd17ac6a76c4323e90b3aee8ff1a23d2e89e547c2b963cfadc309c079cc2` |
| gotrue:v2.197.0 | `1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b` |
| postgrest:v16.5 | `1347d7552b88f17832912c06afbf7c43209af6eeeb60834b04aae12c9bd9d5cc` |
| kong:2.8.1 | `1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d` |
| mailpit:v1.31.3 | `ed9b00c609e77e99c79b93f1178255ebc271868920f2c69a8d166bd5634ed10d` |

## 3. 本机隔离与迁移

Docker 使用带本轮标签的 **internal** 网络和 `host_binding_ipv4=127.0.0.1`。当前引擎在此网络没有实际发布端口；保留无外部路由，使用本轮 VM 自动生成的专用 SSH 配置，显式 `-L 127.0.0.1:本轮端口:本轮容器IP:服务端口`。最终使用 ControlMaster=no/ControlPath=none，避免转发留在复用 master。实际 Mac listener 全为 127.0.0.1；容器只接这一 internal 网络。CLI 泛化的“0.0.0.0”提示没有当作隔离证明，也没有忽略：核对的是实际网络/PortBindings/lsof。数据库在容器内的监听不是 Mac 的外部监听。

随机端口：API 59670、DB 59671、Mailpit 59674、Next I1/I2 59676/59677；其他本轮保留/探针端口 59672/59673/59675/59678。测试 Node 入口仅允许这些明确端口的 loopback HTTP/TCP；TLS、其他端口、外网 HTTP/DNS 和凭据文件读取仍在连接/读取前拒绝。原 B3 源文件没有改动。测试进程及 Chromium 另处于 `sandbox-exec` 的仅 loopback 网络策略中。

两次创建的数据卷都来自本轮已确认删除后的空平台。每次应用项目前均核对专属容器/网络/卷、数据库 `postgres`、`data_directory=/var/lib/postgresql/data`、Auth 用户数 0、training_sessions 不存在，然后用既有 CLI `migration up --local` 顺序应用原文件。第二次用于补齐冻结矩阵分支，没有对已有数据库 reset。

**001–013 全部实际执行成功，13 个版本账本完整。** 文件 SHA-256 见执行摘要；源迁移未改。第一轮所采集的平台 Auth/Storage/Realtime/Vault 关系及 Auth/Storage/Realtime/Extensions/Vault 函数摘要前后完全一致；001 明确增加的 Auth 用户初始化 trigger 单独属于项目变更。这是有界目录观察，不是所有平台对象的整库完整性证明。邮件经本机 Mailpit 捕获，不发送真实 SMTP。

使用平台本机合成 JWT 配置、随机合成 HMAC/密码。新本机 Auth TTL 配为 60 秒以实际等待刷新/过期，**未缩短 180 秒业务租约**。该 TTL 仅用于本轮合成环境，不是生产配置建议。业务请求均使用 GoTrue 实际签发、Auth 和 PostgREST 实际验证的 A/B JWT；没有手设 claims、SET ROLE 或用 service-role SDK 代测。

## 4. 目录对照与平台差异

固定系统目录 SELECT 在本机执行后得到：42 函数、27 关系、246 列、68 索引、175 约束、16 Policy、3 个项目普通 trigger。011/012 两个 reserve 的修复正文与 013 三 RPC 的正文均匹配 013 参考；五者均 SECURITY DEFINER、search_path=''、PUBLIC/anon 无 EXECUTE、authenticated 有 EXECUTE。013 私表 RLS、唯一来源索引、外键/CHECK 同在目录范围内核对。

**严格 PGlite 参考比较仍为 MISMATCH，51 项，不能改称完全 MATCH：**34 个 public 函数多 service_role EXECUTE，16 个 public 表多 service_role 权限，public schema 多显式 USAGE；没有额外应用对象。其余比较字段没有差异：246 列、68 索引、175 个约束、16 Policy、3 trigger 匹配。参考引擎是 PG18.3，187 个 PG18 NOT NULL 目录项已由既有比较器逐列核对等价，没有忽略其他约束。roleCapabilities 匹配。

这些本机平台 ACL 与普通 A/B 的实际拒绝测试分栏；比较器没有放宽/白名单化，托管 preflight 依然 Fail-Closed。不能用本机 service_role 差异解释生产项目额外函数的来源/挂载，也不能据此消除 R2B-0 的差异、ABSENT 账本或数据效果缺证据。没有自动提出可执行的托管迁移。

## 5. J01–J16 实际矩阵

最终完整批次 `attempt-0qAzBM` **16/16 PASS**，不是只把定向复验拼成一次完整通过。I1/I2 实际 PID **82407/82408**，主构建 PID 82279、驱动 PID 82409；进程阶段、父 PID、单调起止时间及实际退出值见摘要。I1 在故障场景受控 SIGTERM（143），I2 在最终清理 SIGTERM（143），两者均完整发布审计。真实租约等待及结算阶段 **183652 ms**，两实例固定 CF 请求间隔 **3040 ms**。

| ID | 实际范围与阳性/阴性对照 | 状态 |
| --- | --- | --- |
| J01 | A 经应用注册、本机邮件确认/PKCE 回调、登录；未确认时 401；真实 Auth JWT 与 getUser/SSR 对应 | **PASS** |
| J02 | B 独立浏览器 context、确认、登录及不同 subject | **PASS** |
| J03 | 两 Next 的 getUser=A，B 不串号；普通 JWT profiles 行与 Auth subject 相符；匿名 401 | **PASS** |
| J04 | 真实等待后 Cookie 更新、当次 SSR 身份保留、Set-Cookie/private no-store、浏览器私人页可用 | **PASS** |
| J05 | Auth/REST 自然到期拒绝、真实刷新、logout 浏览器拒绝、旧 JWT 窗口、refresh token 失效、重新登录 | **PASS** |
| J06 | 两用户训练/计划/草稿/追加笔记/Review 不可变合成快照；数据库 owner 等于真实 JWT subject | **PASS** |
| J07 | B 能读自身训练/计划/Review，列表不含 A | **PASS** |
| J08 | 已知 A ID 的应用读取 404、PostgREST RLS 空集、plan_detail P0002 | **PASS** |
| J09 | B 草稿/Review 修改拒绝；直接 draft RPC/plan_write P0002；A 快照及计划前后不变 | **PASS** |
| J10 | 普通 JWT 的直接 INSERT/UPDATE/DELETE、私列读取、伪 HMAC 均 42501；有正常路径阳性控制 | **PASS** |
| J11 | 两独立 PID 到达文件屏障后并发真实 RPC，CAS 一胜一 409；同 requestId 追加返回同记录 | **PASS** |
| J12 | 合成 reserve ACK 丢弃形成调用方 UNKNOWN，同号 pending 409、合成结算后缓存恢复；新生成仍 403 免费门禁拒绝 | **PASS** |
| J13 | Tutor/Review 同用户跨实例争用一胜一 busy；B 独立；两种 180 秒租约自然过期同号 AP006 映射、迟到 accepted=false、新号重试、共享默认 30 UTC 额度 429 | **PASS** |
| J14 | reviewEvidence 及官方分析授权分别在 guard 屏障中撤回，旧结果 409；I2 完成训练后 I1 迟到 Tutor 不增历史；Auth logout 另测 | **PASS** |
| J15 | 并发 run/skip/start、跨 run 同训练唯一来源、普通 JWT 外用户 choice/evidence 拒绝、旧训练不变；自报结果不冒充官方 AC | **PASS** |
| J16 | 两真实 Next PID/工作目录共享同一平台；跨实例同号/租约/撤权；固定 CF identity 夹具的共享 3 秒槽；停止 I1 后 I2 恢复既存历史 | **PASS** |

所有成功模型内容均为明确标记的合成 receipt 夹具，usage=[]，不是模型输出质量/费用验收；生产 Provider 工厂没有替换。私有 route 只接真实 getUser 的本轮合成账号，签名/lease_nonce 仅在服务端，不接受任意 SQL。源应用没有此路由或运行时假登录/Provider 开关。CF 使用现有 fetcher 注入接固定合成响应，保留真实 DB 时隙、冷却、预算，没有真实 CF 网络请求。

R2C 的“旧训练”是已经存在且没有推荐来源的合成训练，验证其恢复不重写历史；跨 013 的非空迁移前后保留继续复用 R1 证据，不用空库成功证明生产历史数据效果。

这里的应用 PID 与 R1 独立 PostgreSQL LOGIN backend 是不同证据；本轮通过实际 PostgREST 权限路径，未声称重新采集每次 HTTP 的 backend PID/pg_blocking_pids。Cookie 属性只在本机 HTTP 观察，生产 HTTPS/Secure/domain、托管签名/池化/延迟/故障和真实设备没有因此通过。

## 6. 失败、归因与最小修复

原始失败都在私有日志/各 attempt，未覆盖成 PASS：

1. 安装运行环境：internal 网络无发布端口，首次 DB ECONNREFUSED；首次 SSH 复用转发退出使 REST health check 失败。改为显式专用 loopback 转发并禁用复用；不放开容器外网。
2. 测试夹具：新增 guard 测试缺 NODE_ENV 导致 typecheck 失败；node 环境注解与仓库 window setup 冲突；一个空 catch 触发 lint。分别补必需字段、沿用既有 jsdom、加说明；没有放松既有断言/配置。
3. J05 夹具：先误预期 GoTrue 401，再误把数字 code 当机器错误码；实际 `403 / error_code=bad_jwt`，见 [对应 GoTrue 源码](https://github.com/supabase/auth/blob/v2.197.0/internal/api/auth.go)。保留两次完整批次的 J05 FAIL。
4. J05 定向复验：`exp+1.5s` 的 PostgREST 200 造成首次定向 FAIL；[PostgREST 16.5 明确有 30 秒时钟容差](https://github.com/PostgREST/postgrest/blob/v16.5/docs/references/auth.rst)。补测容差两侧，实际等待约 90.9 秒，Auth 403、REST 401/PGRST303、refresh token 400/refresh_token_not_found。退出时持有的未到期 JWT 仍能读 REST 200；不能宣传 local logout 立即吊销所有 JWT。[Supabase 会话说明](https://supabase.com/docs/guides/auth/sessions)
5. 合成清理脚本：直接删本轮 Auth 用户被 code_reviews_user_id_fkey 以 23503 拒绝；一次提前重跑因此只得到 Auth 前置失败。先核对只有两个本轮合成账号，再按所属范围清理 trials/Review/计划链接等依赖；未改 FK、触发器或历史 SQL。最终按已核验项目删除其专用卷，不依赖全表用户清理。

补齐冻结矩阵漏测分支后，又在已清理的本轮 VM 中建立第二个空平台并完成最终一次完整 16/16；没有因早期 15 项通过而忽略 J05，也没有无限重复等偶发绿灯。

未发现需要修改生产业务源码/追加迁移的确定缺陷。本轮代码只增加测试驱动、精确 loopback 传输/生命周期接线及 6 项拒绝回归；不是未知远端结构的适配修复。

## 7. 回归与审计

实际入口均在私有副本/0700 日志目录和仅 loopback 系统策略内运行，原 guard/collector 未降级：

| 实际命令 | 功能结果 | 审计范围 |
| --- | --- | --- |
| `node scripts/r2c-local-run.mjs /private/tmp/algopilot-r2c-58aaf00f` | **16/16 PASS**；前序 FAIL 原样保留 | Node **35/35**、浏览器 **1/1** PASS；页面允许 **48**、拒绝 **0** |
| 同入口 `--expiry-only` | J05 定向复验 PASS；前次容差内断言 FAIL 保留 | Node 35/35、浏览器 1/1，PASS |
| `node scripts/check-offline.mjs` | **lint PASS、typecheck PASS、265/265 专项、887/887 全量（78 文件）、36/36 推荐、build/postbuild PASS** | Node **202/202 PASS / CORRELATED**，六阶段 2/2、3/3、40/40、113/113、10/10、34/34 |
| `node scripts/check-offline.mjs --hosted-readiness` | 36/36 PASS，四前缀参考生成 | Node 10/10 PASS/CORRELATED |
| `node scripts/test-offline-e2e.mjs` | 136/136 PASS，retries=0、build PASS | Node 55/55、浏览器 12/12 PASS；页面允许 9687、拒绝 0 |
| `git diff --check` 与新增文件独立 whitespace/秘密检查 | **PASS** | 只检查待审文件，不读真实秘密 |

新增 6 项边界用例覆盖私有 root/manifest/端口拒绝以及外网 fetch、未批准 loopback 端口、DNS、凭据读取。四个合成拒绝子进程分别预期退出 91：networkBlocked=2、dnsBlocked=1、credentialReadBlocked=1；均在实际连接/读取前拦截。它们是独立故障注入，不能写成“本轮从未有拒绝”。

最终全量报告位于私有 `cache/algopilot-replay-checks-ayMjkh/checks.json`，E2E 在 `cache/algopilot-gate-e2e-3xXpIr/e2e-audits-dvbCjX/checks.json`，最后完整平台批次在 `attempt-0qAzBM/`；早期失败文件未修改。

正常受监控阶段的六计数为 0 的结论仅限其 Node 插桩记录，不延伸到软件安装、CLI/SSH/Docker/PG/Auth/PostgREST、浏览器后台或 OS。这些进程完整 external HTTP/DNS/凭据读取计数 **UNKNOWN**；已有 internal 网络与系统沙箱是隔离证据，不是丢包/流量全量测量。没有新增未知 Node 拒绝；没有真实 Key、模型、CF、托管 Supabase、B4 或付费操作。原两次 networkBlocked FAIL/UNRESOLVED、R1 额外 fetch 链的完整时序未证明状态均保留。

## 8. 清理、复用与文件

**两轮平台及最终清理 PASS。** 最终删除前核实：仅两个本轮合成用户、7 个训练、2 个 Review、29+2 个 Tutor/Review receipt、7 个来源记录、llm_usage 实际行数 0，归属无交叉，账本 13 版本。该 usage 计数只属于本机合成数据，不是模型账单证明。首轮与最后一轮都采用同一安全流程：核验本轮 5 个容器、专属卷和网络后，`supabase stop --project-id algopilot-r2c-58aaf00f --workdir 私有project --no-backup --yes`，仅删本轮合成数据卷；删除无 endpoint 的本轮网络，停止专用 SSH 转发与 Colima profile。所有本轮端口实际重新 bind 成功，未遗留 listener。最终 `colima stop` 退出 0、status 预期退出 1/not running，9 个端口均无 listener 且重新 bind 成功；本轮两个 Next 及转发均停止。未运行 --all/prune/reset。

软件/官方镜像与本轮停止的 VM 磁盘可以保留；不卸载、不 Homebrew cleanup、不设开机启动。原始失败及本地合成资料留私有目录，原数据库数据卷按上述范围删除。所有旧用户文件、PG16 与托管项目均未触碰。

待审变更：

- `scripts/r2c-local-boundary.mjs`：复用原 guard 的精确 loopback 和凭据拒绝；私有 manifest 校验。
- `scripts/r2c-local-run.mjs`：独立工作副本/构建/两 Next、进程阶段/PID/单调时刻、功能与审计分开、仅自有 PID 故障/清理。
- `tests/fixtures/r2c-private-route.ts`：仅复制到私有 app 的普通 JWT/受控签名夹具及屏障，无生产导入。
- `tests/live/r2c-auth-flow.mjs`、`tests/live/r2c-expiry-flow.mjs`：真实本机平台完整矩阵与有界过期复验。
- `tests/unit/r2c-local-boundary.test.ts`：6 项拒绝专项。
- 本报告、`docs/r2c/execution-evidence.json`、`docs/MVP_RELEASE_GAPS.md`：脱敏证据与缺口更新。

后续复用须仍以新私有项目/空卷、明确端口、internal 网络、目标身份/平台基线核对、原迁移文件和随机合成配置为前提。Supabase/Next 启动及迁移命令只使用显式私有 workdir、Docker socket；不读取源 `.env` 或执行远端命令。该 launcher 不负责安装、目标探测、托管认证或自动批准环境；不能把一份自填 manifest 当作生产授权。

## 9. 发布门禁与停止

**P0-A：保留 R1 原生 34/34 PASS**，本轮未改其设施/PG16、未重复算作新增原生测试。**P0-B：托管 BLOCKED / REVIEW_REQUIRED**；本机真实 Auth/RLS/双实例证据不能取代生产的 011–013、账本、额外对象、ACL、备份/恢复、真实托管 JWT/HTTPS/多实例验收。**P0-C：BLOCKED，B4 NOT_RUN**，生产免费模型门禁默认拒绝。

**NOT_RUN**：托管迁移/业务写入/真实模型与 CF 网络、真实 SMTP、Storage/Realtime/Functions、Safari/实体设备、真人及研究；**UNKNOWN**：非 Node/浏览器后台完整计量、旧 iCloud 同步/版本、历史未知拦截完整因果及生产数据效果/恢复能力。明确保留上述历史 **FAIL**，不以本轮绿色记录撤销。

完整 MVP 不具备发布条件；有限禁 AI 试用仍依赖未经托管验收的身份与数据库门禁，不在本轮授权内。完成本轮本机范围后停止，所有变更保留给人工审核，不自动进入托管变更、R3/B4 或部署。
