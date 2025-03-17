const settings = require('./util/settings');
const BotWrapper = require('./bot-wrapper');
const { Markup } = require('telegraf');

const MANAGE_PAGE_MAX_ITEMS = 4;
const USER_STATE_CODE_CHAT_CHANGE_DANMAKU_SRC = 1;
const USER_STATE_CODE_CHAT_CHANGE_PATTERN = 2;
const USER_STATE_CODE_CHAT_CHANGE_ADMIN = 3;
const USER_STATE_CODE_CHAT_CHANGE_BLOCK_USERS = 4;
const USER_STATE_CODE_CHAT_MANAGE_SCHEDULES = 5;

// 辅助函数
const getMarkdownOptions = (extra = {}) => ({
    parse_mode: 'Markdown',
    ...extra
});

const getHTMLOptions = (extra = {}) => ({
    parse_mode: 'HTML',
    ...extra
});

class DanmaquaBot extends BotWrapper {
    constructor({ botConfig, dmSrc, botToken, agent, logger, chatsScheduler, statistics, rateLimiter }) {
        super({ botConfig, botToken, agent, logger });
        this.settings = settings;
        this.startCommandSimpleMessage = '欢迎使用 Danmaqua Bot！';
        this.dmSrc = dmSrc;
        this.chatsScheduler = chatsScheduler;
        this.statistics = statistics;
        this.rateLimiter = rateLimiter;

        // 注册所有处理器
        this._registerCommandHandlers();
        this._registerCallbackQueryHandlers();
        this._registerOtherHandlers();
    }

    /**
     * 注册文本命令处理器
     */
    _registerCommandHandlers() {
        // 注册标准命令
        this.addCommands([
            {
                command: 'list_dm_src',
                title: '查询支持的弹幕源',
                description: '查看 Bot 支持哪些直播平台的弹幕源',
                help: '使用方法： /list\\_dm\\_src',
                botAdminOnly: false,
                callback: this.onCommandListDMSrc
            },
            {
                command: 'register_chat',
                title: '注册一个频道',
                description: '注册一个频道到 Bot，之后 Bot 会转发指定直播间的弹幕到这个频道',
                help: '使用方法：/register\\_chat `chatId` `roomId` `[source]`\n' +
                    '其中：\n' +
                    '- `chatId` 是要注册的频道 id\n' +
                    '- `roomId` 是要监听的直播间房间号\n' +
                    '- `source` 是要监听的弹幕源，可选，默认为 bilibili',
                botAdminOnly: true,
                callback: this.onCommandRegisterChat
            },
            {
                command: 'unregister_chat',
                title: '取消注册频道',
                description: '对频道取消绑定弹幕转发',
                help: '使用方法：/unregister\\_chat \\[频道ID]',
                botAdminOnly: true,
                callback: this.onCommandUnregisterChat
            },
            {
                command: 'manage_chats',
                title: '管理频道',
                description: '列出已经绑定了弹幕转发的频道，并进行选择管理',
                help: '使用方法：/manage\\_chats',
                botAdminOnly: false,
                callback: this.onCommandManageChats
            },
            {
                command: 'manage_chat',
                title: '管理指定的频道',
                description: '管理指定的已绑定弹幕转发的频道',
                help: '使用方法：/manage\\_chat \\[频道ID]',
                botAdminOnly: false,
                callback: this.onCommandManageChat
            },
            {
                command: 'set_default_admins',
                title: '设置默认管理员',
                description: '设置各个频道的默认管理员（并非 Bot 管理员）',
                help: '使用方法：/set\\_default\\_admins \\[第一个管理员ID] \\[第二个管理员ID] ...',
                botAdminOnly: true,
                callback: this.onCommandSetDefaultAdmins
            },
            {
                command: 'set_default_pattern',
                title: '设置默认过滤规则',
                description: '设置各个频道的默认过滤规则',
                help: '使用方法：/set\\_default\\_pattern \\[正则表达式]',
                botAdminOnly: true,
                callback: this.onCommandSetDefaultPattern
            },
            {
                command: 'set_default_source',
                title: '设置默认弹幕源',
                description: '设置各个频道的默认弹幕源',
                help: '使用方法：/set\\_default\\_source \\[弹幕源 ID]',
                botAdminOnly: true,
                callback: this.onCommandSetDefaultSource
            },
            {
                command: 'stat_users',
                title: '查看参与同传的用户统计列表',
                description: 'Bot 启用弹幕统计时，可以通过这个命令查看曾经发送同传弹幕的用户列表',
                help: '使用方法：/stat\\_users',
                botAdminOnly: false,
                callback: this.onCommandStatUsers
            },
            {
                command: 'stat_user_query',
                title: '查询指定 ID 的用户统计',
                description: 'Bot 启用弹幕统计时，可以通过这个命令查看指定 ID 曾经发送的同传弹幕统计信息',
                help: '使用方法：/stat\\_user_query [统计用户 ID]',
                botAdminOnly: false,
                callback: this.onCommandStatUserQuery
            },
            {
                command: 'cancel',
                title: '取消当前操作',
                description: '取消正在进行的交互式操作',
                help: '使用方法：/cancel',
                botAdminOnly: false,
                callback: this.onCommandCancel
            }
        ]);
        
        // 更新Telegram命令列表
        try {
            // 将注册的命令转换为Telegram格式
            const telegramCommands = this.commandRecords.map(cmd => ({
                command: cmd.command,
                description: cmd.description
            }));
            
            // 设置命令列表
            this.bot.telegram.setMyCommands(telegramCommands)
                .then(() => {
                    this.logger.default.info(`已更新Telegram命令列表，共${telegramCommands.length}个命令`);
                })
                .catch(err => {
                    this.logger.default.error(`更新Telegram命令列表失败: ${err.message}`);
                });
        } catch (error) {
            this.logger.default.error(`准备更新命令列表时出错: ${error.message}`);
        }
    }

