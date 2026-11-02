# R2B-0：现有 Supabase 正式只读核验

2026-11-02，Asia/Shanghai。**主目录只读查询已实际完成；总体 BLOCKED / REVIEW_REQUIRED。** 当前 Review/Tutor 定义不含 011/012 修复，013 新应用对象未观察到，迁移账本 **ABSENT**。存在额外对象及 ACL 差异，没有完整匹配任何参考前缀。未执行迁移或业务写入。

**留存安全单独 FAIL**：本次目录结果曾被 TextEdit 默认暂存到 iCloud 文稿位置，违反“原始结果仅私有目录”的要求。已将本轮新文件移入 0700/0600 私有目录、核实原本地路径不存在并关闭文稿；是否发生 iCloud 同步及是否留有云端版本 **UNKNOWN**。该事实不因本地测试/目录查询成功而撤销。详见第 7 节。

## 1. Git 与授权核对

起始 HEAD **a3180589c527f4ecb0b424c72d564f07e76af8c9**，工作区干净；此前 R2B 复用评估已提交。实际阅读复用评估、R2A、发布缺口、两份固定 SQL 和现有离线比较器。未 reset/clean/commit/push/PR/部署。

负责人本轮明确批准本 Ref 的当前 Dashboard 身份核对、固定主 SELECT 和条件账本 SELECT；覆盖此前只读未授权状态。没有扩展为其他连接方式、用户数据、Auth 操作、配置、备份、迁移或模型权限。

| 文件 | 实际 SHA-256 | 处理 |
| --- | --- | --- |
| `docs/sql/R2_READONLY_STRUCTURE.sql` | `65d8c53d6b358175427fc0bedabbcb358d54eacb3e876b3323c028b0257dde63` | 与批准值相同；执行前从 SQL Editor 完整回拷本机，9277 字节逐字节相同，再运行 |
| `docs/sql/R2_READONLY_LEDGER_VERSIONS.sql` | `60a85e0e19e7a74a4018fd979349df998a8f83041fee8f082fd4441b5bb54f2a` | 与批准值相同；条件不满足，**未执行** |

执行过程中没有修改这两份 SQL、数据库角色、row limit、超时或其他配置，没有调用业务 RPC。

## 2. 当前 Dashboard 身份与执行目标

使用当前已有的 **Microsoft Edge Supabase Dashboard 会话**，通过原生受控 UI 核对，不使用旧文档/本地环境来推断：

| 身份项 | 当前实际观察 | 结论 |
| --- | --- | --- |
| Ref | Dashboard 项目及 SQL Editor 路径均为 `qmlsgwbiiqpbelgkgsdw` | PASS |
| Project URL | 项目 Overview 显示 `https://qmlsgwbiiqpbelgkgsdw.supabase.co` | PASS |
| 所属组织 | 当前导航中的组织与受验项目归属已核对；报告不导出组织标识 | PASS（观察范围） |
| 分支/环境 | 当前导航明确 **main / PRODUCTION** | PASS；继续按生产保护，不重标 TEST |
| SQL Editor 目标 | Query source → **Database / Primary database**，同一 Ref/main 上下文 | PASS（Dashboard 目标绑定范围） |
| 执行身份 | UI 显示 **Run as postgres**；未更换角色 | 仅用于获批目录 SELECT，不作为普通 JWT/RLS 运行时证明 |

没有点击 API Key/密码显示、读取 Cookie/Token、CLI 缓存、.env 或数据库连接串。没有使用替代 API/psql 凭据绕过 Dashboard。用户切换浏览器时工具曾拒绝继续操作；重新读取当前状态后才返回本轮查询标签，未在其他页面提交内容。

这是当前控制台与查询目标的绑定证据，不是额外 current_database/current_user SQL 或服务端连接遥测证明。本轮没有临场增加身份查询。

## 3. 实际远端执行与结果

