# M3.4 离线结果契约与报告

本工具落实 [既定研究方案](M34_RECOMMENDATION_STUDY.md) 的训练题对结果校验，不运行实验、不招募参与者、不调用Provider、不写数据库。研究比较 **A=deterministic/1.3-official个性化排序，B=相同候选/目标/限制下的Rating距离＋可选Tags基线**。Tutor权限、时限与复盘机会是两组共同控制条件；未注册独立AI引导/复盘实验，不输出其因果效果。

原 `study-preparation/1`、m34-study.ts、原观察空模板、M322人工/AI评审包保持原版。原40条AI初评不能直接导入选手研究。本轮增加 `m34-results-input/1`、`m34-observation/1`、`m34-results/1`，是结果字段的兼容扩展，不改变准备算法或研究假设。没有旧数值评分标准，因此保留五类判断，不发明1–5量表或把空值计零。

## 执行

```bash
node scripts/m34-results.ts /private/study/approved-results.json /private/study/new-report-directory
```

输入只读UTF-8 JSON（≤5MB），输出目录必须不存在，父目录须已存在；目录0700，results.json/report.md为0600，均独占写入。不自动覆盖/修复输入、旧报告或历史事件。失败或第二个文件写入失败时保留已写文件供检查，不把不完整输出当成功。程序stdout只记录operation/written/status；IO/JSON错误不打印路径、原文或异常。

退出码：0=VALID；2=INCOMPLETE/NON_COMPARABLE；3=INVALID；4=输入JSON/IO/参数错误。数据无效时仍输出定位报告；无法读取/解析时不猜测原始记录数。所有输出仅适合私有研究审核，不构成公开分享授权。

VALID表示此输入至少有一个可描述的成对指标，不代表研究已收齐两个block或真实验收完成。缺block由registered/expected明确显示，保留部分观察；必要字段缺失、空数据/全部评分UNKNOWN为INCOMPLETE，无可比题对为NON_COMPARABLE，非法/冲突为INVALID。各记录的校验状态、题对可比性与研究完成度是不同层面。

[结果包空模板](m34/results-input.template.json) 不是研究数据，study_id需填写，空记录不算参与者。[观察新模板](m34/result-observation.template.json) 只在原模板上追加criteria_version、conditions_hash；旧模板不自动迁移，缺少身份、版本或条件摘要时返回INCOMPLETE。研究负责人须将来源可证明的字段显式录入私有副本；未知值保留NULL，不从历史画像或训练创建时间补造基线/耗时。

## 结果包

顶层严格字段：

- version=`m34-results-input/1`，criteria_version=`m34-observation/1`。
- study_id：1–80位ASCII字母/数字/下划线/连字符；避免真人姓名或任何密钥。
- data_source：synthetic或declared_human。后者只表示操作者声明，不等于独立证实人工身份/同意/采集过程；输出永久带此边界。合成数据不计真实参与者。
- reviewers：唯一id，kind=participant/teacher/ai，participant_id（选手为P001等，教师/AI可NULL），verified布尔。verified只记录操作者已核对来源的声明，不是密码学身份证明。参与者观察必须匹配本人的注册ID；教师独立保留，AI/未核对来源不进入主分析。
- blocks：每个选手block=0/1唯一，结构如下；最多1000项。
- observations：原事件完整字段加两个新字段；最多10000条，事件/字段不自动归一、填补或重写。

每个block包含：

| 字段 | 内容 |
| --- | --- |
| prepared | m34-study.ts原版输出原样保存；不从画像窗口重建候选资格。engine固定1.3-official，列表每组1–5且同题数、同范围/主题/目标 |
| consent_version / consent_status | 操作者核对的同意版本与active/withdrawn；原consentId仍来自prepared，不能由公开Handle推断同意 |
| provenance_verified | 操作者对授权快照/同意来源的核对声明；false不可比较，true也不能证明声明真实 |
| scenario | 预登记场景ID（ASCII token），报告仅用指纹分组，避免输出私人描述 |
| metadata_time / frozen_at | UTC ISO时间；元数据不能晚于冻结时间；观察不能早于冻结，不以时间差推断解题耗时 |
| unblinded_at | 解盲时间或NULL；未解盲不输出A−B比较。不能早于冻结；无法靠此字段证明实际盲化过程 |
| masked_arms | X/Y到A/B的双射；事件须匹配，防错归组，不证明评估者真的盲化 |
| conditions | 两组共同time_limit_minutes（1–120）、highest_allowed_hint（0–5）、tutor_policy token、review_opportunity=equal；不是模型执行授权 |
| pair | NULL或{pair_id,A,B,theme}；A/B为contestId/index，pair_id全包唯一。一block最多一预登记训练题对，须来自冻结各组、不同题、Rating差≤100、共同主题 |

原prepared只保留候选hash/选中列表，不包含完整池、种子/enrollmentIndex、真实同意原件及执行轨迹。因此校验器能核对结构、hash引用和内部一致性，**不能重新证明600池完整性、实际授权、分配过程随机性或真实相同执行条件**。原准备脚本/研究负责人应保留私有原始输入；禁止为了通过校验补造seed或hash。原准备输出版本绑定原training-fit/1约束，本工具不修改它。

## 观察字段与类别

