# MVP R2A：托管 Supabase 验收准备

2026-11-02，Asia/Shanghai。**本地准备 PASS；R2B BLOCKED / 托管 NOT_RUN。** 目标仍为 **NOT_SELECTED**。本轮没有远端连接、SELECT、注册/登录、迁移、配置修改或部署，也没有读取真实凭据。本文的远端步骤均是下一阶段的待审批流程，不是执行许可。

## 1. Git、检查范围与证据分层

初始 HEAD **dc5fee5b1e5380f6de3f77d601041b01218c8f64**，工作区干净，R1 正式执行已提交。实际检查 AGENTS、DEVELOPMENT_PLAN v3.4、R1 报告/JSON、缺口、M34/M35、SUPABASE_SETUP、001–013，及 Auth/proxy、服务端 Cookie、training/plan/learning/Tutor/Review/CF Repository、RPC/Orchestrator、离线收集器和历史比较器。

| 证据层 | 已有事实 | 本轮结论 |
| --- | --- | --- |
| 仓库 SQL | 001–013 文件及哈希存在 | 只是待核对的源版本，不是远端部署状态 |
| R1 原生 | PostgreSQL 16.15；20/20 + 14/14；真实独立 authenticated 后端、16 次锁观察、SQLSTATE/回滚/RLS/历史、Node 审计 PASS | 复用 [R1 正式报告](MVP_R1_NATIVE_EXECUTION_VERIFICATION.md) 与 [机器证据](r1-native/execution-evidence.json)；本轮不重启原生集群、不重写 34 项 |
| 历史托管 | M35 曾观察 `qmlsgwbiiqpbelgkgsdw / main / PRODUCTION` 的 001–010 有效目录；当时 schema_migrations 不存在；单用户真实 JWT/CF 路径部分通过 | 历史范围保留；不是默认测试目标或当前状态；不沿用历史操作预算 |
| 当前托管目标 | 未指定、未访问 | **UNKNOWN / NOT_RUN**，没有“已迁移 013”结论 |
| 执行账本 | 本机运行文件列表、历史远端缺账本、未来目标账本是不同证据 | 当前 **UNKNOWN**；函数匹配不证明种子/回填等全部数据效果已执行 |

旧 R0 两次未归因网络拦截、R1 TrainingFeedbackPanel/requestJson 拦截及完整时序未知均保留原 FAIL / UNRESOLVED；本轮 PASS 不撤销或补归因。P0-C、生产免费模型默认拒绝、B4 NOT_RUN 不变。

## 2. 只读目录工具与本地参考

新增 [R2_READONLY_STRUCTURE.sql](sql/R2_READONLY_STRUCTURE.sql)，复用 M35 查询范围但独立成文件，不改历史 SQL/报告。它是一条 SELECT，所有调用和系统目录均明确限定 pg_catalog，只调用经过固定清单检查的元数据函数，不执行 public/algopilot_private 业务函数。用本地 PGlite **READ ONLY 事务**实际运行 010、011、012、013 四个前缀；这仅验证查询和参考，不替代 R1 原生或远端。

| 核验维度 | 输出/阻断规则 |
| --- | --- |
| 表/列/历史签名 | public、algopilot_private 全部普通/分区表；类型、NOT NULL、默认表达式摘要、旧 RPC/触发器；缺失或多余对象阻断 |
| 约束/外键 | 定义、validated；包含 013 `(id,user_id)` 唯一及 `(session_id,user_id)` 复合 FK、CHECK；不把名字相同当定义相同 |
| 索引 | 定义、unique、valid、ready、部分索引谓词；包括 recommendation_origin_once、owner 索引 |
| RLS/Policy | relrowsecurity/forceRls、角色、command、permissive、USING/WITH CHECK；013 私表 RLS=true、无普通读写授权，其零条 Policy 是拒绝设计，不能要求伪造 allow Policy |
| ACL | 表/列/函数/schema 的实际 ACL（角色/权限/grant option）及普通用户有效权限；PUBLIC/anon/authenticated EXECUTE 单列，GRANT/REVOKE 只检查最终状态 |
| 函数 | 身份参数/返回值/语言、owner、SECURITY DEFINER、definition/body MD5、仅 search_path 的配置值；其余 proconfig 仅名称，不导出值 |
| 角色/命名空间 | anon/authenticated superuser/bypass/inherit/直接 membership、schema USAGE/CREATE；与有效权限一起看，不用 R1 LOGIN 替代托管 JWT 角色机制 |
| 账本元数据 | 关系/版本列存在性、普通表/内置 text/varchar/owner/RLS 形态；存在不等于可信可读或版本正确，不读取 statements/name 或业务数据 |

不导出函数源码、私有配置、签名密钥或其摘要、用户行、Token、Cookie、SQL 请求正文。函数/默认表达式摘要用于代码比较，MD5 不承担签名用途。索引/策略/触发器的定义为目录元数据；若远端存在可疑私人字面量，操作员先在受控界面审核，不直接上传原始导出物。

实际本地 **PGlite 18.3** 前缀摘要/13 个文件完整 SHA-256 已保存到 [catalog-reference-summary.json](r2a/catalog-reference-summary.json)：

