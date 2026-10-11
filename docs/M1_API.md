# M1 HTTP 契约

所有数据库接口通过已验证 Cookie 身份运行，不接受 owner/userId。JSON 未知字段拒绝；响应 `Cache-Control: private, no-store`，不返回算法 tags、隐藏观察或题解。没有 AI/CF 请求接口。

| 方法与路径                                  | 输入                                                           | 成功输出                                                               |
| ------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| POST `/api/v1/auth/register`                | `{email,password,next?}`                                       | `{needsConfirmation:true,message}` 或 `{needsConfirmation:false,next}` |
| POST `/api/v1/auth/login`                   | `{email,password,next?}`                                       | `{next}` 并更新 Cookie                                                 |
| POST `/api/v1/auth/logout`                  | 无 body                                                        | `{next:'/login'}` 并清除当前 Cookie                                    |
| GET `/auth/callback`                        | `code` 或 `token_hash` + `type=email/signup`，可选 next        | 成功/失败安全重定向                                                    |
| POST `/api/v1/problems`                     | `{title,statement?,requestId}`                                 | 201 `{problem}`                                                        |
| GET `/api/v1/problems`                      | `offset?=0&limit?=30`                                          | `{items,nextOffset}`                                                   |
| POST `/api/v1/sessions`                     | `{problemId?,statementSnapshot?,mode?='practice',requestId}`   | 201 `{session}`                                                        |
| GET `/api/v1/sessions`                      | 同分页参数                                                     | `{items,nextOffset}`                                                   |
| GET `/api/v1/sessions/[id]`                 | UUID                                                           | `{session,problem,serverNow}`                                          |
| PATCH `/api/v1/sessions/[id]`               | `{action:'pause'/'resume'/'finish',expectedRevision,outcome?}` | `{session,serverNow}`                                                  |
| PATCH `/api/v1/sessions/[id]/code`          | `{content,expectedRevision}`                                   | `{session}`                                                            |
| PATCH `/api/v1/sessions/[id]/thought-draft` | `{content,expectedRevision}`                                   | `{session}`                                                            |
| POST `/api/v1/sessions/[id]/thoughts`       | `{content,expectedRevision,requestId}`                         | 201 `{session,thought}`                                                |
| GET `/api/v1/sessions/[id]/thoughts`        | 同分页参数                                                     | `{items,nextOffset}`                                                   |

UUID requestId 由调用方生成，重试同一操作时复用；复用同 ID 不同内容会冲突。Session 创建可不绑定题目，此时拥有独立私人题面快照；绑定自建题目且未提供快照时复制私人题面。共享 CF 记录不能含私人题面。

草稿采用 `code_revision` / `thought_revision`，状态采用 `state_revision`，彼此独立。追加思路会同步当前草稿并递增 thought revision。旧 revision 不允许覆盖；相同内容的草稿失败重试与 requestId 追加重试均幂等。列表按固定排序分页，满页时可能返回下一页 offset（下一页允许为空）。

`finish` 必须带 outcome，其他动作不能带 outcome。允许值：`not_recorded`、`solved_self_reported`、`unsolved`、`abandoned`；来源一律用户自报。没有 `official_ac`、独立完成或外部提交字段。完成后不能恢复或写草稿；相同结果的重复 finish 无副作用。

限制：title 1–200 字符、题面/草稿/版本 64000 字符、body 300000 字节、offset 0–100000、limit 1–50；注册密码 8–128 字符。JSON、UUID、模式、版本整数范围与邮箱经 Zod 检查。写请求必须 JSON/同源，Next 内部 URL 差异通过 APP_URL 或请求 Host 处理，不使用 X-Forwarded-Host 授权。

错误统一 `{error:{code,message}}`：401 未登录/失效、403 来源不合法、404 不存在或不归属（不泄露私人对象存在性）、400 JSON/类型、413 body 超长、422 字段校验、409 revision/非法状态、503 缺配置或服务不可用。错误不含 SQL、SDK、Cookie、密码、环境值或用户请求原文。