必填字段必须显式存在；表中可空字段必须写NULL而非删除。原模板所有键继续保留，拒绝额外字段。新criteria_version必须匹配，conditions_hash为conditions对象的规范JSON SHA-256，`conditionsHash()`导出可复算；hash只查一致性，不是签名、来源证据或模型许可。

- event_id/supersedes_event_id：UUID/可空UUID；recorded_at为UTC时间。reviewer须注册，review_type=human或ai。
- participant_id、consent_id/version、block/order、masked_arm/actual_arm、engine_version、pool_hash、metadata_time、evidence_revision、official_revision、scenario、problem_key、pair_id：与当前冻结block和选定题对匹配；无题对时pair_id可NULL。版本/池/授权revision/条件不一致不可比较。
- suitability：适合/偏简单/偏困难/方向不符/理由缺乏证据/NULL，复用既有类别。
- difficulty：偏简单/适中/偏困难/NULL；goal_match、reason_supported、missing_prerequisite、previously_seen、external_help、stopped、withdrawal为布尔或NULL。此前模板未注册其类型，结果v1明确类型；历史自由文本不猜测映射。
- highest_hint_seen：0–5整数或NULL；超过共同allowed值不可比较，不影响生产L0–L5权限。duration_minutes：0–1440有限数或NULL，超过共同训练时限为偏离；仅用户记录，不推断独立性。
- outcome_self_report：not_recorded/solved_self_reported/unsolved/abandoned/NULL。official_verdict：OK/not_observed/not_synced/NULL；不是任意CF Verdict序列。source_match固定unverified，官方OK不能证明代码一致/独立。
- review_source：human/ai/none/NULL；issue_confidence：unknown/tentative/supported/NULL；evidence_refs为有限token数组。
- new_issue、protocol_deviation、suggestion：有界文字或NULL。正文只在输入原件保留，报告不回显。非NULL protocol_deviation作为偏离，即使空字符串也不能当“无偏离”。

未见过、未中止与先修检查须明确支持配对，NULL不可当false。已见/中止/先修缺失或不明、未知执行资格、超时限/提示权限、条件不明等排除整个训练题对；不把中止/缺失当失败。原先的列表适合度评审仍可单独进行，本切片不把这些被排除的行强配成训练结果。

## 追加修正、撤权与批次门禁

同一reviewer/选手/block/problem的新结论必须显式supersedes_event_id，时间严格递增、同一对象/组/题对/同意范围；旧行原样保留。缺父、重复event ID、同ID不同内容、分叉、多根、循环/逆时间或跨对象修正都不能挑方便的值。教师reviewer与选手slot分离，不能覆盖选手；AI不成为人工来源。

INVALID或结构必要信息INCOMPLETE时整包停止配对统计，仍输出原始/有效/无效计数和定位。NULL可空评分本身不是非法记录，但只有两侧该指标均已观察才计入指标分母；全部UNKNOWN不产生比较结论。先修/执行状态等比较条件不满足则NON_COMPARABLE。

任一本人撤权事件（即使后续false），或block声明withdrawn，使该选手全部block退出主分析，不以修正事件隐式重新同意；重新同意需负责人核对新范围。工具不删除原始输入；真实研究保留/删除必须按原同意另行执行，研究者不可继续导入已无权保留的材料。报告只保留汇总与指纹，不复述私人文字。

## 配对、统计与报告

以选手为最终配对单位。每block只对预登记A/B不同题配对；不按相似评分寻找配对，不跨人/跨block补组，不把共同题训练两遍计独立成果。跨block重复同题排除；同人两block顺序须反转；缺第二block显式显示registered/expected，有限样本仅描述。两个block可以按计划共同更新证据版本，但每个block的A/B必须同版本。

6个注册描述维度：适合（suitability=适合）、目标匹配、实际L3+、偏简单、偏困难、理由有据。每个维度只用两侧均非NULL的合格题对，分别列A/B命中数、实际题对分母、单侧缺失、缺失题对数。先在选手内对有效block求比例A、B与差，再报告各选手差的中位数/范围和选手数。题目行数不能冒充独立选手数；高提示/过易/过难比例更高不表示质量更好。

结构化results.json含版本/输入指纹、记录状态与record-sha256定位、原始/有效/修正/最新/教师/撤权计数、配对/未配对/排除原因、各指标分母与选手内结果。notInPairedAnalysis与pairedObservations按原始事件单位，teacherObservations/superseded/exclusions可能重叠，不能相加当总数。pair排除原因也可重叠。空/全缺失为UNKNOWN，不输出0/0。

report.md使用固定版式，同一合格输入重新排列记录、block、reviewer或JSON对象键时字节相同。输入指纹对这三类集合稳定排序，冻结列表排名保留顺序；没有运行时间戳、自由文本、真实ID/同意材料/代码/API Key。SHA仅便于在私有原件中定位；不是不可撤销匿名化或分享授权。

不计算显著性、置信区间或综合教学分，不证明实际预测效度或因果学习收益；没有独立多人同题评审面板，不计算评审一致性。M34人工/AI评审CSV保持自己的review-integration/1体系，不合并成研究参与者。013来源与成长统计缺少随机分配/共同条件/训练前基线，不能自动导入为本研究对照。
