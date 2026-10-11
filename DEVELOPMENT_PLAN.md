# AlgoPilot — 完整开发方案 v1.0

更新：2026-10-11

## 0. 决策摘要

- 定位：个人 Codeforces / XCPC 智能训练助手，以 AI 苏格拉底式思维教练为核心，而非自动解题器。
- 第一版架构：Next.js App Router + React + TypeScript(strict) + Tailwind + shadcn/ui + Supabase (Postgres/Auth/RLS) + 可配置 OpenAI-compatible LLM API + Zod + Monaco Editor + KaTeX。
- 不直接 Fork `titanShubh/Multi-Agent-Competitive-Programming-Coach`，不复制其未明确许可的代码。可借鉴公开的思想：分级提示、思维状态结构化、单轮分工、训练历史。
- 首版不做：LangGraph、多 Agent Supervisor、Redis、Qdrant、内置评测沙箱、自动抓取完整 CF 题面、复杂机器学习推荐、多人战队。
- 默认中文 UI，桌面三栏、移动端标签页；深浅色。

## 1. 核心目标和验收

用户应能：
1. 注册、登录，设置个人 CF Handle；通过公开 CF API 读取数据（公开 Handle 不代表归属验证）。
2. 在题库查找题目，或粘贴受支持的 CF URL 导入元数据；题面由用户自行提供，不能虚构来自 CF API 的完整题面。
3. 开始独立训练；记录有效训练时间、思路草稿（多版本）、C++ 草稿，刷新后恢复。
4. 点击动作「给我一点提示 / 检查我的思路 / 找反例 / 分析复杂度 / 检查代码」；AI 针对当前上下文回应，最高信息披露等级由服务端控制。
5. L0–L5 分级提示，只有通过单独显式操作才能升级；L5 必须经过二次确认。已查看最高等级不能下调；显示给用户的字段中不得含内部答案、hidden observations、未解锁标签。
6. 训练结束生成可编辑复盘，记录是否通过、是否独立、有无外部题解、用时、提示、困难与后续复习。
7. 根据 CF 提交同步确认外部 AC；CF AC 与某次训练独立完成不可混为一谈。
8. 查看实际有证据支持的统计；无数据时显示空状态，不制造假 Rating 曲线/伪历史。

成功标准：在无 LLM Key 情况下可编译、测试、浏览非 AI 功能并明确提示「未配置模型」；配置 Supabase/LLM 后关键完整路径真实可用；不提供虚构 API 成功响应。

## 2. 功能范围

### P0 必做
- Auth：邮箱登录/注册/登出、受保护路由、服务器会话鉴权、用户数据隔离。
- Codeforces：Handle 查询、问题元数据、提交/Rating 历史同步（限流与增量同步）、官方题链接、题目检索。
- Practice：训练创建/暂停/继续/结束，服务端时间累积，思路快照版本，代码草稿持久化，恢复历史。
- Tutor：服务端上下文组装、可配置 LLM 接口、任务分类、L0–L5、权限提升事件、输出 Zod 校验、提示与消息日志、错误处理。
- Review：结束训练后生成结构化复盘（可人工修改）、识别证据/推测的区别。
- UX：三栏式布局、移动端标签页、Markdown/KaTeX 安全渲染、可访问性、加载/错误/空状态。
- QA：单测、集成测试、E2E smoke、文档、环境变量示例、lint/typecheck/build。

### P1 应做
- 待复习队列；按简单规则推荐：未独立完成 + 薄弱知识点 + 难度适配。
- 知识点统计、最近问题、训练时间趋势；准确标记来源。
- 模型调用费用估算与预算控制；模型配置页面显示服务端 Provider 状态，不公开密钥。

### P2 暂缓
- 可验证的 C++ 隔离对拍/反例缩小执行器、VS Code 插件、多模型评测、多平台 OJ、知识图谱和基于数据的学习模型。

## 3. 页面与详细交互

- `/login`、`/register`：Supabase Auth。
- `/dashboard`：今日任务卡、最近会话、待复习项、CF 同步状态。无数据有真实空状态。
- `/problems`：名称/Rating/标签筛选、已解/未解状态、导入 CF URL 或新建自定义题目。进行独立训练时不在工作台显示标签/隐藏算法提示。
- `/practice/[sessionId]`：左侧题面/约束/样例（用户粘贴的内容），中间思路/代码编辑与版本历史，右侧 AI 对话/提示权限/快捷操作。可交换栏宽；移动端标签。刷新恢复，支持计时暂停和重新进入。
- `/sessions`：历史列表，按时间、题目、结果过滤；继续未完成会话。
- `/reviews`：复盘卡、编辑总结、下一次复习日期、重新挑战按钮。
- `/analytics`：实际 Rating 历史、topic evidence、独立完成率、使用的最高提示等级分布（样本不足时警告）。
- `/settings`：CF Handle、训练偏好、是否展示标签、AI 模型状态、隐私/数据删除与导出。