| 前缀 | 函数 | 表 | 列 | 索引 | 约束 | Policy | Trigger |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 010 | 39 | 26 | 235 | 63 | 347 | 16 | 3 |
| 011 | 39 | 26 | 235 | 63 | 347 | 16 | 3 |
| 012 | 39 | 26 | 235 | 63 | 347 | 16 | 3 |
| 013 | 42 | 27 | 246 | 68 | 362 | 16 | 3 |

这些数字不能与跨版本目录直接粗略对齐。比较器复用 M35 对 PG18 NOT NULL 的逐列验证，仅在旧版本实际 attnotnull=true 时认可该特定等价；不忽略 CHECK/FK/唯一、nullable、未验证约束或其他差异。Supabase owner/平台附加对象/目录格式可能不同，均保留差异并 BLOCKED，待维护者逐项证明来源，不自动白名单。额外旧重载和平台函数也会阻断，不再只列 extraObjectsNotAttested 而当作匹配。

## 3. 001–013 版本、结构与治理

下表 SHA-256 为前 12 位便于浏览，完整值在上述 JSON；所有文件与 R1 哈希保持一致。R1 的“已执行”只针对本机新建合成库。历史托管列指旧 M35 最终有效结构的范围，后续覆盖后的函数不能反推出中间版本曾执行。

| 版本/文件后缀 | 核验重点 | SHA-256 前缀 | 历史托管 / 当前目标账本与结构 |
| --- | --- | --- | --- |
| 202610110001 m1_training | profiles/problems/session/thought、归属、初始 profile trigger/回填边界 | e0ae87a804f0 | 旧最终目录部分范围；当前 UNKNOWN |
| 202610110002 m2_tutor | 权限级别、HMAC RPC/私表、请求/消息/usage、租约 | d27691a0e3b0 | 同上；当前 UNKNOWN |
| 202610110003 gemini_usage | usage NULL/非负/一致性约束与 unclassified 列 | 0bc06c830565 | 同上；当前 UNKNOWN |
| 202610120004 business_conflicts | PT409 替换、旧签名保留，不以 40001 重试业务冲突 | 7055e9c94fbb | 同上；当前 UNKNOWN |
| 202610120005 ac_reviews | timer、Review 快照/请求/授权/共享租约、旧 NULL problem 兼容 | 44c6f2b11943 | 同上；当前 UNKNOWN |
| 202610120006 cf_catalog_plans | 题库/多计划/关联、CF 私有配置与状态、初始种子/派生配置另验 | 94817343f8a9 | 同上；数据效果不能从目录推定 |
| 202610140007 learning_recommendations | 偏好/反馈/receipt、RPC/CAS/归属 | c50ed33ab82d | 同上；当前 UNKNOWN |
| 202610140008 recommendation_audit | 被 009/010 继续覆盖的候选实现；不能凭最终定义证明 008 历史 | 3e7a99a92082 | 同上；当前 UNKNOWN |
| 202610140009 recommendation_fit | 私有 restrictions、种子与 training-fit、候选上限前排除 | 95b26bf784ed | 同上；不查询私有种子内容 |
| 202610150010 cf_official_evidence | CF 账号/提交/receipt、scope/revision、官方事实分离、替换 learning 函数 | 5ca7c5cb6ddb | 旧 001–010 有效目录曾匹配；旧账本缺失；当前 UNKNOWN |
| 202610260011 review_retry_recovery | review_reserve(text,text) 替换，过期同号 AP006、新号恢复、EXECUTE 收敛 | a2bdd2ccaf4b | **托管 NOT_RUN**；当前 UNKNOWN |
| 202610270012 tutor_retry_recovery | tutor_reserve(text,text) 单目标定义补丁；精确原子匹配/23514 与 ACL | 1358538fcf5b | **托管 NOT_RUN**；当前 UNKNOWN |
| 202610280013 recommendation_training_feedback | 新私表/11 列、3 RPC、5 索引增量、复合 FK/唯一/来源/反馈 | 1b0e5b1cd20e | **托管 NOT_RUN**；当前 UNKNOWN |

### 三种状态与账本处理

| 状态 | 必须证据 | 允许提出的下一步 / 禁止 |
| --- | --- | --- |
| A 有效结构已存在 | 对应前缀函数/ACL/约束/历史兼容目录逐项匹配；数据效果仍分栏 | **不重跑 CREATE**。011/012 本机可重放不代表未知托管可重放；013 R1 裸重放 42P07，尤其不能试跑判断。账本缺失时 A 与治理 C 同时成立 |
| B 确认增量缺失 | 唯一匹配已核验前缀 010/011/012，账本版本清单与该前缀一致，且已排除部分结构/额外重载/权限差异 | 只生成后续缺失文件+完整 SHA 的提案，不执行。若连 001–010 都不匹配/空项目，不自动推断从 001 开始；负责人另审完整初始化清单 |
| C 部分结构/账本异常 | 不匹配任何前缀、匹配不唯一、部分 013、未知/重复/越序版本、不可读/不存在账本、非预期 ACL/额外对象 | **BLOCKED，proposedMissing=[]**；保留各 section 的差异身份/字段及快照 hash，人工查明，不使用 RPC 错误猜版本 |

