# Codex 执行指令：AlgoPilot 学习与复盘助手

执行前阅读 AGENTS.md、DEVELOPMENT_PLAN.md、README 和 docs/MILESTONES.md 及所有里程碑验收文档，检查 Git 状态与 HEAD。保留用户修改与历史记录；先简短计划，直接实施，完成后提交独立 commit 并报告实际验收。

## 产品边界

核心为 Codeforces/XCPC 卡题启发式引导和 AC 后深度代码复盘。用户在本地 VS Code/C++ 编译器编写、运行、调试，在 CF 官网手动提交。工作台只有题面、AI 教练、思路笔记和历史版本作为主流程；计时可选、无需网页常开。旧代码字段/历史/接口保留在兼容区。不要开发在线编程、运行器、判题器或自动提交，不执行不可信代码，不引入 LangGraph/Redis/Qdrant/多 Agent。

## 必须保持的安全契约

Next.js App Router/TypeScript strict、shadcn/ui、Supabase Auth/Postgres/RLS、Zod、仅服务端 Provider。Auth 使用 SSR Cookie 与 getUser()，禁止信任 getSession() 身份。写接口验证 Auth、归属、来源、字段白名单、长度；用户 JWT + 受控 RPC，不使用管理员 SDK 绕过 RLS。SECURITY DEFINER 空 search_path，显式 auth.uid()，收敛 EXECUTE。SQL 只追加；业务冲突 PT409；错误与日志脱敏，不输出 SDK 原文、密钥、nonce 或内部证据。

未 AC Tutor 保留单 Orchestrator、L0–L5、L5 双明确操作、HMAC、UTC 配额、跨会话租约与幂等、比赛/完成双重拦截、允许等级/最高已看分离。普通聊天不升级、不进入复盘。L0 有思路时针对障碍追问，无思路时从题面/约束/样例事实开始；L0/L1 受限模型选择 + 服务器模板，避免重复。L2+ 自动审核不能保证不剧透。不能输出模型内部推理或未审核 token 流。

AC 复盘用独立 Review Orchestrator/Prompt/审核/记录，用户明确确认自报 AC 与发送代码给 Provider，事务记录进入状态与授权。未完成训练进入完整复盘后关闭 Tutor；复盘内容不回写 AC 前提示历史。比赛模式始终禁止 AI。

支持粘贴与单文件 .cpp/.cc/.cxx/.txt 读取，校验类型、64000 字节上限、UTF-8 和控制字符；不读取其他文件。发送前显著说明代码/题面/近期复盘发往配置 Provider，提醒清除敏感内容。代码/文件名纯文本安全展示。每份分析绑定不可变代码/hash；修改源码创建新复盘。保存结构化算法总结、正确性证明摘要/未证明假设、复杂度、具体行分析、风险/边界、实现改进、可选其他算法、知识点和复习问题，以及模型/Prompt/时间/用户编辑。允许保存、编辑、重新生成、追问，编辑 CAS，保留生成历史。不运行代码、不宣称自报 AC 已被系统验证；不确定时明确说明。

## 阶段

- M0/M1/M2：既有功能回归，历史验收不改写为新结果。
- M2.5：工作台简化、无思路与具体卡点引导、AC 复盘基础（当前阶段）。
- M3：CF 元数据/提交结果/Rating 同步，白名单/限流/分页/退避/增量去重。官方 API 不提供完整题面或提交源代码。官方 AC 不证明本地代码与源码一致，公开 Handle 不证明账户归属。
- M4：知识沉淀、复习、真实统计、产品完善、隐私/部署与真实服务验收。

禁止假统计/Rating/成功集成。Mock Provider 仅测试注入，生产无假回复开关。Provider usage 缺失 NULL，超时可能有费用，不宣称账单准确。

## 必须验收

运行 npm run lint、npm run typecheck、npm run test、npm run build、npm run test:e2e。先 typecheck 后 build，避免生成类型目录竞争。保留自动化测试并补充文件校验、无思路连续引导、复盘授权/快照/独立记录/刷新/编辑/追问、两用户数据库隔离、签名防伪/共享额度与租约。PGlite 真实 SQL 的 Auth 上下文仍是替身，Playwright HTTP 夹具也不是托管验收。外部 RLS 只能专用隔离库，禁止生产破坏性测试。

更新产品需求、README、AGENTS、界面文案与里程碑。最终报告 commit、检查实际结果、迁移部署要求、托管与真实模型未验证项。无外部配置时继续完成可独立开发部分，不伪造联通。
