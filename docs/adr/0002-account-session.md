# 0002 扩展模式账号会话由浏览器保存，Worker 加密

## 背景

扩展模式要支持登录、收藏、评论、签到等需要上游账号的功能。上游用 JWT（`Authorization: Bearer`）和 `AVS` Cookie 识别账号。浏览器无法直接调用上游：上游不允许跨域，Cookie 也无法跨站携带。所以账号请求必须经过部署者的 Worker。

Worker 的上游客户端只在单次请求内存在（`request-scope.ts` 在请求结束后销毁）。项目没有数据库，Worker 也只有可选的 KV。

## 决定

- 登录成功后，Worker 用 `ACCOUNT_SESSION_KEY` 派生出 AES-GCM 密钥，把 `{uid, jwt, avs, exp}` 加密成一个会话令牌（`v1.<base64url>`）交给浏览器。浏览器之后用 `Authorization: Bearer <令牌>` 调用 `/api/mobile/account/*`。
- 会话有效期为 1 小时；如果上游 JWT 的 `exp` 更早，以它为准。过期后要求重新登录，不保存密码，也不自动重新登录。
- 浏览器把令牌存在 `sessionStorage`，关闭标签页后失效。
- 用户 ID 只从解密后的会话读取，请求里的 `uid`、`user_id` 一律忽略。
- 账号接口全部返回 `Cache-Control: no-store`，不经过 Cache API 或 KV。公开发现数据和账号数据走不同的路由。
- 没有配置 `ACCOUNT_SESSION_KEY` 时，账号接口返回 `503 ACCOUNT_DISABLED`，发现接口照常可用。

## 后果

- **不需要服务端会话库。** Worker 保持无状态，自部署不需要额外资源。
- **无法单独吊销会话。** 退出登录会调用上游 `/logout` 并清除浏览器中的令牌，但已复制出去的令牌在过期前仍可使用。轮换 `ACCOUNT_SESSION_KEY` 会让所有会话立即失效。
- **用户必须信任部署者。** 账号密码和上游凭据都会经过部署者的 Worker，部署者有能力记录它们。Worker 代码不记录请求正文，但用户只能信任部署者没有修改代码。前端首次开启扩展模式时要明确提示这一点。
- **Worker 是公开的。** 和 `/llm-proxy` 一样，任何人都可以用部署者的 Worker 登录上游账号，这会消耗部署者的 Worker 用量；上游看到的登录来源 IP 也是 Cloudflare 的地址。目前没有做频率限制。
- 令牌包含上游 JWT 和 `AVS` 的密文。只要 `ACCOUNT_SESSION_KEY` 没有泄露，在浏览器端拿到令牌也读不出这些凭据。
