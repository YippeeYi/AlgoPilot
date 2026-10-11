# M2 AI HTTP 与数据库契约

继承 M1 Cookie Auth/getUser、归属检查、同源/Zod 白名单、no-store、安全错误契约。没有流式接口。未登录 401，不存在/不归属 404；输入 400/422、超长 413、比赛/L5 禁止 403、冲突/并发/确认过期 409、额度 429、缺配置/数据库故障 503、Provider/审核错误 502、超时/取消 504。客户端不能传 owner、权限等级、模型配置、usage、Prompt 或系统时间。

| 接口                               | 输入                                            | 输出                                                                            |
| ---------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| GET `/api/v1/sessions/[id]/tutor`  | 可选 `before` 正整数（会话内消息 ordinal 游标） | `{messages,state,nextBefore}`，按会话内可信序号返回最新 50 条；可继续取更早消息 |
| POST `/api/v1/sessions/[id]/tutor` | `{action,message,requestId}`                    | 审核及事务保存后的 `{messages,state,cached}`，最新 50 条消息                    |
| POST `/api/v1/sessions/[id]/hints` | 以下独立升级操作                                | `{allowedLevel,revision}`，第一步 L5 另有 `challengeId,expiresAt`               |

`action` 为 chat/hint/validate/counterexample/complexity/debug/explain；message 1–6000 字符，requestId UUID。chat 文本不会升级。explain 需要已授权 L5；其他操作同样受当前等级约束。比赛模式和完成会话禁止模型调用，允许读取已有对话。暂停的自主训练可以分析。

升级操作：

```json
{"operation":"upgrade","revision":0,"requestId":"<UUID>"}
{"operation":"begin_l5","revision":4,"requestId":"<UUID-A>","confirmation":"我确认申请完整解析"}
{"operation":"confirm_l5","revision":4,"requestId":"<同一UUID-A>","challengeId":"<第一步返回的UUID>","confirmation":"我确认完整解析会影响独立完成记录"}
```

upgrade 每次只从 L0→L1→L2→L3→L4；不存在直接传入目标等级的入口。L5 挑战绑定用户、会话、授权请求，5 分钟有效，一次消费；第二步必须匹配同一 requestId 和 revision。升级事件记录授权，最高已查看等级不变。请求实际审核内容并成功保存后，disclosure 事件和 `max_hint_seen` 原子更新；完整内容额外 full_reveal 事件。这里的“已查看”指审核结果已持久化并可供用户读取，不声称能证明网络断开时用户肉眼已读。

state 白名单：allowedLevel/maxSeenLevel/revision/used/configured/limit/configurationMessage。used 按用户、UTC 当日计请求入场，包括失败请求。configured 仅表示应用环境校验通过，不验证 DB 签名是否已配置或 Provider 是否连通。messages 只含可见 content、角色、action、披露等级、反例标记、Prompt 版本、草稿 revisions、可信会话内 ordinal、时间及 UUID；不含内部推理、隐藏题解、签名、nonce、原始 Provider 响应或 usage 请求字段。

同 requestId + 同输入命中已完成请求，不重调模型/不新增费用记录；不同输入 409。pending 409，failed/过期请求不能再次调用模型，需新 UUID，新请求消耗额度。浏览器提供“查询 / 重试原请求”和“发起新请求”，网络结果不确定时先查询原请求或刷新历史，避免盲目双重调用。对话输入与草稿内容不会由旧响应覆盖；分析前 flush M1 两条保存队列。

## PostgreSQL 可信边界

M2 增量迁移不修改 M1 文件。新增 tutor_authorizations、tutor_requests、tutor_messages、hint_events、llm_usage；private schema 存签名配置和 L5 挑战。全部启用 RLS。公开子表 SELECT 经父会话验证；requests 只授予 id/user_id/session_id 三列，租约、指纹和原始上下文证据不直接开放。普通 JWT 无任何表 DML 权限，无法伪造 assistant、事件、计费或历史。private schema/内部函数 EXECUTE 均撤销。

- tutor_state：已验证用户读取自己的等级和额度。
- tutor_hint：同用户 JWT 的窄范围升级 RPC，行锁 + revision + 挑战期限/防重放。
- tutor_reserve/tutor_finish：同用户 JWT + 服务端 HMAC-SHA256 签名，固定空 search_path；签名校验用户、操作和期限，SQL 再核验会话归属。没有 service-role 客户端。
- reserve 用户 advisory lock + 唯一 pending 索引，跨会话/实例共享每日额度和并发入场；数据库可信时钟，180 秒租约。签名额度还须不超过管理员设置的 daily_hard_limit（默认 100）。
- finish 再锁会话和请求，核验 nonce、入场授权和当前状态，在会话行锁下生成连续消息序号，保证同时间戳下 user/assistant 顺序和历史分页；原子保存 user/assistant、事件、真实 usage、单调 max_hint_seen。过期或已完成训练的结果不展示，真实返回的 usage 仍可结算。重放不重复写入。

请求证据保存当前必要思路/代码快照、revision、所引用历史版本 ID 与 Prompt 版本，只在 requests 非公开列；题面是已有不可变会话快照。低等级没有读取内部题解/隐藏观察的路径。不要为方便而给前端新增原始请求或所有列 SELECT。

## Provider 和审核

45 秒/次超时，Request AbortSignal 取消；仅 HTTP 429/503 重试一次、350ms 退避，最多两次。其他失败和超时不自动重试。拒绝 HTTP 重定向、限制响应体 2MB，模型正文最多 24000 字符；输出 JSON 正文最多 16000。usage 只从响应的 prompt_tokens/completion_tokens/total_tokens 读取并验证，缺失/未知为 NULL；错误正文丢弃。模型字段含密钥时脱敏并拒绝。输出超预算或截断保留真实 usage 但拒绝展示。

版本化教学 Prompt 只包含私人题面、当前必要草稿、最多三份历史思路及最多 12 条可见对话。输入上限不足时先丢旧历史/版本；不默默截断当前题面/代码，仍超长就 413。debug/complexity 才带 C++。运行时仅支持 openai-compatible，MockProvider 只通过测试依赖注入。

L0/L1：模型选择受限 focus 和当前思路逐字 quote，content 必须为空；服务端渲染审核过的问题模板。L2：性质探索，拦算法名和实现；L3：算法类别，拦实现；L4：局部代码/伪代码，拦完整程序；L5：完整解析。独立估算披露等级，不只信模型自报；完整程序至少 L5。未知 JSON 字段、内部推理、敏感输出、危险内容、完全重复引导拒绝。候选反例一律注明未执行验证，低等级未生成具体候选时明确说明。

Markdown 无 raw HTML，sanitizer 先于 KaTeX，trust:false、扩展/大小限制；普通链接呈现为文字、图片移除。L2 以上自动规则无法形式化保证不剧透，也无法证明算法判断正确；实际教学质量另按原创题集人工验收。
