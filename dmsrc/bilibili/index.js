const { Danmaku, BaseDanmakuWebSocketSource } = require('../common');
const { BLiveClient, BaseHandler } = require('blivedmjs');
const cron = require('node-cron');
const bilibiliConfig = require('../../dmsrc.config').bilibili;
const botConfig = require('../../bot.config');

const BATCH_RECONNECT_DELAY = 1000 * 10;

function delay(ms) {
    return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

class DanmakuHandler extends BaseHandler {
    constructor(source, roomId) {
        super();
        this.source = source;
        this.roomId = roomId;
    }

    on_client_start(client) {
        this.source.logger.debug(`[${this.roomId}] 客户端已启动`);
    }

    on_client_stop(client) {
        this.source.logger.debug(`[${this.roomId}] 客户端已停止`);
    }

    _on_heartbeat(client, message) {
        // 心跳包不处理
    }

    _on_danmaku(client, message) {
        try {
            const dmSenderUid = message.uid;
            const dmSenderUsername = message.uname;
            const dmSenderUrl = 'https://space.bilibili.com/' + dmSenderUid;
            const dmText = message.msg;
            const dmTimestamp = Math.floor(Date.now() / 1000);

            // 添加粉丝牌信息（如果有）
            let medalInfo = '';
            if (message.medal && message.medal.level > 0) {
                medalInfo = `[${message.medal.name}${message.medal.level}]`;
            }

            const danmaku = new Danmaku({
                sender: {
                    uid: dmSenderUid,
                    username: dmSenderUsername,
                    url: dmSenderUrl,
                    medal: medalInfo
                },
                text: dmText,
                timestamp: dmTimestamp,
                roomId: this.roomId,
                type: 'danmaku'
            });
            this.source.sendDanmaku(danmaku);
        } catch (e) {
            this.source.logger.error(`Error processing bilibili danmaku for room ${this.roomId}: ${e.message}`, e);
        }
    }

    _on_gift(client, message) {
        try {
            const dmSenderUid = message.uid || message.userId;
            const dmSenderUsername = message.uname || message.username;
            const dmSenderUrl = 'https://space.bilibili.com/' + dmSenderUid;
            const dmText = `赠送 ${message.giftName}x${message.num} (${message.coinType === 'gold' ? '金瓜子' : '银瓜子'}x${message.totalCoin})`;
            const dmTimestamp = Math.floor(Date.now() / 1000);

            const danmaku = new Danmaku({
                sender: {
                    uid: dmSenderUid,
                    username: dmSenderUsername,
                    url: dmSenderUrl
                },
                text: dmText,
                timestamp: dmTimestamp,
                roomId: this.roomId,
                type: 'gift'
            });
            this.source.sendDanmaku(danmaku);
        } catch (e) {
            this.source.logger.error(`Error processing bilibili gift for room ${this.roomId}: ${e.message}`, e);
        }
    }

    _on_buy_guard(client, message) {
        try {
            const guardLevelName = ['', '总督', '提督', '舰长'][message.guardLevel];
            const dmSenderUid = message.uid || message.userId;
            const dmSenderUsername = message.username;
            const dmSenderUrl = 'https://space.bilibili.com/' + dmSenderUid;
            const dmText = `开通了 ${guardLevelName}`;
            const dmTimestamp = Math.floor(Date.now() / 1000);

            const danmaku = new Danmaku({
                sender: {
                    uid: dmSenderUid,
                    username: dmSenderUsername,
                    url: dmSenderUrl
                },
                text: dmText,
                timestamp: dmTimestamp,
                roomId: this.roomId,
                type: 'guard'
            });
            this.source.sendDanmaku(danmaku);
        } catch (e) {
            this.source.logger.error(`Error processing bilibili guard for room ${this.roomId}: ${e.message}`, e);
        }
    }

    _on_super_chat(client, message) {
        try {
            const dmSenderUid = message.uid;
            const dmSenderUsername = message.uname;
            const dmSenderUrl = 'https://space.bilibili.com/' + dmSenderUid;
            const dmText = `醒目留言 ￥${message.price}: ${message.message}`;
            const dmTimestamp = Math.floor(Date.now() / 1000);

            const danmaku = new Danmaku({
                sender: {
                    uid: dmSenderUid,
                    username: dmSenderUsername,
                    url: dmSenderUrl
                },
                text: dmText,
                timestamp: dmTimestamp,
                roomId: this.roomId,
                type: 'sc',
                price: message.price
            });
            this.source.sendDanmaku(danmaku);
        } catch (e) {
            this.source.logger.error(`Error processing bilibili super chat for room ${this.roomId}: ${e.message}`, e);
        }
    }

    _on_interact_word(client, message) {
        try {
            // 只处理进入直播间的消息
            if (message.msgType === 1) {
                const dmSenderUid = message.uid;
                const dmSenderUsername = message.uname;
                const dmSenderUrl = 'https://space.bilibili.com/' + dmSenderUid;
                
                // 添加粉丝牌信息（如果有）
                let medalInfo = '';
                if (message.fans_medal && message.fans_medal.medal_level > 0) {
                    medalInfo = `[${message.fans_medal.medal_name}${message.fans_medal.medal_level}]`;
                }
                
                const dmText = `进入直播间`;
                const dmTimestamp = Math.floor(Date.now() / 1000);

                const danmaku = new Danmaku({
                    sender: {
                        uid: dmSenderUid,
                        username: dmSenderUsername,
                        url: dmSenderUrl,
                        medal: medalInfo
                    },
                    text: dmText,
                    timestamp: dmTimestamp,
                    roomId: this.roomId,
                    type: 'enter'
                });
                this.source.sendDanmaku(danmaku);
            }
        } catch (e) {
            this.source.logger.error(`Error processing bilibili interact for room ${this.roomId}: ${e.message}`, e);
        }
    }

    _on_like_click(client, message) {
        try {
            const dmSenderUid = message.uid;
            const dmSenderUsername = message.uname;
            const dmSenderUrl = 'https://space.bilibili.com/' + dmSenderUid;
            
            // 添加粉丝牌信息（如果有）
            let medalInfo = '';
            if (message.fans_medal && message.fans_medal.medal_level > 0) {
                medalInfo = `[${message.fans_medal.medal_name}${message.fans_medal.medal_level}]`;
            }
            
            const dmText = `为主播点赞了`;
            const dmTimestamp = Math.floor(Date.now() / 1000);

            const danmaku = new Danmaku({
                sender: {
                    uid: dmSenderUid,
                    username: dmSenderUsername,
                    url: dmSenderUrl,
                    medal: medalInfo
                },
                text: dmText,
                timestamp: dmTimestamp,
                roomId: this.roomId,
                type: 'like'
            });
            this.source.sendDanmaku(danmaku);
        } catch (e) {
            this.source.logger.error(`Error processing bilibili like for room ${this.roomId}: ${e.message}`, e);
        }
    }

    // 处理系统通知消息（礼物、活动等），但不转发
    _on_notice_msg(client, message) {
        try {
            // 记录日志但不转发
            this.source.logger.debug(`[${this.roomId}] 系统通知: ${message.msg_common || message.msg_self || JSON.stringify(message)}`);
        } catch (e) {
            this.source.logger.error(`Error processing bilibili notice for room ${this.roomId}: ${e.message}`, e);
        }
    }
    
    // 处理系统消息，但不转发
    _on_sys_msg(client, message) {
        try {
            // 记录日志但不转发
            this.source.logger.debug(`[${this.roomId}] 系统消息: ${message.msg || JSON.stringify(message)}`);
        } catch (e) {
            this.source.logger.error(`Error processing bilibili system message for room ${this.roomId}: ${e.message}`, e);
        }
    }
}

class BilibiliDanmakuSource extends BaseDanmakuWebSocketSource {
    constructor(config) {
        super(config);
        this.liveList = {};
        this.bilibiliProtocol = config.bilibiliProtocol;
        if (this.bilibiliProtocol !== 'ws' && this.bilibiliProtocol !== 'tcp') {
            this.logger.info('Bilibili Danmaku Source configuration didn\'t specify protocol type. Set to ws as default.');
            this.bilibiliProtocol = 'ws';
        }
        if (config.reconnectCron) {
            this.logger.info('Reconnect task schedule at "' + config.reconnectCron + '"');
            cron.schedule(config.reconnectCron, () => this.batchReconnect());
        }
    }

    isConnected(roomId) {
        const entity = this.liveList[roomId];
        return entity && entity.live;
    }

    createLive(roomId) {
        // 使用bot.config.js中的bilibiliSessData创建客户端
        const SESSDATA = botConfig.bilibiliSessData;
        const live = new BLiveClient(roomId, { sessData: SESSDATA });
        const handler = new DanmakuHandler(this, roomId);
        
        // 扩展handler，添加事件处理方法
        handler.on_client_start = (client) => {
            this.logger.debug(`Connected to live room: ${roomId}`);
            handler.source.logger.debug(`[${roomId}] 客户端已启动`);
        };
        
        handler.on_client_stop = (client) => {
            this.logger.debug(`Disconnected from live room: ${roomId}`);
        };
        
        handler._on_error = (client, error) => {
            this.logger.error(`BilibiliDanmakuSource roomId=${roomId} error:`, error);
        };
        
        live.set_handler(handler);
        live.start();
        
        return live;
    }

    onJoin(roomId) {
        super.onJoin(roomId);
        if (this.isConnected(roomId)) {
            this.liveList[roomId].counter++;
            return;
        }
        try {
            this.liveList[roomId] = {
                live: this.createLive(roomId),
                counter: 1
            };
        } catch (e) {
            this.logger.error(e);
        }
    }

    onLeave(roomId) {
        super.onLeave(roomId);
        if (!this.isConnected(roomId)) {
            return;
        }
        try {
            const entity = this.liveList[roomId];
            entity.counter--;
            if (entity.counter <= 0) {
                this.logger.debug(`Room ${roomId} is no longer used. Close now.`);
                entity.live.stop();
                delete this.liveList[roomId];
            }
        } catch (e) {
            this.logger.error(e);
        }
    }

    onReconnect(roomId) {
        super.onReconnect(roomId);
        if (!this.isConnected(roomId)) {
            return;
        }
        try {
            const entity = this.liveList[roomId];
            entity.live.stop();
            entity.live = this.createLive(roomId);
        } catch (e) {
            this.logger.error(e);
        }
    }

    batchReconnect = async () => {
        this.logger.debug('Start batch reconnect task');
        for (let roomId of Object.keys(this.liveList)) {
            this.onReconnect(Number(roomId));
            await delay(BATCH_RECONNECT_DELAY);
        }
    }
}

const src = new BilibiliDanmakuSource(bilibiliConfig);
src.listen();
src.logger.info('Bilibili Danmaku Source Server is listening at port ' + src.port);
