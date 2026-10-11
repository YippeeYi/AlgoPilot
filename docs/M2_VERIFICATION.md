# M2 验收记录

日期：2026-10-11。基线：main `e52257cd69b37f1282e59cca8694d88d29f36622`，开始时工作区干净。基于现有 M0/M1 增量实现，没有重新初始化、修改 M1 历史迁移或删除/弱化既有测试；保留用户的 next-env dev 类型导入约定。

## 1. 实际运行并通过

| 命令/检查                           | 结果与边界                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci`                            | 干净锁文件安装通过；501 packages，4 项已知开发 HIGH 告警，fsevents 可选安装脚本提示未强制批准                                              |
| `npm run lint`                      | 通过，0 warnings                                                                                                                           |
| `npm run typecheck`                 | Next typegen + TypeScript strict 通过                                                                                                      |
| `npm run test`                      | 12 文件，112/112 通过；原 M0/M1 56 项保留                                                                                                  |
| `npm run build`                     | Next.js 16.4.0 Webpack 通过；postbuild 检查 Monaco DOMPurify 3.4.16 生效                                                                   |
| `npm run test:e2e`                  | 28/28 通过：M0 10、M1 12、M2 6，含桌面和移动 Chromium；全部使用本地 HTTP 替身，非托管服务                                                  |
| `npm audit --omit=dev --json`       | 生产依赖 0 告警                                                                                                                            |
| `npm ls katex`                      | 根、rehype-katex、micromark-extension-math 均为 0.19.0；安全覆盖去除嵌套旧版                                                               |
| 浏览器构建扫描                      | `.next/static` 56 个 JavaScript 文件中，LLM_API_KEY、TUTOR_RPC_SIGNING_SECRET、测试 LLM 密钥的匹配数为 0；不是对未知运行时秘密的形式化证明 |
| `git diff --check`                  | 通过                                                                                                                                       |
| `npm run test:rls:m2`（显式空配置） | 按预期以 1 拒绝运行，无外部数据库连接；不是外部 SQL 通过结果                                                                               |

临时 PGlite 是实际 PostgreSQL + pgcrypto，执行两份正式 migration、RLS、GRANT、SECURITY DEFINER、HMAC、行锁和约束。M2 的 **11 项实际 SQL 测试**覆盖：

- 匿名/双用户隔离，直接 assistant/事件/usage/授权 DML 被拒绝；private 密钥、request nonce/context 不可读。
- 默认 L0、L0–L4 升级、L5 两次绑定确认、错误请求/跨用户/过期/重放拒绝；授权不虚增 max_seen，实际披露后单调。
- HMAC 伪造、过期、跨用户、错误 nonce、复用不同请求内容及越级 finish 拒绝。
- 单用户竞争入场只有一个成功，跨会话共用租约；幂等完成不重复消息/usage，失败仍占额度。
- contest/completed 拒绝入场，过程中完成/租约过期的结果不展示；晚到的响应 usage 仍可结算。
- UTC 前一日不占今日额度，必要上下文证据保存为非公开列。
- 会话内可信 ordinal 连续；强制相同时间戳后，52 条消息两页不遗漏，user/assistant 顺序正确。

这些 SQL 检查不是 JavaScript 假 RLS。**auth.uid/JWT 上下文仍由夹具提供，PGlite 单连接竞争仍不能证明托管 Supabase 或多连接部署已验收。** M1 的 4 项实际 SQL 测试也保留。

## 2. 仅通过 Mock / 单元 / 本地浏览器验证

没有真实模型调用。MockProvider 通过测试注入；生产只接受 openai-compatible，没有 Mock 环境开关。HTTP 替身在 tests/fixtures 内，不被产品打包。

- API 401/404、字段白名单、无 Key 503（比赛/完成/L5 政策优先于缺 Key 错误）、明确 L5 文本确认；竞赛/完成/越权/额度/并发拒绝时 Mock Provider 调用数为 0。
- L0–L5 审核矩阵、聊天不升级、L0/L1 安全模板及逐字引用、低等级算法/实现拦截、明显完整程序强制 L5；错误/额外 reasoning/重复/秘密输出拒绝。
- 版本化多轮 Prompt、必要代码选择、历史恢复、幂等缓存不调用模型、审核失败的用量结算。
- HTTP 超时、取消、429/503 仅一次重试、其他错误不重试；无效 envelope、非法 usage、截断、超预算拒绝；真实响应字段映射用固定 token 夹具验证，未知为 NULL。
- 反例未执行验证的明确标记、低等级未生成候选的明确状态；拒绝“测试通过/已验证”声明。
- Markdown/KaTeX 实际组件渲染：公式/代码/list 可用，HTML、脚本、危险 URL、远程图片/数学外部资源不执行或加载。
- 真实 Next 生产构建 + Supabase SDK Cookie/proxy + 本地 Supabase/Chat Completions HTTP Mock：对话、刷新、升级/L5 弹窗、错误/原请求重试、比赛/匿名/404/preview、移动标签和无溢出。高等级测试消息明确 `[MOCK]`。
- 原创 12 道题，六类知识点的固定 approved/rejected 输出审核回归。realModelReviewed 全部 false，不是模型教学评分。

修复记录：新增测试曾错误把用户原文也当作模型泄露内容检查，改为只检查 assistant content；新增 E2E 误匹配 Monaco/Next 的 alert，新增 AI 错误区可访问名称并精确定位。全部修复后重跑，没有删既有断言、skip 或放宽失败门禁。补上 ordinal 以避免同时间戳打乱对话和历史分页；C++ `<vector>`/模板类型不会误判为危险 HTML。

## 3. 缺配置尚未验证

本机只检查了配置存在性，没有输出值：LLM API Key 与 Tutor 签名密钥均缺失。因此 **真实 Provider 调用未执行**，真实 token/账单没有核对；不声称集成成功。现有 Supabase 公开配置没有被用于读写用户数据或账户；没有隔离测试数据库 URL、psql、Docker 或 Supabase CLI，本轮没有外部数据库/邮件/多连接测试。

管理员还需按 [M2_SETUP.md](M2_SETUP.md) 完成：

1. 在隔离 Supabase 应用 M2 增量迁移，确认 pgcrypto schema 与 RLS/EXECUTE/列权限。
2. 生成独立 64 hex Tutor 密钥，写入 private settings 与服务端环境；应用每日限额不得超 DB hard limit。M1/M2 不使用 service-role。
3. 配置 Provider/BASE_URL/MODEL/API_KEY/token 参数，可选价格，部署 APP_URL 和原 Auth 回调。
4. 两用户真实 PostgREST/直接 RPC 隔离、独立多连接/多实例额度与租约、Auth 自动刷新、Provider HTTP/取消/真实 usage 核对。
5. 依据 [教学人工审核规范](tutor/TEACHING_REVIEW.md) 跑 12 题及补充案例，记录可见消息与模型/Prompt 版本；不能用固定夹具代替此验收。

## 4. 已知限制与后续任务

- L0/L1 自由表达受限，引用和 focus 是否真正有针对性需要人工检查。L2 以上启发式规则与模型自报等级不能形式化保证不剧透、算法判断正确或有效反例；不执行用户 C++，反例始终是未运行候选。
- 只强制用户选择的 contest 模式；CF 当前实时比赛状态在 M3，未实现、未声称。
- 每日额度按 UTC 的用户逻辑入场请求计，失败也计，单请求最多两次 HTTP 尝试；不是硬美元预算。输入为字符限额。cost_usd 仅按显式价格与返回 usage 估算；缺失/超时用量 NULL，可能已经计费。
- 进程崩溃、DB 结算中断、服务商缺 usage 时记录可能未知；180 秒租约阻止即时重放，后续新请求可入场，没有后台账单恢复队列。需要生产 Provider 预算与对账，不能补造 token。
- “已查看”表示经审核的消息已可持久读取，不能证明用户肉眼已读。请求上下文证据在非公开列，M2 不提供原始证据导出 UI。
- 正式消息历史按 ordinal 游标可继续读取，模型只带最多 12 条历史和 3 份思路，过长时优先删除旧上下文；当前题面/必要草稿仍超限则 413。
- 四项 braces 开发依赖 HIGH 告警继续追踪，没有强制覆盖未知版本。新增 KaTeX 传递旧版本告警使用官方 0.19.0 覆盖解决，渲染与浏览器验证通过，生产审计 0。
- 不实现 M3 的 CF 同步/自动复盘，M4 的复杂推荐、导出删除、生产 CSP 或代码执行；无 LangGraph/Redis/Qdrant/独立后端服务。

核心交付：src/server/tutor/\*、两个新 Route Handlers、tutor-conversation/tutor-markdown 工作台组件、m2 校验与 DB 类型、新迁移及 SQL 测试、教学集、M2 配置/API/验证文档、环境示例与里程碑。最终提交 SHA 由交付消息和 git log 给出，避免在提交内部写不可自引用的 SHA。

## 新增和修改的文件

- `.env.example`
- `AGENTS.md`
- `README.md`
- `docs/M2_API.md`
- `docs/M2_SETUP.md`
- `docs/M2_VERIFICATION.md`
- `docs/MILESTONES.md`
- `docs/tutor/TEACHING_REVIEW.md`
- `docs/tutor/teaching-review-dataset.json`
- `package-lock.json`
- `package.json`
- `playwright.config.ts`
- `scripts/test-m2-rls.sh`
- `src/app/(app)/dashboard/page.tsx`
- `src/app/(app)/settings/page.tsx`
- `src/app/api/v1/sessions/[id]/hints/route.ts`
- `src/app/api/v1/sessions/[id]/tutor/route.ts`
- `src/components/practice/tutor-conversation.tsx`
- `src/components/practice/tutor-markdown.tsx`
- `src/components/practice/workspace.tsx`
- `src/lib/supabase/database.types.ts`
- `src/lib/validation/m2.ts`
- `src/server/tutor/audit.ts`
- `src/server/tutor/config.ts`
- `src/server/tutor/orchestrator.ts`
- `src/server/tutor/prompts.ts`
- `src/server/tutor/provider.ts`
- `src/server/tutor/repository.ts`
- `supabase/migrations/202610110002_m2_tutor.sql`
- `supabase/tests/m2_rls.sql`
- `tests/e2e/m2.spec.ts`
- `tests/fixtures/llm-http.mjs`
- `tests/fixtures/supabase-http.mjs`
- `tests/integration/m2-database.test.ts`
- `tests/unit/m2-api.test.ts`
- `tests/unit/m2-dataset.test.ts`
- `tests/unit/m2-markdown.test.tsx`
- `tests/unit/m2-tutor.test.ts`
