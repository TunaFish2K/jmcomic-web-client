# npm 发布配置

包名和命令均为 `jmcomic-sdk-pwa`。`jmcomic-sdk` 已被其他维护者使用，不要用它安装本项目。

## 首次启用

1. 在本机执行 `npm login --registry=https://registry.npmjs.org/`，完成 npm 要求的认证。不要把密码、验证码或 token 放进 GitHub 仓库。
2. 从本仓库 main 的成功 GitHub Release 下载 `jmcomic-sdk-pwa-<版本>.tgz` 和 `SHA256SUMS`。在下载目录执行 `sha256sum --check SHA256SUMS`，然后运行 `npm publish ./jmcomic-sdk-pwa-<版本>.tgz --access public --ignore-scripts --registry=https://registry.npmjs.org/`。首次发布使用测试过的实际安装包，不发布占位包。
3. 打开 npm 上该包的 Settings → Trusted publishing，添加 GitHub Actions：用户 `TunaFish2K`，仓库 `jmcomic-web-client`，workflow filename `verify-page.yml`，environment 留空；允许直接 `npm publish`。
4. 在 GitHub 仓库设置 Variables 中添加 `NPM_PUBLISH_ENABLED=true`，或执行 `gh variable set NPM_PUBLISH_ENABLED --body true --repo TunaFish2K/jmcomic-web-client`。
5. 重新运行首次版本的 `publish-npm` job（若原 job 因变量未设置而被跳过，则手动触发 `Verify and release` 工作流）。确认 OIDC 发布和 registry 安装验证成功。

启用前 `publish-npm` 显示跳过，这不表示 npm 发布通过；GitHub Release 和应用部署仍正常执行。首次认证未完成时不能宣称 npm 已可安装。

## 日常发布

SDK 或根依赖变化通过 mock 和受影响应用测试后，CI 生成 `0.2.<workflow run number>` 安装包、GitHub tag 和 Release。main 的 npm job 下载同一产物，校验 SHA256SUMS，通过 OIDC 发布，不重建、不注入长期 npm token。分支和 PR 不发布 npm。

发布 job 串行运行。新于 registry `latest` 的版本直接以 `latest` 发布；较旧版本使用 `build-0-2-N` 标签，避免回退默认安装版本。重复执行先比对该版本的 SHA-512 完整性，只有字节一致才跳过发布；认证失败、网络失败和同版本不同内容都报错，不伪装成功。

首次发布及 OIDC 绑定已完成，仓库已启用自动发布。

npm 有时先接受上传，再异步处理安装包；CI 最多等待 10 分钟，版本一旦可安装就立即继续。等待只发生在独立 npm job，不阻塞应用部署；超过上限明确失败，待 npm 完成处理后只重跑发布 job。

发布后从 registry 安装确切版本，验证导出、类型、CLI 和 WASM。失败可重试 `publish-npm`，不必重跑已通过的应用测试。应用部署不依赖 npm job。

[npm trusted publishing 官方说明](https://docs.npmjs.com/trusted-publishers/)；要求 npm 11.5.1+，CI 使用 Node 24 和 npm 11。
