const botConfig = require('../bot.config');
const settings = require('./util/settings');
const RateLimiter = require('./util/rate-limiter');
const { ChatsScheduler } = require('./util/schedulers');
const { DanmakuStatistics } = require('./util/statistics');

const HttpsProxyAgent = require('https-proxy-agent');
const { DanmakuSourceManager } = require('./api');
const log4js = require('log4js');
const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

const DanmaquaBot = require('./bot-core');

class Application {
    constructor(botConfig) {
        // 初始化日志
        const transport = new winston.transports.DailyRotateFile({
            filename: path.join(botConfig.logsDir, 'access-log-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            zippedArchive: false,
            maxSize: '20m',
            maxFiles: '14d'
        });

        transport.on('error', (error) => {
            console.error('Winston日志错误:', error);
        });

        const logger = winston.createLogger({
            level: 'debug',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
            ),
            transports: [
                new winston.transports.Console(),
                transport
            ]
        });

        // 配置log4js使用winston
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
            access: log4js.getLogger('access'),
            winston: logger
        };
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
}

if (!botConfig.botToken || botConfig.botToken.length === 0) {
    if (process.env.DMQ_BOT_TOKEN) {
        botConfig.botToken = process.env.DMQ_BOT_TOKEN;
    }
}
if (!botConfig.botProxy) {
    if (process.env.DMQ_BOT_PROXY) {
        botConfig.botProxy = process.env.DMQ_BOT_PROXY;
    }
}
if (!botConfig.botAdmins || botConfig.botAdmins.length === 0) {
    if (process.env.DMQ_BOT_ADMINS) {
        botConfig.botAdmins = process.env.DMQ_BOT_ADMINS.split(',').map(Number);
    }
}
new Application(botConfig).startBot();
