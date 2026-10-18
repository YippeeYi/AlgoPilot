# M3.5.3 真实 Provider 盲测：两次获批 A 均超时

2026-10-18（Asia/Shanghai）。准备阶段实际基线 **afbe51a**，初始工作区干净；其后提交 **df6bcd2** 保存准备记录。用户随后明确批准一次 A，本次从干净的 df6bcd2 执行，唯一 HTTPS 发送尝试在 60 秒后 **LLM_TIMEOUT**，未记录 HTTP 状态、模型正文或 usage，已停止且无重试。**调用失败，教学质量/反例/真实输出审核 NOT_RUN，M3.5.3 尚未通过。** 下述第 1–7 节保留准备时的授权和测试快照，获授权后的实际结果以第 8 节为准；不把历史“未授权、零费用”沿用于本次超时。

最新追加：基线 **0c8d44e** 的第二次 A 已另获明确批准，**1 次新发送、0 重试**，110 秒单次计时取消（Provider 耗时 **110151 ms**）；日志确认 DNS/TCP/TLS 完成且请求写完，直到取消仍未观察到响应头、正文 0 字节。用量/实费 UNKNOWN，教学质量与输出审核 NOT_RUN。第 9 节解释旧观测边界，第 10 节记录这次 A2；两次均为各自独立授权，不是一次请求的自动重试，未执行 B 或追加第三次。

## 1. 变更和授权边界

仅新增本报告及脱敏 [preparation.json](m353/preparation.json)，向 [M35_REAL_WORLD_ACCEPTANCE.md](M35_REAL_WORLD_ACCEPTANCE.md) 追加第 14 节。没有修改业务代码、Prompt、输出审核、依赖、推荐权重、同步算法、数据库迁移或配置。

本轮获得的是只读检查、本地材料准备、已授权固定夹具的离线验证；**未获得新的 Provider 内容发送、调用次数和费用上限授权**。既有生产同步/授权开关范围已结束，不能沿用。实际为 **0 次真实模型请求、0 次 CF 同步、0 次远端业务读取/写入、0 次部署/迁移**；只读取了本地白名单配置，没有输出 API Key、JWT、Cookie 或 HMAC。

## 2. 双轨设计与可复现材料

### A：纯净诊断（材料就绪，未发送）

两份文件均存在，SHA-256 与 M352 一致，仍由 `.gitignore` 精确忽略：

| 来源 | 行数 / 字节 | SHA-256 |
| --- | --- | --- |
| 用户提供完整 DFS AC：`tests/fixtures/reviews/615b_ac_user_supplied_dfs.cpp` | 52 / 858 | `28c1536662ec4497cc94afe96b3888a5a6ff240f76eb1b380a523dbf9530a91b` |
| 用户提供完整 WA：`tests/fixtures/reviews/615b_wa_user_supplied.cpp` | 58 / 998 | `b66ccdbe1e2804e6013eba55ba801d90398876dd5f3c31c3a373108b02aced63` |

它们是用户提供并规范化的源码，不是 CF 下载源码，不保证与历史提交逐字节一致，也不是生产 40 行迭代 DP 快照。源码、源码副本及二进制均不提交或发布。

使用未改动的 `buildReviewPrompt`：DFS AC 放入仅用于本地构造的快照输入对象，WA 放入追问，绝不创建生产快照。必要题意仅含简单无向图、严格递增路径、美丽值定义、输入范围与格式，没有算法、反例或诊断答案。任务要求比较实际控制流程、判断错误/触发条件、尝试反例、静态推导两份输出、最小修复及说明未执行。

封存请求共 **2 条消息（system/user），history=[]，消息内容 4020 字符**；追问 1183 字符，通过生产 `reviewRequestSchema` 的 3000 字符限制。builder 按 `split("\n")` 得到 AC `lineCount=53`（文件末尾空行），没有为 WA 扩张行号。正式请求仅加载封存消息，禁止加载本报告、用户附件全文、M351/M352 评审 key、已知反例、预期输出、个人评价或既有生成历史。现有系统提示内的通用诊断要求完整保留。只保证请求上下文不含评审答案；无法控制模型预训练知识。

### B：产品真实流程（BLOCKED，不计入拟议调用）

生产 40 行快照已知哈希为 `fc6f94db826fe1d1cba686aeb2a90c963fa8040e77487cfadea3585667d8c460`，本轮没有读取/导出其正文或历史分析；当前准备包没有该源码。**不能拿 DFS AC 替代它，声称真实产品轨通过。**

已有 PGlite 隔离数据库和 Review SQL 测试可用，隔离能力没有缺失；阻塞项是本地缺少该实际快照及对应的隔离产品评估准备。可在用户提供/允许本地只读取得该快照后，核对哈希，在隔离库建立独立评估上下文、以真实 `runReview` 和窄 HMAC reserve/finish 保存结果，再检查展示。原生产记录不动，历史为空的首次追问结构与已有历史的实际追问须分栏，不能混称同一上下文。真实 Auth/JWT/PostgREST 与浏览器展示也须单独验证。

本轮 41 项本地契约测试包含 SQL 快照/权限/结算，但不是 B 的真实模型或生产端到端验收。A 不调用 reserve/finish，不能证明生产持久化、Auth、RLS 或 HMAC 链路通过。

## 3. 本地准备检查

一次性本地准备程序位于 `/private/tmp/algopilot-m353-prep/prepare.cjs`，没有加入产品或新增评估框架。它转译加载仓库当前 TypeScript 模块，在本地测试环境屏蔽 `server-only` 标记并禁止默认 fetch；用注入的本地 transport 捕获 **现有 `OpenAICompatibleProvider` 实际构造的请求体**，不手写第二套 Provider/JSON Schema，也不执行真实 HTTP。

已核对严格 `ac_review` JSON Schema、`stream=false`、当前模型/预算、无工具参数、空历史、输入哈希及已知评审片段不进入上下文。没有用合成响应给模型质量打分。固定片段检查只是辅助，独立性还依赖材料来源隔离，不能把字符串匹配当作完整语义防泄漏证明。

原 Provider 仅在首次 429/503 时可能重试一次。评估侧使用独立 AbortController，在首次 HTTP 失败即终止整个调用；本地 429、503 捕获测试均只进入 transport **1 次**，外部发送 **0 次**。取消在现有 Provider 内映射为 `LLM_TIMEOUT`，因此评估账本另保留首个 HTTP status/终止原因，不能把主动停测误记成真实服务超时。生产 Provider 的重试逻辑未改。

请求材料目录为 `/private/tmp/algopilot-m353-private-zKMbiu/`（目录 0700、文件 0600）：

- `A-request.json`：完整待批准请求体，包含私有源码，无 Authorization。
- `A-local-review-input.json`：仅本地的 AC 对象与 WA 追问，不是数据库记录。
- `preparation.json`：脱敏配置、来源/请求/Schema 哈希及本地检查结果。

仓库只保存脱敏 manifest；临时目录可能被系统清理，重建时须复核源码和请求哈希。规范化请求体 SHA-256 为 `35a03143e59c313c920333c7adb46ef28d58820eded7ec01595c0f3655864efb`；消息 SHA-256 为 `94daa27e03d5dbcb38b52a93e80ed15e0d5f4fb4d907a6609da3575ff3d97be1`。

## 4. 待批准的真实调用方案（尚未授权）

