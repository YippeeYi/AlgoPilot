# M3.5.3 真实 Provider 盲测：A 单次请求超时

2026-10-18（Asia/Shanghai）。准备阶段实际基线 **afbe51a**，初始工作区干净；其后提交 **df6bcd2** 保存准备记录。用户随后明确批准一次 A，本次从干净的 df6bcd2 执行，唯一 HTTPS 发送尝试在 60 秒后 **LLM_TIMEOUT**，未获得 HTTP 响应、模型正文或 usage，已停止且无重试。**调用失败，教学质量/反例/真实输出审核 NOT_RUN，M3.5.3 尚未通过。** 下述第 1–7 节保留准备时的授权和测试快照，获授权后的实际结果以第 8 节为准；不把历史“未授权、零费用”沿用于本次超时。

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
