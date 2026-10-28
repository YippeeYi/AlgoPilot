# M3.5 后续：推荐训练反馈与能力证据回流

2026-10-28，Asia/Shanghai。**本地切片PASS：专项52/52、全量569/569、推荐36/36、桌面/移动E2E62/62，最终失败0；lint/typecheck/build/diff PASS。** 本轮完成“个性化推荐快照 → 明确跳过/选择 → 新训练或恢复旧训练 → 手动结果 → 画像刷新与下一轮排除”的本地纵向切片。推荐来源、用户自报和公开账号官方观察分开；不证明推荐提高了算法能力。

## 1. 实际基线与任务依据

实际初始 HEAD 为 `f5f5cef50daa864bb75ceeaa92657da8d0acea61`，工作区干净。此提交已经纳入上一轮20文件，交接中的23dc153加未提交修改是旧时点，没有覆盖既有工作。读取 M35_SKILL_INTELLIGENCE_VERIFICATION、DEVELOPMENT_PLAN v3.4 M3.2/M3.3、MILESTONES，以及推荐/训练/Tutor/Review/CF/画像、权限与测试框架。

最终HEAD不变。工作区17修改、14新增，共31文件，0暂存/0删除；无commit/push/PR/reset/clean。所有变更保留人工审核。

训练本已有暂停/恢复、明确结束与自报结果；画像本已有同题最新完成记录、实际提示和窗口计算；CF同步本已有去重与授权。这些都复用。缺口是推荐来源不可持久核对、跳过与偏好混淆风险、恢复旧训练的归因以及推荐后结果的可解释回看。

## 2. 本轮切片、依赖与验收

选择既有 M3.2 真实训练/结果/推荐闭环的增量，不另建能力评分或改权重。前置 JWT/RLS、窄RPC、CF HMAC、训练状态CAS、来源元数据与画像计算已存在。验收为来源可信记录、所有选择幂等、旧训练不误归因、结果正确回流、历史及用户隔离保留、下一轮仍排除已解题，并完成桌面/移动操作。

长期能力预测、首次尝试成功率、真实耗时或独立性推断、真人效果评估不是本切片。已有可选计时和真实提示记录保留，不新增必填耗时或训练感受，不从CF提交时间差猜解题时间。

## 3. 为什么必须追加013

现有 training_sessions 保存状态/结果，却没有推荐轮次、主题窗口或推荐时的证据快照。create_request_id 是幂等意图，不能单独证明推荐来源。计划关联不能冒充推荐；recommendation_feedback 的 too_easy/too_hard/off_goal 是偏好，不能拿 off_goal 表示主动跳过。草稿、笔记与客户端URL也不是可靠来源。

因此仅追加 `202610280013_recommendation_training_feedback.sql`：

- 私有 `recommendation_trials`，每轮每题一条，最多5条/次；记录生成时间、可信来源/基线、选择/跳过时间、训练关联和是否由本轮新建。
- 训练已有PK(id)保证唯一，追加等价 `(id,user_id)` 唯一约束，使新关联能够用复合FK独立约束归属；不改旧字段或重写历史行。
- 三个窄RPC：record_recommendation_run、recommendation_choice、recommendation_training_evidence。全部 SECURITY DEFINER、空 search_path、显式 auth.uid()，收敛EXECUTE；私表启用RLS且没有普通角色直接读写授权。
- 001–012原SQL不改。013重跑会原子拒绝，不伪称幂等DDL，只应应用缺失迁移。

本地兼容测试真实执行001–012、写入旧训练，再应用013，比对旧行不变、RPC权限/RLS和重放失败后的定义不变。**这是串行PGlite SQL语义，不是原生多连接或托管验收。**

## 4. 来源可信度与状态

推荐POST可接收可选trackingId。旧客户端不传时保留原推荐行为；新UI为一轮生成一个ID。服务器从实际排序结果提取题目ID、经过当前证据重新核对的focus、样本/困难并集/自报解出基线；使用既有CF专用HMAC命名空间鉴证，不接受客户端人数、结论、来源或结果。

