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

## 当前工程约定（M0）

- 进度与未验证项见 `docs/MILESTONES.md`；M0 公开路由只提供无数据布局预览。
- `/practice/preview` 是专用预览入口，不是真实会话；尚未接入的写入/AI 操作必须禁用并说明原因。
- 使用 npm 与锁文件；检查命令为 `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build`；构建后可运行 `npm run test:e2e`。
- 不将配置完整性当作外部服务连接成功。环境信息由 `src/server/config.ts` 白名单输出，不序列化环境对象或含敏感输入的校验错误。
