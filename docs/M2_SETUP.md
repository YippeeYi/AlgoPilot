# M2 Supabase 与 Provider 配置

先完成 [M1 Supabase 设置](SUPABASE_SETUP.md)。本指南需要项目管理员手工配置，开发代理本轮未连接或修改现有托管项目。不要在生产数据库运行测试夹具。

## 迁移与签名

应用新的 `supabase/migrations/202610110002_m2_tutor.sql`，不要重写/重跑已应用的 M1 迁移。标准 Supabase 将 pgcrypto 放在 extensions；新迁移在缺失时创建它。若现有项目把 pgcrypto 安装到其他 schema，先由管理员检查兼容性，不自动迁移其他应用依赖的扩展位置。

Gemini 修复还需追加应用 `supabase/migrations/202610110003_gemini_usage.sql`。它仅替换 usage 总数的算术约束并增加只读生成列 `unclassified_tokens`，不改变历史总数、签名或 RLS；不要修改已应用的 M2 文件。旧约束尚未迁移时，非加和 usage 无法结算。普通 JWT 无 DDL 权限，需要管理员应用这份非破坏性迁移；本轮不使用 service-role 或生产测试夹具。

M2 不使用 service-role key。为防止普通 JWT 直接伪造 assistant/usage RPC 参数，应用与数据库共享一个**单独**的 Tutor 签名密钥。它不是 LLM API Key。生成 32 字节随机值（64 个十六进制字符），只保存于服务端环境与不可读的 private 表：

```bash
openssl rand -hex 32
```

在管理员 SQL Editor 中将同一个值写入 private 配置（替换占位符，不要提交实际密钥）：

```sql
insert into algopilot_private.tutor_settings(singleton, signing_secret, daily_hard_limit)
values (true, '<64-hex-secret>', 100)
on conflict (singleton) do update
set signing_secret=excluded.signing_secret, daily_hard_limit=excluded.daily_hard_limit;
```

部署环境设置 `TUTOR_RPC_SIGNING_SECRET=<同一个值>`，绝不加 NEXT*PUBLIC*。daily_hard_limit 默认 100，可按需求调整（1–1000）；应用 LLM_DAILY_REQUEST_LIMIT 不能超过它。只有管理员能读取/改变配置，普通应用用户不能读取 signature secret 或请求 nonce。轮换时协调数据库与全部应用实例；切换期间签名不匹配将失败，未完成请求可能只能等待租约过期，不能自动恢复计费结果。

## 模型配置

```dotenv
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=<服务商支持的模型ID>
LLM_API_KEY=<服务端API Key>
LLM_DAILY_REQUEST_LIMIT=30
LLM_MAX_INPUT_CHARS=24000
LLM_MAX_OUTPUT_TOKENS=1200
LLM_TOKEN_PARAMETER=max_completion_tokens
TUTOR_RPC_SIGNING_SECRET=<上述64-hex-secret>
```

BASE_URL 填 API 根路径，应用追加 `/chat/completions`；不接受用户名/密码、query/hash，仅 HTTPS 或本地回环 HTTP。通用端点默认 max_completion_tokens；只支持 max_tokens 时显式设置 LLM_TOKEN_PARAMETER=max_tokens。没有有效配置返回明确错误，不启用假 AI。通用端点默认不发送 reasoning_effort/response_format；仅验证支持后显式启用 `LLM_RESPONSE_FORMAT=json_schema`。

如需通用端点费用估算，按服务商**当前实际报价及 usage 语义**设置 LLM_INPUT_USD_PER_MILLION_TOKENS 与 LLM_OUTPUT_USD_PER_MILLION_TOKENS。仅在总数等于输入加输出、完整输出计费语义已确认时使用这项估算；它不包括缓存优惠/额外费用，不是账单。缺价格、缺 usage 或存在未归类差额均为 NULL。Gemini profile 的费用暂时始终 NULL：官方说明输出价包括思考，但兼容响应三项计数不足以确认全部类别/折扣，不能只给可见输出定价。每日额度按逻辑请求，失败入场仍占用，最多两次 HTTP 尝试；不是硬美元预算。取消/超时可能已计费，需要核对供应商账单。

## Gemini 3.8 Flash

```dotenv
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_MODEL=gemini-3.8-flash
LLM_API_PROFILE=gemini
LLM_TOKEN_PARAMETER=max_tokens
LLM_MAX_OUTPUT_TOKENS=4096
LLM_REASONING_EFFORT=low
LLM_RESPONSE_FORMAT=json_schema
LLM_TIMEOUT_MS=60000
```

Key 和签名仍沿用前述服务端变量。仅官方 HTTPS `/v1beta/openai` 且模型 ID 为 `gemini-*` 自动识别；其他网关必须显式选 profile。已有显式 token 参数和输出预算优先，不会擅自扩大预算。Google 兼容层仍在 beta；max_tokens 有官方技术回复支持，max_completion_tokens 保留为可配置选项，具体端点实测结果见 [Gemini 验收记录](GEMINI_VERIFICATION.md)。没有自动切换参数并再次计费的重试。

