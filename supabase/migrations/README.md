# 数据库迁移

M0 仅建立目录约定，没有创建数据库或执行 SQL。

M1 在此添加版本化 SQL（所有私人表必须启用 RLS、owner/child owner 策略、索引和约束）。之后再配置 Supabase，并根据 README 执行迁移。不要把此目录存在当作 RLS 已实现。

M2.5 追加 `202610120005_ac_reviews.sql`：独立授权/代码快照/复盘请求、可选计时创建、共享 AI 入场额度与并发。按顺序隔离验证后部署，历史迁移不改写。Provider/签名沿用 M2，详见 `docs/M25_SETUP.md`。

M3 追加 `202610120006_cf_catalog_plans.sql`：官方元数据可信缓存、共享请求槽/租约与多题计划/RLS/CAS。只执行缺失迁移；先确认 005 完整应用。签名配置及所有接口见 `docs/M3_SETUP.md`。

M3.2 追加 `202610140007_learning_recommendations.sql`。M3.2.1 追加 `202610140008_recommendation_audit.sql`，仅替换候选读取函数，RLS/ACL 与历史不变。007 原始 DDL 重跑会原子拒绝，正式迁移应按版本只执行缺失文件；008 重放稳定。部署须本阶段用户明确授权，隔离验证与真实托管验证不可混称。见 `docs/M321_ISOLATED_SETUP.md`。

M3.2.2 追加 `202610140009_recommendation_fit.sql`；生产应用须明确授权，先核验 007/008 实际版本/函数定义，仅执行缺失迁移。原始 009 建表 DDL 重跑原子失败，依赖迁移账本，不称任意幂等。私有例外表 RLS/无用户授权；候选 RPC 策略 training-fit/1，旧策略应用安全拒绝。见 docs/M322_RECOMMENDATION_REVIEW.md。

M3.3 追加 `202610150010_cf_official_evidence.sql`：公开账号私人证据/检查点/回执，普通 JWT + CF HMAC、scope/租约/CAS/证据 revision；学习读取加入官方覆盖与预算前 AC 排除。追加替换 cf_sync，仅修正已复现的锁前时钟问题，001–009 不修改。010 原始 DDL 重跑原子拒绝，只执行缺失迁移。007–010 当前托管状态未核实，没有生产变更；生产迁移/数据修改/部署须明确授权。见 docs/M33_SETUP.md、docs/M33_VERIFICATION.md。

M3.5.3 本地追加 `202610260011_review_retry_recovery.sql`，仅替换 `review_reserve`：相同请求编号的 pending 租约已过期时返回 AP006，防止核对请求永远“处理中”；客户端确认后需再次明确点击才创建新编号。已完成请求仍返回缓存，HMAC、归属、额度、租约及 ACL 保持。001–010 未改；011 可重放，应用迁移本身不执行数据 DML，函数既有写入流程保持。正式环境只应用缺失迁移，必须另列目标及变更清单取得新授权，本轮未部署。历史 M35 的目录比较固定在 001–010，不把它作为 011 的托管证明。见 [本轮验收](../../docs/M353_REVIEW_RETRY_VERIFICATION.md)。

免费门禁本身无新表或迁移。联调发现 Tutor 旧 RPC 同样会把已过期的同编号请求永久判为 AP004；普通 JWT 仅能读请求标识，不能读取/修改私有租约，故追加 `202610270012_tutor_retry_recovery.sql`。它只为 `tutor_reserve` 原有失败判断增加过期 pending 条件，返回 AP006，晚到 worker 继续被拒绝；以精确旧片段匹配保护有效定义，未知形态原子拒绝，原形态/已补丁形态可重放，ACL/search_path/HMAC/额度不变。001–011 不改，应用脚本不回写用户数据。012 尚未托管部署，需新的目标与变更清单授权；不能 repair 既有缺失账本。见 [门禁验收](../../docs/M353_FREE_TIER_GATE_VERIFICATION.md)。