    /**
     * 注册回调查询处理器
     */
    _registerCallbackQueryHandlers() {
        // 频道管理相关回调
        const callbackHandlers = [
            { pattern: /^manage_chat:([-\d]+)/, handler: this.onActionManageChat },
            { pattern: /^manage_chats_pages:(\d+)/, handler: this.onActionManageChatsPages },
            
            // 设置修改相关
            { pattern: /^change_danmaku_src:([-\d]+)/, handler: this.onActionChangeDanmakuSrc },
            { pattern: /^change_pattern:([-\d]+)/, handler: this.onActionChangePattern },
            { pattern: /^change_admin:([-\d]+)/, handler: this.onActionChangeAdmin },
            { pattern: /^change_blocked_users:([-\d]+)/, handler: this.onActionChangeBlockedUsers },
            { pattern: /^select_danmaku_src:([-\d]+):([a-zA-Z\d]+)/, handler: this.onActionSelectDanmakuSrc },
            
            // 频道操作相关
            { pattern: /^unregister_chat:([-\d]+)/, handler: this.onActionUnregisterChat },
            { pattern: /^confirm_unregister_chat:([-\d]+)/, handler: this.onActionConfirmUnregisterChat },
            { pattern: /^reconnect_room:([a-zA-Z\d]+)_([-\d]+)/, handler: this.onActionReconnectRoom },
            
            // 用户和统计相关
            { pattern: /^block_user:([-\d]+):([-_a-zA-Z\d]+)/, handler: this.onActionBlockUser },
            { pattern: /^manage_schedules:([-\d]+)/, handler: this.onActionManageSchedules },
            { pattern: /^stat_by_chat:([-\d]+)/, handler: this.onActionStatisticsByChat }
        ];

        // 统一注册回调查询处理器
        for (const { pattern, handler } of callbackHandlers) {
            this.bot.action(pattern, async (ctx) => {
                try {
                    // 记录回调请求
                    const userId = ctx.update.callback_query.from.id;
                    const callbackData = ctx.update.callback_query.data;
                    this.user_access_log(userId, `Callback received: ${callbackData}`);
                    
                    // 调用处理函数
                    await handler.call(this, ctx);
                } catch (e) {
                    // 记录错误
                    this.logger.default.error('回调处理错误:', e);
                    // 尝试通知用户出错了
                    try {
                        await this.safeAnswerCbQuery(ctx, '处理请求时发生错误，请稍后再试', true);
                    } catch (notifyError) {
                        this.logger.default.error('无法通知用户错误:', notifyError);
                    }
                }
            });
        }
    }

    /**
     * 注册其他类型的处理器
     */
    _registerOtherHandlers() {
        // 注册内联查询处理
        this.bot.on('inline_query', this.onInlineQuery);
        
        // 注册消息处理
        this.bot.on('message', this.onMessage);
    }

    /**
     * 发送弹幕通知到频道
     * @param {Number|String} chatId 目标聊天/频道ID
     * @param {Object} data 弹幕数据
     * @param {Object} options 选项
     * @param {Boolean} options.hideUsername 是否隐藏用户名
     * @returns {Promise<Object>} 发送的消息对象
     */
    notifyDanmaku = async (chatId, data, { hideUsername = false }) => {
        const userIdWithSrc = data.sourceId + '_' + data.sender.uid;
        
        // 统计信息记录
        if (this.statistics && this.statistics.enabled) {
            const roomIdWithSrc = data.sourceId + '_' + data.roomId;
            this.statistics.incrementSentences(userIdWithSrc, roomIdWithSrc);
            this.statistics.incrementWordsBy(userIdWithSrc, roomIdWithSrc, data.text.length);
        }
        
        // 构建消息文本
        let msg = '';
        if (!hideUsername) {
            const url = data.sender.url + '#' + userIdWithSrc;
            msg += `<a href="${url}">${data.sender.username}</a>：`;
        }
        msg += data.text;
        
        // 消息去重处理：使用静态缓存存储最近发送的消息
        if (!this.recentMessages) {
            this.recentMessages = new Map();
        }
        
        // 生成消息唯一标识（聊天ID + 用户ID + 消息内容 + 时间戳取分钟）
        const now = Date.now();
        const minute = Math.floor(now / 60000); // 按分钟计算
        const messageKey = `${chatId}:${userIdWithSrc}:${data.text}:${minute}`;
        
        // 检查是否在短时间内发送过相同消息
        if (this.recentMessages.has(messageKey)) {
            this.logger.default.debug(`消息去重：跳过发送重复消息 ${messageKey}`);
            return null; // 跳过发送重复消息
        }
        
        // 记录当前消息到缓存
        this.recentMessages.set(messageKey, now);
        
        // 清理过期缓存（保留近10分钟的消息记录）
        const CACHE_EXPIRY = 10 * 60 * 1000; // 10分钟
        for (const [key, timestamp] of this.recentMessages.entries()) {
            if (now - timestamp > CACHE_EXPIRY) {
                this.recentMessages.delete(key);
            }
        }
        
        // 速率限制检查
        if (this.rateLimiter && this.rateLimiter.enabled) {
            const res = await this.rateLimiter.get(chatId);
            if (!res.available) {
                this.logger.default.debug('Sending messages rate limit exceeded.');
                // TODO 超过频率限制采取不同的行为
            }
        }
        
        // 发送消息
        const options = { 
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            disable_notification: true
        };
        const sent = await this.bot.telegram.sendMessage(chatId, msg, options);
        return sent;
    };

    /**
     * 通知管理员操作执行完成
     * @param {Number|String} chatId 聊天/频道ID
     * @param {String} action 执行的操作描述
     */
    notifyActionDone = (chatId, action) => {
        const msgText = 'Bot 已成功于 <code>' + new Date(Date.now()) + '</code> 执行操作 <code>' + escapeHtml(action) + '</code>';
        this._notifyAdmins(chatId, msgText);
    };

    /**
     * 通知管理员操作执行失败
     * @param {Number|String} chatId 聊天/频道ID
     * @param {String} action 执行的操作描述
     * @param {Error} error 错误对象
     */
    notifyActionError = (chatId, action, error) => {
        const msgText = 'Bot 在 <code>' + new Date(Date.now()) + '</code> 执行操作 <code>' + escapeHtml(action) +
            '</code> 时遭遇错误：\n<pre>' + escapeHtml(error.toString()) + '</pre>\n';
        this._notifyAdmins(chatId, msgText);
    };

    /**
     * 向频道的所有管理员发送通知
     * @param {Number|String} chatId 聊天/频道ID
     * @param {String} message HTML格式的消息内容
     * @private
     */
    _notifyAdmins = (chatId, message) => {
        const options = { parse_mode: 'HTML' };
        for (let admin of settings.getChatConfig(chatId).admin) {
            this.bot.telegram.sendMessage(admin, message, options).catch((e) => {
                this.logger.default.error(e);
            });
        }
    };

    /**
     * 发送纯文本消息
     * @param {Number|String} chatId 聊天/频道ID
     * @param {String} text 消息文本
     * @returns {Promise<Object>} 发送的消息对象
     */
    sendPlainText = async (chatId, text) => {
        return await this.bot.telegram.sendMessage(chatId, text);
    };

    /**
     * 发送HTML格式的消息
     * @param {Number|String} chatId 聊天/频道ID
     * @param {String} htmlText HTML格式的消息文本
     * @returns {Promise<Object>} 发送的消息对象
     */
    sendHtml = async (chatId, htmlText) => {
        return await this.bot.telegram.sendMessage(chatId, htmlText, { parse_mode: 'HTML' });
    }

    /**
     * 获取用户有权限管理的聊天配置
     * @param {Number} userId 用户ID
     * @returns {Array} 用户可管理的聊天配置列表
     */
    getManagedChatsConfig = (userId) => {
        const result = [];
        const chatConfigs = settings.getChatConfigs();
        for (let chatId of Object.keys(chatConfigs)) {
            const chatConfig = Object.assign({}, chatConfigs[chatId], { chatId });
            if (this.hasUserPermissionForBot(userId) || chatConfig.admin.indexOf(userId) !== -1) {
                result.push(chatConfig);
            }
        }
        return result;
    };