**2026-11-02 08:45:38.034 UTC（16:45:38.034 +08:00）**，在执行前最后复核 main/PRODUCTION、Primary database/postgres 后，显式点击 Run selected **1 次**。待执行文本来自固定文件，完整回拷的 SHA-256 相同；没有手工重跑。UI 返回 **1 row / audit**，没有显示 SQL 错误；未采集服务端 SQLSTATE，不能补写 00000。

后续只是查看/复制该结果及本地比较，没有再运行远端 SQL。Dashboard 内部请求/重试次数没有网络插桩，UNKNOWN；执行前回拷哈希不冒充服务端查询日志签名。

结果是预期 `r2-catalog/1` 对象，PostgreSQL **17.11**：

| 目录维度 | 实际数量 | 对 010 本地参考的比较 |
| --- | ---: | --- |
| 函数 | **40** | 仓库预期的 39 个全部匹配；另 1 个函数不在参考内 |
| 普通/分区表 | **26** | 26 个对象齐全；16 个原始表 ACL 有差异，其余所查字段相同 |
| 列 | **235** | 类型/NOT NULL/默认摘要/列权限等所查字段全部匹配 |
| 索引 | **63** | 全部匹配 |
| 约束 | **168** | 168 条普通约束匹配；本地 PG18 的另 179 条 NOT NULL 目录项经远端列 attnotnull 逐项等价核对 |
| Policy | **16** | 所查字段全部匹配 |
| 项目普通 Trigger | **3** | 所查字段全部匹配；不是 event_trigger 挂载清单 |
| RLS | **26/26 表启用** | 仅目录事实，不冒充双用户运行时隔离 |

原始 JSON 为 184022 字节，已核实的当前本机副本保存在私有证据目录，不进入 Git；云端/历史副本仍 UNKNOWN，见第 7 节。文件完整性 SHA-256：`fd2d1a87e004c06edf63e4120cdafbe82ed57b090ba2e6d577a5ea3deaaf6882`。

结果查看器/TextEdit 的辅助功能文本一度只显示末尾片段；没有将该片段当作完整目录或重新运行 SQL。最终从本轮保存文件解析完整 JSON，验证 format/各目录数组后再比较；片段读取问题与数据库执行失败分开记录。

## 4. 011、012、013 与有效前缀

本机重新运行现有 R2A 工具，生成 010/011/012/013 四前缀目录参考（PGlite 18.3，仅本地参考），并核对 13 份迁移源哈希。使用既有 `r2a-hosted-readiness.ts plan` 对私有远端 JSON 比较；没有修改比较规则/白名单，没有自动生成可执行迁移。

### 011 Review / 012 Tutor

| 函数 | 远端 definition MD5 / body MD5 | 与批准参考比较 |
| --- | --- | --- |
| `review_reserve(text,text)` | `7bc3bd6a95bfe6563186b77efba6d3a1` / `38c0945e011c5aded01c82f17a3037d9` | 精确匹配 **010**；与 **011–013** 的 Review 恢复定义不匹配 |
| `tutor_reserve(text,text)` | `48c33d31f913248421886360909e0933` / `193b70165ed7219e2f8ad569cebc3b8d` | 精确匹配 **010/011**；与 **012/013** 的 Tutor 恢复定义不匹配 |

011 的 Review 参考 body MD5 为 `31ca3c0fd9af73bababd23c29eca16be`；012 的 Tutor 参考 body MD5 为 `2e19d4057a0fc9b41a9cbf3ecf8bb53f`。这里的摘要只用于函数代码比较，不是密钥摘要。

两函数实际的签名、返回值、语言、owner、SECURITY DEFINER、search_path、ACL 及有效 EXECUTE 与相应本地参考匹配：SECURITY DEFINER=true、`search_path=""`，PUBLIC/anon EXECUTE=false，authenticated EXECUTE=true。**权限收敛匹配不补足函数实现缺口。**

可确认的是当前有效定义不包含 011/012 修复；不能据此断言它们在历史上从未执行或被覆盖。

### 013 新应用对象

在本次批准的普通应用对象目录范围内均未观察到：

