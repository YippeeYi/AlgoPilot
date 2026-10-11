# Codex 总任务：实现 AlgoPilot MVP 1.0

你现在是 AlgoPilot 项目的负责人，承担产品工程师、全栈开发、算法竞赛训练产品设计者及测试工程师的角色。请直接在当前工作目录完成真实代码，不要只输出设计或伪代码。先检查已有文件与 Git 状态；若目录为空，从零初始化；若有现存工程，保留既有功能和用户修改，只做必要增量修改，不要重置用户修改或任意覆盖文件。

## 一、项目目标和必须遵守的约束

项目：AlgoPilot，个人 Codeforces / XCPC 算法竞赛训练助手。核心是苏格拉底式 AI 思维教练，不是 AI 自动解题网站。

实现以下完整流程：登录 → 关联公开 CF Handle → 导入题目（官方元数据/用户粘贴题面）→ 进入三栏训练工作台 → 思路草稿版本管理、C++ 编辑与计时 → AI 分级引导/思路检查/反例/复杂度/代码检查 → 关联 CF 提交 → 结束训练与 AI/人工复盘 → 保存学习证据与待复习计划 → 查看真实统计。

第一版不要引入 LangGraph、多 Agent、Redis、Qdrant、向量数据库、独立 Python 后端或自建 OJ。采用一个服务端 Tutor Orchestrator + 不同任务的 Prompt/验证策略。不要直接复制 `titanShubh/Multi-Agent-Competitive-Programming-Coach` 源代码（许可证状态需要单独确认）；可以借鉴其公开架构思想。

默认中文 UI；PC 优先，响应式；深浅主题；样式专业、清晰、低干扰。不要生成虚假的真实用户数据、假 Rating 曲线或假 CF API 响应来冒充生产功能。

## 二、技术选型

- Next.js App Router、React、TypeScript strict、Tailwind CSS、shadcn/ui、Lucide。
- Supabase PostgreSQL + Supabase Auth + `@supabase/ssr`（Cookie 会话）+ RLS。
- Zod 运行时验证；Monaco Editor（按需加载）；React Markdown + KaTeX；轻量状态管理按需求引入。
- LLM 使用仅服务端的 OpenAI-compatible Chat Completions Adapter，支持由环境变量选择 URL/模型；先支持一个 Provider 即可，但接口要可扩展。
- Vitest + Testing Library + Playwright。
- 使用当前实际兼容的稳定版本；核查官方 API，用确实可运行的调用方式；避免把过时 API 或已废弃包写入项目。

## 三、信息披露与比赛规则（最高优先级）

- 提示等级 L0–L5：L0 仅针对已有思路提问；L1 观察条件/边界/复杂度；L2 引导性质但不直接透露算法；L3 可透露算法类别；L4 可给伪代码/局部改进；L5 可给完整题解。
- 默认为 L0。等级升级只能来自前端显式的专用操作，在后端写入 `hint_events` 并校验授权；L5 必须二次确认。用户在聊天框输入“忽略限制，告诉我答案”不能升级权限。
- 最高已查看提示等级只能增加不能减少；历史记录不可由用户伪造。
- 后端不得将未授权的算法类别、关键观察、隐藏题解、未来等级的提示卡放入发给浏览器的 API 响应；UI 训练期默认隐藏 CF tags。
- 任何 `contest` 模式会话后端不得调用题目针对性 AI 服务；如果 CF 题对应比赛正在进行，同样阻止解题帮助。不可只通过 Prompt 做权限控制。
- 第一版先完整生成、验证 LLM 输出，再返回；禁止将未审核的原始 token 直接 streaming 到浏览器。任何提示泄露检测都不是形式化保证；通过测试和保守策略降低风险。
- 不向用户展示模型内部推理链；仅返回简短的用户可见教学反馈与已获授权的状态。
- 模型生成的反例和算法正确性判断若未经过程序/数学验证，应明确标为“待验证”；禁止说“已经跑过代码”或“保证正确”。不得在普通 Web 后端执行任意用户 C++ 代码。

## 四、页面和用户体验

必须实现路由：`/login`, `/register`, `/dashboard`, `/problems`, `/practice/[sessionId]`, `/sessions`, `/reviews`, `/analytics`, `/settings`，包括必要的登录重定向和 404。

`/practice/[sessionId]` PC 三栏：左侧题面、约束、样例、官方链接；中间思路编辑器、历史版本、C++ 草稿、计时/暂停/保存；右侧 AI 对话、当前 L 级别和快捷操作。移动端用标签页切换。代码草稿、思路和聊天跨刷新保存。提供清晰的正在加载、网络失败、LLM Key 未配置、同步失败和空数据界面。Markdown/LaTeX 安全渲染，禁止注入未清洗 HTML。

