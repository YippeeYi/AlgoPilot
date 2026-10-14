# 数据库迁移

M0 仅建立目录约定，没有创建数据库或执行 SQL。

M1 在此添加版本化 SQL（所有私人表必须启用 RLS、owner/child owner 策略、索引和约束）。之后再配置 Supabase，并根据 README 执行迁移。不要把此目录存在当作 RLS 已实现。

M2.5 追加 `202610120005_ac_reviews.sql`：独立授权/代码快照/复盘请求、可选计时创建、共享 AI 入场额度与并发。按顺序隔离验证后部署，历史迁移不改写。Provider/签名沿用 M2，详见 `docs/M25_SETUP.md`。

M3 追加 `202610120006_cf_catalog_plans.sql`：官方元数据可信缓存、共享请求槽/租约与多题计划/RLS/CAS。只执行缺失迁移；先确认 005 完整应用。签名配置及所有接口见 `docs/M3_SETUP.md`。

M3.2 追加 `202610140007_learning_recommendations.sql`。M3.2.1 追加 `202610140008_recommendation_audit.sql`，仅替换候选读取函数，RLS/ACL 与历史不变。007 原始 DDL 重跑会原子拒绝，正式迁移应按版本只执行缺失文件；008 重放稳定。部署须本阶段用户明确授权，隔离验证与真实托管验证不可混称。见 `docs/M321_ISOLATED_SETUP.md`。

M3.2.2 追加 `202610140009_recommendation_fit.sql`；生产应用须明确授权，先核验 007/008 实际版本/函数定义，仅执行缺失迁移。原始 009 建表 DDL 重跑原子失败，依赖迁移账本，不称任意幂等。私有例外表 RLS/无用户授权；候选 RPC 策略 training-fit/1，旧策略应用安全拒绝。见 docs/M322_RECOMMENDATION_REVIEW.md。

M3.3 追加 `202610150010_cf_official_evidence.sql`：公开账号私人证据/检查点/回执，普通 JWT + CF HMAC、scope/租约/CAS/证据 revision；学习读取加入官方覆盖与预算前 AC 排除。追加替换 cf_sync，仅修正已复现的锁前时钟问题，001–009 不修改。010 原始 DDL 重跑原子拒绝，只执行缺失迁移。007–010 当前托管状态未核实，没有生产变更；生产迁移/数据修改/部署须明确授权。见 docs/M33_SETUP.md、docs/M33_VERIFICATION.md。
