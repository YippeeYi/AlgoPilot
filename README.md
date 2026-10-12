# AlgoPilot

面向 Codeforces / XCPC 个人选手的算法竞赛训练助手，以独立思考、苏格拉底式引导和可追溯复盘为核心。

**当前交付：M2.5 学习与 AC 代码复盘基础。** 用户在本地 VS Code/C++ 编译器编写、运行、调试，在 Codeforces 官网手动提交。AlgoPilot 专注卡题启发式引导与 AC 后深度代码复盘，不开发在线编程、判题、代码执行或自动提交。

工作台保留题面、思路笔记/版本与 AI 教练，旧代码放在兼容区；新 UI 默认不计时，可主动开启，网页无需一直打开。无思路时 L0 从用户题面事实逐步提问。`/reviews` 支持代码粘贴/单文件读取、明确自报 AC 与 Provider 授权、不可变快照、九项结构化分析、保存/编辑/重新生成/追问及刷新恢复。完整复盘独立于未 AC 提示历史，保留 Auth/RLS/HMAC/共享额度/比赛保护。

CF 元数据/提交同步属 M3，知识沉淀/复习/真实统计属 M4。CF API 不提供提交源码；即使未来匹配 AC 也不能证明导入源码一致。当前复盘为自报 AC、官方状态未核实、源码匹配未验证。新迁移部署后才能使用，见 [M2.5 配置](docs/M25_SETUP.md)、[本轮验收](docs/M25_VERIFICATION.md)、[里程碑](docs/MILESTONES.md)；历史验收保留。

## 运行

需要 Node.js 24.15+（24.x LTS，或 26+）和 npm。

```bash
npm ci
cp .env.example .env.local
npm run dev
```

打开 http://localhost:3000。填入 Supabase 项目 URL、publishable key 和实际站点 `APP_URL`，并先应用迁移，才可真实认证和保存。详细步骤见 [Supabase 配置指南](docs/SUPABASE_SETUP.md)。AI 还须应用 M2 迁移，配置 Provider 和独立签名密钥，见 [M2 配置指南](docs/M2_SETUP.md)。没有配置时可浏览无数据页面壳与 `/practice/preview`，不会伪造登录或启用保存。

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run start
```

保留 Next.js 16.4.0、严格 TypeScript、npm lockfile 和 `--webpack`。`typecheck` 自动生成路由类型；Monaco 已退出主流程，生命周期不再复制 worker，生产包检查确认无活动编辑器或过期 sanitizer。旧代码以可展开文本区访问与保存，不执行程序。

## 训练与历史兼容

- `/login`、`/register`：邮箱密码登录、注册、验证回调；登录恢复安全的原访问目标，登出和失效会话提示。
- `/dashboard`、`/problems`、`/sessions`、`/reviews`、`/analytics`、`/settings`、真实 `/practice/[sessionId]`：配置完整时均要求服务端验证身份。没有配置时只提供明确标注的无数据壳。
- `/problems`：私人自定义题目创建和分页列表；共享 CF 元数据结构已预留，尚不进行导入或同步。
- `/sessions`：创建自主训练、个人分页列表和重新打开。比赛模式也能计时、写草稿；服务端强制禁止题目相关 AI。
- `/practice/[sessionId]`：桌面三栏/移动标签；私人题面快照、思路草稿自动/手动保存、可展开旧 C++ 文本记录、追加思路历史与恢复、暂停/继续/完成。
- `/practice/preview`：独立公开入口，不初始化 Auth、不读取私人数据、不保存或调用 AI；尚未接入操作禁用。
- AC 复盘已接入独立流程；复习队列、统计和 CF 同步仍为真实空状态。

草稿在停止编辑约 1.2 秒后自动保存，有保存中/已保存/失败状态。旧响应不会覆盖新输入；多窗口冲突返回 409，需要先复制本地内容，再刷新加载服务器版本。请等“已保存到服务器”后刷新。思路历史由“保存历史版本”明确生成，每次按键不会新增版本；恢复只改当前草稿。

状态为 `active → paused → active`，任一未完成状态可完成；完成后冻结计时及草稿。重复暂停/继续/相同结果的完成请求无副作用；实际转换须匹配 state revision。计时由数据库时间、行锁及累计秒数决定，前端仅显示估计进度。结果仅为用户自报，不等同官方 AC，也不推断独立完成。

## 数据库与安全

正式迁移：[202610110001_m1_training.sql](supabase/migrations/202610110001_m1_training.sql)。四表：`profiles`（关联 Auth）、`problems`（公开元数据或私人自建）、`training_sessions`（唯一用户）、`thought_snapshots`（父会话归属，仅追加）。公共 CF 记录不能含私人题面；用户提供的题面放在私人会话快照中。

HTTP 请求与状态字段见 [M1 API 契约](docs/M1_API.md) 和 [M2 AI/API 契约](docs/M2_API.md)。

所有表启用 RLS；私人 SELECT 按 `auth.uid()`，子表通过父会话验证。客户端不获表 DML 权限；算法 tags 不授予直接 SELECT。用户 JWT 可调用有限 RPC，函数显式核验身份/归属、固定空 search_path、事务行锁、revision CAS 与幂等键，数据库生成可信时间和 owner。内部锁函数不开放调用。M1 不使用 service-role key。

Next proxy 刷新 Cookie；页面和 API 使用服务端 `getUser()` 验证，不能用客户端 userId/getSession 授权。请求经 Zod 严格白名单、长度/分页限制与同源检查；未登录 401、不可访问对象 404、无效输入 400/422、版本/状态冲突 409、缺配置/服务故障 503。响应 no-store，错误不输出 SDK 原文、请求内容或密钥。生产同源检查使用 `APP_URL`；不信任任意 X-Forwarded-Host。

环境变量只从 `.env.local` 或部署平台读取：

| 变量                                              | 用途                                     | 浏览器可见 |
| ------------------------------------------------- | ---------------------------------------- | ---------- |
| `NEXT_PUBLIC_SUPABASE_URL`                        | 项目 HTTPS URL（本地可 localhost）       | 是         |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`            | publishable/anon key，绝不能填管理员 key | 是         |
| `APP_URL`                                         | 实际站点 origin 与验证回调               | 无需发送   |
| `SUPABASE_SERVICE_ROLE_KEY`                       | 后续可信服务任务预留，M1/M2 不使用       | 否         |
| `LLM_*`                                           | M2 服务端 Provider、预算与限额           | 否         |
| `TUTOR_RPC_SIGNING_SECRET`                        | 服务端与 private DB 的独立 HMAC 签名密钥 | 否         |
| `M2_ALLOW_DATABASE_TESTS`、`M2_TEST_DATABASE_URL` | M2 隔离数据库 SQL smoke                  | 否         |
| `M1_ALLOW_DATABASE_TESTS`、`M1_TEST_DATABASE_URL` | 只供隔离数据库 SQL 测试                  | 否         |

