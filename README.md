# AlgoPilot

Codeforces / XCPC 算法竞赛学习与复盘助手，核心为卡题启发式引导与 AC 后用户主动提供的 C++ 代码分析。用户在本地 VS Code 编写、编译、调试，在 Codeforces 官网手动提交；AlgoPilot 不执行代码，不提供在线判题或自动提交。

当前交付 **M3 第一阶段：Codeforces 题库、选题和多题训练计划**。M2.5 的 L0–L5 教练、单文件导入、独立 Review Orchestrator、不可变代码快照和深度复盘继续保留。Handle、Rating 历史与官方提交增量同步留给 M3 后续阶段，当前官方状态明确未同步，自报 AC 不等于官方验证。

## 运行

需要 Node.js 24.15+（24.x LTS，或 26+）与 npm。

```bash
npm ci
cp .env.example .env.local
npm run dev
```

设置 Supabase 项目 URL、publishable key 和 APP_URL，按顺序应用 001–006 迁移；只执行目标环境缺失的 SQL。Auth 使用 SSR Cookie、proxy 刷新与服务端 getUser 验证。没有配置时仅提供无数据页面壳和公开 `/practice/preview`，不会伪造登录或启用 AI。

CF 签名默认从已有 Tutor 独立主密钥派生，也支持单独 `CODEFORCES_RPC_SIGNING_SECRET`。配置不等于连接验证。具体见 [M3 配置](docs/M3_SETUP.md)、[Supabase 设置](docs/SUPABASE_SETUP.md)、[M2 Provider](docs/M2_SETUP.md)、[M2.5 复盘配置](docs/M25_SETUP.md)。密钥仅在服务端/private DB，禁止 service-role 绕过。

## 使用流程

- `/problems`：官方题库缓存，题号/题名/URL 检索，Rating 范围、Tags 筛选、解题人数排序与分页。缺失难度显示“未定级”。单选开始训练，多选跨页保留并创建或追加计划。
- `/plans`：多个私人计划；顺序、手动状态、名称/说明、归档/恢复与删除。删除计划不删除题目、训练、思路历史或复盘。每道题的多个会话独立展示。
- `/sessions`：从 CF 选题新建训练，查看与重新打开所有历史记录。已停止新建自定义题目，旧自建题与空训练继续可读。
- `/practice/[sessionId]`：官方题面链接、用户补充的题面上下文、思路笔记/版本与 AI 教练；未解题默认隐藏 Tags。计时可选且由服务器保存，网页无需常开。旧 C++ 草稿保留在可展开兼容区，Monaco 不进入主流程。
- `/reviews`：选择 CF 题目或关联旧训练，粘贴代码或读取显式选择的单个 .cpp/.cc/.cxx/.txt（UTF-8、64000 字节、类型/控制字符校验）。明确确认自报 AC 与发送 Provider 授权，保存代码快照，生成/编辑/重生成/追问。代码、题面与近期复盘在调用时发送给配置 Provider；请先清除敏感内容。
- `/dashboard`、`/analytics`、`/settings`：真实记录与明确空状态；不制造统计/Rating。`/login`、`/register` 与邮箱验证恢复安全目标。

复盘九项分析：算法总结、正确性证明与未证明假设、时空复杂度、具体行号、边界/潜在缺陷、实现改进、可选其他算法、可迁移知识和复习问题。每份分析绑定不可变 SHA-256 代码快照；改代码创建新复盘。通过 reviewId 恢复，用户编辑 CAS。AI 不宣称运行代码或系统验证自报 AC。公开提交状态也不能证明本地导入代码与提交源码一致。

## 数据与安全

增量迁移保持旧 Session/Thought/Code/Review；公共 problems 唯一外部键为 contestId + index（含 C1、长/纯数字 index），新题只允许经服务端验证的 CF 元数据。普通 JWT 无公共表 INSERT 权限。

服务端固定调用官方 problemset.problems，6 小时持久缓存、全实例 PostgreSQL 行锁/租约与 3 秒请求槽、60 秒手动/失败冷却、两次有界请求/退避与过期缓存回退。检索/分页执行于数据库，不逐次下载题库；页面显示真实成功同步时间。API 不返回完整题面，不把 Tags 当题面。官方依据：[CF API Help](https://codeforces.com/apiHelp)。

所有私人表 RLS、owner SELECT、窄 RPC 写入，SECURITY DEFINER 空 search_path、显式 auth.uid 归属。计划 revision/CAS 与 requestId 幂等；业务冲突 PT409，未知传输错误仍 503。字段白名单、长度、同源、safe errors；不记录秘密、SDK 原文或请求载荷。新自建/空训练普通用户 RPC 入口撤销；复盘内部历史兼容路径保留。

Tutor 单 Orchestrator 保持 L0–L5 服务端权限，L5 两个明确操作、绑定过期挑战；普通聊天不升级。allowedLevel 与单调 maxSeenLevel 分离。L0/L1 模型只能选择结构化事实与 focus，服务端模板针对无思路/卡点提问；L2+ 自动审核不能保证无剧透。比赛和完成训练在应用与数据库双重阻止 Tutor。

Review 单独 Prompt/审核/授权/分析记录，完整复盘不写入 AC 前提示历史。Tutor/Review 共享 UTC 入场额度与跨会话并发租约；HMAC 可信写入、输出先审核再展示，浏览器看不到 nonce/usage/raw output/内部推理。Provider usage 缺失 NULL，超时可能产生费用，不能冒充精确账单。安全 Markdown/KaTeX 禁 raw HTML、远程图片与危险资源。

## 检查与部署

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

先 typecheck 后 build，避免生成目录竞争。PGlite 执行实际 SQL/RLS，Auth 环境是替身；Playwright 运行真实 Next/SDK 与本地 HTTP/Provider Mock，不代表托管验收。记录的真实 CF 响应与实际实时下载另行标注。见 [本轮验收](docs/M3_VERIFICATION.md)、[里程碑](docs/MILESTONES.md)、[M1](docs/M1_VERIFICATION.md)、[M2](docs/M2_VERIFICATION.md)、[M2.5](docs/M25_VERIFICATION.md)，历史验收不改写。

外部 SQL smoke 仅允许显式隔离库：`M1_ALLOW_DATABASE_TESTS=isolated` 或 `M2_ALLOW_DATABASE_TESTS=isolated`，对应专用 TEST_DATABASE_URL 后运行 test:rls / test:rls:m2。禁止生产破坏性测试。Vercel/Node 部署先迁移并配置 Auth Site URL/Redirect URLs，CI 单独执行所有门禁。没有配置不创建外部项目或伪称集成成功。

需求与执行约定：[DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)、[AGENTS.md](AGENTS.md)、[CODEX_PROMPT.md](CODEX_PROMPT.md)。M4 计划知识沉淀、复习、真实统计和产品完善。