账本独立读取文件 [R2_READONLY_LEDGER_VERSIONS.sql](sql/R2_READONLY_LEDGER_VERSIONS.sql)，只有关系/列存在、ledgerReadShape 显示普通表/无 RLS/内置 text 或 varchar、操作者已核实 Supabase 管理的可信归属且已有版本列 SELECT 权限、本阶段获批后才运行；否则记 ABSENT/UNREADABLE 或异常 BLOCKED。视图/外表、自定义类型转换或未知 Policy 可能在 SELECT 时调用用户代码，不凭对象名称放行。仅导出 version 数组，不能导出 statements。版本清单本身不含可信源文件哈希，匹配也仅为 VERSIONS_MATCH_ONLY，历史数据效果 **NOT_PROVEN**。

对于旧项目缺账本：维护者应对目录快照、部署记录、源提交/文件哈希及获准数据效果逐项审阅，形成独立对照，不制造迁移版本。若未来确需账本治理，必须另提交目标、证据、备份/恢复、逐版本策略及审批；本工具不执行也不生成 repair、补记、db push/pull、DROP 或迁移 DDL/DML。

### 011–013 待审批变更清单

| 迁移 | 前置/预期副作用 | 停止与恢复安排 |
| --- | --- | --- |
| 011（仅确认缺失时） | 先有 001–010 兼容结构；替换 review_reserve 并重新收敛 EXECUTE，短期目录锁；不回写现有完成历史 | 先保存目录摘要/备份安排，应用失败则事务回滚并停。应用成功后需再次只读核验/真实 JWT 回归，不能以退出 0 收工 |
| 012（仅确认缺失时） | 011 后按顺序；只允许原函数匹配一次或已是新定义，其他定义 23514；替换函数及 EXECUTE | 23514 是证据不足，不能改旧 SQL 迎合；先调查差异。已提交后若需撤销，单独审阅追加修复/恢复，不能默认 down migration |
| 013（仅确认缺失时） | 012 后；training_sessions 增唯一索引可能持锁/扫描，新表、FK/CHECK、索引、三 SECURITY DEFINER RPC/ACL；不为旧训练伪造来源或 skipped、无旧数据回填 | 迁移前备份可核对、恢复负责人/窗口明确；先建非空合成旧训练/笔记/计划/复盘夹具，再比哈希/计数/链接；裸重放失败只在获准的一次性测试目标运行，不能试探未知库 |

备份证明需要项目/分支/时间、覆盖 Auth/DB 的范围、保留期限、恢复位置/可用性、操作者与恢复演练安排；仅“有备份”复选框不足。备份原件不可进入仓库。锁超时/维护窗口由负责人审批，不调整原生断言或禁 RLS。任何恢复也要重新核对目标并单独授权。

## 4. 真实 JWT / 双用户 RLS 执行矩阵

**所有行当前 NOT_RUN。** 共同前置 G：已验证专用 TEST 项目身份、元数据/迁移治理完成、负责人批准该行范围、A/B 两个专用账号名额与最少合成数据上限（J01/02 注册前尚无用户）、私有运行目录/脱敏审计。普通用户请求只能用真实 Auth 签发且由 Auth getUser 和 PostgREST 实际验证的 A/B JWT；不通过 decode、SET ROLE、合成 claims、service-role 替代。

证据 E：案例 ID、A/B 别名、I1/I2 别名/PID、相对/单调时间、操作名、HTTP 状态/应用错误/SQLSTATE、数量/revision/布尔/合成记录摘要；真实 ID 对照仅保留在 0700/0600 私有运行 manifest，报告不含 Token/Cookie/邮箱/正文/nonce/签名/环境。禁止直接录制含凭据的 HAR、trace/network dump 或控制台 SDK 原文。

清理 C1：退出并关闭两隔离浏览器上下文、丢弃内存 Token/私有 Cookie；C2：按运行 manifest 逐项清理 A/B 合成记录，优先现有普通 JWT 的业务删除（如 plan/CF 作用域）；产品没有通用训练/Review 删除接口，需负责人另外审阅依赖顺序与精确用户/ID 条件的维护清理，不能假称 rollback 可跨 Auth/HTTP 撤销。C3：Auth 测试账号/邮件/配置由获批操作员清理或恢复原值；账号 FK 未清理不强行删。清理本身也是授权写入，没有清理能力/范围则不开始造数。