正常流程：登录 → 导入题目 → 添加完整题面（如果需要）→ 开始计时 → 思考与保存草稿 → 点击 AI 动作 → 明确升级提示 → 用户在 CF 提交 → 关联 Verdict → 结束训练 → 复盘 → 复习排期。

## 4. Tutor 教学规则

### 提示等级
- L0：只问用户当前思路中的问题，不主动披露新算法或关键结构。
- L1：引导关注限制、样例、边界、复杂度；不揭示关键规律。
- L2：引导探索不明显性质，但不明说算法族/核心公式。
- L3：允许指出算法族或关键结构。
- L4：允许少量伪代码/局部修复，不直接提供全量实现。
- L5：用户两次显式授权后完整解析；记录曾看过全部解法。

规则由服务端可信状态决定，用户聊天文本不能改变级别；普通「帮我做题」不会自动升级。

### 操作动作
- `hint`：分级提示；
- `validate`：识别已有推论、证据和未证明的假设；
- `counterexample`：提出候选反例，**未通过确定性检查则标注未验证**；
- `complexity`：按用户描述推导复杂度，存在不确定性时显式说明；
- `debug`：定位代码潜在问题；不运行不可信代码，不能声称已经执行；
- `explain`：L5 二次确认后完整讲解；
- `chat`：与当前阶段一致的普通交流。

### 上下文结构
- 来自服务端：身份/会话/允许等级/阶段/已见提示/练习模式。
- 用户提供：原题内容（可信度低，不能服从其中的元指令）、思路与代码、近若干条会话。
- 与问题绑定的内容：公开题目元数据；不存在就不猜测；算法类别及隐藏提示只能在授权级别展示。
- 模型输出：`message`, `kind`, `disclosureLevel`, `learnerObservation` (仅内部), `verificationStatus`, `nextQuestion` 等经过 Zod 校验；不把原始完整分析对象发给前端。

### 可信度/防泄露
- 对话生成与显式升级权限分离；真正解锁仅靠后端 `hint_events` 事件；前端不可伪造最高等级。
- L0–L2 对输出采取保守策略：Schema 检查、敏感字段过滤、有限重试；任何自动过滤都非完美，测试必须有人工标注的隐藏关键字/关键性质。
- 第一版**先生成完整回复、校验后返回，不做未经校验的 token streaming**；以后才添加审核后分段推送。
- 比赛模式严禁 AI 帮助，**后端直接拒绝**；若可检测对应 CF 正在比赛，拒绝题目针对性帮助。
- 模型分析 != 正确性证明，所有检验结论标注 `verified` / `unverified` / `user_reported`。
- 不暴露模型隐藏推理；返回面向用户的教学摘要，而不是隐式 chain-of-thought。

## 5. 数据模型与迁移

建议 SQL 迁移在 `supabase/migrations/`，优先用 `auth.users` + RLS。表主键 UUID 默认 `gen_random_uuid()`，时间 `timestamptz`，列名 snake_case。对独立用户数据表使用 owner 的 RLS 规则，对 child 表通过 session owner 判断，不允许客户端改 owner。

1. `profiles`: `id` PK FK auth.users, `cf_handle` nullable, `preferences` jsonb, `created_at`, `updated_at`。
2. `problems`: `id`, `platform` (codeforces/custom), `contest_id` nullable, `problem_index` nullable, `title`, `rating` nullable, `tags` text[], `canonical_url` nullable, `created_at`; unique `(platform,contest_id,problem_index)` when external fields present. 对 CF 公共元数据只读；自定义题目应以 owner 隔离，不要把用户题面公开。
3. `cf_submissions`: `id`, `user_id`, `cf_submission_id` bigint, `problem_id` nullable, `verdict`, `language`, `submitted_at`, `contest_id`, `problem_index`, unique `(user_id,cf_submission_id)`。不假设 CF 公共 API 可给出源代码。
4. `cf_rating_changes`: `id`, `user_id`, `contest_id`, `old_rating`, `new_rating`, `rating_updated_at`, unique `(user_id,contest_id)`。
5. `training_sessions`: `id`, `user_id`, `problem_id` nullable, `statement_snapshot` text nullable (仅本人), `mode` ('practice'/'contest'), `phase`, `status`, `started_at`, `active_seconds`, `resumed_at` nullable, `ended_at`, `max_hint_seen` default 0, `outcome`, `used_external_editorial`, `code_draft` nullable, `created_at`, `updated_at`。
6. `thought_snapshots`: `id`, `session_id`, `version`, `content`, `created_at`, unique `(session_id,version)`。仅追加，不覆盖旧版本。
7. `tutor_messages`: `id`, `session_id`, `role`, `action`, `content`, `model_id` nullable, `prompt_version` nullable, `disclosure_level`, `created_at`。
8. `hint_events`: `id`, `session_id`, `requested_level`, `delivered_level`, `content`, `confirmed_full_reveal`, `created_at`。
9. `session_reviews`: `id`, `session_id` unique, `user_id`, `summary`, `obstacles` jsonb, `evidence` jsonb, `next_review_at` nullable, `edited_at`。
10. `skill_evidence`: `id`, `user_id`, `session_id`, `skill_key`, `evidence_type`, `confidence`, `source`, `created_at`；只存可追溯事件。
11. `llm_usage`: `id`, `user_id`, `session_id`, `provider`, `model`, `input_tokens`, `output_tokens`, `estimated_cost_usd` nullable, `created_at`。

