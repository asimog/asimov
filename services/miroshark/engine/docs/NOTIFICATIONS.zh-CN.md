<sup>[English](NOTIFICATIONS.md) · 中文</sup>

# 频道通知

MiroShark 会在模拟达到终止状态(`simulation.completed` 或 `simulation.failed`)的那一刻触发一条通知。五条独立的频道并行运行 — 每条都通过自己的环境变量(或环境变量对)按需启用:

| 频道     | 环境变量                                       | 格式                  | 适用场景                                                      |
| -------- | --------------------------------------------- | -------------------- | ------------------------------------------------------------- |
| Webhook  | `WEBHOOK_URL`                                 | 原始 JSON `POST`      | Zapier / Make / n8n / IFTTT / 自定义监听器                    |
| Discord  | `DISCORD_WEBHOOK_URL`                         | Discord 富嵌入        | Discord 频道 — 带信念百分比字段的着色卡片                     |
| Slack    | `SLACK_WEBHOOK_URL`                           | Slack Block Kit       | Slack 频道 — 标题 + 块字符条字段 + 操作按钮                   |
| Email    | `SMTP_HOST` + `SMTP_TO`                       | `multipart/alternative` | 任意邮箱或邮件列表 — 无需任何平台账户                       |
| Telegram | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`     | Bot API `sendMessage`(HTML) | Telegram 聊天、群组或频道 — 带信念条 + 内联按钮的 bot 卡片 |

各频道彼此独立。设置一个、几个或全部五个 — 每个都独立触发。未设置的环境变量会被静默跳过,因此只使用通用 webhook 的现有部署不受本功能影响。

SPA 在 `GET /api/config/notifications` 暴露一个公开探针,返回 `{webhook_configured, discord_configured, slack_configured, email_configured, telegram_configured}`,这样运维者无需打开后端配置即可确认频道状态。

## 通用 webhook(已有,PR #46)

已在 [WEBHOOKS.zh-CN.md](./WEBHOOKS.zh-CN.md) 中记录。POST 一份与 [`backend/app/services/webhook_service.py`](../backend/app/services/webhook_service.py) 中载荷形状一致的 JSON blob。

## Discord 富嵌入

把 `DISCORD_WEBHOOK_URL` 设为一个 Discord incoming webhook URL:

```bash
# Discord → Server Settings → Integrations → Webhooks → New Webhook
# 复制 webhook URL("https://discord.com/api/webhooks/000/xxx")。
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/000/xxx
```

每次终止状态转换时,MiroShark 会 POST 一份 embed:

* **Title** — 情景,截断到 100 字符。
* **Description** — 一行状态动词("Simulation reached its terminal round." 或 "Simulation ended in a failure state.")。
* **Color** — 绿 / 灰 / 红 / 琥珀色,取决于主导的共识立场(失败运行始终为琥珀色)。
* **Fields** — Bullish %、Neutral %、Bearish %、Quality、Rounds、Agents、Resolution(已设置时)。
* **Thumbnail** — 分享卡 PNG(仅在设置了 `PUBLIC_BASE_URL` 时,这样 embed 才能渲染绝对 URL)。
* **URL** — 分享页链接(`/share/<sim_id>`),设置了 `PUBLIC_BASE_URL` 时为绝对地址。
* **Footer / timestamp** — "MiroShark" + 派发时间戳。

失败运行会附加一个额外的 `Error` 字段,内含截断后的退出码消息。

Discord 在派发进程内按 `(sim_id, status)` 对去重 — 模拟 runner 的两条终止代码路径(退出码监视器 + 动作日志中的 `simulation_end` 事件)都会调入通知器,但 Discord 每个终止状态只会看到一张卡片。

该端点是 fire-and-forget:慢速的 Discord 端点绝不会拖慢模拟 runner,4xx 只会记录一条警告而不抛异常。

## Slack Block Kit

把 `SLACK_WEBHOOK_URL` 设为一个 Slack Incoming Webhook URL:

```bash
# api.slack.com/apps → your app → Incoming Webhooks → Add New Webhook to Workspace
# 复制 webhook URL("https://hooks.slack.com/services/T0/B0/abc")。
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T0/B0/abc
```

每次终止状态转换时,MiroShark 会 POST 一条带四个块的 Block Kit 消息:

* **Header** — 情景,截断到 120 字符。
* **Context** — 加粗的状态动词 + 等宽字体的 sim id。
* **Section** — `mrkdwn` 字段:
  * Bullish / Neutral / Bearish,带 Unicode 块字符条(`█████░░░░░ 52.0%`)。
  * Quality 健康分。
  * Scale(`N agents · N rounds`)。
  * Resolution(已设置时)。
* **Actions** — 一颗指向 `/share/<sim_id>` 的 "View simulation" 按钮。仅在设置了 `PUBLIC_BASE_URL` 时发出(Slack 会拒绝 URL 非绝对地址的按钮)。

失败运行会附加一个 `Error` section,内含一个围栏代码块,里面是截断后的退出码消息。

去重姿态和 fire-and-forget 保证与 Discord 相同。

## SMTP 完成邮件

唯一一个不需要任何平台账户、不需要 OAuth 流程、也不需要 incoming-webhook URL 的通知频道。设置 `SMTP_HOST` 加上一个逗号分隔的 `SMTP_TO` 收件人列表,MiroShark 就会在每次终止状态转换时向每位收件人发送一封 `multipart/alternative` 邮件(纯文本 + HTML):

```bash
# 最小配置 — 无认证中继(自建 Postfix、LAN MX)
SMTP_HOST=relay.internal
SMTP_PORT=25
SMTP_TO=research@example.com

