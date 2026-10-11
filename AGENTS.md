# AlgoPilot Codex Project Instructions

- 项目目标：个人算法竞赛训练助手，以苏格拉底式 AI 思维教练为核心，不代替用户解题。
- 使用 Next.js App Router/TypeScript strict、shadcn/ui、Supabase Auth/Postgres/RLS、Zod、可配置仅服务端 LLM。
- 不得引入 LangGraph、Redis、Qdrant 或任意执行用户提交的代码，除非用户明确批准后续版本改动。
- 严格遵守 L0–L5 的后端提示权限；L5 双确认，竞赛模式不调用 AI；隐藏未解锁题解/关键性质，不输出模型内部推理。
- 不复制第三方无明确许可证的仓库代码。没有凭据时不得伪称集成成功。
- CF API 只用于元数据/提交/Rating，不假定包含完整题面，导入 URL 做白名单验证。
- 所有写接口验证 Auth/归属/Zod，迁移必须启用 RLS；密钥不能进客户端/仓库/日志。
- 禁止假统计和假 Rating；区分官方事实、用户自报与 AI 推测。
- 修改后运行 lint、typecheck、test、build，并在最终报告中写出结果和未验证部分。
- 详细需求见 DEVELOPMENT_PLAN.md；完整执行指令见 CODEX_PROMPT.md。

## 当前工程约定（M1）

- 进度与未验证项见 `docs/MILESTONES.md` 和 `docs/M1_VERIFICATION.md`；M0 验收记录保留。缺少 Supabase 配置时只提供无数据布局预览。
- `/practice/preview` 是专用预览入口，不是真实会话；尚未接入的写入/AI 操作必须禁用并说明原因。
- 使用 npm 与锁文件；检查命令为 `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build`；构建后可运行 `npm run test:e2e`。
- 不将配置完整性当作外部服务连接成功。环境信息由 `src/server/config.ts` 白名单输出，不序列化环境对象或含敏感输入的校验错误。
- Auth 使用 `@supabase/ssr` Cookie 和服务端 `getUser()` 验证；`src/proxy.ts` 刷新，`src/server/auth.ts` 再验证。禁止信任 `getSession()` 内嵌身份。
- M1 私人写入使用用户 JWT + 窄范围 RPC；每个 SECURITY DEFINER 必须 `search_path=''`、显式 `auth.uid()` 归属检查、收敛 EXECUTE。禁止直接表 DML 或管理员 SDK 替代 RLS。
- 草稿/状态使用独立 revision 与行锁；历史版本用幂等 requestId，仅显式追加。新增写接口必须字段白名单、Zod、来源检查及安全错误。
- 测试分层：PGlite 执行真实 PostgreSQL/RLS（Auth 上下文替身）；Playwright 用本地 HTTP 契约替身。二者均不能报告为托管 Supabase 集成通过。
- `npm run test:rls` 只允许专用隔离库；必须显式设置 `M1_ALLOW_DATABASE_TESTS=isolated`，禁止生产破坏性测试。
- Monaco 按需加载 npm ESM，仅本地 worker（predev/prebuild 生成，忽略生成物）；不能执行用户代码。AI 区域仍禁用，M1 不实现 LLM/CF/自动复盘。