- `algopilot_private.recommendation_trials` 表及其 11 列。
- `training_sessions_id_owner_key` 组合唯一约束。
- `recommendation_origin_once`、`recommendation_trials_owner`，以及 013 新表/约束所带来的其余索引目录项；对 013 共缺 5 个索引目录项。
- `record_recommendation_run`、`recommendation_choice`、`recommendation_training_evidence` 三 RPC。

与 013 比较缺 15 个新增约束目录项；其中包含 PG18 的相应目录表示，不能把这个数字都解释为独立业务外键。013 有效结构 **不匹配**。查询没有穷尽视图/平台/扩展等所有对象类型，不能据此保证直接 CREATE 不会冲突。

### 严格比较结果

| 参考前缀 | 完整函数匹配数 | 总差异数 | 结论 |
| --- | ---: | ---: | --- |
| 010 | 39/39，另 1 个额外函数 | **18** | MISMATCH |
| 011 | 38/39，另 1 个额外函数 | **19** | MISMATCH |
| 012 | 37/39，另 1 个额外函数 | **20** | MISMATCH |
| 013 | 37/42，另 1 个额外函数 | **55** | MISMATCH |

010 的 18 项为 16 张表 ACL、1 个 schema 比较差异及 1 个额外函数；011 再增加 Review 定义差异，012 再增加 Tutor 定义差异；013 进一步增加缺失对象。差异计数是比较器定义的目录行/分组数，不是风险事件数。

因此，**应用核心对象/函数最接近 010，但没有完整前缀 MATCH**。不能标“001–010 已全部执行”，也不自动把平台差异认定为可忽略。

## 5. ACL、额外对象与账本

| 差异 | 当前证据 | 处理 |
| --- | --- | --- |
| 16 张表的原始 ACL | 唯一变化字段为 acl；相对参考多出 service_role 的 MAINTAIN / REFERENCES / TRIGGER / TRUNCATE（grant option=false），未观察到删除的 ACL 条目 | 保留差异，来源/必要性待维护者审阅；service_role 在此仅为目录角色名，未读取该角色的 Key |
| public schema 原始 ACL | 相对参考多出 anon/authenticated/postgres/service_role 的显式 USAGE，grant option=false；owner 与其余所查字段相同 | 不自动白名单，不修改 GRANT/REVOKE |
| 普通角色/有效权限 | anon/authenticated roleCapabilities 与参考相同；235 列权限及表的有效 anon/authenticated 标志匹配 010 | 仅元数据范围，不证明实际 JWT/PostgREST/RLS |
| 额外函数 `public.rls_auto_enable()` | 返回 event_trigger；SECURITY DEFINER=true、search_path=pg_catalog；PUBLIC/anon/authenticated EXECUTE=true | 不属于仓库 39 函数；**来源、挂载和实际影响 UNKNOWN**。未调用它，也未补查 pg_event_trigger/函数正文；不能仅凭名称判为平台安全对象或已证漏洞 |

账本主查询实际返回：migrationHistoryExists=false、ledgerVersionColumn=false、ledgerReadShape=null。记录 **ABSENT**，不记为空版本数组或已一致。账本查询的读取条件不成立，**未执行第二份 SQL**，未修复/补建/补记账本。

现有 planner 实际返回 **BLOCKED**，effectiveThrough=null、effectiveState=PARTIAL_OR_UNKNOWN、proposedMissing=[]、executionEnabled=false、historyDataEffects=NOT_PROVEN。没有生成可直接执行的迁移清单。

## 6. 是否提出后续迁移申请

现在有真实目录证据支持将 **011 Review 恢复、012 Tutor 恢复、013 推荐来源/反馈**列为后续变更评审议题；这不是本轮迁移批准，也不是可执行计划。

在进入任何生产变更前仍需：维护者审阅 ACL/schema/额外函数来源及实际影响，独立治理缺账本的证据；确认备份/恢复能力、版本/锁窗口/在途请求、既有训练/笔记/Review 的保护与兼容安排；先审阅并授权本机完整 Supabase 环境。不得因目录接近 010 而重放 001–010 或自动 repair/push/pull。

