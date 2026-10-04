# 上游手机接口台账

扩展模式使用的上游接口。接口契约以官方 APK 2.1.9 的实际调用为准；第三方 SDK 只用于交叉核对。

## 来源

| 项目 | 值 |
| --- | --- |
| APK | [JMComic-APK 2.1.9](https://github.com/hect0x7/JMComic-APK/releases/tag/2.1.9)，发布于 2026-09-23 |
| SHA-256 | `9682aad645bfa0f20865b0d68d77f0771d81265b36c577618dfe70edf44d8163`，与发布页资产记录一致 |
| 读取方式 | 解包 `assets/public/static/js/*.map` 的 `sourcesContent`，主要依据 `api/apiPaths.ts`、`api/HttpUtil.ts`、`actions/*.ts` 和调用组件 |
| 实现 | `packages/sdk/src/mobile.ts`，入口 `jmcomic-sdk-pwa/mobile` |

APK 不进入仓库。重新核对时，下载同一资产并比对哈希。

## 协议

| 项目 | APK 2.1.9 | 原有 SDK 读取接口 |
| --- | --- | --- |
| `token` | `md5(时间戳 + "185Hcomic3PAPP7R")` | `md5(时间戳 + "18comicAPP")` |
| `tokenparam` | `时间戳,2.1.9` | `时间戳,<setting 返回的版本>` |
| GET 参数 | 自动追加 `lang=TW` | 不追加 |
| POST 正文 | `multipart/form-data`；个别接口用 JSON | 无 |
| 账号凭据 | `Authorization: Bearer <jwttoken>`，`Cookie: AVS=<登录响应的 s>` | 无 |
| 响应解密 | `data` 用 `md5(时间戳 + "185Hcomic3PAPP7R")` 做 AES-ECB 解密 | 相同 |
| 业务错误 | HTTP 400 时正文仍是信封，按 `code`/`errorMsg` 处理，不重试 | — |

两种签名并存，按客户端选择：原有搜索、详情和章节仍用旧签名，`MobileApiClient` 用 APK 签名。一种签名失败时不改用另一种重发。

APK 中的 GET 和 POST 在非 2xx 时最多自动重试三次。SDK 不照搬：写操作只发送一次；网络失败或 5xx 时返回 `WRITE_UNCERTAIN`，由调用方重新读取状态。

## 接口

验证状态：**实测**表示已用 APK 签名访问真实上游并确认响应结构；公共接口实测于 2026-10-04，账号接口于 2026-10-05 用测试账号经 `pnpm sdk:test:account` 实测。**源码**表示只由 APK 调用代码确认。

### 发现（无需登录）

| 接口 | 方法 | 参数 | 响应 `data` | 读/写 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `/setting` | GET | — | 设置对象，含 `version`、`img_host` | 读 | 实测 |
| `/promote` | GET | — | 分区数组 `{id,title,slug,type,filter_val,content[]}`；`type` 为 `promote`、`category_id`、`not_in_category_id`、`library`、`novels` | 读 | 实测 |
| `/promote_list` | GET | `id`、`page`（从 0 开始） | `{total,list[]}` | 读 | 实测 |
| `/latest` | GET | `page`（从 0 开始） | 作品数组 | 读 | 实测 |
| `/serialization` | GET | `type`、`date`、`page` | `{total,list[]}`；缺少参数时返回 `{error}` | 读 | 实测 |
| `/categories` | GET | — | `{categories[{id,name,slug,total_albums}],blocks[{title,content[]}]}` | 读 | 实测 |
| `/categories/filter` | GET | `c`（分类 slug，`0` 为全部）、`o`（排序）、`page` | `{search_query,total,content[],tags[]}` | 读 | 实测 |
| `/week` | GET | — | `{categories[{id,title,time}],type[{id,title}]}` | 读 | 实测 |
| `/week/filter` | GET | `id`、`type`、`page`（可选） | `{total,list[]}` | 读 | 实测 |
| `/hot_tags` | GET | — | 字符串数组 | 读 | 实测 |
| `/random_recommend` | GET | — | 作品数组 | 读 | 实测 |
| `/forum` | GET | `mode=all`、`aid`、`page` | `{total,list[]}`，评论扁平排列，回复用 `parent_CID` 指向父评论 | 读 | 实测 |

作品数组元素：`{id,author,name,image,category{id,title},category_sub,liked,is_favorite|favorite,update_at}`。登录后，`liked` 和收藏状态按账号返回。

### 账号

| 接口 | 方法 | 参数 | 说明 | 读/写 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `/login` | POST | `username`、`password` | `data` 含 `uid`、`username`、`email`、`jwttoken`、`s`（AVS Cookie）、`level_name`、`coin` 等；APK 只在本地保存 1 小时 | 写 | 实测 |
| `/register` | POST | `username`、`password`、`password_confirm`、`email`、`gender` | | 写 | 源码 |
| `/forgot` | POST | `email` | 第三方 SDK 写作 `/forget`，实现采用 APK 的 `/forgot` | 写 | 源码 |
| `/logout` | POST | — | | 写 | 实测 |
| `/useredit/{uid}` | GET | — | 资料表单数据 | 读 | 实测 |
| `/useredit/{uid}` | POST | 整份表单：`username`、`email`、`password`、`password_confirm`、`birthday`、`relations`、`sexuality`、`website`、`city`、`country` 等 | 先 GET 再整体提交 | 写 | 源码 |

### 收藏与互动

| 接口 | 方法 | 参数 | 说明 | 读/写 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `/favorite` | GET | `page`、`folder_id`、`o`（`mr` 最新、`mp` 最多图片） | 收藏列表和收藏夹，`data` 为 `{list,folder_list[{FID,name}],total,count}` | 读 | 实测 |
| `/favorite` | POST | `aid` | **切换**收藏状态，不是幂等的添加。`data` 为 `{status:"ok",msg,type}`，`type` 为 `add` 或 `remove`。删除收藏也用这个接口 | 写 | 实测 |
| `/favorite_folder` | POST | `type`：`add`（`folder_name`）、`edit`（`folder_id`、`folder_name`）、`del`（`folder_id`）、`move`（`folder_id`、`aid`） | `data` 为 `{status:"ok",msg}` | 写 | 源码 |
| `/like` | POST | `id`（作品 ID），`like_type` 可选 | 点赞作品 | 写 | 源码 |
| `/comment` | POST | `aid`、`comment`；回复时加 `comment_id` | 2026-10-05 上游拒绝含英文或数字的内容，返回“暂时不可输入英文和数字”。验收不发表公开评论 | 写 | 源码 |
| `/comment_delete` | POST | `comment_id`、`aid` | 删除本人评论 | 写 | 源码 |

### 签到与历史

| 接口 | 方法 | 参数 | 说明 | 读/写 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `/daily` | GET | `user_id` | 当日签到信息，含 `daily_id` | 读 | 实测 |
| `/daily_chk` | POST | `user_id`、`daily_id` | 签到 | 写 | 源码 |
| `/daily_list` | GET | `user_id` | 可选月份 | 读 | 源码 |
| `/daily_list/filter` | POST | `data`（月份） | 指定月份的签到记录；虽然用 POST，但是读操作 | 读 | 源码 |
| `/watch_list` | GET | `page` | 云端观看历史 | 读 | 实测 |
| `/watch_list` | POST | `id`（作品 ID） | **删除**一条历史，APK 只在长按删除时调用。`data` 为 `{status:1,msg}` | 写 | 源码 |

`user_id`、`uid` 一律取自登录会话，不接受调用方传入。

## 暂缓

以下接口出现在 APK 中，本次不实现：

- `comment_vote`：只在 `apiPaths.ts` 中定义，APK 2.1.9 没有调用，契约无法确认。
- 通知与追更：`notifications`、`notifications/unreadCount`、`album_sertracking`、`album_tracking`。
- 标签：`tags_favorite`、`tags_favorite_update`、`tag_block`（JSON 正文）。
- 成就与金币：`tasks`、`coin`、`coin_buy_comics`、`coin_buy_charge`、`ad_free`、`payment`。
- 其他内容：小说（`novels` 等）、影片（`videos`、`video` 等）、部落格（`blogs`、`blog`）、游戏（`allgames`、`game`）、书库（`creator_*`）、`check_recommend_book`、`album_download_2`、`support_report`、`error_log`、广告接口。
