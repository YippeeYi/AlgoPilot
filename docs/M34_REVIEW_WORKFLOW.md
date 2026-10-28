# M3.4 本地人工评审操作契约

沿用 [原研究](M34_RECOMMENDATION_STUDY.md)、[结果契约](M34_RESULTS.md)、[冻结复算](M34_REPLAY.md)。这是推荐列表及已登记训练题对的本地文件工作流；不是 M322 原40项教师覆写工具，也不是新的 Tutor/Review 效果试验。A/B定义、共同候选、原排名、AB/BA顺序、题对、分类评分与选手级统计均保持原版。没有生产页面、数据库或模型接线。

本轮只允许 SYNTHETIC 合成演练。`declared_human`/`verified`/材料检查声明不是实际研究许可或真人身份认证。真实使用必须先满足本页末尾条件。

## 负责人准备

```bash
umask 077
node scripts/m34-review.mjs prepare /private/study/review-setup.json /private/study/coordinator
node scripts/m34-review.mjs status /private/study/coordinator
```

`review-setup.json` 使用 `m34-review-setup/1`：

- `freeze`：已有完整 `m34-freeze/1` 旁车；原准备输入、版本、案例集合和冻结内容必须通过原复算器。必须为未解盲、`observations: []` 的新采集批次；不将已有历史行再当新评分收集。
- `assignments`：`{reviewer_id, case_id}` 数组；case_id沿用 `P001/0`，reviewer必须已在冻结名册登记、verified=true。选手只分配本人案例；教师独立登记，不收AI评审；重复分配或同案例多个选手主评拒绝。
- `materials`：冻结两组全部推荐各一项 `{case_id, arm, problem_key, statement, reason, source, blindness_checked:true, no_solution_checked:true}`。`arm`只在负责人副本存在。缺失/多出/重复材料、同题两组题面不同、来源不符拒绝。合成来源为synthetic，人工声明批次必须为authorized_local；材料只从负责人已经获准保管的本地输入取得，本工具不下载题面/题解。

题面和理由是新分发层的显式材料，不改冻结研究内容。负责人须先人工检查没有条件自称、答案/隐藏解法、私人代码、同意原文或他人评价。工具拒绝若干明显身份/题解标记，但**文本关键词检查不能证明没有答案或盲化完美**；不自动删除、改写或生成材料。不能把包含题解的五题教师研究包直接当作选手材料。

prepare独占创建0700目录、0600文件，保存只读setup副本及摘要manifest。重复prepare不覆盖；改配置需新冻结批次，不能编辑旧setup。不要把真实材料放进仓库。输入UTF-8 JSON≤5MB，重复键/损坏编码拒绝，不跟随输入文件的符号链接。父目录也应由负责人控制，不使用共享或符号链接目录。

## 分发：先适合度，后理由与训练观察

负责人所有控制命令使用：

```json
{
  "request_id": "由本地生成的新UUID",
  "expected_revision": 0,
  "at": "实际操作的UTC ISO时间",
  "case_id": "P001/0",
  "reviewer_id": "已登记的评审者ID"
}
```

这是字段说明，示例占位值不能直接提交。revision取status，未知结果重试保留原命令/ID，新意图使用新ID。重放返回原收据revision；下一意图前重读status/view取得当前revision。命令文件存在分发目录外。

```bash
node scripts/m34-review.mjs issue /private/study/coordinator issue-command.json /private/distribution
```

协调目录和分发根目录必须分离，不能互相包含。issue返回随机UUID子目录；只将**该评审者该阶段的叶目录**交给其本人，不分发父目录、其他叶目录、协调目录或原冻结/准备/结果文件。各人的安全交付和本地文件权限由负责人管理，不发送邮件、不自动外传。

fit包只包含随机案例/评审/冻结参考、X/Y列表、原公开题号/Rating、同等题面、共同训练条件与评分说明。不含actual_arm、私人ID/种子/候选池摘要、推荐理由、答案或其他评分；文件名与哈希也不基于隐藏身份。X/Y映射与原排名来自冻结，**不另做随机排序**，保持既定AB/BA展示顺序。公开题号仍可能令熟悉算法的评审猜测来源，不能声称消除这种推断。