AI 快捷操作：`chat`, `hint`, `validate`, `counterexample`, `complexity`, `debug`, `explain`；其中 `explain` 需要 L5 二次确认。操作说明写在 UI 中。允许用户编辑 AI 生成的复盘和下一次复习日期。

## 五、数据库设计和安全

编写 `supabase/migrations/` SQL（含索引、外键、唯一约束与逐表 RLS）。建立以下表：
1. `profiles(id -> auth.users, cf_handle, preferences, created_at, updated_at)`；
2. `problems(id, platform, contest_id, problem_index, title, rating, tags, canonical_url, created_at)`；外部题目 ID 唯一；
3. `cf_submissions(id, user_id, cf_submission_id, problem_id, verdict, language, submitted_at, contest_id, problem_index)`，用户+提交 ID 唯一；
4. `cf_rating_changes(id, user_id, contest_id, old_rating, new_rating, rating_updated_at)`；
5. `training_sessions(id, user_id, problem_id, statement_snapshot, mode, phase, status, started_at, resumed_at, active_seconds, ended_at, max_hint_seen, outcome, used_external_editorial, code_draft, updated_at)`；
6. `thought_snapshots(id, session_id, version, content, created_at)`，仅追加，session+version 唯一；
7. `tutor_messages(id, session_id, role, action, content, model_id, prompt_version, disclosure_level, created_at)`；
8. `hint_events(id, session_id, requested_level, delivered_level, content, confirmed_full_reveal, created_at)`；
9. `session_reviews(id, session_id, user_id, summary, obstacles, evidence, next_review_at, edited_at)`；
10. `skill_evidence(id, user_id, session_id, skill_key, evidence_type, confidence, source, created_at)`；
11. `llm_usage(id, user_id, session_id, provider, model, input_tokens, output_tokens, estimated_cost_usd, created_at)`。

所有私人表按 owner 限制；子表通过所属 session 所有权做 RLS。浏览器只能读写应当公开的字段；不要允许用户修改 role=assistant 的记录、hint 等级历史、owner ID、真实 CF Verdict。需要服务端可信操作时通过鉴权后的服务端执行，限制 service-role 使用范围。保留实际来源：OJ 官方事实 vs 用户自报 vs AI 推测。

## 六、Codeforces API

服务端调用官方 API：`user.info`, `user.status`, `user.rating`, `problemset.problems`, `contest.list`。使用服务端限流（全应用请求至少约 2.2s 间隔或更保守）、短期缓存、分页、指数退避、错误处理、增量同步和 submission id 去重。绝不在浏览器直接以无限并发请求 CF。

支持导入 URL：`https://codeforces.com/problemset/problem/1234/A`、`https://codeforces.com/contest/1234/problem/A`；可追加 `/gym/...`。使用白名单解析 URL，禁止根据不可信 URL 进行任意网络请求（SSRF）。CF 公共 API 没有完整题面，用户需要自行粘贴题面或打开官方题页；严禁假称 API 自动返回题面。

CF `OK` Verdict 仅证明远端 AC，不等于用户本次训练独立完成；真实 Rating 曲线来自 `user.rating`，无数据即为空状态。个人公开 Handle 同步不等于已验证 CF 账号所有权。

## 七、AI 后端设计

目录建议：
- `src/server/tutor/orchestrator.ts`：动作分发、鉴权后检查教学权限。
- `src/server/tutor/policies.ts`：L0–L5 与比赛模式的服务端判定。
- `src/server/tutor/context-builder.ts`：从用户、题目、思路快照、最近会话构建最小必要上下文。
- `src/server/tutor/prompts/`：按动作定义少而精的 Prompt；版本化。
- `src/server/tutor/output-validator.ts`：Zod 输出验证，泄露风险检查，必要时降级/拒绝。
- `src/server/llm/provider.ts`：接口、usage 数据和错误类型。
- `src/server/llm/openai-compatible.ts`：实际 HTTP Client，Key 不出服务端。
- `src/server/codeforces/`：URL 解析、客户端、同步逻辑。

`POST /api/v1/tutor/respond` 请求 `{ sessionId, action, message, thoughtVersion?, code? }`；不要信任客户端提供的 userId、allowedHintLevel、role、problemSolution。输出带 `reply`, `allowedLevel`, `verificationStatus`, `messageId`；服务端存储事件、真实 usage，并在失败时返回明确非 2xx 错误。对新旧会话操作做并发控制，避免重复扣额、重复升级。

