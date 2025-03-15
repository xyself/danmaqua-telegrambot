FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制package.json和package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm ci

# 复制源代码
COPY . .

# 第二阶段：运行环境
FROM node:20-alpine

# 安装PM2全局工具
RUN npm install -g pm2@latest

# 设置工作目录
WORKDIR /app

# 从builder阶段复制node_modules和其他文件
COPY --from=builder /app /app

# 创建数据目录
RUN mkdir -p /app/data/logs/bot /app/data/logs/bilibili-dm /app/data/logs/douyu-dm

# 暴露WebSocket端口
EXPOSE 8001 8002 8003

# 使用非root用户运行
RUN addgroup -g 1000 danmaqua && \
    adduser -u 1000 -G danmaqua -s /bin/sh -D danmaqua && \
    chown -R danmaqua:danmaqua /app
USER danmaqua

# 启动服务
CMD ["pm2-runtime", "ecosystem.config.js"]

