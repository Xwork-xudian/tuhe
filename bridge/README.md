# 途合桥接器 · TUHE Bridge

把途合的 `place.upsert` Webhook 转换成**带 Cookie 的平台请求**的自建中间层。

- 途合不保存平台 Cookie；Cookie 只存在桥接器
- Cookie 使用 AES-256-GCM 加密落盘，接口不回显明文
- 默认「预览模式」：只渲染请求并记录，不真正发送
- 每个平台独立配置 URL / 请求头 / 请求体模板 / 最小请求间隔
- 自带管理界面、请求日志、Cookie 验活、externalId 回传
- 无第三方依赖（Express + Node 内置 fetch/crypto）

> ⚠️ 仅用于你自己的账号。高德 / 百度 / 圆周旅迹都没有开放个人收藏的公开写入 API，本工具通过浏览器请求模板转发，接口可能随时变化，也存在触发风控或封号的风险。本项目不绕过验证码、二次验证或其他安全机制。请保持低频，并先用 1 个地点试跑。

## 快速启动

```bash
cd bridge
docker compose up -d --build
```

打开 `http://localhost:8790/`。

数据目录：`./data`（`bridge.json`、`secret`），请定期备份；删除 `secret` 会导致已保存 Cookie 无法解密。

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `BRIDGE_PORT` | `8790` | 监听端口 |
| `BRIDGE_DATA_DIR` | `/app/data` | 数据目录 |
| `BRIDGE_SECRET` | 自动生成 `data/secret` | Cookie 加密密钥；多实例请显式设置 |
| `BRIDGE_ADMIN_TOKEN` | 空 | 管理接口令牌；设置后界面右上角需填写 |
| `BRIDGE_WEBHOOK_TOKEN` | 空 | Webhook Bearer 令牌；与途合连接里的 Token 一致 |
| `BRIDGE_ALLOW_LIVE` | `1` | 设为 `0` 可全局禁止真实请求，只允许预览 |

## 从浏览器抓一次真实请求

1. 在电脑浏览器登录目标平台网页版（确认账号里能正常添加收藏）。
2. 打开开发者工具 → **Network**，勾选 **Preserve log**。
3. 在页面上手动收藏一个地点。
4. 在 Network 中找到真正提交收藏的请求（通常是 `POST` / `PUT`，返回 JSON）。
5. 右键 → **Copy** → **Copy as cURL**，或分别复制：
   - Request URL
   - Request Headers（重点 `Cookie`、`Content-Type`、`Referer`、`Origin`、`User-Agent`）
   - Request Payload / Request Body
6. 把 URL、Headers、Body 填进桥接器的模板，把 `Cookie` 填进 Cookie 输入框。

Cookie 也可以从 **Application → Cookies** 里逐个复制，拼成 `name=value; name2=value2`。

## 各平台登录网址与 Cookie 向导

管理界面每个平台卡片都有 **Cookie 向导**：内置登录网址、抓包步骤、常见登录 Cookie 名称、Cookie 解析与保存。

| 平台 | 登录网址 | 常见登录 Cookie | 说明 |
|---|---|---|---|
| 高德地图 | <https://www.amap.com/> | `_AMap_*`、`AMap_*`、`csrf`、`cna`、`_umdata` | 网页版有「我的收藏」；Cookie 名称随版本变化，建议整段复制 |
| 百度地图 | <https://map.baidu.com/> | `BDUSS`、`BDUSS_BFESS`、`STOKEN`、`BAIDUID` | 最关键的是 `BDUSS` 与 `STOKEN` |
| 圆周旅迹 | <https://www.pitravel.cn/plan?lang=cn> | 微信/手机号登录态 | 有网页版和收藏夹，可尝试 Cookie；不同账号网页功能可能不同 |

> Cookie 名称只是常见值，平台改版后可能变化。Cookie 向导会解析你粘贴的所有键并提示是否检测到登录态键，最终以实际请求为准。

### 使用 Cookie 向导

1. 点平台卡片的 **Cookie 向导**。
2. 点「打开」进入官方登录网址并登录。
3. 按左侧步骤在 DevTools 中复制 Cookie。
4. 粘贴到右侧，点「解析 Cookie」；会显示键数量和登录态检测结果。
5. 点「保存 Cookie」；如果已经配置验活地址，可点「保存并验活」。
6. 点「配置请求模板」继续填写 URL / Headers / Body。

Cookie 输入框默认遮挡显示，点「显示 / 隐藏」切换；保存后页面不会回显明文。

## 模板占位符

请求 URL、请求头、请求体都支持 `{{...}}`：

