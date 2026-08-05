# 不使用 Service Worker 预缓存应用壳

状态：已接受

决策日期：2026-08-05

2026-08-05 的缓存事故证明，预缓存的 HTML 与 Cloudflare Pages 当前部署中的 hash 资源可能失去版本一致性。项目决定继续提供可安装的 PWA，但 Service Worker 不再缓存或代理 HTML、CSS、JavaScript、API 和图片；作品与已处理图片仍由带有明确 schema、期限和容量限制的 IndexedDB 缓存管理。

## 考虑过的方案

- 恢复可离线启动的应用壳，但这需要长期保留旧部署资源，并验证所有跨版本组合。
- 先用清理 Worker 止血，再恢复应用壳，但项目当前没有必须离线启动的产品需求。
- 长期取消应用壳缓存，以网络导航换取明确的版本一致性边界。

## 后果

PWA 启动和页面导航需要网络。Service Worker 只负责触发事故前 Workbox precache 的清理，页面注册代码负责定期检查 Worker 更新；回滚必须保留该清理策略，不能重新部署事故前的 Worker。
