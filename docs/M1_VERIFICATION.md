# M1 验收记录

日期：2026-10-11。基线：main，M0 提交 `91bfd6ae36de521a409c89a52db4d252bde7a3c8`。开始时 Git 工作区干净；增量实现，原 M0 单测/E2E 断言、总需求及 M0 验收记录未删除或改写。本轮仅 M1。

## 1. 实际运行并通过

干净安装后的最终质量门禁已实际执行，全部必需检查通过。以下区分本地执行、替身验证与托管服务未验证：

| 命令/检查              | 实际结果                                                       |
| ---------------------- | -------------------------------------------------------------- |
| `npm ci`               | 成功，最终锁文件干净安装（381 packages）                       |
| `npm run lint`         | 通过，0 error / 0 warning                                      |
| `npm run typecheck`    | 通过，严格 TS 与 Next 路由类型                                 |
| `npm run test`         | 56/56（7 文件），0 failed / 0 skipped，含 4 项 PostgreSQL 集成 |
| `npm run build`        | Next.js 16.4.0 Webpack 通过，postbuild 确认 DOMPurify 3.4.16   |
| `npm run test:e2e`     | 22/22（最终补丁产物），桌面/移动，0 failed / 0 skipped         |
| `git diff --check`     | 通过                                                           |
| `npm audit --omit=dev` | 0 vulnerabilities                                              |
| `npm audit`            | 非零：4 HIGH，已有 braces 开发依赖链；未强制修复               |

数据库部分是**真正 SQL/RLS 执行**，不是 mocked repository：`tests/integration/database.test.ts` 在临时 PGlite PostgreSQL 应用完整正式迁移，执行 `supabase/tests/m1_rls.sql`，共 4 个集成用例。覆盖两用户/匿名读取、父会话归属、无权 RPC、禁止直接 DML/owner/time 篡改、禁止读取 tags、私人题面不能进入共享 CF 记录、历史仅追加、幂等/旧版本冲突、计时/重复转换及完成冻结。完整 SQL 用例事务回滚。Auth schema/uid 来自隔离测试上下文；没有证明托管 JWT、邮件或 PostgREST。

构建包含本地 Monaco ESM/C++ 与 worker；浏览器用例确认编辑器实际加载、无 CDN 请求/页面错误、移动交互及无横向溢出。Webpack 精确替换 Monaco 内置 DOMPurify 3.4.15，使用官方 3.4.16；`postbuild` 检查真实客户端产物，拒绝旧版本或补丁缺失，不能仅凭 lockfile 推断修复。

`npm run test:rls` 在没有隔离库配置时已实际执行并**按预期拒绝（exit 1）**。没有连接数据库；这个安全闸门结果不是托管 SQL/RLS 测试通过。

## 2. 仅通过 Mock/单元测试验证

- Zod 白名单、限长、人工结果来源、安全 next、无配置降级和计时显示函数。
- DraftQueue 的旧响应不覆盖新输入、顺序 revision、重试保留、重复 flush、按会话隔离；没有证明真实网络在所有中断时序下都能保存。
- Route Handler 的 401/404/409/422、来源检查、无 JSON/超长 body、安全错误；使用 Auth/repository 替身，真实 RLS 由上一节独立执行。
- proxy 使用 `getUser()`，不信任 `getSession()`/伪造身份，刷新 Cookie 保留及失效重定向；SDK 替身不做真实 JWT 验签。
- Playwright 的 M1 用实际 Next 生产服务 + Supabase SDK + `tests/fixtures/supabase-http.mjs` HTTP 契约替身：注册/邮箱回调、非法密码、登录目标恢复、退出、两用户 Session/Thought/API 隔离、自建题目、刷新草稿/历史恢复、暂停/并发恢复/完成、失效会话保存失败保留和应用导航阻止。
- 原 M0 的 10 项浏览器测试保持原断言，另一个无配置生产服务器验证页面壳、主题、preview、真实空状态与 404。M1 浏览器测试 12 项，两种尺寸各 6 项。
- PGlite 并发 Promise 测试由单个连接顺序处理，验证竞争请求的 revision/幂等语义，**不代表独立连接的锁竞争已经验证**。