record RPC验证签名、用户、期限、字段/大小、当前证据revision、真实CF元数据、每轮唯一题目；同编号同内容返回相同收据，变更内容PT409，坏批次整体回滚。签名及fingerprint不返回浏览器。**来源HMAC不是模型免费资格或生成许可**，生产LLM门禁不变。

| 状态 | 来源与精确定义 |
| --- | --- |
| 已生成推荐，未选择 | 服务端快照已提交；可能响应丢失，不能当作已展示/阅读/点击 |
| 主动跳过 | 用户调用skip，时间幂等保留；不产生训练或未解结果，不自动改推荐权重 |
| 主动进入新训练 | 明确start创建独立训练，默认不计时；不证明真的做题、完成或独立 |
| 恢复已有训练 | 明确start找到本人的同题未完成训练，保留草稿/原状态；不计本轮新尝试或成功 |
| 暂未解出/放弃 | 复用训练结束RPC的明确用户自报，不是官方失败或能力事实 |
| 自报解出 | 复用 solved_self_reported，不能变成官方AC |
| 结束但未记录结果 | 已结束事实保留，结果UNKNOWN，不进入明确结果分母 |
| 官方观察OK | 只查当前用户已授权账号的现有scope/active/OK记录；不改本地结果，不证明账号归属/独立性/代码一致 |

生成、选择、训练记录、明确结果四种分母不混用。开始和跳过均由拥有者RPC控制，行锁与用户事务锁防重复入场；原生锁交错仍未验证。重复start包括完成后恢复都返回原sessionId，不重复成功。

不同轮次恢复同一训练会保留该轮明确选择，但 originated=false；仅最初真正创建训练的来源可 originated=true，数据库唯一索引禁止同训练多次归因。旧训练来源不可证明时只记“恢复既有训练”，不强行归因。

新选择还校验证据revision与已知全历史解出/复盘/授权官方OK；过期来源需刷新，主动重练须原偏好明确开启。已经绑定的旧训练仍能恢复，不因后来授权关闭而丢失历史。

## 5. 缺部署与未知结果

013未托管应用。明确缺函数或签名未配置时，API返回tracking.available=false、空收据，原推荐/训练入口继续可用，跳过追踪不可用；不伪造来源成功。未知写入/传输错误仍503，不静默声称“未记录”。

重复打开页面可以生成多份快照，因此快照数不是曝光数或人数；不会生成成功。再次选择优先恢复未完成训练。即使此前响应丢失，也不能把恢复算作新成功。旧工作台无来源时明确说明不能归因，仍按原规则进入画像。

## 6. 画像与成长口径

新来源模块不进入推荐评分，不新增权重。完成训练后，原learning_evidence读取新的真实训练状态，同题最新完成规则和500窗口不变；下一轮参考值和排除使用原模型，已保存目标不自动变化。

反馈队列窗口按推荐生成时间，显示当前关联训练状态，最多读取最近200条；总量超出明确提示。比例仅针对本轮真正新建、已经结束且结果明确的训练；至少5道不同题目才显示比例，否则UNKNOWN。恢复旧训练、未开始、跳过、未结束和未记录结果不进入该分母，重复收据ID不重复统计。

专项保存推荐时的明确结果数、困难信号并集、自报解出数；当前诊断窗口相同才显示对应当前数值。变化也可能来自窗口滑动、同题最新记录替换或新增记录，不能解释成推荐的因果效果。完整长期成长/习惯和收益结论未建立。

官方未启用/未成功同步/未观察OK分开；未观察不是失败。WA→OK、重复页及关闭授权测试证明官方观察不会改写自报未解，也不会新增本地成功或丢旧训练。