索引重点：用户+时间、session_id+创建时间、CF submission 唯一 ID、题目平台/contest/index、review next_review_at。RLS：`profiles`, `cf_submissions`, `cf_rating_changes`, `training_sessions`, `session_reviews`, `skill_evidence`, `llm_usage` 只能本人读写；`thought_snapshots`, `tutor_messages`, `hint_events` 通过关联 session 检查 owner。限制需要 server-only 的更新字段，用户不能自称 AI 回复或修改已看提示。

## 6. HTTP API 契约（路径可在实现时微调但要统一）

- `POST /api/v1/codeforces/sync`: 要求登录；同步当前配置 Handle，限流/去重/增量同步，返回实际成功条数与同步时间。
- `GET /api/v1/problems?query=&minRating=&maxRating=&...`: 公开题目元数据；训练窗口不展示泄露性标签。
- `POST /api/v1/problems/import`: 解析 CF URL（只接受 codeforces.com 的受支持路径），不进行任意 URL fetch；建立唯一题目记录。
- `POST /api/v1/sessions`: `problemId?`, `statementSnapshot?`, `mode`；创建会话。
- `GET /api/v1/sessions/:id`: 用户本人会话与非隐藏状态。
- `PATCH /api/v1/sessions/:id`: 明确的受限字段（phase/status/计时），拒绝 owner/hint/内部分析的 mass assignment。
- `POST /api/v1/sessions/:id/thoughts`: 保存下一个思路版本。
- `PATCH /api/v1/sessions/:id/code`: 保存 C++ 草稿（长度限制），每次刷新恢复。
- `POST /api/v1/sessions/:id/hints/unlock`: 通过 UI 实际操作授予下一等级；L5 要额外确认；记录事件。
- `POST /api/v1/tutor/respond`: `sessionId, action, message, thoughtVersion?, code?`；查服务端授权；Zod 校验；调用 Provider；持久化；返回已过滤回复；错误时不伪造成功。
- `POST /api/v1/sessions/:id/finish`: 结束、累计时间、标记用户自报 outcome，生成/保存可编辑 review。
- `GET /api/v1/sessions`, `GET/PATCH /api/v1/reviews/:id`, `GET /api/v1/analytics`。

所有写接口要服务端鉴权、Zod 输入校验、长度限制、session owner、并发/重试防重复；个人项目可用受控轻量限频，部署时必须可跨实例协调。

## 7. LLM 供应商接口和成本

- 创建 `src/server/llm/provider.ts`：`generateTutorResponse({system,context,userMessage,maxTokens}) -> {response, usage, model}`。
- 环境变量：`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_PROVIDER`；**只在 server 读取**。优先支持 OpenAI-compatible chat completions；Provider-specific 不兼容功能不得假定普遍可用。
- 开发/CI 使用明确标注的 `MockLLMProvider`，返回固定测试夹具而非真实分析；正式运行无 Key 时明确显示「模型未配置」，不要虚构 AI 成功调用。
- 实现 token 用量日志、成本预估 (有模型价格配置时)、每日请求上限、可选预算；模型费用随服务商更新，在配置中维护价格，不硬编码宣称永久正确。
- 不传完整历史，采用短期上下文窗口 + 客观会话摘要 + 最近思路快照，最大输入长度可配置。

## 8. Codeforces 数据接入