数据回填/种子/历史副作用未查询，全部 **NOT_PROVEN**；未读取用户行、私人内容或签名配置，未核对真实 JWT、两用户 RLS、Cookie、共享托管租约/多实例、模型资格/usage/费用，也未导出备份或演练恢复。任何后续额外系统目录查询、数据导出或写入均需新范围；本轮不追加。

## 7. 留存事件与网络/凭据审计边界

### 留存要求 FAIL，缓解已完成但同步仍 UNKNOWN

完整结果经 UI 复制到 TextEdit 后，默认自动暂存到了 iCloud 文稿目录，文件创建时间 **08:49:17.189 UTC**、权限 **0644**。未预先固定该原始结果文稿的私有位置，是本轮操作错误；没有将此过程标成安全 PASS。

发现后立即停止进一步远端操作。先验证这是本轮新建文件（创建时间/大小/预期 r2-catalog 对象），再将其原字节移动到 `/private/tmp/algopilot-r2b0-r0frq7/remote-catalog.json`，设为 0600，父目录 0700；**08:53:21 UTC** 已记录缓解。之后确认原本地路径不存在，关闭该结果文稿，并用固定 SQL 替换剪贴板内容；08:56:25 UTC 和后续复查仍确认原本地路径不存在。没有删除/修改其他用户文稿、扫描 iCloud 账户或处理云端版本。

完整 JSON 解析及基础模式检查未发现邮箱、JWT、常见 Key 前缀、数据库 URI、UUID 字面量；这不是完整 DLP 证明，也不能证明 iCloud 未同步。**是否有云端副本/历史版本、系统自动恢复/版本缓存残留、系统层流量及同步状态 UNKNOWN**，不声称已消除所有副本，需负责人单独审阅是否检查/处理。助手没有读取 iCloud 凭据、擅自删除云端内容或清理用户历史/系统目录。

已核实的本机原始目录、ACL 明细、身份/执行记录、比较器输出、事件记录保存在该私有目录，均不加入 Git；尚不能排除云端/历史副本。报告只写必要身份状态、版本、哈希、计数和差异类别，不包含用户邮箱/UUID 映射、正文、Cookie/Token、密码、Key 或原始环境。

后续不得沿用这次默认暂存流程：任何结果复制前先建立并验证私有目标/权限，若无法可靠固定保存位置就由负责人手工保存并回传脱敏材料，不复制到未保存的新文稿。此项是流程修正，不自动修改用户 iCloud/浏览器全局设置，也不将本轮已发生的 FAIL 改成 PASS。

### 各层审计分开

- Dashboard 原生浏览器、剪贴板/TextEdit 和系统 iCloud 没有 Node 网络/DNS/文件读取插桩；发生过真实 Supabase 只读访问，不能把整轮 externalHTTP/DNS 写成零。Dashboard 后台请求、内部重试、Studio 草稿/查询历史持久化、iCloud/OS 活动的完整计数 **UNKNOWN**。没有点击 Save/Share/AI Assistant，但不据此声称服务内部零写入。
- 固定主 SELECT 通过当前受控 Dashboard 会话提交；未读取/导出该会话的 Cookie/Token，未使用 .env、CLI 缓存、连接串、数据库密码或 service-role Key。已有浏览器内部使用会话凭证不等于本轮证明全设备凭据读取计数为零。
- 审计覆盖的本地参考/比较进程继续使用原 lifecycle/diagnostic/B3 guard。其计数只代表受监控进程，不能给上面的留存事故洗绿；未关闭保护器或改全局网络/Clash/TUN。
- 未对业务/测试用户调用注册、登录、刷新或退出等 Auth 操作，没有业务 RPC、账号创建、数据 DML/DDL/权限/配置、备份、CF 同步、真实模型、B4 或部署；Dashboard 自身认证后台活动仍未完整计量。源仓库生产模型默认拒绝不变。旧两次网络拦截及 R1 额外拦截的 FAIL/UNRESOLVED 也不改写。

## 8. 本地验证、文件与最终状态