读取侧沿用原画像的revision门禁：SQL在读取前捕获偏好与官方证据revision，条目与总数在同一SQL快照计算；服务器返回前调用learning_evidence_guard复核，读取期间授权/证据改变则409，不释放旧官方状态。内部读取stamp不进入HTTP DTO。离线注入的撤权回归不冒充真实PostgreSQL多连接验证。

## 7. 实际用户路径

1. 在普通或专项推荐查看理由；来源可记录时有明确提示，点击外部题目链接不开始训练。
2. 可“跳过本轮推荐”，或明确“进入思维教练”。新建或恢复由服务器决定。
3. 工作台显示本次来源，原笔记/计时/提示/复盘保留。明确“结束训练”并自报结果；源反馈随训练revision重新读取。
4. 使用“返回能力画像，查看最新训练证据”。新链接遵守原有未保存草稿导航门禁。
5. `/analytics` 查看本窗口的生成/选择/恢复/新建/结束/结果、官方状态和来源基线；再进入原推荐。没有数据或配置不足保持UNKNOWN，不显示伪完成率。

桌面/移动端新增流程验证跳过→新建→保存草稿→从新一轮恢复同一训练→未解→明确另一次训练→自报完成→画像更新和已解排除；第二用户不能读取或选择前者的来源。

## 8. 文件清单

新增：013迁移、`src/lib/validation/training-feedback.ts`、`src/server/learning/training-feedback.ts`、`src/features/learning/training-feedback.ts`、`src/components/learning/training-feedback.tsx`、`src/app/api/v1/learning/training-feedback/route.ts`、对应fixtures/4个unit文件/SQL集成/E2E、本报告。

修改：推荐API及输入/返回类型、数据库RPC类型、Recommendations/AbilityProfile/Workspace、HTTP契约fixture、Playwright与私有E2E复制清单、learning-api与skill-insights测试，以及README/MILESTONES/迁移说明。历史M353原生runner和001–012串行验证显式固定到012，原12份断言保留；013由新增套件完整验收，不把它纳入尚未执行的原生20项。

LLM工厂、免费门禁、Tutor/Review/Prompt/Schema、推荐运行时权重和算法、B3五文件与001–012全部保持原内容。engine.ts仅扩展返回类型，不改运行时算法。没有历史删除或托管操作。

逐项清单（最终工作区，未暂存）：

| 状态 | 路径 |
| --- | --- |
| 修改 | `README.md` |
| 修改 | `docs/MILESTONES.md` |
| 修改 | `playwright.config.ts` |
| 修改 | `scripts/m353-isolated.mjs` |
| 修改 | `scripts/test-offline-e2e.mjs` |
| 修改 | `src/app/api/v1/recommendations/route.ts` |
| 修改 | `src/components/learning/ability-profile.tsx` |
| 修改 | `src/components/learning/recommendations.tsx` |
| 修改 | `src/components/practice/workspace.tsx` |
| 修改 | `src/features/learning/engine.ts` |
| 修改 | `src/lib/supabase/database.types.ts` |
| 修改 | `src/lib/validation/learning.ts` |
| 修改 | `supabase/migrations/README.md` |
| 修改 | `tests/fixtures/supabase-http.mjs` |
| 修改 | `tests/integration/generation-state-consistency.test.ts` |
| 修改 | `tests/unit/learning-api.test.ts` |
| 修改 | `tests/unit/skill-insights.test.tsx` |
| 新增 | `docs/M35_TRAINING_FEEDBACK_VERIFICATION.md` |
| 新增 | `src/app/api/v1/learning/training-feedback/route.ts` |
| 新增 | `src/components/learning/training-feedback.tsx` |
| 新增 | `src/features/learning/training-feedback.ts` |
| 新增 | `src/lib/validation/training-feedback.ts` |
| 新增 | `src/server/learning/training-feedback.ts` |
| 新增 | `supabase/migrations/202610280013_recommendation_training_feedback.sql` |
| 新增 | `tests/e2e/training-feedback.spec.ts` |
| 新增 | `tests/fixtures/training-feedback.ts` |
| 新增 | `tests/integration/training-feedback-database.test.ts` |
| 新增 | `tests/unit/training-feedback-api.test.ts` |
| 新增 | `tests/unit/training-feedback-panel.test.tsx` |
| 新增 | `tests/unit/training-feedback-repository.test.ts` |
| 新增 | `tests/unit/training-feedback.test.ts` |

