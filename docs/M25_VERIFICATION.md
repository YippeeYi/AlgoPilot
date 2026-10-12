# M2.5 验收记录

日期：2026-10-12（Asia/Shanghai）。基线 HEAD `4d5f8c0`，开始工作区干净。已阅读产品要求、执行指令、README、AGENTS 和 M0/M1/M2/兼容修复/真实验收里程碑记录。旧验收文档保留原始结果，新范围以 DEVELOPMENT_PLAN.md v2.0 为准。

## 交付

- 工作台主流程为题面、思路笔记/版本、AI 教练；旧代码兼容区保留查看、保存和刷新恢复。无 Monaco 主流程或在线执行；保留旧数据库字段/记录/接口。新 UI 默认不计时，可主动开始/暂停，计时不要求网页常开。
- L0 无思路时引用用户提供的题面事实、循序提问；已有思路的重复回答换追问模板。L0/L1 保留受限模型输出/服务端模板，L0–L5、双确认、比赛/完成拦截不削弱。
- 单文件/粘贴导入 C++，类型/64000字节/UTF-8/控制字符校验，文件只在浏览器读取。明确自报 AC 与 Provider 授权、可选本人训练关联/CF 白名单 URL/提交 ID，代码不会运行。创建快照与生成 AI 是两个明确操作。
- 独立 Review Orchestrator、Prompt、九项结构化分析/具体行范围审核；模型结果通过用户 JWT/HMAC RPC 保存，nonce、raw output 和内部推理不返回。已知配置秘密在输入阶段阻止发送，解码后的输出也检查秘密。
- 不可变代码/hash/来源、授权时状态/结果/等级、模型/Prompt/时间、用户编辑 CAS、重新生成与追问历史。reviewId 链接刷新恢复，不回写 Tutor 消息/提示事件/最高已看等级。
- 005 追加迁移与 RLS/只读列授权；Tutor 和 Review 共用数据库 UTC 入场额度、用户并发/幂等/租约。未完成训练确认进入复盘后事务完成；旧已完成训练结果和历史不重写。
- 更新 README、AGENTS、产品需求、执行指令、界面文案、里程碑与 M2.5 配置/API。后续 M3 为 CF 元数据/提交结果，M4 为知识/复习/真实统计/产品完善。

## 最终命令结果

| 命令 | 实际结果 |
| --- | --- |
| `npm run lint` | PASS，0 error / warning |
| `npm run typecheck` | PASS，Next typegen + strict TypeScript |
| `npm run test` | PASS，18 文件、167/167，无跳过 |
| `npm run build` | PASS，Next 16.4 Webpack，3 个新增复盘 API 路由；客户端扫描无活动 Monaco/过期 sanitizer |
| `npm run test:e2e` | PASS，34/34，最终30.1秒；桌面/移动 Chromium、本地 HTTP 替身 |
| `git diff --check` | PASS |

没有添加依赖或改锁文件；移除 predev/prebuild 的 worker 复制，保留旧 Monaco 模块/依赖及安全 alias，主流程不引用它。postbuild 仍拒绝旧 DOMPurify；若未来重新打包 Monaco，仍要求补丁存在。

## 验证范围

新增7项真实本地 PostgreSQL/PGlite 测试执行001–005正式迁移、RLS、GRANT、SECURITY DEFINER、HMAC、约束和 RPC：

- 无身份/跨用户/比赛与无明确授权拒绝；文件来源/无效文本被数据库约束拒绝。
- 快照/hash 不可改；原状态/结果/等级记录，AC 后关闭 Tutor；旧代码与思路历史可读，幂等重用不同内容 PT409。
- 两用户对新表读取隔离、直接 DML/伪造分析拒绝、nonce/usage 不可读；错误签名/nonce拒绝。
- Review→Tutor、Tutor→Review 的跨会话并发与每日共享额度；失败计额度。
- 成功幂等缓存；分析只在独立记录，Tutor 消息/hint_events 不增；用户编辑 revision 防覆盖。
- 租约过期不展示分析，失败请求不能重放；未知 usage 不伪造。
- 新训练默认暂停/零秒，重新打开与请求重试不暂停已手动恢复的训练。

