# M3.4.1 CF Handle 交互修复与链路诊断

日期：2026-10-17。基线 `757576b`，开始时工作区干净。本轮未访问托管业务接口、执行远端写入/迁移/部署或新增 CF 官方请求；沿用已有公开录制进行本地测试。

## 根因和修复

`CfAccountSettings` 原来用 `!configured || !state || busy` 同时禁用文本框和按钮。未配置、初次加载、GET 失败或操作期间都会令输入框不可编辑；这是已确认的前端设计故障，不能据此判断远端绑定失败原因。

现在 Handle 仍为 React `value/onChange` 受控草稿，独立于账号状态，不从 GET/POST 返回值回填，始终可编辑。只有配置完整、经服务端 `getUser()` 的真实状态读取成功、Handle 通过共用 Zod 格式校验且没有本地冲突操作时，关联按钮才启用。没有构造占位账号、revision 或生产成功响应。按钮外还有同步请求锁，防止同一渲染周期重复提交。

区域分别显示加载、配置缺失/不完整、未登录/过期、读取失败、RPC 不可用、可绑定/管理、正在绑定/同步和操作失败可恢复。新增“重新加载账号状态”；读取失败时旧关联仅作为上次读取结果展示，写操作禁用，草稿保留。POST 成功只展示服务端确认的账号。明确失败后允许新请求；未知确认结果保留原请求体和 requestId 重试，即使草稿已改、刷新显示的 revision 已变化，也不会修改旧请求体。

客户端按公共错误 code/status 选择固定中文文案，不展示 SDK/网络异常原文。读取与写入分别使用 20 秒/125 秒客户端超时；服务端原 15 秒 Supabase、18 秒 CF、90 秒预算及路由 120 秒均未改变。超时不代表服务器事务已经取消，需读取状态或用相同 requestId 恢复。

## 完整路径与安全边界

1. 输入 → 格式校验 → POST 白名单 `action/handle/revision/requestId`。浏览器的 revision 是 CAS 前置条件，requestId 是幂等键，两者均不作为授权；数据库核对真实 revision、归属和请求指纹。新意图使用新 ID，未知结果重试保留 ID。
2. API 每次调用 `requireContext()` → SSR Cookie 客户端 → `auth.getUser()`。缺配置 503；未登录/过期 401；不信任 `getSession()` 内嵌身份。页面初次失效仍沿用现有登录跳转，页面打开后 API 401 显示安全错误并保留输入。
3. `readJson` 验证同源和严格 Zod；服务端给 `cf_account` operation 签名，用户 JWT 调用窄 RPC；无 service-role、无私人表直接 DML。
4. 数据库 reserve 校验归属/CAS/请求指纹/租约；slot 使用既有共享时隙；服务端只请求固定官方 `user.info`，成功后以私有租约执行 bind，再读取状态。无效官方 Handle 走 fail，不执行 bind，不覆盖旧关联。上游有界重试、冷却与同步算法保持原样。
5. HMAC、nonce、scope、签名密钥和注册时间哨兵不交给浏览器。客户端伪造身份、签名、nonce、非法 revision/requestId 被拒绝；合法但过期的 revision 由数据库 PT409 拒绝。
6. `PGRST202` / `42883` 统一映射为安全 503 `CF_ACCOUNT_RPC_UNAVAILABLE`，提示核对迁移与接口缓存，不能仅凭此认定迁移缺失。命令权限/签名配置问题与 401 区分；JWT 拒绝归为 401。数据库返回结构异常归为服务端 503，不误报为用户输入 422。未知错误仍脱敏 503。

没有修改 API 权限、现有 001–010 SQL、RLS、推荐权重、官方证据融合或 CF 同步算法，也未新增迁移。替换、解除、删除、同步、启用/关闭分析与历史回归保留。

## 环境诊断与验收状态

| 层次 | 证据与状态 | 结论边界 |
| --- | --- | --- |
| 前端输入 | PASS，组件与桌面/移动浏览器验证 | 无配置、加载、401、500/503、RPC 不可用及忙碌时均可编辑，重载不覆盖草稿 |
| 配置 | 本机 URL/公开 key/Tutor master 存在，CF 独立 key 不存在；支持原有 master 派生；无数据库 URL | 仅检查存在性，未输出值；不证明格式、联通或私有 HMAC 一致 |
| Auth | PASS，本地实际 route/Auth 代码 + SDK 替身；401/getUser 不信任 getSession 有断言 | 真实托管 JWT/Cookie/过期验收 NOT_RUN |
| RPC/保存 | PASS，本地路由→签名→官方 HTTP 替身→保存→状态；真实 SQL/RLS 及原生临时库另验 | 不能提升为真实 PostgREST/HMAC 配置联通通过 |
| 托管 007–010 | NOT_RUN，没有管理只读通道或专用测试项目 | 历史匿名 PGRST202 只涉及两个推荐读取 RPC，不能证明当前 CF RPC 或迁移部署状态 |
| 真实绑定/替换/同步/解绑/删除 | NOT_RUN | 没有本阶段目标与远端写入授权，不使用生产用户替代验收 |
| 双用户/跨实例 | 本地替身/原生隔离通过，真实托管 NOT_RUN | 三个 PostgreSQL backend 不是三个应用实例 |