fit正式提交后，负责人执行：

```bash
node scripts/m34-review.mjs release /private/study/coordinator release-command.json /private/distribution
```

release先封存fit，再发新随机叶目录followup，绑定原fit正式快照的摘要。只有此包包含原理由；选手选中训练题标记training=true，教师和其他题只评理由。不公开A/B身份。fit封存后不能再改分；未正式提交的草稿不会因release变成有效评分。followup发送失败用原release命令重试；即使中断发生在fit封存与协调收据之间也可恢复，不能重新开放fit。需要纠正fit内容时必须由负责人记录协议偏离并决定该案例是否排除，不能事后修改盲态初评。

工具按案例处理已冻结block，不更新证据/画像、不准备下一block。若同批次含block1，须有block0选手正式观察，且block1声明冻结时间不早于该观察；时间只是声明，不能证明实际事前冻结。研究负责人仍须按原计划在下一block前同时更新两组真实证据并保存可信新快照；本轮单block演练不等于完成两个block。原报告持续显示实际/预期block覆盖。不得预填未来快照或复制上轮数据冒充下一轮。

## 评审者：保存、恢复、提交与修正

```bash
node scripts/m34-review.mjs view /private/my-opaque-packet
node scripts/m34-review.mjs form /private/my-opaque-packet save > /private/my-save-command.json
```

view显示本人的材料、revision、草稿、历次正式快照及是否有未提交改动。form只创建命令模板和required_fields，不补评分；编辑模板command.changes中各item UUID对应字段，再执行：

```bash
node scripts/m34-review.mjs apply /private/my-opaque-packet /private/my-save-command.json
```

模板外壳可原样保留；也可传纯command对象。支持部分save、关闭终端后view恢复；save返回DRAFT_SAVED，永不进入正式观察。未填写字段保留缺失；不知道且字段允许时须明确写null，不能填0或false代替UNKNOWN。

评分完全复用 `m34-observation/1`：

| 阶段/对象 | 必须明确填写的字段与允许值 |
| --- | --- |
| fit全部列表项 | suitability：适合/偏简单/偏困难/方向不符/理由缺乏证据/null；difficulty：偏简单/适中/偏困难/null；goal_match：true/false/null |
| followup全部列表项 | reason_supported：true/false/null，是否有可核对依据，不代表教学效果 |
| followup选手training项 | previously_seen、missing_prerequisite、external_help、stopped：布尔/null；highest_hint_seen：整数0–5/null（实际已看，不是授权）；duration_minutes：0–1440/null（主动记录，不推算）；outcome_self_report：not_recorded/solved_self_reported/unsolved/abandoned/null；protocol_deviation：≤1000字符/null |

超过该block共同提示/时限的记录仍可如实保存；原校验器将其排除为NON_COMPARABLE，不能改低数字使其入组。见过、缺先修、中止/未观察等继续按原资格规则处理。官方结果本入口始终null，source_match=unverified；自报完成不能变成官方OK，未填提示不等于独立完成。未收集额外复盘/引用字段保留原契约的空数组/null，不制造来源。

```bash
node scripts/m34-review.mjs form /private/my-opaque-packet submit > /private/my-submit-command.json
# 检查所有字段；明确将command.confirm_complete设为true
node scripts/m34-review.mjs apply /private/my-opaque-packet /private/my-submit-command.json
```

正式提交只读取已保存草稿，不夹带新评分，返回SUBMITTED和receipt。缺项给出具体item字段路径，错误分数/额外字段拒绝；没有确认拒绝。相同requestId相同正文重复提交返回原receipt，不增加有效评分；改正文重用ID、旧revision均拒绝。新提交意图不能重复创建第二个根评分。

修改未封存的已提交内容：`form ... correct`生成以最新receipt为supersedes的模板，填changes并确认true后apply。保留全部旧事件和快照，新版本必须有实际变化、较晚时间和正确最新父节点；旧父/分叉拒绝。followup修正导出为原契约的supersedes_event_id链，教师与选手不互相覆盖。临时save可暂存修正，正式correct之前统计仍用上个正式快照。

