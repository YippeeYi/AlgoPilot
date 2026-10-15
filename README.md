# AlgoPilot

Codeforces / XCPC 算法竞赛学习与复盘助手，只聚焦三件事：推荐合适的题并解释原因、分析题目与代码、从真实证据分析选手能力。CF 已做好的排行榜、比赛展示和提交浏览不重复开发。用户在本地 VS Code 编写、编译、调试，在 Codeforces 官网手动提交；AlgoPilot 不执行代码，不提供在线判题或自动提交。

当前交付 **M3.3：官方解题证据与能力画像融合**，建立于 M3–M3.2.2 之上。原分级教练、代码快照、深度复盘与多计划保留。可主动关联公开 Handle、分页同步提交结果并单独授权用于分析；公开关联不验证本人身份，官方 OK 不证明独立完成或源码一致。不开发提交列表或 Rating 历史图表。

## 运行

需要 Node.js 24.15+（24.x LTS，或 26+）与 npm。

```bash
npm ci
cp .env.example .env.local
npm run dev
```

设置 Supabase 项目 URL、publishable key 和 APP_URL，获得目标环境授权后按顺序应用缺失的 001–010 迁移；只执行目标环境缺失的 SQL。Auth 使用 SSR Cookie、proxy 刷新与服务端 getUser 验证。没有配置时仅提供无数据页面壳和公开 `/practice/preview`，不会伪造登录或启用 AI。

CF 签名默认从已有 Tutor 独立主密钥派生，也支持单独 `CODEFORCES_RPC_SIGNING_SECRET`。配置不等于连接验证。具体见 [M3 配置](docs/M3_SETUP.md)、[Supabase 设置](docs/SUPABASE_SETUP.md)、[M2 Provider](docs/M2_SETUP.md)、[M2.5 复盘配置](docs/M25_SETUP.md)。密钥仅在服务端/private DB，禁止 service-role 绕过。

## 使用流程

主入口为推荐、能力画像、题目分析/复盘；题库/计划/历史/账户为辅助入口，旧深链接全部保留。

- `/dashboard`：简短难度自评（不必关联 Handle）、可选主题/目标、每轮最多 5 题，推荐理由与训练/复盘/反馈引用，官方读题/原教练/加入现有计划/反馈/换一轮。复盘证据需额外主动授权，可关闭。
- `/analytics`：同一证据模型分析知识方向、难度表现、实际提示依赖和复盘问题；附样本/来源/可信度，不生成综合能力分或假官方 Rating。

