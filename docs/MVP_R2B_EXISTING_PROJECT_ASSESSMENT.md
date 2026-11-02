# R2B 调整：现有 Supabase 项目复用评估

2026-11-02，Asia/Shanghai。**本地评估 PASS；现有项目仅列为 R2B-0 只读候选，远端访问 BLOCKED / NOT_RUN。** 候选 Ref：`qmlsgwbiiqpbelgkgsdw`。负责人本轮确认该项目有真实用户数据；历史环境 main / PRODUCTION，继续按受保护生产项目处理，不改称 TEST。

**目前不能确定是否需要应用 011–013，也不建议直接应用。** 当前结构/账本/恢复能力均未重新核验。现有项目承担只读目录核验；34 项原生证据复用；Auth/RLS/并发及破坏性场景移到未来获批的本机完整 Supabase 栈。任何托管写入留作最后的独立决策。

## 1. 基线、证据和本轮边界

实际 HEAD **e2fb57c9f1b9b7dbaa8d54bf5ce69bcc47cc9c65**，初始工作区干净，R2A 修改已提交。读取 [R2A 报告](MVP_R2A_HOSTED_READINESS_VERIFICATION.md)、[M35 真实验收](M35_REAL_WORLD_ACCEPTANCE.md)、R1 报告/JSON、现有目录 SQL/比较器/preflight、001–013，以及 Auth/Repository 和清理相关外键。旧报告原文和审计 FAIL 保留。

| 事项 | 已知证据 | 当前结论 |
| --- | --- | --- |
| 项目身份 | 用户提供 Ref；M35 曾确认 main / PRODUCTION、PG17.11 | 候选身份可用于审批，**当前实际项目/分支/数据库目标仍未验证** |
| 真实数据 | 本轮负责人明确存在真实用户；历史记录有训练、笔记、提交证据和 Review | **必须保留**；不抽样/COUNT 用户表来证明数据存在；当前数量/完整性 UNKNOWN |
| 001–010 | 历史有效目录曾匹配，历史账本缺失 | 历史事实；当前不能据此标 PASS 或推定账本仍缺失 |
| 011/012 | 源 SQL、R1 原生及 R2A 本地前缀差异均有证据 | 当前托管定义 **UNKNOWN / NOT_RUN** |
| 013 | 本地新表/索引/三 RPC、R1 14/14 已通过 | 当前托管对象 **UNKNOWN / NOT_RUN** |
| RLS/ACL/owner/search_path | 已有固定目录查询与本地参考 | 当前远端 **UNKNOWN**，未调用业务 RPC 或访问私人行 |
| 备份/恢复/套餐 | 已查公共官方文档；无本项目备份证据 | 实际套餐、备份覆盖、可恢复性、RPO/RTO **UNKNOWN** |

本轮仅浏览公共 Supabase/PostgreSQL 文档和执行离线工具，没有打开项目 Dashboard/目标 URL、读取真实 .env/CLI 登录缓存/Key/密码/连接串、注册/登录/刷新远端用户或连接数据库。未安装/启动 Supabase CLI、容器或原生集群，无远端 SQL/迁移/DML/配置/部署。公共文档联网与离线进程计数分开，不宣称整轮外部流量为零。

## 2. R2B-0：有条件复用的只读流程

**能否承担？可以作为只读候选；执行许可尚未取得。** 这替代 R2A 对“只读阶段也等待新 TEST 项目”的环境安排，保留 R2A 的严格元数据比较、账本分栏和写入拒绝规则。现有生产项目不用于破坏性隔离验收。

### 等待负责人单独批准的最小范围

批准必须明确：本 Ref、待重新确认的分支/环境、操作者/通道、日期/有效窗口、只读身份核验及以下两份 SQL；不包含登录业务应用、getUser/Token 刷新、业务 RPC、私人表查询、备份导出或其他项目。优先由负责人在已核实的 SQL Editor 手工执行并提供脱敏元数据，助手不需要取得密码/Key。