为遵守“首次失败即停止”，本轮建议先只批准 **1 次 A**；B 留待实际快照材料和隔离流程就绪后另列方案。两次的建议数量不是必须凑满的目标。

| 项目 | 精确范围 |
| --- | --- |
| Provider / 模型 | Google Gemini Developer API，经现有 `openai-compatible` 实现；准确 ID `gemini-3.8-flash` |
| Endpoint | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` |
| 发送内容 | 当前 Prompt 1.1.0、必要题意/约束、完整 DFS AC 858 字节、完整 WA 998 字节、中立追问、代码哈希；不含账号标识、生产记录、历史分析或评审答案 |
| 上下文 | 新独立请求，system + user，history=[]；不发送当前 Codex 对话 |
| 输出与格式 | `max_completion_tokens=4096`、`reasoning_effort=low`、`response_format=json_schema` 且 strict `ac_review`、`stream=false`；不启用工具/搜索/执行/显式缓存 |
| 次数 | 最多 **1 次生成 HTTP 发送**，**0 次外部重试**；不额外请求 countTokens/listModels，不自动补跑 |
| 停止 | 60 秒请求超时；首次 HTTP/网络/契约/审核失败或教学质量失败即封存并停止；禁止再发请求。未知费用不因超时归零 |
| 请求完整性 | 执行前核对基线相关源文件、当前配置、夹具/消息/Schema 哈希；有变化重新列计划，不能悄然扩大范围 |
| 费用上限提案 | **USD 1.10 模型 token 费用上限，未获批准**；下述为保守估算依据，不是账单承诺，未含税费/汇率 |
| 原件保存 | 同一私有目录预留 `A-first-output.txt`、`A-usage.json`、`A-audit.json`，0600、首次写入独占创建，记录 SHA-256；当前均不存在 |
| 外部传输 | 两份完整私有源码会发送给 Google；此前本地测试许可不涵盖本次发送。账户是否付费/Contributor 及其数据使用条款本轮没有核验，不能承诺不被用于服务改进 |

### 费用依据与限制

2026-10-18 已查 Google 官方 [定价](https://ai.google.dev/gemini-api/docs/pricing)：当前 Standard 的 Gemini 3.8 Flash 输入 **USD 0.75/百万 token**、输出（含 thinking）**USD 3.75/百万 token**，公布适用至 2026-12-31。不是把 API 当免费服务；账户实际层级、税费与账单未知。

当前本地输入/输出价格配置均为空，且现有 Gemini Provider 特意不自动计算费用；实际 usage 缺失保留 NULL，`costUsd` 也保留 NULL，不把单价估算冒充实账。批准后单列原始 token 数、按公开单价的估算和能够核实的实际费用。

[官方模型规格](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) 的模型输入/输出上限为 1,048,576 / 65,536。为不把“字符约等于 token”当硬上限，以整个模型上限估算单次最保守 token 费用：

`(1,048,576 × 0.75 + 65,536 × 3.75) / 1,000,000 = USD 1.032192`，向上列 **USD 1.04**；拟批准上限 USD 1.10。若服务端确实执行请求的 4096 输出预算，对应保守额为 USD 0.801792；实际短文本通常远小于这个全上下文估算，但本轮没有 tokenizer 实测，不能给精确实费。

[官方兼容接口说明](https://ai.google.dev/gemini-api/docs/openai) 当前没有明确列出本地所用 `max_completion_tokens` 参数的映射。保留现有真实配置，不据猜测修改；该参数的真实接受/限额行为属于待测项。因此费用保守额采用模型完整输出上限，而非承诺只按 4096 结算。若调用失败、输出截断或超出预算，保留首轮事实并停止，不切参重试。

定价页面同时区分免费与不同付费层的数据用途。若用户只允许特定数据处理条件，执行前须由用户确认相应账户设置；不要求提供密码、Token 或密钥，不读取秘密。没有发送授权前，源码留在本机。

## 5. 输出封存、审核与独立验证协议

当前原始模型分析 **不存在**，不得填入 Mock 分析冒充成绩。批准后的顺序是：

1. 受控 transport 仅允许一次 HTTP，绑定精确 endpoint/封存 body；不记录 Authorization/请求头。限长响应中只提取首个 assistant 文本、模型 ID、公开 usage 和必要状态；不存内部 reasoning 字段、密钥或原始敏感 SDK 错误。若内容命中已知秘密，仅保留哈希/固定拒绝原因，不公开或继续传播原文。
2. 在审核前封存首轮 assistant 文本及哈希到上述私有文件，拒绝覆写；输出可能引用私有源码或包含错误结论，不提交仓库、不直接展示。使用当前 `auditReview` 和原 AC 行数审核，保留四类固定拒绝原因。有效 JSON 但错误的算法/反例归为教学 FAIL，不能归为接口错误。
3. 按真实 Provider 契约保留每次 usage（缺失 NULL）与耗时/结果。响应未通过 Provider envelope/finish_reason/预算检查时，记录“Provider 契约失败”；文本经审核拒绝时记录审核类别；不得当作成功保存。失败原件可在受控本地复查，生产不新增原始输出日志。
4. 首轮封存之后，评审者才读取 M352 的独立标准。模型提出的输入及两个声明值抄入独立 `A-model-cases.json`，逐字保留边顺序，不修改模型反例来凑成功。运行：`npm run test:review-reliability -- --cases /private/tmp/algopilot-m353-private-zKMbiu/A-model-cases.json --output /private/tmp/algopilot-m353-private-zKMbiu/A-counterexample-verification.json`。
5. 工具只执行固定哈希的用户授权 AC/WA，校验输入后以独立路径枚举 oracle 比较。n>8 或资源/隔离不可用标 `unable_to_verify`，不能标 FAIL 或 PASS。逐项核对模型对控制流/状态的解释与静态值，即使反例触发也不自动判错误解释正确。
6. A 只有本地输出/审核，不写数据库。B 必须另走隔离 `runReview` reserve/finish、回读与 UI 展示，不以 A 的本地文件冒充产品持久化。生产快照/训练/画像/推荐保持不动。

当前本地一次性程序仅具备准备/捕获能力，**没有真实调用入口**；批准后的 transport 保存/次数上限保护仍须按此协议完成并以本地替身检查后，才允许该唯一真实请求。不会因程序存在就自动调用或沿用旧授权。

## 6. 本轮实际测试

| 本轮实际命令 / 检查 | 结果和边界 |
| --- | --- |
| `git status --short` / `git log -1 --oneline` | 初始干净、afbe51a |
| `node /private/tmp/algopilot-m353-prep/prepare.cjs` | PASS；真实 Prompt/请求体复用、输入 Schema、空历史、哈希、429/503 首次失败停止；**0 网络发送** |
| `npm run test -- tests/unit/review.test.ts tests/unit/review-reliability.test.ts tests/unit/review-api.test.ts tests/unit/gemini-provider.test.ts tests/integration/review-database.test.ts` | **41/41 PASS，5 文件**；本轮重跑，含审核/来源行号/否定声明/失败结算、Provider 参数与 usage、PGlite 快照/RLS/租约 |
| `PYTHONPYCACHEPREFIX=/private/tmp/algopilot-m353-prep/pycache python3 -m unittest discover -s tests/offline -p 'test_m352*.py'` | **5/5 PASS**；输入、分类、oracle 与单向转移等离线合同 |
| `npm run test:review-reliability -- --output /private/tmp/algopilot-m353-prep/counterexample-verification.json` | PASS；完整固定源码重编译，禁网/禁 fork/RSS 探针通过；3 个控制、120 种边序、142 个小图顺序案例 |
| 私有目录/材料权限与源码哈希复查 | PASS；0700/0600，源码未跟踪，完整源码不进入 diff |
| 封存 JSON 独立哈希复算 / `git diff --check` | PASS；消息与请求哈希相符，真实输出文件尚不存在，文档无空白错误 |
| lint / typecheck / 全量 test / build / E2E / 推荐专项 / 原生 PostgreSQL 多连接 | **NOT_RUN**；本轮只有文档与脱敏清单，没有业务/工具代码变更，未把 M352 的历史数量充作新结果；已执行上述相关契约及原生固定 C++ 专项 |

新原生报告仍得到：旧反例 A 的 oracle/AC/WA **4/4/4**，旧反例 B **6/6/6**（历史模型声称 WA=4），用户控制 **9/9/6**；120 种边序为 WA=6 的 20 种、WA=9 的 100 种；142 例 AC 全匹配 oracle。这是对历史材料/验证工具的重新核对，不是新模型的反例成绩。

本轮原生报告与未改动的 `docs/m352/counterexample-verification.json` 逐字节一致，SHA-256 均为 `2385b1321e792c69abe0fb4b66bf7ff61d70d5c1c6da33e1fe997ce15afc3e61`；新报告保留在上述 /private/tmp 路径，没有覆盖历史文件。另只在本地核对了 M351 用户附件的 C++ 代码块及简单空白规范化哈希，未匹配生产 40 行快照，不能据相似代码补齐 B。

执行限制沿用 M352：macOS sandbox-exec 禁网、运行禁派生，运行 CPU 2 秒/墙钟 3 秒/父进程 RSS 抽样 256 MiB；不提供硬虚拟内存或完整进程树保证，不是通用恶意代码硬沙箱。没有增加生产代码执行通道。

## 7. 分维状态与后续门槛

| 验收项 | 状态 | 证据 / 缺口 |
| --- | --- | --- |
| 本地来源/新上下文/请求结构准备 | PASS | 封存请求及 manifest；无评审答案/历史输入 |
| 本地审核/持久化安全契约 | PASS | 本轮 41 项定向测试；不等于真实模型或托管通过 |
| 固定夹具反例验证工具 | PASS | 本轮原生重跑及 5 项离线测试 |
| 历史模型两个反例 | FAIL | 0/2 触发；历史结果保持，不是新版本结果 |
| 新 Prompt 真实调用、JSON/审核、用量 | NOT_RUN | 未获新调用授权；0 次，usage=NULL |
| 新模型算法理解 / WA 定位 / 最小修复 | NOT_RUN | 没有新输出，不沿用历史方向正确结论 |
| 新模型反例 / 输出数值 / 控制流说明 | NOT_RUN | 没有模型案例，不能以用户控制算通过 |
| 新模型不确定性表达 / 真实审核误拒 | NOT_RUN | 固定表达测试不能给线上比率 |
| B 实际快照 / 隔离保存 / 浏览器展示 | BLOCKED | 实际 40 行源码未在准备包，产品真实生成未运行 |
| 新版用户教学价值 / 泛化能力 | NOT_RUN | 尚无本人逐项评价；单题一次也不能估计总体准确率 |
| M3.5.3 完整验收 / M3.5 完整闭环 | BLOCKED | 真实模型、反例质量及真实教学反馈门槛未过 |

本轮新增 Provider token 费用 **USD 0（未发送请求）**；历史已发生费用仍未知，没有回填为零。Prompt 版本仍为 **algopilot-ac-review/1.1.0**，没有已证明的新产品缺陷，因而不修改 Prompt 或审核。

原推荐人工 **0/40**、替代题 **0/5**、个人训练反馈 **1**、既有代码复盘质量反馈 **1 例混合结果**不变。本轮新增真实教学评价 **0**；AI 的评审不能充当本人评价，不按解释看起来合理就判质量 PASS。

下一步：用户明确批准第 4 节的模型、完整源码发送、最多一次 HTTP、USD 1.10 上限及相应数据处理范围后，再完成受控 transport 本地检查并执行唯一首轮 A。失败就保留并分析证据，不追加收费请求；A 通过后停止为 615B 调 Prompt。B 材料齐备后另验真实保存/展示；再以用户下一道正常训练题按同样无答案输入和独立验证规则做泛化评估，样本不足只报告观察。

## 8. 获授权后的一次 A：真实发送尝试超时（2026-10-18）

### 8.1 授权、基线与发送前检查

用户在本对话中明确批准：仅 Google Gemini API / `gemini-3.8-flash`，仅封存的必要题意/约束与两份脱敏完整 DFS AC/WA，空历史、无根因/评价/反例答案，最多一次真实 HTTP、无可控自动重试、输出 4096 token、token 预算 USD 1.10，任何结果均停止；**不包括 B**。禁止生产写入、其他私有文件发送、公开源码/请求正文/原始日志及后续收费调用。此许可已消耗于本次发送尝试，下一次必须重新授权。

实核 HEAD **df6bcd2**、工作区干净；与 afbe51a 比较 Review/Provider/Schema 源码没有变化。两份夹具、重建 Prompt 消息、Schema 与封存请求体 SHA-256 均匹配。仅使用 `A-request.json` 的两条消息，不读取评审文件组装输入，也不发送当前 Codex 对话。Prompt 仍 **algopilot-ac-review/1.1.0**，未改写、补答案或追加用户历史。

发送前重新核对上述 Google 官方价格和模型上限，保守单次 token 估算仍为 USD 1.032192 < USD 1.10。Google 官方开发者论坛的 [max_completion_tokens 说明](https://discuss.ai.google.dev/t/gemini-max-tokens/98124) 将其定义为生成 token 上限；保留已批准的 `max_completion_tokens=4096`，不切换参数或扩大预算。服务端实际输出限额是否执行因无响应无法实测，本地仅确认请求严格携带该值。

### 8.2 实际参数与次数控制

| 项目 | 本次实际值 |
| --- | --- |
| 请求 Provider / model | Google Gemini API / **gemini-3.8-flash** |
| 响应 model | **未知**；没有响应，不能验证服务端实际模型身份 |
| Endpoint | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` |
| 参数 | `max_completion_tokens=4096`、`reasoning_effort=low`、`stream=false`、strict `ac_review` JSON Schema；无 tools/service_tier/历史 |
| Prompt / 输入 | **1.1.0**；原封存消息 SHA-256 `94daa27e03d5dbcb38b52a93e80ed15e0d5f4fb4d907a6609da3575ff3d97be1` |
| 请求体 SHA-256 | `35a03143e59c313c920333c7adb46ef28d58820eded7ec01595c0f3655864efb`，与准备时一致 |
| HTTPS 发送尝试 | **1**，应用可观察到的 HTTP 响应 **0**；是否到达 Provider **未知** |
| SDK / 应用 / 代理重试 | **0**；无 SDK、无代理 agent，应用 pause 被一次性评估侧替换为拒绝；未改变生产实现 |
| 时间（Asia/Shanghai） | 2026-10-18 **18:31:31.681 → 18:32:31.683**；Provider 记录 **60001 ms** |
| 结果 | **FAIL：LLM_TIMEOUT**；HTTP status 未知，模型正文未收到 |
| Token / 费用 | input/output/total **NULL**；Provider costUsd **NULL**；按 usage 估算 **NULL**；实际账单 **未知**，不能记为零 |

