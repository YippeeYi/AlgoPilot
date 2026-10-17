# AlgoPilot Codex Project Instructions

- 项目目标（最高优先级）：只聚焦个性化题目推荐、题目分析（分级 Tutor / AC 复盘）、选手能力分析三个核心；CF 已做好的展示不重复开发。用户本地 VS Code 编程、调试，在 CF 官网手动提交；不做在线编程/判题/提交。
- 使用 Next.js App Router/TypeScript strict、shadcn/ui、Supabase Auth/Postgres/RLS、Zod、可配置仅服务端 LLM。
- 不得引入 LangGraph、Redis、Qdrant 或任意执行用户提交的代码，除非用户明确批准后续版本改动。
- 严格遵守 L0–L5 的后端提示权限；L5 双确认，竞赛模式不调用 AI；隐藏未解锁题解/关键性质，不输出模型内部推理。
- 不复制第三方无明确许可证的仓库代码。没有凭据时不得伪称集成成功。
- CF API 只用于元数据/提交/Rating，不假定包含完整题面，导入 URL 做白名单验证。
- 所有写接口验证 Auth/归属/Zod，迁移必须启用 RLS；密钥不能进客户端/仓库/日志。
- 禁止假统计和假 Rating；区分官方事实、用户自报与 AI 推测。
- 修改后运行 lint、typecheck、test、build，并在最终报告中写出结果和未验证部分。
- 详细需求见 DEVELOPMENT_PLAN.md；完整执行指令见 CODEX_PROMPT.md。

## 当前工程基础约定（M3.2 继承）

- 进度与未验证项见 `docs/MILESTONES.md` 和 `docs/M1_VERIFICATION.md`、`docs/M2_VERIFICATION.md`；M0 验收记录保留。缺少 Supabase 配置时只提供无数据布局预览。
- `/practice/preview` 是专用预览入口，不是真实会话；尚未接入的写入/AI 操作必须禁用并说明原因。
- 使用 npm 与锁文件；检查命令为 `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build`；构建后可运行 `npm run test:e2e`。
- 不将配置完整性当作外部服务连接成功。环境信息由 `src/server/config.ts` 白名单输出，不序列化环境对象或含敏感输入的校验错误。
- Auth 使用 `@supabase/ssr` Cookie 和服务端 `getUser()` 验证；`src/proxy.ts` 刷新，`src/server/auth.ts` 再验证。禁止信任 `getSession()` 内嵌身份。
- M1 私人写入使用用户 JWT + 窄范围 RPC；每个 SECURITY DEFINER 必须 `search_path=''`、显式 `auth.uid()` 归属检查、收敛 EXECUTE。禁止直接表 DML 或管理员 SDK 替代 RLS。
- 草稿/状态使用独立 revision 与行锁；历史版本用幂等 requestId，仅显式追加。新增写接口必须字段白名单、Zod、来源检查及安全错误。
- 测试分层：PGlite 执行真实 PostgreSQL/RLS（Auth 上下文替身）；Playwright 用本地 HTTP 契约替身。二者均不能报告为托管 Supabase 集成通过。
- `npm run test:rls` 只允许专用隔离库；必须显式设置 `M1_ALLOW_DATABASE_TESTS=isolated`，禁止生产破坏性测试。
- 工作台主流程保留题面、AI 教练、思路笔记与历史。Monaco 不进入主工作流；旧代码字段/接口/记录保留在兼容区。新 UI 默认不计时，可主动开始；服务器计时不要求网页常开。公开 preview 禁用私人写入/AI。不得实现代码运行器、判题器、CF 自动提交。

- 未 AC 只能使用单 Tutor Orchestrator；AC 复盘使用独立 Review Orchestrator（不是多 Agent），不得写入 AC 前提示历史；Provider、Prompt、输出审核、签名均 `server-only`。Mock Provider 仅测试注入，禁止生产假回复开关或直接流式传递未审核输出。
- 模型消息/事件/usage 写入为用户 JWT + HMAC 受控 RPC，不得把签名密钥、请求 nonce、raw model output、内部推理或 context_evidence 发给浏览器。签名独立密钥只在服务端与 private DB settings 配置；不以 service-role 绕过。
- 权限分为 allowedLevel 与单调 maxSeenLevel；授权本身不增已查看。L5 两个明确操作，绑定用户/会话/requestId/过期挑战；聊天文字不能升级。竞赛模式和完成训练在应用与数据库双重拦截。
- L0/L1 使用受限模型选择及服务端提问模板；L2 以上自动审核不能证明不剧透。12 题审核集固定输出测试不能报告为真实模型质量验收。
- 每日 UTC 入场额度、用户跨会话并发、幂等和租约在数据库控制。真实 usage 缺失标 NULL；超时/崩溃可能已有费用，禁止伪造或声称账单已准确核对。
- 新迁移仅追加，不编辑已应用的历史 SQL。M2 外部 RLS smoke 用 `npm run test:rls:m2`，显式隔离开关与连接；多连接与托管 Supabase 需另验收，见 `docs/M2_SETUP.md`。