## 实际检查

| 命令 | 结果 |
| --- | --- |
| `npx vitest run tests/unit/cf-account-settings.test.tsx tests/unit/cf-account-route-chain.test.ts tests/unit/cf-account-api.test.ts tests/unit/cf-account-service.test.ts` | PASS，24/24（补 POST 过期场景前的定向检查） |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test` | PASS，三轮依次 283/283、284/284、284/284，均为 37 文件；后两轮含补充的 POST 过期场景，最后一轮对应最终业务代码 |
| `npm run build` | PASS，包含 postbuild 客户端/Monaco 检查 |
| `npm run test:e2e` | PASS，两轮均 52/52，最后一轮使用最终构建；桌面和移动，本地 Auth/HTTP 夹具 |
| `npm run test:recommendations` | PASS，34/34，7 文件，含保留真实等待的 M3.4 响应重放 |
| `M33_ALLOW_DATABASE_TESTS=isolated M321_RUNTIME_DIR=/tmp/algopilot-m341-native-runtime M33_EVALUATION_OUTPUT=/tmp/algopilot-m341-m33 npm run test:isolated:m33` | PASS，9 组、3 独立 backend |
| `M321_ALLOW_DATABASE_TESTS=isolated M321_RUNTIME_DIR=/tmp/algopilot-m341-native-runtime M321_EVALUATION_OUTPUT=/tmp/algopilot-m341-m321 npm run test:isolated:m321` | PASS，12 组、3 独立 backend、11,450 题 |

测试保留 M0–M3.4 的推荐、Tutor/Review、RLS、签名、CAS 和历史断言。新增组件/路由用例覆盖失效登录、500/503、RPC 缺失、无配置/加载中输入、重载、异步返回、格式门禁、重复提交、确认账号、失败保留旧关联、未知结果重试；浏览器同时覆盖响应式界面与原替换/同步/授权/解绑/删除。

初次 typecheck 发现新增测试误用 Testing Library 的 `exact` 参数，改为精确正则后通过。首次 E2E 在沙箱内因 loopback `listen EPERM` 未启动，获工具执行许可后按同一配置运行通过。原生运行时原路径不存在，首次受限网络安装中止；随后仅在 `/tmp` 安装固定 `embedded-postgres@18.4.0-beta.17` / `pg@8.16.3`，项目 package/锁文件无改动。临时原生集群已由脚本关闭并清理。

本机日志：`/tmp/algopilot-m341-*.log`；原生报告在上述两个输出目录；桌面/移动布局截图 `/tmp/algopilot-m33-account-m2-{desktop,mobile}.png`，仅本地测试夹具。没有将模拟数据写入线上画像，也没有新的 CF 网络取证。

## 剩余托管验收最短步骤

1. 操作员先确认专用目标，在 Dashboard 执行 [SELECT-only 核验](sql/M34_READONLY_DIAGNOSTICS.sql)，按 [M3.4 矩阵](M34_ACCEPTANCE.md) 分开记录版本账本与函数哈希/RLS/ACL/索引。不要读取或回传密钥。当前不能提供“已确认缺失迁移”结论。
2. 若确认缺失，提出该目标的最小变更清单并获得本阶段明确授权，仅按顺序应用缺失文件，先核对 001–006 已完整部署：
   - `202610140007_learning_recommendations.sql`
   - `202610140008_recommendation_audit.sql`
   - `202610140009_recommendation_fit.sql`
   - `202610150010_cf_official_evidence.sql`
   账号 RPC 由 010 提供并依赖前序；不裸重跑历史迁移。HMAC 一致性单列未验证，后续按 [M33_SETUP](M33_SETUP.md) 由维护者在服务端/数据库私有配置完成，不导出密钥。
3. 获准后用两个专用测试用户实际登录、由 Supabase 验证 JWT；设置页重载应 200 且无状态伪造。用获准公开 Handle 验证绑定→刷新→无效替换保留旧关联→同步/授权→解绑/删除及第二用户隔离、过期 401、PT409、未知结果重试。测试写入/清理范围须提前列明。验收前真实绑定继续标 NOT_RUN。