| ID / 前置 | 真实身份 | 操作步骤 | 预期结果 | 保存的脱敏证据 | 清理 | 写副作用 / 单独批准 |
| --- | --- | --- | --- | --- | --- | --- |
| J01 G+可用邮件/确认配置 | 新 A | 注册→收确认→原浏览器 PKCE 或获批邮件回调→登录 | 服务端 getUser=A，确认前不能冒充已登录；回调安全重定向 | E+确认/回调成功布尔、身份一致布尔 | C1/C3 | Auth/邮件写；需 auth/配置/邮件授权 |
| J02 同上 | 独立新 B | 独立上下文注册/验证/登录，不复用 A Cookie | getUser=B，A≠B；两个当前身份各自一致 | E+不同身份布尔 | C1/C3 | 同 J01；不能用已有真实用户 |
| J03 G+J01/02 | A/B/匿名 | 私人页、API 与普通 JWT PostgREST 分别访问；伪造页面身份不替代 Cookie | getUser/数据库归属一致；匿名 API 401，私人页跳登录；配置失败与无数据区分 | E+两层验证、no-store 头 | C1 | 读取也可能刷新 Auth；需 metadata/auth 及对应读取范围 |
| J04 G+真实到期等待 | A/B 各自会话 | 记录服务端验证时间，等待批准的现有 TTL→请求私人路由/API→再次 getUser；不改 JWT 时钟/claims | 刷新后的浏览器和当次 SSR 都使用新 Cookie；无跨用户/跨实例串号或缓存泄漏 | E+相对过期/刷新时间、Set-Cookie 存在及安全属性布尔，不存值 | C1 | 刷新写 Auth；若改 TTL/Redirect 另批 configuration |
| J05 G+J04 | A 与匿名 | logout 后原上下文读写→已过期/失效会话重试→重新登录 | 原浏览器请求拒绝，草稿不丢；过期且无可用刷新时 401。另测保留在内存的旧 access JWT 的实际撤销窗口，不能把 local signOut 当即时吊销所有 JWT | E+logout/expiry/refresh-reuse 三条时序及拒绝结果 | C1/C3 | Auth 写；全局撤销/删号另批，不沿用本地退出授权 |
| J06 G+可信 CF 合成缓存 | A | start_cf_session→建 plan/加题→保存 thought 草稿并 append 历史→自报 AC 后创建 Review 快照（不生成） | requestId/CAS、快照 hash/归属、显式发送授权与真正发送分开；无新 custom，无真实模型 | E+合成数量/revision/快照 hash | C2/C3 | fixtures 写；自报不冒充官方事实 |
| J07 G+J06 | B | 应用列表读取 A 对应训练/计划/笔记/Review | 不出现 A 私人记录；公共题库不是私人泄漏 | E+按别名匹配数=0，B 自有控制记录可读 | C1/C2 | 读可能刷新 Cookie；需 auth/fixtures 范围 |
| J08 同上 | B 普通 JWT | 已知 A ID 直接访问 API、普通 PostgREST 安全列、plan_detail、recommendation_training_evidence(sessionId=A) | 应用 404/NOT_FOUND；表读无行或权限拒绝；RPC P0002；不能只验列表的应用过滤 | E+逐路径状态/SQLSTATE、未返回私文布尔 | C1/C2 | 读/拒绝；不得管理角色代测 |
| J09 同上 | B 普通 JWT | 对 A ID 调 save_training_draft/edit_code_review/plan_write，保留 A 前后摘要 | P0002/42501/404 按实际路径；A revision/正文摘要不变，B 也无派生记录 | E+拒绝 code、A 前后相等布尔 | C2 | 有意写拒绝；需明确负向写入许可 |
| J10 G | A/B/匿名 | 对受保护表直接 INSERT/UPDATE/DELETE、私列 SELECT、未授权函数/HMAC 假签名；用各自自有合成 ID 做阳性控制 | 42501 或对应 PostgREST 权限拒绝；无跨用户更改；签名/lease/nonce 不可读；不是仅“空行成功” | E+每种权限类别状态及记录不变布尔 | C2 | 拒绝测试仍列 fixtures；绝不读真实设置值 |
| J11 G+J06+I1/I2 | A 的真实会话 | 同 revision 同时保存不同草稿；同 requestId 追加；两个实例用屏障后并发 | 一次提交，另 PT409/HTTP409；同 ID 幂等；重试不覆盖新 revision，不改变并发/预算 | E+相对时间、胜负/revision/唯一数 | C2 | fixtures 并发写；禁止把顺序调用算竞争 |
| J12 G+合成请求夹具许可 | A | 先确认已有 Review 快照；驱动建合成票据，丢弃 ACK→用原 ID 查询/恢复→过期后原 ID→显式新意图新 ID | UNKNOWN 不等于失败/自动重发；pending AP004、过期同号 AP006、完成原号缓存；历史快照不变，生产默认拒绝新真实生成 | E+原号别名、状态转移/历史摘要；UNKNOWN 单列 | C2 | 签名 RPC 票据/合成完成写，需专项许可；不调用 Provider |
| J13 G+J12 | A 两会话，B 阳性控制 | 两实例竞争 Tutor/Review reserve，同号/异号，真实等待原 180s 租约/签名有效窗口；success=false 结算释放 | 同用户共享 AP004/UTC AP003，B 不受 A 私人租约影响；无模型 usage 伪造；原号恢复行为符合 011/012 | E+操作/等待/SQLSTATE/唯一数，租约敏感值不输出 | C2 | 配额/receipt 写；不缩短 DB 租约，不管理 DML 改时间冒充普通路径 |
| J14 G+可控响应屏障 | A，B 控制 | 分开测：I1 读取推荐/画像后阻塞 guard，I2 关闭 reviewEvidence/官方分析；释放旧读。另阻塞 Tutor 合成结算后完成训练/等待 lease 过期 | 证据 revision 旧结果 PT409 且不展示；Tutor accepted=false/历史不加消息。Review 不假定存在可撤销的生成授权接口，按实际 lease/receipt 验；Auth 撤销不冒充这些业务撤权 | E+屏障与提交顺序、revision、discarded/历史不变 | C2 | 偏好/授权/结算写；每种撤权分开授权与记录 |
| J15 G+013 | A/B 普通 JWT | A record run→并发 skip/start→同题不同 run→恢复旧训练；B 用 A trial/session ID 调 choice/evidence；用户自报与固定官方夹具分列 | 唯一来源/幂等、旧草稿/版本不变；B P0002/42501、私表不可读；反馈状态不改官方事实；旧 revision 拒绝新选择 | E+originated/resumed/状态、唯一数、拒绝码/前后摘要 | C2 | fixtures/签名 record 写；官方夹具不算真实 CF |
| J16 G+两个受验 Next 实例 | A/B 在 I1/I2 | 第 5 节并发、进程切换/迟到响应/历史读取，核对同一远端目标、实例身份和必要签名闭环 | 两 PID 的应用通过同一托管 DB 协调；不是两条 SQL 连接或两个 Mock 服务证明多实例 | E+两实例记录、共享幂等/lease/revision 结果，DB backend 单列 | C1/C2/C3 | fixtures/Auth/测试实例启停另批；真实上游仍禁 |