- 业务 revision/requestId 冲突使用 PT409（增量迁移 202610120004），不得以 40001 触发 PostgREST 内部事务重试；传输失败/未知错误仍为 503。脱敏诊断仅允许操作名、SQLSTATE/PostgREST code、HTTP status 和类别，禁止 SDK 原文或请求正文。

## M2.5 复盘约定

- 需求以 DEVELOPMENT_PLAN.md v3.2 为准；M2.5 工作台/无思路引导/AC 复盘，M3 CF 元数据与提交结果，M4 知识沉淀/复习/真实统计/产品完善。历史验收保留，新结果见 docs/M25_VERIFICATION.md。
- L0 有思路时围绕卡点，无思路时从用户题面/约束/样例的低信息量问题开始；L0/L1 仍受限选择与服务端模板，不允许自由模型文本绕过审核。
- 代码导入仅粘贴或显式单文件 .cpp/.cc/.cxx/.txt；类型、64000字节、UTF-8/控制字符校验，不遍历其他文件、不执行。发送前说明代码/题面/近期复盘给配置 Provider，要求明确自报 AC 与发送授权。
- 创建复盘用窄 RPC，记录原状态/结果/授权/最高已看；未完成训练事务结束，已完成旧记录不回写。比赛模式禁止 AI。普通聊天不能进入复盘或升级披露。
- 代码快照与 SHA-256 不可变；改代码新建复盘。结构化分析/生成历史/模型/Prompt/时间与用户编辑分开，编辑 revision CAS。不宣称执行、验证或保证正确，列出未证明假设。
- Review 与 Tutor 共用数据库 UTC 额度/跨会话并发/租约，但独立 HMAC operation、分析记录，不改变 maxSeenLevel。nonce/usage/fingerprint 不给浏览器，缺失 token NULL。
- 本服务不采集 CF 提交源码。官方 AC 仅证明公开提交状态，不能证明本地导入源码一致；M2.5 自报与未核实官方字段不能伪造。配置/迁移见 docs/M25_SETUP.md。

## M3 题库与计划约定

- 新训练/新独立复盘从真实 CF 题库选择。禁止新增 custom；旧私人题目/训练/笔记/代码/复盘保留。不要简单禁掉复盘内部无 problemId 的历史兼容 RPC。
- CF 固定公开 problemset.problems，server-only 解析/同步；contestId + index 唯一，支持长及纯数字 index，缺 Rating 保留 NULL，不把 Tags 当题面；未解题默认隐藏 Tags。
- PostgreSQL 持久缓存/6h TTL，共享租约、3 秒请求槽、60 秒冷却、超时/有界退避和缓存回退。查询/排序/分页在数据库，禁止浏览器逐字直接请求 CF。同期调用将来必须复用共享限流。
- 公共元数据仅经用户 JWT + 服务端 HMAC 受控发布，不授普通用户 INSERT。CF 专用密钥可显式配置或从 Tutor master 按 algopilot/cf/v1 派生；不发送给浏览器/日志，不使用 service-role。
- 多计划、同题跨计划、计划内唯一、完整顺序排列、CAS revision/requestId 幂等，PT409。删除计划不删除任何题目、训练或复盘。
- 手动计划进度、每次独立训练状态、自报 AC、官方提交和 AI 分析完成分别显示。Handle/官方提交增量同步未实现时明确官方状态未同步，不能伪造结果。保存代码快照不能计作已生成 AI 复盘。
- 追加 006 不改 001–005。部署前核对 005 已完整应用，未经用户授权不写托管数据库。M3 配置/验收见 docs/M3_SETUP.md、docs/M3_VERIFICATION.md。

## M3.2 推荐与能力画像约定

