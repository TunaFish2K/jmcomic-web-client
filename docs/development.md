# 开发指南

本文说明项目结构、运行配置、接口和测试方式。首次运行项目前，请先完成 [README](../README.md#本地开发) 中的依赖安装步骤。

## 工作区结构

项目使用 pnpm workspace 管理三个包。

| 包 | 职责 |
| --- | --- |
| `@tiny-client/page` | 提供搜索、作品详情、阅读器、下载界面、PWA 和浏览器端缓存。 |
| `@tiny-client/worker` | 运行 Cloudflare Worker。它负责访问上游接口，并向前端返回统一的数据。 |
| `@tiny-client/shared` | 提供上游客户端、共享类型、图片还原、IndexedDB 图片缓存和文件导出函数。 |

根目录的 `scripts/test-integration.js` 对本地 Worker 执行集成测试。

## 数据流

1. 前端通过 `VITE_BACKEND_URL` 向 Worker 发送搜索、作品或章节请求。
2. Worker 从可用域名中选择上游服务，并通过 `@tiny-client/shared` 获取和解析数据。
3. Worker 向前端返回作品信息、章节信息和图片地址。
4. 浏览器直接获取图片，并在本地还原图片顺序。
5. 浏览器将已处理的图片写入 IndexedDB。用户手动翻译或启用自动翻译时，浏览器在 Web Worker/WASM 中串行运行 OCR。
6. 前端只把 OCR 文本和文本框位置发送到用户配置的 OpenAI 兼容 `/chat/completions` 接口，并将译文覆盖在原图上。
7. 导出文件在浏览器中生成。翻译层不写入导出文件。

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
| `ALBUM_CACHE_KV` | Worker binding | 可选 | 为批量作品接口启用 Cloudflare KV 缓存。 |

Vite 在启动和构建时读取 `VITE_BACKEND_URL`。修改该值后，必须重新启动开发服务器或重新构建前端。

### Worker KV 缓存

Worker 会先读取进程内缓存。如果配置了 `ALBUM_CACHE_KV`，Worker 还会读取 Cloudflare KV。没有该绑定时，接口仍可运行。

如需启用 KV，请先在 Cloudflare 中创建命名空间。然后在 `packages/worker/wrangler.jsonc` 中按以下形式配置 `compatibility_flags` 和 KV binding，并替换命名空间 ID：

```jsonc
"compatibility_flags": [
  "nodejs_compat"
],
"kv_namespaces": [
  {
    "binding": "ALBUM_CACHE_KV",
    "id": "<KV_NAMESPACE_ID>"
  }
]
```

## 开发命令

以下命令均在项目根目录运行。

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装所有 workspace 依赖。 |
| `pnpm run dev` | 启动本地 Worker。Worker 就绪后，再启动前端。 |
| `pnpm run page:dev` | 只启动 Vite 开发服务器。必须单独配置 `VITE_BACKEND_URL`。 |
| `pnpm run page:build` | 构建前端，输出到 `packages/page/dist`。 |
| `pnpm run worker:dev` | 在 `0.0.0.0:8787` 启动本地 Worker。 |
| `pnpm run worker:deploy` | 使用 Wrangler 部署 Worker。 |
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

### `GET /search`

搜索作品。`query` 是必需参数。

| 参数 | 可选值或格式 | 默认值 |
| --- | --- | --- |
| `query` | 搜索文本 | 无 |
| `page` | 页码 | `1` |
| `mainTag` | `0` 全部、`1` 作品名称、`2` 作者、`3` 标签、`4` 角色 | `0` |
| `orderBy` | `mr` 最新发布、`mv` 最多浏览、`mp` 最多图片、`tf` 最多喜欢 | `mr` |
| `time` | `a` 全部、`t` 今天、`w` 本周、`m` 本月 | `a` |
| `warmup` | 设置为 `1` 时预取当前搜索结果的作品信息 | 不启用 |
| `previousIds` | 上一页作品 ID，使用逗号分隔，最多 80 个 | 不启用 |

成功时返回 `SearchResult`。`page` 大于 1 且提供 `previousIds` 时，Worker 会拒绝与上一页完全相同的候选结果，并改用其他上游域名。所有候选域名都失败或返回重复页时，接口返回 `502`。

### `GET /album/:id`

返回指定作品的 `Album`。作品不存在时返回 `404`。

### `GET /photo/:id`

返回指定章节的 `PhotoWithScrambleId`。章节不存在时返回 `404`。

### `GET /batch-photo`

通过逗号分隔的 `ids` 参数批量获取章节。一次请求最多接收 20 个 ID。

接口为每个 ID 返回章节数据或结构化错误。单个章节失败不会中断其他章节。

### `GET /batch-album`

通过逗号分隔的 `ids` 参数批量获取作品和图片数据。一次请求最多接收 15 个 ID。

接口会先读取 Worker 缓存。它为每个 ID 返回作品数据或结构化错误。

所有接口都允许跨域请求。缺少必需参数、ID 列表为空或超出批量上限时，接口返回 `400`。未知路径返回 `404`。

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

OCR 运行时、WASM 和 PP-OCRv5 mobile 模型不会进入 PWA 预缓存，也不会由 Service Worker 拦截。用户首次翻译时才会下载这些资源，后续复用取决于资源服务器提供的普通 HTTP 缓存策略。LLM 请求由浏览器直接发往用户配置的服务；Worker 不代理 API Key 或译文。

自动翻译只处理当前章节。范围顺序是当前页、后一页、前一页，并继续按距离展开。本地 OCR 使用单例 Worker 串行执行，OCR 完成后的 LLM 请求按用户设置的 `1–6` 并发数运行。后台任务失败后会暂停当前范围，直到用户翻页、修改设置或手动翻译。Chat Completions 请求不发送 `temperature`；`reasoning_effort` 根据“跟随服务、关闭、开启”三态决定是否发送及使用的等级。

任务相关性由章节、请求配置和当前预翻译范围共同决定。API Key 参与运行任务身份但不参与译文缓存身份；因此切换密钥会中止旧请求，同时仍允许复用同模型、同提示词产生的缓存。翻页保留新范围交集内的自动任务，章节或请求配置不匹配的任务会中止且不显示错误。

翻译状态仅跟踪当前页。取消自动当前页不会终止其他后台任务；该页在翻页、修改设置或手动翻译前不会重新进入自动队列。每个运行任务都有独立的 `AbortController`；PaddleOCR 的单次 `predict` 无法中途终止，因此取消发生在 OCR 阶段时会保留 OCR 缓存并跳过后续 LLM 请求。

V3 翻译设置包含可编辑的翻译风格和内容处理提示词。V1/V2 设置加载后使用默认模板，显式空字符串保持为空。两段提示词的稳定哈希参与译文缓存键与自动完成键，固定 JSON 输出协议追加在组合 system 消息末尾。

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
