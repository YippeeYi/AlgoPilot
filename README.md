# AlgoPilot

面向 Codeforces / XCPC 个人选手的算法竞赛训练助手，以独立思考、苏格拉底式引导和可追溯复盘为核心。

**当前交付：M1 认证、数据库与训练工作台持久化。** 实现邮箱账户、私人题目、训练会话、服务端计时、思路草稿与历史版本、C++ 草稿和刷新恢复。保留 M0 主题及响应式布局；AI、CF 同步、自动复盘和统计仍未接入，不生成伪数据。托管 Supabase 尚待隔离项目验收，详细证据见 [M1 验收记录](docs/M1_VERIFICATION.md) 和 [里程碑](docs/MILESTONES.md)。

## 运行

需要 Node.js 24.15+（24.x LTS，或 26+）和 npm。

```bash
npm ci
cp .env.example .env.local
npm run dev
```

打开 http://localhost:3000。填入 Supabase 项目 URL、publishable key 和实际站点 `APP_URL`，并先应用迁移，才可真实认证和保存。详细步骤见 [Supabase 配置指南](docs/SUPABASE_SETUP.md)。没有配置时可浏览无数据页面壳与 `/practice/preview`，不会伪造登录或启用保存。

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run start
```

保留 Next.js 16.4.0、严格 TypeScript、npm lockfile 和 `--webpack`。`typecheck` 自动生成路由类型；`predev`/`prebuild` 从安装的 Monaco 复制本地 worker，不需要 CDN。C++ 编辑器仅在真实工作台动态加载，不执行代码。

## M1 功能

- `/login`、`/register`：邮箱密码登录、注册、验证回调；登录恢复安全的原访问目标，登出和失效会话提示。
- `/dashboard`、`/problems`、`/sessions`、`/reviews`、`/analytics`、`/settings`、真实 `/practice/[sessionId]`：配置完整时均要求服务端验证身份。没有配置时只提供明确标注的无数据壳。
- `/problems`：私人自定义题目创建和分页列表；共享 CF 元数据结构已预留，尚不进行导入或同步。
- `/sessions`：创建自主训练、个人分页列表和重新打开。比赛模式也能计时、写草稿；AI 始终禁用。
- `/practice/[sessionId]`：桌面三栏/移动标签；私人题面快照、Monaco C++、草稿自动/手动保存、追加思路历史与恢复、暂停/继续/完成。
- `/practice/preview`：独立公开入口，不初始化 Auth、不读取私人数据、不保存或调用 AI；尚未接入操作禁用。
- 复盘、学习统计和 CF 设置保留真实空状态，后续阶段接入。

草稿在停止编辑约 1.2 秒后自动保存，有保存中/已保存/失败状态。旧响应不会覆盖新输入；多窗口冲突返回 409，需要先复制本地内容，再刷新加载服务器版本。请等“已保存到服务器”后刷新。思路历史由“保存历史版本”明确生成，每次按键不会新增版本；恢复只改当前草稿。

状态为 `active → paused → active`，任一未完成状态可完成；完成后冻结计时及草稿。重复暂停/继续/相同结果的完成请求无副作用；实际转换须匹配 state revision。计时由数据库时间、行锁及累计秒数决定，前端仅显示估计进度。结果仅为用户自报，不等同官方 AC，也不推断独立完成。

## 数据库与安全

正式迁移：[202610110001_m1_training.sql](supabase/migrations/202610110001_m1_training.sql)。四表：`profiles`（关联 Auth）、`problems`（公开元数据或私人自建）、`training_sessions`（唯一用户）、`thought_snapshots`（父会话归属，仅追加）。公共 CF 记录不能含私人题面；用户提供的题面放在私人会话快照中。

HTTP 请求与状态字段见 [M1 API 契约](docs/M1_API.md)。

所有表启用 RLS；私人 SELECT 按 `auth.uid()`，子表通过父会话验证。客户端不获表 DML 权限；算法 tags 不授予直接 SELECT。用户 JWT 可调用有限 RPC，函数显式核验身份/归属、固定空 search_path、事务行锁、revision CAS 与幂等键，数据库生成可信时间和 owner。内部锁函数不开放调用。M1 不使用 service-role key。

Next proxy 刷新 Cookie；页面和 API 使用服务端 `getUser()` 验证，不能用客户端 userId/getSession 授权。请求经 Zod 严格白名单、长度/分页限制与同源检查；未登录 401、不可访问对象 404、无效输入 400/422、版本/状态冲突 409、缺配置/服务故障 503。响应 no-store，错误不输出 SDK 原文、请求内容或密钥。生产同源检查使用 `APP_URL`；不信任任意 X-Forwarded-Host。

环境变量只从 `.env.local` 或部署平台读取：

| 变量                                              | 用途                                     | 浏览器可见 |
| ------------------------------------------------- | ---------------------------------------- | ---------- |
| `NEXT_PUBLIC_SUPABASE_URL`                        | 项目 HTTPS URL（本地可 localhost）       | 是         |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`            | publishable/anon key，绝不能填管理员 key | 是         |
| `APP_URL`                                         | 实际站点 origin 与验证回调               | 无需发送   |
| `SUPABASE_SERVICE_ROLE_KEY`                       | 后续可信服务任务预留，M1 不使用          | 否         |
| `LLM_*`                                           | M2 服务端 Provider、预算与限额预留       | 否         |
| `M1_ALLOW_DATABASE_TESTS`、`M1_TEST_DATABASE_URL` | 只供隔离数据库 SQL 测试                  | 否         |

