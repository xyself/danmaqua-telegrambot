FROM node:23-alpine

# Create working directory
RUN mkdir -p /usr/src/dmq-bot

# Set working directory
WORKDIR /usr/src/dmq-bot

# Install dependencies
COPY package.json package-lock.json /usr/src/dmq-bot/
RUN npm install
RUN npm install -g pm2@latest

# Copy application files
COPY . /usr/src/dmq-bot

# 环境变量说明:
# DMQ_BOT_TOKEN: Telegram Bot Token
# DMQ_BOT_PROXY: 代理服务器 (可选)
# DMQ_BOT_ADMINS: Bot管理员ID, 用逗号分隔
# DMQ_BILIBILI_SESSDATA: B站SESSDATA Cookie值, 用于获取弹幕用户信息

# Start services (using sh -c to chain commands)
# 使用 PM2 的 Docker 专用模式
CMD ["pm2-runtime", "start", "/usr/src/dmq-bot/ecosystem.config.js"]