reasoning_effort 是上限而非提示权限：L0/L1 及 chat/hint 始终 low；允许更高等级且配置上限至少 medium 时 validate/complexity 可 medium。counterexample/explain 在上限 high、至少 4096 输出预算且服务端等级允许时可 high，其他情况下降为 medium/low。默认 low，避免免费额度、延迟与预算消耗；提高等级不会自动提高配置上限。一次 L0 验收不能证明 medium/high 教学质量。

JSON schema 从现有严格 Zod 输出契约生成，仍须通过 `auditOutput`。不发送 include_thoughts，不返回 thought_signature、reasoning_content 或原始响应。非流式，完成审核后才展示。思考与可见输出可能共用生成预算；建议 4096 起，按实际需求调整到最多 8000，截断仍拒绝展示而非绕过审核。

usage 接受有界非负整数，要求 `total_tokens >= prompt_tokens + completion_tokens`，保留供应商原始三项计数。例 9/62/710 的差额 639 自动保存为 `unclassified_tokens`；不是已验证 reasoning_tokens。计数缺失时 NULL，负数、小数、字符串、矛盾或超过一亿拒绝。普通用户不能改写计数或生成差额。

单次超时 `LLM_TIMEOUT_MS` 为 1000–120000ms，默认 Gemini 60000、通用 45000。两次尝试与 350ms 退避共享最多 120 秒预算，普通 HTTP Route 从入场前计时 150 秒，并额外保留 50 秒用于数据库结算和并行恢复历史/状态，故实际可用模型预算会更短。Next `maxDuration=180`，数据库租约仍为 180 秒；超时/取消不自动重试。部署平台必须允许 180 秒请求，平台更短限制仍可能提前中止，需要部署验收；应用无法延长平台套餐的硬限制。

依据：[Google OpenAI compatibility / reasoning / JSON schema](https://ai.google.dev/gemini-api/docs/openai)、[思考与输出预算](https://ai.google.dev/gemini-api/docs/generate-content/thinking)、[输出价格包括 thinking](https://ai.google.dev/gemini-api/docs/pricing)、[Google 技术回复：max_tokens 总生成预算](https://discuss.ai.google.dev/t/gemini-3-6-flash-openai-compatible-token-limits-response-fields-and-auth-keys/183372)。文档支持不等于本项目已完成真实调用验收。

## 验收

先在隔离项目配置上述迁移、Email Auth 与签名；使用两个测试账户：

1. A 创建自主训练并请求 L0；刷新历史恢复，普通 JWT 不能直接 INSERT/UPDATE/DELETE messages/events/usage，不能读取 private 或 request nonce/context_evidence。
2. B 看不到 A 的历史/usage，HTTP 与直接 RPC 均拒绝跨用户对象。未登录请求 401，preview 不调用 Auth/私人数据/LLM。
3. L0–L4 每次独立升级；等级授权不增 max_seen。L5 先申请，第二次匹配用户、会话、requestId、challenge 和有效期限；过期和重放拒绝。
4. contest 和 completed 会话不调用 Provider；分析过程中完成的结果不展示，返回的真实 usage 仍记录。CF 实时比赛状态检查留 M3。
5. **多条独立连接/应用实例**并发请求同用户不同会话，只有一次入场；每日上限、UTC 重置、重复 requestId、过期租约、晚到 usage 与消息原子性正确。本地 PGlite 单连接测试不能代替此步骤。
6. 服务商真实调用一次，核对 model、usage、超时/取消、token 参数、可见输出安全；不能将本地 HTTP Mock 当作联通。按 [12 题教学人工审核](tutor/TEACHING_REVIEW.md) 检查低等级泄露、判断/反例正确性、重复与针对性。
7. 服务中断/数据库结算失败时用量可能未知；核对 provider 账单。M2 没有后台恢复队列，进程崩溃后租约会阻止立即重复调用，过期后新请求允许入场，但不能补造丢失的 token 记录。

隔离数据库已迁移且安装 psql 时可运行回滚 SQL 测试：

```bash
export M2_ALLOW_DATABASE_TESTS=isolated
export M2_TEST_DATABASE_URL='<专用测试库连接字符串>'
npm run test:rls:m2
```

完整 HMAC/租约/用量/权限 SQL 测试默认在 `npm run test` 的临时 PostgreSQL 中执行。外部 SQL 脚本是较小的匿名/双用户/不可伪造权限 smoke；均不允许生产库。

参考：[OpenAI Chat Completions 请求与 usage](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[PostgreSQL pgcrypto HMAC](https://www.postgresql.org/docs/current/pgcrypto.html)、[KaTeX 信任选项](https://katex.org/docs/options.html)、[KaTeX 安全修复公告](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7)。
