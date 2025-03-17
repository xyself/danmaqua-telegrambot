Danmaqua Telegram Bot
======

将哔哩哔哩直播间的同传弹幕转发至 Telegram 聊天、频道以便阅读/存档。

**版本 2.x 已经做了大量的改动，请仔细阅读配置文档，如有疑问也可直接联系作者咨询。**

## 已实现的功能

- [x] 通过弹幕源 API 从多个直播平台中获取弹幕数据
  - [x] 支持 Bilibili 弹幕源（依赖 [simon300000/bilibili-live-ws](https://github.com/simon300000/bilibili-live-ws) ）
  - [x] 支持 Douyu 弹幕源（依赖 [flxxyz/douyudm](https://github.com/flxxyz/douyudm) ）
- [x] 将同传弹幕转发到 Telegram 对话/频道
- [x] 每个对话（含频道）配置独立分开，并允许每个对话单独设置管理员
- [x] 使用正则表达式过滤并区分说话人和内容
- [x] 提供黑名单功能屏蔽指定用户的弹幕
- [x] 提供计划任务功能定期切换弹幕房间、定期发送消息到对话
- [x] 访问日志记录
- [x] 通过 HTTP 代理连接 Telegram Bot API
- [x] 提供 Docker 封装镜像
- [x] 支持内联查询功能，方便管理员快速查询和管理频道

## 如何使用

### 直接订阅已有的同传弹幕记录频道

订阅 Telegram 频道 [@danmaqua](https://t.me/danmaqua) 获取最新同传弹幕记录频道。

同传弹幕频道列表网页版（更新不如 Telegram 及时，但便于阅读）：<https://danmaqua.github.io/bot/userpage.html>

如果你有自己搭建的弹幕记录频道，也欢迎提交到这里。

### 如何运行自己的机器人实例

请认真阅读 [Bot 快速搭建教程](https://danmaqua.github.io/bot/dev.html) 文档，其中包括了全新配置，以及从 Bot v1 版本迁移到 v2 版本的具体教程。

### 环境变量配置

本项目支持通过环境变量进行配置，这对于Docker部署和安全管理敏感信息非常有用。

主要支持的环境变量：

- `DMQ_BOT_TOKEN`：Telegram Bot Token
- `DMQ_BOT_ADMINS`：Bot管理员ID列表，用逗号分隔，例如：`123456789,987654321`
- `DMQ_BILIBILI_SESSDATA`：B站登录Cookie中的SESSDATA值，用于获取弹幕用户名等信息
- `DMQ_BOT_PROXY`：(可选) HTTP代理服务器地址，例如：`http://127.0.0.1:1080`

**本地开发配置**

1. 复制`.env.example`文件为`.env`
```bash
cp .env.example .env
```

2. 编辑`.env`文件，填入你的配置信息
```
DMQ_BOT_TOKEN=your_bot_token_here
DMQ_BOT_ADMINS=123456789,987654321
DMQ_BILIBILI_SESSDATA=your_bilibili_sessdata_here
```

**Docker部署配置**

在使用Docker部署时，可以通过环境变量传入配置：

```bash
docker run -d \
  -e DMQ_BOT_TOKEN=your_bot_token_here \
  -e DMQ_BOT_ADMINS=123456789,987654321 \
  -e DMQ_BILIBILI_SESSDATA=your_bilibili_sessdata_here \
  -v $(pwd)/data:/usr/src/dmq-bot/data \
  yourusername/danmaqua-telegrambot
```

或在docker-compose.yml中配置：

```yaml
version: '3'
services:
  danmaqua-bot:
    image: yourusername/danmaqua-telegrambot
    environment:
      - DMQ_BOT_TOKEN=your_bot_token_here
      - DMQ_BOT_ADMINS=123456789,987654321
      - DMQ_BILIBILI_SESSDATA=your_bilibili_sessdata_here
    volumes:
      - ./data:/usr/src/dmq-bot/data
    restart: always
```

### 内联查询功能

Bot支持内联查询功能，方便管理员快速查询和管理频道。在任何聊天中输入`@你的bot用户名`后，就可以使用内联查询：

- 直接输入：显示所有可管理的频道
- 搜索关键词：根据频道名称、房间ID或弹幕源筛选频道
- 选择频道后，可以快速执行常见操作如管理配置、重连房间等

只有在bot.config.js中设置的管理员才能使用此功能。

## Contact author

Telegram: [@fython](https://t.me/fython)

## Licenses

GPLv3

## 自动构建Docker镜像

本项目配置了GitHub Actions自动构建功能，可以自动构建Docker镜像并推送到DockerHub。要启用此功能，请在GitHub仓库设置中添加以下密钥：

1. `DOCKERHUB_USERNAME`：你的DockerHub用户名
2. `DOCKERHUB_TOKEN`：你的DockerHub访问令牌（在DockerHub的账户设置中生成）

配置完成后，每次推送到master分支或创建标签（格式为v*）时，都会自动构建并推送镜像。
