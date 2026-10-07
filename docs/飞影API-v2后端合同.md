# 飞影 API v2 后端合同

核对日期：2026-10-07。依据 [官方参数表](https://api.hifly.cc/hifly.html) 与本机保存的官方 HTML。以下为本地适配合同，真实账号权限、生成结果及计费尚未验证。

数字人和声音入口统一使用 `model_id: service:hifly`。不增加 `driver` 参数，输入字段决定驱动分支。

| 工具 | 本地 input | options | 官方接口 |
|---|---|---|---|
| 创建图片形象 avatar_create | image_id | model: 1（视频2.0）或2（视频2.1），官方默认2 | avatar/create_by_image |
| 创建视频形象 avatar_create | video_id | 不传 model | avatar/create_by_video |
| 文字驱动 text_avatar | text + avatar_id + voice_id，或 text + video_id | st_show: 0或1 | video/create_by_tts |
| 音频驱动 audio_avatar | audio_id + avatar_id，或 audio_id + video_id | 空对象 | video/create_by_audio |
| 图片驱动 photo_talk | image_id + text + voice_id | model: 5（4.0）或6（4.0卡通），官方默认5 | video/create_by_image |
| 声音克隆 voice_create | audio_id | 空对象，后端固定 voice_type=8 | voice/create |
| 文本配音 tts | text + voice_id | 空对象 | audio/create_by_tts |

创建形象的 image_id / video_id 严格二选一。视频要求 MP4/MOV、H.264、≤500MB、5–1800秒、360p–4K。本地先验证，再由后台获取上传地址并 PUT 文件；不向前台暴露供应商 file_id 或签名 URL。

文字/音频驱动的出镜来源在本应用中严格二选一：飞影形象或人物视频。音频驱动不能用普通照片代替；文字驱动的原视频可替代 avatar 和 voice。图片驱动官方完整参数表只列 image_file_id、voice、text、model；没有音频输入，不添加猜测的 TTS 计费链。

## Catalog

飞影工具标记 `async: true, api_version: v2`。形象创建返回 `optional` 与 `require_any: [image_id, video_id]`、`exclusive_inputs: true`，以及 `creation_modes` 的图片/视频输入、选项与视频限制。文字/音频工具返回 `input_alternatives`、`require_any: [avatar_id, video_id]` 和 `exclusive_inputs: true`。

旧平台数字人模型可逆下架，账号配置、绑定、旧草稿参数、历史任务均保留；当前有效入口使用飞影。旧绑定在 catalog 返回 `legacy_binding` 和 `migration_notice`。显式选择旧模型会拒绝新任务；历史已提交任务仍查询原服务，不迁移供应商任务ID。

## 异步操作与本地轮询

- POST `/api/studio/generate`：`draft_id, version, confirmed:true, request_id`，返回本地运行记录；素材上传和付费提交在后台线程。重试使用相同 request_id；同草稿版本的在途/未知任务也会去重。
- POST `/api/studio/runs/{id}/refresh`：返回当前快照，后台仅查询已有任务或保存已有结果。前台轮询 GET `/api/studio/runs`，不会再次生成。
- POST `/api/studio/upload?provider=hifly&confirmed=true`：返回已保存的本地素材和 `upload_status: queued`；后台上传后为 `uploaded`，失败为 `failed`，重启中断为 `interrupted`。轮询 GET `/api/studio/assets`。
- GET `/api/studio/assets?asset_type=avatar|voice&refresh=true`：返回已有 items 和 `public_library_status`。后台只导入 kind=2 的公共资源，并再次过滤返回类型。后续不带 refresh 的 GET 查询 `idle/queued/running/ready/failed/interrupted` 和安全的 `public_library_error`。

后台每30秒查询已知飞影任务ID；只读轮询不会重发生成。提交响应超时且没有任务ID时为 unknown，禁止自动重提；有任务ID的任务重启后继续查询。24小时是本地自动监控上限，不宣称供应商任务过期；超过期限保留原ID，可手动刷新。

飞影官方未提供任务取消接口。只允许在 queued/preparing 且尚未进入付费提交边界时本地取消；已提交任务不能用删除作品模拟取消或退款。

资源绑定本地 owner 和供应商账号/地域范围；签名地址、供应商资源ID、远端文件ID和服务密钥不返回前台。验证只使用临时 SQLite、合成测试密钥与 HTTP mock；不调用真实付费接口。
