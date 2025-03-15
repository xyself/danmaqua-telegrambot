const http = require('http');
const ioServer = require('socket.io');
const log4js = require('log4js');
const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

const MSG_JOIN_ROOM = 'join_room';
const MSG_LEAVE_ROOM = 'leave_room';
const MSG_RECONNECT_ROOM = 'reconnect_room';

class Danmaku {
    constructor({sender: {uid, username, url, medal}, text, timestamp, roomId, type, price}) {
        this.sender = {uid, username, url, medal};
        this.text = text;
        this.timestamp = timestamp;
        this.roomId = roomId;
        this.type = type || 'danmaku'; // 默认为普通弹幕
        this.price = price || 0; // 用于SC价格
    }
}

class BaseDanmakuWebSocketSource {
    constructor(config) {
        // 初始化winston日志
        const transport = new winston.transports.DailyRotateFile({
            filename: path.join(config.logsDir, 'danmaku-source-%DATE%.log'),
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

        // 配置log4js
        log4js.configure({
            appenders: {
                stdout: { type: 'stdout' },
                outfile: {
                    type: 'dateFile',
                    filename: path.join(config.logsDir, 'access-log'),
                    pattern: 'yyyy-MM-dd.log',
                    alwaysIncludePattern: true,
                    keepFileExt: false
                }
            },
            categories: {
                default: {
                    appenders: ['stdout', 'outfile'],
                    level: 'debug'
                }
            }
        });
        this.logger = log4js.getLogger('default');
        this.winstonLogger = logger;
        this.port = config.port;
        this.basicAuth = config.basicAuth;
        this.server = http.createServer();
        this.io = ioServer(this.server);

        this.io.use((socket, next) => {
            if (this.basicAuth) {
                const authHeader = socket.handshake.headers['authorization'];
                if (this.basicAuth !== authHeader) {
                    this.logger.error('Remote address=' + socket.handshake.address + ' attempt to connect socket ' +
                        'with Authorization=' + authHeader + '. Refused due to incorrect auth.')
                    return next(new Error('Authentication error.'));
                }
            }
            return next();
        });
        this.io.on('connection', (socket) => {
            this.onConnected(socket);
            const connectedRooms = [];
            socket.on(MSG_JOIN_ROOM, (roomId) => {
                this.onJoin(roomId);
                connectedRooms.push(roomId);
            });
            socket.on(MSG_LEAVE_ROOM, (roomId) => {
                this.onLeave(roomId);
                const index = connectedRooms.indexOf(roomId);
                if (index >= 0) {
                    connectedRooms.splice(index, 1);
                }
            });
            socket.on(MSG_RECONNECT_ROOM, (roomId) => {
                this.onReconnect(roomId);
            });
            socket.on('disconnect', (reason) => {
                this.onDisconnect(reason);
                for (let room of connectedRooms) {
                    this.onLeave(room);
                }
            });
        });
    }

    onConnected(socket) {
        this.logger.debug('onConnected: socket address=' + socket.handshake.address + ' called.');
    }

    onJoin(roomId) {
        this.logger.debug('onJoin: roomId=' + roomId + ' called.');
    }

    onLeave(roomId) {
        this.logger.debug('onLeave: roomId=' + roomId + ' called.');
    }

    onReconnect(roomId) {
        this.logger.debug('onReconnect: roomId=' + roomId + ' called.');
    }

    onDisconnect(reason) {
        this.logger.debug('onDisconnect: reason=' + reason + ' called.')
    }

    sendDanmaku(danmaku) {
        // 过滤掉系统通知类礼物消息
        if (danmaku.text && (
            danmaku.text.includes('投喂') || 
            (danmaku.text.includes('赠送') && danmaku.text.includes('个')) ||
            danmaku.text.match(/<%.*%>.*<%.*%>/)  // 匹配系统通知格式 <%用户名%>操作<%用户名%>
        )) {
            // 这是系统礼物通知，不转发
            return;
        }
        
        this.io.sockets.emit('danmaku', JSON.stringify(danmaku));
    }

    listen() {
        this.server.listen(this.port);
    }
}

module.exports = { Danmaku, BaseDanmakuWebSocketSource, MSG_JOIN_ROOM, MSG_LEAVE_ROOM, MSG_RECONNECT_ROOM };
