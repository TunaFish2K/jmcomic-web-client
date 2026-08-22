# jmcomic-web-client

禁漫天堂第三方 Web 客户端。项目支持作品搜索、在线阅读、本地缓存和文件导出。

前端通过 Cloudflare Worker 获取作品和章节信息。浏览器直接获取图片，并在本地还原、缓存或导出图片。

## 功能

- **作品搜索**：按作品名称、作者、标签或角色搜索。支持按发布时间、浏览量、图片数和喜欢数排序。
- **作品详情**：查看作者、标签、角色、章节和阅读进度。
- **在线阅读**：支持左右滚动和上下滚动。自动吸附与无缝模式可以独立组合，手机端支持双指缩放。
- **可选漫画翻译**：阅读器可以运行本地 PaddleOCR，并通过自带的 OpenAI 兼容 API Key 手动或自动翻译日文。译文覆盖在原图文本框上，点击单个文本框可切换原文。
- **章节导航**：在章节列表中跳转，并从上次阅读的位置继续。
- **文件导出**：将单章或指定章节范围导出为 PDF、ZIP 或 CBZ。批量导出时可以生成多个文件，也可以合并为一个文件。
- **本地缓存**：缓存作品信息和已处理的图片。阅读器可以显示缓存用量并清除图片缓存。
- **界面偏好**：支持浅色、深色和跟随系统三种主题。阅读方向、吸附模式、懒加载范围和阅读进度保存在浏览器中。
- **PWA**：可以将前端安装为独立应用。应用启动、页面导航和接口请求需要网络连接。

## 技术栈

- **前端**：React 19、Vite 8、Tailwind CSS 4、HeroUI、React Router 7、TanStack Query 5
- **后端**：Cloudflare Workers 原生 Fetch Handler
- **共享模块**：TypeScript、CryptoJS、fflate、pdf-lib
- **项目管理**：pnpm workspace
- **部署平台**：Cloudflare Pages 和 Cloudflare Workers

## 运行要求

- Node.js 22.12 或更高版本
- pnpm 10.28.0
- 支持 IndexedDB、OffscreenCanvas 和 `createImageBitmap` 的现代浏览器

项目在根目录的 `package.json` 中固定了 pnpm 版本。使用 Corepack 时，先启用对应的命令代理：

```bash
corepack enable
```

## 本地开发

1. 安装依赖。

```bash
pnpm install
```

2. 同时启动 Worker 和前端。

```bash
pnpm run dev
```

前端默认地址为 `http://localhost:5173`。Worker 默认地址为 `http://localhost:8787`。根目录的开发命令会自动把 Worker 地址传给前端，因此不需要创建环境变量文件。

如果只启动 Worker，请运行：

```bash
pnpm run worker:dev
```

如果只启动前端，必须先在 `packages/page/.env.local` 中配置后端地址：

```dotenv
VITE_BACKEND_URL=http://localhost:8787
```

然后运行：

```bash
pnpm run page:dev
```

更多开发命令、接口说明和缓存策略见[开发指南](docs/development.md)。

## 部署

前端构建时需要 Worker 地址，因此应先部署 Worker，再部署 Cloudflare Pages。

### 部署 Worker

首次手动部署前，先登录 Cloudflare：

```bash
pnpm --filter @tiny-client/worker exec wrangler login
```

然后在项目根目录运行：

```bash
pnpm run worker:deploy
```

部署成功后，Wrangler 会返回一个 `https://<worker-name>.<account>.workers.dev` 地址。

仓库也包含 `.github/workflows/deploy-worker.yml`。当 `main` 分支中的 `packages/worker/**` 发生变化时，该工作流会自动部署 Worker。使用工作流前，必须在 GitHub 仓库中配置以下 Secrets：

- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`

Worker 可以选择绑定 `ALBUM_CACHE_KV`，以启用一小时的作品信息缓存。没有该绑定时，Worker 仍会使用进程内缓存。配置方法见[开发指南](docs/development.md#worker-kv-缓存)。

### 部署前端

1. 在 Cloudflare Dashboard 中创建 Pages 项目。
2. 将 Pages 项目连接到此 Git 仓库。
3. 将构建命令设置为 `pnpm run page:build`。
4. 将构建输出目录设置为 `packages/page/dist`。
5. 将 `VITE_BACKEND_URL` 设置为已部署的 Worker 地址。
6. 触发首次部署。

完成 Git 集成后，Cloudflare Pages 会在目标分支更新时重新构建前端。前端部署不使用仓库中的 Worker GitHub Actions 工作流。

每次前端部署后，读取 `/release.json` 并确认 `commit` 等于目标提交。还要检查 `/sw.js`、`/manifest.webmanifest` 和 HTML 响应是否包含 `Cache-Control: no-cache, no-store, must-revalidate`。

PWA 故障不能通过恢复旧 Pages 部署解决。旧部署会同时恢复旧 Service Worker 和旧缓存头。出现回归时，应从当前安全基线追加修复提交，并继续保留 `assets-v3`、清理 Worker 和关键资源的 `no-store` 响应头。

## 项目结构

```text
jmcomic-web-client/
├── packages/
│   ├── page/                 # React 前端、阅读器和浏览器端缓存
│   │   └── src/
│   │       ├── home/         # 搜索和作品详情
│   │       ├── reader/       # 阅读器和阅读设置
│   │       ├── translation/  # 本地 OCR、BYOK 翻译和译文图层
│   │       ├── api.ts        # Worker API 客户端
│   │       └── album-cache.ts
│   ├── shared/               # 上游客户端、共享类型、图片处理和文件导出
│   │   └── src/
│   └── worker/               # Cloudflare Worker API
│       ├── src/index.ts
│       └── wrangler.jsonc
├── scripts/
│   └── test-integration.js   # Worker 集成测试
├── .github/workflows/
│   └── deploy-worker.yml
├── package.json
└── pnpm-workspace.yaml
```

## 阅读器设置

| 设置 | 可选值 | 默认值 |
| --- | --- | --- |
| 阅读方向 | 左右滚动、上下滚动 | 左右滚动 |
| 自动吸附 | 开启、关闭 | 开启 |
| 无缝模式 | 开启、关闭 | 关闭 |
| 懒加载范围 | 前后各 1 至 12 页 | 前后各 4 页 |
| 信息栏 | 显示、隐藏 | 显示在底部 |
| 自动翻译 | 开启、关闭 | 关闭 |
| 预翻译范围 | 当前页前后各 0 至 5 页 | 前后各 2 页 |
| LLM 并发 | 1 至 6 | 1 |
| 思考 | 跟随服务、关闭、开启 | 关闭 |
| 思考等级 | Minimal、Low、Medium、High、XHigh、Max | Medium |
| 翻译风格提示词 | 自定义多行文本或留空 | 成人向本地化模板 |
| 内容处理（破限）提示词 | 自定义多行文本或留空 | 忠实内容处理模板 |

阅读方向、自动吸附、无缝模式和懒加载范围会保存在浏览器中。自动吸附与无缝模式相互独立，切换其中一项不会修改另一项。无缝模式在左右和上下阅读方向中都会移除相邻页面之间的整屏空白；自动吸附开启时，滚动仍会对齐到每一页的起点。信息栏位置目前固定在底部。

手机端可以将阅读内容双指缩放至 1 至 4 倍，并在放大后单指拖动。在“无缝模式开启、自动吸附关闭”时，手势开始时屏幕内可见的全部页面会作为一组缩放，页面接缝保持连续；其他组合缩放当前图片。双指缩回 1 倍、放大后双击或点击顶栏的重置按钮可恢复原尺寸。翻页、切换章节或更改阅读模式时也会重置缩放；关闭自动吸附时，重置后会回到缩放前的滚动位置。术语定义见 [项目语境](CONTEXT.md)。

## 可选漫画翻译

在阅读器工具栏或设置面板中打开“漫画翻译”，填写 OpenAI 兼容服务的 Base URL、模型名称和 API Key，然后手动翻译当前页或启用自动翻译。Base URL 应指向 API 根路径，例如 `https://api.openai.com/v1`，前端会请求其 `/chat/completions` 接口。

