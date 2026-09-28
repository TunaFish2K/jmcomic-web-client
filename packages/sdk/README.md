# JMComic SDK

可独立安装的 TypeScript / JavaScript 上游与图片 SDK，在 jmcomic-web-client 的 `packages/sdk` 中维护，使用仓库的 Unlicense。同一套业务接口支持进程内直接调用、独立 HTTP 服务和远程连接。

SDK 提供域名发现、签名、响应解密、搜索、详情、章节、图片下载和切片还原。它不包含 App UI、账户系统、阅读记录、OCR、翻译或文件导出。

## 安装与本机调用

从 [jmcomic-web-client Releases](https://github.com/TunaFish2K/jmcomic-web-client/releases) 下载 SDK `.tgz`，然后安装（将文件名替换为实际版本）：

```sh
npm install ./jmcomic-sdk-0.2.0.tgz
```

Node、Bun、Deno 使用 `node` 入口，自动从安装包读取 WASM：

```js
import { createLocalClient } from 'jmcomic-sdk/node';

const client = createLocalClient();
try {
  const result = await client.search('关键词', { page: 1 });
  const albumId = result.redirectId ?? result.items[0]?.id;
  if (albumId) {
    const album = await client.getAlbum(albumId);
    const chapter = await client.getChapter(album.chapters[0]?.id ?? album.id);
    const image = await client.getImage(chapter.id, 0, { maxSide: 1080 });
    // image: { data: Uint8Array, mime, width, height }
  }
} finally {
  client.dispose();
}
```

本机调用不启动 HTTP 服务。`getImage` 的页码从 0 开始。

## 独立服务和远程调用

```sh
JM_TOKEN=your-token npx jmcomic-sdk serve
```

默认监听 `127.0.0.1:3000`。`JM_HOST`、`JM_PORT` 可修改监听地址；非回环监听必须提供 `JM_TOKEN`。`JM_ORIGINS` 是以逗号分隔的浏览器来源，例如 `https://reader.example`，不要填页面路径。`JM_DOMAINS` 可覆盖上游 API 域名列表。

```js
import { createRemoteClient } from 'jmcomic-sdk/remote';

const client = createRemoteClient({
  baseUrl: 'http://127.0.0.1:3000',
  token: 'your-token',
});
try {
  console.log(await client.search('关键词'));
} finally {
  client.dispose();
}
```

嵌入现有服务时，用 `createServer(client, options).fetch(request)`。该函数接受标准 `Request`，返回标准 `Response`；不绑定 Node、Express 或其他服务框架。Node 的 `listen()`、Bun.serve、Deno.serve 示例见 [examples](examples)。

## 平台支持

| 运行时 | 本机上游访问 | 独立服务 | 远程客户端 | 本地图片处理 |
| --- | --- | --- | --- | --- |
| Node 24+ | 支持 | 支持 | 支持 | WASM |
| Bun 1.4+ | 支持 | 支持 | 支持 | WASM |
| Deno 2.9+ | 支持 | 支持 | 支持 | WASM |
| Chromium / Firefox | 需要宿主传输 | 不提供监听器 | 支持 | WASM |
| Cloudflare Workers | 支持 | Fetch handler | 支持 | 静态 WASM 模块 |

浏览器直接访问上游受 CORS、Cookie 和受限请求头约束。使用远程模式，或通过 `fetch` 选项注入已解决这些限制的宿主传输；SDK 不会绕过浏览器限制。浏览器、Workers 的核心入口为 `jmcomic-sdk/local`，可配置 `image.loadWasm`。

仅引入 `jmcomic-sdk/remote` 或根入口不会加载上游协议、图片编解码器或 Node 适配代码。ESM 包提供 `.d.ts` 和包含源码的 source map，不提供 CommonJS 包。

### 浏览器 WASM

把安装包 `dist/wasm` 下的文件复制到站点 `/wasm/`，使用打包器构建 [browser.mjs](examples/browser.mjs)：

```js
import { createImageProcessor, createUrlWasmLoader } from 'jmcomic-sdk/image';
const images = createImageProcessor({
  loadWasm: createUrlWasmLoader(new URL('/wasm/', location.href)),
});
const result = await images.process(inputBytes, sliceCount, { format: 'png' });
```

### Cloudflare Workers

[worker.mjs](examples/worker.mjs) 静态导入四个 WASM 模块，[wrangler.jsonc](examples/wrangler.jsonc) 提供部署配置。无需 `nodejs_compat`。

在安装 SDK 的独立部署目录使用这两个文件，配置 `JM_TOKEN` secret；可选 `JM_ORIGINS`。示例未配置 token 时返回 503。`createWorkersServer` 每次请求创建独立客户端，共享有容量限制的字节缓存，不跨请求复用上游 I/O。

图片服务使用付费 CPU 配额。免费请求只有 10 ms CPU，不能保证完成图片解码和编码。单 isolate 内存上限为 128 MB，包含 WASM 内存。[Cloudflare 官方限制](https://developers.cloudflare.com/workers/platform/limits/)

首版已在本地 workerd 执行真实 WASM 测试；未部署到任何 Cloudflare 账户，本地测试不证明云端 CPU 配额或上游可达性。

## 接口与错误

| 方法 | 结果 |
| --- | --- |
| `search(query, options?)` | `query`, `total`, `redirectId`, `items` |
| `getAlbum(id, options?)` | 名称、简介、浏览数、喜欢数、作者、标签、作品、角色、章节列表 |
| `getChapter(id, options?)` | 章节名称、scrambleId、图片文件名和页码 |
| `getImage(chapterId, index, options?)` | 图片字节、MIME、宽高 |
| `dispose()` | 取消当前请求，拒绝后续调用 |

搜索支持 `page`、`mainTag`（0–4）、`orderBy`（mr/mv/mp/tf）、`time`（a/t/w/m）。图片支持 `maxSide`、`format`（jpeg/png/original）、`quality`（1–100，仅 JPEG）。所有异步业务接口支持 `signal: AbortSignal`。

`JmError` 提供 `code`、`message`、`retryable`；远程错误还包含 `requestId`。常见错误码：`INVALID_ARGUMENT`、`NOT_FOUND`、`UPSTREAM`、`INVALID_RESPONSE`、`TIMEOUT`、`ABORTED`、`UNAUTHORIZED`、`PROTOCOL_MISMATCH`、`UNSUPPORTED_IMAGE`、`IMAGE_LIMIT`、`BUSY`、`DISPOSED`。服务不返回底层堆栈或 Cookie。

网络取消会中断请求与退避等待。同步 WASM 执行期间不能即时中断；SDK 在编解码和变换阶段之间检查取消，取消后的结果不会写入缓存。调用者取消不会中断其他订阅者共享的下载。

HTTP 协议固定为 `/v1`，每次响应包含 `X-JM-Protocol: 1` 和 `X-Request-Id`。远程客户端校验版本：

| 路径（GET） | 参数 / 响应 |
| --- | --- |
| `/v1/info` | `{ protocol: 1 }` |
| `/v1/search` | `query` 和搜索选项；JSON |
| `/v1/albums/:id` | JSON |
| `/v1/chapters/:id` | JSON |
| `/v1/chapters/:id/images/:index` | 图片选项；二进制，`X-Image-Width` / `X-Image-Height` |

错误格式为 `{ error: { code, message, retryable, requestId } }`。没有任意 URL 代理端点，图片位置由上游章节数据解析。

## 图片与资源配置

JPEG、PNG、静态 WebP 使用内置 jSquash WASM 解码；先按原始尺寸整数切片还原，再进行一次全图双线性缩放。默认编码 JPEG，质量 90；PNG 保留 alpha。GIF 只支持原样返回，不解码、不缩放；动画 WebP 不支持。`original` 仅允许不需要还原、也不需要缩放的图片，不会将未还原的切片图当成正常图片返回。

| 限制 | 普通客户端 | Workers 适配器 |
| --- | --- | --- |
| 单图输入 | 16 MiB | 8 MiB |
| 解码像素 | 8,000,000 | 1,500,000 |
| 内存缓存 | 16 MiB | 2 MiB |
| 上游并发 | 每客户端 4 | 每请求 4 |
| 图片并发 | 每 JS realm 1，等待队列 16 | 每 isolate 1，等待队列 16 |

输入限制通过 `image.maxInputBytes`、`image.maxPixels` 配置；缓存通过 `cache` 注入。超限明确返回 `IMAGE_LIMIT` / `BUSY`。这些限制不等于整个进程内存上限；提高像素限制会同时增加 JS 和 WASM 内存。

原图缓存 24 小时；处理结果按章节、页码、尺寸、格式、质量和算法版本区分。搜索缓存 60 秒，详情和章节缓存 1 小时。默认内存缓存有 TTL 和 LRU 淘汰，无文件系统或 IndexedDB 副作用。自定义缓存实现 `get`、`set`、`delete`，值为字节数组。会话和 Cookie 不持久化。

可配置 `fetch`、`domains`、`discoveryUrls`、`timeoutMs`、`retries`、`logger`。默认每次请求超时 12 秒，最多重试 2 次，再尝试上游切换；远程请求默认超时 60 秒。域名必须通过签名 `/setting` 返回有效配置才能使用。

`logger(event)` 接收操作、耗时、重试次数及错误码，不记录搜索词、完整 URL、Cookie 或 token。自定义传输的代理配置只作用于该客户端；SDK 不修改系统代理。

## 开发与验收

```sh
# 在 jmcomic-web-client 仓库根目录执行
pnpm install --frozen-lockfile
pnpm sdk:test
pnpm --filter jmcomic-sdk test:platforms  # 需安装 Bun，Deno 随开发依赖安装
pnpm --filter jmcomic-sdk test:workers    # workerd 真正执行 WASM
pnpm --filter jmcomic-sdk exec playwright install chromium firefox
pnpm --filter jmcomic-sdk test:browser    # 真实浏览器 CORS 与 WASM
pnpm --filter jmcomic-sdk test:package    # 临时目录安装 tarball，检查类型、CLI 与 WASM
pnpm sdk:pack                            # 只构建和打包，不发布 npm
```

测试图片由 `tools/fixtures.py` 通过 Pillow 独立生成，包含奇数宽高、切片余数和高度 8197 的长图。期望像素来自未打乱的参考图，不由 SDK 还原函数生成。

真实上游仅在开发机手动运行：

```sh
python3 packages/sdk/tools/test-proxy.py -- pnpm --filter jmcomic-sdk test:real
```

工具读取本机 v2rayN 的活跃 VLESS TCP Reality 节点，为该测试进程启动独立 sing-box，退出后清理；不会修改 v2rayN。其他节点类型明确报错。无代理环境可以直接运行 `pnpm --filter jmcomic-sdk test:real`。报告写入 `packages/sdk/.artifacts/real-report.json`，不会保存漫画图片或节点凭据。

CI 只用 mock 上游及合成图片，按受影响包执行检查。SDK 或根依赖配置变化后，运行 SDK、应用 Worker 和前端测试，通过后发布 `sdk-build-<commit>`；main 是正式 Release，其他分支为预发布。包版本使用 `0.2.<workflow run number>`，不自动发布到 npm。应用 Worker 有独立的部署步骤；SDK 的独立服务示例不自动部署。

## 应用适配入口

`jmcomic-sdk/upstream` 导出 `createUpstreamClient`、`discoverDomains` 和 `DOMAIN_SERVER_URL`。客户端提供 `initialize()`、`request('/search' | '/album' | '/chapter', params)`、`getChapterTemplate(id)`、`dispose()`；异步方法支持 `signal`。初始化只返回 API 地址、图片地址和版本，不暴露 Cookie。

该入口保留上游原始字段，不缓存搜索、详情或章节结果，适用于由宿主掌握刷新和缓存策略的应用。失败时 `JmError.operation` 标识出错操作。jmcomic-web-client 在应用适配层转换旧接口数据，SDK 不包含 `/batch-album`、`/batch-photo` 或 LLM 代理。

当前验收记录见 [VALIDATION.md](VALIDATION.md)。
