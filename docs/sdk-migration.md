# SDK 迁移

SDK 从 TunaFish2K/jmcomic-sdk 的提交 `1cd10156385b80558bf50eb9bec25c6477f13818` 迁入 `packages/sdk`。新代码使用仓库的 Unlicense。原仓库保留已有版本和提交历史；新版本由本仓库发布。

## 模块边界

- `sdk`：域名发现、签名、会话、响应解密、上游业务接口、下载、整数切片还原、WASM 编解码、本机 / 服务 / 远程三种模式。
- `worker`：通过 `jmcomic-sdk/upstream` 访问协议层，映射原有 DTO；保留 `/search`、`/album`、`/photo`、批量接口、缓存元信息、强制刷新、重复页保护和 LLM 代理。
- `shared`：应用 DTO、IndexedDB、图片 Worker 通信和 PDF/ZIP/CBZ 导出。
- `page`：原有 UI、阅读交互、OCR、翻译和阅读状态。图片算法在独立 Web Worker 中执行，四个 WASM 文件由 Vite 打包。

SDK 的独立服务继续提供 `/v1`，应用没有改用该 HTTP 协议。低层 upstream 入口不缓存元数据，因此应用的 `refresh=1` 可以真正重新访问上游。迁移测试也修复了原缓存层在新鲜缓存命中时忽略强制刷新的问题。

Cloudflare 请求各自持有 SDK 客户端和在途任务，`waitUntil` 后台刷新结束后释放客户端。只跨请求共享已完成的域名选择和缓存数据。图片缓存新键带 `sdk-v1/` 前缀，读取时兼容旧键，不清空旧离线数据。

## 本地检查

在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm sdk:test
pnpm --filter jmcomic-sdk test:platforms
pnpm --filter jmcomic-sdk test:workers
pnpm --filter jmcomic-sdk test:package
pnpm --filter @tiny-client/shared test
pnpm --filter @tiny-client/worker typecheck
pnpm --filter @tiny-client/worker exec vitest run
pnpm --filter @tiny-client/page lint
pnpm --filter @tiny-client/page exec tsc --noEmit -p tsconfig.app.json
VITE_BACKEND_URL=http://backend.test pnpm page:build
pnpm --filter @tiny-client/page test:coverage
pnpm --filter @tiny-client/page exec playwright install --with-deps chromium firefox webkit
pnpm --filter @tiny-client/page test:browser
pnpm --filter jmcomic-sdk test:browser
```

浏览器测试使用生产构建，覆盖搜索到阅读的图片链路、独立 Worker 的真实 PNG/WebP/JPEG 编解码及逐像素还原、旧离线缓存、阅读输入、PWA 升级和主题启动。共享层测试覆盖任务取消、队列上限、Worker 故障恢复以及真实编解码器下的 120 页流式导出。

真实上游仅在开发机手动验收，使用 `packages/sdk/tools/test-proxy.py` 启动独立 sing-box。CI 不读取节点配置、不访问真实上游。具体数据和验收边界见 [SDK 验收记录](../packages/sdk/VALIDATION.md)。

## 构建与发布

根开发命令先构建 SDK，再监视 SDK 源码；前端构建和 Worker 部署命令也会先构建 SDK。`pnpm sdk:pack` 生成包含 JS、声明、WASM 和许可证的 npm tarball，外部消费者不需要此 workspace。

`.github/workflows/verify-page.yml` 按变更路径选择 SDK、page、worker 检查。SDK 变更会触发全部检查；只改应用时不重复发布 SDK。SDK 检查还覆盖 Node 24、Bun、Deno、workerd 和临时目录安装。通过所有相关检查后生成 `sdk-build-<commit>` 和 `0.2.<工作流运行序号>` 安装包。main 发布正式版本，其他分支为预发布；不发布 npm。

应用 Worker 在相关检查通过后部署，旧提交不会覆盖更新的 main。Cloudflare Pages 仍使用原来的 Git 集成，构建命令须为根目录的 `pnpm page:build`，Node 版本须为 24 或更新。Flutter App 和 SDK 独立服务示例不由本次工作流部署。