新增单测/Route Handler 测试覆盖文件扩展名、MIME、字节数、UTF-8、二进制/空文件/控制字符、CF URL 白名单、Auth/归属/同源/字段白名单、无 Key、独立 Provider JSON 契约、输出所有字段/行范围/执行声明/秘密/额外内部字段审核、快照 Prompt、缓存不调用 Provider、失败结算和 L0 无思路连续性。原149项单元/集成测试继续通过；因明确移除主流程编辑器，原浏览器 Monaco 断言替换为“不加载 Monaco + 兼容文本区持久化”，其余历史/权限断言保留。

新增4项桌面/移动浏览器测试覆盖文件导入、明确确认、暂停训练关联、生成/编辑/重新生成/追问、刷新自动恢复、代码快照不变、AC 前提示记录不增加、结束 Tutor、编辑冲突、另一用户404、拒绝坏文件/字段/比赛、L0 连续提问。原30项浏览器回归继续通过。复盘页两种尺寸无页面横向溢出、无 pageerror；已实际查看本地测试截图（内容显式 MOCK），不是设计图或真实模型评测。截图存放 `/tmp/algopilot-m25-m2-desktop.png` 与 `/tmp/algopilot-m25-m2-mobile.png`，不包含凭据或真实用户学习记录。

## 首轮发现与修正

- PostgreSQL 的 authorization 关键字导致新增迁移无法执行；改为 authorization_event，完整迁移重新执行通过，没有跳过 SQL 测试。
- 引用 `<` 经 Markdown 转义，测试改为核对安全转义后的文本，没有放宽输出审核。
- 首轮 E2E 在受限沙盒无法监听本地端口；经允许的本地服务器/浏览器执行权限重新运行。首次有效运行31通过/3失败：错误区与 Next announcer 匹配冲突，同一代码 hash 的多份复盘按钮不能区分。增加错误区可访问名称、复盘 ID/时间标签并明确测试自动刷新恢复；最终34/34，没有 skip。
- 文件名 NULL 的 PostgreSQL CHECK 三值逻辑被补严；文件来源要求非NULL名称。新增校验解码后的秘密，避免 JSON Unicode 转义绕过。
- 期间 lint 发现控制字符 regex 与测试参数未使用；改为字符码检查与类型化 fetch mock，最终 lint/typecheck通过。生成的 next-env.d.ts 不作为业务改动提交。

## 未验证与限制

本轮未连接托管 Supabase、部署005迁移、调用真实模型、调用 CF、注册外部账号或执行用户 C++。没有用真实用户库进行破坏性测试。PGlite 是真实 SQL/RLS，但 auth.uid() 由上下文夹具提供、单连接不能证明多连接锁竞争；Playwright 的 Auth/Provider/数据库为本地 HTTP 替身，不能报告为托管集成成功。

仍需专用环境验收005部署、真实两用户/多连接共享额度与并发、Auth 刷新、真实 Provider 的九项分析质量/费用/取消/未知 usage。此前 M2 的真实 Gemini/托管事实见旧验收记录，不移作本轮复盘验收。自动审核不能保证证明正确、所有语义声明可靠或零剧透；L0 模板有限，真实针对性与连续教学需人工评测。

当前仅用户自报 AC，官方 Verdict=NULL，源码匹配=unverified。CF API 不提供提交源码；未来官方 AC 也不能证明本地导入代码匹配或独立完成。当前代码可保存上限64000字节，模型字符预算可能更小；超限413，不截断。列表最多100份、每份显示最近30份生成记录，数据库保留全部；分页/知识沉淀/复习属后续产品完善。用户未保存内容仅页面内存，提醒不能保证强制关闭后恢复。关闭网页不会自动暂停已手动启动的计时。

最终 commit 由交付回复给出，避免文档自引用 SHA。
