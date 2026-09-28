# SDK 决策

- 源码迁入公开 jmcomic-web-client 仓库的 packages/sdk，继承 Unlicense，可独立安装；TypeScript、ESM、类型声明和内置 WASM。原私有仓库保留历史并停止独立发布。
- 范围为上游和图片核心，不是完整应用后端。OCR、翻译、导出、阅读记录不属于 SDK。
- 本机、HTTP 服务、远程客户端使用同一业务接口；服务包装本机核心。
- 平台使用标准 Fetch API；文件读取仅存在于独立 Node 适配入口。
- 图片先完整整数行还原，后全局缩放。原图下载可合并，不按输出尺寸重复下载。
- Workers 静态加载 WASM，客户端生命周期限于一次请求；共享有界字节缓存。
- 浏览器不能自行绕过 CORS/Cookie 限制。本地图片处理和远程连接为明确支持范围。
- GitHub CI 使用 mock 上游和真实合成图片，不跑真机、不访问真实上游；实际平台测试不能用 mock 编解码器替代。
- SDK 或根依赖变更通过相关测试后，自动构建、打 sdk-build tag、发布 GitHub Release；npm 首次授权完成后，main 通过 OIDC 自动发布同一 tarball，其他分支不发布 npm。应用 Worker 按原部署目标更新，SDK 独立服务示例不自动部署。
- PWA 与应用 Worker 使用 workspace SDK。应用保留旧 HTTP API、DTO、批量接口、缓存元信息、强制刷新、搜索重复页保护及 LLM 代理。
- 图片解码、整数切片还原、编码由 SDK 提供，浏览器通过单独 Web Worker 执行。新缓存使用 sdk-v1 命名空间，仍可读取旧离线图片。
- 低层 upstream 入口只提供协议访问，不缓存业务结果；应用层负责缓存策略。SDK 客户端和未完成 I/O 不跨 Cloudflare 请求共享。
- Flutter App 不属于本次迁移范围。

- npm 包名和 CLI 为 jmcomic-sdk-pwa，旧无 scope 名称已被其他维护者使用；所有 workspace 引用同步迁移。
- npm 发布 job 与应用部署独立；NPM_PUBLISH_ENABLED=true 在首次发布和 trusted publisher 绑定后开启。重复发布只接受完整性一致的现有版本，旧版本不能降低 latest。
- 外部安装测试覆盖三模式完整业务流程、CLI 启停与错误参数、认证、CORS、取消、超时及脱敏日志。