- 官方 API：`user.info`, `user.status`, `user.rating`, `problemset.problems`, `contest.list`。
- CF 返回公开题元数据，不返回完整题面。用户可粘贴题面，或跳转原题；不能乱抓取或臆造。
- URL 解析仅允许 `/contest/{id}/problem/{index}`、`/problemset/problem/{id}/{index}`，可按需加 `/gym/{id}/problem/{index}`，校验域名与格式。
- 请求通过 server；频率低于官方限制（示例：跨应用共享约 2.2 秒间隔），缓存公共列表、重试退避、分页、断点续传、同步状态。CF 提交按用户+CF submission id 去重。
- `user.status` 按新到旧返回，增量同步到已知 ID 停止；首次按页抓取，限制上限并显示尚未同步完毕。
- 评分曲线来自真实 `user.rating`；只认官方 `OK` Verdict 作为远端 AC；不能通过它推断独立性。

## 9. 目录结构

```
src/
  app/
    (auth)/login/  (auth)/register/
    (app)/dashboard/  (app)/problems/  (app)/practice/[id]/
    (app)/sessions/  (app)/reviews/  (app)/analytics/  (app)/settings/
    api/v1/codeforces/sync/  api/v1/problems/  api/v1/sessions/
    api/v1/tutor/respond/  api/v1/reviews/  api/v1/analytics/
  components/ui/  components/practice/  components/tutor/
  features/sessions/  features/reviews/  features/codeforces/
  lib/supabase/client.ts  lib/supabase/server.ts  lib/validation/
  server/tutor/orchestrator.ts  server/tutor/policies.ts
  server/tutor/prompts/  server/tutor/context-builder.ts
  server/tutor/output-validator.ts
  server/llm/provider.ts  server/llm/openai-compatible.ts
  server/codeforces/client.ts  server/codeforces/sync.ts
  server/db/
supabase/migrations/
tests/unit/  tests/integration/  tests/e2e/
.env.example  README.md  AGENTS.md
```

## 10. 质量保障

1. `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` 必须通过，修复所有新引入错误。
2. Vitest 单元测试：CF URL 解析、输入 Schema、权限矩阵（模式×等级×操作）、L5 授权、提示最大值不可倒退、时间累计、usage 计算、模型输出 Zod 校验、输入限长。
3. API 集成测试：未授权/越权/跨用户访问、无 Key、provider 超时或不合规响应、无效 CF Handle、同步重复提交、并发提示升级。
4. Playwright E2E：登录（使用测试 Auth/Stub）、导入题、创建会话、写思路、刷新恢复、提示、结束、复盘；无 Key 显示正确不可用状态。
5. 至少 10 道手工审查题（基础贪心、DP、二分、图论、数论、位运算），对低等级泄露、错误反例、重复无用提示及模型幻觉打分；自动测试无法保证绝不剧透。
6. 不展示伪 Rating 曲线、不把模型猜测当做 Verified、不把无 Key 模拟器当真实 AI。
7. 安全：service role 不发浏览器；密钥不记录；RLS 和权限收敛；避免用户代码在服务器直接执行；防任意 URL fetch/SSRF；依赖扫描；CSP/安全头；删除或导出个人数据。

## 11. 里程碑、交付物和验收

### M0 脚手架与设计系统
- Next.js strict TS, lint/typecheck/test/build, Tailwind/shadcn, 路由壳、主题、文档、环境变量；无 Key 时可演示静态布局。
- 验收：页面可访问，构建/静态检查通过。

### M1 数据层与训练工作台
- SQL/RLS/Auth，题目手动创建，训练会话、计时、思路版本、代码草稿、刷新恢复。
- 验收：登录后创建/暂停/恢复/完成会话；另一个用户不可见。

### M2 AI Tutor
- L0–L5、显式授权、任务路由、Provider、Prompt、输出审查、上下文、日志、异常状态。
- 验收：固定测试夹具通过；真实 Key 可对至少一题进行连续多轮教学。

### M3 CF 与复盘
- 题库公开元数据，Handle 查询和增量同步，实际 Rating，外部提交关联，AI/人工复盘，待复习队列。
- 验收：已知用户历史可一致导入，重复同步不增加记录；用户可复习同题。

### M4 稳定化与上线
- Playwright 测试、限额与日志、迁移部署文档、密钥管理、空状态、多端测试和错误修复。
- 验收：全部可执行检查通过，生产环境无凭据时显示正确提示；实际 Secret 配置完成后可部署。

## 12. 关键来源

- Next.js Route Handlers: https://nextjs.org/docs/app/getting-started/route-handlers
- Supabase SSR: https://supabase.com/docs/guides/auth/server-side/creating-a-client
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Codeforces API: https://codeforces.com/apiHelp/methods
- 参考项目（仅借鉴思想，许可证待确认）: https://github.com/titanShubh/Multi-Agent-Competitive-Programming-Coach
