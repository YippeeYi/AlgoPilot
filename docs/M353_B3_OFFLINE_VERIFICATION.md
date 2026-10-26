# M3.5.3 B3 离线基础生成探针验收

2026-10-26，Asia/Shanghai。**B3 PASS（仅离线实现与模拟验收）。B4 未授权、未执行。** 本阶段只授权本地实现、静态检查和离线测试；远端模型、认证、费用及真实网络路径未验证。

## 1. 基线、源码复核与变更范围

初始及最终 Git HEAD 均为 `e11f54794d02374131d4020e79f837a3bab30119`。初始 `git status --short` 为空。最终只新增下列五个文件，未提交；没有覆盖、清理既有文件或防重标记，没有修改生产业务、配置、依赖、迁移或历史报告。

最终工作区状态：

```text
?? docs/M353_B3_OFFLINE_VERIFICATION.md
?? scripts/m353-b3-checks.mjs
?? scripts/m353-b3-offline-guard.cjs
?? scripts/m353-b3-probe.ts
?? tests/unit/m353-b3-probe.test.ts
```

| 新增文件 | 用途 |
| --- | --- |
| [m353-b3-probe.ts](../scripts/m353-b3-probe.ts) | 独立离线探针、原生 HTTPS 请求接口、固定规格、持久标记、单次入口、计时、观测与分类 |
| [m353-b3-probe.test.ts](../tests/unit/m353-b3-probe.test.ts) | 内存 EventEmitter 模拟及独立子进程退出/重启测试 |
| [m353-b3-offline-guard.cjs](../scripts/m353-b3-offline-guard.cjs) | 验证进程预加载禁网/凭据文件读取拦截与计数 |
| [m353-b3-checks.mjs](../scripts/m353-b3-checks.mjs) | 无环境文件、白名单子进程环境的临时副本验证器 |
| 本报告 | B3 证据、边界及 B4 阻塞条件 |

实施前已在聊天声明同一五文件清单。临时副本、构建输出、合成测试标记和脱敏验证日志只写 `/private/tmp/algopilot-b3-*`；不写生产数据。测试清理仅删除各自新建的 `synthetic` 临时目录。

