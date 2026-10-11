# AlgoPilot 实施状态

范围以 DEVELOPMENT_PLAN.md 的 M0–M4 为主；CODEX_PROMPT.md 中拆出的复盘/稳定化项目将在对应阶段验收，M5 稳定性要求保留为最终检查清单。当前仅执行用户明确要求的 M0。

## M0：脚手架与设计系统

- [x] 保留三份原始需求文件；初始化 Git。
- [x] Next.js App Router、React、严格 TypeScript（含 noUncheckedIndexedAccess）。
- [x] Tailwind、shadcn/ui 配置与基础组件、Lucide、中文设计系统。
- [x] 深浅主题跟随系统、手动切换及本机持久化。
- [x] 所有要求路由的页面壳、首页重定向、404、加载与错误页面。
- [x] `/practice/preview` 桌面三栏与移动端标签；禁用尚未接入的操作。
- [x] 真实空状态、明确的账户/AI 未接入状态，服务配置仅返回白名单枚举。
- [x] 环境变量示例、安装/部署说明、测试配置与测试用例。
- [x] lint / typecheck / test / build 实际验收通过（10 个单元测试）。
- [x] Playwright 桌面/移动 smoke 实际验收通过（10 项，含修复后的 HTTP 404）。
- [x] 干净 `npm ci` 与依赖兼容性检查通过。

详细命令、首轮失败与修复、安全扫描及未验证项见 [M0_VERIFICATION.md](M0_VERIFICATION.md)。

## 后续阶段（尚未实现）

- M1：SQL/RLS、Supabase SSR Auth/受保护路由、题目与真实训练持久化、计时、Monaco 草稿及版本恢复。
- M2：仅服务端 Provider、L0–L5 权限、L5 双确认、比赛拦截、输出验证、调用额度与日志。安全 Markdown/KaTeX 在真实内容接入时实现。
- M3：官方 CF 元数据、Handle、提交/Rating 增量同步、外部 AC 证据及复盘/复习。
- M4/稳定化：真实统计、隐私导出/删除、跨实例限频、完整 E2E/安全测试、手工题集审核、生产部署。

## 尚未验证

没有访问任何第三方账户、没有 Supabase 或模型凭据、没有执行 CF 数据同步。环境变量填写完整不表示服务已连通。
