# jmcomic-web-client

禁漫天堂第三方 Web 客户端，支持搜索、在线阅读、本地缓存和导出。

项目由两部分组成：Cloudflare Worker 负责请求上游接口，Cloudflare Pages 托管前端。图片由浏览器直接下载，并在本地还原和缓存。

## 功能

- 按名称、作者、标签或角色搜索作品，支持排序
- 左右或上下滚动阅读，支持无缝模式、自动吸附和手机双指缩放
- 记录阅读进度，可在章节之间跳转
- 将单章或多章导出为 PDF、ZIP 或 CBZ
- 在浏览器中缓存作品信息和图片
- 可选的漫画翻译：本地 OCR 加上你自己的 LLM API Key
- 可安装为 PWA，支持浅色和深色主题

阅读器设置和翻译配置见[使用说明](docs/usage.md)。

## 自行部署

推荐流程：fork 本仓库，用 GitHub Actions 部署 Worker，再用 Cloudflare Pages 部署前端。这样不需要本地环境，以后同步上游时会自动重新部署。

### 1. 部署 Worker（推荐：GitHub Actions）

1. Fork 本仓库，然后在 fork 的 **Actions** 页面启用工作流。
2. 在 Cloudflare Dashboard 中准备以下信息：
   - **API 令牌**：在 **我的个人资料 → API 令牌** 中，用“编辑 Cloudflare Workers”模板创建。
   - **账户 ID**：在 **Workers & Pages** 概览页的右侧可以找到。
   - 如果账号第一次使用 Workers，先打开一次 **Workers & Pages**，让 Cloudflare 生成 `workers.dev` 子域。
3. （可选）在 **存储和数据库 → KV** 中创建一个命名空间，并复制它的 ID。配置后，Worker 会缓存作品信息；不配置也能正常运行。
4. 在 fork 的 **Settings → Secrets and variables → Actions** 中添加 Secrets：

   | Secret | 是否必需 | 说明 |
   | --- | --- | --- |
   | `CF_API_TOKEN` | 必需 | Cloudflare API 令牌 |
   | `CF_ACCOUNT_ID` | 必需 | Cloudflare 账户 ID |
   | `ALBUM_CACHE_KV_ID` | 可选 | KV 命名空间 ID |

5. 打开 **Actions → Verify and release → Run workflow**，选择 `main` 分支并运行。首次运行会执行完整测试，需要十几分钟。
6. `deploy-worker` 任务成功后，在 Dashboard 的 **Workers & Pages** 中找到名为 `worker` 的 Worker，并记下它的地址：`https://worker.<子域>.workers.dev`。
7. 在浏览器中打开 `<Worker 地址>/search?query=test`。如果返回 JSON 格式的搜索结果，说明 Worker 已经可以使用。

之后，只要 `main` 分支中 Worker 相关的代码有变化（包括同步上游），测试通过后就会自动重新部署。SDK 代码变化还会让工作流在你的 fork 中创建 GitHub Release，这不影响部署。

<details>
<summary>备选：在本地用命令行部署</summary>

需要 Node.js 24 或更高版本。在仓库根目录运行：

```bash
corepack enable
pnpm install
pnpm --filter @tiny-client/worker exec wrangler login
ALBUM_CACHE_KV_ID=<KV 命名空间 ID> pnpm run worker:deploy
```

不使用 KV 时，去掉 `ALBUM_CACHE_KV_ID=…`。部署成功后，终端会输出 Worker 地址。

</details>

### 2. 部署前端（Cloudflare Pages）

1. 在 Cloudflare Dashboard 中进入 **Workers & Pages**，点击 **创建**，选择 **Pages**，然后选择 **导入现有 Git 存储库**。
2. 授权 Cloudflare 访问 GitHub，选择你 fork 的仓库。
3. 按下表填写构建设置：

   | 设置 | 值 |
   | --- | --- |
   | 生产分支 | `main` |
   | 框架预设 | 无 |
   | 构建命令 | `pnpm run build` |
   | 构建输出目录 | `dist` |
   | 根目录（高级） | `packages/page` |

4. 在同一页的 **环境变量** 中添加：

   | 变量 | 值 |
   | --- | --- |
   | `VITE_BACKEND_URL` | 第 1 步得到的 Worker 地址，例如 `https://worker.xxx.workers.dev`，末尾不要带 `/` |
   | `NODE_VERSION` | `24` |

5. 点击 **保存并部署**。首次构建需要几分钟，完成后会得到 `https://<项目名>.pages.dev` 地址。

Pages 会自动识别仓库固定的 pnpm 版本，并安装整个 workspace 的依赖，不需要另外配置。之后 `main` 分支每次更新，Pages 都会自动重新构建。