# 认证配置(Gmail / SendGrid / Mailgun / 任意托管中继)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=miroshark-bot@example.com
SMTP_PASSWORD=<gmail-app-password>     # NOT your regular password
SMTP_FROM=alerts@miroshark.app         # optional — defaults to miroshark-notify@<host>
SMTP_TO=research@example.com,ops@example.com
```

正文结构(两个部分):

* **Subject** — `[MiroShark] <Direction>: <Scenario>`,其中 `<Direction>` 是 `Bullish` / `Neutral` / `Bearish` / `Failed` 之一。邮箱过滤规则只看这一项就能分流 — 无需解析正文。
* **纯文本部分** — 情景标题,然后是键/值对:`Status`、`Bullish` / `Neutral` / `Bearish`(每项都带与 Slack 相同的 Unicode 块字符条 — `█████░░░░░ 52.0%`)、`Quality`、`Scale`、`Outcome`,以及一个绝对的 `View:` URL。在 mutt / Apple Mail / Outlook 列表视图预览中阅读清晰。
* **HTML 部分** — 同样的字段放在单个 `<table>` 里(这是 Outlook / Gmail / Apple Mail 唯一能一致渲染的布局),配有与 Discord embed 边框相同的内联 CSS 色块、一条按共识着色的顶部边框,以及一颗 "View simulation →" 按钮 CTA(仅在设置了 `PUBLIC_BASE_URL` 时出现,以保证 URL 为绝对地址)。
* **Headers** — `X-MiroShark-Sim-Id: <sim_id>` 和 `X-MiroShark-Event: simulation.{completed,failed}`,这样服务端过滤器(Sieve / Gmail filter / Outlook rule)无需扫描主题即可路由。

失败运行会把截断后的退出码消息附加为一个 `Error` section(HTML:琥珀色边框代码块;纯文本:`Error:` 块)。

### 传输方式选择

调度器按端口挑选 SMTP 类:

| 端口 | 传输方式      | 何时使用                                                          |
| ---- | ------------- | ----------------------------------------------------------------- |
| 465  | `SMTP_SSL`    | 隐式 TLS(传统 SMTPS)。                                          |
| 587  | `SMTP` + STARTTLS | Submission 端口 — 现代默认值;Gmail / SendGrid 所期待的方式。 |
| 25   | `SMTP`(明文)   | 内部 LAN 中继 — 设置 `SMTP_USE_TLS=false`。                     |

如果在 587 端口上 STARTTLS 失败*且*配置了凭据,调度器会拒绝发送,而不是以明文泄漏凭据。在无认证运行(没有 `SMTP_USER`/`SMTP_PASSWORD`)时,失败的 STARTTLS 会回退到明文,这样一个不支持 TLS 的 LAN 中继仍然能收到消息。

### Gmail 配方

1. 在发件 Google 账户上启用两步验证。
2. Account → Security → App Passwords → 为 "Mail" 生成一个。
3. `SMTP_USER=<gmail-address>`、`SMTP_PASSWORD=<16-char-app-password>`、`SMTP_HOST=smtp.gmail.com`、`SMTP_PORT=587`。
4. 把 `SMTP_FROM` 设为与 `SMTP_USER` 相同的地址,这样 "From" 头部能通过 Gmail 的出站发件人检查。

### 测试片段

```python
# 在不触碰 MiroShark 的情况下验证某个中继可达
import smtplib, ssl
with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as conn:
    conn.starttls(context=ssl.create_default_context())
    conn.login("you@gmail.com", "<app-password>")
    print("OK")
