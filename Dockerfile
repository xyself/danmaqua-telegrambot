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

# Start services (using sh -c to chain commands)
# 使用 PM2 的 Docker 专用模式
CMD ["pm2-runtime", "start", "/usr/src/dmq-bot/ecosystem.config.js"]
