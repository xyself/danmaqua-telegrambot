// 加载环境变量
require('dotenv').config();

const botConfig = require('../bot.config');
const settings = require('./util/settings');
const RateLimiter = require('./util/rate-limiter');
const { ChatsScheduler } = require('./util/schedulers');
const { DanmakuStatistics } = require('./util/statistics');

const HttpsProxyAgent = require('https-proxy-agent');
const { DanmakuSourceManager } = require('./api');
const log4js = require('log4js');
const path = require('path');

const DanmaquaBot = require('./bot-core');

class Application {
    constructor(botConfig) {
        // 配置log4js
        log4js.configure({
            appenders: {
                stdout: { type: 'stdout' },
                outfile: {
                    type: 'dateFile',
                    filename: path.join(botConfig.logsDir, 'access-log'),
                    pattern: 'yyyy-MM-dd.log',
                    alwaysIncludePattern: true,
                    keepFileExt: false
                }
            },
            categories: {
                default: {
                    appenders: ['stdout', 'outfile'],
                    level: 'debug'
                },
                access: {
                    appenders: ['outfile'],
                    level: 'debug'
                }
            }
        });
        
        this.logger = {
            default: log4js.getLogger('default'),
            access: log4js.getLogger('access')
        };
        
        // 环境变量检查
        this.checkEnvironmentVariables(botConfig);
        
        // 初始化 Bot 数据库
        settings.init(botConfig, true);
        // 初始化弹幕源连接管理器
        this.dmSrc = new DanmakuSourceManager(this.logger);
        // 设定代理
        this.agent = null;
        if (botConfig.botProxy) {
            this.agent = new HttpsProxyAgent(botConfig.botProxy);
            this.logger.default.info('Launcher: Bot is using proxy ', botConfig.botProxy);
        }
        // 初始化 Bot 核心
        this.bot = new DanmaquaBot({
            botConfig: botConfig,
            dmSrc: this.dmSrc,
            botToken: botConfig.botToken,
            agent: this.agent,
            logger: this.logger,
            debugMode: botConfig.debugMode || false,
            // 初始化计划任务管理器
            chatsScheduler: new ChatsScheduler({
                bot: this.bot,
                settings: settings,
                logger: this.logger,
            }),
            // 初始化统计器
            statistics: botConfig.statistics.enabled ? new DanmakuStatistics(botConfig, this.logger) : null,
            // 初始化限流器
            rateLimiter: botConfig.rateLimit.enabled ? new RateLimiter(botConfig, this.logger) : null,
        });
        // 设置弹幕源事件回调
        this.dmSrc.on('danmaku', (danmaku) => {
            try {
                if (botConfig.debugMode) {
                    this.logger.default.debug('onReceiveDanmaku: ', danmaku);
                }
                this.onReceiveDanmaku(danmaku);
            } catch (e) {
                this.logger.default.error(e);
            }
        });
        this.dmSrc.on('connect', (source) => {
            try {
                this.onConnectDMSource(source);
            } catch (e) {
                this.logger.default.error(e);
            }
        });
    }

    onReceiveDanmaku(danmaku) {
        if (!this.bot.botUser) {
            return;
        }
        
        // 验证弹幕数据的完整性和有效性
        if (!danmaku || !danmaku.sender || !danmaku.sourceId || !danmaku.text) {
            this.logger.default.warn('收到无效弹幕数据:', danmaku);
            return;
        }
        
        // 修正无效的用户ID（如果uid为0或undefined）
        if (!danmaku.sender.uid || danmaku.sender.uid === 0) {
            // 使用用户名哈希作为临时ID
            const tempId = this.hashString(danmaku.sender.username || '匿名用户');
            this.logger.default.debug(`修正无效用户ID: 0 -> ${tempId}, 用户名: ${danmaku.sender.username}`);
            danmaku.sender.uid = tempId;
        }
        
        for (let chatId of Object.keys(settings.chatsConfig)) {
            let chatConfig = settings.chatsConfig[chatId];
            if (chatConfig.roomId) {
                chatConfig = settings.getChatConfig(chatId);
                if (chatConfig.blockedUsers &&
                    chatConfig.blockedUsers.indexOf(danmaku.sourceId + '_' + danmaku.sender.uid) >= 0) {
                    return;
                }
                if (danmaku.sourceId === chatConfig.danmakuSource && danmaku.roomId === chatConfig.roomId) {
                    const reg = new RegExp(chatConfig.pattern);
                    if (reg.test(danmaku.text)) {
                        const opts = { hideUsername: chatConfig.hideUsername };
                        this.bot.notifyDanmaku(chatId, danmaku, opts).catch((e) => {
                            this.logger.access.error(`Failed to notify ${chatId}: `, e);
                        });
                    }
                }
            }
        }
    }
    
    // 简单的字符串哈希函数，用于为匿名用户生成唯一标识符
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return Math.abs(hash);
    }

    onConnectDMSource(source) {
        for (let chatId of Object.keys(settings.chatsConfig)) {
            let chatConfig = settings.chatsConfig[chatId];
            if (chatConfig.roomId) {
                chatConfig = settings.getChatConfig(chatId);
                if (source.id === chatConfig.danmakuSource) {
                    this.dmSrc.joinRoom(chatConfig.danmakuSource, chatConfig.roomId);
                }
            }
        }
    }

    startBot() {
        this.bot.start().then(() => {
            this.logger.default.info('Launcher: Bot is launched. Username: @' + this.bot.botUser.username);
        }).catch((err) => {
            this.logger.default.error(err);
        });
    }

    // 检查关键环境变量
    checkEnvironmentVariables(botConfig) {
        // 检查B站SESSDATA
        if (!botConfig.bilibiliSessData || botConfig.bilibiliSessData.length === 0) {
            this.logger.default.warn('警告: B站SESSDATA未设置，用户信息将不完整。请设置环境变量DMQ_BILIBILI_SESSDATA');
        } else {
            this.logger.default.info('B站SESSDATA已设置');
        }
        
        // 检查Bot Token
        if (!botConfig.botToken || botConfig.botToken.length === 0) {
            this.logger.default.error('错误: Bot Token未设置，请设置环境变量DMQ_BOT_TOKEN');
        }
        
        // 检查Bot管理员
        if (!botConfig.botAdmins || botConfig.botAdmins.length === 0) {
            this.logger.default.warn('警告: Bot管理员未设置，请设置环境变量DMQ_BOT_ADMINS');
        }
    }
}

// 创建并启动应用
new Application(botConfig).startBot();
