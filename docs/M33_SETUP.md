# M3.3 官方证据配置与恢复

本服务仍只做推荐题目、分析题目/代码、分析选手能力。账号设置是证据入口，未新增提交浏览器、Rating 图表或比赛功能。实现基线 `bc76e52`；验收和未验证项见 [M33_VERIFICATION.md](M33_VERIFICATION.md)。

## 数据库与配置

001–009 不修改，新增 `supabase/migrations/202610150010_cf_official_evidence.sql`。先核对目标迁移表、函数定义和授权，只应用缺失迁移；010 原始 DDL 重跑会原子拒绝，并非任意幂等部署脚本。**未经当前阶段明确授权，不执行生产迁移、生产数据变更或部署。** 本阶段没有托管变更。

沿用 Supabase SSR Cookie/getUser、用户 JWT 及 [M3 CF 签名配置](M3_SETUP.md)：可使用 CODEFORCES_RPC_SIGNING_SECRET，或从 Tutor master 按 algopilot/cf/v1 派生；数据库 private.cf_settings 必须对应。没有新增 CF API 密钥、密码或 Cookie。配置存在不等于部署/联通完成。签名 operation=cf_account，与 cf_sync 分开；浏览器只接收状态 DTO，不接收 nonce/scope/租约或签名。

专用管理只读连接可检查以下元数据（未在本阶段托管执行，不读取个人表/密钥）；仅迁移版本行存在仍不足，须比对实际函数定义、索引、RLS 和 GRANT：

```sql
select version from supabase_migrations.schema_migrations
where version in ('202610140007','202610140008','202610140009','202610150010');
select oid::regprocedure, pg_get_functiondef(oid), proconfig,
       has_function_privilege('anon',oid,'EXECUTE') as anon_execute
from pg_proc where pronamespace='public'::regnamespace
and proname in ('learning_evidence','learning_candidates','learning_evidence_guard',
                'cf_account_state','cf_account_command','cf_sync');
select relname,relrowsecurity from pg_class
where relnamespace='algopilot_private'::regnamespace
and relname in ('recommendation_restrictions','cf_accounts','cf_submissions','cf_account_receipts');
select tablename,indexname,indexdef from pg_indexes
where schemaname='algopilot_private'
and tablename in ('cf_accounts','cf_submissions','cf_account_receipts');
```

010 增加私人 RLS 表 cf_accounts、cf_submissions、cf_account_receipts，无普通用户直接 SELECT/DML；只有空 search_path、显式 auth.uid、签名归属的窄 RPC。账号设置用 revision CAS；证据修改另递增 evidence_revision，推荐/画像结束前由 learning_evidence_guard 检查。私有批次及请求回执防重复/冲突，业务失败 PT409，未知确认结果保留相同 requestId 重试。HMAC 不为客户端授权生成“官方”事实。

010 替换 learning_evidence/learning_candidates 并添加 guard；原签名和既有字段保留。经跨连接复现后，仅把旧 cf_sync 的时钟读取移到全局行锁之后，保持 HMAC/接口/发布/ACL 契约，避免锁等待耗尽 3 秒时隙。Tutor、Review、配额、历史与计划不变。

## 账号操作与同步

`/settings` 关联/替换公开 Handle，经 user.info 当前账号校验，默认分析关闭。公开 Handle 和 registrationTimeSeconds 是变化哨兵，**不是账号归属证明，也不是不可变官方用户 ID**。历史别名跟随关闭；Handle 改名需重新关联。启用分析前重新校验；注册时间改变或账号失效时撤销旧证据参与，并保留失败状态。更换、解除、删除清除该用户采集行/旧作用域、检查点和相关回执；留下无 Handle 的 revision 墓碑防旧写返回，保留原训练/复盘/计划。关闭分析仅停止参与，采集数据仍可主动删除。

接口：

- GET `/api/v1/codeforces-account`：私人状态/覆盖/失败信息，无提交列表。
- POST 同路径：严格 bind、consent、unlink、delete 的字段白名单。
- POST `/api/v1/codeforces-account/sync`：requestId + revision，不接受客户端提交、Verdict 或身份字段。

