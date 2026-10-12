# M2 真实验收后定向修复

日期：2026-10-12。基线 main / `cc6cc50d6f15a7ccf835a891a87be8959bd8ac70`，开始时工作区干净。保留 M0–M2 和全部既有测试断言；本轮没有调用 Gemini、执行 C++、导出 Cookie 或读取真实密钥，没有运行生产破坏性 SQL。

## P1：revision 错误分类

已验证的问题：业务 CAS 冲突在 SQL 中使用了 `40001`（serialization_failure）。应用原本已把这个代码映射为 409，但真实托管 RPC 没有及时把它返回给 SDK，15 秒传输时限后 SDK 返回 `status=0 / error.code=''`，API 因此正确走了未知数据库错误的 503 分支。不能把这个空代码当作 409。

证据：

- 用户在托管 SQL Editor 执行只读诊断，`save_training_draft(uuid,text,text,integer)` 去空白函数体 MD5 为 `919777c4cd97052e9286c049242c08e1`，`matches_m1=true`、SECURITY DEFINER=true、空 search_path。部署与仓库原始 M1 定义一致。
- 本轮修复前再次真实 PATCH：旧 revision 0，API 503 `DATABASE_UNAVAILABLE`，服务端脱敏诊断 `status:0 / code:UNKNOWN / category:transport_or_unclassified`，Next 总耗时约 17 秒。没有输出 SDK message/details/hint 或请求正文。
- [Supabase 官方故障说明](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b) 确认部分 PostgREST 会内部重试 40001，并推荐业务冲突使用 PT409。[PostgREST 错误契约](https://docs.postgrest.org/en/stable/references/errors.html) 规定 PT409 映射 HTTP 409。
- 用户执行 `202610120004_business_conflicts.sql`，返回 `Success. No rows returned`。随后同类真实 RPC 的 SDK 诊断变为 `status:409 / code:PT409 / category:postgresql`，API 返回 409，无超时。

根因修复在数据库层：追加迁移只替换 7 个受控 RPC 的 8 处业务错误码，覆盖草稿、思路追加、状态 CAS、requestId 重用和 Tutor 授权/幂等冲突，防止相同错误码在其他业务冲突中再次触发重试。迁移检查预期语句数量，异常时整个事务回滚。它从现有函数定义精确替换错误码，不覆盖其余用户修改，不改变 owner、ACL、search_path、Auth/行锁/CAS/RLS 或签名。

API 增加 PT409 精确映射，保留旧 40001/23505 兼容；空代码、连接错误、未知代码仍为 503。草稿失败日志仅包含固定操作名、格式受限的代码、HTTP 状态及类别。不根据 message 或所有 503 猜测冲突。

边界：没有读取托管 PostgreSQL 逐条日志或实测 PostgREST 版本/重试次数。错误码误用、部署定义、超时路径及修复后 PT409/409 均有证据；内部重试机制依据官方故障说明，不能把每一次 503 都归为这个原因。本轮只读连接统计没有持续执行的后端，未终止任何后端或重启项目。

## 真实 HTTP / 浏览器结果

测试资源：新建并暂停的标记会话 `8b9a8ffb-5bbf-4825-b38d-65c05fdeae5d`，与原始已完成会话分开。由用户手动登录现有账号；没有第二个专用账号。只保存明确标记的验收文本，不伪造完成/AC/AI 消息，测试记录保留。

| 项目 | 结果 | 实际证据 |
| --- | --- | --- |
| 正常 revision 保存 | PASS | PATCH thought-draft 200，1954 ms |
| 旧 revision 分类 | PASS | PATCH 409 REVISION_CONFLICT，1586 ms；SDK PT409/409 |
| 旧请求不覆盖 | PASS | 后续 GET 200，草稿仍为新内容，revision=1 |
| 思路追加 | PASS | POST thoughts 201，1886 ms |
| 未登录写入 | PASS | 独立无认证上下文 PATCH 401，14 ms |
| 双用户 Session/Thought 隔离 | NOT TESTED | 第二专用账号不存在；不得以不存在 UUID 替代第二用户 |
| 真实数据库不可用仍为 503 | NOT TESTED | 未中断托管服务；替身故障注入验证见下表 |
| 多窗口真实 revision 冲突 | PASS | 旧窗口 PATCH 409，1691 ms；本地文本保留，服务器保持新窗口文本，revision=5 |
| 在途自动保存 A→B | PASS | 等待在途请求时继续编辑 B，最终保存 B，无旧响应覆盖 |
| 在途应用内导航 | PASS | 导航被阻止，明确提示保存后离开 |
| 保存后导航与会话切换 | PASS | 训练记录页面可导航；切换另一会话并返回，分别加载正确草稿 |
| 刷新恢复 | PASS | 显式 reload 后恢复 B；文档请求仅为这次 reload |
| 受控 HMR 与在途保存 | PASS | 临时注释触发 Fast Refresh；dirty 状态的 beforeunload 被取消，文本保留并最终保存 B，无文档重载；不是选择强制离开的测试 |
| 历次额外导航根因 | NOT TESTED | 本轮稳定保存测试未复现内容丢失，未修改保存队列；同 URL framenavigated 也包含路由 history 更新，不能单凭事件计数判断额外文档加载 |

脱敏 HTTP 状态/耗时：[http-regression.json](m2-repair/http-regression.json)。导航证据：[navigation.json](m2-repair/navigation.json)、[hmr.json](m2-repair/hmr.json)、[session-switch.json](m2-repair/session-switch.json)。多窗口：[multi-window.json](m2-repair/multi-window.json)、[截图](m2-repair/multi-window-conflict.png)。脚本和日志均不包含认证头、Cookie、密钥或私人原始正文。

人工双用户真实回归入口：`LIVE_ACCEPTANCE_ALLOW_WRITES=dedicated-resources node scripts/verify-live-revisions.mjs`。使用已启动的 localhost:3000，两个浏览器上下文手动登录，不接收密码，不复制 Cookie，不调用 Tutor。`tests/live/revisions.mjs` 的单用户部分已在本轮真实登录上下文实际执行；双用户分支未执行。

## Gemini / 可信 usage

用户通过只读 SQL 查询此前成功的 L0 请求，托管数据库实际记录如下。本轮没有新增 Gemini 请求：

| model | input_tokens | output_tokens | total_tokens | unclassified_tokens | duration_ms | status | cost_usd | messages |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.8-flash | 739 | 37 | 776 | 0 | 14612 | success | NULL | 2 |

PASS：已有真实请求模型/用量/消息持久化可读，费用未虚构。该请求没有未分类差额，不能据此宣称已经对非零 reasoning/未分类 Token 做了真实供应商验收；非加和 usage 的回归仍属于 Provider Mock 测试。没有独立读取原始供应商响应或账单。真实跨用户 usage 隔离和伪造写入尝试 NOT TESTED；本地 PostgreSQL 的 RLS、只读授权、HMAC 校验继续覆盖这些规则。

## P3：界面与 preload

已修正登录后侧栏“个人训练 · M1”为 M2；公开 preview 的“将在 M1 接入”改为说明登录后编辑/恢复，仍禁用私人操作。

警告已定位：`http://localhost:3000/_next/static/css/app/layout.css`。开发浏览器 DOM 中有对应 `rel=stylesheet`，且 document.styleSheets 显示已生效；重复 `rel=preload` 的 `as=style` 正确。警告与 Next 开发态/HMR 更新时重复保留 CSS preload 一起出现，没有项目手写 preload 或资源 404 证据。不增加清理 DOM、延时或警告过滤逻辑；最终生产构建已在 localhost:3200 使用真实登录上下文只读复测：页面 200，观察 8 秒未出现 preload 警告、pageerror 或 HTTP 失败，侧栏 M2 正常。证据：[production.json](m2-repair/production.json)、[生产截图](m2-repair/production-workspace.png)。短时观察不保证任何场景都无警告。初次浏览器还有一条缺资源 404，未捕获其资源地址，不能归为该 CSS 警告。

## 自动化结果与边界

| 层级 | 结果 | 验证范围 |
| --- | --- | --- |
| 本地真实 PostgreSQL/PGlite | PASS | 迁移执行、7 个函数仅错误码变化且 owner/ACL/安全配置一致；双用户 RLS、CAS、历史、计时、HMAC/usage 规则。Auth 上下文为替身，不是托管验签/多连接 |
| Route Handler + Supabase SDK HTTP 替身 | PASS | PT409/409、正常 revision、不覆盖、401/404；PGRST000 和传输失败仍 503；日志不含 SDK 原文 |
| Playwright 浏览器 + 本地 HTTP 替身 | PASS | 全部旧测试保留；新增桌面/移动在途保存、导航拦截、刷新、多窗口 409/本地保留 |
| 托管 Supabase + 真实浏览器 | 部分 PASS | 上述真实 HTTP 和单用户交互；双用户与真实故障未执行 |
| 真实 Gemini | 本轮未调用 | 只核对已有成功记录；教学质量、账单和非零未分类 Token 仍需单独验收 |

本轮新增测试一度因先创建测试会话导致原有 rollback 后 count=0 断言失败；将新增有状态用例移到原断言之后，未删改该断言。并行 typecheck/build 一次产生 TS6053（构建清理生成类型）；改为串行运行后通过，未修改类型保护配置。

最终命令结果在本文件末尾更新。剩余优先项：准备第二专用账号执行真实双向隔离；在隔离服务验证真实不可用/多连接竞争；核对供应商原始 usage/账单与真实教学质量；继续监测其他页面/浏览器的 preload 行为。保存队列与业务实现没有未经证实的重构。

## 最终质量门禁

- `npm run lint`：PASS。
- `npm run typecheck`：PASS（最终与 build 串行，另有一次并行生成物冲突已在上文说明）。
- `npm run test`：PASS，15 文件、149/149（包含真实 PostgreSQL/PGlite及标明的 Mock，不是 149 个托管测试）。
- `npm run build`：PASS，Webpack 生产构建及 Monaco DOMPurify 3.4.16 校验。
- `npm run test:e2e`：PASS，30/30，17.4 秒，桌面/移动本地 HTTP 替身；独立真实 HTTP 证据见上文。
- `git diff --check`：PASS。

没有安装新依赖或更改 lockfile/Next/Webpack 配置。既有 braces 开发依赖告警继续按原文档追踪，未增加未知覆盖版本。真实外部 SQL smoke 未运行：没有隔离数据库，也没有 psql；未将托管项目用于 rollback 测试夹具。

本轮启动的开发服务器、生产检查服务器与 Playwright 浏览器在验收后关闭；标记测试会话保持 paused。提交 SHA 由最终交付回复提供，避免文档中的自引用哈希。