- 首页 `/dashboard` 回答练什么及原因；`/analytics` 展示能力画像，`/reviews` 为分析/复盘入口。题库、多计划、训练记录、账户为辅助入口；深链接、跨页多选、API 与历史保留。
- 不开发提交浏览器、Rating 历史图表、排行榜、日历、社交/成就/打卡或无关统计。官方提交采集只服务证据分析，不复制 CF 展示。
- 推荐确定性 V1：权重与证据模型集中 `src/features/learning/engine.ts`，候选 SQL 过滤/分层最多 600 条，每轮最多 5 题，解释附记录 ID。所有已知自报解出/复盘题从完整历史排除，主动重练可开启；活跃计划降权不删除关联。
- Rating NULL 不推荐；有主题时要求可信 Tags 命中，均衡时缺 Tags 仅依据难度。默认不输出未解题 Tags；主题选择明确告知可能提示方向。结束但未解且未看 L5 的知识方向不展开。
- 能力画像使用同一证据模型，最近 500 训练，同题最新完成记录仅计一次，5 道题以下“样本不足”，以上也仅有限可信；无综合能力分/伪官方 Rating。实际提示与授权分开，自报结果/官方元数据/AI 推测分别标注；无提示不证明独立。
- 复盘证据需额外主动授权，仅读取已完成、已授权的结构化分析（每题最新、最多 200 题）；词汇/风险映射只能生成待验证建议，权重低，不读取源码/编辑笔记、不新调模型。关闭后停止使用证据，不删除原复盘。
- 用户偏好和反馈使用 007 追加迁移、RLS、普通 JWT/窄 RPC/字段白名单/行锁/CAS/requestId/PT409；不修改 001–006，未经本阶段授权不部署托管迁移。反馈是偏好，不是能力事实。
- 缺少题面/补充上下文时 Tutor 要求补充，不调用模型，不根据标题/Tags 猜题意；继续保留所有提示权限、HMAC、配额/租约与 Review 安全机制。
- 配置与算法局限见 `docs/M32_SETUP.md`，实际检查与外部未验证项见 `docs/M32_VERIFICATION.md`。

## M3.2.1 验收与质量约定

- 推荐算法版本 deterministic/1.1；008 只修正已证明的候选 Tags 顺序、比赛新旧及计划饥饿偏差。评分权重与 600/500/200 上限不变；未来变更先用固定数据证明问题。
- 原始 007 DDL 重跑会原子拒绝，不是假称迁移幂等；只应用缺失迁移。001–007 不修改，生产 007/008 仍须当前阶段明确授权，不使用生产数据进行破坏性验证。
- 评测 `npm run test:recommendations`；原生临时隔离 `M321_ALLOW_DATABASE_TESTS=isolated npm run test:isolated:m321`，不读取生产 URL。原生 PostgreSQL 多连接验证仍不等于 Supabase JWT/PostgREST 集成。
- 偶数中位数取两项均值；requestedShift 表示反馈请求，shift 表示范围裁剪后实际变化。解释必须来自实际评分因素，换一轮降权也包含在因素中。
- 偏好/授权变动时拒绝旧 revision 的在途推荐/画像；新反馈意图新 ID，未知结果重试沿用原 ID。复盘否定词不能反向变成知识方向加权，AI 总贡献不随复盘数量累加。
- 近期窗口不代表长期全部能力，旧方向退出窗口不意味着掌握。人工教学评审必须由人填写，自动标签/难度断言不能冒充真实推荐价值。
- 报告见 docs/M321_RECOMMENDATION_EVALUATION.md，人工表见 docs/M321_MANUAL_REVIEW.md；托管/真实用户评审未完成时不得宣称具备生产发布验收。

## M3.2.2 评审与题型适配约定

- deterministic/1.2：009 在 600 预算前排除 interactive 与有官方来源的比赛语言限制，不全局禁止 special；例外表私有 RLS，无普通用户写入。001–008 保持原样，009 需明确生产授权，只应用缺失迁移。
- 小型 problem-annotations.json 为 AI 官方来源核验，不是真人教学结论；core/Tags-only/related 匹配强度 1/0.75/0.25 集中在 engine.ts。标注是支持的训练任务，不宣称唯一必需算法，不为固定题号预定名次。默认方向/题解仍隐藏。
- review:recommendations 校验 scenario + problem_key，保留原人工/AI CSV、独立真人覆写和 auditHistory；来源核验、AI 初评、真人结论分栏，评审不能进入线上画像。真人未填仍 0/40。
- 候选返回 training-fit/1，应用拒绝旧策略，不用旧预算后过滤冒充新筛选。目标 007/008 匿名 PGRST202 不能证明部署状态；真实 JWT/托管/教学收益待验。报告 docs/M322_RECOMMENDATION_REVIEW.md。

## M3.3 官方提交证据约定