首次同步、刷新/继续同步是同一恢复入口。每轮先校验身份，最多各一页 head/history/pending；每页 200，逐批独立事务提交。上游开始前使用 90 秒时间预算（等待时隙后再次检查），路由 maxDuration=120；大历史需要多轮手动继续，暂无后台自动同步。部署平台须支持此时长，未知数据库传输可能由平台中断；中断由租约和检查点恢复。完成请求重放不再次采集，失败/超时保留已提交检查点。冷却或其他实例执行中明确返回未采集提示，不冒充刷新成功。

user.status 的 ID 降序/from=1 基于[官方方法文档](https://codeforces.com/apiHelp/methods)。分页重叠 40，连续页验证前页最末 ID；丢锚或 EOF 探针仍有数据时重新开始当前遍历，旧事实保留，不提升完整性。短页后必须真的请求空尾页；固定页数/预算均不意味着完整。fullScanUpperId 表示此前一次观察到尾部的提交上界，非实时原子快照。新提交高水位独立更新，增量仍未连到旧边界时保留待续。每次完整历史扫描只撤下该遍历上界内未再出现的旧提交，不把撤下解释为能力不足。

每次刷新继续历史重扫，完成后下一次重开扫描以发现旧 Verdict 变化；待判（NULL/TESTING/SUBMITTED）另从已观察位置附近复查。位置受新增影响，剧烈漂移时可能需依靠持续历史扫描重新找到待判；不会把未找到当作终审。没有官方按 ID 定点查提交的接口，不能保证即时发现所有旧题重判。

题库与账号共用同一 PostgreSQL cf_cache_state.next_slot_at。锁后取时钟，3 秒保守间隔满足[官方每两秒最多一次](https://codeforces.com/apiHelp)；每次上游尝试重新取槽，数据库事务结束后才网络调用。共享争用最多等三次，HTTP/API FAILED/超时最多两次上游尝试，3 秒退避，失败冷却 30 秒。18 秒请求 timeout、3 MB 响应上限、固定 HTTPS、禁止重定向；外部多应用使用同一出口的其他流量不在本项目协调范围。

显式 includeSources=false，不保存源码/语言/资源/测试数/官方 Rating/联系方式；只保存提交 ID、题号、创建时间、Verdict、采集更新时间、身份 scope 与覆盖元数据。队伍提交只说明包含该公开 Handle，不证明独立。缺 contestId 的提交保留不可定位状态，不编造题目映射；题目 Rating/Tags 仅从现有可信题库匹配，缺失保持未知。

## 分析与回归

deterministic/1.3-official 保留主权重、专项 1/0.75/0.25 和原难度模型。已启用来源的全历史不同题目 OK 在 600 候选前排除，主动重练可绕过。画像取最近 500 道不同官方 OK，训练/官方重合只计一个题目样本但来源分列；弱项仍按实际训练计算，不被大量 AC 稀释。近期所选难度的最多 20 道官方覆盖参与既有新颖度/探索因素，不自动升难度或证明掌握。官方、自报、系统提示与 AI 仍分别引用。

没有持久化派生画像/推荐缓存；响应 private,no-store。关闭/删除递增证据版本并拒绝在途旧结果，新请求重算；已打开页面的历史展示需刷新，不能称当前实时事实。删除不删除用户的训练复盘学习记录。

```bash
npm run test:recommendations
M33_EVALUATION_OUTPUT=docs/m33 npm run test:recommendations
M33_ALLOW_DATABASE_TESTS=isolated npm run test:isolated:m33
M321_ALLOW_DATABASE_TESTS=isolated npm run test:isolated:m321
```

原生隔离运行时安装见 [M321_ISOLATED_SETUP.md](M321_ISOLATED_SETUP.md)，仅测试目录依赖，不进生产包。脚本只创建/清理本机临时 loopback 集群，不读取生产 URL。

`npm run record:cf:public` 显式对官方文档示例公开账号发三次匿名请求（间隔 >=3 秒），默认输出 /tmp；M33_RECORD_OUTPUT 可指定录制路径。真实响应最小化保存，仅用于解析/重放，不当作当前用户画像。原始响应只存 SHA-256，不存已丢弃的个人/源码字段。请勿把公开录制称作完整历史或托管 JWT 验收。

真人评审原表与覆写流程见 [M322 报告](M322_RECOMMENDATION_REVIEW.md)。五道替代题单列 [replacements-for-review.csv](m33/replacements-for-review.csv)，按 scenario + problem_key 关联；原人工/AI 文件未覆盖，AI 不能计作真人或线上能力证据。