| 顺序 | 固定核验材料 | SHA-256 |
| --- | --- | --- |
| 1 | [R2_READONLY_STRUCTURE.sql](sql/R2_READONLY_STRUCTURE.sql)：001–013 函数/表/列/约束/索引/RLS/Policy/ACL/角色和账本形态 | `65d8c53d6b358175427fc0bedabbcb358d54eacb3e876b3323c028b0257dde63` |
| 2（条件执行） | [R2_READONLY_LEDGER_VERSIONS.sql](sql/R2_READONLY_LEDGER_VERSIONS.sql)：仅 version 列 | `60a85e0e19e7a74a4018fd979349df998a8f83041fee8f082fd4441b5bb54f2a` |

获批后按以下顺序操作，本轮均未执行：

1. **先核对身份与数据库目标**：新鲜远端项目元数据应显示同一 Ref、组织/项目、main 或实际批准的分支、实际环境和规范 Project URL；核对所选 SQL Editor/Connect 通道确实属于该项目/分支及预期数据库/角色。地址格式、旧截图、成功连接或相同数据库名都不能单独证明目标。仅保留绑定关系/日期/验证结果，不收集连接密码或完整连接串。
2. 两份目录 SQL **不能自证 Project Ref 或完整连接身份**。若现有控制台证据不能可靠绑定数据库目标，保持 BLOCKED；需要补充当前 database/role 等 SQL 时，先提交新的 SELECT 审批，不能临场扩展已批准查询集合。
3. 在已核实的目标执行主 SELECT 一次；它只读取可信 pg_catalog 元数据，摘要化函数实现/默认值，不执行任何业务函数或查询私有配置行。确认查询版本/哈希及输出范围；超时、权限不足或目标变化即停，不通过修改角色、GRANT、全局超时或终止其他 backend 解决。
4. 第二条仅在账本关系/版本列存在、可信管理归属、普通表、内置 text/varchar、无 RLS 且操作者已有版本读取权限时执行。视图/外表、未知类型/Policy、不可读均 BLOCKED；缺表记 ABSENT，不导出 statements/name，不创建/修复账本。SELECT 的类型转换/视图/Policy 也可能调用用户代码，不能只检查语句首词。
5. 操作员审核后仅回传 audit 对象和 ledger 状态/版本；不含用户 UUID/邮箱/正文、Token/Cookie、密钥或摘要、原始环境。额外平台对象/潜在私人字面量先在受控界面审阅，不能直接上传未知导出物。
6. 用现有 `node scripts/check-offline.mjs --hosted-readiness` 生成四前缀本地参考，再用 `scripts/r2a-hosted-readiness.ts plan` 仅比较本地 JSON。参数格式沿用 R2A；不执行 link/pull/push/repair。缺账本、额外重载、ACL/owner/定义差异、部分结构都会阻断；PG18 NOT NULL 仅沿用逐列等价检查，不泛化忽略差异。
7. 输出独立 R2B-0 结果：当前观察时间/目标引用、结构有效前缀、011/012 定义和权限差异、013 对象、账本状态、未覆盖数据效果。**到此停止，不自动进入迁移、用户测试或备份。**

原 R2A preflight 没有连接/执行能力，PRODUCTION metadata-only 的申请也始终 BLOCKED；本轮未降低它。后续生产受控写入若确有必要，需要另审审批流程/执行工具，不能把现有项目重标 TEST 来消除 WRITES_REQUIRE_DEDICATED_TEST。

本轮已在离线副本核对 13 份源 SQL 与 [R2A 完整哈希清单](r2a/catalog-reference-summary.json) 一致，并重新生成 010/011/012/013 前缀参考。重点识别 `review_reserve(text,text)`、`tutor_reserve(text,text)` 的有效实现/签名/ACL；013 识别私表 `recommendation_trials`、`training_sessions_id_owner_key`、来源唯一/owner 索引和 `record_recommendation_run`、`recommendation_choice`、`recommendation_training_evidence` 三函数。前缀函数/表/列数为 39/26/235 → 013 的 42/27/246；这些是本地参考，不是当前候选项目的观测数量。

