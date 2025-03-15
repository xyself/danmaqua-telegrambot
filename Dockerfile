FROM node:23-alpine

# Prepare working directory
WORKDIR /usr/src/dmq-bot
# Install dependencies
COPY package.json package-lock.json ./
RUN npm install
RUN npm install -g pm2@latest

# Copy programs
COPY . /usr/src/dmq-bot

# Start services (using exec form for CMD)
CMD ["sh", "-c", "pm2 start /usr/src/dmq-bot/ecosystem.config.js && pm2 logs danmaqua-bot dmsrc-bilibili dmsrc-douyu"]
