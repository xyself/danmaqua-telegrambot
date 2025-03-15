const AsyncRateLimiter = require('async-ratelimiter');
const { Redis } = require('ioredis');
const { Telegraf, Markup, session, Scenes } = require('telegraf');

class RateLimiter {
    constructor(botConfig, logger) {
        this.enabled = botConfig.rateLimit.enabled;
        this.logger = logger;
        this.client = null;
        
        // 如果限流功能未启用，则不初始化 Redis 客户端
        if (!this.enabled) {
            logger.default.info('RateLimiter: RateLimiter is disabled.');
            return;
        }
        
        try {
            let redisServer = botConfig.rateLimit.redisServer;
            if (!redisServer.startsWith('redis://') && !redisServer.startsWith('rediss://')) {
                redisServer = 'redis://' + redisServer;
            }
            
            // 解析 Redis 服务器地址
            let redisUrl = new URL(redisServer);
            let redisHost = redisUrl.hostname || 'localhost';
            let redisPort = redisUrl.port || 6379;
            
            // 配置 Redis 客户端
            this.client = new Redis({
                host: redisHost,
                port: redisPort,
                maxRetriesPerRequest: 3,  // 减少重试次数
                retryStrategy: function(times) {
                    if (times > 3) {
                        // 超过3次重试后停止尝试
                        logger.default.error(`Redis connection failed after ${times} retries. Giving up.`);
                        return null;
                    }
                    return Math.min(times * 100, 2000);
                },
                reconnectOnError: function(err) {
                    const targetError = 'READONLY';
                    if (err.message.includes(targetError)) {
                        return true;
                    }
                    return false;
                }
            });
            
            // 添加错误事件处理
            this.client.on('error', (err) => {
                logger.default.error('Redis connection error:', err);
            });
            
            this.selectDBIndex = botConfig.rateLimit.selectDB;

            logger.default.info(`RateLimiter: RateLimiter is enabled. Redis server: ${redisHost}:${redisPort}`);
            logger.default.debug('RateLimiter: Since the function is incomplete, it will not affect the sending behavior.');

            this._selectDanmaquaDB()
                .then(() => this.limiter = this._initAsyncRateLimiter())
                .catch((e) => {
                    logger.default.error('Error initializing rate limiter:', e);
                    this.enabled = false; // 初始化失败时禁用限流功能
                });
        } catch (e) {
            logger.default.error('Failed to initialize Redis client for rate limiter:', e);
            this.enabled = false; // 初始化失败时禁用限流功能
        }
    }

    _initAsyncRateLimiter() {
        if (!this.enabled || !this.client) return null;
        return new AsyncRateLimiter({ db: this.client, namespace: 'rate_limit' });
    }

    async _selectDanmaquaDB() {
        if (!this.enabled || !this.client) return;
        
        try {
            let dbIndex = this.selectDBIndex;
            if (isNaN(this.selectDBIndex)) {
                dbIndex = await this.client.get('danmaqua:db_index');
            }
            if (dbIndex > 0) {
                await this.client.select(dbIndex);
            }
        } catch (e) {
            this.logger.default.error('Error selecting Redis DB for rate limiter:', e);
        }
    }

    async getForGlobal() {
        if (!this.enabled || !this.limiter) return { remaining: 1, reset: Date.now() };
        
        try {
            return await this.limiter.get({
                id: 'global',
                max: 30,
                duration: 1000
            });
        } catch (e) {
            this.logger.default.error('Error getting global rate limit:', e);
            return { remaining: 1, reset: Date.now() };
        }
    }

    async getForChatOnly(chatId) {
        if (!this.enabled || !this.limiter) return { remaining: 1, reset: Date.now() };
        
        try {
            return await this.limiter.get({
                id: 'chat_' + chatId,
                max: 20,
                duration: 1000 * 60
            });
        } catch (e) {
            this.logger.default.error('Error getting chat rate limit:', e);
            return { remaining: 1, reset: Date.now() };
        }
    }

    async get(chatId) {
        if (!this.enabled || !this.limiter) {
            return { available: true, reset: Date.now() };
        }
        
        try {
            const globalRes = await this.getForGlobal();
            const chatRes = await this.getForChatOnly(chatId);
            const reset = Math.max(globalRes.reset, chatRes.reset);
            if (globalRes.remaining <= 0 || chatRes.remaining <= 0) {
                return {
                    available: false,
                    reset: reset
                };
            } else {
                return {
                    available: true,
                    reset: reset
                };
            }
        } catch (e) {
            this.logger.default.error('Error getting rate limit:', e);
            return { available: true, reset: Date.now() };
        }
    }
}

module.exports = RateLimiter;