    /**
     * 获取用户有权限管理的聊天数量
     * @param {Number} userId 用户ID
     * @returns {Number} 可管理的聊天数量
     */
    getManagedChatsCount = (userId) => {
        let count = 0;
        const chatConfigs = settings.getChatConfigs();
        for (let chatId of Object.keys(chatConfigs)) {
            const chatConfig = Object.assign({}, chatConfigs[chatId], { chatId });
            if (this.hasUserPermissionForBot(userId) || chatConfig.admin.indexOf(userId) !== -1) {
                count++;
            }
        }
        return count;
    }

    /**
     * 获取用户有权限管理的聊天分页数量
     * @param {Number} userId 用户ID
     * @returns {Number} 分页总数
     */
    getManagedChatsPageCount = (userId) => {
        return Math.ceil(this.getManagedChatsCount(userId) / MANAGE_PAGE_MAX_ITEMS);
    }

    /**
     * 获取用户有权限管理的指定页的聊天配置
     * @param {Number} userId 用户ID
     * @param {Number} page 页码（从0开始）
     * @returns {Array} 指定页的聊天配置列表
     */
    getManagedChatsConfigByPage = (userId, page) => {
        const chatConfigs = this.getManagedChatsConfig(userId);
        const minIndex = page * MANAGE_PAGE_MAX_ITEMS;
        const maxIndex = minIndex + MANAGE_PAGE_MAX_ITEMS;
        return chatConfigs.filter((v, index) => index >= minIndex && index < maxIndex);
    };

    /**
     * 处理普通消息
     */
    onMessage = async (ctx) => {
        // 如果消息是命令，则不执行状态处理
        if (ctx.message.text && ctx.message.text.startsWith('/')) {
            return; // 命令将由命令处理器处理，不在这里处理
        }
        
        // 处理转发自频道的消息
        if (ctx.message.forward_from_chat) {
            const handled = await this.onForwardMessageFromChat(ctx);
            if (handled) return;
        }

        // 处理用户状态
        const userId = ctx.message.from.id;
        const stateCode = settings.getUserStateCode(userId);
        const stateData = settings.getUserStateData(userId);
        
        // 根据状态码分派到相应的处理函数
        this._dispatchUserStateHandler(ctx, stateCode, stateData);
    };

    /**
     * 根据用户状态分派到对应的处理函数
     * @param {Object} ctx Telegraf上下文
     * @param {Number} stateCode 状态码
     * @param {Object} stateData 状态数据
     */
    _dispatchUserStateHandler(ctx, stateCode, stateData) {
        // 状态处理函数映射
        const stateHandlers = {
            [USER_STATE_CODE_CHAT_CHANGE_DANMAKU_SRC]: this.onAnswerChangeDanmakuSrc,
            [USER_STATE_CODE_CHAT_CHANGE_PATTERN]: this.onAnswerChangePattern,
            [USER_STATE_CODE_CHAT_CHANGE_ADMIN]: this.onAnswerChangeAdmin,
            [USER_STATE_CODE_CHAT_CHANGE_BLOCK_USERS]: this.onAnswerChangeBlockedUsers,
            [USER_STATE_CODE_CHAT_MANAGE_SCHEDULES]: this.onAnswerManageSchedules
        };

        // 如果存在对应状态的处理函数，则调用它
        const handler = stateHandlers[stateCode];
        if (handler) {
            handler.call(this, ctx, stateData);
        }
    }

    /**
     * 处理转发自频道的消息
     * @returns {Boolean} 是否处理了消息
     */
    onForwardMessageFromChat = async (ctx) => {
        const chatId = ctx.message.forward_from_chat.id;
        if (!ctx.message.text || ctx.message.chat.type !== 'private') {
            return false;
        }
        if (!this.hasPermissionForChat(ctx.message.from.id, chatId)) {
            ctx.reply('你没有这个对话的管理权限。');
            return true;
        }
        if (!settings.getChatConfig(chatId)) {
            ctx.reply('这个对话没有在 Bot 注册。');
            return true;
        }
        let username = null;
        let uid = 0;
        if (ctx.message.entities.length === 1) {
            const firstEntity = ctx.message.entities[0];
            if (firstEntity.type === 'text_link') {
                const [_, result] = firstEntity.url.split('#');
                if (result && result.indexOf('_') >= 0) {
                    uid = result;
                    username = ctx.message.text.substr(firstEntity.offset, firstEntity.length);
                }
            }
        }
        if (!username) {
            ctx.reply('这条消息无法寻找到弹幕用户信息。');
            return true;
        }

        const keyboard = {
            inline_keyboard: [[
                { text: `屏蔽用户：${username}（${uid}）`, callback_data: `block_user:${chatId}:${uid}` }
            ]]
        };

        ctx.reply('你要对这条弹幕进行什么操作：', {
            reply_to_message_id: ctx.message.message_id,
            reply_markup: keyboard
        });
        return true;
    };

    onActionBlockUser = async (ctx) => {
        const targetChatId = parseInt(ctx.match[1]);
        if (!this.hasPermissionForChat(ctx.callbackQuery.from.id, targetChatId)) {
            return await this.safeAnswerCbQuery(ctx, '你没有权限设置这个对话。', true);
        }
        const config = this.getRegisteredChatConfig(targetChatId);
        if (!config) {
            return await this.safeAnswerCbQuery(ctx, '这个对话没有在 Bot 中注册。', true);
        }
        const targetUserId = parseInt(ctx.match[2]);
        const action = ctx.match[3];
        if (action === 'block') {
            this.addBlockedUserId(targetChatId, targetUserId);
            return await this.safeAnswerCbQuery(
                ctx, 
                '已把用户 ID ' + targetUserId + ' 加入 ' + targetChatId + ' 的屏蔽列表。',
                true);
        }
    };

    onCommandRegisterChat = async (ctx) => {
        let [_, chatId, roomId, source] = ctx.message.text.split(' ');
        if (!chatId || !roomId) {
            ctx.reply('注册命令使用方法：/register_chat <code>chatId</code> <code>roomId</code> <code>[source]</code>', { parse_mode: 'HTML' });
            return;
        }
        if (isNaN(Number(roomId))) {
            ctx.reply('房间号必须是数字。');
            return;
        }
        if (source && !settings.danmakuSources.find((value) => value.id === source)) {
            ctx.reply(`弹幕源 ${source} 不受支持。`);
            return;
        }
        const targetChat = await this.getChat(chatId);
        const canSend = targetChat != null && await this.canSendMessageToChat(targetChat.id);
        if (!canSend) {
            ctx.reply('Bot 不被允许发送消息到对话 ' + (targetChat ? ('id=' + targetChat.id) : chatId));
            return;
        }
        chatId = targetChat.id;
        roomId = Number(roomId);
        this.doRegisterChat(chatId, roomId, source);
        const curDanmakuSource = settings.getChatConfig(chatId).danmakuSource;
        this.user_access_log(ctx.message.from.id, 'Registered chat id=' + chatId +
            ' to room: ' + curDanmakuSource + ' ' + roomId);
        ctx.reply(
            `对话 id=${targetChat.id} 已被注册到弹幕源 ` +
            `${curDanmakuSource}:${roomId}`
        );
    };