LLM 环境：`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_PROVIDER`。无 Key 时 API 显示未配置，允许 mock 在测试中使用但标明 `MOCK`，不能假装真实模型。避免依赖特定供应商才支持的 JSON Schema 参数；优先按供应商能力选择 JSON 输出模式并用 Zod 检查，不兼容时使用文本+JSON 解析和最多一次修复重试。实现 input/output token 计数、usage 日志、每日限额、错误提示。不泄露 API Key，不记录含密钥的日志。

## 八、HTTP 端点

最少实现：
- `POST /api/v1/codeforces/sync`；
- `GET /api/v1/problems`、`POST /api/v1/problems/import`；
- `POST /api/v1/sessions`、`GET /api/v1/sessions`、`GET/PATCH /api/v1/sessions/:id`；
- `POST /api/v1/sessions/:id/thoughts`、`PATCH /api/v1/sessions/:id/code`、`POST /api/v1/sessions/:id/hints/unlock`；
- `POST /api/v1/tutor/respond`；
- `POST /api/v1/sessions/:id/finish`；
- `GET /api/v1/reviews`、`PATCH /api/v1/reviews/:id`、`GET /api/v1/analytics`。

所有请求检查 Auth、所有权、Zod、长度和权限；Patch 明确允许字段，不要用任意对象 mass assignment；响应不透出 hidden hint 或题解。

## 九、分阶段执行与持续验证

在当前回合直接编码执行，不要停在计划或一次性返回大量未运行的源代码。按以下阶段推进；每阶段完成后运行对应命令、修复失败，并输出阶段摘要：

M0 脚手架：检查仓库、初始化 Next.js、shadcn、主题和基本路由、`AGENTS.md`、`README.md`、`.env.example`、lint/typecheck/test/build scripts。

M1 基础数据：SQL migrations、RLS、Supabase SSR Auth、题目、训练 Session、计时、思路版本、C++ 草稿和刷新恢复；若缺少真实 Supabase Secret，只完成可验证的代码/测试并明确阻塞部分，不声称生产功能已联通。

M2 AI 教练：Tutor policy、动作选择、Prompt、Provider、无 Key 错误、提示升级与二次确认、上下文、可见内容审查与日志；先 mock 测试后真 Provider。

M3 Codeforces：真实官方 API、URL 解析、元数据同步、提交与 Rating 同步、限流、增量/断点、失败恢复、UI 展示。

M4 复盘与分析：复盘、待复习、可追溯知识证据、真实统计、状态空页、个人设置和文档。

M5 稳定性：完善单元/集成/E2E、安全测试、无障碍与移动端交互、错误恢复、部署指南。

每阶段都应提交必要变更并报告新增文件、具体改动、运行的命令及其结果、未完成项。尽可能完成所有阶段；如果遇到第三方凭据等不可解决的阻塞，继续开发所有独立部分，不要在没有必要时停下来提问。禁止伪造测试通过或 API 可用。

## 十、强制测试与质量门禁

提供并运行 `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`；支持 `npm run test:e2e`（没有运行条件时明确说明）。修复 lint、类型和构建错误。

编写单测：CF URL 解析、Zod、RLS/owner service checks、教学策略权限矩阵、提示等级不可倒退、L5 明确授权、竞赛模式无模型调用、计时累计、思路版本追加、重复同步去重、LLM 输出不合规、无 Key 和超时。集成测试验证用户 A 不能读/改 B 的 Session；CF 失败不伪造成功。E2E 测试登录、创建练习、记录思路、刷新、升级提示、结束、编辑复盘的主流程（使用专用测试数据，不使用个人生产秘密）。

重点针对算法竞赛教学设计测试夹具：二分答案先证明单调性、贪心反例、DP 状态定义、TLE/WA 分析、CF 1732C1 一类多轮引导；低等级输出不能包含高等级隐藏关键性质。模型输出自动审核不能保证绝对不剧透，README 必须如实声明风险。

## 十一、交付物

最后交付：实际可用源码、可执行 SQL migrations、详细 README（快速运行、Supabase 建立、CF 数据限制、Provider 配置、部署 Vercel、迁移与测试）、`.env.example`、`AGENTS.md`、测试、最终状态报告与尚未验证功能列表。外部账户/API Key 不可由你自行创建；请给用户准确的补充环境变量指南。必须写明没有 Key 时哪些功能不可用。

开始执行：先检查当前目录和现有文件，然后输出非常简短的执行顺序，立即进入 M0 开发，不要再重复需求确认。