## 3. 011–013 的必要性与生产风险

**是否需要应用：UNKNOWN。** 先看有效结构、独立账本和兼容性，不能用功能报错推测迁移，也不能因为账本缺失重跑 001–013。

| R2B-0 未来观察 | 决策 |
| --- | --- |
| 011/012/013 对应结构、函数、ACL 已有效 | 不重跑 CREATE 或补丁；账本治理与历史数据效果单列，仍不自动补记 |
| 精确匹配 010/011/012 且确认后续缺失 | 才能讨论缺失文件提案。恢复条件未证实时不推荐直接应用；缺 013 的来源/反馈闭环仍未验收 |
| 函数摘要/ACL 不符、部分 013、账本未知/缺失/不一致 | BLOCKED，先保留差异、查明来源；无自动 repair、db pull/push 或覆盖函数 |

源码风险核对：

| 迁移 | 对已有数据/权限的影响 | 未来应用前要求 |
| --- | --- | --- |
| 011 | 替换 review_reserve 并 revoke/grant EXECUTE。DDL 本身不批量改历史；**后续请求**会按新语义处理同号过期、新号恢复、Tutor/Review 共享租约/额度。会影响所有调用该函数的现有用户，不是仅新增测试用户 | 核实当前签名/body/owner/SECURITY DEFINER/search_path、所有应用版本兼容，评估在途请求和维护窗口；不读取/重置 HMAC |
| 012 | 读取现有 tutor_reserve 定义并精确替换旧子句；已是新子句时返回，其他定义 23514。EXECUTE 重新收敛；后续 Tutor 过期同编号行为改变 | 不绕过 23514、不重写历史 SQL 适配未知远端；本机可重放不证明未知托管定义安全 |
| 013 | 为 training_sessions 新增 `(id,user_id)` UNIQUE；新私表 recommendation_trials 的用户/题目/训练 FK、CHECK、唯一来源/owner 索引，以及 3 个窄 RPC/ACL。SQL 不为旧训练伪造 provenance/skip，不回填用户正文 | 强表锁、索引构建/扫描、磁盘/WAL 与并发业务等待需实测容量/窗口；新 FK 改变删除依赖，新函数权限/归属和 CF 签名域需核验；裸重放 R1 已证 42P07，不在生产重放 |

013 的普通 ADD UNIQUE 需要强锁；PostgreSQL 文档说明多数 ADD table_constraint 使用 ACCESS EXCLUSIVE，ADD FOREIGN KEY 对相关表也取锁。因此根据该 SQL 推断，长事务/繁忙训练写入可能扩大等待和中断范围，实际锁等待/耗时在现有项目 **未测**。[PostgreSQL 17 ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html)

原 schema 的 `id` 主键使新增组合唯一在有效基线上逻辑冗余，仍有构建索引/获取锁的成本。不能为“在线部署”偷偷把历史 013 改成另一种索引/约束策略；如未来确需低锁方案，应单独评审追加迁移/部署策略，不在本轮生成执行。

三份迁移均有事务，事务失败可回滚当次未提交 DDL；**已提交后的撤销、后续用户写入、Auth/外部状态和整库恢复需要独立方案**。现无 down migration 或已验证线上恢复路径，不能承诺随时回滚。完整恢复可能覆盖备份之后的新训练/复盘，需明确 RPO/RTO、维护窗口与写入冻结/协调安排。

### HMAC、Auth 与清理影响

