# Supabase 创建、迁移与 M1 验收

本指南为人工配置步骤；不表示已创建项目或验证线上连接。先使用专用测试项目，通过后再安排生产迁移。M1 不需要 service-role key。

## 1. 创建项目与环境

1. 在自己的 Supabase 账户创建项目，妥善保管数据库密码；为测试单独建立项目/本地环境。
2. 从项目的 Connect/API Keys 界面取得 Project URL 和 publishable key（旧项目可用 anon key）。不要把 secret/service-role key 填入 NEXT_PUBLIC 变量。
3. 复制 `.env.example` 到 `.env.local`，填写 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`、`APP_URL`。本地默认 `http://localhost:3000`；如果使用 127.0.0.1，也要保持浏览器地址、APP_URL 和重定向配置一致。
4. 部署环境使用实际 HTTPS origin；修改 NEXT_PUBLIC 配置后重新构建。不要把真实数据库连接字符串、用户密码或 key 写入提交/测试夹具。

配置检测仅输出缺失/不完整/完整枚举。完整不代表登录、数据库迁移或邮件已成功。

## 2. 应用迁移

在新建的隔离项目 SQL Editor 中执行 `supabase/migrations/202610110001_m1_training.sql` 的完整内容；或者用自己的 Supabase CLI 按迁移顺序应用。迁移有事务，失败需排查后重试；已执行成功的迁移不要重复粘贴或修改历史，后续改动新增 migration。

迁移建立四表、约束/索引、Auth profile 初始化 trigger、RLS、受限 RPC 和授权。已有 Auth 用户会补齐 profile。SQL 没有生产用户样例或伪 CF 记录。

核对：

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in
  ('profiles', 'problems', 'training_sessions', 'thought_snapshots');
select tablename, policyname, roles, cmd from pg_policies
where schemaname = 'public';
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public';
```

四表 RLS 均应 true。anon 只能读取 CF 公共元数据的允许列；authenticated 可读自己的私人记录。没有表 INSERT/UPDATE/DELETE 权限和写策略；普通 JWT 的写入通过显式 owner 检查的 SECURITY DEFINER RPC。内部 trigger/锁函数不能被普通用户调用；算法 tags 无直接 SELECT 权限。

可选迁移后用 CLI 生成数据库类型并与 `src/lib/supabase/database.types.ts` 核对；本次类型人工按迁移维护，尚未连接托管项目生成。

## 3. 配置邮箱 Auth

在 Authentication 中启用 Email/password，按项目需要启用 Confirm email（推荐保留验证）。核对 Site URL 为 APP_URL，并在 Redirect URLs 添加实际来源的 `/auth/callback`，如 `http://localhost:3000/auth/callback`、部署站点的 HTTPS 回调；如回调带 next 参数不匹配，可按官方 Redirect URL 规则设置仅该站点的回调匹配规则。

应用支持两种回调：

- 默认 PKCE 邮件链接通过 Supabase 返回 `/auth/callback?code=...`，使用创建注册请求的同一浏览器中保留的 verifier Cookie。
- 如希望跨浏览器验证，可将 Confirm signup 邮件模板链接设置为：

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email"
  >确认邮箱</a
>
```

该模板默认进入 dashboard；代码也支持回调 next 参数，只接受应用内部私人路由。验证码和 code 不记录日志，回调使用 no-store/no-referrer。真实邮件发送、SMTP 与频率配额按 Supabase 项目配置核对；本地测试替身不会发送邮件。

## 4. 隔离库 SQL/RLS 测试

默认 `npm run test` 运行临时本地 PGlite PostgreSQL，真实执行迁移、RLS、GRANT、trigger 和 RPC。Auth 上下文由测试提供；不能代替托管 Auth/PostgREST 验收。

如果有已应用迁移的专用测试数据库，安装 psql，确保连接身份有创建 auth.users 测试夹具/SET ROLE 的权限：

```bash
export M1_ALLOW_DATABASE_TESTS=isolated
export M1_TEST_DATABASE_URL='<专用隔离数据库连接字符串>'
npm run test:rls
```

脚本不读取 `.env.local`，未显式开启时立即拒绝，不连接任何数据库。`m1_rls.sql` 开启事务，测试两用户/匿名/权限/计时后回滚；出错时连接关闭也回滚。**禁止使用生产库，即使测试会回滚。** 脚本的开启值是安全闸门，不能自动判定数据库是否生产，需人工确认。

## 5. 托管项目人工验收清单

使用两个专用测试账户及新浏览器上下文；不得拿个人生产记录执行测试。

- 注册、收到邮件、验证回调、登录、退出；非法密码/过期链接明确失败。
- 未登录访问全部私人页面时跳转，登录后恢复原目标；preview 始终公开。
- 用户 A 创建题目与会话、思路草稿/两个历史版本/C++ 草稿；刷新和重新打开后内容一致。
- 暂停不继续累计；继续后累计；完成后冻结，结果仅自报。
- 用户 B 的列表看不到 A；直接请求 A 的 session/thought/code API 均为 404；以 B 的 JWT 直接调用 RPC 也失败。
- 普通 JWT 不能直接表写入、更新历史或 owner/time；直接读取 tags 被拒绝。
- 两个窗口以同 revision 同时修改不同草稿：一个成功，另一个 409；不会覆盖较新内容。
- **用多条独立数据库连接**同时追加相同 thought revision、恢复计时：版本唯一/连续、重复恢复不重置起点；本地 PGlite 单连接没有证明跨连接锁竞争。
- 使会话失效后尝试保存，401 且本地编辑器内容保留；重新登录后重试。核对 Cookie 自动刷新和 server no-store。
- 核对 Supabase Auth 配额、数据库访问日志不含敏感内容；依赖告警及后续限频/CSP 尚待生产阶段验收。

通过后再安排部署迁移、备份及应用环境配置。不要在部署时自动运行破坏性 SQL 测试；应用只使用公开 key + 当前用户 Cookie。

官方参考：[SSR Cookie 客户端与身份验证](https://supabase.com/docs/guides/auth/server-side/creating-a-client)、[Email password](https://supabase.com/docs/guides/auth/passwords)、[Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)、[Email templates](https://supabase.com/docs/guides/auth/auth-email-templates)、[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Function security](https://supabase.com/docs/guides/database/functions)。