    doRegisterChat = (chatId, roomId, source) => {
        const curRoomId = settings.getChatConfig(chatId).roomId;
        let curDanmakuSource = settings.getChatConfig(chatId).danmakuSource;
        if (curRoomId !== roomId || curDanmakuSource !== source) {
            if (curRoomId) {
                this.dmSrc.leaveRoom(curDanmakuSource, curRoomId);
            }
            settings.setChatRoomId(chatId, roomId);
            settings.setChatDanmakuSource(chatId, source);
            curDanmakuSource = settings.getChatConfig(chatId).danmakuSource;
            this.dmSrc.joinRoom(curDanmakuSource, roomId);
        }
    };

    onCommandUnregisterChat = async (ctx) => {
        let [_, chatId] = ctx.message.text.split(' ');
        if (!chatId) {
            ctx.reply('取消注册命令使用方法：/unregister_chat <code>chatId</code>', { parse_mode: 'HTML' });
            return;
        }
        const targetChat = await this.getChat(chatId || ctx.chat.id);
        if (!targetChat) {
            ctx.reply('无法找到这个对话。');
            return;
        }
        chatId = targetChat.id;
        this.requestUnregisterChat(ctx, chatId);
    };

    createManageChatsMessageKeyboard = async (userId, page) => {
        const buttons = [];
        for (let cfg of this.getManagedChatsConfigByPage(userId, page)) {
            const chat = await this.getChat(cfg.chatId);
            let displayName = '';
            if (chat) {
                if (chat.title && !chat.username) {
                    displayName = chat.title;
                } else if (!chat.title && chat.username) {
                    displayName = '@' + chat.username;
                } else if (chat.title && chat.username) {
                    displayName = chat.title + ' (@' + chat.username + ')';
                }
            }
            buttons.push([{ text: displayName, callback_data: 'manage_chat:' + cfg.chatId }]);
        }
        const pageButtons = [];
        const pageCount = this.getManagedChatsPageCount(userId);
        pageButtons.push({ text: '第' + (page+1) + '/' + pageCount + '页', callback_data: 'noop' });
        if (page > 0) {
            pageButtons.push({ text: '上一页', callback_data: 'manage_chats_pages:' + (page - 1) });
        }
        if (page < pageCount - 1) {
            pageButtons.push({ text: '下一页', callback_data: 'manage_chats_pages:' + (page + 1) });
        }
        if (pageButtons.length > 1) {
            buttons.push(pageButtons);
        }
        return {
            inline_keyboard: buttons
        };
    };

    onCommandManageChats = async (ctx) => {
        const userId = ctx.message.from.id;
        const keyboard = await this.createManageChatsMessageKeyboard(userId, 0);
        ctx.reply(
            '请选择你要管理的频道：\n如果你要找的频道没有显示，可能是你的账号没有权限。',
            { reply_markup: keyboard }
        );
    };

    onActionManageChatsPages = async (ctx) => {
        const userId = ctx.update.callback_query.from.id;
        const targetPage = parseInt(ctx.match[1]);
        if (targetPage >= 0 && targetPage < this.getManagedChatsPageCount(userId)) {
            const keyboard = await this.createManageChatsMessageKeyboard(userId, targetPage);
            await ctx.editMessageReplyMarkup(keyboard);
            return await this.safeAnswerCbQuery(ctx);
        } else {
            return await this.safeAnswerCbQuery(ctx, '你选择的页数 ' + targetPage + ' 不存在。', true);
        }
    };

    onActionManageChat = async (ctx) => {
        const targetChatId = parseInt(ctx.match[1]);
        if (!await this.canSendMessageToChat(targetChatId)) {
            return await this.safeAnswerCbQuery(
                ctx,
                '这个机器人无法发送消息给对话：' + targetChatId + '。请检查权限配置是否正确。', 
                true);
        }
        this.requestManageChat(ctx, targetChatId);
        return await this.safeAnswerCbQuery(ctx);
    };

