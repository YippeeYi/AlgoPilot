# AlgoPilot 实施状态

范围以 DEVELOPMENT_PLAN.md 的 M0–M4 为主；CODEX_PROMPT.md 中拆出的复盘/稳定化项目将在对应阶段验收，M5 稳定性要求保留为最终检查清单。当前执行用户明确要求的 M1，基于 M0 提交 `91bfd6ae36de521a409c89a52db4d252bde7a3c8` 增量实现。

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

## M1：认证、数据库与训练持久化

- [x] Supabase Browser/Server Client、Cookie SSR、Next.js 16 proxy 刷新、服务端 getUser 验证。
- [x] 邮箱注册/密码登录/登出/PKCE 与 token_hash 回调、私人路由保护及安全 next 恢复。
- [x] 正式四表 migration、约束/外键/索引、RLS/GRANT、父子归属、仅追加历史与不可变身份/时间。
- [x] 使用普通用户 JWT 的受控事务 RPC；无 service-role SDK、无客户端直接表 DML。
- [x] 自建私人题目/训练、个人分页列表、真实详情、重新打开未完成训练。
- [x] 数据库计时与明确状态转换，重复请求幂等、完成冻结、手动结果只标自报。
- [x] 思路/代码草稿 CAS 与串行队列、自动/手动保存状态、错误保留、刷新恢复。
- [x] 明确追加历史版本、查看/分页、恢复到编辑器且不覆盖历史。
- [x] 本地按需 Monaco C++、文本回退、桌面三栏/移动标签、AI 禁用预留区。
- [x] `/api/v1` 鉴权、严格输入白名单、长度/分页约束、同源、404 隔离及安全错误。
- [x] preview 独立公开、不初始化 Auth、不读写私人数据；M0 测试断言保留。
- [x] 真正本地 PostgreSQL 执行 SQL/RLS、业务/SDK/API 替身测试和浏览器 HTTP 契约替身测试。
- [x] Supabase 配置/迁移/隔离验收指南、环境示例与 API 文档。
- [x] 干净 npm ci、lint/typecheck/test/build/e2e 最终通过；56 项测试、22 项浏览器测试；生产依赖审计 0，已知 4 项 braces 开发告警保留追踪。
- [ ] 托管 Supabase 真实用户/邮件/PostgREST/自动刷新、多连接并发及线上迁移验收。

代码与本地检查状态详见 [M1_VERIFICATION.md](M1_VERIFICATION.md)。真实服务验收单独列出，不能把本地替身结果当作完成线上认证/RLS 集成。

## 后续阶段（本轮未实现）

- M2：仅服务端 Provider、L0–L5 权限、L5 双确认、比赛拦截、输出验证、调用额度与日志。安全 Markdown/KaTeX 在真实内容接入时实现。
- M3：官方 CF 元数据、Handle、提交/Rating 增量同步、外部 AC 证据及复盘/复习。
- M4/稳定化：真实统计、隐私导出/删除、跨实例限频、完整 E2E/安全测试、手工题集审核、生产部署。

## 尚未验证

M1 发现本机已有 Supabase 公开配置，但没有可用于破坏性测试的隔离数据库/专用用户，也没有 psql、Docker 或 Supabase CLI。未用该配置访问账户或写入数据库，未发送真实邮件。没有执行模型/CF 调用。环境变量填写完整不表示服务已连通。