一次性执行器 `/private/tmp/algopilot-m353-prep/run-once.cjs` 复用当前 Provider/Prompt/审核代码，没有产品或仓库代码变更。真实发送使用 Node `https.request`，`agent:false`、不配置代理、无 SDK/redirect/retry；请求失败只结算本地状态，不重新连接生成请求。独占 `A-dispatch-consumed.json` 在连接前创建，进程内计数同时拒绝第二次发送；即使超时也不删除标记或重跑执行器。

执行器先以本地 200/429/503 transport 替身检查：各仅调用 1 次、第二次被阻止、429/503 不重试、200 原始文本保存与审核、禁止覆写均 PASS（真实网络 0 次）。随后执行唯一真实命令：

```bash
node /private/tmp/algopilot-m353-prep/run-once.cjs --execute-authorized-once
```

没有补充 countTokens/listModels/探测请求，没有在超时后通过其他工具重发，没有修改 Prompt 后再测。超时只证明本机观察不到成功响应，**不能据此认定模型质量差、API Key 无效、模型不存在、Google 拒绝或是哪一层网络故障**；不输出原始异常或敏感网络配置。无响应也不能证明 Provider 未处理或未产生费用。

### 8.3 原始结论、全部反例与审核结果

- **原始诊断结论：没有收到。** 没有替代文本，不从本地标准答案生成“模型分析”。
- **模型提出的全部反例：无可读取内容（收到 0 个）**。这不是“模型明确表示不能构造反例”，也不能据此给反例能力打 FAIL。
- 模型 WA 根因定位、控制流解释、正确/WA 输出、最小修复与不确定性表达全部 **NOT_RUN**。
- 模型反例的原生独立验证 **NOT_RUN**，没有模型输入可验证；本次不重跑已知控制来冒充新模型成绩。此前有效控制和历史两个无效反例仍只属于第 6 节及 M352 证据。
- Provider 请求完成 **FAIL**；JSON Schema 输出校验、`auditReview` 及四类拒绝原因 **NOT_RUN**，不是 `REVIEW_OUTPUT_REJECTED`，不记为审核误拒。
- 产品 B、数据库 reserve/finish、真实保存/展示、Auth/JWT/RLS/HMAC 本次 **NOT_RUN（不在授权内）**。