## 9. 实际检查

最终版本在私有副本 `/private/tmp/algopilot-feedback-checks-zftLNt/workspace` 实际执行；没有调整原断言、原超时、CF共享时隙或冷却。核心命令：

```sh
npm run lint
npm run typecheck
npm run test -- tests/unit/learning-api.test.ts tests/unit/training-feedback.test.ts tests/unit/training-feedback-api.test.ts tests/unit/training-feedback-repository.test.ts tests/unit/training-feedback-panel.test.tsx tests/integration/training-feedback-database.test.ts --maxWorkers=1
npm run test -- --maxWorkers=1
npm run test:recommendations -- --maxWorkers=1
npm run build
npm run test:e2e
git diff --check
```

| 实际命令/范围 | 最终结果 |
| --- | --- |
| lint / typecheck | PASS，exit0，lint零警告 |
| 上述训练反馈专项 | PASS，52/52，6文件；新增42项与原learning API 10项 |
| 全量单元/集成/评测 | PASS，569/569，54文件，99.84秒；原527项保留 |
| 推荐专项 | PASS，36/36，8文件，约79秒 |
| build（含postbuild） | PASS，exit0，Monaco/旧sanitizer检查通过 |
| 离线E2E | PASS，62/62，36.3秒，retries=0；原60项保留，新增桌面/移动各1项 |
| git diff --check | PASS |
| 原生20项 / 013原生多连接 / 托管JWT、迁移和部署 | NOT_RUN |
| 最终Node审计 | PASS：核心23份、E2E17份，均完整、invalid=0，六项计数均0；范围见第11节 |

证据：[核心命令与审计](/private/tmp/algopilot-feedback-checks-zftLNt/checks.json)、[核心日志](/private/tmp/algopilot-feedback-verified.log)、[E2E审计](/tmp/algopilot-gate-e2e-OwGZB5/e2e-audits-dQgEro/checks.json)、[浏览器日志](/private/tmp/algopilot-feedback-browser-verified.log)。临时文件可能被清理，不以真实请求补证。

最终338份非文档/非生成源文件与核心测试副本哈希一致，原12份SQL逐字不变；engine.ts推荐运行时前缀与HEAD一致。E2E只在私有副本使用原有HTTP Mock工厂和浏览器路由保护，源生产工厂不导入测试代码。

截图与桌面/移动溢出断言已检查：[桌面反馈](/tmp/algopilot-training-feedback-m2-desktop.png)、[移动反馈](/tmp/algopilot-training-feedback-m2-mobile.png)。合成用例显示两次明确的新训练、一次恢复、一次未解和一次自报完成，画像每题只算最新完成记录，未把三次选择或多份推荐快照当作三次成功。

## 10. 失败与修复

首轮新增SQL套件发现旧training_sessions没有(id,user_id)复合唯一键，复合FK无法创建；新增013中的等价唯一约束，没有修改历史SQL、降低FK或归属要求。另一个新API测试把两个vi.hoisted写在同一声明，被测试变换器拒绝；改成独立声明。修复后新增专项36/36，扩展到推荐API与导航守卫后50/50。

第一完整轮567/567、推荐36/36、E2E62/62均通过；随后只把界面原始结果枚举换成中文来源说明，对最终版本再验收。没有跳过旧断言、增加超时或减少限流。首轮SQL初始化失败造成的用例未执行不记作通过。

