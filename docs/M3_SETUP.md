# M3 第一阶段：Codeforces 题库与计划配置

此阶段提供题库、选题和多题计划，不提供 Handle/提交结果/Rating 历史同步、代码执行或自动提交。官方状态一律显示“官方状态未同步”。

## 迁移与签名

先核对目标项目和 001–005 是否已完整应用，只执行缺失的迁移。正式追加 `202610120006_cf_catalog_plans.sql`；不要编辑历史 SQL，也不要在已有对象上重跑建表迁移。006 只新增可信元数据、私有缓存状态/签名配置/幂等收据和计划表/RPC，不删除历史题目、Session、Thought、Code 或 Review。

006 如发现现有 `algopilot_private.tutor_settings` 密钥，会在数据库内用 HMAC-SHA256(`algopilot/cf/v1`, 原密钥) 派生专用 CF 密钥；服务器在未配置 `CODEFORCES_RPC_SIGNING_SECRET` 时使用同一派生方式。该 operation 与 Tutor/Review 分开，CF 不使用模型或 AI 额度。不要公开派生值或原密钥。

如果只用题库而不配置 AI，也可以由管理员单独生成 64 位小写 hex 随机密钥，放入服务端 `CODEFORCES_RPC_SIGNING_SECRET`，并通过管理员 SQL Editor 配置同一值：

```sql
insert into algopilot_private.cf_settings(singleton,signing_secret)
values(true,'<same random secret from deployment settings>')
on conflict(singleton) do update set signing_secret=excluded.signing_secret;
```

不要把真实密钥写入 Git、截图、聊天或日志。修改 Tutor 主密钥时，CF 派生配置也须同步；显式 CF 密钥优先于派生模式。未配置签名且没有缓存时，页面返回明确的不可用状态；已有缓存时继续读取。

## 缓存与上游

- 唯一固定地址 `https://codeforces.com/api/problemset.problems`，HTTPS，不跟随重定向，不抓取用户提供的 URL。
- PostgreSQL 保存规范化元数据与成功同步时间，TTL 6 小时。搜索、过滤、排序、计数和分页均在数据库执行，浏览器输入不会直接请求 CF。
- 全实例共享行锁、3 分钟刷新租约、每个请求至少 3 秒间隔；手动刷新与失败都冷却至少 60 秒。每轮最多两次上游请求，第二次等待 3 秒，每次仍需获取共享请求槽。HTTP 超时 18 秒，响应/签名负载最多 12 MB、50,000 条；失败不覆盖成功快照。
- 新请求优先缓存。过期、手动刷新或首次没有缓存时尝试同步；其他实例同步中/冷却中时展示已有缓存。缓存从未成功同步时返回 503，不展示假题目。页面展示数据库真实成功时间及过期/失败提示。
- 全量发布原子更新版本，不从历史 `problems` 删除已不在最新题库中的题目。历史与计划关联仍有效。普通 JWT 无公共题目 INSERT/DML 权限；发布、租约与请求槽必须有服务端 HMAC 和有效租约。
- 未来 `user.status` 等 CF 调用必须复用此共享限流，跨独立部署/其他系统的出口限频仍需运营协调。服务器无常驻独立后端或定时任务，缓存由登录用户访问/明确刷新触发。

频率依据：[CF 官方 API Help](https://codeforces.com/apiHelp)。数据结构依据：[官方 Problem / ProblemStatistics](https://codeforces.com/apiHelp/objects) 与 [problemset.problems](https://codeforces.com/apiHelp/methods#problemset.problems)。完整题面、题解与源码不来自此接口。

## 入口与证据

`/problems` 支持题号/题名/官方 URL、Rating 范围、Tags 多选（交集）、解题人数排序与分页。无 Rating 保留 NULL；`contestId + index` 是唯一外部标识，支持 C1、长 index 和官方存在的纯数字 index（如 `921/01`）；纯数字 index 用斜杠避免编号歧义。多选最多 200 题，翻页/过滤不丢已选；页面刷新不保证恢复尚未保存的选题。

`/plans` 创建多个计划，`/plans/[id]` 调整顺序、手动进度、移除、重命名/说明、归档/恢复/删除。同题可加入多个计划；同一计划不重复。写入按整个计划 revision CAS，requestId 幂等；冲突 PT409。重排提交完整排列并在同一事务下行锁验证。单计划最多 500 题，列表每次显示最多最近 100 个计划。

计划打开优先返回从该计划关联的未完成且同模式训练；“开始新一轮训练”明确新建记录。每次会话独立展示；同题的其他私人历史单独标注。学习状态不自动覆盖手动计划状态。计划条目保留 CF problem_id，未来可通过官方提交的 contestId/index 关联；未来官网 AC 可更新证据而无需制造会话。当前不模拟提交、不允许客户端写官方 AC。只有已完成 Review 请求且有分析才计入“已生成 AI 复盘”，保存代码快照单独标记。

新训练必须选择可信 CF 题目。`POST /problems` 返回 410，直接自建/空训练旧 RPC 的普通用户 EXECUTE 被撤销；旧自定义记录继续 owner 读取。M2.5 复盘内部空 problemId 创建路径保留兼容；新独立复盘 UI/API 要求选择 CF，已有训练（包括旧私人题）可继续关联复盘。新增 `create_cf_review` 事务绑定可信题目、代码快照和官方链接，保留自报 AC/完整授权与比赛保护。

工作台默认隐藏 Tags，提供名称/编号/Rating 和官方题面链接。补充当前题面上下文保存为笔记历史版本，并保留现有笔记；不会创建题目。请求 AI 时仍使用用户提供的上下文，不把 tags 当题面。

## 接口

- `GET /api/v1/problems?q=&min=&max=&tags=math;dp&sort=newest&offset=0&limit=30`：返回 `{items,total,syncedAt,stale,tags,notice}`，Tags 仅在题库选择页使用。
- `POST /api/v1/problems/refresh`：同源 JSON `{}`，受共享冷却限制。
- `GET/POST /api/v1/plans`：读最近 100 个、创建 `{requestId,name,description?,problemIds?}`。
- `GET/PATCH /api/v1/plans/[id]`：详情；修改动作 `add/remove/reorder/status/edit/delete`，均带 revision/requestId，严格字段白名单。
- `POST /api/v1/plans/[id]/start`：`{itemId,requestId,newSession?,mode?}`。
- `POST /api/v1/sessions`：problemId 必填，mode/statementSnapshot/可选计时沿用。
- `POST /api/v1/sessions/[id]/context`：`{content,expectedRevision,requestId}`；上下文与当前笔记合计有限长，作为显式版本保存。
- `POST /api/v1/reviews`：新增可选 problemId；独立复盘必须带它，关联旧会话兼容。客户端不能写官方状态。

所有接口由服务端 getUser 验证；写入使用用户 JWT 窄 RPC，RLS、归属、同源和 Zod。不存在 service-role 客户端。日志不记录 SDK 原文、载荷或秘密。

## 验收

依次运行 lint、typecheck、test、build、test:e2e。普通 test 用临时 PGlite/pgcrypto 和 Auth 上下文替身；E2E 用 HTTP 契约夹具。真实 CF 下载解析、托管部署、托管真实 JWT 与多连接竞争分别报告，不能互相代替。生产库不得运行破坏性测试/回滚夹具。见 [M3 验收记录](M3_VERIFICATION.md)。