| 实际命令/检查 | 结果 | 边界 |
| --- | --- | --- |
| 2 份 SQL 源文件哈希 + 编辑器回拷 | **PASS**，主输入 9277 字节与批准文件完全相同 | 本地文件与执行前 UI 输入证据，不是服务端 SQL 日志 |
| 主 SELECT / 条件账本 SELECT | **主查询成功；账本 NOT_RUN（ABSENT）** | 唯一显式远端执行；不读取业务行 |
| `node scripts/check-offline.mjs --hosted-readiness` | **36/36 PASS**，Node **10/10 PASS / CORRELATED** | 本地四前缀/PGlite 与审计测试，不是托管业务测试 |
| 既有离线 `r2a-hosted-readiness.ts plan` | **预期退出 2 / BLOCKED**；proposedMissing=[]，executionEnabled=false | 私有完整远端 JSON 对四前缀比较；该 CLI Node 审计 **1/1 PASS / CORRELATED** |
| `node scripts/check-offline.mjs` → lint / typecheck | **PASS / PASS**，lint 0 warning | 私有副本，无真实 .env 或继承凭据 |
| 同上 → 相关专项 / 全量 test | **265/265 PASS / 881/881 PASS（77 文件）** | 单元、合成数据库和录制重放；没有新的托管用例 |
| 同上 → recommendations / build + postbuild | **36/36 PASS / PASS** | 不改权重，不是部署 |
| `git diff --check` + 新报告 whitespace 检查 | **PASS** | 最终两份文档 |
| 原生 34 项、桌面/移动 E2E、本机完整 Supabase | **本轮 NOT_RUN** | 复用 R1/R2A 历史结果，不将 Dashboard 浏览器操作算产品 E2E |
| 数据留存要求 | **FAIL；已缓解，其他副本/同步 UNKNOWN** | 不被以上功能/Node PASS 覆盖 |

完整回归日志 `/private/tmp/algopilot-r2b0-full.log`；报告 `/var/folders/tw/b3ckg3250kd_tv1mh95l05740000gn/T/algopilot-replay-checks-IuFTbl/checks.json`：六阶段 Node **2/2、3/3、40/40、112/112、10/10、34/34**，合计 **201/201**，均 audit PASS / CORRELATED / issues=[]。准备专项日志 `/private/tmp/algopilot-r2b0-reference.log`，参考及报告在 `algopilot-replay-checks-26WQ1c/`。

这些受监控本地阶段的 networkBlocked/dnsBlocked/credentialReadBlocked/externalHTTP/realDNS/realCredentialReads 均为 0；嵌套合成拒绝/故障注入仍保留预期 FAIL/UNKNOWN。它们不覆盖真实浏览器、TextEdit、系统进程或 iCloud，不能作为整个会话安全计量。完整私有比较/事件/测试摘要保存在 `/private/tmp/algopilot-r2b0-r0frq7/`，均不加入 Git。

逐字核对 **312** 个源码/配置/测试/迁移及 R2 SQL 文件与最终全量副本一致。最终 HEAD 仍是 **a3180589c527f4ecb0b424c72d564f07e76af8c9**；仅新增本报告、修改 `docs/MVP_RELEASE_GAPS.md`，共 **2 文件，未提交**。生产源码、001–013、两份固定 SQL、R2A 工具/测试、原生设施、原保护器/收集器及 package/lock 均未修改。旧验收报告/原失败未改写。

**PASS（有限范围）**：固定哈希、当前 Dashboard 目标核对、主目录 SELECT 成功及本地比较完成。**FAIL**：原始结果曾在非私有 iCloud 默认位置暂存；保留事件。**BLOCKED / REVIEW_REQUIRED**：当前完整结构/账本/额外对象/权限与迁移治理、整体留存审查。**NOT_RUN**：条件账本查询（账本 ABSENT）、真实用户/业务/迁移/备份/模型/本机完整 Supabase。**UNKNOWN**：iCloud 同步/云端版本、额外函数来源/实际挂载影响、数据效果/恢复能力及未插桩计量。

本轮到此停止，不自动进行补查、iCloud 清理、迁移、安装、完整 Supabase 或其他阶段。等待负责人审查目录结论和留存事件后决定下一步。
