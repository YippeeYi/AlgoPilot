# 数据库迁移

M0 仅建立目录约定，没有创建数据库或执行 SQL。

M1 在此添加版本化 SQL（所有私人表必须启用 RLS、owner/child owner 策略、索引和约束）。之后再配置 Supabase，并根据 README 执行迁移。不要把此目录存在当作 RLS 已实现。