- 011/012 不旋转签名密钥；013 复用 verify_cf，不要求为了测试重配原项目的 Tutor/CF key。当前真实匹配情况 UNKNOWN；不读取 private settings、导出 key 或 key hash，不修改 Site/Redirect URL、JWT TTL、邮箱确认/模板、API/JWT signing keys 或数据库密码。
- 注册、登录、刷新、退出/撤销均可能写 Auth；不能通过“只打开现有应用页面”偷做 J03/J04。退出代码使用 local scope，不应为测试对真实用户执行全局撤权。
- 013 的 user/session FK 和原 Review FK 存在未声明 ON DELETE CASCADE 的路径；删新 Auth 账号未必能清净所有依赖，甚至可能被 FK 拦截。训练/Review 没有通用删除接口，不能承诺“测试账号删掉就全恢复”。不给生产生成临时清理 DML。
- CF 题库/缓存/时隙是共享资源：即使私有夹具仅用 A/B，发布固定 CF 数据或争用全局槽也会影响现有用户的题库与推荐。固定上游发布、额度耗尽、故障/lease 注入、删除和恢复场景全部放本机；仅有“使用测试用户”的承诺不足以隔离它们。

## 4. Free 备份与恢复：可选方式和当前缺口

以下为 **2026-11-02 公共文档核查**，不代表已查看本项目套餐/Backups 页面。官方 FAQ 明确 Free 不提供自动备份，建议手动 CLI 备份；自动日备份和 PITR 属于更高套餐/相应附加能力，不能作为本轮已有恢复条件。[Free 备份 FAQ](https://supabase.com/kb/faqs/platform/free-plan-backups)、[数据库备份](https://supabase.com/docs/guides/platform/backups)

| 方式 | 能证明什么 / 主要缺口 | 本轮状态 |
| --- | --- | --- |
| 现有 R2A/R2B-0 目录导出 | 结构/ACL/代码摘要，不含训练/Review/用户数据 | **不是数据备份**；不能据此恢复账号/正文 |
| Supabase CLI 手工逻辑导出 | Free 可考虑的手工路径；默认 db dump 不含数据/自定义角色，且会排除部分 managed schema（含 auth/storage），须按固定 CLI 版本核实实际覆盖 | NOT_RUN；不能把默认 schema.sql 当完整备份。[CLI dump](https://supabase.com/docs/reference/cli/supabase-db-dump) |
| 原生 pg_dump/相应角色与平台配置导出 | 可由获批维护者设计独立手工备份，但需要数据库访问、角色/扩展/Auth/ACL/平台兼容设计与恢复演练 | NOT_RUN；不以普通用户 RLS 视图的局部数据代替全备；不盲目恢复 Supabase 内部对象 |
| Dashboard 自动日备份/PITR/克隆 | 先核实项目实际可用权益/恢复目标/费用；不能假定 Free 可用或可再建项目 | UNKNOWN，未升级、开附加项或创建资源 |

备份必须另行核对 app public/private 数据、Auth 账号/身份/相关状态、角色/ACL、项目触发器、扩展/版本和签名配置的安全恢复安排。Storage 数据库元数据与对象文件分开，数据库备份不包含 Storage 文件；若项目使用它们，需要独立受控备份。[备份范围](https://supabase.com/docs/guides/platform/backups) 平台 Auth 设置/API keys 等也不能从“有数据库副本”推定已恢复。[平台克隆边界](https://supabase.com/docs/guides/platform/clone-project)

本机 R1 的 PostgreSQL **16.15** 不是备份兼容性的证明：旧托管为 PG17.11，当前版本 UNKNOWN，pg_dump 不支持导出比自身主版本更新的服务器。未来先核实服务器版本和实际 dump/restore 工具主版本，不能用现有 16 直接假定可备份该项目。[pg_dump 版本限制](https://www.postgresql.org/docs/current/app-pgdump.html)

**恢复准入至少包括**：负责人确认覆盖清单/一致性时点、加密离机副本及文件完整性、访问者/保留期限、恢复操作者/目标/工具、Auth/签名配置与对象存储处理、在隔离且受控目标完成的恢复演练、前后 ACL/归属/历史校验及 RPO/RTO。文件存在或导出退出 0 不足。没有新托管额度时，不能依赖“恢复到新 Free 项目”；安全本机恢复演练也不证明可原地恢复云平台全部配置。

完整备份会读取真实用户材料，private settings 还可能含签名密钥；它超出 R2B-0 元数据只读范围。将来需要**数据导出/秘密材料保管/恢复演练的独立审批**，由维护者在加密受控环境持有，不将原件、密码哈希、密钥或业务正文交给聊天/Git/普通测试目录。不要把线上整库 dump 导入日常合成测试栈。官方恢复教程是迁移指南，不是本项目可直接照做的命令集；其中改密码、建项目、配置/历史处理等步骤均未获批准。[CLI 备份/恢复流程](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

**现无可靠恢复证据，生产迁移/受控写入继续 BLOCKED，不建议直接执行。** 先完成只读观察和本机演练也可以推进，无需为了验收先动真实数据。

未来手工导出还须核对读取/I/O、连接、带宽/egress 和存储保管预算；本项目当前配额/费用未知，不承诺备份零成本，不自动升级套餐或启用 PITR 等付费能力。恢复演练应与普通合成开发环境分开审阅，避免把真实 Auth/密钥/正文带入日常测试。

## 5. 最小风险的环境拆分与 J01–J16

| 环境 | 承担任务 | 状态/边界 |
| --- | --- | --- |
| 现有托管候选 | 获批后，仅身份绑定与两份目录/条件账本 SELECT | 目前未授权，NOT_RUN；无业务 RPC/用户行或账号操作 |
| 现成原生 PG16.15 | 复用 R1 20+14 项功能/锁/RLS/历史/审计证据 | R1 PASS，本轮不重启或重复开发 |
| 新建本机完整 Supabase 栈 | 真正运行本机 Auth/邮件捕获/PostgREST/Postgres；普通 A/B、本机 JWT、两 Next 实例与合成故障/清理 | 安装/启动/接线未授权，BLOCKED / NOT_RUN；不连接现有项目 |
| 现有托管受控写入 | 仅当本机不能证明而发布必须补足、备份/恢复/影响/清理均明确时，另提最小正向 smoke | 当前不执行；不默认搬运破坏性矩阵；无可靠恢复措施不推荐 |

本机 Supabase 的 JWT 应由**本机 Auth 服务实际签发**并由本机 getUser/PostgREST 验证，比合成 claims 增加了完整服务链覆盖；签发者、密钥域、URL、网关/池化和部署环境仍与托管不同，不能提升托管 J 项状态。

以下是 R2A 既有用例的执行位置调整，**本轮每行实际执行均 NOT_RUN**。本机通过后也必须保留末列托管变体验收状态：

| 用例 | 优先本机完整 Supabase 验证 | 必须保留的托管 NOT_RUN |
| --- | --- | --- |
| J01 A 注册/确认/登录 | 本机 Auth + 本地收件箱/回调，不发真实邮件 | 云端注册/确认、真实 SMTP/回调部署与限额 |
| J02 B 独立身份 | 独立 context、用户、JWT，身份不混用 | 当前云项目两个真实测试用户链路 |
| J03 getUser/归属 | 实际本机 Auth→SSR→PostgREST、匿名拒绝 | 当前托管 issuer/签名/JWT/网关与身份链路 |
| J04 Cookie 刷新 | 本机真实 refresh、两实例 Cookie 同步/无串号 | 实际 HTTPS/domain/Secure/SameSite、云端刷新策略 |
| J05 logout/到期 | 本机真实期限和失效/刷新 Token；本机改 TTL 另批 | 当前托管旧 access JWT 的实际撤销窗口/过期行为，不动现有用户 |
| J06 合成业务创建 | 训练/计划/笔记/快照，保留真实 user JWT 及受控签名 | 获批托管 A/B 的真实写入/历史兼容；不生成 AI |
| J07 列表隔离 | A/B 自有合成记录和阳性控制 | 当前托管普通 JWT 的跨用户运行时隔离 |
| J08 已知 ID 直接读 | A/B API 与 PostgREST/RPC，非仅应用过滤 | 同路径在云端实际 RLS；目录标志不替代运行时 |
| J09 越权修改 | 本机拒绝写入，A 前后摘要不变 | 当前云项目对应拒绝写测试，仍需单独许可 |
| J10 受保护表/私列 | 普通 JWT 直接 DML、私列/HMAC 假签名拒绝 | 云 PostgREST 暴露面/ACL/角色继承的实际拒绝 |
| J11 CAS/并发 | 两 Next 进程共享本机 Supabase，真实事务/requestId | 云端连接池、延迟和两个应用实例共享目标的竞争 |
| J12 Review 原号/UNKNOWN | 合成 receipt/ACK 丢失/恢复，不调用 Provider | 当前托管 011 的请求恢复与部署路径 |
| J13 配额/lease | 本机 Tutor/Review 跨会话竞争/过期/释放，不占线上额度 | 当前托管共享租约/UTC 额度；生产不做耗尽注入 |
| J14 撤权/迟到 | 本机偏好/evidence revision、训练结束、lease 过期；Auth 撤销另分栏 | 实际云端时序/在途结果隔离；不撤销真实账号 |
| J15 013 来源/反馈 | 本机并发 run/skip/start、FK、旧训练恢复和 A/B 隔离 | 当前托管 013 实际 RPC/权限/历史；不写固定来源污染线上 |
| J16 多应用/CF 槽 | 两独立 Next PID，共享本机服务，固定 CF 响应；保留 3 秒/冷却/预算 | 两应用共享托管 DB 的池化/实例故障/限流；真实 CF 网络另未授权 |

本机使用新的合成用户、题目/提交夹具及 HMAC；保持实际生产模型工厂默认拒绝，不读取真实 LLM Key，不用真实生成制造 pending 请求。合成票据驱动/完整 Auth 接线仍需后续审阅实现；既有 HTTP Mock E2E 136 项不能算本机完整 Supabase 或托管 Auth 通过。真实 CF API/B4/真人试用继续未执行。

## 6. 本机 Supabase 安装/启动计划（仅提交，未执行）

本轮只读检查：macOS **27.2 / arm64 / uid501**；当前 PATH 未找到 supabase、docker、podman、colima；仓库没有本机 config.toml。未搜索私人配置、调用 runtime daemon/status、扫描全部 Applications 或读 CLI 登录缓存，因此不把 PATH 未找到解释为机器一定未安装任何 GUI/runtime。

官方常规 `supabase start` 需要 Docker 兼容 runtime，首次启动会取镜像；init 只生成本地项目配置，不必绑定托管项目。完整服务建议至少 7GB RAM。本机开发栈应只监听 loopback，不公开暴露。[本地开发](https://supabase.com/docs/guides/local-development)、[CLI 安装/运行](https://supabase.com/docs/guides/local-development/cli/getting-started)、[CLI start](https://supabase.com/docs/reference/cli/global-flags#supabase-start)

| 阶段 | 拟议动作 | 预计本机副作用/审批边界 |
| --- | --- | --- |
| L0 有界检查 | 获批后确认现有可信 CLI/runtime、空闲端口/磁盘/内存，不读取 Docker credential store 或云配置 | 只检查，不停既有服务、不修改 docker 全局 context/配置 |
| L1 安装 | 优先复用现有可信 runtime；如无，评审 Homebrew 的 Supabase CLI（官方 tap/release）、Docker CLI + Colima 及必要依赖；固定稳定版/arm64/来源与校验，不用临时 npx 隐式下载 | 新软件及依赖/缓存/可能的 opt 链接；VM/安装器若要 sudo、管理员确认、系统安全或常驻服务改动，需额外审批；不自动升级无关包、不改仓库依赖锁 |
| L2 初始化/下载/启动 | 新私有工作副本及独立本机 project_id，绝不使用线上 Ref 作为 linked 目标；复制已核验的 001–013，注入合成配置；审批后下载官方镜像并记录 digest、启动专属网络/卷/进程 | VM、镜像/磁盘卷、端口、CPU/RAM/电量和服务日志；建议预留 8GiB RAM、2–4 CPU、约 20–30GiB 磁盘作为待确认估算，不承诺精确容量/下载量 |
| L3 本机验收 | 所有业务端口限定 127.0.0.1，先验证端口/实际目标和权限，再建合成数据；真实本机 Auth/PostgREST + 两 Next 实例，外网产品/模型请求继续拒绝 | 不能套用旧 Mock Auth 假装真实服务；原 guard 不全局关闭，另审私有限定 loopback 接线。CLI 启动会输出本机凭据，只进私有日志，不上传/Git。[CLI 输出](https://supabase.com/docs/guides/local-development/cli/getting-started) |
| L4 清理 | 只停止/清理本轮 project_id/容器/卷/网络和两 Next PID，保留脱敏报告；VM 仅在本轮独立创建且获批时停止 | 不 docker prune、不清理既有 runtime/卷、不 brew cleanup/uninstall；绝不 --linked/远端 URL reset |

L1 安装与 L2 启动/镜像下载/本机写入需要**新的明确授权**；R1 的 PostgreSQL 安装许可不自动覆盖。先提交固定版本/实际资源与变更清单供审核，再执行。实验性 native Supabase stack 不是本轮默认替代方案，不静默沿用 R1 二进制拼装完整平台。全流程不 login/link/pull 托管，不重置线上数据库或复用线上密钥/数据。

## 7. 后续负责人需要批准的具体事项

| 编号 | 独立批准内容 | 尚不包含 |
| --- | --- | --- |
| A1 R2B-0 | 本候选 Ref 的新鲜身份/数据库目标核对、上列固定 SHA 两份 SQL（账本条件执行）、操作者/通道/窗口与脱敏元数据交付 | 业务 getUser/用户数据、RPC、备份、Auth、写入/配置、账本修复 |
| A2 本机安装 | L0/L1 方案、固定版本/来源/依赖、本机资源及权限提升是否另批 | 启动服务、镜像取用/VM 或测试写入，除非也明确包含 A3 |
| A3 本机运行 | L2–L4 的专属目录/网络/端口/镜像/卷、合成 Auth/数据、J01–J16 与清理/日志保留 | 任何托管连接、复制线上用户/Key、真实模型/CF 或 B4 |
| A4 备份/恢复 | 如确需生产迁移，维护者负责的真实数据导出/安全保管、覆盖清单、演练目标/权限和 RPO/RTO | 不因 A1 只读允许而自动导出，不自动上传原件/重置密码/升级付费权益 |
| A5 托管受控变更 | 仅在当前结构差异已确认、恢复演练可靠且本机验证通过后，另审缺失版本/完整哈希、锁窗口、现有历史保护、必要正向 smoke 的账号/ID/数量、清理能力及停止条件 | 不承诺为关闭所有 NOT_RUN 而做破坏性矩阵；不沿用旧同步/模型/生产部署授权 |

优先顺序为 **A1 只读观察 + A2/A3 独立本机准备**，随后审核结果。若无法建立 A4 的可靠恢复能力，停止 A5 迁移/写入路线，保留对应托管门禁未通过；不为赶发布降低安全条件。

## 8. 本轮实际验证与交付

| 实际检查/命令 | 结果 | 覆盖边界 |
| --- | --- | --- |
| Git/源码/SQL 静态审阅、现有 manifest | **PASS**，13 文件哈希与 R2A 完整清单一致 | 证明本地源版本，不证明远端部署 |
| `node scripts/check-offline.mjs --hosted-readiness` | **36/36 PASS**，Node 审计 **10/10 PASS / CORRELATED** | 四前缀 PGlite 只读目录、账本/ACL/拒绝与隐私测试；是一次性本地合成夹具，不是新启原生/托管项目 |
| 既有 `r2a-hosted-readiness.ts preflight`，输入本 Ref 的 PRODUCTION + metadata-only 申请 | **预期 BLOCKED，退出 2，executionEnabled=false/action=NONE** | 未填 approvedTarget/observedTarget；URL 仅由已提供 Ref 推导，未访问/验证。useExistingUserData=false 表示不读用户行，不表示该项目没有真实数据 |
| 同一隔离运行的 manifest + preflight | 功能断言 **PASS**，两 CLI 生命周期 **2/2 PASS / CORRELATED** | 白名单环境/独立 HOME/原离线 guard，未继承真实凭据或读取真实 .env |
| `node scripts/check-offline.mjs` → lint / typecheck | **PASS / PASS**，lint 0 warning | 私有源码副本，未影响已有开发服务 |
| 同上 → 固定相关专项 / 全量 test | **265/265 PASS / 881/881 PASS（77 文件）** | 既有单元/PGlite/模拟与固定公开响应重放；无新增测试/生产源码修改 |
| 同上 → recommendations / build + postbuild | **36/36 PASS / PASS** | 不改权重、研究定义或生产门禁，不是部署 |
| `git diff --check` + 新报告 whitespace 检查 | **PASS** | 最终两份文档 |
| 原生 20+14、Chromium E2E | **本轮 NOT_RUN**；分别复用 R1 34/34、R2A 136/136 历史证据 | 文档调整未改变原生/UI/测试入口，不伪称本轮重新执行 |
| 远端全部操作、本机完整 Supabase/安装/容器 | **NOT_RUN / BLOCKED** | 没有使用当前真实账号、数据或密钥 |

本轮完整回归日志 `/private/tmp/algopilot-r2b-existing-full.log`，报告 `/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-replay-checks-e1vLcX/checks.json`：六阶段 Node 完成 **2/2、3/3、40/40、112/112、10/10、34/34**，合计 **201/201**，各阶段 audit PASS、CORRELATED、issues=[]。准备专项日志 `/private/tmp/algopilot-r2b-existing-readiness.log`，报告 `/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-replay-checks-Ikp2BP/checks.json`。候选申请/manifest 的脱敏证据 `/private/tmp/algopilot-r2b-existing-review-QfbHP9/offline-assessment.json`。

上述受监控阶段六计数 networkBlocked/dnsBlocked/credentialReadBlocked/externalHTTP/realDNS/realCredentialReads 均为 0；内嵌合成故障注入子记录仍保留预期 FAIL/UNKNOWN。公共文档访问不在这些 Node 计数中，未测请求/字节总数；外层进程/原生绑定/设备整体流量为 UNKNOWN，浏览器本轮没有采集，不能补成零。历史两次拦截及 R1 额外拦截的 FAIL/UNRESOLVED 不变。本轮未出现新的未知网络拦截。

最终 HEAD 仍为 **e2fb57c9f1b9b7dbaa8d54bf5ce69bcc47cc9c65**；最终仅修改 `docs/MVP_RELEASE_GAPS.md` 并新增本报告，共 **2 文件，未提交**。`src/`、001–013、R2A SQL/工具/测试、原生设施、B3/收集器、package/lock 及模型免费门禁均无差异；无新 SQL、迁移或备份/删除脚本。旧 R1/R2A/M35 报告与机器证据未改写。

**PASS**：本地评估/只读方案和现有工具复用。**FAIL（适用性判断）**：把有真实数据的 main/PRODUCTION 当破坏性隔离测试库不符合本方案条件；这不是新观察到的数据库功能失败。**BLOCKED**：远端只读审批、可靠备份/恢复及本机完整栈安装/运行授权。**NOT_RUN**：当前托管全部核验/写入/迁移、原生/完整栈启停与迁移、安装/容器、真实备份与恢复；既有 PGlite 合成夹具执行单列本地测试。**UNKNOWN**：当前 011–013/账本/ACL/套餐及恢复能力。历史 FAIL/UNRESOLVED 不变，P0-A 复用 R1 PASS，P0-B 仍未关闭，P0-C/B4 未执行。

完成后停止，保留文档修改供人工审核，不 commit/push/PR/部署，不自动进入 A1 或其他阶段。
