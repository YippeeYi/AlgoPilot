# Gemini Provider 兼容性修复验收

日期：2026-10-11。基线 main `77d58e7e98165b9909e2fcf953ce07c022dfab1b`；开始时工作区干净。增量修复，M0–M2 原测试全部保留，未修改历史迁移、Prompt 或 auditOutput，未增加项目依赖/改变锁文件。

## 修复范围

- usage 接受非加和总数，但拒绝负数、非整数/字符串、部分计数、总数小于输入加输出及超过一亿的计数。供应商总数不重写。
- 新迁移 `202610110003_gemini_usage.sql` 保留原记录，替换旧算术约束；生成列记录差额为 unclassified_tokens。9/62/710 精确保留，差额 639 不标为 reasoning_tokens。
- Gemini profile 或额外未归类用量的 cost_usd 为 NULL，即使配置价格也不按可见输出低估全部费用。官方定价包括 thinking；这里没有足够分类与计费信息，不虚构精确账单。
- 官方端点自动识别，其他网关显式选择 profile。Gemini 可用 JSON schema 与 reasoning_effort；通用端点默认不附加这些参数。低等级/chat 强制 low，其他策略受配置上限和输出预算控制。
- 输出预算默认 Gemini 4096（显式设置优先）；max_tokens/max_completion_tokens 可配置，不自动降级并再次计费。Gemini 总生成计数超过预算仍拒绝展示并保留已返回的 usage。
- 单次超时可配，两个尝试和退避共用总预算；Route deadline 与 50 秒结算余量使模型调用早于 Next 180 秒限制和 DB 180 秒租约结束。超时/取消不重试；部署平台硬期限仍需单独验收。
- 结构化输出只帮助格式，Zod + auditOutput 全部保留。不请求/返回思考摘要、thought_signature、reasoning_content、API Key 或原始响应。

## 实际本地检查

| 检查       | 结果与范围                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| lint       | 通过，0 warnings                                                                                        |
| typecheck  | Next typegen + TypeScript strict 通过；恢复原 next-env dev 导入后 tsc 再通过                            |
| Vitest     | 13 文件，131/131 通过；原有 112 项全部保留                                                              |
| build      | Next.js 16.4.0 Webpack 通过，Monaco DOMPurify 3.4.16 检查通过                                           |
| Playwright | 28/28 通过，原桌面/移动 M0–M2；仅本地 HTTP 替身                                                         |
| SQL/RLS    | PGlite 实际 PostgreSQL + pgcrypto 执行三份迁移，M2 13 项、M1 4 项 SQL 测试通过；Auth/JWT 上下文仍是夹具 |

实际扫描 `.next/static` 的 56 个 JavaScript 文件，当前 LLM Key 与 Tutor 签名的匹配数为 0；只输出计数，没有输出秘密。

新增 19 项回归包含提供的 Gemini 响应形状、未知费用、非法计数、参数隔离、JSON schema 不绕过审核、低等级/配置上限、预算与超时/退避取消。SQL 验证签名 finish 写入 9/62/710、消息可读取、差额 639、两用户 RLS 隔离、普通 DML/生成列伪造拒绝及部分 NULL 拒绝。测试中初次新增约束夹具遗留 pending 租约，导致后续原测试失败；补齐夹具失败结算后原断言全部通过，未删/跳过测试。

## 真实 Provider 与托管数据库

仅检查白名单配置：Google 官方端点、模型 gemini-3.8-flash、Key 存在、独立签名格式有效、Supabase 公开配置存在。没有输出或提交秘密。现有显式 max_completion_tokens 与 4096 输出预算保留。

**真实 L0 调用尚未执行。** 当前浏览器访问修复版私人训练列表跳转到登录；没有已授权的登录训练会话，没有管理员数据库连接，新增迁移及 DB 签名匹配未能核对。未为了探测 Key 绕过 Auth、单独调用模型、创建外部账户、使用 service-role 或执行生产测试夹具。因此真实 HTTP/JSON、托管消息落库/刷新、供应商真实 usage 和 max_completion_tokens 实际兼容性均未宣称通过。上面的 9/62/710 是用户提供的真实响应形状回归，不是本轮实际调用结果。

可继续验收步骤：管理员追加迁移；登录普通自主训练账户，确保保存已有思路；确认服务端与 private settings 签名一致且当日有额度；通过工作台只调用一次 L0。核对服务端白名单 HTTP/JSON 成功、已审核消息和刷新历史，以及本人 llm_usage 原始三项计数/差额/NULL 费用。不要向浏览器或日志暴露原始响应、签名或密钥。仅一次 L0 无法证明所有等级或 medium/high 教学质量。

## 尚未验证

托管 Supabase 新迁移/真实 RLS/多连接并发；真实 Gemini JSON schema、token 参数、延迟/限流/取消和账单；部署平台 180 秒期限；12 题及更多案例的真实教学质量、反例正确性与高等级低剧透表现。已有 braces 开发依赖告警继续追踪，本轮未添加覆盖或更改依赖。

依据与配置见 [M2_SETUP.md](M2_SETUP.md)。Google 官方资料验证了兼容接口、effort/结构化输出、思考共用预算和含思考的输出定价；资料不是本项目真实调用的替代证据。