### 8.4 受控保存与实际回归

同一 0700 私有目录 `/private/tmp/algopilot-m353-private-zKMbiu/` 中新增以下 0600 文件，均以独占创建保存：

| 文件 | 内容 / 状态 |
| --- | --- |
| `A-dispatch-consumed.json` | 首次发送时间、最大次数、请求哈希；保留防重标记 |
| `A-execution.json` | 脱敏参数、时间、单次尝试/失败状态与未知 usage/费用；SHA-256 `454a6348cf0439663f41cd240e1ea1807f2723e4d615ede24ae0079d4a25b11c` |
| `A-usage.json` | 1 条 timeout 尝试，token/cost=NULL；没有伪造实际用量 |
| `A-audit.json` | Provider FAIL、审核 NOT_RUN、无输出哈希 |
| `A-first-output.txt` | **不存在**；没有原始模型正文可封存，不补造文件 |

执行器 SHA-256 `47064a4f9798e74ac9e5af4b6284334f247892790c3f6524380a46c8c5c3782a`。本地 transport 检查报告在 `/private/tmp/algopilot-m353-prep/transport-self-test.json`。私有请求正文/源码/执行器和原始日志均不提交。可提交的脱敏结果另存 [A-execution.json](m353/A-execution.json)，其中明确区分一次发送尝试、零确认响应和未知服务端处理状态。

| 本次实际检查（独立于准备阶段） | 结果 |
| --- | --- |
| `node /private/tmp/algopilot-m353-prep/run-once.cjs`（默认本地 self-test） | PASS；200/429/503、防重、原件不可覆写；0 次真实请求 |
| 上述带 `--execute-authorized-once` 命令 | 1 次发送尝试，60 秒后 LLM_TIMEOUT；执行器正常封存失败，**不代表 Provider 成功** |
| `npm run test -- tests/unit/review.test.ts tests/unit/review-reliability.test.ts tests/unit/review-api.test.ts tests/unit/gemini-provider.test.ts tests/integration/review-database.test.ts` | **41/41 PASS，5 文件**；18:31:38 本轮重新运行，非照搬准备阶段结果 |
| Python unittest discover（同第 6 节命令） | **5/5 PASS**；离线合同，不是本次模型反例验证 |
| 请求哈希 / 持久标记 / 私有权限检查 | PASS；只发送一次，未收到正文，0700/0600 |
| `git diff --check` | PASS |
| 全量 lint/typecheck/test/build/E2E/推荐专项/原生多连接 | NOT_RUN；没有仓库代码变更，没有重跑这些检查 |

### 8.5 本次验收结论

| 项目 | 状态 | 解释 |
| --- | --- | --- |
| 指定模型/输入/无历史/4096 请求参数 | PASS | 封存哈希不变；服务端模型及限额实际行为仍不可验证 |
| 单次尝试、防重与停止纪律 | PASS | 1 次、0 重试；许可已消耗，任何下一次另授权 |
| 本地预算保护配置 | PASS | 保守 token 估算低于 USD 1.10；实账未知，不伪报零费用 |
| 真实 Provider 请求完成 | **FAIL** | **LLM_TIMEOUT**，无 HTTP 响应 |
| 结构化输出 / 安全审核 | NOT_RUN | 无正文，不能称通过或误拒 |
| WA 根因 / 全部反例 / 输出 / 修复 / 不确定性 | NOT_RUN | 没有模型结论供评审 |
| 模型反例离线执行验证 | NOT_RUN | 没有收到可验证的反例 |
| B 产品端到端 | NOT_RUN | 本次未获授权；此前本地材料阻塞仍保留 |
| 本人教学评价 / 泛化评估 | NOT_RUN | 不提升任何真人计数，不计算统计准确率 |
| M3.5.3 完整验收 | BLOCKED | 新 Prompt 没有取得可评估的真实模型输出 |

已按授权停止。本次 **0 次 CF 同步、0 次生产读取/写入、0 次迁移/部署**。保持 Prompt、生产快照、推荐权重、原推荐人工 0/40、替代题 0/5 和既有真人反馈不变。下一步只能先由维护者在不触发模型请求的条件下排查网络/配置，再重新列出并取得下一次调用授权；不能把本许可自动留给“网络恢复后重试”。

## 9. ac79946 后的只读超时归因（2026-10-18）

### 9.1 范围与核心结论

本轮实际基线 **ac79946**、初始工作区干净。仅检查已有源码、一次性执行器、原请求的脱敏参数/哈希/日志、本地白名单配置和 Google/Node 官方公开文档，运行注入替身的本地合同检查，再追加本节。**新增真实 Provider 请求 0、生产读写 0、CF 同步 0、迁移/部署 0**；未运行真实执行器、未删除防重标记、未修改业务代码/Prompt/配置/输出预算或原始证据。公开文档浏览不携带源码或凭据。

**能够定位的直接原因：AlgoPilot Provider 的单次尝试 60000 ms AbortSignal 已触发，应用据此主动取消并归类 LLM_TIMEOUT。不能定位的深层原因：为什么该次请求未在 60 秒内完成，究竟等待在连接、上游处理还是响应体传输阶段。** 这不是 Google 返回的模型生成超时码，更不是模型教学质量 FAIL。