最终隔离审查发现新反馈读取尚未复用在途官方授权revision复核，已在新模块补齐并加2项拒绝旧结果/不公开内部stamp回归；同时把反馈条目与总数合并为单SQL快照。没有改动原画像/推荐权重、历史迁移或门禁标准。最终以包含该修复的验证轮为准。

## 11. 安全与费用

全部检查使用私有临时副本、空HOME、常量环境白名单、排除.env*，沿用未修改的B3禁网/凭据读取guard；仅复用本地依赖，没有安装。E2E只用合成用户/Key/HTTP fixture和私有工厂接线，操作系统沙盒只允许loopback。013只进本地隔离PGlite；原生环境没有新搜索或连接。

最终运行时计数见下表；缺失覆盖标UNKNOWN，不补零。前一轮核心有23份已发布、1份0字节pending未发布，汇总collection_failed；六项功能命令均exit0，但验证器exit1。该测量失败保留，不能宣称从未失败或全进程网络为零。

| 审计对象 | 本轮结果及边界 |
| --- | --- |
| 真实模型生成 / B4 / 付费API或回退 | 0 / 0 / 0；新反馈流程不调用模型，旧测试仅内存/loopback Mock |
| 生产数据库读取/写入、托管迁移、部署 | 全部0；013只在本地合成PGlite环境应用 |
| 真实凭据主动读取 | 0；未读取真实Key或.env，测试仅合成签名材料 |
| 最终核心Node | 23份完整，incomplete=0/invalid=0；networkBlocked/dnsBlocked/credentialReadBlocked/externalHTTP/realDNS/realCredentialReads均0 |
| 最终E2E Node | 17份完整，incomplete=0/invalid=0；上述六计数均0 |
| 最终浏览器页面路由 | 12份worker记录，5169个允许的loopback页面请求、0拒绝；不是所有服务间调用数 |
| 浏览器原生HTTP/DNS、全进程网络/凭据读取总量 | UNKNOWN；计数只覆盖上述Node与页面路由，不把操作系统网络拒绝策略当完整数量审计 |
| 私人数据/源码外发 | 未执行；材料仅复制到本地私有副本。全进程外部流量统计仍为UNKNOWN |
| 安装、拉镜像、系统数据库、Clash/TUN改动 | 0；无新依赖，无原生环境搜索或启动 |
| Git发布/破坏性操作、历史数据删除 | 全部0 |

首个collection_failed轮的 `8187-0.pending` 为0字节；没有删除、补零、原子发布残片或修改B3 guard。后续完整新轮独立通过，不替代原失败记录；未据退出写入缺失猜测外部请求或具体进程终止原因。

## 12. 分类与剩余事项

| 层面 | 可验结论 |
| --- | --- |
| 功能正确 | PASS，本地API/SQL/组件/桌面移动验收；不等于部署 |
| 数据关联正确 | PASS（本地限定），合成数据验证用户归属、来源幂等、恢复不重复归因、历史不覆盖；原生/托管并发未验证 |
| 成长分析可信 | 仅已声明窗口和分母下的可核对事实/快照差；预测与因果效果NOT_RUN |
| 真实训练效果提升 | NOT_RUN，没有新增真人参与或教学效果数据 |
| 真实免费资格 / 原生环境 | BLOCKED；生产门禁默认拒绝，原生20项和013多连接均未验证 |
| B4、生产、013托管迁移与部署 | NOT_RUN，需新的相应授权 |

最终功能FAIL=0；初期建表/测试变换问题和中间轮退出审计FAIL均按第10/11节保留，不宣称从未失败。没有以PGlite/Mock提高原生或真实效果验收计数。

下一阶段可补同一来源的完成时间/主动计时证据契约及更长窗口的覆盖说明；来源记录保留生成与结束两个时间，不从它们的差推断真实解题耗时。013上线前须另行授权并核对001–012、CF HMAC与目标权限；不能因本地PASS直接发布。真实用户价值与因果改进需独立研究。

本轮开发、测试与报告完成后停止，变更留待人工审核。
