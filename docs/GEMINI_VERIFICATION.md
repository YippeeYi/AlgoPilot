# Gemini Provider 兼容性修复验收

日期：2026-10-11。基线 main `77d58e7e98165b9909e2fcf953ce07c022dfab1b`；开始时工作区干净。增量修复，M0–M2 原测试全部保留，未修改历史迁移、Prompt 或 auditOutput，未增加项目依赖/改变锁文件。

首次修复提交：`55b2ca9aa1daecc85661bd49fa5770ba01b9edff`。随后在该提交上增量约束低等级生成 schema，并进行下述实际托管验收。

## 修复范围

- usage 接受非加和总数，但拒绝负数、非整数/字符串、部分计数、总数小于输入加输出及超过一亿的计数。供应商总数不重写。
- 新迁移 `202610110003_gemini_usage.sql` 保留原记录，替换旧算术约束；生成列记录差额为 unclassified_tokens。9/62/710 精确保留，差额 639 不标为 reasoning_tokens。
- Gemini profile 或额外未归类用量的 cost_usd 为 NULL，即使配置价格也不按可见输出低估全部费用。官方定价包括 thinking；这里没有足够分类与计费信息，不虚构精确账单。
- 官方端点自动识别，其他网关显式选择 profile。Gemini 可用 JSON schema 与 reasoning_effort；通用端点默认不附加这些参数。低等级/chat 强制 low，其他策略受配置上限和输出预算控制。
- 输出预算默认 Gemini 4096（显式设置优先）；max_tokens/max_completion_tokens 可配置，不自动降级并再次计费。Gemini 总生成计数超过预算仍拒绝展示并保留已返回的 usage。
- 单次超时可配，两个尝试和退避共用总预算；Route deadline 与 50 秒结算余量使模型调用早于 Next 180 秒限制和 DB 180 秒租约结束。超时/取消不重试；部署平台硬期限仍需单独验收。
- 结构化输出只帮助格式，Zod + auditOutput 全部保留。不请求/返回思考摘要、thought_signature、reasoning_content、API Key 或原始响应。
- 后续 L0/L1 生成 schema 限定空正文、实际授权等级上限；没有服务端思路草稿时引用必须为空。Orchestrator 传递可信草稿是否存在，不信任浏览器声明；审核逻辑不放宽。

## 实际本地检查

| 检查       | 结果与范围                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| lint       | 通过，0 warnings                                                                                        |
| typecheck  | Next typegen + TypeScript strict 通过；恢复原 next-env dev 导入后 tsc 再通过                            |
| Vitest     | 后续 13 文件，132/132 通过；原有 112 项全部保留                                                        |
| build      | Next.js 16.4.0 Webpack 通过，Monaco DOMPurify 3.4.16 检查通过                                           |
| Playwright | 28/28 通过，原桌面/移动 M0–M2；仅本地 HTTP 替身                                                         |
| SQL/RLS    | PGlite 实际 PostgreSQL + pgcrypto 执行三份迁移，M2 13 项、M1 4 项 SQL 测试通过；Auth/JWT 上下文仍是夹具 |

后续修改后重新实际运行 lint、typecheck、test、build、test:e2e，均通过；恢复 next-env 原 dev 类型导入后 tsc 再通过。E2E 首次受沙盒限制，测试替身监听回环端口返回 EPERM（未开始执行测试）；获得工具执行授权后原命令完整运行，28/28 通过，没有跳过失败断言。

实际扫描 `.next/static` 的 56 个 JavaScript 文件，当前 LLM Key 与 Tutor 签名的匹配数为 0；只输出计数，没有输出秘密。

新增 20 项回归包含提供的 Gemini 响应形状、未知费用、非法计数、参数隔离、JSON schema 不绕过审核、低等级/配置上限、预算与超时/退避取消，以及空草稿和不同等级的生成 schema 约束。SQL 验证签名 finish 写入 9/62/710、消息可读取、差额 639、两用户 RLS 隔离、普通 DML/生成列伪造拒绝及部分 NULL 拒绝。测试中初次新增约束夹具遗留 pending 租约，导致后续原测试失败；补齐夹具失败结算后原断言全部通过，未删/跳过测试。

## 真实 Provider 与托管数据库

仅检查白名单配置：Google 官方端点、模型 gemini-3.8-flash、Key 存在、独立签名格式有效、Supabase 公开配置存在。没有输出或提交秘密。现有显式 max_completion_tokens 与 4096 输出预算保留。

初次提交时没有已登录训练与迁移授权，未执行真实调用。后续用户在本地搭建站点并明确授权执行 `202610110003_gemini_usage.sql`。通过已登录的 Supabase SQL Editor 执行事务，返回 Success。只读核对：`unclassified_tokens` 为存储生成列、旧等式 CHECK 数量为 0、`llm_usage` RLS 仍开启、authenticated 无 INSERT 权限。没有修改签名配置、使用 service-role 或在托管库执行破坏性测试夹具。

本地站点 `http://localhost:3000` 中已登录自主训练，allowedLevel/maxSeenLevel 均为 L0。复用用户已输入的普通数论思路问题，通过工作台发送**一次新的真实 L0 请求**，没有单独绕过 Orchestrator 调用模型。实际结果为超时，UI 显示“模型请求已取消或超时”，未显示模型消息。只读查询最新请求：status=failed、action=chat、allowed_level=0、error_code=LLM_TIMEOUT；只有 attempt=1，status=timeout，duration_ms=60004，model=gemini-3.8-flash；输入/输出/总数/未归类 token 及 cost_usd 均为 NULL。应用未自动重试，也未再发起新的计费请求。供应商可能已产生费用，不能把 NULL 当作免费。

这证明真实已登录的用户 JWT/HMAC 入场、失败结算与错误 UI 链路执行；**不证明 Gemini HTTP 成功、JSON 合法、审核通过、消息落库/刷新或 token 参数兼容性通过**。此前用户已有失败记录包含 TUTOR_OUTPUT_REJECTED 与供应商 usage，但没有保存原始输出，无法判定具体审核原因；不能把这些记录当作本次成功验收。9/62/710 仍仅为用户提供响应形状的回归夹具，不是本次调用结果。

继续验收应先核查供应商可用性、配额和延迟；如需要更长单次等待，可显式配置 LLM_TIMEOUT_MS，并保持总预算、结算余量和 180 秒租约。之后由用户选择是否再占用一次额度。成功时仍须核对已审核消息、刷新历史、原始三项 usage/未归类差额/NULL 费用；不要暴露原始响应、签名或密钥。一次 L0 也不能证明所有等级或 medium/high 教学质量。

## 尚未验证

托管 Supabase 双用户 RLS/多连接并发及所有提示权限；真实 Gemini 成功的 JSON schema、token 参数、非加和 usage、限流/取消和账单；部署平台 180 秒期限；12 题及更多案例的真实教学质量、反例正确性与高等级低剧透表现。本次单次 60 秒超时已实际观察，不代表供应商全部延迟行为。已有 braces 开发依赖告警继续追踪，本轮未添加覆盖或更改依赖。

依据与配置见 [M2_SETUP.md](M2_SETUP.md)。Google 官方资料验证了兼容接口、effort/结构化输出、思考共用预算和含思考的输出定价；资料不是本项目真实调用的替代证据。
