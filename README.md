# jmcomic-web-client

禁漫天堂在线阅读与下载客户端。

## 功能

- **搜索**: 支持按作品名、作者、标签、角色搜索，过滤与排序
- **在线阅读**: 支持横向/纵向阅读模式，自动吸附/无缝模式切换
- **章节管理**: 多章节话数快速导航
- **本地缓存**: 阅读进度与偏好设置本地持久化

## 技术栈

- **前端**: React 19 + Vite + TailwindCSS + React Router + TanStack Query
- **后端**: Cloudflare Workers (Hono)
- **部署**: Cloudflare Pages (前端) + Cloudflare Workers (后端 API)

## 快速部署

### 前端 (page)

前端通过 GitHub Actions 自动部署到 Cloudflare Pages。

1. 在 Cloudflare Dashboard 创建 pages 项目，关联 GitHub 仓库
2. 构建命令: `pnpm run page:build`
3. 输出目录: `packages/page/dist`

首次推送后自动触发部署，之后每次 push 到 main 分支都会自动部署。

### 后端 (worker)

后端需要手动部署。

```bash
# 进入 worker 目录
cd packages/worker

# 部署
wrangler deploy
```

首次部署前需要配置 `wrangler.toml` 或环境变量：

```bash
# 方式一: 环境变量
export CF_API_TOKEN="你的 Cloudflare API Token"
export CF_ACCOUNT_ID="你的 Account ID"

# 方式二: 直接部署交互式配置
wrangler deploy
```

部署完成后会返回 worker 域名，格式为 `https://xxx.workers.dev`。

## 本地开发

```bash
# 安装依赖
pnpm install

# 同时启动 worker 和 page (推荐)
pnpm run dev

# 或只启动 page
pnpm run page:dev
```

.env 配置示例：

```bash
# .env 文件 (page 目录)
VITE_BACKEND_URL=http://localhost:8787
```

## 项目结构

```
jmcomic-web-client/
├── packages/
│   ├── page/           # 前端页面 (React + Vite)
│   │   ├── src/
│   │   │   ├── home/   # 搜索主页
│   │   │   ├── reader/ # 阅读器
│   │   │   └── api.ts  # API 调用
│   │   └── dist/       # 构建输出
│   │
│   └── worker/         # 后端 API (Cloudflare Workers + Hono)
│       ├── src/
│       │   ├── index.ts
│       │   ├── api/    # API 路由
│       │   ├── lib/    # 工具函数
│       │   └── pages/  # HTML 页面路由
│       └── wrangler.toml
│
├── scripts/             # 构建脚本
└── package.json        # Workspace 配置
```

## 设置项

阅读器支持以下设置（本地持久化）：

| 设置项 | 说明 | 默认值 |
|------|------|--------|
| 阅读方向 | 横向翻页 / 纵向滚动 | 横向翻页 |
| 自动吸附 | 强制每页停靠 | 开启 |
| 无缝模式 | 连续滚动，不吸附 | 关闭 |
| 懒加载范围 | 前后加载页数 | 4 页 |
| 信息栏位置 | 底部 / 左侧 / 右侧 | 底部 |

## 已知限制

- 部分地区可能无法访问图片 CDN
- 下载功能需要浏览器支持 Service Worker / Web Worker
- 部分复杂漫画可能出现解密失败

## 免责声明

本项目仅供技术学习与个人研究使用，不得用于任何商业目的。

- 本项目不存储、传播或分享任何受版权保护的内容
- 使用本项目产生的一切法律后果由使用者自行承担
- 请在适用法律允许的范围内使用本项目

## License

This project is dedicated to the public domain under the Unlicense, which means you can use, modify, and distribute it without any conditions. See the LICENSE file for details.

## LICENSE

This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org>