`VITE_BACKEND_URL` 是在构建时写入前端的。修改后，要在 Pages 项目的 **部署** 页面对最新部署选择 **重试部署**，修改才会生效。

### 3. 检查部署

1. 打开 `https://<Pages 地址>/release.json`，确认 `commit` 是你刚部署的提交。
2. 打开首页搜索一次，确认能返回结果，并能打开作品阅读。

### 可选：绑定自己的域名

- **前端**：在 Pages 项目的 **自定义域** 中添加域名。
- **Worker**：在 Worker 的 **设置 → 域和路由** 中添加自定义域。添加后，把 Pages 的 `VITE_BACKEND_URL` 改成新地址，然后重新部署 Pages。

### 更新

在 GitHub 上打开你的 fork，点击 **Sync fork → Update branch**。Worker 和 Pages 会自动重新部署。可以在 fork 的 **Actions** 页面查看 Worker 的部署进度，在 Pages 项目的 **部署** 页面查看前端的构建进度。

## 漫画翻译

翻译功能是可选的，部署时不需要额外配置。用户在阅读器中填写 OpenAI 兼容服务的地址、模型和 API Key。OCR 在浏览器本地运行，只把识别出的文字发给 LLM，不发送图片。

API Key 保存在浏览器的 `localStorage` 中。如果 LLM 服务不允许浏览器跨域请求，可以在翻译设置中开启“Worker 代理”。

**部署者请注意：** Worker 的 `/llm-proxy` 接口是公开的，任何知道 Worker 地址的人都可以通过它转发 LLM 请求。Worker 不保存 API Key，只允许访问公网 HTTPS 的 LLM 接口，但请求会占用你的 Worker 用量。

## 常见问题

**`deploy-worker` 被跳过**：检查是否配置了 `CF_API_TOKEN`，以及是否在 `main` 分支上运行。未配置令牌时，任务日志里会显示“未配置 CF_API_TOKEN，跳过 Worker 部署”。

**`deploy-worker` 没有运行**：`deploy-worker` 要等前面的测试任务通过后才会运行。在 Actions 中打开这次运行，找到失败的任务并查看日志；如果是偶发失败，点击 **Re-run failed jobs** 重新运行。

**`deploy-worker` 提示需要注册 workers.dev 子域**：在 Cloudflare Dashboard 中打开一次 **Workers & Pages**，然后重新运行工作流。

**Pages 构建失败**：检查根目录、构建命令和输出目录是否与上表一致，以及是否设置了 `NODE_VERSION=24`。在 Pages 项目的 **部署** 页面，可以打开失败的部署查看构建日志。

**页面能打开，但搜索失败**：检查 `VITE_BACKEND_URL` 是否是完整的 `https://` 地址，末尾不要带路径。修改后需要重新部署 Pages。也可以直接在浏览器中访问 `<Worker 地址>/search?query=test`，确认 Worker 本身可用。

**Worker 返回 502**：所有上游域名都请求失败，通常是上游临时不可用。可以在 Cloudflare Dashboard 中查看 Worker 日志。

**图片无法显示**：图片由浏览器直接从图片 CDN 下载，不经过 Worker。请确认当前网络能访问图片 CDN。

## 已知限制

- 应用不支持离线启动，搜索和未缓存的图片都依赖上游服务。
- 上游接口或图片规则变化时，相关功能可能失效，需要等待项目更新。
- 需要支持 IndexedDB、OffscreenCanvas 和 `createImageBitmap` 的现代浏览器。
- 导出文件在浏览器内生成，导出大量章节时会占用较多内存。
- 译文只在阅读器中显示，不会写入导出文件。

## 本地开发

```bash
pnpm install
pnpm run dev
```

前端地址为 `http://localhost:5173`，Worker 地址为 `http://localhost:8787`。开发命令、接口说明、缓存策略和测试方法见[开发指南](docs/development.md)。

## 独立使用 SDK

[packages/sdk](packages/sdk) 可以单独使用，不需要部署本项目。安装方法：`npm install jmcomic-sdk-pwa`。使用方法见 [SDK 文档](packages/sdk/README.md)。

## 社区

项目曾在 [LINUX DO](https://linux.do) 社区分享。

## 免责声明

本项目用于技术学习和个人研究。仓库不包含漫画内容，项目运行时获取的内容来自第三方服务。

使用者必须遵守所在地法律，并自行确认其访问、缓存和导出内容的权利。软件许可不代表项目作者对第三方内容授予任何权利。

## 许可

本项目的软件代码按 [Unlicense](LICENSE) 发布。