J12–J14 的带签名测试驱动只接受已验证真实用户、获批合成资源与已配置测试签名域，通过普通 JWT RPC；不提供生产 HTTP 夹具接口，不使用 service-role。它只制造明确标记的合成状态，成功合成历史与真实 Provider 响应分别报告。当前尚未实现/启用远端驱动，必须先审阅接线及作用域再授权；缺少驱动或签名闭环就保持该项 BLOCKED，不能通过真实生成获得票据。

## 5. 两个应用实例方案

1. 负责人选定唯一专用 TEST 项目，批准两个本机服务端口，例如 **3201/3202**；两私有工作副本使用同一提交/构建和公开项目配置，各自 HOME/日志/实例别名。确认没有端口冲突，不停止现有开发服务。实例各自 APP_URL 对应自己的 origin，Auth Redirect URLs 如需变更先列配置授权；两个实例共用必要服务端签名域/DB 配置，值不输出。
2. 后续获批的启动命令分别为 `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3201`、同命令 port 3202；**本轮未启动**。保存 PID/PPID/启动时刻、构建 hash、端口及两实例目标核验引用；A 与 B 使用独立浏览器 context，A 的同一真实会话在两个 origin 上按获批回调/同源策略使用，不能混用 B Cookie。
3. 先分别经 I1/I2 执行 getUser+普通读取/有归属的签名写入闭环，用成功/拒绝布尔证明签名域工作；不能读 private settings/导出 key 或密钥 hash 来“比对相等”。若要配置测试专用 HMAC，必须由负责人另批并在私有运行环境注入，本轮不读取/重用现有配置。
4. 屏障后同时从 I1/I2 发 J11/J13/J15：同意图同 ID、不同意图新 ID、同用户跨会话 Tutor/Review 互斥、B 独立；延迟/丢失一个响应后从另一实例读历史。停止 I1 仅可针对本轮 PID，I2 不靠内存状态误重试；backend PID 若通过获准只读遥测可得则单列，HTTP 请求数/连接池复用不能伪称不同 backend。
5. CF 共用 `cf_sync/slot` 和 `cf_account_command/slot` 的 DB 时隙，真实等待 **3 秒**及原冷却/预算。复用现有 `synchronize(repo,force,fetcher)` 和 account-service runtime.fetcher 注入固定合成/公开录制响应，保留普通 JWT Repository 和实际 DB 锁。对 Next 路径需要在**两份私有副本**审阅限定的夹具接线（catalog 调 synchronize 时传 fixture fetcher、account 两路由传 runtime.fetcher）；源工作区不加生产假开关。记录 fixture hash、发放时隙与相对调用时间；这证明 DB 共享限流，不证明真实 CF 网络/最新数据。未完成私有接线的两驱动进程结果不能冒充两个 Next 实例结果。
6. Provider 保持默认拒绝；无真实 LLM Key。Supabase 是 R2B 唯一拟批准外部服务，不能直接关闭 B3 保护器来放行网络。R2B 在拿到授权后须先审阅独立的精确项目/协议/路径/重定向拒绝规则（Auth/REST 及必要操作员目录通道分开），模型/CF/其他主机继续拒绝，计数区分允许与阻断；本轮原离线保护器不变。缺少可信限定传输/审计就不启动远端用例。
7. 分别记录旧 evidence guard 前撤权、lease 过期后迟到、I1 crash 后 I2 显式恢复，不能把关闭分析、退出账号、删除账号与取消生成视为同一事件。按 C1–C3 清理且核对仅本轮实例停止；不部署、不改系统网络/代理。

## 6. R2B Fail-Closed 前置与审批清单

