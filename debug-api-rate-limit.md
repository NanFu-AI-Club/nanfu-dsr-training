# API 请求过于频繁问题排查

状态：[OPEN]
会话：api-rate-limit

## 现象
线上仍频繁出现“请求过于频繁，请稍后再试”，此前已将 Node API 默认限流从每分钟 200 次调整为 2000 次。

## 假设
1. 线上仍存在 Nginx、腾讯云网关或其他代理层限流。
2. 请求实际命中了不同服务实例，部分实例仍使用旧配置。
3. 前端存在轮询、重复挂载或失败重试，超过 2000 次/分钟。
4. 登录接口单独触发每分钟 5 次的登录限流。
5. 多个用户共享公网 IP，按 IP 统计导致额度被共同消耗。

## 证据记录
- Nginx 配置包含 `X-Real-IP`、`X-Forwarded-For`，未发现 `limit_req` / `limit_conn`。
- Express 初始未配置 `trust proxy`；已加入 `app.set('trust proxy', 1)` 并部署。
- 代理修复后仍有旧时间段的 429，主要集中在 `/api/courses/*/progress` 与 `/api/course-media/*`。
- 前端 `Learning.jsx` 的进度加载 effect 依赖 `courseProgress`，而请求完成会更新该状态，确认存在重复请求循环。
- 已移除该 effect 对 `courseProgress` 的依赖并重新构建部署。
- 部署后的新日志时间段暂无新增 429；健康接口返回 200。
- PM2 日志另有 `no such column: lp.learn_count` 数据库查询错误，但该错误不是 429 的直接来源。

## 修改记录
- 已加入临时运行时诊断插桩，记录 API / 登录限流状态。
- 已加入 Express `trust proxy` 配置。
- 已修复 `Learning.jsx` 进度加载 effect 的重复依赖并部署前端。
