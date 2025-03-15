const Redis = require('ioredis');

class DanmakuStatistics {
    constructor(botConfig, logger) {
        this.enabled = botConfig.statistics.enabled;
        this.logger = logger;
        this.client = null;

        // 如果统计功能未启用，则不初始化 Redis 客户端
        if (!this.enabled) {
            logger.default.info('DanmakuStatistics: DanmakuStatistics is disabled.');
            return;
        }

        try {
            let redisServer = botConfig.statistics.redisServer;
            if (!redisServer.startsWith('redis://') && !redisServer.startsWith('rediss://')) {
                redisServer = 'redis://' + redisServer;
            }
            
            // 解析 Redis 服务器地址
            let redisUrl = new URL(redisServer);
            let redisHost = redisUrl.hostname || 'localhost';
            let redisPort = redisUrl.port || 6379;
            
            // 配置 Redis 客户端，添加重试次数限制和错误处理
            this.client = new Redis({
                host: redisHost,
                port: redisPort,
                maxRetriesPerRequest: 3,  // 减少重试次数
                retryStrategy: (times) => {
                    if (times > 3) {
                        // 超过3次重试后停止尝试
                        logger.default.error(`Redis connection failed after ${times} retries. Giving up.`);
                        return null;
                    }
                    return Math.min(times * 100, 3000); // 重试间隔，最大3秒
                }
            });
            
            // 添加错误事件处理
            this.client.on('error', (err) => {
                logger.default.error('Redis connection error:', err);
            });
            
            this.selectDBIndex = botConfig.statistics.selectDB;
            logger.default.info(`DanmakuStatistics: DanmakuStatistics is enabled. Redis server: ${redisHost}:${redisPort}`);

            this._selectDanmaquaDB().catch((e) => {
                logger.default.error('Error selecting Redis DB:', e);
            });
        } catch (e) {
            logger.default.error('Failed to initialize Redis client:', e);
            this.enabled = false; // 初始化失败时禁用统计功能
        }
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
            this.logger.default.error('Error selecting Redis DB:', e);
        }
    }

    async incrementSentences(userId, roomId) {
        if (!this.enabled || !this.client) return 0;
        try {
            await this.client.sadd('users', userId);
            await this.client.sadd('rooms', roomId);
            return await this.client.incr(`sentences:${userId}:${roomId}`);
        } catch (e) {
            this.logger.default.error('Error incrementing sentences:', e);
            return 0;
        }
    }

    async incrementWordsBy(userId, roomId, count) {
        if (!this.enabled || !this.client) return 0;
        try {
            await this.client.sadd('users', userId);
            await this.client.sadd('rooms', roomId);
            return await this.client.incrby(`words:${userId}:${roomId}`, count);
        } catch (e) {
            this.logger.default.error('Error incrementing words:', e);
            return 0;
        }
    }

    async getUsers() {
        if (!this.enabled || !this.client) return [];
        try {
            return await this.client.smembers('users');
        } catch (e) {
            this.logger.default.error('Error getting users:', e);
            return [];
        }
    }

    async getRooms() {
        if (!this.enabled || !this.client) return [];
        try {
            return await this.client.smembers('rooms');
        } catch (e) {
            this.logger.default.error('Error getting rooms:', e);
            return [];
        }
    }

    async getSentencesEntry(userId, roomId) {
        if (!this.enabled || !this.client) return 0;
        try {
            return Number(await this.client.get(`sentences:${userId}:${roomId}`));
        } catch (e) {
            this.logger.default.error('Error getting sentences entry:', e);
            return 0;
        }
    }

    async getWordsEntry(userId, roomId) {
        if (!this.enabled || !this.client) return 0;
        try {
            return Number(await this.client.get(`words:${userId}:${roomId}`));
        } catch (e) {
            this.logger.default.error('Error getting words entry:', e);
            return 0;
        }
    }

    async countSentencesByUserId(userId) {
        if (!this.enabled || !this.client) return 0;
        try {
            const keys = await this.client.keys(`sentences:${userId}:*`);
            let sum = 0;
            for (let key of keys) {
                sum += Number(await this.client.get(key));
            }
            return sum;
        } catch (e) {
            this.logger.default.error('Error counting sentences by user ID:', e);
            return 0;
        }
    }

    async countWordsByUserId(userId) {
        if (!this.enabled || !this.client) return 0;
        try {
            const keys = await this.client.keys(`words:${userId}:*`);
            let sum = 0;
            for (let key of keys) {
                sum += Number(await this.client.get(key));
            }
            return sum;
        } catch (e) {
            this.logger.default.error('Error counting words by user ID:', e);
            return 0;
        }
    }

    async countSentencesByRoomId(roomId) {
        if (!this.enabled || !this.client) return 0;
        try {
            const keys = await this.client.keys(`sentences:*:${roomId}`);
            let sum = 0;
            for (let key of keys) {
                sum += Number(await this.client.get(key));
            }
            return sum;
        } catch (e) {
            this.logger.default.error('Error counting sentences by room ID:', e);
            return 0;
        }
    }

    async countWordsByRoomId(roomId) {
        if (!this.enabled || !this.client) return 0;
        try {
            const keys = await this.client.keys(`words:*:${roomId}`);
            let sum = 0;
            for (let key of keys) {
                sum += Number(await this.client.get(key));
            }
            return sum;
        } catch (e) {
            this.logger.default.error('Error counting words by room ID:', e);
            return 0;
        }
    }
}

module.exports = {
    DanmakuStatistics,
};
