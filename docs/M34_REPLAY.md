# M3.4 研究输入、冻结与结果复算契约

沿用 [M3.4研究定义](M34_RECOMMENDATION_STUDY.md) 与 [结果契约](M34_RESULTS.md)，不变更A/B、六个描述指标、选手配对单位或原模板。新增的 `m34-freeze/1` 是私有冻结旁车，`m34-replay/1` 是核对结果；不是新的研究或统计平台，也不是来源/同意认证。

## 只读入口

```bash
node scripts/m34-replay.mjs private-freeze.json private-current.json private-existing-report-directory private-new-verification-directory
```

读取显式冻结旁车、当前m34-results-input/1、已有目录的results.json/report.md；复用prepareStudy、结果字段/来源校验和原报告格式。不会创建、批准、修复或覆盖冻结文件。输入JSON各≤5MB，报告各≤25MB，不跟随输入文件符号链接；输出目录必须不存在，目录0700、文件0600，独占写入：

- replay.json：版本、语义摘要、检查状态、差异定位、独立计数/指标/精确分数、逐记录历史归类。
- replay.md：人工审阅检查摘要，所有不能支持的推断明确列出。
- sources.json：四份原始文件的字节SHA-256收据，独立于可复算内容，不包含原路径或生成时间。

退出码0=VALID；2=INCOMPLETE/NON_COMPARABLE；3=INVALID；4=解析/IO/参数错误。`integrity`与`dataStatus`分开：正确复核一批无效/不完整/不可比较的数据，可以integrity=PASS但数据仍不可用于研究。冻结不一致则不进行统计核对，不能把校验失败当无差异。

## 冻结旁车

```json
{
  "version": "m34-freeze/1",
  "rules": {
    "preparation": "study-preparation/1",
    "results": "m34-results/1",
    "criteria": "m34-observation/1"
  },
  "preparations": [],
  "frozen": null
}
```

这只是**未就绪空模板**，不是正式冻结或参与者记录。实际preparations每项为 `{case_id:"P001/0",input:原prepareStudy完整输入}`；case_id严格为选手ID/block(0或1)，与frozen.blocks一一对应。frozen为原样保存的m34-results-input/1，包含冻结时已有的原始观察（可空），不能用当前数据反向补造。

所有case唯一、不缺失、不多出；重新调用原prepareStudy验证完整池、personalizedIds原排名、seed/enrollmentIndex、版本、范围/主题/目标、授权revision与候选来源声明，并将**全部原输出字段**与冻结prepared核对。没有删除boundary、hash、时间或版本来制造一致。原准备工具泛化支持非负block，但M3.4结果契约只接受既定0/1，范围外不重编号。

冻结与当前：研究ID/来源/标准/reviewer登记保持一致，案例集合与归属严格不变，block全部字段核对。只允许原设计中的两种状态迁移：active→withdrawn、unblinded_at从NULL到不早于冻结的解盲时刻；不允许反向重新同意、更改已有解盲时刻、条件或分组。原始观察按event_id保留且语义完全相同，不能删除、编辑或重复。新观察可追加，修正须沿既有supersedes规则；坏修正和冲突不参与统计。

旁车与原准备输入都由操作者显式提供，哈希不是签名或独立可信时间戳。若有人把冻结文件及全部原件一起改成自洽内容，本地工具不能证明曾经发生过篡改；负责人仍须保管可信只读原件/独立存档摘要及同意、授权、实际协议执行证据。仓库当前没有真实冻结研究数据，本轮只有合成Fixture。

## 独立核对的范围

现有结果工具新增只读inspectStudy内部证据出口，旧evaluateStudy返回DTO和CLI字节保持兼容。该出口只供离线验证；原记录正文不进入复核输出。字段/Zod、来源诊断和错误分类复用已有校验器；因此**不宣称所有验证逻辑完全独立**。

独立实现另行：

