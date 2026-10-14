# M3.2.1 隔离验证与部署准备

生产变更必须获得本阶段明确授权。本轮仅使用 PGlite 和全新临时原生 PostgreSQL；没有连接生产 Supabase，没有操作生产用户数据。

## 可重复评测

```bash
npm run test:recommendations
M321_EVALUATION_OUTPUT=/tmp/algopilot-m321-evaluation npm run test:recommendations
```

默认读仓库压缩录制 `tests/fixtures/cf-problemset-20261012.json.gz`，11,450 题，解压后的 SHA-256 为 `fbcc43b5658f0cdd24fa412aafb2c18e05dadb0420ca293ad845af692dccf4eb`。这就是 M3 历史验收下载的官方响应，没有宣称本轮实时请求成功。可以显式设置 `CF_REAL_RESPONSE_PATH` 使用其他 JSON/gzip 录制；报告会记录路径和内容哈希。

合成历史来源、固定算法基线与场景在 `tests/evaluation/`。测试专用缓存 UUID 从 CF 外部键确定性映射，解决新建测试数据库 UUID 随机初始化造成的评测差异，不改变生产 ID 策略。给定同一输入/缓存，推荐与候选稳定；耗时数字会随机器变化。输出评审 CSV 可人工填写，自动程序不会填写教学结论。

## 原生 PostgreSQL、多连接

本机无 PostgreSQL CLI，因此本轮在 `/tmp` 安装仅供测试的 `embedded-postgres@18.4.0-beta.17`。按其[官方说明](https://github.com/leinelissen/embedded-postgres)初始化和停止进程；未设置 createPostgresUser，不创建系统账户。项目依赖/锁文件没有新增数据库运行时。

```bash
npm install --prefix /tmp/algopilot-m321-runtime --cache /tmp/algopilot-m321-npm-cache embedded-postgres@18.4.0-beta.17 pg@8.16.3
```

若 npm 禁止 postinstall，按包内 `hydrate-symlinks.js` 说明，在对应平台包目录内显式执行该脚本。测试运行：

```bash
M321_ALLOW_DATABASE_TESTS=isolated npm run test:isolated:m321
```

可设置 M321_RUNTIME_DIR 指向测试运行时、M321_EVALUATION_OUTPUT 指向结果目录。脚本不读取外部数据库 URL；创建新临时目录、随机端口，服务只绑定 127.0.0.1，使用新库 `algopilot_m321`，退出时关闭客户端、停止 PostgreSQL 并删除该集群目录。系统账户和生产数据库不受影响。

实际运行 PostgreSQL 18.4，三个不同 backend PID 的连接，验证真实锁等待/CAS/反馈追加、statement_timeout 回滚和幂等重试、RLS/GRANT/HMAC/历史兼容及授权撤销。auth.users/auth.uid 和身份 claims 是测试上下文，**不是 Supabase getUser、JWT 验签或托管 PostgREST 验收**。

## 迁移契约

- 001–007 不编辑，008 只 CREATE OR REPLACE learning_candidates，同签名/返回结构/权限，增加确定性筛选公平性，不增加持久表或数据写入。
- 007 原始 DDL不能直接重复运行：已存在索引会触发 42P07，事务原子回滚。正式迁移工具需记录版本并只应用缺失迁移，不应把事务安全误称为任意重跑幂等。
- 008 可重复应用，本轮实测函数定义不变，其他函数/原有记录保持；先核对 007 存在。
- 部署 007/008 前确认 001–006 完整应用，只执行目标库缺失的正式文件。禁止“修复”时重跑历史 SQL、关闭 RLS 或使用 service-role 写私人数据。

## 生产授权后待执行

1. 只读核对目标环境、已应用版本、关键对象/索引、RLS/ACL/search_path，以及旧函数/历史表存在性；不读取秘密或无关用户正文。
2. 按明确授权仅应用缺失 007、008。核对 learning_candidates 函数定义与仓库等价，其余提示/复盘/计划权限不变。
3. 使用知情、专用测试账户获取真实 Supabase getUser/JWT，分别检查 profile/recommendations 及授权开关。不要用生产用户数据做破坏性测试。
4. 在批准的隔离托管环境/专用测试账户执行两用户 RLS、独立连接 CAS/反馈竞争、请求失败重试、关闭授权后的新请求及在途请求检查。
5. 服务配置、原生隔离 SQL 或 HTTP Mock 成功，都不能代替上述托管验收。

所有写入/账户/资源范围需明确授权；本轮未执行这些步骤。没有真实模型教学评审和使用者观察，也不能宣称推荐已经具备真实教育价值。
