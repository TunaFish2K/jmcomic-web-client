# 开发指南

本文说明项目结构、运行配置、接口和测试方式。首次运行项目前，请先完成 [README](../README.md#本地开发) 中的依赖安装步骤。

## 工作区结构

项目使用 pnpm workspace 管理四个包。

| 包 | 目录 | 职责 |
| --- | --- | --- |
| `@tiny-client/page` | `packages/page` | 提供搜索、作品详情、阅读器、下载界面、PWA 和浏览器端缓存。 |
| `@tiny-client/worker` | `packages/worker` | 运行 Cloudflare Worker。它负责访问上游接口，并向前端返回统一的数据。 |
| `@tiny-client/shared` | `packages/shared` | 提供上游客户端、共享类型、图片还原、IndexedDB 图片缓存和文件导出函数。 |
| `jmcomic-sdk-pwa` | `packages/sdk` | 可独立发布的 SDK。前端图片处理和 Worker 上游访问都使用它。 |

技术栈：

- **前端**：React 19、Vite 8、Tailwind CSS 4、HeroUI、React Router 7、TanStack Query 5
- **后端**：Cloudflare Workers 原生 Fetch Handler
- **SDK**：TypeScript、CryptoJS、jSquash WASM
- **应用共享模块**：缓存、数据类型、fflate、PDFKit

根目录的 `scripts/test-integration.js` 对本地 Worker 执行集成测试。

SDK 的迁移边界和验证方法见 [SDK 迁移说明](sdk-migration.md)，npm 自动发布配置见 [npm 发布配置](sdk-npm.md)。

## 数据流

1. 前端通过 `VITE_BACKEND_URL` 向 Worker 发送搜索、作品或章节请求。
2. Worker 从可用域名中选择上游服务，并通过 `@tiny-client/shared` 获取和解析数据。
3. Worker 向前端返回作品信息、章节信息和图片地址。
4. 浏览器直接获取图片，并在本地还原图片顺序。
5. 浏览器将已处理的图片写入 IndexedDB。用户手动翻译或启用自动翻译时，浏览器在 Web Worker/WASM 中串行运行 OCR。
6. 前端只把 OCR 文本和文本框位置发送到用户配置的 OpenAI 兼容 `/chat/completions` 或 `/responses` 接口，并将译文覆盖在原图上。
7. 用户可选择通过 Worker 转发 LLM 请求，以兼容未开放浏览器 CORS 的服务。API Key 仅用于单次上游请求，Worker 不保存、不缓存，也不主动记录 Key、目标完整 URL 或请求正文。
8. 导出文件在浏览器中生成。翻译层不写入导出文件。

Worker 不代理图片文件。排查图片问题时，应分别检查 Worker 接口和图片 CDN。

## 环境配置

| 名称 | 使用位置 | 是否必需 | 说明 |
| --- | --- | --- | --- |
| `VITE_BACKEND_URL` | 前端构建和开发服务器 | 是 | Worker 的完整基础地址。根目录的 `pnpm run dev` 会自动将其设置为 `http://localhost:8787`。 |
| `CF_PAGES_COMMIT_SHA` | Cloudflare Pages 构建 | 自动注入 | 写入 `/release.json` 的生产提交 ID。本地构建使用 `local`。 |
| `CF_PAGES_BRANCH` | Cloudflare Pages 构建 | 自动注入 | 写入 `/release.json` 的部署分支。本地构建使用 `local`。 |
| `CF_API_TOKEN` | GitHub Actions Secret | 自动部署时必需 | 工作流将其映射为 Wrangler 使用的 `CLOUDFLARE_API_TOKEN`。 |
| `CF_ACCOUNT_ID` | GitHub Actions Secret | 自动部署时必需 | 工作流将其映射为 Wrangler 使用的 `CLOUDFLARE_ACCOUNT_ID`。 |
| `CLOUDFLARE_API_TOKEN` | 本地 shell | 可选 | 不使用 `wrangler login` 时，可以通过该变量向 Wrangler 提供令牌。 |
| `CLOUDFLARE_ACCOUNT_ID` | 本地 shell | 可选 | 与 `CLOUDFLARE_API_TOKEN` 配合使用。 |
| `ALBUM_CACHE_KV_ID` | GitHub Actions Secret 或本地 shell | 可选 | KV 命名空间 ID。部署时用于生成 `ALBUM_CACHE_KV` binding。 |
| `ALBUM_CACHE_KV` | Worker binding | 可选 | 为作品和章节接口启用 Cloudflare KV 缓存。由 `ALBUM_CACHE_KV_ID` 在部署时注入。 |
| `ACCOUNT_SESSION_KEY` | Worker Secret | 可选 | 扩展模式账号功能的会话加密密钥。未配置时，`/api/mobile/config` 返回 `accountEnabled: false`，发现功能照常可用。 |

Vite 在启动和构建时读取 `VITE_BACKEND_URL`。修改该值后，必须重新启动开发服务器或重新构建前端。

### Worker KV 缓存

作品和章节接口按以下顺序读取缓存：Worker 进程内缓存、Cloudflare Cache API、Cloudflare KV、实时上游。批量接口使用 KV bulk-get，缓存写入通过 `waitUntil` 完成。没有 `ALBUM_CACHE_KV` binding 时，进程内缓存和 Cache API 仍可运行。

多章节作品在 1 分钟内视为 fresh，并可在 15 分钟内作为 stale 数据立即返回。单章节作品和章节数据的 fresh 时间为 1 小时，stale 上限为 24 小时。stale 响应会触发后台刷新；请求加上 `refresh=1` 时，Worker 会等待刷新完成，并在上游失败时退回仍在 stale 时限内的数据。

仓库中的 `packages/worker/wrangler.jsonc` 不包含 KV binding。`worker:deploy` 会先运行 `packages/worker/scripts/deploy-config.mjs`：如果设置了 `ALBUM_CACHE_KV_ID`，就生成带 `ALBUM_CACHE_KV` binding 的 `wrangler.deploy.json`，再用它部署。该文件不提交到仓库。GitHub Actions 从同名 Secret 读取这个 ID，配置步骤见 [README](../README.md#1-部署-worker推荐github-actions)。

本地 `worker:dev` 不绑定 KV。Worker 单元测试通过 `vitest.config.mts` 中的 miniflare 配置获得本地 KV。

## 开发命令

以下命令均在项目根目录运行。

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装所有 workspace 依赖。 |
| `pnpm run dev` | 启动本地 Worker。Worker 就绪后，再启动前端。 |
| `pnpm run page:dev` | 只启动 Vite 开发服务器。必须单独配置 `VITE_BACKEND_URL`。 |
| `pnpm run page:build` | 构建前端，输出到 `packages/page/dist`。 |
| `pnpm run worker:dev` | 在 `0.0.0.0:8787` 启动本地 Worker。 |
| `pnpm run worker:deploy` | 使用 Wrangler 部署 Worker。设置 `ALBUM_CACHE_KV_ID` 时绑定 KV。 |
| `pnpm --filter @tiny-client/page run lint` | 检查前端 TypeScript 和 React 代码。 |
| `pnpm --filter @tiny-client/page test` | 运行前端单元测试和构建产物测试。必须先构建前端。 |
| `pnpm --filter @tiny-client/page run test:browser` | 使用 Playwright 验证旧 PWA 升级和搜索栏状态。必须先构建前端并安装浏览器。 |
| `pnpm --filter @tiny-client/page run test:translation` | 运行翻译设置、几何、缓存键和 LLM 协议测试。 |
| `pnpm --filter @tiny-client/worker exec vitest run` | 运行 Worker 单元测试一次。 |
| `pnpm run test:integration` | 启动 Worker，并对实时上游服务执行集成测试。 |
| `pnpm --filter @tiny-client/page run test:client` | 直接连接实时上游服务，检查共享客户端。 |
| `pnpm --filter @tiny-client/page run test:reader` | 运行阅读器导航、布局、设置存储和缩放几何测试。 |

`test:integration` 和 `test:client` 都依赖网络与实时上游服务。上游不可用时，这两个命令可能失败。Worker 单元测试不请求实时上游服务。

## Worker API

前端使用的 API 客户端位于 `packages/page/src/api.ts`。Worker 路由位于 `packages/worker/src/index.ts`。

### `POST /llm-proxy`

可选的漫画翻译 LLM 代理。前端在翻译设置中开启 Worker 代理后使用此接口。

| 请求项 | 值 |
| --- | --- |
| `Authorization` | 用户配置的 `Bearer <API_KEY>`，仅转发给本次上游请求。 |
| `Content-Type` | `application/json`。 |
| `X-LLM-Target-URL` | 完整的公网 HTTPS LLM 地址，路径必须以 `/chat/completions` 或 `/responses` 结尾。 |
| 正文 | 与直连模式相同的 LLM JSON 请求，最大 512 KiB。 |

Worker 拒绝本机、私网/IP 字面量、自身地址、带凭据或查询参数的目标，并且不会跟随上游重定向。接口原样返回上游状态和 JSON 正文，所有响应均使用 `Cache-Control: no-store`。

### `GET /search`

搜索作品。`query` 是必需参数。

| 参数 | 可选值或格式 | 默认值 |
| --- | --- | --- |
| `query` | 搜索文本 | 无 |
| `page` | 页码 | `1` |
| `mainTag` | `0` 全部、`1` 作品名称、`2` 作者、`3` 标签、`4` 角色 | `0` |
| `orderBy` | `mr` 最新发布、`mv` 最多浏览、`mp` 最多图片、`tf` 最多喜欢 | `mr` |
| `time` | `a` 全部、`t` 今天、`w` 本周、`m` 本月 | `a` |
| `warmup` | 设置为 `1` 时预取 redirect 和首屏最多 15 个作品 | 不启用 |
| `previousIds` | 上一页作品 ID，使用逗号分隔，最多 80 个 | 不启用 |

成功时返回 `SearchResult`。`page` 大于 1 且提供 `previousIds` 时，Worker 会拒绝与上一页完全相同的候选结果，并改用其他上游域名。所有候选域名都失败或返回重复页时，接口返回 `502`。

### `GET /album/:id`

返回指定作品的 `Album`。作品不存在时返回 `404`。可使用 `refresh=1` 等待 stale 缓存刷新。

### `GET /photo/:id`

返回指定章节的 `PhotoWithScrambleId`。章节不存在时返回 `404`。可使用 `refresh=1` 等待 stale 缓存刷新。

### `GET /batch-photo`

通过逗号分隔的 `ids` 参数批量获取章节。一次请求最多接收 20 个 ID。`refresh=1` 对 stale 条目执行等待刷新。

接口为每个 ID 返回章节数据或结构化错误。单个章节失败不会中断其他章节；包含错误的响应使用 `no-store`，因此前端重试不会命中浏览器中的旧错误。

### `GET /batch-album`

通过逗号分隔的 `ids` 参数批量获取作品和图片数据。一次请求最多接收 15 个 ID。`refresh=1` 对 stale 条目执行等待刷新。

以上缓存接口通过 `X-Cache` 返回整体命中状态，通过 URL 编码的 `X-Cache-Meta` 返回各资源的 `fetchedAt`、新鲜度和来源，并通过 `Server-Timing` 返回 Worker 耗时。浏览器可以读取这些响应头。

接口会先读取 Worker 缓存。它为每个 ID 返回作品数据或结构化错误。

所有接口都允许跨域请求。缺少必需参数、ID 列表为空或超出批量上限时，接口返回 `400`。未知路径返回 `404`。

### 扩展模式接口：`/api/mobile/*`

供默认关闭的扩展模式使用，实现位于 `packages/worker/src/mobile.ts`，底层调用 SDK 的 `jmcomic-sdk-pwa/mobile`。上游契约见 [手机接口台账](mobile-api.md)。只接受 `GET`，其他方法返回 `405`。

| 路径 | 参数 | 缓存 |
| --- | --- | --- |
| `/config` | — | 60 秒；返回 `{ accountEnabled }`，表示是否配置了 `ACCOUNT_SESSION_KEY` |
| `/promote` | — | 5 分钟 |
| `/promote-list` | `id`，`page`（从 0 开始） | 5 分钟 |
| `/latest` | `page`（从 0 开始） | 2 分钟 |
| `/serialization` | `date`（1–7，周一到周日），`type`（默认 `all`），`page` | 5 分钟 |
| `/categories` | — | 1 小时 |
| `/categories/filter` | `c`（分类 slug，默认 `0`），`o`（空、`tf`、`mv`、`mv_m`、`mp_w` 等），`page` | 5 分钟 |
| `/week` | — | 1 小时 |
| `/week/filter` | `id`、`type`、`page` | 10 分钟 |
| `/hot-tags` | — | 1 小时 |
| `/random` | — | 不缓存 |
| `/comments` | `aid`，`page` | 1 分钟 |

公开数据写入 Cloudflare Cache API，同时返回相同 TTL 的 `Cache-Control: public`。`X-Cache` 为 `miss`、`edge` 或 `bypass`。错误统一返回 `{ error: { code, message } }` 和 `no-store`：参数错误为 `400`，上游拒绝或网络失败为 `502`，超时为 `504`。评论的 `content` 是上游原样返回的 HTML，前端只能按纯文本显示。

## 缓存与持久化

| 数据 | 存储位置 | 有效期或上限 |
| --- | --- | --- |
| 搜索请求 | TanStack Query 内存缓存 | 5 分钟内保持新鲜 |
| 作品和章节图片数据 | IndexedDB `jm-album-cache` | 24 小时，最多 200 条 |
| 阅读器作品元数据 | `localStorage` | 6 小时，最多 100 条 |
| 阅读进度和阅读设置 | `localStorage` | 不自动过期 |
| 已还原图片 | IndexedDB `jm-image-cache` | 启动时清理超过 7 天的数据 |
| OCR 结果和译文 | IndexedDB `jm-translation-cache` | 每类最多 500 页，按最近访问清理 |
| 翻译服务、API Key、自动翻译范围、LLM 并发、思考和提示词设置 | `localStorage` | 不自动过期 |
| Worker 作品数据 | Worker 实例内存 | 60 秒 |
| Worker 搜索客户端 | Worker 实例内存 | 60 秒 |
| Worker 作品数据 | Cloudflare KV | 配置 `ALBUM_CACHE_KV` 后保存 1 小时 |

Service Worker 不缓存或代理 HTML、CSS、JavaScript、API 和图片。它只保留一个无业务内容的清理标记，用于删除事故前的 Workbox 应用壳缓存。PWA 启动和页面导航依赖网络，应用数据、已处理图片、OCR 结果和译文只通过上表中的 IndexedDB 缓存持久化。

`/release.json` 包含当前 Pages 构建的提交和分支。该文件、HTML、manifest 和 `/sw.js` 都必须使用 `no-store`。hash 资源位于 `/assets-v3`，恢复期间每次使用前必须重验证。

OCR 运行时、WASM 和 PP-OCRv5 mobile 模型不会进入 PWA 预缓存，也不会由 Service Worker 拦截。用户首次翻译时才会下载这些资源，后续复用取决于资源服务器提供的普通 HTTP 缓存策略。LLM 请求默认由浏览器直接发往用户配置的服务；用户开启 Worker 代理后，才会经 `POST /llm-proxy` 转发，Worker 不保存 API Key 或译文。

自动翻译只处理当前章节。范围顺序是当前页、后一页、前一页，并继续按距离展开。本地 OCR 使用单例 Worker 串行执行，OCR 完成后的 LLM 请求按用户设置的 `1–6` 并发数运行。后台任务失败后会暂停当前范围，直到用户翻页、修改设置或手动翻译。Chat Completions 请求不发送 `temperature`；`reasoning_effort` 根据“跟随服务、关闭、开启”三态决定是否发送及使用的等级。

任务相关性由章节、请求配置和当前预翻译范围共同决定。API Key 参与运行任务身份但不参与译文缓存身份；因此切换密钥会中止旧请求，同时仍允许复用同模型、同提示词产生的缓存。翻页保留新范围交集内的自动任务，章节或请求配置不匹配的任务会中止且不显示错误。

翻译状态仅跟踪当前页。取消自动当前页不会终止其他后台任务；该页在翻页、修改设置或手动翻译前不会重新进入自动队列。每个运行任务都有独立的 `AbortController`；PaddleOCR 的单次 `predict` 无法中途终止，因此取消发生在 OCR 阶段时会保留 OCR 缓存并跳过后续 LLM 请求。

V3 翻译设置包含可编辑的翻译风格和内容处理提示词。V1/V2 设置加载后使用默认模板，显式空字符串保持为空。两段提示词的稳定哈希参与译文缓存键与自动完成键，固定 JSON 输出协议追加在组合 system 消息末尾。

## 发布检查

每次前端部署后，读取 `/release.json`，确认 `commit` 等于目标提交。还要检查 `/sw.js`、`/manifest.webmanifest` 和 HTML 响应是否包含 `Cache-Control: no-cache, no-store, must-revalidate`。这些响应头由 `packages/page/public/_headers` 配置。

PWA 故障不能通过恢复旧 Pages 部署解决，因为旧部署会同时恢复旧 Service Worker 和旧缓存头。出现回归时，应在当前安全基线上追加修复提交，并继续保留 `assets-v3`、清理 Worker 和关键资源的 `no-store` 响应头。

## 安卓 PWA 开屏验证

原生开屏统一使用深色背景 `#0c0a09`。页面在外部资源加载前读取已有主题设置，进入页面后继续遵循浅色、深色或跟随系统设置；状态栏颜色也跟随页面实际主题。

在安卓真机上分别验证新安装与已有安装更新后的冷启动：系统浅色、应用深色时，从原生开屏到页面不应出现白屏；系统深色、应用浅色时，深色开屏后应正常显示浅色页面。还需检查跟随系统和慢网加载。

已有安装的开屏颜色需要等待 Chrome 更新 WebAPK，刷新网页不保证立即生效。测试时可按 [Chrome 官方更新说明](https://web.dev/articles/manifest-updates#test-manifest-updates) 操作：

1. 将安卓设备连接电源和 Wi-Fi，关闭并强行停止 PWA。
2. 在 Chrome 打开 `about://webapks`，找到应用并点击 **Update**。
3. 启动一次 PWA，再关闭并强行停止。
4. 等待更新状态变为 **Successful**，再从桌面图标冷启动检查开屏。

浏览器自动化测试覆盖 HTML 首屏及资源加载后的主题衔接；它不能代替安卓原生开屏的真机验证。

## 测试建议

提交代码前，按修改范围运行以下检查：

1. 修改前端后，运行前端 lint。

```bash
pnpm --filter @tiny-client/page run lint
```

2. 修改前端或共享包后，构建前端。

```bash
pnpm run page:build
```

3. 运行全部前端测试。

```bash
pnpm --filter @tiny-client/page test
```

4. 修改 PWA、搜索栏或发布配置后，运行浏览器测试。

```bash
pnpm --filter @tiny-client/page exec playwright install chromium firefox
pnpm --filter @tiny-client/page run test:browser
```

浏览器测试会先安装一个持有旧应用壳和损坏 CSS 的 Worker，再在同一 origin 切换到当前构建。测试必须确认客户端无需清缓存即可恢复，并且不会无限刷新。

5. 修改阅读器或主题后，运行对应的前端测试。

```bash
pnpm --filter @tiny-client/page run test:reader
pnpm --filter @tiny-client/page run test:theme
```

修改翻译设置、OCR 几何、缓存键或 LLM 协议后，还要运行：

```bash
pnpm --filter @tiny-client/page run test:translation
```

6. 修改 Worker 后，运行 Worker 单元测试。

```bash
pnpm --filter @tiny-client/worker exec vitest run
```

7. 修改接口或上游客户端后，运行集成测试。

```bash
pnpm run test:integration
```

Playwright 覆盖 Chromium、Firefox 和移动端 Chromium 视口。它不能替代真实 iOS Safari、iOS PWA 和 Android PWA 验收；修改触控或 PWA 生命周期后，仍要在真机检查。

阅读器触控改动至少应在 iOS Safari、iOS PWA、Android Chrome 和 Android PWA 中检查双指缩放、单指拖动和缩放复位。左右与上下阅读方向都要覆盖以下四种组合：

| 无缝模式 | 自动吸附 | 预期行为 |
| --- | --- | --- |
| 关闭 | 关闭 | 保留普通页面排布，可以停在任意滚动位置，缩放当前图片。 |
| 关闭 | 开启 | 保留普通页面排布，滚动对齐页面起点，缩放当前图片。 |
| 开启 | 关闭 | 页面连续拼接，可以停在任意位置，缩放手势开始时的全部可见页。 |
| 开启 | 开启 | 页面连续拼接，滚动对齐页面起点，缩放当前图片。 |

还要使用宽高比例不同的页面检查横向无缝排布。图片尺寸补齐后，当前阅读点不应跳走。可见页成组缩放时，第三张未出现在屏幕内的页面不能一起缩放，组内页面接缝不能裂开。复位后滚动位置必须与缩放前一致。切换无缝模式后，自动吸附开关的状态必须保持不变。

搜索交互改动应使用限速网络检查：请求期间旧结果仍可滚动和打开详情；新结果到达后列表回到顶部；已打开的详情不会关闭或丢失内容；输入焦点高亮是搜索输入组内部的 1px 边框，不包含搜索按钮，也不改变输入组的外部尺寸。

## 常见问题

### 前端启动后无法搜索

检查 `VITE_BACKEND_URL` 是否为完整 URL。只运行 `page:dev` 时，必须通过 `packages/page/.env.local` 或 shell 环境变量提供该值。

### Worker 返回 `502` 或 `500`

先检查 Worker 日志。`502` 通常表示所有候选上游域名都请求失败。`500` 表示 Worker 处理请求时发生未捕获错误。

### 图片无法显示或导出

确认浏览器支持 IndexedDB、OffscreenCanvas 和 `createImageBitmap`。然后检查浏览器是否能够直接访问响应中的图片 URL。

### 集成测试结果不稳定

集成测试会访问实时上游服务。重试前应先确认本地 Worker 已在 `http://localhost:8787` 启动，并检查当前网络能否访问上游域名。