托管 revision 修复另需追加 [业务冲突迁移](supabase/migrations/202610120004_business_conflicts.sql)，将业务 CAS 从 `40001` 改为 `PT409`，避免 PostgREST 内部重试超时。实际 HTTP、SQL/RLS、Mock 和未验证边界见 [修复验收](docs/M2_REPAIR_VERIFICATION.md) 与 [浏览器验收](docs/LIVE_ACCEPTANCE.md)。

## M2 功能与权限

Gemini 兼容修复增加 [usage 增量迁移](supabase/migrations/202610110003_gemini_usage.sql)，保留供应商原始总数，差额记为未归类用量；Gemini 费用保持 NULL。配置 reasoning/JSON schema/超时与预算见 [M2 设置](docs/M2_SETUP.md)，实际测试与真实调用边界见 [Gemini 验收](docs/GEMINI_VERIFICATION.md)。旧 M2 数据库也需应用新增迁移。

- 真实工作台右栏持久对话，六类操作 + chat，提示等级/升级、L5 两次弹窗确认、分析/错误/重试与每日额度。桌面三栏和移动标签保持不变；公开 preview 不读私人数据、不调用 AI。
- 单 Tutor Orchestrator：验证身份/归属/模式/状态/权限 → 最小上下文与版本化 Prompt → Provider → 输出审核 → 原子保存消息/事件/usage。debug 仅静态阅读 C++，不执行任何代码。
- L0 针对已有思路追问，完全无思路时澄清用户题面事实；L1 条件/边界/复杂度引导；L2 性质探索；L3 算法类别；L4 伪代码/局部指导；L5 完整解析。聊天不能升级，授权与已查看分开，最高已查看单调。L5 挑战绑定用户/会话/请求、5 分钟有效且防重放。
- L0/L1 限制模型为结构化 focus/原文引用，服务器用审核过的模板提问；L2 以上允许受等级约束的 Markdown/LaTeX。安全渲染禁 raw HTML/远程图片，KaTeX trust:false。自动规则不能形式化保证不剧透或算法判断正确。
- 新 [M2 迁移](supabase/migrations/202610110002_m2_tutor.sql) 增加授权、请求、消息、提示事件和用量；RLS/只读表授权 + 用户 JWT/HMAC 受控 RPC，浏览器不能伪造 assistant、事件或费用，内部上下文/nonce/签名不公开，不新增 service-role 使用。
- UTC 每日用户额度、跨会话单用户并发租约、幂等请求与有界重试；usage 使用真实响应字段，缺失为 NULL。可选价格仅估算，超时/未知用量和进程崩溃不能证明没有费用，不设假账单。

没有内部题解/隐藏观察读取路径；只把用户题面、相关草稿、少量思路版本及可见历史送模型。授权未获得内容不增已查看。调用后完成训练/租约过期会丢弃可见结果，仍结算已取得的真实 usage。详见 [接口与失败语义](docs/M2_API.md)。