上节“没有 HTTP 响应 / confirmedHttpResponses=0”的表述需要收窄：**执行器只在整个响应体读完、wire Promise resolve 后才把 status 写入 ledger**。所以现有证据是“未取得完整响应、未记录 HTTP status/正文/usage”，不能排除已收到 headers 或部分 body。原账本保持不可变，本节纠正其观测含义，不补造响应阶段数据。

### 9.2 超时配置、信号与实际执行路径

| 层级 | 代码/实际值 | 归因 |
| --- | --- | --- |
| 本地 `LLM_TIMEOUT_MS` | 本轮当前环境**未显式设置**；`readTutorConfig` 对 gemini 默认 **60000**，通用默认 45000；配置校验范围 1000..120000 | 当前结果与原 manifest 一致；只能读取当前值，不把它当完整历史环境快照 |
| 原执行器构造参数 | `new OpenAICompatibleProvider(config, transport, 60000, noRetry)` | **显式第三参数锁定 60 秒**；原执行前还断言 config.timeoutMs=60000。仅改 `.env` 会先遇到旧断言，且不会自动改变第三参数，不是可直接重试的方案 |
| 单次尝试 | `provider.ts:193` 的 `AbortSignal.timeout(this.timeoutMs)`，与 lifetime 经 `AbortSignal.any` 合成，并传给 HTTPS | 60 秒从尝试开始计，包括连接、发送、等待上游及读完整正文，不是只计算模型生成 |
| 共享网络预算 | `min(120000, (deadlineAt ?? Infinity) - now - 50000)` | A 未传 deadlineAt，实际为 **120000 ms**，不是 60000；包含尝试和可能 backoff |
| 外部取消 | A 的 `complete(messages, undefined, {action,allowedLevel,outputKind})` | 没有用户/浏览器 `request.signal`，没有外部 AbortController 参与真实调用 |
| 路由 | Review route `maxDuration=180`，入口 `deadlineAt=now+150000`，向 `runReview` 传 request.signal | **A 没经过路由/Orchestrator/DB**，本次 60 秒不是路由 deadline，也不是数据库租约超时 |
| 产品路径预算（仅静态核对） | 若走路由，抵达 Provider 时入口已耗 t 秒，则共享预算至多 `100秒−t`；还预留 50 秒结算 | 将 HTTP timeout 提至 120 秒也不会得到完整 120 秒网络窗口；180 秒 route 配置不是模型可用时长保证 |
| 数据库 lease | 005 的 Review 请求 lease 默认 180 秒 | 本次没有 reserve/finish，不参与 A 取消；未访问托管数据库 |
| 实际耗时 | 18:31:31.681 → 18:32:31.683；usage.durationMs **60001** | 外层 60002 ms 与尝试 60001 ms 的差异来自记录位置，不是第二次尝试 |

