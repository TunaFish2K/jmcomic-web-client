# jmcomic-web-client

禁漫天堂第三方 Web 客户端。项目支持作品搜索、在线阅读、本地缓存和文件导出。

前端通过 Cloudflare Worker 获取作品和章节信息。浏览器直接获取图片，并在本地还原、缓存或导出图片。

## 功能

- **作品搜索**：按作品名称、作者、标签或角色搜索。支持按发布时间、浏览量、图片数和喜欢数排序。
- **作品详情**：查看作者、标签、角色、章节和阅读进度。
- **在线阅读**：支持左右滚动和上下滚动。自动吸附与无缝模式可以独立组合，手机端支持双指缩放。
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

阅读方向、自动吸附、无缝模式和懒加载范围会保存在浏览器中。自动吸附与无缝模式相互独立，切换其中一项不会修改另一项。无缝模式在左右和上下阅读方向中都会移除相邻页面之间的整屏空白；自动吸附开启时，滚动仍会对齐到每一页的起点。信息栏位置目前固定在底部。

手机端可以将阅读内容双指缩放至 1 至 4 倍，并在放大后单指拖动。在“无缝模式开启、自动吸附关闭”时，手势开始时屏幕内可见的全部页面会作为一组缩放，页面接缝保持连续；其他组合缩放当前图片。双指缩回 1 倍、放大后双击或点击顶栏的重置按钮可恢复原尺寸。翻页、切换章节或更改阅读模式时也会重置缩放；关闭自动吸附时，重置后会回到缩放前的滚动位置。术语定义见 [项目语境](CONTEXT.md)。

## 已知限制

- PWA 不缓存应用壳。断网时不能启动应用或导航到新页面。
- 搜索、作品信息和未缓存的图片依赖上游服务。
- 部分网络环境可能无法访问图片 CDN。
- 阅读和导出依赖 IndexedDB、OffscreenCanvas 和 `createImageBitmap`。旧版浏览器可能无法处理图片。
- PDF、ZIP 和 CBZ 文件在浏览器内生成。导出大量章节时会占用较多内存。
- 上游接口或图片规则发生变化时，搜索、阅读和导出可能失败。

## 免责声明

本项目用于技术学习和个人研究。仓库不包含漫画内容，项目运行时获取的内容来自第三方服务。

使用者必须遵守所在地法律，并自行确认其访问、缓存和导出内容的权利。软件许可不代表项目作者对第三方内容授予任何权利。

## 许可

本项目的软件代码按 [Unlicense](LICENSE) 发布。
