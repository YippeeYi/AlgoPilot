# AlgoPilot 实施状态

范围以 DEVELOPMENT_PLAN.md 的 M0–M4 为主；CODEX_PROMPT.md 中拆出的复盘/稳定化项目将在对应阶段验收，M5 稳定性要求保留为最终检查清单。M2 已提交；当前以 `77d58e7e98165b9909e2fcf953ce07c022dfab1b` 为基线修复 Gemini 兼容性。M0–M2 功能、历史测试和用户的类型导入约定保留。

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

## M2：AI 思维教练

- [x] server-only 统一 Provider、OpenAI-compatible HTTP、超时/取消、有限退避、响应/usage/输出校验；运行时无假 Provider。
- [x] 单 Orchestrator、七种 action、版本化中文策略、少量历史/版本上下文、静态代码分析，绝不执行 C++。
- [x] L0–L5 数据库授权、独立升级、L5 两次明确确认与绑定/过期/防重放；授权和实际披露分开、max_seen 单调。
- [x] contest/已完成会话双层阻止调用，晚到结果不展示；实时 CF 比赛识别留 M3。
- [x] 新正式迁移/RLS/GRANT、用户 JWT + 服务端 HMAC 可信记录；不用 service-role，普通用户不能伪造 assistant/事件/费用。
- [x] UTC 每日额度、跨会话用户并发租约/幂等、真实 usage 与缺失 NULL、明确重试/费用未知语义。
- [x] 工作台右栏真实对话、刷新/历史加载、操作/等级/确认/错误重试/额度；保留三栏/移动标签/preview 隔离。
- [x] 安全 Markdown/KaTeX、完整响应审核、L0/L1 服务端模板、L2+ 保守输出规则和明显完整程序 L5 记录。
- [x] 保留全部 M0/M1 断言；新增 API/Mock/渲染/教学夹具、本地 PostgreSQL HMAC/RLS/额度测试、桌面/移动 E2E。
- [x] 原创 12 题教学审核集、人工验收规范、API/配置/费用与验证文档。
- [x] Gemini 非加和 usage 的 Provider/SQL 回归、未归类差额、保守 NULL 费用；可配置 reasoning/JSON schema/超时与共享预算。
- [x] 用户授权后应用托管 Gemini usage 迁移；只读核对生成列、旧约束移除、RLS 与普通用户 INSERT 撤销。
- [x] 真实已登录自主训练发起一次 Gemini L0；数据库记录单次 60,004 ms 超时及 NULL usage，未伪造消息或自动重试。
- [ ] 真实 Provider 成功响应、结构化输出、消息刷新恢复、非加和 usage 与费用核对、教学人工验收；本次实际调用超时。
- [ ] 托管 Supabase 双用户隔离、独立多连接并发与全部提示权限验收。

原 M2 执行结果见 [M2_VERIFICATION.md](M2_VERIFICATION.md)；独立兼容修复与真实验收边界见 [GEMINI_VERIFICATION.md](GEMINI_VERIFICATION.md)。

## 后续阶段（本轮未实现）

- M3：官方 CF 元数据、Handle、提交/Rating 增量同步、外部 AC 证据及复盘/复习。
- M4/稳定化：真实统计、隐私导出/删除、跨实例限频、完整 E2E/安全测试、手工题集审核、生产部署。

## 尚未验证

M1/M2 原交付时未完成托管服务测试。Gemini 后续验收已应用获授权的增量迁移，真实用户 JWT/HMAC 入场与失败结算已执行，但模型请求超时，尚未证明成功输出与消息持久化链路。真实调用与剩余边界见独立验收记录。本地 HTTP Mock 不能当作服务联通，CF 尚未接入。

## M2 真实验收后定向修复（2026-10-12）

- [x] 核对部署 save_training_draft 与 M1 函数体一致；定位业务 40001 在托管 PostgREST 上的重试/超时兼容问题。
- [x] 追加 PT409 增量迁移；不修改 M1/M2 历史 SQL、CAS、RLS、函数 ACL、owner 或签名。
- [x] 托管单用户 HTTP：正常 200、过期 409、不覆盖、未登录 401；多窗口冲突和保存/刷新复测见 [定向验收](M2_REPAIR_VERIFICATION.md)。
- [x] 读取已有 Gemini 成功 usage（739/37/776，未分类 0，费用 NULL，消息 2）；未新增模型调用。
- [x] 新增 SQL、SDK HTTP 契约和桌面/移动保存回归；保留全部既有断言。
- [ ] 托管第二用户隔离、真实数据库故障、独立供应商账单/原始 usage 核对，仍需专用资源。
