const { Danmaku, BaseDanmakuWebSocketSource } = require('../common');
const DouyuDM = require('douyudm');
const cron = require('node-cron');
const douyuConfig = require('../../dmsrc.config').douyu;

const BATCH_RECONNECT_DELAY = 1000 * 10;

function delay(ms) {
    return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

class DouyuDanmakuSource extends BaseDanmakuWebSocketSource {
    constructor(config) {
        super(config);
        this.liveList = {};
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
        let live;
        try {
            live = new DouyuDM(roomId, { 
                debug: false,
                ignore: [],
                onError: (e) => {
                    this.logger.error(`DouyuDM internal error for room ${roomId}:`, e);
                }
            });
        } catch (e) {
            this.logger.error(`Failed to create DouyuDM instance for room ${roomId}:`, e);
            return null;
        }

        live.on('connect', () => {
            this.logger.debug(`Connect to live room: ${roomId}`);
        });

        live.on('chatmsg', (data) => {
            try {
                if (!data || typeof data !== 'object') {
                    this.logger.warn(`Invalid chatmsg data received for room ${roomId}`);
                    return;
                }

                const dmSenderUid = data.uid;
                const dmSenderUsername = data.nn;
                const dmSenderUrl = 'https://yuba.douyu.com/wbapi/web/jumpusercenter?id=' + dmSenderUid +
                    '&name=' + encodeURIComponent(dmSenderUsername);
                const dmText = data.txt;
                const dmTimestamp = data.cst;

                if (!dmSenderUid || !dmSenderUsername || !dmText) {
                    this.logger.warn(`Incomplete chatmsg data received for room ${roomId}:`, data);
                    return;
                }

                const danmaku = new Danmaku({
                    sender: {
                        uid: dmSenderUid,
                        username: dmSenderUsername,
                        url: dmSenderUrl
                    },
                    text: dmText,
                    timestamp: dmTimestamp,
                    roomId: roomId,
                    type: 'danmaku'
                });
                this.sendDanmaku(danmaku);
            } catch (e) {
                this.logger.error(`Error processing douyu danmaku for room ${roomId}: ${e.message}`, e);
            }
        });

        // 处理用户进入房间消息
        live.on('uenter', (data) => {
            try {
                if (!data || typeof data !== 'object') {
                    this.logger.warn(`Invalid uenter data received for room ${roomId}`);
                    return;
                }

                const dmSenderUid = data.uid;
                const dmSenderUsername = data.nn;
                const dmSenderUrl = 'https://yuba.douyu.com/wbapi/web/jumpusercenter?id=' + dmSenderUid +
                    '&name=' + encodeURIComponent(dmSenderUsername);
                const dmText = `进入直播间`;
                const dmTimestamp = Math.floor(Date.now() / 1000);

                if (!dmSenderUid || !dmSenderUsername) {
                    this.logger.warn(`Incomplete uenter data received for room ${roomId}:`, data);
                    return;
                }

                // 添加粉丝牌信息（如果有）
                let medalInfo = '';
                if (data.bl && data.bnn) {
                    medalInfo = `[${data.bnn}${data.bl}]`;
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
                    roomId: roomId,
                    type: 'enter'
                });
                this.sendDanmaku(danmaku);
            } catch (e) {
                this.logger.error(`Error processing douyu enter for room ${roomId}: ${e.message}`, e);
            }
        });

        live.on('error', (e) => {
            this.logger.error(`DouyuDanmakuSource roomId=${roomId} error:`, e);
        });

        try {
            live.run();
        } catch (e) {
            this.logger.error(`Failed to run DouyuDM for room ${roomId}:`, e);
            return null;
        }

        return live;
    }

    onJoin(roomId) {
        super.onJoin(roomId);
        if (this.isConnected(roomId)) {
            this.liveList[roomId].counter++;
            return;
        }
        try {
            const live = this.createLive(roomId);
            if (!live) {
                this.logger.error(`Failed to create live connection for room ${roomId}`);
                return;
            }
            this.liveList[roomId] = {
                live: live,
                counter: 1
            };
        } catch (e) {
            this.logger.error(`Error in onJoin for room ${roomId}:`, e);
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
                entity.live.logout();
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
            entity.live.logout();
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

const src = new DouyuDanmakuSource(douyuConfig);
src.listen();
src.logger.info('Douyu Danmaku Source Server is listening at port ' + src.port);