本地事件每revision一个独占文件，哈希链校验；未提交.pending不进历史，断号/损坏拒绝。原文件从不覆盖。并发写同revision只会一个成功，另一个明确冲突；不自动选最后一次写入。相同OS账号可重写整份自洽文件树，因此这些措施是事故检测和审计，不是远端身份认证或密码学签名。

## 分析、撤权与原工具链

所有拟收集任务完成后，由负责人新控制命令只含case_id（公共request_id/revision/at仍必需）：

```bash
node scripts/m34-review.mjs unblind /private/study/coordinator unblind-command.json
node scripts/m34-review.mjs export /private/study/coordinator /private/new-export
```

unblind只记私有分析解盲，不把身份加回评审包；已发任务必须完成followup。解盲后不能再用新命令发该案例任务。export忽略草稿/无正式followup/未发任务；已有正式观察但尚未解盲时拒绝导出分析。无不同合法训练题对时列表工作仍保存，标记NON_COMPARABLE_NO_DISTINCT_PAIR，不强行配对。只将冻结选中题对的正式记录转成原观察，整张列表和初阶段修改历史留在私有日志，未选项不伪装训练成果。

导出独占新目录：current.json、results.json、report.md、replay.json、replay.md、workflow.json。用原evaluateStudy/renderStudyReport/verifyReplay执行结果校验、选手级A−B、独立复算及JSON/Markdown核对；复算失败不发布。保持同一输入/日志的输出字节一致，无运行时间混入统计。随机任务ID在issue固定；独立重新发包会产生不同ID，不要求两个独立批次摘要相同。导出期间检查协调与已收集任务日志头变化，发现则拒绝；输出是明确revision快照，后续修正/撤权需要新导出。

旧命令继续可用：

```bash
node scripts/m34-results.ts /private/new-export/current.json /private/old-cli-report
node scripts/m34-replay.mjs /private/original-freeze.json /private/new-export/current.json /private/new-export /private/independent-check
```

撤权控制命令含participant_id及本人已登记reviewer_id（不用case_id）：

```bash
node scripts/m34-review.mjs withdraw /private/study/coordinator withdrawal-command.json
node scripts/m34-review.mjs export /private/study/coordinator /private/new-withdrawn-export
```

撤权不可逆，覆盖该选手全部block与教师关联观察。后续issue/release（包括旧请求重放）拒绝；新导出**不再读取**其评审文件，不将后续评分/修正重新引入，observations不收其原/修正行，consent_status保持withdrawn。先前输出不会静默改写；必须撤回过期报告并按真实同意的保留/删除/匿名化规则处置已有副本。本工具不自动删除历史文件，也不能远程召回拷贝，真实撤权后的材料处置仍需负责人授权落实。

CLI正常操作退出0；导出INCOMPLETE/NON_COMPARABLE退出2；可定位契约/操作错误退出3；输入解析/IO错误退出4。stdout JSON，stderr仅固定类别和字段路径，不回显原文、Key或私有路径。常见类别：INVALID_FIELDS、INCOMPLETE_OR_INVALID_ASSESSMENT、REVIEWER_OWNER_MISMATCH、FREEZE_MISMATCH、PACKET_CHANGED、JOURNAL_CHANGED、REVISION_CONFLICT、REQUEST_CONFLICT、FIT_SEALED、CONSENT_WITHDRAWN、ANALYSIS_NOT_UNBLINDED。INVALID原结果仍保留明确状态；不是所有成功文件写入都表示数据可比较。

## 开展真实研究前

负责人须另获当前阶段许可，核对专用托管/JWT/恢复验收、实际知情同意与退出流程、真实候选/题面对照及合法事前配对、独立盲化材料检查、安全的一人一包交付与保管、真实两block的同步冻结及顺序、必要Provider发送的单独授权。本轮不补这些证据、不招募、不评分真人，不将合成身份加入正式0/40、0/5或参与者计数。

工具只帮助按原口径规范记录，不能证明实际真人、独立评分、实际盲化、教学质量或训练效果。验收与合成演练见 [M34_REVIEW_WORKFLOW_VERIFICATION.md](M34_REVIEW_WORKFLOW_VERIFICATION.md)。