```

去重姿态与 Discord / Slack 通知器完全一致 — runner 的两条终止代码路径都会触发,但每进程的 `(sim_id, status)` 集合确保邮箱每个终止状态恰好看到一条消息。

## Telegram Bot

把 `TELEGRAM_BOT_TOKEN` 设为一个 Bot API token,把 `TELEGRAM_CHAT_ID` 设为 bot 应当发布到的聊天 / 群组 / 频道:

```bash
# 1. 在 Telegram 上,与 @BotFather 对话,发送 /newbot,按提示操作。
#    复制 "123456789:AAEh…" token。
TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN_HERE

# 2. 在目标聊天、群组或频道中至少给 bot 发一条消息,然后从以下地址
#    读取 chat id:
#      https://api.telegram.org/bot<TOKEN>/getUpdates
#    私聊的 id 为正数(你的 user id);群组 / 超级群组为负数("-100…");
#    对于 bot 担任管理员的公开频道,也可以使用 "@channelname"。
TELEGRAM_CHAT_ID=-100123456789
```

每次终止状态转换时,MiroShark 会以 `parse_mode=HTML` 和 `disable_web_page_preview=true` 调用 Bot API `sendMessage`:

* **Header** — 加粗的情景,截断到 200 字符。
* **Status line** — 斜体的状态动词 + 等宽字体的 sim id。
* **信念条** — `Bullish` / `Neutral` / `Bearish` 行,带与 Slack 相同的 Unicode 块字符条(`█████░░░░░ 52.0%`),仅在有可用轨迹时出现。
* **键/值块** — `Quality`、`Scale`(`N agents · N rounds`)、`Outcome`(已设置时)。
* **方向标签** — 显式的 `Bullish` / `Bearish` / `Failed` 标签,这样即使在仅显示一行后就截断的 Android 锁屏上,通知预览的第一行也信息明确。
* **内联键盘按钮** — 一颗指向 `/share/<sim_id>` 的 "View simulation" 按钮。仅在设置了 `PUBLIC_BASE_URL` 时发出(Telegram 会拒绝 `url` 非绝对地址的按钮)。

失败运行会在围栏 `<pre>` 中附加一个 `Error` 块,这样多行堆栈跟踪在每个 Telegram 客户端上都能干净渲染。

每个文本片段在拼接前都会经过 `html.escape()` 做 HTML 转义 — 只要有任何 HTML 标签解析失败,Telegram 就会以 HTTP 400 拒绝整条消息,因此一个含有游离 `<` 的情景(例如 `"Will TVL <$1B by EOY?"`)不会悄无声息地干掉这条通知。

去重姿态和 fire-and-forget 保证与其他频道相同 — runner 的两条终止代码路径都会触发,但每进程的 `(sim_id, status)` 集合确保聊天每个终止状态恰好看到一条消息。

### 测试片段

```bash
# 在不触碰 MiroShark 的情况下验证 bot token + chat id 是否可用
TOKEN="123456789:AAEh…"
CHAT="-100123456789"
curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": \"${CHAT}\", \"text\": \"OK\"}"
# {"ok":true,"result":{…}}
```

## 挑选正确的频道

* **Discord** — 面向社区。当受众想*可视化地*获取结果时使用:信念百分比、分享卡缩略图、点进模拟的入口。最适合分发频道("这是刚刚为你模拟出来的结果")。
* **Slack** — 面向运维。当受众想*运维地*获取结果时使用:快速读出条形图、一颗显式的操作按钮、等宽字体的 sim id。最适合工程 / 研究频道。
* **Email** — 通用。当受众不常驻于某个聊天工具时(研究团队、对冲基金中后台、分析师),或当运维者想要一份不依赖第三方 SaaS 留存策略、可永久检索的记录时使用。唯一一个无需任何人注册任何新东西就能用的频道。
* **Telegram** — 原生于即时通讯。当受众已经常驻于 Telegram 时使用 — MiroShark 大量加密发布 / 政治辩论 / 突发新闻受众正是如此。对于不使用 Slack 的研究团队,这是把推送通知送到手机上最快的路径。
* **通用 webhook** — 面向自动化。当结果需要落到某个会自行解包 JSON 的工作流工具(Zapier / Make / n8n)中时使用。

## 沙箱说明

纯标准库(webhook / Discord / Slack / Telegram 频道用 `urllib.request` + `json` + `os` + `html` + `hmac`;邮件用 `smtplib` + `email.mime` + `ssl`)。无新增依赖。通用 webhook 上的 HMAC 签名方案(`X-MiroShark-Signature`,PR #79)仅适用于该频道 — Discord、Slack、Email 和 Telegram 使用各平台自有的认证(Discord / Slack 用 URL 即密钥;邮件用 SMTP auth + STARTTLS;Telegram 用 URL 中的 bot-token),并忽略签名头部。