工具 [r2a-hosted-readiness.ts](../scripts/r2a-hosted-readiness.ts) 只有离线 manifest/plan/preflight，没有数据库客户端、fetch、远端用户或迁移执行器。preflight **始终 executionEnabled=false / action=NONE / BLOCKED，退出 2**，即使完整自签 JSON 声称目标/观察/批准相同。当前没有可信远端身份验证器或授权源，不能由配置文件、TEST=true、项目名称、历史生产 ref 或环境变量放行。

它会额外指出 URL/ref 不符、owner/observation 缺失或不符、非 TEST 写入、缺 A/B 或清理范围、未知迁移、无备份/恢复、使用现有用户等问题。模板 [r2b-request.template.json](r2a/r2b-request.template.json) 特意不填默认项目；[ledger.template.json](r2a/ledger.template.json) 默认 UNREADABLE。填完模板仍只是申请材料，不是可信证明。

| 待负责人提供/批准 | 必须可核查的证据 | 缺失时 |
| --- | --- | --- |
| TEST 项目/分支/ref/URL/所属组织 | 负责人批准的目标清单 + 新鲜远端 Dashboard/项目管理元数据，由有权操作员确认精确 ref/URL、分支、环境用途；数据库通道再与该项目 Connect 目标关联。URL 格式、证书或成功连接单独都不证明 TEST | BLOCKED；历史 PRODUCTION 不作默认值；STAGING 也不能自动写 |
| 当前范围与有效窗口 | 本轮书面批准的 metadata、auth/邮件、fixtures/负向写、缺失迁移、configuration、故障、cleanup 分项；两账号别名、数据上限、实例/PID/端口范围、操作者、到期/停止条件 | 超范围立即停止，不从批准只读推导写入许可 |
| 最小权限 | 操作员现有目录读取权；Auth 普通用户 A/B 及其 JWT；迁移/配置/备份由独立维护者操作 | 不创建额外管理角色或用 service-role 代替用户 RLS 用例 |
| 当前结构/账本 | 本报告只读输出与本地参考/13 哈希对照，保留未匹配/额外项；账本独立版本 SELECT | 无权限、未知、缺失、部分或非预期权限均停，不修账本 |
| 迁移与恢复 | 精确缺失文件+哈希、锁/兼容影响、有效备份、恢复位置/责任/演练/窗口、前后合成历史清单 | 不提交 DDL；无已确认备份不能迁移；没有通用“回滚全部”按钮 |
| 敏感信息与审计 | 凭据只在操作者/私有运行时，禁入日志/Git/截图；JWT 仅内存/隔离 context；固定错误字段，完整生命周期/目标/阶段关联 | 不索取现有真实 Key/URL 环境文件，不把读取不到补零 |
| 清理与剩余资料 | 运行 manifest、按归属/ID 清理权限、Auth/配置恢复和日志保留期限 | 无清理许可不开始写夹具；不 DROP/清空项目 |

待审批的远端变化穷举到本方案范围如下；均为本轮 **NOT_RUN**，只读批准不包含这些变化：

| 操作组 | 写入/配置副作用及权限边界 |
| --- | --- |
| Auth | 两专用账号注册、确认、密码登录、refresh/退出、获批的过期/全局撤销或删号；可能发邮件/消耗 Auth 配额。登录/刷新不是只读 |
| Auth/应用配置 | 两个 origin 的 Site/Redirect URL、若确需的 TTL/邮件配置、测试专用服务端与 DB 签名域；值只由获批运行环境持有，修改前记录原状态的安全引用，清理时恢复 |
| 迁移 | 只允许单独批准的确实缺失文件及哈希，按顺序应用；备份/恢复操作、锁窗口也单列。账本 repair/手动补记、生产变更不在此提案内 |
| 业务夹具 | 两用户的 profile 初始化、固定题库发布/账号录制夹具、计划/关联、训练/草稿/历史、Review 快照/合成 receipt/usage 状态、偏好/授权、推荐 run/skip/start/反馈；全部标记合成，不使用现有真实材料 |
| 并发/故障 | 配额占用、lease/请求状态、ACK 丢失、应用 PID 停止/迟到响应、业务撤权；只操作已批准资源，不终止托管 DB backend/其他服务，不用管理员 DML 改 lease 时间 |
| 清理 | C1–C3、测试账号/夹具、获批配置恢复；严格限定运行 manifest。无现成训练/Review 删除接口部分需维护者另审；没有预授权全表删除/项目重建 |

资源创建、付费、真实 CF、模型请求、B4、生产部署和真实迁移账本修复均不在 R2B 自动获许范围。

## 7. R2B 精确顺序（本轮均未执行）

