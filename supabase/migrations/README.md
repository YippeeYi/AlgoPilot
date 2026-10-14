# 数据库迁移

M0 仅建立目录约定，没有创建数据库或执行 SQL。

M1 在此添加版本化 SQL（所有私人表必须启用 RLS、owner/child owner 策略、索引和约束）。之后再配置 Supabase，并根据 README 执行迁移。不要把此目录存在当作 RLS 已实现。

M2.5 追加 `202610120005_ac_reviews.sql`：独立授权/代码快照/复盘请求、可选计时创建、共享 AI 入场额度与并发。按顺序隔离验证后部署，历史迁移不改写。Provider/签名沿用 M2，详见 `docs/M25_SETUP.md`。

M3 追加 `202610120006_cf_catalog_plans.sql`：官方元数据可信缓存、共享请求槽/租约与多题计划/RLS/CAS。只执行缺失迁移；先确认 005 完整应用。签名配置及所有接口见 `docs/M3_SETUP.md`。

M3.2 追加 `202610140007_learning_recommendations.sql`。M3.2.1 追加 `202610140008_recommendation_audit.sql`，仅替换候选读取函数，RLS/ACL 与历史不变。007 原始 DDL 重跑会原子拒绝，正式迁移应按版本只执行缺失文件；008 重放稳定。部署须本阶段用户明确授权，隔离验证与真实托管验证不可混称。见 `docs/M321_ISOLATED_SETUP.md`。