| 占位符 | 示例值 |
|---|---|
| `{{place.id}}` | `pl_xxx` |
| `{{place.name}}` | `沙溪古镇` |
| `{{place.address}}` | `云南省大理州剑川县…` |
| `{{place.city}}` / `{{place.district}}` | `大理` / `剑川县` |
| `{{place.category}}` | `古镇` |
| `{{place.tags}}` | `安静,茶马古道` |
| `{{place.tagsJson}}` | `["安静","茶马古道"]`（原样 JSON） |
| `{{place.note}}` | `周五有集市` |
| `{{place.rating}}` | `4.8` |
| `{{place.location.lng}}` / `{{place.location.lat}}` | `99.8514` / `26.3158` |
| `{{place.locationJson}}` | `{"lng":99.8514,"lat":26.3158}` |
| `{{place.externalId}}` | 途合侧已有平台 ID（可能为空） |
| `{{platform}}` / `{{coordSystem}}` | `amap` / `GCJ02` |
| `{{payloadJson}}` | 完整 Webhook JSON |

示例请求体：

```json
{
  "name": "{{place.name}}",
  "address": "{{place.address}}",
  "lng": {{place.location.lng}},
  "lat": {{place.location.lat}},
  "tags": {{place.tagsJson}},
  "remark": "{{place.note}}"
}
```

如果平台的 Body 是 `application/x-www-form-urlencoded`，桥接器会自动对占位符做 URL 编码。

## 接入途合

1. 途合 → **平台连接** → 目标平台 → **配置**。
2. 模式选 **Webhook**。
3. Webhook 地址填：

   ```
   http://localhost:8790/webhook
   ```

4. 如果桥接器设置了 `BRIDGE_WEBHOOK_TOKEN`，在途合的 **Bearer Token** 填同一个值。
5. 保存后先点「测试连接」确认网络可达（桥接器会对任意 `place.upsert` 返回 2xx/4xx，测试连接只验证 HTTP 连通性）。
6. 在桥接器里配置好 Cookie + 模板，先保持**预览模式**，在途合同步 1 个地点。
7. 桥接器日志出现 `dry-run` 且预览正确后，关闭预览模式，再同步 1 个地点。
8. 确认平台端出现收藏后，再扩大同步范围。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/health` | 健康检查（公开） |
| `GET` | `/api/status` | 平台状态 + 最近日志 |
| `PUT` | `/api/platforms/:id` | 保存 Cookie / 模板 |
| `DELETE` | `/api/platforms/:id` | 删除配置 |
| `POST` | `/api/platforms/:id/test` | 预览模板；配置了验活地址则发送 GET 验活 |
| `DELETE` | `/api/logs` | 清空日志 |
| `POST` | `/webhook` | 途合 Webhook 入口 |

平台 ID：`amap` `baidu` `yuanzhou`。

## 行为说明

- **预览模式**：Webhook 返回 HTTP `409`，途合会显示失败原因「预览模式：请求未发送」，但桥接器日志会记录完整预览。
- **真实模式**：按平台串行发送，默认间隔 800ms；遇到 `429` / `5xx` 自动重试 2 次。
- **externalId**：从响应 JSON 的 `externalIdPath`（默认 `data.id`）读取；读不到时生成稳定 ID `bridge_<platform>_<hash>`，便于途合记录。
- **Cookie 过期**：平台通常返回 401/403 或登录页 HTML，桥接器会记录失败；重新登录网页版并更新 Cookie 即可。
- **日志**：最近 300 条，落盘在 `data/bridge.json`；日志不记录 Cookie，但会记录 URL 和响应片段（可能含平台返回的敏感信息，注意备份安全）。

## 常见问题

| 现象 | 处理 |
|---|---|
| Webhook 返回 401 | 途合 Token 与 `BRIDGE_WEBHOOK_TOKEN` 不一致 |
| 管理界面 401 | 右上角填写 `BRIDGE_ADMIN_TOKEN` |
| 返回 409 | 仍是预览模式；关闭「启用真实请求」开关 |
| 返回 400 未配置 | 先保存 Cookie 和请求模板 |
| 平台返回 403/登录页 | Cookie 过期或缺少 `Referer` / `User-Agent`，重新抓包 |
| 平台返回 429 | 调大请求间隔，降低批量规模 |
| 平台返回 200 但收藏没出现 | Body 字段名/格式不对，用 DevTools 对照真实请求逐字段核对 |

## 安全建议

1. 只在局域网运行，不要把 8790 暴露到公网。
2. 设置 `BRIDGE_ADMIN_TOKEN` 与 `BRIDGE_WEBHOOK_TOKEN`。
3. 定期轮换 Cookie；退出平台网页版后旧 Cookie 会失效。
4. 不要把 `data/secret` 和 `data/bridge.json` 提交到 Git 或发给他人。
5. 先预览、再单点、最后批量；避免高频请求。