仓库中没有独立以 B2 命名的文件。本次用户给定的 B2 固定规格与 [既有报告 §11.6](M353_PROVIDER_EVALUATION.md#116-下一轮最小真实实验待额外批准尚未执行) 一致；以二者为实施依据，没有把历史真实调用许可用于本轮。

源码确认：生产 `OpenAICompatibleProvider` 默认使用全局 fetch；构造 `/chat/completions`，按配置选择 token 参数；Gemini 配置默认 `max_tokens`、4096、`json_schema`、low、60000ms。Review 使用 strict `ac_review`；通用 Provider 仅在首次 429/503 后可能退避 350ms 重试一次。读取使用流 reader、2,000,000 字节上限后解析 JSON。探针不导入这些生产模块，不继承 Schema、重试或配置读取行为。

仓库脚本未发现可直接复用的原生 HTTPS 实现；历史报告中的 A1/A2 代码位于私有临时目录。本轮未读取该目录或真实密钥。新探针使用 `node:https` 的 request 签名与原生事件语义、`agent:false`，只接受显式离线 request 替身；不使用 fetch、SDK 或代理 Agent。传入原生 request 本身或不注入传输均在标记创建前拒绝。没有 CLI/live 开关、凭据参数、环境加载器或默认真实发送路径。

关键源码 SHA-256（与 HEAD 相同）：

| 文件 | SHA-256 |
| --- | --- |
| `src/server/tutor/provider.ts` | `6739a79092d5f90289ad9e415f11d0a473ff517f7f6ea5b4a157fde6ed762568` |
| `src/server/tutor/config.ts` | `65a73dda699f113ebb286504186711db476bba36dbbdc9efc6272cbeed497f5c` |
| `tests/unit/gemini-provider.test.ts` | `e04c29405cefd3e58b41e4c212009ddc0d3e56d8c7430f5e37dc5e6d967566fd` |

## 2. 固定请求字段

| 字段 | 规定值 / 实际构造与断言 |
| --- | --- |
| URL | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`，整串 literal；拒绝 query/userinfo/hash/其他 host/path/尾斜杠 |
| method | `POST` |
| model | `gemini-3.8-flash` |
| messages | 仅 `[{"role":"user","content":"Reply with exactly OK."}]` |
| reasoning_effort | `low` |
| max_completion_tokens | `256` |
| stream | `false` |
| response_format | 完全省略，显式传 `undefined` 也拒绝 |
| tools / 历史 / 额外消息或字段 | 全部省略；strict Zod 拒绝新增字段 |
| Agent / 传输 | `agent:false`，原生 HTTPS request 接口的离线注入 |
| headers | 仅 Content-Type 和按 UTF-8 字节计算的 Content-Length；B3 无 Authorization |
| 模型列表 / token 查询 | 无接口、无调用 |

先验证调用输入，然后在持久标记之后从常量重建请求；不复用可能在 await 期间被改动的输入。传输入口自身再次验证固定规格，之后才增加计数并调用 request。固定消息之外不发送题面、源码、评审、历史或私人材料。

## 3. 单次保护、崩溃与截止时间

持久层要求已存在的绝对路径私有目录（非符号链接、无 group/other 权限），固定文件名 `B3-generation-dispatch.consumed`，发送前以 `wx` 独占创建、0600 写入固定非敏感标记、文件 fsync、目录 fsync、关闭均成功才放行。目录/创建失败、EEXIST、模糊 I/O 状态、写入/fsync/关闭失败均拒绝。任何失败都不删除标记；空文件、部分写入及请求中进程退出也视为已消耗。新进程读取同一路径的存在事实后拒绝，不依赖旧进程内存。

传输层闭包计数最多允许一次 request factory 进入，即使首次 factory 抛错也已消耗；第二次立即 `dispatch_refused`，不会再调用底层。没有 retry、redirect 跟随、fallback 或错误补发，三个计数恒为 0。并发两个调用争用同一持久标记仅一个可进入传输。

请求计时在 request factory 之前开始，固定 **60000ms**，覆盖 socket/DNS/TCP/TLS、写入、headers 等待和完整 body；headers/分块到达均不重置。总计时在函数入口开始，固定 **120000ms**，包含标记 I/O；70 秒前置耗时后仅剩 50 秒。每次事件及接受解析结果前均复核单调时钟，迟到事件不能改写已封存报告。取消销毁 request/response，移除取消监听并清理计时器。

Node timer 不是硬实时进程终止器；离线测试用虚拟时钟证明截止逻辑、迟到结果拒绝及清理，不宣称真实网络能恰好在第 60000ms 完成销毁。body 累计超过 **2000000 bytes** 立即停止，超限块不进入保留缓冲；报告如实计入触发上限的已到达块，保留量至多 2000000。解析时的临时字节/字符串副本仍占内存，此值不是进程 RSS 上限。

## 4. 观测与隐私

报告只返回白名单结构化原语，不保存原始响应正文/headers、异常对象、API Key、Authorization、环境变量、reasoning 或其哈希。

| 观测组 | 字段及语义 |
| --- | --- |
| 前置 | fixedSpec、transport、marker 分开记录 pass/fail/未检查及标记类别 |
| 阶段 | socket、dns lookup、tcp connect、tls secureConnect、requestFinish、headers、firstBody、bodyEnd、json、envelope、content、model、usage |
| 阶段采集状态 | `not_occurred`：相应事件尚未发生；`not_collected`：后续事件已到但缺前序采样，或策略跳过/缺失字段；`collection_failed`：采集或该事件报告失败；`collected`：采集完成。时间为相对毫秒或 NULL，不记录地址/证书 |
| 完整性 | bytesReceived / bytesRetained、bodyComplete（未见 headers 为 NULL）、JSON valid/invalid_json/invalid_utf8、envelopeValid |
| 内容 | 仅 contentExactlyOK/contentEmpty、finishReason=stop/length/other/NULL，不 trim、不存文本 |
| 模型 | 只保存准确匹配的 `gemini-3.8-flash`；其他字符串只留下 modelMatches=false，model=NULL |
| usage | 仅 prompt_tokens、completion_tokens、total_tokens，非负有界整数；缺失为 NULL，不从正文估算，不推导费用 |
| HTTP 与终止 | httpStatus、httpClass 与 outcome（本地终止原因）、terminalStage、abortSource 分开记录 |
| 次数 | dispatch 0/1、retry/redirect/fallback 0 |

**HTTP 状态是独立事实，不由取消覆盖。** 完整 429/503 为 http_error、原状态不变、无重试；若 headers 为 429/503 而 body 后续超时，仍保留 httpStatus=429/503、httpClass=error，并另记本地 request_deadline，不能把它说成“没有 HTTP 响应的超时”。非 2xx 正文不解析为模型 envelope，也不保存上游错误文本或 Location。

失败分类包括：规格/离线传输拒绝；标记已存在/创建失败/未知；入口拒绝/创建失败；DNS/TCP/TLS/request 故障；body 不完整/读取失败/上限；request deadline/total budget/caller/policy_stop；观测失败；HTTP redirect/error/非法 status；UTF-8/JSON/envelope 无效；空内容/非精确 OK/length/其他 finish reason/模型不匹配；未预期内部失败用固定 internal_failure。未向报告复制原始异常字符串。

合成私密哨兵测试验证正文、额外 usage、未知 model、错误及取消 reason 不进入报告；响应 headers getter 若被读取就抛错，正常矩阵通过。无需读取真实密钥进行“泄漏扫描”。

## 5. 离线矩阵与验证方式

运行入口：`node scripts/m353-b3-checks.mjs`。验证器复制已跟踪文件和已声明五文件到私有临时目录，排除所有 `.env*`，依赖仅链接本地 node_modules；子进程环境由常量白名单重建，HOME 指向空目录，不继承服务凭据。`NODE_OPTIONS` 预加载 guard，覆盖 HTTP(S)、net/socket、TLS、DNS/promises、global fetch 与敏感配置文件读取；计数只留类别，不留目标/参数。所有探针传输均为内存 EventEmitter，子进程退出测试也使用内存 request。

| 用户要求的矩阵 | 最终专项覆盖 |
| --- | --- |
| 1–4：OK、非 OK、空、length | 精确 OK；NO/尾换行；空串/NULL；OK/空 + length 分开分类 |
| 5：401/400/429/503/其他 5xx | 400/401/403/429/500/502/503/504/599；完整响应不重试、不改写状态 |
| 6–8：DNS/TCP/TLS | lookup 失败、request ENOTFOUND、TCP/TLS/request 错误，固定分类 |
| 9–10：headers 前/后超时 | socket 前、finish 后、headers 后、部分 body；59000ms headers +59999ms 首块仍在60000ms停止 |
| 11–12：JSON/envelope | 空原始 body、非法 JSON、非法 UTF-8、缺 choices、非法 usage；分别拒绝 |
| 13–15：3xx/上限/取消 | 301/302/307/308 零跟随；2000000/2000001 边界；caller/policy_stop 及已取消 caller |
| 16–17：标记存在/失败/未知 | 空标记、重新调用、并发、权限失败、模糊 open、写入/文件sync/目录sync/close失败 |
| 18：崩溃重启 | 独立 Node 进程在已持久化标记、模拟 request finish 时退出73；第二个全新 Node 进程读取同一标记，确认 marker_exists/dispatch=0 后正常退出0，父进程再验证 |
| 19：二次 dispatch | 首次 factory 抛错仍计1，第二次入口拒绝；入口自身也拒绝错误规格 |
| 20：固定规格偏离 | 17 类 URL/方法/模型/消息/角色/历史/effort/budget/stream/Schema/tools/额外字段偏差全部在标记与传输前拒绝 |
| 补充 | 输入 await 期间修改、120秒标记挂起与迟到完成、70秒前置耗时、缺 usage/前序事件、采集失败、迟到事件及隐私哨兵 |

首轮记录保留：新增专项42项失败来自跨运行环境的 Uint8Array instanceof 检查；另有测试夹具的 lstat overload/NODE_ENV 类型错误和 CJS preload 的 lint 错误。使用 Node 原生 isUint8Array、收窄实际使用的 I/O 接口、补齐合成环境及 getBuiltinModule 修正；未放宽规格/断言或删除测试。首轮全量既有 candidate-pool 单项触发5000ms测试预算，下一轮同预算通过，未修改旧测试。

第二轮：lint/typecheck/专项87/87/全量378/378/build全部通过，禁网及凭据审计均0。之后新增传输入口断言、模糊 open 状态和前置预算测试，最终版本专项90项；以最后一次完整检查为准。

最终90项版本的四 worker 全量曾为380/381：仍只有既有 candidate-pool 的5000ms超时，新增90项全部通过。离线验证器改为 `--maxWorkers=1` 后全量381/381通过（该候选池单项2603ms）；没有修改原有测试、预算或应用配置。最后补齐 I/O 在途 unknown 和第二个全新进程重启断言，再做冻结版本检查。

一次收尾轮中专项90/90、全量381/381和构建已通过，但20份退出审计中一份为0字节，汇总失败；该轮**不计作审计通过**，没有为缺失记录补零。已将审计改为先写 `.pending`，完成后 hard-link 原子发布 `.json`；汇总明确检测不完整/无效记录，出现时标为 collection_failed、counters=NULL 并非零退出。旧失败记录保留，本轮不从原始异常猜测外部请求；最终以修正后的新一轮为准。

最终运行 `node scripts/m353-b3-checks.mjs` 的实际结果：

| 检查 | 结果 |
| --- | --- |
| `npm run lint` | PASS，exit 0，零警告 |
| `npm run typecheck` | PASS，exit 0 |
| `npm run test -- tests/unit/m353-b3-probe.test.ts` | PASS，90/90，1文件；含真正两个独立子进程的崩溃/重启检查 |
| `npm run test -- --maxWorkers=1` | PASS，381/381，40文件；152.66秒；未放宽任何测试预算 |
| `npm run build`（含 postbuild） | PASS，exit 0；24个静态页面生成，Monaco bundle检查通过；不是部署 |
| 最终审计 | PASS，19个受控运行时，incomplete=0、invalid=0，六个计数均0 |
| HEAD/白名单/生产源码不变/空白复核 | PASS，只有事先声明的五个新增文件，所有既有跟踪文件与HEAD相同 |

最终证据：[checks.json](/private/tmp/algopilot-b3-checks-UpC1hC/checks.json)、[完整本地检查日志](/private/tmp/algopilot-b3-verified-check.log)。对应临时工作区四份实现/测试文件与最终仓库文件逐字节核对一致；之后仅完善本报告。临时证据可能被系统清理，报告保留结果与失败历史，不以重发真实请求补证。

E2E、原生 PostgreSQL 网络测试、托管 JWT/RLS、真实 Provider 均 **NOT_RUN**。本轮只要求离线，不启动浏览器/HTTP服务、原生数据库或生产流程；PGlite 的内存 PostgreSQL 执行不代表生产数据库访问或托管通过。

## 6. 审计与 B4 边界

所有本轮检查都通过上述临时副本入口；已完整采集的早期轮次计数均0，采集失败轮保留失败状态、不作数字累计。最终新一轮19份审计均完整，networkBlocked/dnsBlocked/credentialReadBlocked/externalHTTP/realDNS/realCredentialReads 全部为0。拦截尝试0不作为远端可用性证据；禁止网络入口始终启用，未调用真实传输。

| 本轮外部行为 | 次数 |
| --- | --- |
| 外部 HTTP / CF/API 探测 | 0 |
| 真实 DNS 查询 | 0 |
| 真实模型生成 / listModels / countTokens | 0 / 0 / 0 |
| 真实 API Key 读取 | 0 |
| 生产数据库访问 / 写入 / 迁移 / 部署 | 0 / 0 / 0 / 0 |
| B4 执行 | 0 |

B4 仍阻塞于**明确独立授权**，本库没有可直接执行的真实生成命令。后续须单独审查真实 HTTPS/认证接线，锁定该授权唯一且持久的目录（禁止换路径、删标记重跑），取消测试 I/O 注入并保留全部固定规格/截止/单次断言。B3 的合成标记不能当作真实许可，也不应清理历史 A/A2 标记。

远端模型是否存在/可用、认证/项目/地区/配额、参数与 Schema 缺省的远端接受行为、usage/思考 token 映射、费用、真实 DNS/TCP/TLS/返回链路、TUN/出口、真实运行时计时偏差均未验证；沿用历史 UNKNOWN，不根据 Mock 判定。未来若获 B4 授权，任意成功/失败后都停止，不能以本报告授权重试或增加对照。

**B3 PASS：固定规格、20类必需矩阵、持久/进程双层保护、绝对截止、隐私、禁网、无生产访问及五文件范围检查均通过，最终失败项0。** 既有并行测试预算波动及早期审计写入故障按上文单列保留，不伪称从未失败。

**B3 的 PASS 只证明离线实现满足已列测试，不代表远端模型、认证、费用或真实网络路径已验证。** 本阶段已完成并停止，等待 B4 明确独立授权。