    requestManageChat = async (ctx, chatId) => {
        const chat = await this.getChat(chatId);
        let displayName = '';
        if (!chat) {
            return ctx.reply('找不到指定的频道, id: ' + chatId);
        }
        if (chat.type !== 'channel') {
            return ctx.reply('只能管理频道, id: ' + chatId);
        }
        if (!chat.username) {
            displayName = chat.title;
        } else {
            displayName = chat.title + ' (@' + chat.username + ')';
        }
        const config = settings.getChatConfig(chatId);
        const dmSrc = config.danmakuSource;
        const roomId = config.roomId;
        const pattern = config.pattern.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
        
        // 使用HTML解析模式
        let msgText = `📋 频道"${escapeHtml(displayName)}"的设置\n\n`;
        msgText += `🆔 频道ID: -${chatId}\n`;
        msgText += `🔮 弹幕源: ${dmSrc}\n`;
        msgText += `🏠 房间号: ${roomId}\n`;
        msgText += `🔍 过滤规则: ${pattern}\n\n`;
        msgText += `请选择要修改的设置：`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔮 修改弹幕源', callback_data: `change_danmaku_src:${chat.id}` },
                    { text: '🔍 修改过滤规则', callback_data: `change_pattern:${chat.id}` }
                ],
                [
                    { text: '👤 修改管理员', callback_data: `change_admin:${chat.id}` },
                    { text: '⛔ 管理黑名单', callback_data: `change_blocked_users:${chat.id}` }
                ],
                [
                    { text: '📅 计划任务', callback_data: `manage_schedules:${chat.id}` },
                    { text: '🔄 重连房间', callback_data: `reconnect_room:${dmSrc}_${roomId}` }
                ],
                [
                    { text: '📊 查看统计', callback_data: `stat_by_chat:${chat.id}` },
                    { text: '❌ 取消注册', callback_data: `unregister_chat:${chat.id}` }
                ]
            ]
        };

        ctx.reply(msgText, { parse_mode: 'HTML', reply_markup: keyboard });
    };

    onActionReconnectRoom = async (ctx) => {
        const dmSrc = ctx.match[1];
        const roomId = parseInt(ctx.match[2]);
        this.dmSrc.reconnectRoom(dmSrc, roomId);
        ctx.reply(`已经对直播房间 ${dmSrc} ${roomId} 重新连接中。` +
            `（由于目前是相同直播房间的所有对话共用一个弹幕连接，可能会影响到其它频道的弹幕转发）`);
        this.user_access_log(ctx.update.callback_query.from.id, 'Reconnect room: ' + dmSrc + ' ' + roomId);
         return await this.safeAnswerCbQuery(ctx);
    };

    onActionUnregisterChat = async (ctx) => {
        const targetChatId = parseInt(ctx.match[1]);
        this.requestUnregisterChat(ctx, targetChatId);
         return await this.safeAnswerCbQuery(ctx);
    };

    onActionConfirmUnregisterChat = async (ctx) => {
        const chatId = parseInt(ctx.match[1]);
        const regRoomId = settings.getChatConfig(chatId).roomId;
        const regSource = settings.getChatConfig(chatId).danmakuSource;
        if (!regRoomId) {
            return await this.safeAnswerCbQuery(ctx, '这个对话未注册任何弹幕源。', true);
        }
        settings.deleteChatConfig(chatId);
        this.dmSrc.leaveRoom(regSource, regRoomId);
        ctx.reply(`对话 id=${chatId} 已成功取消注册。`);
        this.user_access_log(ctx.update.callback_query.from.id, 'Unregistered chat id=' + chatId);
         return await this.safeAnswerCbQuery(ctx);
    };

    requestUnregisterChat = async (ctx, chatId) => {
        const keyboard = {
            inline_keyboard: [[
                { text: '是的，我不后悔', callback_data: 'confirm_unregister_chat:' + chatId }
            ]]
        };
        ctx.reply('你确定要取消注册对话 id=' + chatId + ' 吗？所有该对话的设置都会被清除且无法恢复。',
            { reply_markup: keyboard });
    };

    /**
     * 显示弹幕源选择界面
     */
    onActionChangeDanmakuSrc = async (ctx) => {
        const targetChatId = parseInt(ctx.match[1]);
        const currentConfig = settings.getChatConfig(targetChatId);
        
        // 构建弹幕源选择按钮
        const inlineKeyboard = [];
        const dmSources = settings.danmakuSources;
        for (const source of dmSources) {
            inlineKeyboard.push([{
                text: `${source.id === currentConfig.danmakuSource ? '✅ ' : ''}${source.description}`,
                callback_data: `select_danmaku_src:${targetChatId}:${source.id}`
            }]);
        }
        
        const replyText = `你正在为频道 ID=${targetChatId} 选择弹幕源\n\n` +
            `当前设置：房间号=<code>${currentConfig.roomId}</code>, 弹幕源=<code>${currentConfig.danmakuSource}</code>\n\n` +
            `请选择弹幕源：`;
            
        ctx.reply(replyText, { 
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: inlineKeyboard }
        });
        
        return await this.safeAnswerCbQuery(ctx);
    };

    /**
     * 处理用户更改弹幕源和房间号的输入
     */
    onAnswerChangeDanmakuSrc = async (ctx, stateData) => {
        if (typeof stateData === 'number') {
            stateData = { targetChatId: stateData };
        }
        
        const { targetChatId, selectedSource } = stateData;
        const roomId = parseInt(ctx.message.text);
        
        if (isNaN(roomId)) {
            ctx.reply('房间号必须是有效的数字，请重新输入或回复 /cancel 取消操作。');
            return;
        }
        
        const config = settings.getChatConfig(targetChatId);
        const oldRoomId = config.roomId;
        const oldSource = config.danmakuSource;
        
        // 检查是否真的变化了
        if (oldRoomId !== roomId || oldSource !== selectedSource) {
            // 如果有旧的连接，先断开
            if (oldRoomId) {
                this.dmSrc.leaveRoom(oldSource, oldRoomId);
            }
            
            // 更新设置
            settings.setChatRoomId(targetChatId, roomId);
            settings.setChatDanmakuSource(targetChatId, selectedSource);
            
            // 连接新房间
            this.dmSrc.joinRoom(selectedSource, roomId);
            
            ctx.reply(`已成功为频道 ID=${targetChatId} 注册弹幕源 ${selectedSource}:${roomId}`);
            this.user_access_log(ctx.message.from.id, `Changed danmaku source: ${targetChatId} from ${oldSource}:${oldRoomId} to ${selectedSource}:${roomId}`);
        } else {
            ctx.reply(`频道 ID=${targetChatId} 的弹幕源和房间号未变化`);
        }
        
        // 清除用户状态
        settings.clearUserState(ctx.message.from.id);
    };

    /**
     * 显示修改过滤规则的交互界面
     */
    onActionChangePattern = async (ctx) => {
        const targetChatId = parseInt(ctx.match[1]);
        
        if (!this.hasPermissionForChat(ctx.callbackQuery.from.id, targetChatId)) {
            return await this.safeAnswerCbQuery(ctx, '你没有权限修改这个频道的设置。', true);
        }
        
        const config = settings.getChatConfig(targetChatId);
        if (!config) {
            return await this.safeAnswerCbQuery(ctx, '这个频道没有在 Bot 中注册。', true);
        }
        
        // 设置用户状态为修改过滤规则
        settings.setUserState(ctx.callbackQuery.from.id, USER_STATE_CODE_CHAT_CHANGE_PATTERN, targetChatId);
        
        // 构建提示信息
        const pattern = config.pattern;
        const replyText = `你正在修改频道 ID=${targetChatId} 的过滤规则\n\n` +
            `当前规则：<code>${escapeHtml(pattern)}</code>\n\n` +
            `请直接回复新的过滤规则（正则表达式），或回复 /cancel 取消操作。`;
            
        ctx.reply(replyText, { parse_mode: 'HTML' });
        this.user_access_log(ctx.callbackQuery.from.id, `Started changing pattern for chat ${targetChatId}`);
        return await this.safeAnswerCbQuery(ctx);
    };

    /**
     * 显示修改管理员的交互界面
     */
    onActionChangeAdmin = async (ctx) => {
        const targetChatId = parseInt(ctx.match[1]);
        
        if (!this.hasPermissionForChat(ctx.callbackQuery.from.id, targetChatId)) {
            return await this.safeAnswerCbQuery(ctx, '你没有权限修改这个频道的设置。', true);
        }
        
        const config = settings.getChatConfig(targetChatId);
        if (!config) {
            return await this.safeAnswerCbQuery(ctx, '这个频道没有在 Bot 中注册。', true);
        }
        
        // 设置用户状态为修改管理员
        settings.setUserState(ctx.callbackQuery.from.id, USER_STATE_CODE_CHAT_CHANGE_ADMIN, targetChatId);
        
        // 构建提示信息
        const admins = config.admin.join(', ');
        const replyText = `你正在修改频道 ID=${targetChatId} 的管理员\n\n` +
            `当前管理员：<code>${escapeHtml(admins)}</code>\n\n` +
            `请直接回复新的管理员ID列表（用空格或逗号分隔），或回复 /cancel 取消操作。`;
            
        ctx.reply(replyText, { parse_mode: 'HTML' });
        this.user_access_log(ctx.callbackQuery.from.id, `Started changing admins for chat ${targetChatId}`);
        return await this.safeAnswerCbQuery(ctx);
    };

    /**
     * 显示修改黑名单的交互界面
     */
    onActionChangeBlockedUsers = async (ctx) => {
        const targetChatId = parseInt(ctx.match[1]);
        
        if (!this.hasPermissionForChat(ctx.callbackQuery.from.id, targetChatId)) {
            return await this.safeAnswerCbQuery(ctx, '你没有权限修改这个频道的设置。', true);
        }
        
        const config = settings.getChatConfig(targetChatId);
        if (!config) {
            return await this.safeAnswerCbQuery(ctx, '这个频道没有在 Bot 中注册。', true);
        }
        
        // 设置用户状态为修改黑名单
        const messageId = ctx.callbackQuery.message.message_id;
        const chatId = ctx.callbackQuery.message.chat.id;
        settings.setUserState(ctx.callbackQuery.from.id, USER_STATE_CODE_CHAT_CHANGE_BLOCK_USERS, 
            {targetChatId, chatId, messageId});
        
        // 发送黑名单管理界面
        ctx.reply(this.getChangeBlockedUsersMessageText(targetChatId), { parse_mode: 'HTML' });
        this.user_access_log(ctx.callbackQuery.from.id, `Started changing blocked users for chat ${targetChatId}`);
        return await this.safeAnswerCbQuery(ctx);
    };

    /**
     * 显示管理计划任务的交互界面
     */
    onActionManageSchedules = async (ctx) => {
        const targetChatId = parseInt(ctx.match[1]);
        
        if (!this.hasPermissionForChat(ctx.callbackQuery.from.id, targetChatId)) {
            return await this.safeAnswerCbQuery(ctx, '你没有权限修改这个频道的设置。', true);
        }
        
        const config = settings.getChatConfig(targetChatId);
        if (!config) {
            return await this.safeAnswerCbQuery(ctx, '这个频道没有在 Bot 中注册。', true);
        }
        
        // 设置用户状态为管理计划任务
        const messageId = ctx.callbackQuery.message.message_id;
        const chatId = ctx.callbackQuery.message.chat.id;
        settings.setUserState(ctx.callbackQuery.from.id, USER_STATE_CODE_CHAT_MANAGE_SCHEDULES, 
            {targetChatId, chatId, messageId});
        
        // 发送计划任务管理界面
        ctx.reply(this.getManageSchedulesMessageText(targetChatId), { parse_mode: 'HTML' });
        this.user_access_log(ctx.callbackQuery.from.id, `Started managing schedules for chat ${targetChatId}`);
        return await this.safeAnswerCbQuery(ctx);
    };

    /**
     * 记录用户操作日志
     * @param {Number} userId 用户ID 
     * @param {String} action 执行的操作
     * @private
     */
    user_access_log = (userId, action) => {
        try {
            // 使用access日志记录用户操作
            if (this.logger && this.logger.access) {
                this.logger.access.info(`User ${userId} action: ${action}`);
            }
            
            // 同时在控制台显示
            if (this.logger && this.logger.default) {
                this.logger.default.debug(`User ${userId} action: ${action}`);
            }
        } catch (error) {
            console.error(`记录用户 ${userId} 操作日志失败:`, error);
        }
    };

    onAnswerChangePattern = async (ctx, chatId) => {
        let pattern = ctx.message.text;
        if (!pattern) {
            ctx.reply('请输入过滤规则正则表达式。', getHTMLOptions());
            return;
        }
        try {
            new RegExp(pattern);
            settings.setChatPattern(chatId, pattern);
            ctx.reply(`已成功为 id=${chatId} 频道设置了过滤规则：<code>${escapeHtml(pattern)}</code>`, getHTMLOptions());
            this.user_access_log(ctx.message.from.id, `Set chat id=${chatId} pattern to ${pattern}`);
            settings.clearUserState(ctx.message.from.id);
        } catch (e) {
            ctx.reply('设置失败，你输入的不是合法的正则表达式，错误：' + e);
        }
    };

    onAnswerChangeAdmin = async (ctx, chatId) => {
        const adminIds = ctx.message.text.split(/[,\s]+/)
            .map(id => Number(id))
            .filter(id => !isNaN(id) && id !== 0);
        
        if (adminIds.length === 0) {
            ctx.reply('请输入至少一个有效的管理员ID。输入的ID应为数字，可以用空格或逗号分隔。');
            return;
        }
        
        settings.setChatAdmin(chatId, adminIds);
        ctx.reply(`已成功为 id=${chatId} 频道设置了管理员：<code>${escapeHtml(adminIds.join(', '))}</code>`, { parse_mode: 'HTML' });
        this.user_access_log(ctx.message.from.id, `Set chat id=${chatId} admins to ${adminIds.join(', ')}`);
        settings.clearUserState(ctx.message.from.id);
    };

    onAnswerChangeBlockedUsers = async (ctx, stateData) => {
        const { targetChatId, chatId, messageId } = stateData;
        const [operation, src, uid] = ctx.message.text.split(' ');
        if (operation !== 'add' && operation !== 'del') {
            ctx.reply('不支持的屏蔽用户操作，如果你要进行其他操作请回复 /cancel');
            return;
        }
        if (!src || !uid) {
            ctx.reply('格式错误，请认真阅读修改说明。');
            return;
        }
        if (operation === 'add') {
            settings.addChatBlockedUsers(targetChatId, src + '_' + uid);
            ctx.reply('已成功添加屏蔽用户：' + src + '_' + uid);
            this.user_access_log(ctx.message.from.id, 'Blocked danmaku user: ' + src + '_' + uid);
        } else if (operation === 'del') {
            settings.removeChatBlockedUsers(targetChatId, src + '_' + uid);
            ctx.reply('已成功取消屏蔽用户：' + src + '_' + uid);
            this.user_access_log(ctx.message.from.id, 'Unblocked danmaku user: ' + src + '_' + uid);
        }
        await this.bot.telegram.editMessageText(
            chatId, messageId, undefined,
            this.getChangeBlockedUsersMessageText(targetChatId),
            {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML'
            });
    };

    onAnswerManageSchedules = async (ctx, stateData) => {
        const { targetChatId, chatId, messageId } = stateData;
        const [operation, ...args] = ctx.message.text.split(' ');
        if (operation !== 'add' && operation !== 'del' && operation !== 'clear') {
            ctx.reply('不支持的计划任务管理操作，如果你要进行其他操作请回复 /cancel');
            return;
        }
        const cronArgs = args.slice(0, 6);
        const expression = cronArgs.length === 0 ? '' : cronArgs.reduce((a, b) => `${a} ${b}`);
        if (operation === 'add') {
            if (cronArgs.length !== 6 || !this.chatsScheduler.validateExpression(expression)) {
                ctx.reply('这不是正确的 cron 时间表达式。', { reply_to_message_id: ctx.message.message_id });
                return;
            }
            const actions = args.slice(6);
            if (actions.length <= 0) {
                ctx.reply('请输入计划任务要执行的操作。', { reply_to_message_id: ctx.message.message_id });
                return;
            }
            const action = actions.reduce((a, b) => `${a} ${b}`);
            if (!this.chatsScheduler.validateAction(action)) {
                ctx.reply('这不是正确的操作，请检查语法是否正确。', { reply_to_message_id: ctx.message.message_id });
                return;
            }
            if (!settings.addChatSchedule(targetChatId, expression, action)) {
                ctx.reply('添加计划任务失败，请检查是否有相同的 cron 时间表达式。',
                    { reply_to_message_id: ctx.message.message_id });
                return;
            }
            this.chatsScheduler.addScheduler(targetChatId, expression, action);
            ctx.reply('添加计划任务 <code>' + escapeHtml(expression) + '</code> 成功。',
                { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id });
            this.user_access_log(ctx.message.from.id,
                `Add schedule: chatId=${chatId} expression=${expression} action=${action}`);
        } else if (operation === 'del') {
            if (cronArgs.length !== 6 || !this.chatsScheduler.validateExpression(expression)) {
                ctx.reply('这不是正确的 cron 时间表达式。', { reply_to_message_id: ctx.message.message_id });
                return;
            }
            if (!settings.removeChatSchedule(targetChatId, expression)) {
                ctx.reply('移除计划任务失败，请检查是否已添加这个 cron 时间表达式',
                    { reply_to_message_id: ctx.message.message_id });
                return;
            }
            this.chatsScheduler.removeScheduler(targetChatId, expression);
            ctx.reply('移除计划任务 <code>' + escapeHtml(expression) + '</code> 成功。',
                { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id });
            this.user_access_log(ctx.message.from.id,
                `Remove schedule: chatId=${chatId} expression=${expression}`);
        } else if (operation === 'clear') {
            this.chatsScheduler.clearSchedulersForChat(targetChatId);
            settings.setChatSchedules(targetChatId, []);
            ctx.reply('已清除所有计划任务。', { reply_to_message_id: ctx.message.message_id });
            this.user_access_log(ctx.message.from.id,
                `Clear schedules: chatId=${chatId}`);
        }
        await this.bot.telegram.editMessageText(
            chatId, messageId, undefined,
            this.getManageSchedulesMessageText(targetChatId),
            { parse_mode: 'HTML' }
        );
    };

    getChangeBlockedUsersMessageText = (chatId) => {
        let blockedUsers = settings.getChatBlockedUsers(chatId)
            .map(({src, uid}) => src + '_' + uid);
        if (blockedUsers.length > 0) {
            blockedUsers = blockedUsers.reduce((t, next) => t + ', ' + next);
        } else {
            blockedUsers = '空';
        }
        return '你正在编辑 id=' + chatId + ' 的屏蔽用户列表，' +
            '被屏蔽的用户弹幕不会被转发到对话中。\n' +
            '输入 <code>add [弹幕源] [用户id]</code> 可以添加屏蔽用户，输入 <code>del [弹幕源] [用户id]</code> 可以解除屏蔽用户。' +
            '例如：输入 <code>add bilibili 100</code> 可以屏蔽 bilibili 弹幕源 id 为 100 的用户。\n\n' +
            '当前已被屏蔽的用户：\n<code>' + escapeHtml(blockedUsers) + '</code>\n' +
            '回复 /cancel 完成屏蔽修改并退出互动式对话。';
    };

    getManageSchedulesMessageText = (chatId) => {
        let schedules = settings.getChatSchedules(chatId)
            .map(({expression, action}) => '<code>' + escapeHtml(expression) + ' ' + escapeHtml(action) + '</code>');
        if (schedules.length > 0) {
            schedules = schedules.reduce((t, next) => t + '\n' + next);
        } else {
            schedules = '空';
        }
        return '你正在编辑 id=' + chatId + ' 的计划任务列表，' +
            '计划任务的时间格式使用 cron 时间表达式，同一个 cron 时间表达式只能设置一个任务，' +
            '你可以相隔一秒设置不同的任务。任务命令可以参考：https://danmaqua.github.io/bot/scheduler_usage.html\n' +
            '输入 <code>add [cron 时间表达式] [任务命令]</code> 可以添加计划任务\n' +
            '输入 <code>del [cron 时间表达式]</code> 可以删除对应时间的任务。\n' +
            '输入 <code>clear</code> 可以清除所有计划任务且不可恢复。\n' +
            '当前已安排的任务计划：\n' + schedules + '\n' +
            '回复 /cancel 完成修改并退出互动式对话。';
    };

    onCommandCancel = async (ctx) => {
        const code = settings.getUserStateCode(ctx.message.from.id);
        if (code < 0) {
            ctx.reply('你没有取消任何操作。');
            return;
        }
        settings.clearUserState(ctx.message.from.id);
        ctx.reply('已取消互动式操作。');
    };

    onCommandSetDefaultPattern = async (ctx) => {
        let [_, pattern] = ctx.message.text.split(' ');
        if (!pattern) {
            ctx.reply('请输入要设置的默认过滤规则。', { parse_mode: 'HTML' });
            return;
        }
        try {
            new RegExp(pattern);
            settings.setGlobalPattern(pattern);
            ctx.reply('成功设置默认过滤规则为：<code>' + escapeHtml(pattern) + '</code>', { parse_mode: 'HTML' });
            this.user_access_log(ctx.message.from.id, 'Set default pattern to ' + pattern);
        } catch (e) {
            ctx.reply('设置默认过滤规则失败，错误原因：' + e);
        }
    };

    onCommandSetDefaultAdmins = async (ctx) => {
        const admins = ctx.message.text.split(' ')
            .slice(1)
            .map((value) => Number(value))
            .filter((value) => !isNaN(value));
        settings.setGlobalAdmin(admins);
        ctx.reply('已设置默认管理员为 <code>' + escapeHtml(admins.toString()) + '</code>', { parse_mode: 'HTML' });
        this.user_access_log(ctx.message.from.id, 'Set default admin to ' + admins.toString());
    };

    onCommandSetDefaultSource = async (ctx) => {
        let [_, newSrc] = ctx.message.text.split(' ');
        if (!newSrc) {
            ctx.reply('请输入一个弹幕源 id，要查询 Bot 支持哪些弹幕源可以输入 /list_dm_src');
            return;
        }
        if (settings.danmakuSources.find((value) => value.id === newSrc)) {
            settings.setGlobalDanmakuSource(newSrc);
            ctx.reply('成功设置默认弹幕源为 ' + newSrc);
            this.user_access_log(ctx.message.from.id, 'Set default danmaku source to ' + newSrc);
        } else {
            ctx.reply('无法找到弹幕源 id=' + newSrc);
        }
    };

    onCommandStatUsers = async (ctx) => {
        if (!this.statistics || !this.statistics.enabled) {
            ctx.reply('Bot 统计功能已关闭，请联系 Bot 管理员。');
            return;
        }
        const users = await this.statistics.getUsers();
        if (!users || users.length === 0) {
            ctx.reply('暂未有任何发送过同传弹幕的用户统计信息。');
            return;
        }
        const usersText = users.reduce((a, b) => `${a}, ${b}`);
        ctx.reply('已统计同传弹幕发送信息的用户：\n<code>' + escapeHtml(usersText) + '</code>', { parse_mode: 'HTML' });
    };

    onCommandStatUserQuery = async (ctx) => {
        if (!this.statistics || !this.statistics.enabled) {
            ctx.reply('Bot 统计功能已关闭，请联系 Bot 管理员。');
            return;
        }
        const [_, userId] = ctx.message.text.split(' ');
        if (!userId || userId.indexOf('_') < 0) {
            ctx.reply('用户 ID 参数不正确，请检查格式是否正确。');
            return;
        }
        const sentences = await this.statistics.countSentencesByUserId(userId);
        const words = await this.statistics.countWordsByUserId(userId);
        ctx.reply(`用户 ${userId} 统计信息：\n已同传的弹幕数量：${sentences}\n已同传的字数：${words}`);
    };

    /**
     * 命令：列出所有支持的弹幕源
     */
    onCommandListDMSrc = async (ctx) => {
        try {
            const sources = settings.danmakuSources;
            if (!sources || sources.length === 0) {
                ctx.reply('目前没有配置任何弹幕源。');
                return;
            }

            let messageText = '<b>支持的弹幕源列表：</b>\n\n';
            
            for (const source of sources) {
                messageText += `<b>ID:</b> <code>${source.id}</code>\n`;
                messageText += `<b>描述:</b> ${source.description}\n`;
                messageText += `<b>类型:</b> ${source.type}\n\n`;
            }
            
            messageText += '使用 <code>/register_chat</code> 命令时可以指定这些弹幕源ID。';
            
            await ctx.reply(messageText, { parse_mode: 'HTML' });
            this.user_access_log(ctx.message.from.id, 'Listed danmaku sources');
        } catch (error) {
            this.logger.default.error('获取弹幕源列表失败:', error);
            ctx.reply('获取弹幕源列表时出错，请稍后再试。');
        }
    };

    // 添加对查看统计的处理
    onActionStatisticsByChat = async (ctx) => {
        const targetChatId = parseInt(ctx.match[1]);
        
        if (!this.statistics || !this.statistics.enabled) {
            ctx.reply('Bot 统计功能已关闭，请联系 Bot 管理员。');
            return await this.safeAnswerCbQuery(ctx);
        }
        
        const config = settings.getChatConfig(targetChatId);
        const roomId = config.roomId;
        const src = config.danmakuSource;
        const roomIdWithSrc = src + '_' + roomId;

        try {
            const sentences = await this.statistics.countSentencesByRoomId(roomIdWithSrc);
            const words = await this.statistics.countWordsByRoomId(roomIdWithSrc);

            ctx.reply('频道 ID=' + targetChatId + ' 的统计信息：\n' +
                '连接的弹幕源与房间 ID：<code>' + roomIdWithSrc + '</code>\n' +
                '已同传的弹幕数：' + sentences + '\n' +
                '已同传的字数：' + words, { parse_mode: 'HTML' });
        } catch (error) {
            ctx.reply('获取统计信息失败：' + error.message);
            this.logger.default.error('获取统计信息失败：', error);
        }
        
        return await this.safeAnswerCbQuery(ctx);
    };

    // 添加选择弹幕源的回调处理
    onActionSelectDanmakuSrc = async (ctx) => {
        const targetChatId = parseInt(ctx.match[1]);
        const srcId = ctx.match[2];
        const currentConfig = settings.getChatConfig(targetChatId);
        
        // 设置用户状态，指示已选择弹幕源，等待输入房间号
        settings.setUserState(ctx.update.callback_query.from.id,
            USER_STATE_CODE_CHAT_CHANGE_DANMAKU_SRC,
            { targetChatId, selectedSource: srcId });
        
        // 提示用户输入房间号
        const replyText = `你已选择 <b>${srcId}</b> 作为弹幕源\n\n` +
            `当前房间号：<code>${currentConfig.roomId}</code>\n\n` +
            `请直接回复新的房间号（纯数字），或回复 /cancel 取消操作。`;
            
        ctx.reply(replyText, { parse_mode: 'HTML' });
        return await this.safeAnswerCbQuery(ctx);
    };

    // 处理内联查询
    onInlineQuery = async (ctx) => {
        const query = ctx.inlineQuery.query.trim();
        const userId = ctx.inlineQuery.from.id;
        
        // 检查用户权限
        if (!this.hasUserPermissionForBot(userId)) {
            await ctx.answerInlineQuery([], {
                cache_time: 5,
                switch_pm_text: '您没有权限使用内联查询功能',
                switch_pm_parameter: 'auth'
            });
            return;
        }

        try {
            // 获取用户管理的频道列表
            const managedChats = this.getManagedChatsConfig(userId);
            const results = [];

            if (query.length === 0) {
                // 如果查询为空，显示所有管理的频道
                for (const chatId in managedChats) {
                    const chatConfig = managedChats[chatId];
                    const chatInfo = await this.getChat(chatId);
                    const chatTitle = chatInfo ? chatInfo.title : chatId;
                    
                    results.push({
                        type: 'article',
                        id: chatId,
                        title: chatTitle,
                        description: `房间ID: ${chatConfig.roomId}, 弹幕源: ${chatConfig.danmakuSource}`,
                        input_message_content: {
                            message_text: `<b>${escapeHtml(chatTitle)}</b>\n房间ID: <code>${chatConfig.roomId}</code>\n弹幕源: <code>${chatConfig.danmakuSource}</code>`,
                            parse_mode: 'HTML'
                        },
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '管理配置', callback_data: `manage_chat:${chatId}` },
                                    { text: '重连房间', callback_data: `reconnect_room:${chatId}` }
                                ]
                            ]
                        }
                    });
                }
            } else {
                // 根据查询内容过滤频道
                for (const chatId in managedChats) {
                    const chatConfig = managedChats[chatId];
                    const chatInfo = await this.getChat(chatId);
                    const chatTitle = chatInfo ? chatInfo.title : chatId;
                    
                    // 如果频道标题、房间ID或弹幕源包含查询内容，则添加到结果中
                    if (chatTitle.toLowerCase().includes(query.toLowerCase()) || 
                        chatConfig.roomId.toString().includes(query) || 
                        chatConfig.danmakuSource.includes(query)) {
                        
                        results.push({
                            type: 'article',
                            id: chatId,
                            title: chatTitle,
                            description: `房间ID: ${chatConfig.roomId}, 弹幕源: ${chatConfig.danmakuSource}`,
                            input_message_content: {
                                message_text: `<b>${escapeHtml(chatTitle)}</b>\n房间ID: <code>${chatConfig.roomId}</code>\n弹幕源: <code>${chatConfig.danmakuSource}</code>`,
                                parse_mode: 'HTML'
                            },
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '管理配置', callback_data: `manage_chat:${chatId}` },
                                        { text: '重连房间', callback_data: `reconnect_room:${chatId}` }
                                    ]
                                ]
                            }
                        });
                    }
                }
            }

            // 如果没有结果，显示提示
            if (results.length === 0) {
                results.push({
                    type: 'article',
                    id: 'no_results',
                    title: '没有找到匹配的频道',
                    description: '尝试使用不同的搜索词，或清空查询查看所有频道',
                    input_message_content: {
                        message_text: '没有找到匹配的频道，请尝试使用不同的搜索词，或清空查询查看所有频道。'
                    }
                });
            }

            // 返回结果，最多返回50个
            await ctx.answerInlineQuery(results.slice(0, 50), {
                cache_time: 10,
                switch_pm_text: '管理频道',
                switch_pm_parameter: 'manage'
            });
        } catch (error) {
            this.logger.default.error('内联查询处理错误：', error);
            await ctx.answerInlineQuery([], {
                cache_time: 5,
                switch_pm_text: '发生错误，请重试',
                switch_pm_parameter: 'error'
            });
        }
    };
}

// 添加HTML转义函数
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

module.exports = DanmaquaBot;
