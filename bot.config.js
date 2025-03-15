module.exports = {
    dataDir: './data',
    dataSaveInterval: 10000,
    logsDir: './data/logs/bot',
    botToken: '8047729291:AAEfx1slTGySIwuavsjh17alcC1dIDSqIYU',
    botProxy: null,
    botAdmins: [6401723199],
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
    // B站登录Cookie中的SESSDATA值，用于获取弹幕用户名等信息
    bilibiliSessData: '865aac96%2C1747619052%2Ce22fc%2Ab2CjAFDElzsuJocThl5hAE5d6d19kp9UpM9QfwbkM9KQUCWAoYsoUQcOpIBPstCJ3z8QYSVl9lUjhsUklaZTJrZG1jRWFSTXBmTWwyMmdBci1LS1lYUWNYcG5jNFZkSlB3UVROVkpXZjFmN1hudjIydUhIQnlQVDRQTjlVN2dWS2NkVFltdU4yeTJRIIEC',
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
