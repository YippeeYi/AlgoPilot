# M0 验收记录

执行日期：2026-10-11（Asia/Shanghai）。当前只交付 M0，不宣称 M1–M4 已实现。

## 实际执行结果

| 命令 | 最终结果 |
| --- | --- |
| `npm ci` | 通过，锁文件可干净安装 |
| `npm ls --depth=0` | 通过，无缺失/无效直接依赖 |
| `npm run lint` | 通过，0 警告（ESLint 10 + 官方 Next/TypeScript/React Hooks 规则） |
| `npm run typecheck` | 通过，包含 Next 路由类型生成与 strict 检查 |
| `npm run test` | 通过，2 个测试文件 / 10 个测试 |
| `npm run build` | 通过，Next.js 16.4.0、官方 Webpack 构建 |
| `npm run test:e2e` | 通过，桌面 Chromium 5 项 + 移动 Chromium 5 项 |
| `npm audit --omit=dev --json` | 通过，生产依赖 0 个告警 |
| 全量 `npm audit` / 安装审计 | 未通过：开发工具链仍有 4 个高危告警，见下文 |

## 首轮失败与修复

- ESLint 报 PostCSS 匿名默认导出警告：改为具名配置变量；全项目最终 0 警告。
- TypeScript 检查发现测试环境对象缺少 Next 声明的 `NODE_ENV`：配置检查改用只读字符串白名单输入类型。Testing Library 的查询选项也按其实际 API 修正。
- Zod URL refine 在无效 URL 上抛异常：改用 Zod 原生 HTTPS protocol 校验，非法配置返回“配置不完整”。
- jsdom 不实现 `matchMedia`：单测使用明确的浏览器 API stub；主题持久化另由真实 Playwright 浏览器验证。
- ESLint 9 已停止支持，而 Next 聚合配置中的部分旧插件不支持 ESLint 10：采用当前 ESLint 10 和兼容的官方 Next、TypeScript、React Hooks 插件，移除旧聚合配置及重复依赖；干净安装与 lint 通过。
- Turbopack 的 PostCSS 子进程绑定端口被当前执行环境拒绝，普通/提升权限构建均失败。开发与构建脚本使用 Next 官方支持的 `--webpack`；最终生产构建通过。
- 首轮 E2E 为 8 通过 / 2 失败：异步未知会话页面因提前流式输出而返回 HTTP 200。M0 仅允许预渲染的 `preview` 参数，未知会话在路由层返回 404；复验为 10/10 通过。

## 浏览器与视觉检查

实际检查了八个页面壳、根路径跳转、主题切换及刷新恢复、训练桌面三栏、移动标签切换、禁用操作、空统计与 HTTP 404。工作台测试未捕获客户端异常，桌面和手机尺寸没有页面横向溢出。

已生成并查看真实桌面概览、桌面工作台和手机工作台截图，确认文本、表单与卡片排版可读。训练区域尚未实现栏宽拖动、Monaco 或真实草稿编辑；这些属于 M1。

## 依赖安全遗留项

当前开发依赖链 `@next/eslint-plugin-next → fast-glob → micromatch → braces` 导致 4 个高危审计告警，根因是同一项 `braces` 递归嵌套模式的拒绝服务问题。扫描生产依赖未发现告警。这不是“全量依赖扫描通过”。

[官方 GitHub Advisory：GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 当前没有修复版本。未强制降级 Next、未伪造版本覆盖、未关闭审计。后续应跟进上游修复；构建/检查工具不应接收用户提供的 glob 模式。

## 尚未实现或验证

- Supabase Auth、SQL/RLS、多用户隔离、真实题目/训练/计时/思路版本/代码持久化。
- L0–L5 服务端授权、L5 双确认、竞赛模式拦截、LLM Provider、审核和额度。
- CF 官方 API 同步、真实提交及 Rating、复盘和可追溯学习证据。
- 完整登录到训练到复盘 E2E、RLS 集成测试、至少 10 道人工教学题集。
- 安全 Markdown/KaTeX、跨实例限频、CSP、个人数据导出/删除、生产部署与真实供应商调用。

没有访问外部账户或调用真实模型/CF 同步。没有执行数据库迁移；迁移目录当前仅含下一阶段约定说明。当前全部相关界面明确标记未接入并禁用操作。
