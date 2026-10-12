# M2.5 配置与 API

先应用现有 001–004 迁移，再追加 `supabase/migrations/202610120005_ac_reviews.sql`。不要改写历史迁移，也不要将测试夹具用于生产。新增训练计时偏好字段、`create_untimed_session`、`code_reviews`、`review_requests` 和复盘 RPC；扩展既有 Tutor 入场/状态函数以共用额度，保留 HMAC/权限/完成/比赛 guards。

继续使用 [M2_SETUP.md](M2_SETUP.md) 的服务端 Provider 和独立 `TUTOR_RPC_SIGNING_SECRET` / `algopilot_private.tutor_settings` 配置。复盘复用签名密钥但使用独立 operation 作用域，使用用户 JWT，不要添加 service-role。迁移从既有函数定义精确修改共享额度/并发条件，若定义不符合预期则整笔回滚，需先检查已有自定义部署差异。

`LLM_MAX_INPUT_CHARS` 默认 24000；代码可保存至 64000 UTF-8 字节，但题面、行号、问题、Prompt 等超过模型字符预算时调用返回 413，不截断当前代码。历史优先缩短。按实际模型能力配置输入/输出预算（输出上限 8000 tokens）；九项深度分析可能需要比原 Tutor 1200 tokens 更多的预算，截断则拒绝展示。配置完整不代表连接成功。

## HTTP

- `GET /api/v1/reviews`：本人最新 100 份复盘，当前基础版本无分页 UI。
- `POST /api/v1/reviews`：`sessionId` UUID/null，`requestId` UUID，`code`，`source` paste/file，`fileName` null/允许扩展名，`problemUrl` 白名单 CF HTTPS URL/空，`statement` 最多16000字符，`submissionId` 数字字符串/null，以及 exact confirmation：`我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘`。201，返回不可变快照。不会在这一步调用模型；关联的未完成训练在事务中完成。自报状态不能写入官方字段。
- `GET /api/v1/reviews/:id`：快照、授权事件、最近30份已审核分析、配置布尔值。404 隔离；不返回 nonce/usage/原始模型输出。
- `PATCH /api/v1/reviews/:id`：仅 `revision` 和 `notes`（最多16000字符）；冲突409。不能修改代码、owner、官方 Verdict 或分析。
- `POST /api/v1/reviews/:id/generate`：仅 `requestId` 和 `question`（空为生成/重新生成，追问最多3000字）；数据库额度/租约入场，审查后 HMAC 持久化。相同 requestId+问题成功后缓存，不再调用模型；失败使用新 requestId。未知失败仍503，已过期结果不展示，可能已有费用。
- `POST /api/v1/sessions` 追加可选 `timerEnabled`。新 UI 传 false，原 API 未传仍保留旧计时行为；计时可手动开始。独立复盘不要求先建立训练。

复盘链接 `/reviews?reviewId=UUID` 支持刷新恢复，训练链接 `/reviews?sessionId=UUID` 支持关联。结果只作为 AI 静态分析；从未执行或验证用户代码。官方 AC 同步属 M3，M2.5 始终 `verdict_source=user_reported`、`official_verdict=NULL`、`source_match=unverified`。提交 ID 不足以改变这些字段，M3 也不能利用公开 API 推断源码一致。

文件读取只发生在浏览器选择的一个 File 上，无二进制上传或任意路径接口；允许扩展名和文本兼容 MIME，再严格校验 UTF-8/控制字符/字节数。粘贴也做字节数校验。UI 先说明发送内容与 Provider，明确确认后保存快照，点击生成/追问才发送。应先清除代码中的秘密/私人路径。代码使用纯文本，分析使用已有安全 Markdown/KaTeX 渲染。

## 验收

本地测试执行全部迁移与真实 PostgreSQL/RLS，但 Auth 是夹具；E2E 为本地 HTTP 契约。正式部署需在专用测试项目验证迁移、两用户读写隔离、PostgREST 签名 RPC、共享多连接额度/并发、刷新 Cookie、实际 Provider 九项输出质量/取消/用量。不要在现有托管用户库执行 rollback/破坏性测试。既有 M1/M2 SQL smoke 不覆盖 M2.5，新增隔离覆盖见 `tests/integration/review-database.test.ts`。