- 只关联公开账号，ownershipVerified 永远 false；user.info 当前 Handle 与注册时间作变化哨兵，不假装有不可变 CF 用户 ID。绑定默认不参与分析；启用前重新校验。
- user.status 显式 includeSources=false；每页 200/重叠 40，高水位增量、EOF 探测、逐批提交、断点与漂移重启、待判复查/持续旧历史重扫。预算不是完整性，不因未观察到 OK 推断未做。每次尝试共用题库的 PostgreSQL 3 秒时隙，锁后读取时钟，网络在事务外；无 Redis/队列。
- 010 追加私人 cf_accounts/cf_submissions/receipts，RLS+无直接 DML/读取授权、正常 JWT 窄 HMAC RPC、scope/nonce/租约/CAS/requestId/PT409；001–009 不改。更换/删除清除旧关联，授权关闭让新结果不使用官方事实，证据 revision 拒绝在途旧推荐/画像；不持久化派生能力缓存。
- deterministic/1.3-official：全历史已知 OK 在 600 预算前排除，主动重练例外；画像取最近 500 道官方 OK，仅补充相应覆盖与近期新颖/探索，不自动升难度、不稀释提示弱项、不改旧自报/计划/复盘或 Tutor 权限。官方不证明归属/独立/源码一致，WA/提交耗时不是能力证据。
- 原 40 条 AI 初评与真人分离（真人 0/40）；五道 M322 替代题独立待审（0/5）。离线评审和合成官方提交不得进入线上用户画像。
- test:isolated:m33 只创建本机临时隔离库，显式 M33_ALLOW_DATABASE_TESTS=isolated；真实公开 API 录制不等于托管 JWT 验收。007–010 目标部署仍需管理只读核验，未经明确授权不得生产迁移/数据修改/部署。见 docs/M33_SETUP.md、docs/M33_VERIFICATION.md。

## M3.4 验收纪律

- 先读 docs/M34_ACCEPTANCE.md、docs/M34_RECOMMENDATION_STUDY.md。本阶段专用托管项目未就绪；不得沿用历史授权写现有 Supabase，不自行创建付费资源。远端用户/配置/迁移/清理均需目标与变更清单及新授权。
- 用户手工核验 SQL 只允许 SELECT/系统目录，无 BEGIN/SET/DDL/DML/副作用 RPC；函数哈希匹配与版本账本分栏，私有 HMAC 一致性单列未验证，不读或导出密钥。001–010 不改。
- 真实 JWT 必须实际签发并由 Supabase 验证；本机 Auth claims/HTTP 回放不能冒充。数据库 backend 数与应用实例数分别报告，三连接不是多实例。
- 本轮公开 YippeeYi 仅获准必要官方只读取证、本地或隔离存储，无源码/个人字段/远端关联写入；三次请求已完成，勿因重放再次联网。
- 维持 1.3-official 权重与主逻辑，先复现对照再修复。评审包含剧透，只给评审者；人工 0/40、替代 0/5，真实参与者 0，不得用 AI/合成结果提升计数。
- A/B 共同候选/难度/题数/已完成/题型约束、平衡顺序、重叠题不重复计成果；参与同意、Provider 发送、分享授权分开，个人材料留私有目录。
- 新响应重放测试保留真实 3 秒槽与 30 秒冷却，单例 120 秒测试预算只是容纳真实等待；生产限流/权限无变化。运行 lint/typecheck/test/build/test/test 与原生隔离，并区分已完成、待人工、待授权。

## M3.4.1 CF 账号交互约定

- Handle 受控草稿始终可编辑，不从异步账号状态回填；配置/Auth/读取失败只限制操作按钮。重载保留输入，未知结果重试保留原请求体/requestId；新意图用新 ID。
- 关联仅在配置完整、服务端 getUser 后状态读取成功、格式有效且无冲突操作时启用。RPC 不可用不能直接证明迁移缺失；错误固定中文脱敏，不显示 SDK/签名/租约。真实绑定与本地交互分别验收，见 docs/M341_VERIFICATION.md。

## M3.5 真实验收约定

- 当前实核目标为 qmlsgwbiiqpbelgkgsdw/main/PRODUCTION；本轮获准的两轮同步预算已用完，授权已恢复开启。不得把此范围沿用于额外同步、重绑、删除、其他用户或迁移；新范围另确认。
- 有效结构与账本分开：39 项目函数等目录匹配，schema_migrations 实际缺失；不自动 repair/db push/pull 或补建历史。PG18 的 NOT NULL 目录差异须与目标列约束逐项核对，不忽略其他缺失。
- 只读候选采集夹具只在本地临时安装，采集后移除产品路由；原始用户材料仅私有目录。个人训练/人工评价未完成不得增加计数或宣称闭环/教学收益，见 docs/M35_REAL_WORLD_ACCEPTANCE.md。