[原创 12 题教学审核集](docs/tutor/teaching-review-dataset.json) 用于固定输出回归和后续真实模型人工验收，当前没有实测教学评分。官方 AC、用户自报、AI 推测保持不同来源；CF API 不保证完整题面，本轮不调用 CF 或用户任意 URL。

## 测试

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run test` 包含原 M0 单测、输入/权限/保存队列、Route Handler/SDK 替身测试，以及 PGlite 临时 PostgreSQL + pgcrypto 执行 M1/M2 正式迁移、HMAC、权限/额度/租约及 [M1 SQL/RLS 断言](supabase/tests/m1_rls.sql)、[M2 SQL smoke](supabase/tests/m2_rls.sql)。PGlite 是实际 SQL/RLS 引擎；Auth uid/JWT 环境是替身，单连接竞争测试不能替代多连接数据库并发验收。

Playwright 在 3100 启动无 Supabase 配置的生产构建（保留 M0 的全部 10 项断言），在 3101 使用 54001 本地 Supabase HTTP 契约替身测试 M1。M2 另在 3102 使用 54002 本地 Chat Completions HTTP Mock（明确标注 MOCK），验证真实应用调用、刷新、升级、错误重试及移动端。没有生产 Auth 绕过或 Mock 回复开关；应用实际经过 Supabase SDK、Cookie、proxy 与 API。注册/验证不发送真实邮件，这些结果不能宣称托管 Supabase 联通。

如需在已迁移的专用隔离 Supabase/本地 PostgreSQL 库运行同一 SQL 文件，安装 `psql` 后显式设置：

```bash
export M1_ALLOW_DATABASE_TESTS=isolated
export M1_TEST_DATABASE_URL='<isolated database connection string>'
npm run test:rls
```

**禁止使用生产数据库。** 脚本没有配置会拒绝运行；夹具位于事务内，最终回滚。真实 Supabase 邮件、Cookie 刷新、PostgREST、双用户隔离与多连接并发仍需按指南人工验收。

M2 生产依赖审计结果见验收记录；开发链 `@next/eslint-plugin-next → fast-glob → micromatch → braces` 仍有 4 HIGH 告警。未执行强制降级或未知兼容性覆盖。Monaco 的 DOMPurify 使用官方 3.4.16 修复版本，由 ESM 构建生效；新增 KaTeX 统一使用官方 0.19.0 修复版本（传递依赖覆盖），已验证公式/危险资源渲染；没有引入不明许可证代码。

## 部署与范围

可导入 Vercel，配置相同公开 Supabase 信息和 `APP_URL`，执行 `npm ci`/`npm run build`，先应用迁移并设置 Auth Site URL/Redirect URLs。也可部署到 Node.js 主机执行 build/start。部署时把 lint/typecheck/test/e2e 作为独立门禁，build 不自动替代它们。

M2.5 提供可配置运行的引导与 AC 复盘基础，真实 Provider 教学质量和本轮新增迁移的托管验收仍待完成。Supabase Auth 自带配额需在项目中核对；跨实例写入限频、导出/删除、生产 CSP、CF 同步、知识复习及生产硬预算/多连接验收在后续里程碑完成。不会为了缺少账户权限而自行创建外部项目或执行生产测试。

工程总需求保留于 `AGENTS.md`、`DEVELOPMENT_PLAN.md`、`CODEX_PROMPT.md`。官方参考：[Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client)、[Next.js proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[数据库函数权限](https://supabase.com/docs/guides/database/functions)、[Monaco React npm 加载](https://github.com/suren-atoyan/monaco-react#use-monaco-editor-as-an-npm-package)。

## M2.5 代码复盘

追加 `202610120005_ac_reviews.sql`，沿用 M2 Provider/private HMAC 配置。不改旧迁移、不删 Session/Thought/Code。新表 owner SELECT/窄 RPC 写入，模型输出需 HMAC；跨 Tutor/Review 共享 UTC 每日入场与用户并发限制。普通聊天不能进入复盘，完整分析不计入 AC 前提示历史。

文件仅浏览器读取选择的 .cpp/.cc/.cxx/.txt，UTF-8、64000字节、类型/控制字符校验；没有任意路径或二进制上传接口。确认前显示发送提醒，请先删除敏感内容；保存快照后点击生成/追问才向配置 Provider 发送代码、题面及近期复盘。AI 未配置时可保存快照/编辑，生成禁用。

分析绑定不可变 SHA-256 快照，代码行范围审核，改代码新建复盘。原结构化分析/历史保留，用户编辑 CAS 独立保存。AI 只做静态分析，未运行、编译或验证代码；证明摘要与未证明假设分开。自动审核不能证明语义可靠，真实教学质量须人工验收。

基础列表上限100份、每份最近30份分析，无分页 UI；未保存内容仅当前页面内存。模型输入预算可能小于代码保存上限，超限413，不截断当前源码；预算配置见 [M2.5 配置](docs/M25_SETUP.md)。
