# M2 Supabase 与 Provider 配置

先完成 [M1 Supabase 设置](SUPABASE_SETUP.md)。本指南需要项目管理员手工配置，开发代理本轮未连接或修改现有托管项目。不要在生产数据库运行测试夹具。

## 迁移与签名

应用新的 `supabase/migrations/202610110002_m2_tutor.sql`，不要重写/重跑已应用的 M1 迁移。标准 Supabase 将 pgcrypto 放在 extensions；新迁移在缺失时创建它。若现有项目把 pgcrypto 安装到其他 schema，先由管理员检查兼容性，不自动迁移其他应用依赖的扩展位置。

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

BASE_URL 填 API 根路径，应用追加 `/chat/completions`；不接受用户名/密码、query/hash，仅 HTTPS 或本地回环 HTTP。默认使用当前 OpenAI 的 max_completion_tokens；部分兼容服务商只支持 max_tokens 时显式设置 LLM_TOKEN_PARAMETER=max_tokens。没有有效配置返回明确错误，不启用假 AI。Provider 必须支持文本 Chat Completions 与被要求的 JSON 输出；不依赖厂商专有 Structured Outputs。

如需费用估算，按服务商**当前实际报价**设置 LLM_INPUT_USD_PER_MILLION_TOKENS 与 LLM_OUTPUT_USD_PER_MILLION_TOKENS，不默认猜价。cost_usd 只按返回的真实 usage 估算，不包括可能的缓存优惠/额外费用，不是账单；缺价格或缺 usage 为 NULL。每日额度是逻辑分析请求数，失败入场仍占用，每次最多两个 HTTP 尝试；不是硬美元预算。输入字符限制也不是精确 token 上限。取消/超时/服务商未返回 usage 时可能已计费，必须核对服务商账单及账户预算。

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