默认 L0、L5 双确认、比赛模式的服务端 AI 拦截将在 M2 完成；M1 没有任何模型调用路径。题面安全展示为纯文本；安全 Markdown/KaTeX 在内容阶段实现。官方 AC、用户自报、AI 推测保持不同来源。CF API 不保证完整题面；M1 不调用外部 CF 或任意用户 URL。

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

`npm run test` 包含原 M0 单测、输入/权限/保存队列、Route Handler/SDK 替身测试，以及 PGlite 临时 PostgreSQL 执行正式迁移与 [完整 SQL/RLS 断言](supabase/tests/m1_rls.sql)。PGlite 是实际 SQL/RLS 引擎；Auth uid/JWT 环境是替身，单连接竞争测试不能替代多连接数据库并发验收。

Playwright 在 3100 启动无 Supabase 配置的生产构建（保留 M0 的全部 10 项断言），在 3101 使用 54001 本地 Supabase HTTP 契约替身测试 M1。没有生产 Auth 绕过开关；应用实际经过 Supabase SDK、Cookie、proxy 与 API。注册/验证不发送真实邮件，这些结果不能宣称托管 Supabase 联通。

如需在已迁移的专用隔离 Supabase/本地 PostgreSQL 库运行同一 SQL 文件，安装 `psql` 后显式设置：

```bash
export M1_ALLOW_DATABASE_TESTS=isolated
export M1_TEST_DATABASE_URL='<isolated database connection string>'
npm run test:rls
```

**禁止使用生产数据库。** 脚本没有配置会拒绝运行；夹具位于事务内，最终回滚。真实 Supabase 邮件、Cookie 刷新、PostgREST、双用户隔离与多连接并发仍需按指南人工验收。

生产依赖审计 0 告警；开发链 `@next/eslint-plugin-next → fast-glob → micromatch → braces` 仍有 4 HIGH 告警。未执行强制降级或未知兼容性覆盖。Monaco 的 DOMPurify 使用官方 3.4.16 修复版本，由 ESM 构建生效；没有引入不明许可证代码。

## 部署与范围

可导入 Vercel，配置相同公开 Supabase 信息和 `APP_URL`，执行 `npm ci`/`npm run build`，先应用迁移并设置 Auth Site URL/Redirect URLs。也可部署到 Node.js 主机执行 build/start。部署时把 lint/typecheck/test/e2e 作为独立门禁，build 不自动替代它们。

M1 是可配置运行的基础训练版本，尚未完成生产验收。Supabase Auth 自带配额需在项目中核对；跨实例写入限频、导出/删除、生产 CSP、LLM 权限/额度、CF 同步及复盘在后续里程碑完成。不会为了缺少账户权限而自行创建外部项目或执行生产测试。

工程总需求保留于 `AGENTS.md`、`DEVELOPMENT_PLAN.md`、`CODEX_PROMPT.md`。官方参考：[Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client)、[Next.js proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[数据库函数权限](https://supabase.com/docs/guides/database/functions)、[Monaco React npm 加载](https://github.com/suren-atoyan/monaco-react#use-monaco-editor-as-an-npm-package)。