自动模式会处理当前页及本章前后指定范围内的页面。当前页优先，然后依次处理同距离的后页和前页；翻页后，尚未开始的任务会按新范围重排。本地 OCR 始终串行运行，完成 OCR 的页面按照设置的并发数请求 LLM。

翻页时仍位于新范围内的后台任务会继续，范围外任务会取消。切换章节、关闭自动翻译或修改 Base URL、模型、API Key、思考及提示词配置时，不再适用的等待和运行任务会被丢弃，不会继续请求 LLM 或向新页面显示错误。

翻译状态条只显示当前页的 OCR 或 LLM 阶段，不显示后台预翻译数量。点击状态条的关闭按钮会取消当前页翻译；自动任务取消后，其他后台页继续处理，被取消页会在翻页、修改设置或手动翻译后恢复自动调度。正在执行的 OCR 推理会完成并缓存，但不会继续请求 LLM。

思考设置使用 Chat Completions 的 `reasoning_effort` 字段。“跟随服务”不发送该字段，“关闭”发送 `none`，“开启”发送选定等级。翻译请求不发送 `temperature`。不支持所选等级的服务会直接返回参数错误。

翻译风格和内容处理提示词默认使用成人向作品的忠实本地化模板，可以编辑、清空或恢复默认。自定义提示词与应用的固定 JSON 输出协议组合为一个 system 消息，输出协议始终位于末尾。

日文 OCR 使用 PP-OCRv5 mobile 检测和识别模型，在浏览器 Web Worker/WASM 中运行。OCR 模型和运行时仅在首次翻译时下载，之后由浏览器缓存。前端只向 LLM 服务发送 OCR 文本、置信度和文本框位置，不发送漫画图片。

API Key 会按用户选择始终保存在当前浏览器的 `localStorage` 中，并由浏览器直接发送给配置的 LLM 服务。不要在不受信任或多人共用的浏览器中保存生产密钥。LLM 服务必须允许浏览器跨域请求。

识别结果和译文保存在 IndexedDB 中。相同章节页面、OCR 版本、模型、思考配置与提示词配置会复用缓存；可以在翻译设置中清除缓存或重新翻译当前页。

## 已知限制

- PWA 不缓存应用壳。断网时不能启动应用或导航到新页面。
- 搜索、作品信息和未缓存的图片依赖上游服务。
- 部分网络环境可能无法访问图片 CDN。
- 阅读和导出依赖 IndexedDB、OffscreenCanvas 和 `createImageBitmap`。旧版浏览器可能无法处理图片。
- PDF、ZIP 和 CBZ 文件在浏览器内生成。导出大量章节时会占用较多内存。
- 页面译文仅在阅读器中显示，不会写入 PDF、ZIP 或 CBZ 导出文件。
- 本地 OCR 需要 WebAssembly、Web Worker、`createImageBitmap` 和 `OffscreenCanvas`。首次使用需要下载 OCR 模型；低内存设备可能较慢。
- BYOK 翻译是浏览器直连。LLM 服务不允许 CORS、网络阻断或模型不兼容 `/chat/completions` 时，翻译会失败。
- 上游接口或图片规则发生变化时，搜索、阅读和导出可能失败。

## 免责声明

本项目用于技术学习和个人研究。仓库不包含漫画内容，项目运行时获取的内容来自第三方服务。

使用者必须遵守所在地法律，并自行确认其访问、缓存和导出内容的权利。软件许可不代表项目作者对第三方内容授予任何权利。

## 许可

本项目的软件代码按 [Unlicense](LICENSE) 发布。
