// 直接从.env文件读取环境变量，解决换行问题
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

let sessData = '';
try {
    // 使用绝对路径读取.env文件
    const envPath = path.resolve(__dirname, '.env');
    const envFile = fs.readFileSync(envPath, 'utf8');
    const envVars = dotenv.parse(envFile);
    
    // 获取SESSDATA
    sessData = envVars.DMQ_BILIBILI_SESSDATA || '';
    console.log(`dmsrc.config: 从.env文件直接解析SESSDATA, 长度: ${sessData.length}, 前缀: ${sessData.substring(0, 10)}...`);
    
    // 解码URL编码字符
    if (sessData.includes('%')) {
        const decodedSessData = decodeURIComponent(sessData);
        console.log(`dmsrc.config: 解码后SESSDATA长度: ${decodedSessData.length}`);
        sessData = decodedSessData;
    }
} catch (e) {
    console.error('dmsrc.config: 读取或解码SESSDATA失败:', e.message);
    // 尝试使用环境变量
    sessData = process.env.DMQ_BILIBILI_SESSDATA || '';
    console.log(`dmsrc.config: 回退使用环境变量SESSDATA, 长度: ${sessData.length}`);
}

module.exports = {
    bilibili: {
        /**
         * Bilibili 弹幕源 WebSocket 端口
         */
        port: 8001,
        /**
         * 弹幕源 WebSocket 的 HTTP Basic Auth 认证，留空（null 或 undefined）可以关闭认证
         */
        basicAuth: 'testPassword',
        /**
         * Bilibili 弹幕连接协议，ws 代表使用 WebSocket 协议，tcp 代表使用 TCP 协议。
         * 协议实现在 https://github.com/simon300000/bilibili-live-ws/blob/master/src/index.ts
         */
        bilibiliProtocol: 'ws',
        /**
         * Bilibili 弹幕房间自动重连计划，使用 CRON 格式
         * 避免长时间弹幕连接没有正确返回数据
         * 留空（null）可以关闭自动重连
         */
        reconnectCron: '0 0 3 * * *',
        /**
         * Bilibili 登录SESSDATA，用于获取完整的用户信息
         * 从环境变量DMQ_BILIBILI_SESSDATA读取
         */
        sessData: sessData,
        logsDir: './data/logs/bilibili-dm'
    },
    douyu: {
        /**
         * Douyu 弹幕源 WebSocket 端口
         */
        port: 8002,
        /**
         * 弹幕源 WebSocket 的 HTTP Basic Auth 认证，留空（null 或 undefined）可以关闭认证
         */
        basicAuth: null,
        /**
         * Douyu 弹幕房间自动重连计划，使用 CRON 格式
         * 避免长时间弹幕连接没有正确返回数据
         * 留空（null）可以关闭自动重连
         */
        reconnectCron: '0 0 3 * * *',
        logsDir: './data/logs/douyu-dm'
    },
    local: {
        port: 8003,
        basicAuth: null,
        logsDir: './data/logs/local-dm'
    }
};
