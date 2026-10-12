# AlgoPilot Codex Project Instructions

- 项目目标：Codeforces/XCPC 学习与复盘助手；核心是卡题启发式引导和 AC 后用户主动提供的 C++ 代码深度复盘。用户本地 VS Code 编程、调试，在 CF 官网手动提交；不做在线编程/判题/提交。
- 使用 Next.js App Router/TypeScript strict、shadcn/ui、Supabase Auth/Postgres/RLS、Zod、可配置仅服务端 LLM。
- 不得引入 LangGraph、Redis、Qdrant 或任意执行用户提交的代码，除非用户明确批准后续版本改动。
- 严格遵守 L0–L5 的后端提示权限；L5 双确认，竞赛模式不调用 AI；隐藏未解锁题解/关键性质，不输出模型内部推理。
- 不复制第三方无明确许可证的仓库代码。没有凭据时不得伪称集成成功。
- CF API 只用于元数据/提交/Rating，不假定包含完整题面，导入 URL 做白名单验证。
- 所有写接口验证 Auth/归属/Zod，迁移必须启用 RLS；密钥不能进客户端/仓库/日志。
- 禁止假统计和假 Rating；区分官方事实、用户自报与 AI 推测。
- 修改后运行 lint、typecheck、test、build，并在最终报告中写出结果和未验证部分。
- 详细需求见 DEVELOPMENT_PLAN.md；完整执行指令见 CODEX_PROMPT.md。

## 当前工程约定（M2.5）

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

- 需求以 DEVELOPMENT_PLAN.md v2.0 为准；M2.5 工作台/无思路引导/AC 复盘，M3 CF 元数据与提交结果，M4 知识沉淀/复习/真实统计/产品完善。历史验收保留，新结果见 docs/M25_VERIFICATION.md。
- L0 有思路时围绕卡点，无思路时从用户题面/约束/样例的低信息量问题开始；L0/L1 仍受限选择与服务端模板，不允许自由模型文本绕过审核。
- 代码导入仅粘贴或显式单文件 .cpp/.cc/.cxx/.txt；类型、64000字节、UTF-8/控制字符校验，不遍历其他文件、不执行。发送前说明代码/题面/近期复盘给配置 Provider，要求明确自报 AC 与发送授权。
- 创建复盘用窄 RPC，记录原状态/结果/授权/最高已看；未完成训练事务结束，已完成旧记录不回写。比赛模式禁止 AI。普通聊天不能进入复盘或升级披露。
- 代码快照与 SHA-256 不可变；改代码新建复盘。结构化分析/生成历史/模型/Prompt/时间与用户编辑分开，编辑 revision CAS。不宣称执行、验证或保证正确，列出未证明假设。
- Review 与 Tutor 共用数据库 UTC 额度/跨会话并发/租约，但独立 HMAC operation、分析记录，不改变 maxSeenLevel。nonce/usage/fingerprint 不给浏览器，缺失 token NULL。
- CF API 不提供提交源码。官方 AC 仅证明公开提交状态，不能证明本地导入源码一致；M2.5 自报与未核实官方字段不能伪造。配置/迁移见 docs/M25_SETUP.md。