1. 人工先审本轮未提交变更。负责人提供专用 TEST 项目和初始**身份核对/只读**范围；禁止先尝试历史项目。任何 CLI 自动读取本机 .env、Supabase CLI 登录缓存或连接串的路径均不得使用。
2. 获批操作员核实远端项目身份并保存脱敏引用，和负责人目标独立核对。数据库连接身份与项目/分支/数据库关联要另核实；只读目录导出本身不包含可信项目身份，不能把导出文件当身份证明。
3. 在已确认项目上仅执行 R2_READONLY_STRUCTURE 主 SELECT；若账本/列存在、可信归属与安全读取形态均确认且已有权限，再执行独立 ledger version SELECT。无权限记 UNREADABLE，缺表记 ABSENT，视图/未知类型/RLS 等异常 BLOCKED；不创建表、角色或补账本。此时仍不允许迁移/Auth 写。
4. 本地重新生成/验证参考：`node scripts/check-offline.mjs --hosted-readiness`。输出打印的临时根含 `r2a-reference/catalog-references.json`（约 1 MB，4 前缀纯目录）和 `reference-summary.json`，不需 PostgreSQL、真实凭据或远端。核对目录 SQL hash、源提交、13 源文件 hash 与审阅版本一致；不把 PGlite 当托管 PASS。
5. 将操作员审核的主查询 audit 对象存为私有 `observed.json`，ledger 存 `{"state":"OBSERVED","versions":["…"]}` 或 ABSENT/UNREADABLE。在仓库根执行 `node scripts/r2a-hosted-readiness.ts plan /absolute/catalog-references.json /absolute/observed.json /absolute/ledger.json /absolute/new-plan.json`。工具只读本地 JSON、独占写新文件；BLOCKED 退出 2，元数据无差异也最多 REVIEW_REQUIRED，无远端执行许可。
6. 处理第 3 节 A/B/C。提交差异/缺失提案供负责人审阅。C 状态停止；需要迁移则另批准具体清单和恢复安排，实际操作者再核验目标后按顺序应用**仅缺失**版本，失败停、保留原失败，不自动重放/修复。已匹配的结构不重复 CREATE。
7. 迁移后的只读再核验通过，合成旧历史前后保留也通过后，负责人另批准 Auth/邮件、A/B、夹具、签名配置、实例/限定传输、故障和 C1–C3 清理。相应接线与凭据保护先审阅，未批准时仍不能注册/登录/刷新或运行测试。
8. 执行 J01–J10；一项身份/归属/ACL/错误泄漏失败立即停止写入部分。先验证阳性控制确实成功，再判断“拒绝有效”，不能用迁移缺失/配置错误的统一 503 冒充安全拒绝。
9. 执行 J11–J16 和第 5 节双实例；Mock/合成响应、真实 Auth/DB、网络拦截、应用实例/DB backend 分栏。模型/CF 真实网络禁止；无能力覆盖的保持 BLOCKED/NOT_RUN，不把两条普通顺序请求算并发。
10. 按获批 C1–C3 清理并复核目标/运行 manifest，保留失败、脱敏审计和合成前后摘要；恢复获批临时配置，确认仅本轮应用进程停止。生成独立 R2B 执行报告；不得据托管通过自动进入 P0-C、B4、生产或真人试用。

## 8. 本地测试、文件清单与最终状态

实际结果见可版本化的脱敏 [local-verification.json](r2a/local-verification.json)，其中保留完整审计摘要与私有原始报告路径。19 个新增用例（18 单元/1 集成）加入原有 862 个，不修改或跳过原断言/预算：

| 命令/检查 | 本轮实际结果 | 边界 |
| --- | --- | --- |
| `node scripts/check-offline.mjs --hosted-readiness` | **36/36 PASS**，Node 审计 **10/10 PASS / CORRELATED** | 新增 19 + 既有审计/诊断 17；只读本地 PGlite/合成 JSON，不是托管用例 |
| `node scripts/check-offline.mjs` → lint | **PASS，0 warning** | 私有副本、无真实环境文件 |
| 同上 → typecheck | **PASS** | next typegen + tsc，未放宽 tsconfig |
| 同上 → 既有相关专项 | **265/265 PASS** | 包括既有审计、恢复与交互断言 |
| 同上 → 全量 test | **881/881 PASS，77 文件** | 模拟、PGlite、固定录制重放；不算本轮原生/托管 PASS |
| 同上 → recommendations | **36/36 PASS** | 推荐权重与 M3.4 研究定义不变 |
| 同上 → build/postbuild | **PASS** | 本地生产构建，不是部署 |
| `sandbox-exec` 仅允许 loopback 运行 `node scripts/test-offline-e2e.mjs` | **136/136 PASS，retries=0，build PASS** | Chromium 桌面/移动；真实本地浏览器 + HTTP/Auth/Provider 契约替身 |
| `git diff --check` + 新增文件独立 whitespace 检查 | **PASS** | 最终文件 |
| 原生 34 项 | **本轮 NOT_RUN，复用 R1 PASS** | 没有启动 PostgreSQL；不把本轮 PGlite 算原生 |
| 托管/真实 JWT/双用户/多实例/迁移/配置 | **NOT_RUN / BLOCKED** | 无目标、无远端授权，不连接 |

最终全量日志 `/private/tmp/algopilot-r2a-full-final2.log`，报告 `/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-replay-checks-Ol17xi/checks.json`。六阶段 Node 启动/结束分别 **2/2、3/3、40/40、112/112、10/10、34/34**，合计 **201/201**；均 audit PASS、CORRELATED、issues=[]。最终准备专项日志 `/private/tmp/algopilot-r2a-readiness-final.log`，报告在 `/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-replay-checks-tYBjyG/checks.json`，四前缀/13 文件哈希与版本化摘要一致。