- `/problems`：官方题库缓存，题号/题名/URL 检索，Rating 范围、Tags 筛选、解题人数排序与分页。缺失难度显示“未定级”。单选开始训练，多选跨页保留并创建或追加计划。
- `/plans`：多个私人计划；顺序、手动状态、名称/说明、归档/恢复与删除。删除计划不删除题目、训练、思路历史或复盘。每道题的多个会话独立展示。
- `/sessions`：从 CF 选题新建训练，查看与重新打开所有历史记录。已停止新建自定义题目，旧自建题与空训练继续可读。
- `/practice/[sessionId]`：官方题面链接、用户补充的题面上下文、思路笔记/版本与 AI 教练；未解题默认隐藏 Tags。计时可选且由服务器保存，网页无需常开。旧 C++ 草稿保留在可展开兼容区，Monaco 不进入主流程。
- `/reviews`：选择 CF 题目或关联旧训练，粘贴代码或读取显式选择的单个 .cpp/.cc/.cxx/.txt（UTF-8、64000 字节、类型/控制字符校验）。明确确认自报 AC 与发送 Provider 授权，保存代码快照，生成/编辑/重生成/追问。代码、题面与近期复盘在调用时发送给配置 Provider；请先清除敏感内容。
- `/settings`：公开 Handle 关联/替换/解除、首次/增量/断点同步、官方证据授权与删除；仅展示覆盖状态。配置状态不代表外部联通。`/login`、`/register` 与邮箱验证恢复安全目标。

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
npm run test
npm run test
npm run test:e2e
```

先 typecheck 后 build，避免生成目录竞争。PGlite 执行实际 SQL/RLS，Auth 环境是替身；Playwright 运行真实 Next/SDK 与本地 HTTP/Provider Mock，不代表托管验收。记录的真实 CF 响应与实际实时下载另行标注。见 [本轮验收](docs/M32_VERIFICATION.md)、[推荐算法/配置](docs/M32_SETUP.md)、[M3 历史验收](docs/M3_VERIFICATION.md)、[里程碑](docs/MILESTONES.md)、[M1](docs/M1_VERIFICATION.md)、[M2](docs/M2_VERIFICATION.md)、[M2.5](docs/M25_VERIFICATION.md)，历史验收不改写。

外部 SQL smoke 仅允许显式隔离库：`M1_ALLOW_DATABASE_TESTS=isolated` 或 `M2_ALLOW_DATABASE_TESTS=isolated`，对应专用 TEST_DATABASE_URL 后运行 test:rls / test:rls:m2。禁止生产破坏性测试。Vercel/Node 部署先迁移并配置 Auth Site URL/Redirect URLs，CI 单独执行所有门禁。没有配置不创建外部项目或伪称集成成功。

需求与执行约定：[DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)、[AGENTS.md](AGENTS.md)、[CODEX_PROMPT.md](CODEX_PROMPT.md)。M4 计划知识沉淀、复习、真实统计和产品完善。

## 推荐与画像的依据

确定性权重集中于 `src/features/learning/engine.ts`：难度适配、真实提示/自报待加强信号、明确目标、近期重复与新颖度、当轮多样性、活跃计划降权、反馈，以及低权重 AI 建议。数据库过滤和分层取最多 600 候选；不是全库最优保证，不推荐缺 Rating 的题。有主题则要求可信 Tags 匹配，默认隐藏未解题 Tags。

画像取最近 500 次训练、每题最新完成记录；不同题目不足 5 为样本不足，更多也只有限可信。无提示不证明独立。复盘每题最新、最多 200，词汇匹配只是 AI 待验证建议；思路版本只计实际记录，不按文字量评估思考质量。官方提交、自报、实际提示与 AI 推测分栏；公开账号 OK 的独立性仍未知。

部署新增 `supabase/migrations/202610140007_learning_recommendations.sql` 与 `202610140008_recommendation_audit.sql`，先核对 006 已应用，勿重跑历史 SQL；本轮没有部署托管 007/008。无需额外服务/模型/密钥，旧 HMAC、RLS、额度和租约继续保留。参见 [M3.2 设置与局限](docs/M32_SETUP.md)。

## M3.2.1 评测

`npm run test:recommendations` 使用仓库内 11,450 题的官方元数据录制和八类合成选手历史，生成确定性断言；设置 M321_EVALUATION_OUTPUT 可导出结果/人工评审 CSV。原生隔离 PostgreSQL 使用测试目录运行时和显式开关，详见 [设置](docs/M321_ISOLATED_SETUP.md)。不增加生产数据库依赖。

追加 008 修正等价 Tags 顺序、新旧比赛和已计划候选饥饿偏差；修正中位数、反馈实际变化、评分理由、否定 AI 提及、A/B/A 反馈与在途授权撤销。权重和分析窗口未扩展。完整依据、性能与 M3.3 边界见 [评测报告](docs/M321_RECOMMENDATION_EVALUATION.md)，[人工评审表](docs/M321_MANUAL_REVIEW.md) 尚待人填写。本轮未执行 007/008 生产部署，目标库实际状态待核对；原生隔离和 HTTP Mock 不是托管 JWT 验收。

## M3.2.2 评审与适配

追加 009 在 600 候选预算前排除 interactive 与有官方来源确认的非 C++ 语言比赛；不全局排除 special。deterministic/1.2 用小型可追溯标注区分核心/Tags-only/相关任务，主权重与难度模型不变。数据库未安装 training-fit/1 时推荐返回安全 503，需要授权后的缺失迁移核验。

`npm run review:recommendations` 校验并汇总原 40 条 AI 初评与独立真人覆写，默认保留审计历史；AI 33/2/5 不是真人验收，真人仍 0/40。`M322_EVALUATION_OUTPUT=docs/m322 npm run test:recommendations` 重放八类合成选手与 11,450 题录制，原人工表不覆盖。实测对照、来源与未验证项见 [M322 报告](docs/M322_RECOMMENDATION_REVIEW.md)。本轮无生产变更，匿名目标探测不能证明 007/008 的完整部署，真实 JWT/收益仍待验。

## M3.3 官方证据

新增 010（001–009 不改），复用用户 JWT、CF HMAC 和 PostgreSQL 全实例时隙。user.info 校验当前 Handle；user.status 不采集源码，200 条/页、40 条重叠、实际 EOF/断点、高水位与持续旧 Verdict 重扫。绑定默认关闭分析，撤销后新画像/推荐不使用官方信号，更换/删除清除个人关联数据及派生依据。原计划、训练、提示、复盘不回写。

deterministic/1.3-official 保留原难度模型和主权重。全历史已知 AC 在 600 候选前排除；画像另取最近 500 道官方 OK 题补充覆盖，近期同难度覆盖影响原新颖度/探索因素。没有独立性证明、WA 次数能力判断、综合能力分或自动升难度。

真实公开 API 录制、隔离数据库、回归及未验收边界见 [M33 验收](docs/M33_VERIFICATION.md)；迁移/密钥/恢复见 [M33 设置](docs/M33_SETUP.md)。007–010 托管状态未核实，本阶段没有生产变更。原 40 条 AI 评审与真人分离，真人仍 0/40；五道替代题列于 [待评审表](docs/m33/replacements-for-review.csv)，真人 0/5。

## M3.4 验收与推荐研究

本轮不扩展 M3.3 功能或调整 deterministic/1.3-official。专用 Supabase 测试项目尚未就绪，真实 JWT/远端写入与部署仍待授权；只读核验 SQL、实际公开 YippeeYi 取证、本地/原生隔离结果见 [验收矩阵](docs/M34_ACCEPTANCE.md)。原生多连接不等于跨应用实例。

[推荐研究方案](docs/M34_RECOMMENDATION_STUDY.md) 提供五题评审包、等约束 Rating/Tags 基线、成对 AB/BA 顺序与私有记录模板。真人仍 0/40、替代题 0/5、真实参与者 0；AI 复核和合成对照不代表教学收益。离线脚本只在真实同意后准备材料，不联网或发送模型。