1. 从原记录/追加引用关系重建叶节点与撤权集合，不用最新false覆盖历史撤权；对候选记录重新检查归属、共同条件、见过/停止/先修、提示和时间边界。
2. 重新选择每个选手/block的唯一A/B，与原工具选择结果对照，排除重复题、条件不符或不可确认来源。
3. 从校验记录逐项计数raw/各状态/latest/superseded/教师/撤权、有效题对/未配对/原始事件排除、共享题量。原字段诊断的原因定义共享，但排除数量独立归约。
4. 按指标重新处理成对缺失、两组命中/分母，再以选手为单位独立计数。BigInt有理数计算选手差和中位数，不调用原metric/median/reduce实现。
5. 逐值对照结构化报告，逐字节对照原版Markdown格式；有意注入“生成器算错、JSON和Markdown却彼此一致”的测试仍会被独立计算拒绝，而非只比较两次运行。

逐记录状态用SHA定位，分别标明冻结原记录/追加、修正、最新有效、撤权和统计资格，可重叠；既不把修正数当选手数，也不让撤权行因新修正重新入组。

## 哈希、数值与格式

输入必须是严格UTF-8。重复JSON键（包括转义后同名键）、非有限数、超出安全整数范围的值、过深JSON拒绝；不使用last-key-wins或替换损坏字节。没有悄悄清理原件。

语义规范化：对象键稳定二进制排序；blocks/reviewers/observations、旁车case集合是无序集合，eligiblePool同样按内容稳定排序用于语义指纹；prepared的A/B排名、personalizedIds、时间、版本、条件、Tags、主题顺序和NULL全部保留。原prepareStudy仍按它自己的v1规范生成候选hash，复算时不重写它。原JSON数字按既有binary64语义读取，原始字面量仍由字节收据区分；不裁剪/舍入真实输入。

统计计数与分母为整数；选手差的精确分数以字符串分子/分母保留。既定每位选手最多2个block，差值与选手差中位数均可精确binary64表示，严格相等核对，**无epsilon容差**。独立有理数辅助测试还覆盖1/3和1/2的中位数5/12，未借此允许额外研究block。

replay.json/md只依赖语义研究内容，不带运行时间。JSON空白/对象键、明确无序集合的排列变化不会改变它们；sources.json字节摘要会变化。JSON报告可重新缩进，报告数组仍按旧格式排序；Markdown必须与原格式逐字节一致（含版本、口径、换行与边界），不删除实际研究字段来通过检查。UTF-8 BOM/损坏格式不自动修复。

差异报告有固定code、字段路径、SHA定位和前后摘要，不回显原值、额外字段名、自由正文或私有路径。超200项保留总数并标记截断，不将剩余差异当不存在。

## 审计生命周期

`node scripts/check-offline.mjs` 在排除.env*的私有副本运行lint/typecheck/专项/全量/推荐/build；`--targeted`只运行静态与专项。原B3离线guard的拦截器和计数不改。测试预加载器先发布 `.started` 登记，原guard的.json仍是唯一结束计数。

本地Vitest fork stop使用默认SIGTERM（当前安装代码 `dist/chunks/index.DpLw24bj.js`），Node默认信号退出不执行JS exit监听器。新测试预加载器捕获SIGTERM/SIGINT，调用在框架改写前保存的原exit，分别保留143/130中断码，并让原guard正常发布。未延长超时、改变并发或修改框架依赖。SIGKILL不可捕获，必须保留缺失并判FAIL/UNKNOWN。

收集器逐份对应启动与结束、严格版本/类型/计数、未发布pending、损坏/冲突/溢出和browser路由开始/结束。任何缺失返回counters=null/UNKNOWN并使包装器失败，成功测试不能掩盖。浏览器原生后台或未被监控的进程计数仍UNKNOWN。故障测试的合成审计目录与实际检查目录隔离，从不合并或补写真实计数；历史失败记录不追溯改成PASS。

这只是离线工具/本地文件一致性验收，不证明真人采集、实际盲化/冻结授权、可靠教学结论或推荐收益。原生PostgreSQL20项、B4、托管及真实研究继续独立待验。