E2E 日志 `/private/tmp/algopilot-r2a-e2e.log`，报告 `/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-gate-e2e-X16JR1/e2e-audits-U4QjPB/checks.json`：**55/55 Node、12/12 浏览器**完整生命周期，审计 PASS；页面允许 **9668**、拒绝 **0**。受监控六计数 `networkBlocked/dnsBlocked/credentialReadBlocked/externalHTTP/realDNS/realCredentialReads` 在最终各阶段均 **0**。合成审计故障注入的独立子记录仍保留预期 FAIL/UNKNOWN，不能把其拒绝说成从未发生；外层启动器、原生绑定/未插桩进程及浏览器后台流量完整计量为 **UNKNOWN**，没有补零。

本轮没有下载/安装依赖、读取真实 .env/密钥/Token/数据库 URL、调用外部模型/CF/Supabase 或修改系统网络。离线 E2E 仍只在私有副本接线 loopback；原 B3/collector/模型默认拒绝不变。新 CLI 子进程只继承受控 NODE_OPTIONS/审计目录及最少环境，纳入生命周期，未继承用户凭据。没有生产数据外发或真实账本修改。

**修复前失败也保留**：首次 `/private/tmp/algopilot-r2a-full.log` 的 typecheck 因新工具扩展名导入、reduce 类型、CLI 最少环境缺 NODE_ENV 失败；未改 tsconfig/断言，改用有原模块类型的本地文件动态导入、明确累加器/环境类型。其后 `/private/tmp/algopilot-r2a-targeted-final.log` 两个新测试文件因 Vitest/jsdom 将 URL 转为 http: 而在 ESM loader 加载前失败；改为 node:url 的显式 file URL，未放行任何网络。最终测试及审计通过；旧中间 PASS 不叠加为最终用例数，也不覆盖这两次 FAIL。后续审查补齐 CLI 受控审计继承及账本安全形态/纯版本读取后，完成了上述最终完整回归。

逐字核对 **312** 个源码/配置/测试/迁移及 R2 SQL 文件，与最终全量执行副本无差异。E2E 副本只存在既有 Provider 夹具和 17 个 spec 审计 import 的预期转换，其余相同。没有修改 `src/`、001–013、package/lock、原生入口/34 项、B3/审计收集器、推荐权重或研究定义；13 个源文件哈希与 R1 一致。

最终 HEAD 仍为 **dc5fee5b1e5380f6de3f77d601041b01218c8f64**。起始干净，最终 **3 个已跟踪文件修改 + 10 个新增文件，共 13 文件**，未 commit/push/PR：

| 文件 | 作用 |
| --- | --- |
| `scripts/r2a-hosted-readiness.ts`（新） | 复用 M35 比较器；严格额外对象/账本/前缀提案、永久离线拒绝 preflight、独占/脱敏 CLI |
| `docs/sql/R2_READONLY_STRUCTURE.sql`（新） | 001–013 完整 ACL/目录、安全账本形态，只读且不调用业务函数 |
| `docs/sql/R2_READONLY_LEDGER_VERSIONS.sql`（新） | 安全前置下的版本列专用 SELECT |
| `tests/unit/r2a-hosted-readiness.test.ts`（新） | 自签/目标/权限/备份/真实用户数据拒绝、CLI 脱敏/独占/退出 2 |
| `tests/integration/r2a-catalog-readiness.test.ts`（新） | 四前缀真实本地目录读取、011/012 替换、013 ACL/FK/唯一、漂移/重载/账本异常/隐私 |
| `scripts/check-offline.mjs` | 追加 --hosted-readiness 与仅该模式的本地参考输出目录，不改原检查集合 |
| `scripts/test-offline-e2e.mjs` | 私有副本纳入本轮未跟踪工具/测试/SQL，防止 build 漏测 |
| `docs/r2a/catalog-reference-summary.json`（新） | 本地参考计数/四前缀摘要/SQL hash/13 迁移完整 SHA-256 |
| `docs/r2a/r2b-request.template.json`（新） | 无目标默认值、不可信的审批申请模板 |
| `docs/r2a/ledger.template.json`（新） | 默认 UNREADABLE，不假定空账本 |
| `docs/r2a/local-verification.json`（新） | 实际本地执行/审计/来源一致性/失败记录 |
| `docs/MVP_R2A_HOSTED_READINESS_VERIFICATION.md`（新） | 本报告、权限/迁移/JWT/实例矩阵与 R2B 顺序 |
| `docs/MVP_RELEASE_GAPS.md` | 仅更新 P0-B 准备完成；托管未执行状态保留 |

**PASS**：R2A 本地工具/流程与离线回归。**FAIL 保留**：修复前本地检查及既有历史审计。**BLOCKED / NOT_RUN**：R2B 目标与分项远端授权、真实身份、托管迁移/数据效果、多实例。**UNKNOWN / UNRESOLVED**：历史异常完整因果与未插桩流量/读取计量。P0-A 保留 R1 PASS，P0-C / B4 未执行，完整 MVP 不可发布。

本轮到此停止；等待负责人指定专用测试项目、审阅差异及授权对应远端步骤，不自动进入 R2B、R3、B4 或部署。