## 3. 缺少隔离 Supabase 配置而尚未验证

本机发现已有 Supabase URL/public key 配置，但没有用户授权用于破坏性测试的隔离项目连接、专用测试账户，也无 psql/Docker/Supabase CLI。没有读取或输出凭据值、修改 `.env.local`，没有连接现有项目执行 SQL/注册/写入，更没有访问生产数据库。

待人工在专用项目完成：真实迁移、Auth profile trigger、真实邮件/SMTP与 PKCE verifier、跨浏览器 token_hash 验证、实际 Cookie 到期刷新、托管 Auth JWT 验证/PostgREST 权限、两个真实账户的跨用户 RLS、**多独立连接并发追加/暂停恢复**以及部署回调配置。步骤见 [SUPABASE_SETUP.md](SUPABASE_SETUP.md)。配置完整度不等于服务连接成功。

## 4. 已知限制与后续任务

- 已保存草稿可跨刷新恢复；未保存失败内容只保留当前编辑器内存，不承诺断电/强制关闭后恢复。应用导航和 beforeunload 提醒不能保证阻止所有浏览器 Back/外部导航，必须等待“已保存”或先复制本地内容。
- 多窗口冲突保守返回 409，当前不自动合并；需复制本地内容后重新加载。历史查看/恢复不覆盖旧记录。
- 计时以数据库状态为真，UI 依据服务器时间估计显示；秒数累计向下取整，暂停/完成时落库；浏览器关闭不会自动暂停，重新打开后仍继续累计未暂停区间。
- 完成会话冻结内容和时间，没有“重新开始已完成会话”；可另建训练。结果只标用户自报，未关联官方 AC 或推断独立性。
- profiles 当前仅初始化/读取；CF Handle/偏好编辑、数据导出删除、自动复盘/统计未实现。没有假 AI 消息或提交记录。
- M2 才实现 LLM、后端 L0–L5/L5 双确认、比赛模式 AI 拦截、usage/限额。M1 全部 AI 操作禁用，根本不存在模型调用路径。M3 接 CF，M4 做跨实例写限频/生产 CSP 等完整验收。
- 4 个 HIGH 开发告警同源：Next ESLint → fast-glob → micromatch → braces。npm 的 force 建议降级 Next ESLint 14，未采用；没有不明兼容性 braces override。Monaco DOMPurify 的官方安全补丁单独验证产物。

## 发现问题与修复记录

- 在 npm ci 清理 node_modules 的过程中抢先运行 lint/test，命令找不到工具；等待安装结束后完整重跑通过。
- PGlite 首轮文件路径被 Vitest 的 URL 转换影响，修为 cwd 明确路径，重新运行 SQL 集成通过。
- 初次新 ESM 导入沿用旧 Monaco 路径；按 0.57 package exports 与 C++ register 路径修正，typecheck/build/实际编辑器加载通过。
- 构建复制的官方 minified worker 被 lint 当源码扫描；只忽略生成目录，项目和测试源码仍完整检查。
- 首轮 M1 E2E 8 项失败：内部 localhost URL 与外部 Origin 不一致导致合法 Auth 请求 403；修复 APP_URL/Host 同源校验并新增跨站回归断言。重新执行全部测试通过，没有删除既有断言或静默 skip。
- 首次网络受限 audit 请求失败，获得网络执行权限后实际重跑生产/全量审计；结果如上。
- 发现 Monaco vendored DOMPurify 无法仅靠依赖 override 修复，追加精确 Webpack 导入替换和构建产物验证；最终 build 与全部 22 项 E2E 复验通过。

核心入口：[M1_API.md](M1_API.md)、正式 migration、SQL/RLS 测试、Auth/proxy、API repository、Workspace 和 DraftQueue；安装与部署见根 [README.md](../README.md)。
