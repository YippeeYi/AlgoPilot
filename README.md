# AlgoPilot

面向 Codeforces / XCPC 个人选手的算法竞赛训练助手。以独立思考、苏格拉底式引导和可追溯复盘为核心。

**当前交付：M0 脚手架与设计系统。** 可以真实运行和浏览页面壳；账户、数据库、训练保存、AI、CF 同步尚未接入。所有相关操作禁用，不生成假训练记录、假统计或假 AI 回答。详细进度见 [docs/MILESTONES.md](docs/MILESTONES.md)。

## 快速运行

需要 Node.js 24 LTS（24.15 或更新的 24.x，亦支持 26+）与 npm。当前测试工具的最低版本要求高于 Next.js 本身。

```bash
npm ci
npm run dev
```

打开 http://localhost:3000 。M0 无需 `.env.local` 或外部账户。生产构建：

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run start
```

`typecheck` 先生成 Next 路由类型，因此可在全新 checkout 中运行。依赖版本在 `package.json` 和 `package-lock.json` 固定。没有构建时，先执行 `npm run build` 再执行 `npm run start`。

开发与构建使用 Next.js 官方支持的 `--webpack`。当前执行环境限制了 Turbopack 的 PostCSS 子进程端口，导致默认构建中断；Webpack 不需要该端口。此选择不改变 App Router 或应用功能。

## 页面与交互

- `/login`、`/register`：明确标注尚未接入的账户页面。
- `/dashboard`：训练入口与真实空状态。
- `/problems`：题库与导入操作的页面壳。
- `/practice/preview`：桌面三栏；移动端题面、思路/代码、AI 教练标签切换。预览不保存数据，不启动计时或调用 AI。
- `/sessions`、`/reviews`、`/analytics`：历史、复盘与统计空状态，不推断独立完成率或 Rating。
- `/settings`：服务端读取配置，只展示“未配置/配置不完整/已填写配置·未验证连接”，不发送凭据。
- 不存在的路由或预览之外的 session ID 返回 404。

顶部主题按钮切换深浅主题，默认跟随系统，通过 next-themes 保存在本机。预览路由是公开的静态壳，不是已认证的训练空间；M1 在处理任何私人数据之前接入服务端鉴权和 RLS。

## 环境变量（后续阶段）

```bash
cp .env.example .env.local
```

仅填入你自己提供的凭据；不要提交 `.env.local`。

| 变量                                                                    | 用途                                   | 浏览器可见           |
| ----------------------------------------------------------------------- | -------------------------------------- | -------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                              | Supabase 项目 HTTPS URL                | 是                   |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                                  | Supabase 公开 publishable key          | 是（不是管理员密钥） |
| `SUPABASE_SERVICE_ROLE_KEY`                                             | 后续需要的受限服务端可信写入           | 否                   |
| `LLM_PROVIDER`                                                          | `openai-compatible`                    | 否                   |
| `LLM_BASE_URL`                                                          | 服务商 Chat Completions 基础 HTTPS URL | 否                   |
| `LLM_API_KEY`、`LLM_MODEL`                                              | 模型凭据与模型 ID                      | 否                   |
| `LLM_DAILY_REQUEST_LIMIT`                                               | 每日调用上限（M2）                     | 否                   |
| `LLM_MAX_INPUT_CHARS`、`LLM_MAX_OUTPUT_TOKENS`                          | 输入长度、输出预算（M2）               | 否                   |
| `LLM_INPUT_USD_PER_MILLION_TOKENS`、`LLM_OUTPUT_USD_PER_MILLION_TOKENS` | 可选价格，按供应商报价维护             | 否                   |

填写环境变量不会使 M0 的未实现功能自动可用。无 Key 时可浏览全部壳页面和预览；无法真实登录、持久化训练、生成 AI 或同步 CF。

## Supabase 与迁移

M1 会在 `supabase/migrations/` 添加完整 SQL；当前没有可执行迁移，也没有验证 RLS。届时需要：

1. 自行创建 Supabase 项目、启用邮箱 Auth，设置本地及部署站点的重定向 URL。
2. 填写公开 URL/key，管理员 key 仅放服务端。
3. 按迁移顺序执行 SQL，核对每张私人表的 RLS、子表 owner 策略及受限写入权限。
4. 用两个专用测试用户验证跨用户读写被拒绝；完成验证后再接入私人数据页面。

当前不声称数据库、鉴权或外部服务集成成功。

## 教学与数据边界

默认 L0；等级提升仅来自后端显式授权，L5 两次明确确认，最高已查看等级不能降低。比赛模式在后端拒绝题目相关 AI。未解锁题解、关键观察和算法信息不能进入浏览器响应。M0 的 L0 标签仅是默认布局展示，权限机制在 M2 实现。

后续 AI 将先完整生成并验证输出，再返回用户可见摘要；不暴露内部推理链、不运行用户 C++。未经确定性验证的反例与正确性判断标为待验证。**自动输出审核无法保证绝对不剧透**，需结合保守策略与至少 10 道人工题集审核。

CF 接入使用官方 API，仅获取元数据、提交、Rating 等公开事实。API 不提供完整题面或提交源代码；题面由用户自行提供。URL 导入白名单解析，不按不可信 URL 任意 fetch。官方 AC、用户自报的独立完成、AI 推测必须区分。公开 Handle 不代表账号归属已验证。

## 测试

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest + Testing Library 验证配置状态输出不泄密、未配置与不完整配置、无伪统计和禁用账户提交。Playwright 启动本地生产构建，检查八个页面、首页重定向、主题刷新恢复、三栏/移动标签、404 与无横向溢出。测试使用专用固定配置字符串，不读取个人生产秘密。

M0 smoke 不替代后续真实登录/训练/持久化 E2E、RLS 集成测试、提示权限/泄露测试或真实 Provider 验收。实际执行结果记录在里程碑文件中。

M0 四项质量门禁及 10 项浏览器 smoke 已实际通过。生产依赖审计为 0 告警，全量开发依赖审计仍有 4 个高危告警（同一 `braces` 问题，目前上游无修复版本）。完整结果与修复过程见 [M0 验收记录](docs/M0_VERIFICATION.md)。

## 部署

可将此 Next.js 项目导入 Vercel，使用 `npm ci` 与 `npm run build`、默认 Next.js 输出；或者在支持 Node.js 的服务上执行 `npm run build && npm run start`。M0 部署仅供布局预览。

在后续完成 Auth/RLS、跨实例请求限额、CSP、数据导出/删除和安全验收前，不把此预览作为完整训练平台上线。运行 lint/typecheck/test 不会随 Next.js build 自动执行，应作为独立质量门禁。

## 工程规则与官方参考

根目录 `AGENTS.md`、`DEVELOPMENT_PLAN.md`、`CODEX_PROMPT.md` 为工程与产品规则。保留其原文，以里程碑文档记录当前范围。M0 只安装当前需要的依赖；Supabase SSR、Monaco、KaTeX 等在对应功能实现时引入。

- [Next.js 安装与脚本](https://nextjs.org/docs/app/getting-started/installation)
- [Tailwind 的 Next.js 配置](https://tailwindcss.com/docs/installation/framework-guides/nextjs)
- [shadcn/ui 配置](https://ui.shadcn.com/docs/installation/manual)

不复制许可证不明确的参考仓库代码。基础 UI 组件由 MIT 许可的 shadcn/ui 官方组件生成，其上实现 AlgoPilot 原创页面。
