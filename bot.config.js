// 直接从.env文件读取环境变量，解决换行问题
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

let bilibiliSessData = '';
try {
    // 使用绝对路径读取.env文件
    const envPath = path.resolve(__dirname, '.env');
    const envFile = fs.readFileSync(envPath, 'utf8');
    const envVars = dotenv.parse(envFile);
    
    // 获取SESSDATA
    bilibiliSessData = envVars.DMQ_BILIBILI_SESSDATA || '';
    console.log(`bot.config: 从.env文件直接解析SESSDATA, 长度: ${bilibiliSessData.length}, 前缀: ${bilibiliSessData.substring(0, 10)}...`);
    
    // 解码URL编码字符
    if (bilibiliSessData.includes('%')) {
        const decodedSessData = decodeURIComponent(bilibiliSessData);
        console.log(`bot.config: 解码后SESSDATA长度: ${decodedSessData.length}`);
        bilibiliSessData = decodedSessData;
    }
} catch (e) {
    console.error('bot.config: 读取或解码SESSDATA失败:', e.message);
    // 尝试使用环境变量
    bilibiliSessData = process.env.DMQ_BILIBILI_SESSDATA || '';
    console.log(`bot.config: 回退使用环境变量SESSDATA, 长度: ${bilibiliSessData.length}`);
}

module.exports = {
    dataDir: './data',
    dataSaveInterval: 10000,
    logsDir: './data/logs/bot',
    botToken: process.env.DMQ_BOT_TOKEN || '',
    botProxy: process.env.DMQ_BOT_PROXY || null,
    botAdmins: (process.env.DMQ_BOT_ADMINS || '').split(',').map(Number).filter(Boolean),
    // B站登录Cookie中的SESSDATA值，用于获取弹幕用户名等信息
    bilibiliSessData: bilibiliSessData,
    debugMode: false,
    rateLimit: {
        enabled: false,
        redisServer: '127.0.0.1:6379',
        selectDB: 1
    },
    statistics: {
        enabled: false,
        redisServer: '127.0.0.1:6379',
        selectDB: 1
    },
    danmakuSources: [
        {
            id: 'bilibili',
            description: '哔哩哔哩直播弹幕',
            type: 'common-danmaku-ws',
            value: {
                url: 'localhost:8001',
                basicAuth: 'testPassword'
            }
        },
        {
            id: 'douyu',
            description: '斗鱼直播弹幕',
            type: 'common-danmaku-ws',
            value: 'localhost:8002'
        },
        {
            id: 'local',
            description: '本地测试弹幕服务器',
            type: 'common-danmaku-ws',
            value: 'localhost:8003',
            enabled: false
        }
    ]
};