源码证据：[单次/共享信号与错误分类](../src/server/tutor/provider.ts)、[配置默认](../src/server/tutor/config.ts)、[产品路由](../src/app/api/v1/reviews/%5Bid%5D/generate/route.ts)。Node 的 [AbortSignal 文档](https://nodejs.org/docs/latest-v24.x/api/globals.html#static-method-abortsignaltimeoutdelay) 说明 timeout 到期产生 abort，any 由最先取消的信号触发。当前 Node 为 v24.19.0；引用的是同一 v24 系列官方说明，不冒充历史信号事件日志。

`LLM_TIMEOUT` 的 catch 分支仅在 `combined.aborted` 时产生；本次未传外部 signal，120 秒共享预算在 60001 ms 尚未到期，唯一已到期的配置信号是 60 秒单次计时器。因此**应用计时器已到期并主导取消/分类可确定**。执行器把 Node request/response 的原始 error 改成固定错误，未记 abort.reason 或原始 error.code，无法追溯同一瞬间是否还发生连接异常；不能声称捕获到了原始 Node ABORT_ERR。

| 候选解释 | 当前证据等级 |
| --- | --- |
| 应用 60 秒定时取消 | **已定位**：信号组合、调用参数和 60001 ms 记录一致 |
| 人工/浏览器主动取消 | 本次调用路径可排除；无外部 signal，不走浏览器路由 |
| DNS/TCP/TLS/连接或正文传输慢 | **假设**；没有 lookup/connect/secureConnect/headers/first-byte/end 时间或字节统计 |
| 上游返回 400/401/429/503/504 | **UNKNOWN**；没有已记录 status；也不能由缺失 status 推断没有返回 headers |
| Google 模型生成超过 60 秒 | **假设**；没有确认进入生成、服务端耗时/请求 ID 或任何正文 |
| 上游返回截断/Schema 拒绝 | **UNKNOWN**；没有完整响应可判定，不能解释为已发生的 REVIEW_OUTPUT_REJECTED |

### 9.3 日志缺口及配置契约检查

原一次性 transport 的 `oneRequest` 在收到 headers 时建立 body 收集器，只在 `response.end` 时 resolve；`controlledTransport` 随后才记录 status。这与常规 fetch 在 headers 阶段先返回 Response 的观察点不同。没有记录远端请求 ID、连接阶段、响应头到达或部分字节，也没有向浏览器展示部分文本。因此本次无法从现有日志判定 Google 是否已经接受请求、生成或收费。

本轮用**内存 EventEmitter 假 HTTPS**注入原函数，不创建 socket：模拟 HTTP 200 headers 和 11 字节部分 body 后取消，成功复现 status 仍不落入 ledger。此实验 PASS，只证明观测缺口，**不证明真实那次收到了 headers**。既有 runner/请求/原账本 SHA-256 均未变，分别为 `47064a4f9798e74ac9e5af4b6284334f247892790c3f6524380a46c8c5c3782a`、`35a03143e59c313c920333c7adb46ef28d58820eded7ec01595c0f3655864efb`、`454a6348cf0439663f41cd240e1ea1807f2723e4d615ede24ae0079d4a25b11c`。

当前只输出白名单配置，未输出或校验凭据正文：Google 官方 `/v1beta/openai/chat/completions`、`gemini-3.8-flash`、`apiProfile=gemini`、24000 输入字符、`max_completion_tokens=4096`、`reasoning_effort=low`、strict `json_schema`、`stream=false`、60000 ms。**配置解析通过不等于认证/服务调用通过**；本轮没有调用模型列表、countTokens、生成、凭据检查或网络探测接口。当前进程仅检测代理环境变量“是否存在”，结果为 false、NODE_USE_ENV_PROXY 未启用；不输出地址，不据此还原历史系统代理/VPN 或断言网络可达。

Google [兼容接口](https://ai.google.dev/gemini-api/docs/openai) 展示上述端点、模型、Bearer 接口及 low 思考配置，支持 JSON Schema 输出；[模型规格](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) 列明结构化输出及 low/medium/high。当前配置方向符合公开契约，真实接受情况仍 UNKNOWN。max_completion_tokens 的依据保留第 8.1 节官方论坛说明；公开兼容页未逐一列出该字段，不能把论坛回答或本地 HTTP 替身当作服务端实证。

以下均为**潜在冲突/待验证项，不是本次超时根因结论**：

- 原封存 Schema 有 **12 个必填顶层字段**，包含对象/数组/数值边界及字符串长度约束。Google [结构化输出文档](https://ai.google.dev/gemini-api/docs/structured-output) 只承诺 JSON Schema 子集；当前公布属性列表未逐项覆盖本请求的 `$schema`、`minLength/maxLength`、`exclusiveMinimum`。可能忽略、兼容或拒绝，现有材料无法判定；本地 Zod 审核仍必须保留，不因不确定而删校验。
- 按 Google [thinking 文档](https://ai.google.dev/gemini-api/docs/generate-content/thinking.md)，生成预算包含思考 Token；low 并不等于关闭思考或保证某个耗时。若兼容字段按该总量映射，4096 不保证全用于可见 JSON。算法诊断、两份代码分析、反例和 12 字段输出可能争用预算，导致空白/截断；**没有 usage 或 finish_reason，不能认定本次耗尽了 4096**。
- JSON Schema 约束不自动扩大 Token 或时间，也不证明算法结论正确。请求最小结构可很短，4096 与 Schema 并非已证明的逻辑矛盾；额外生成/校验耗时是否显著尚未知。
- `stream=false` 加当前 transport 整体缓冲，首段内容不会成为持久日志。若服务器很慢，客户端可先在 60 秒取消，服务端仍可能已处理并计费。即使延长客户端时间，也不能保证完成。
- Provider 在完整响应后才检查 finish_reason、总生成 Token 和 envelope；命中长度/截断通常是 `LLM_INVALID_RESPONSE`，分析审核拒绝才是 `REVIEW_OUTPUT_REJECTED`。本次均未走到，不能混作模型或审核失败。

### 9.4 重试与授权审计

生产 `OpenAICompatibleProvider` 上限为两次尝试，**仅首次 HTTP 429/503 会等待 350 ms 再试**，共用同一 lifetime；连接异常/超时直接抛出，不自动重试。真实 A 给 pause 注入立即 throw 的 `noRetry`，另以进程计数和独占磁盘标记封死第二次 transport 调用；HTTPS 无 SDK/代理 agent/重定向重试。

原持久标记仍存在，已有 usage 仅 **attempt=1**，账本 dispatches=1、automaticRetries=0，没有第二份模型输出或记录。执行器在任一结果后退出，本轮没有运行它。**本地可审计边界内仍为 1 次发送尝试、0 次重试，没有突破原一次许可。** 无法由这些记录审计外部网络基础设施或推断 Google 内部执行次数；不把一个 marker 当作服务端收讫凭证。

### 9.5 用量及官方账单能核到什么

已读取本地 `A-execution.json`、`A-usage.json`、`A-audit.json`：input/output/total、costUsd、按 usage 估算和实际账单均 NULL，无原始输出。A 未接数据库，**不会有该次 review_reserve/review_finish 的生产 usage 行**；不能去生产拼接一条记录，不能把其他历史 Review 用量当本次费用。本轮新增 Provider 费用为 0（没有新请求），**原单次超时费用仍 UNKNOWN**。

官方 [账单指南](https://ai.google.dev/gemini-api/docs/billing.md) 提供 AI Studio 的 Dashboard > Usage、Billing/Spend 及 Cloud Billing Reports。可以核对，但本轮没有取得该密钥所属 Google 项目的真实账单页面或导出，也没有用 API Key 反查项目/读取账单 API；Supabase 项目 ID 不能代替 Google 项目。**实际账单核验 NOT_RUN，费用继续 UNKNOWN。** 不要求提供密码、Token 或密钥。

最短只读核对步骤（由账户持有人在已登录的官方界面操作）：

1. 在 AI Studio 的 Projects/API Keys 中确认本地已配置密钥对应的 Google 项目，仅本人比对，不复制/发送密钥；确认账户层级。不要更换密钥、充值、升级或提交测试 Prompt。
2. 在该项目 Usage 中按 `gemini-3.8-flash` 和 **2026-10-18 10:31:31.681–10:32:31.683 UTC**（北京时间 18:31–18:32，按界面时区换算）查看请求/Token 是否有记录；若只支持更粗时间粒度，保留覆盖窗口和其他并发活动说明。
3. 在 AI Studio Billing/Spend，或 Cloud Billing Reports 按项目、Gemini API 服务及 SKU/使用日期查看用量与费用，区分余额、预付扣款、税费、优惠和模型使用费用。Google 说明部分费用图可能延迟至 24 小时；不因当下显示 0 就认定没收费。
4. 若只有按日/模型聚合且同窗还有其他调用，无远端 request ID 就不能可靠拆出本次费用；如实记“聚合额可核，单次仍 UNKNOWN”。不为造对照再次调用模型，不新建计费导出或其他付费资源。

### 9.6 候选方案：本轮均未实施

| 候选 | 收益 | 风险与费用影响 |
| --- | --- | --- |
| **先增加只含元数据的阶段观测，再做一次 A，timeout 110 秒、4096 不变（建议）** | 能分辨连接/headers/body/取消来源；只改变时间窗口，保留 Prompt/源码/输出条件便于对照 | 可能仍是网络问题；等待更久可能让更多生成完成并收费，60 秒取消不等于省掉已生成用量。保持单次/相同输出上限不直接提高配置 Token 上限；实费仍以记录/账单为准 |
| timeout 90 秒、4096 不变 | 更保守的等待，保持输出条件；若将来另验产品路径更接近其约 100 秒共享窗口 | 对超 90 秒上游无帮助，费用未知；产品仍需扣 Auth/DB 前置耗时，不能保证可用 90 秒 |
| 输出改 2048、timeout 不变 | 若成功限制生成，可能降低最大生成费用和耗时 | 更易让 thinking 挤掉正文、JSON 截断或缺失反例；可能付费但没有可审核答案，不能把失败率变化当质量下降 |
| 输出改 8000、timeout 110 秒 | 给 thinking/完整结构化回答更大空间；8000 是现有配置校验上限 | 不是已证明必要；请求输出额度接近翻倍，按当前 USD 3.75/百万的单价，输出部分上限从 USD 0.01536 到 USD 0.03000（不含输入）。还可能更慢；须另获预算/参数批准，不能同时悄然改多项 |
| 换成流式或原生 Gemini API 的隔离评估 | 更早观察首段，原生计数语义更直接 | 需要另一套受控读取/封存方案，改变请求契约、评估可比性与重试风险；流式内容仍须完整审核后展示，不能绕过安全校验；本轮不开发 |
| 先做小输出/无源码连通性生成 | 可独立检查传输/认证 | 仍是**新的真实模型请求**，不能当“免费诊断”绕过次数/费用许可；不纳入下面一次 A 提案 |

更安全的阶段观测仅记录数值耗时/布尔事件/白名单状态：lookup、TCP connect、TLS secureConnect、请求写完、headers(status)、首字节、body 字节数/end、哪一个 signal 取消以及限定 error.code。不得记录请求/响应头、IP、代理地址、源码、原始 SDK 错误或内部 reasoning。请求写完也不证明上游已接受。**本轮仅提出此方案，未修改原执行器或产品。**

### 9.7 下一轮待重新批准的精确方案

这是一份提案，**本轮不请求也不执行新的调用**；旧许可已经消耗，不自动续用。若之后用户批准，执行前还须封存新配置/时间观察方案并以纯内存替身检查；如公开价格变化导致超预算则停止，不能自动提价。

| 需要重新批准的项目 | 建议范围 |
| --- | --- |
| Provider / 模型 | **Google Gemini API / gemini-3.8-flash**，同官方兼容 endpoint |
| 源码/数据发送 | **仅原两份固定哈希的完整 DFS AC/WA + 原必要题意/约束 + 未改 Prompt 1.1.0/中立任务**；不含其他私有文件、评审答案、历史输出或对话 |
| 上下文 / 次数 | 新无历史上下文；**最多 1 次真实生成 HTTP，0 SDK/代理/应用可控重试**；无 countTokens、listModels、连通性生成或 B |
| 时间 | **单次 110000 ms**，明确覆盖评估构造器的旧 60000；独立 A 无路由 deadline，Provider 共享预算 **120000 ms 不变**；不修改生产环境。不得用仅改 env 后仍硬编码 60 秒的旧执行器运行 |
| 输出 | **max_completion_tokens=4096、reasoning_effort=low、stream=false、原 strict JSON Schema**；不扩大输出、不改 Prompt |
| 费用上限 | **USD 1.10 模型 Token 费用**；以当前官方 Standard 0.75/3.75 美元每百万输入/输出的价格，按完整模型上限保守估算 USD 1.032192；含税账单/汇率不在 Token 估算内，实际仍须核账 |
| 证据与停止 | 使用新的防重标记和隔离目录，保留旧标记/原件；增加上述安全阶段事件及 signal 来源，首轮原文封存后才审核/执行反例；任意成功/失败/超时后停止，下一次重新批准 |

110 秒小于独立 A 的 120 秒共享预算；**不适用于直接照搬到产品 B 路由**，B 未获授权。若要 8000 输出、不同模型/endpoint、不同传输或额外连通性请求，必须重新列明内容、次数、超时和费用，不能归入这次提案的默认动作。8192 则超过当前配置允许的 8000，本轮不提出通过修改校验上限来放行。

### 9.8 本轮实际检查与结论

| 实际执行 | 结果 |
| --- | --- |
| HEAD/status、执行器/请求/原账本 SHA-256、信号/路由/lease 静态读取 | PASS；ac79946、初始干净，旧证据哈希未变 |
| 白名单配置读取（只调用本地 readTutorConfig） | PASS；未显式 LLM_TIMEOUT_MS、Gemini 默认60000；未输出凭据，无网络 |
| `npm run test -- tests/unit/gemini-provider.test.ts tests/unit/m2-tutor.test.ts` | **44/44 PASS，2 文件**；18:39:20 本轮重跑，所有请求均注入本地 fetch 替身 |
| 内存假 HTTPS headers/部分 body 后取消实验 | PASS；0 socket/0 网络，复现未记录 status 的观测缺口 |
| `git diff --check` | PASS |
| 真实 Provider/账单私有页面、生产 DB、全量 lint/typecheck/test/build/E2E/推荐回归 | NOT_RUN；未新增调用，只有文档补充，不把前轮数量复用为本轮成绩 |

单次应用定时取消归因 **PASS**；原一次授权未超出 **PASS（本地证据范围）**；网络/上游阶段深层原因 **UNKNOWN**；原单次实费 **UNKNOWN**；真实教学质量 **NOT_RUN**。不修改历史模型结论、人工评审计数或生产门槛。只提交本报告追加结果；本轮不实施候选配置、不重放旧真实请求。

## 10. 第二次受控 A（A2）：110 秒等待响应头后取消

### 10.1 新授权、基线与预检

2026-10-18，本轮实核 HEAD **0c8d44e**，初始工作区干净。用户另行明确批准一次 A2：Google **gemini-3.8-flash**，仅此前脱敏的完整 DFS AC/WA 与必要题意，空历史、无根因/人工评语/已知反例答案；最多 **1 次真实 HTTP、0 重试**，单次 **110000 ms**、共享 **120000 ms**，low、4096、原 strict Schema、新增 token 费用上限 **USD 1.10**。不包含 B、生产数据/Prompt/算法/部署变更；失败或任何结果后停止。此许可已消耗，不能自动追加第三次。

执行前两份源码哈希、当前 Prompt **algopilot-ac-review/1.1.0** 重建消息、完整请求体和 Schema 均与原封存相符：请求体 SHA-256 **35a03143e59c313c920333c7adb46ef28d58820eded7ec01595c0f3655864efb**，Schema SHA-256 **63708d3749795403024ef0484fa9258bddcbc4cb0d1826e280dab9a329393418**。没有把本报告、旧诊断/输出/控制反例或 Codex 对话加入请求。仅在隔离评估对象及构造器显式覆盖 timeout=110000；**.env、生产默认60000及应用实现均未改**。

已重新读取 Google 官方 [价格](https://ai.google.dev/gemini-api/docs/pricing) 与 [模型规格](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)，当前 Standard 输入/输出（含 thinking）仍为 USD 0.75/3.75 每百万 Token，模型输入/输出上限 1048576/65536。单次完整模型上限估算 USD **1.032192 < 1.10**，检查通过后才允许连接；这不是实际账单。请求输出仍明确为4096，没有借保守估算扩大输出预算或启用工具。

### 10.2 单次执行与脱敏阶段记录

本地一次性评估脚本为 `/private/tmp/algopilot-m353-prep/run-A2-once.cjs`；不是产品新功能，未提交源码或安装基础设施。复用原 Provider/Prompt/审核，原封存 body 字节不变。单独私有目录和独占 `A2-dispatch-consumed.json` 在连接前创建，进程内第二次 transport 调用也被拒绝；旧 A 防重标记/原件保留。原生 Node HTTPS 无 SDK、代理 agent、重定向或可控自动重试，429/503 的 pause 注入为拒绝。

阶段跟踪仅包裹现有 AbortSignal API 并返回原生 signal：记录创建/取消来源与时间，不改变 timeout/any 语义。共享120000、单次110000均实际创建，没有外部取消信号或路由 deadline。日志仅含白名单事件名、数值时间/字节/状态和限定错误码；不保存头字段、IP/代理地址、凭据、请求正文、raw SDK 错误或内部 reasoning 到阶段日志。

唯一真实命令（已经执行，**不能重跑**）：

```bash
node /private/tmp/algopilot-m353-prep/run-A2-once.cjs --execute-authorized-A2-once
```

| 参数/结果 | 实际记录 |
| --- | --- |
| 请求 endpoint/model | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` / **gemini-3.8-flash** |
| 参数 | `max_completion_tokens=4096`、`reasoning_effort=low`、`stream=false`、原 strict `ac_review` JSON Schema、history=[] |
| 响应 model/HTTP status | **未知**；没有观察到 response headers，不能验证服务端模型身份或认证/Schema 接受情况 |
| 本轮发送/重试 | **1 次发送尝试、0 次重试**；此前另一次授权为1次，两次各有独立标记；本轮没有第三次 |
| 时间（UTC） | **2026-10-18 12:01:39.278 → 12:03:29.438** |
| 时间（Asia/Shanghai） | **20:01:39.278 → 20:03:29.438** |
| Provider 尝试耗时 | **110151 ms**；外层封存区间约110160 ms |
| 退出 | **FAIL：LLM_TIMEOUT**，Node 白名单错误 **ABORT_ERR** |
| 收到 headers/body | **headersObserved=false，bodyBytes=0，bodyComplete=false** |

事件相对本次评估阶段起点的时间如下（完整脱敏事件见 [A2-execution.json](m353/A2-execution.json)）：

| 事件 | 毫秒 | 含义 |
| --- | --- | --- |
| shared signal 创建 | 0.254 | 120000 ms，共享预算 |
| per-attempt signal 创建 | 0.507 | 110000 ms，单次预算 |
| dispatch | 1.292 | 消耗本轮唯一发送许可 |
| socket assigned | 63.262 | 已分配连接对象 |
| DNS lookup | 87.090 | 成功，不记录解析地址 |
| TCP connect | 91.697 | TCP 连接事件已观察 |
| TLS secureConnect | 1441.912 | TLS 连接事件已观察 |
| request write finish | 1446.241 | 本地请求写完；**不等于 Google 已接受/生成** |
| per-attempt timeout | 110097.637 | 明确由110000单次信号触发；共享信号未到期 |
| combined abort | 110102.193 | reason=TimeoutError |
| request error | 110148.075 | code=ABORT_ERR，responseStarted=false |
| Provider failure | 110151.311 | LLM_TIMEOUT |

110000 是定时取消配置，事件在约110097.6 ms被记录、异常传播/封存继续产生少量开销；不是扩大授权超时、第二次尝试或120秒共享预算先触发。JavaScript timer 不提供硬实时进程终止保证，本次记录的实际退出耗时如上，不伪报恰好110000。

**本次能确定：连接建立与请求写入已完成，直到应用单次信号取消仍未观察到响应头。** 与第一次仅能说“没有完整响应”的日志缺口不同，A2 的 header 事件在回调开始立即记录。该证据将本次等待定位到 TLS/本地写完之后、响应头之前，不能进一步区分上游排队/处理、模型推理、网络返回路径或其他中间层，也不能证明 Google 没有收到或收费。没有收到官方错误状态，不能认定是401、Schema拒绝或模型不存在。

### 10.3 用量、模型质量与验证边界

原始诊断 **未收到**，不存在 `A2-first-output.txt`，没有用 Mock/评审答案补造模型结论。

- **Token**：input、completion、total 全为 **NULL**；1条本轮 usage 尝试标记 timeout。
- **费用**：Provider costUsd、按 usage 估算及可核实实账均 **NULL/UNKNOWN**；不把超时记为免费。USD1.032192只是发送前保守估算；本轮没有访问账单接口或用其他调用造对照，官方核对步骤仍见9.5。第一次与第二次的真实账单都未核实。
- **WA根因/控制流/修复/不确定性**：全部 **NOT_RUN**，不是教学 FAIL。
- **模型提出的全部反例**：未收到任何内容，收到数量 **0**；不是“模型回答说无法构造”。没有模型输入可交给原生 verifier，故本轮模型反例/输出值的独立执行核验 **NOT_RUN**。不再运行旧控制来冒充新模型成绩。
- **结构化输出及安全审核**：**NOT_RUN**，因为没有完成 Provider 响应；不是 REVIEW_OUTPUT_REJECTED，不判误拒。
- **B、生产持久化/展示、真实JWT/RLS/HMAC链路及本人教学评价**：本轮 **NOT_RUN**。没有读取/改写Supabase、旧快照、推荐或画像。

本轮未修改 Prompt 后追加测试；结果封存后已停止。对同题两次传输失败不能计算模型准确率、反例有效率或教学收益，人工推荐0/40、替代题0/5及既有真人反馈保持不变。

### 10.4 私有原件、脱敏交付与本轮检查

私有目录 **`/private/tmp/algopilot-m353-A2-authorized-0c8d44e/`** 为0700，其文件均0600：`A2-request.json`/`A2-local-review-input.json`（仅本地，含私有源码）、`A2-dispatch-consumed.json`、`A2-stages.ndjson`、`A2-execution.json`、`A2-usage.json`、`A2-audit.json`。阶段日志与账本只有脱敏字段；没有原始模型正文可保存。原A目录及两份源码保持不变，私有材料不进仓库。

| 原件 | SHA-256 |
| --- | --- |
| 私有 A2-execution.json | `3249f09784dad6abd921bc636fe6171cdef35c82b3e5708a8b673ae456a1ec71` |
| 私有 A2-stages.ndjson | `e2aed6f763595539b26bfcaa45ab01620c462aa3cfe5018f46c8501f188730e7` |
| 私有 run-A2-once.cjs | `c4deb53a3244b92fa5eaa20aa88049ae67962e999a6cd38b6ff26abb251bed36` |

仓库只新增脱敏 [A2-execution.json](m353/A2-execution.json) 和本报告追加内容；提交版本没有私有源码、完整模型请求正文或未脱敏日志。临时目录可能被系统清理，应在需要复核时保留本机受控原件，不能重新执行已消耗请求来补证据。

| 本轮实际执行 | 结果 |
| --- | --- |
| HEAD/status、当前Prompt/源码/Schema/封存请求哈希复核 | PASS；0c8d44e、初始干净，body与第一次封存逐字节相同 |
| `node /private/tmp/algopilot-m353-prep/run-A2-once.cjs` 默认本地检查 | 初次失败：本地测试清理目录后，迟到的timer回调仍写日志；仅修正临时评估脚本的事件记录关闭保护。修正后 **5场景PASS**（200/429/503/headers后部分正文超时/连接错误），执行真实入口前又全部重验，**真实网络0次** |
| 本地单次保护、原件禁止覆写、signal来源及header立即记录 | PASS；每场景1次假transport，重复发送被阻止；原生signal返回语义不变 |
| 上述带 `--execute-authorized-A2-once` 命令 | **1次真实发送尝试，0重试；110151ms后LLM_TIMEOUT**；进程正常封存失败不算Provider成功 |
| `npm run test -- tests/unit/gemini-provider.test.ts tests/unit/m2-tutor.test.ts tests/unit/review.test.ts tests/unit/review-reliability.test.ts` | **56/56 PASS，4文件**；20:01:49本轮重新运行，均本地替身 |
| `PYTHONPYCACHEPREFIX=/private/tmp/algopilot-m353-prep/pycache python3 -m unittest discover -s tests/offline -p 'test_m352*.py'` | **5/5 PASS**；离线合同，不是模型反例执行 |
| 新/旧防重标记、旧账本不变、私有权限、事件字段白名单及输出缺失检查 | PASS；只保留脱敏原语字段，旧A证据哈希不变 |
| `git diff --check` | PASS |
| 全量lint/typecheck/test/build/E2E/推荐专项/原生模型反例验证 | **NOT_RUN**；仓库无业务/工具代码变更，未把历史通过数量当新结果；没有模型反例可执行 |

### 10.5 本轮验收状态与停止

| 项目 | 状态 |
| --- | --- |
| 指定模型请求参数、冻结输入/Schema与无历史 | PASS（服务端模型身份未验证） |
| 110000单次 / 120000共享配置、脱敏阶段观测 | PASS |
| USD1.10发送前保守Token预算边界 | PASS（实际费用UNKNOWN） |
| 单次发送、零重试、防重标记、停止纪律 | PASS |
| 真实Provider请求完成 | **FAIL：LLM_TIMEOUT** |
| 本轮连接建立/等待响应头阶段归因 | PASS；深层上游原因UNKNOWN |
| 新Prompt模型教学质量、WA诊断、全部反例及输出验证 | **NOT_RUN** |
| 结构化输出/真实安全审核/产品B | **NOT_RUN** |
| M3.5.3完整验收 | **BLOCKED** |

授权已用完，**不自动第三次调用，也不再单纯增加timeout重试**。后续先由维护者按9.5只读核对正确Google项目的Usage/Billing及项目状态；如要进一步传输探测或换评估方式，必须另列发送范围、次数、参数与费用并获新授权。不能把本次连接成功或超时包装成模型教学质量通过/失败。
