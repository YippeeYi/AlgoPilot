# 数据库迁移

M0 仅建立目录约定，没有创建数据库或执行 SQL。

M1 在此添加版本化 SQL（所有私人表必须启用 RLS、owner/child owner 策略、索引和约束）。之后再配置 Supabase，并根据 README 执行迁移。不要把此目录存在当作 RLS 已实现。

M2.5 追加 `202610120005_ac_reviews.sql`：独立授权/代码快照/复盘请求、可选计时创建、共享 AI 入场额度与并发。按顺序隔离验证后部署，历史迁移不改写。Provider/签名沿用 M2，详见 `docs/M25_SETUP.md`。
