const settings = require('./util/settings');
const { Telegraf, Markup, Extra } = require('telegraf');

// 用户状态常量
const USER_STATE_CODE_CHAT_CHANGE_ADMIN = 3; // 'chat_change_admin';
const USER_STATE_CODE_CHAT_CHANGE_PATTERN = 2; // 'chat_change_pattern';
const USER_STATE_CODE_CHAT_CHANGE_BLOCK_USERS = 4; // 'chat_blocked_users';
const USER_STATE_CODE_CHAT_MANAGE_SCHEDULES = 5; // 'chat_manage_schedules';
const USER_STATE_CODE_CHAT_CHANGE_DANMAKU_SRC = 1; // 'chat_change_danmaku_src';

class BotWrapper {
    constructor({ botConfig, botToken, agent, logger }) {
        this.botConfig = botConfig;
        this.apiEndpoints = [
            'https://tgapi.chenguaself.tk',
            'https://api-proxy.me/telegram',
            'https://api.telegram.org'
        ];
        this.currentApiIndex = 0;
        
        // 使用默认API端点创建机器人
        this.createBot(botToken, agent);
        this.botUser = null;
        this.logger = logger;
        this.commandRecords = [];
        this.startCommandSimpleMessage = '欢迎使用弹幕姬 Bot！\n输入 /help 查看使用方法。';
        this.helpCommandMessageHeader = '这是一个用于转发直播弹幕的 Bot。';
        this.statistics = null; // 需要外部设置

        this.bot.catch((e) => {
            this.logger.default.error(e);
        });
        
        // 注册所有命令
        this.bot.start(this.onCommandStart);
        this.bot.command('help', this.onCommandHelp);
        this.bot.command('register_chat', this.onCommandRegisterChat);
        this.bot.command('unregister_chat', this.onCommandUnregisterChat);
        this.bot.command('manage_chats', this.onCommandManageChats);
        this.bot.command('list_dmsrc', this.onCommandListDMSrc);
        this.bot.command('set_default_pattern', this.onCommandSetDefaultPattern);
        this.bot.command('cancel', this.onCommandCancel);
        
        // 注册消息处理
        this.bot.on('message', this.onMessage);
        
        // 注册回调查询处理
        this.bot.on('callback_query', this.onCallbackQuery);
        
        this.logger.default.info('Bot命令已全部注册');
    }

    createBot(botToken, agent) {
        this.bot = new Telegraf(botToken, { 
            telegram: { 
                agent,
                apiRoot: this.apiEndpoints[this.currentApiIndex]
            } 
        });
    }

    switchToNextApi(botToken, agent) {
        this.currentApiIndex = (this.currentApiIndex + 1) % this.apiEndpoints.length;
        this.logger.default.info(`切换到API端点: ${this.apiEndpoints[this.currentApiIndex]}`);
        this.createBot(botToken, agent);
    }

    // 尝试所有API端点的通用方法
    async tryWithAllEndpoints(callback) {
        for (let i = 0; i < this.apiEndpoints.length; i++) {
            try {
                const apiRoot = this.apiEndpoints[i];
                this.bot.telegram.options.apiRoot = apiRoot;
                return await callback();
            } catch (e) {
                this.logger.default.error(`API端点 ${this.apiEndpoints[i]} 请求失败: ${e}`);
                // 如果是最后一个端点仍然失败，则抛出异常
                if (i === this.apiEndpoints.length - 1) throw e;
            }
        }
    }

    user_access_log(userId, out) {
        this.logger.access.debug(`UserId=${userId} ${out}`);
    }

    start = async () => {
        this.logger.default.info('Launcher: Bot is launching...');
        let retryCount = 0;
        const maxRetries = this.apiEndpoints.length * 2; // 每个端点尝试两次

        while (!this.botUser && retryCount < maxRetries) {
            try {
                this.botUser = await this.bot.telegram.getMe();
            } catch (e) {
                console.error(e);
                this.logger.default.error(`无法连接到 ${this.apiEndpoints[this.currentApiIndex]}`);
                this.switchToNextApi(this.botConfig.botToken, this.botConfig.agent);
                retryCount++;
            }
        }

        if (!this.botUser) {
            throw new Error('无法连接到任何 Telegram API 端点');
        }

        return await this.bot.launch();
    };

    getChat = async (chatId) => {
        try {
            return await this.tryWithAllEndpoints(async () => {
                return await this.bot.telegram.getChat(chatId);
            });
        } catch (e) {
            return null;
        }
    };

    hasUserPermissionForBot = (id) => {
        return this.botConfig.botAdmins.indexOf(id) !== -1;
    };

    hasPermissionForChat = (id, chatId) => {
        return this.hasUserPermissionForBot(id) || settings.getChatConfig(chatId).admin.indexOf(id) !== -1;
    };

    canSendMessageToChat = async (chatId) => {
        try {
            let member = await this.tryWithAllEndpoints(async () => {
                return await this.bot.telegram.getChatMember(chatId, this.botUser.id);
            });
            return member.status === 'member' || member.status === 'administrator' || member.status === 'creator';
        } catch (ignored) {
        }
        return false;
    };

    checkUserPermissionForBot = async (ctx, next) => {
        if (!this.hasUserPermissionForBot(ctx.message.from.id)) {
            ctx.reply('你不是这个 Bot 的管理员。');
            return;
        }
        await next();
    };

    checkUserPermissionForChat = (chatId) => {
        return async (ctx, next) => {
            if (!this.hasPermissionForChat(ctx.message.from.id, chatId)) {
                ctx.reply('你不是这个对话的管理员。');
                return;
            }
            await next();
        };
    };

    addCommand({
                   command,
                   title,
                   description,
                   help,
                   botAdminOnly = false,
                   callback
    }) {
        if (!command) {
            throw new Error('command cannot be empty');
        }
        if (!title) {
            throw new Error('title cannot be empty');
        }
        if (!description) {
            throw new Error('description cannot be empty');
        }
        if (!help) {
            throw new Error('help cannot be empty');
        }
        if (this.commandRecords.find((record) => record.command === command)) {
            throw new Error(`command "${command}" has been added`);
        }
        this.commandRecords.push({
            command,
            title,
            description,
            help,
            botAdminOnly,
        });
        if (botAdminOnly) {
            this.bot.command(command, this.checkUserPermissionForBot, (ctx) => {
                try {
                    callback(ctx);
                } catch (e) {
                    this.logger.default.error(e);
                }
            });
        } else {
            this.bot.command(command, (ctx) => {
                try {
                    callback(ctx);
                } catch (e) {
                    this.logger.default.error(e);
                }
            });
        }
    }

    addCommands(commands) {
        commands.forEach((item) => this.addCommand(item));
    }

    addActions(actions) {
        for (let [triggers, callback] of actions) {
            this.bot.action(triggers, async (ctx) => {
                try {
                    await callback(ctx);
                } catch (e) {
                    this.logger.default.error(e);
                }
            });
        }
    }

    onMessage = async (ctx) => {
        // 首先检查是否是命令，如果是命令则不处理状态
        if (ctx.message.text && ctx.message.text.startsWith('/')) {
            // 如果是命令，跳过状态处理
            return;
        }
        
        // 处理转发消息
        if (ctx.message.forward_from_chat) {
            return this.onForwardMessageFromChat(ctx);
        }

        // 处理用户状态
        const userId = ctx.message.from.id;
        const stateCode = settings.getUserStateCode(userId);
        const stateData = settings.getUserStateData(userId);
        if (stateCode === null || stateCode === undefined || stateCode === -1) return;

        this.logger.default.debug(`处理用户${userId}的状态: stateCode=${stateCode}, stateData=${stateData}`);
        
        switch (stateCode) {
            case USER_STATE_CODE_CHAT_CHANGE_PATTERN:
                return this.onAnswerChangePattern(ctx, stateData);
            case USER_STATE_CODE_CHAT_CHANGE_ADMIN:
                return this.onAnswerChangeAdmin(ctx, stateData);
            case USER_STATE_CODE_CHAT_CHANGE_BLOCK_USERS:
                return this.onAnswerChangeBlockedUsers(ctx, stateData);
            case USER_STATE_CODE_CHAT_MANAGE_SCHEDULES:
                return this.onAnswerManageSchedules(ctx, stateData);
            case USER_STATE_CODE_CHAT_CHANGE_DANMAKU_SRC:
                return this.onAnswerChangeDanmakuSrc(ctx, stateData);
            default:
                // 未知状态，清除
                this.logger.default.warn(`未知的用户状态: ${stateCode}，已清除`);
                settings.clearUserState(userId);
                return;
        }
    };

    onCommandStart = async (ctx) => {
        return ctx.reply(this.startCommandSimpleMessage, Extra.markdown());
    };

    onCommandHelp = async (ctx) => {
        let [_, commandName] = ctx.message.text.split(' ');
        if (commandName) {
            const rec = this.commandRecords.find((record) => record.command === commandName);
            if (!rec) {
                return ctx.reply(`无法找到命令：${commandName}`);
            } else {
                let res = '命令 /' + rec.command.replace(/_/g, '\\_');
                res += ' 的帮助说明：\n' + rec.help;
                return ctx.reply(res, Extra.markdown());
            }
        }
        let res = this.helpCommandMessageHeader + '\n';
        res += '支持的命令：\n';
        for (let command of this.commandRecords) {
            res += '/' + command.command.replace(/_/g, '\\_') +
                ' : **' + command.title + '**' +
                ' - ' + command.description + '\n';
        }
        if (this.commandRecords.length < 1) {
            res += '没有公开的命令。\n';
        }
        res += '\n输入 `/help [command]` 可以查询你想了解的命令的使用方法和参数。';
        return ctx.reply(res, Extra.markdown());
    }

    onCommandRegisterChat = async (ctx) => {
        let [_, chatId, roomId, source] = ctx.message.text.split(' ');
        if (!chatId || !roomId) {
            ctx.reply('注册命令使用方法：/register\\_chat `chatId` `roomId` `[source]`', { parse_mode: 'Markdown' });
            return;
        }
        
        chatId = parseInt(chatId);
        if (isNaN(chatId)) {
            ctx.reply('聊天ID必须是一个数字');
            return;
        }
        
        if (!source) {
            source = 'bilibili';
        }
        
        // 检查弹幕源是否支持
        const srcSupported = settings.danmakuSources.find(src => src.id === source);
        if (!srcSupported) {
            ctx.reply('不支持的弹幕源：' + source + '\n请使用 /list\\_dmsrc 查看支持的弹幕源。');
            return;
        }
        
        // 检查用户权限
        if (!this.hasUserPermissionForBot(ctx.message.from.id)) {
            ctx.reply('只有 Bot 管理员可以注册对话。');
            return;
        }
        
        // 检查对话存在性
        const chat = await this.getChat(chatId);
        if (!chat) {
            ctx.reply('无法获取对话信息，请确认 Bot 已加入该对话并且对话 ID 正确。');
            return;
        }
        
        // 检查是否可以发送消息
        const canSend = await this.canSendMessageToChat(chatId);
        if (!canSend) {
            ctx.reply('Bot 无法向该对话发送消息，请确认 Bot 在该对话中拥有发言权限。');
            return;
        }
        
        // 注册对话
        settings.registerChat({
            chatId: chatId,
            roomId: roomId,
            danmakuSource: source,
            admin: [ctx.message.from.id],
            pattern: settings.getGlobalPattern(),
            blockedUsers: []
        });
        
        ctx.reply('成功注册对话：\n' +
            'ID: `' + chatId + '`\n' +
            '房间号: `' + roomId + '`\n' +
            '弹幕源: `' + source + '`\n\n' +
            '你可以使用 /manage\\_chats 命令来管理这个对话。', { parse_mode: 'Markdown' });
        
        this.user_access_log(ctx.message.from.id, `Registered chat=${chatId} room=${roomId} source=${source}`);
    }

    onCommandUnregisterChat = async (ctx) => {
        let [_, chatId] = ctx.message.text.split(' ');
        if (!chatId) {
            ctx.reply('取消注册命令使用方法：/unregister\\_chat `chatId`', { parse_mode: 'Markdown' });
            return;
        }
        
        chatId = parseInt(chatId);
        if (isNaN(chatId)) {
            ctx.reply('聊天ID必须是一个数字');
            return;
        }
        
        // 检查用户权限
        if (!this.hasUserPermissionForBot(ctx.message.from.id)) {
            ctx.reply('只有 Bot 管理员可以取消注册对话。');
            return;
        }
        
        // 检查对话是否已注册
        if (!settings.getChatConfig(chatId)) {
            ctx.reply('该对话未注册。');
            return;
        }
        
        this.requestUnregisterChat(ctx, chatId);
    }

    onCommandManageChats = async (ctx) => {
        const userId = ctx.message.from.id;
        this.logger.default.debug(`用户 ${userId} 请求管理聊天，开始创建键盘...`);
        
        // 清除用户的任何现有状态，防止状态冲突
        if (settings.getUserStateCode(userId) !== null) {
            this.logger.default.debug(`清除用户 ${userId} 的现有状态: ${settings.getUserStateCode(userId)}`);
            settings.clearUserState(userId);
        }
        
        try {
            // 获取用户可管理的聊天数量
            const chatsCount = this.getManagedChatsCount(userId);
            this.logger.default.debug(`用户 ${userId} 有 ${chatsCount} 个可管理的聊天`);
            
            if (chatsCount === 0) {
                return ctx.reply('你没有可以管理的频道。');
            }
            
            const keyboard = await this.createManageChatsMessageKeyboard(userId, 0);
            this.logger.default.debug('键盘创建成功，准备发送响应...');
            return await ctx.reply(
                '请选择你要管理的频道：\n如果你要找的频道没有显示，可能是你的账号没有权限。',
                { reply_markup: keyboard }
            );
        } catch (error) {
            this.logger.default.error(`创建管理聊天键盘时出错: ${error.stack || error.message || error}`);
            return ctx.reply('抱歉，获取聊天列表时出现错误，请稍后再试。');
        }
    }

    onCommandListDMSrc = async (ctx) => {
        let msgText = 'Bot 支持的弹幕源：\n';
        for (let src of settings.danmakuSources) {
            msgText += '- `' + src.id + '` : ' + src.description + '\n';
        }
        ctx.reply(msgText, { parse_mode: 'Markdown' });
    }

    onCommandSetDefaultPattern = async (ctx) => {
        let [_, pattern] = ctx.message.text.split(' ');
        if (!pattern) {
            ctx.reply('请输入要设置的默认过滤规则。', { parse_mode: 'Markdown' });
            return;
        }
        try {
            new RegExp(pattern);
            settings.setGlobalPattern(pattern);
            ctx.reply('成功设置默认过滤规则为：`' + pattern + '`', { parse_mode: 'Markdown' });
            this.user_access_log(ctx.message.from.id, 'Set default pattern to ' + pattern);
        } catch (e) {
            ctx.reply('设置默认过滤规则失败，错误原因：' + e);
        }
    }

    onCommandSetDefaultAdmins = async (ctx) => {
        const admins = ctx.message.text.split(' ')
            .slice(1)
            .map((value) => Number(value))
            .filter((value) => !isNaN(value));
        settings.setGlobalAdmin(admins);
        ctx.reply('已设置默认管理员为 `' + admins.toString() + '`', { parse_mode: 'Markdown' });
        this.user_access_log(ctx.message.from.id, 'Set default admin to ' + admins.toString());
    }

    onAnswerChangePattern = async (ctx, chatId) => {
        let pattern = ctx.message.text;
        if (!pattern) {
            ctx.reply('请输入过滤规则正则表达式。', { parse_mode: 'Markdown' });
            return;
        }
        try {
            new RegExp(pattern);
            settings.setChatPattern(chatId, pattern);
            ctx.reply(`已成功为 id=${chatId} 频道设置了过滤规则：\`${pattern}\``, { parse_mode: 'Markdown' });
            this.user_access_log(ctx.message.from.id, `Set chat id=${chatId} pattern to ${pattern}`);
            settings.clearUserState(ctx.message.from.id);
        } catch (e) {
            ctx.reply('设置失败，你输入的不是合法的正则表达式，错误：' + e);
        }
    };

    onAnswerChangeAdmin = async (ctx, chatId) => {
        const admins = ctx.message.text.split(' ')
            .map((value) => Number(value))
            .filter((value) => !isNaN(value));
        settings.setChatAdmin(chatId, admins);
        ctx.reply(`已成功为 id=${chatId} 频道设置了管理员：\`${admins}\``, { parse_mode: 'Markdown' });
        this.user_access_log(ctx.message.from.id, `Set chat id=${chatId} admin to ${admins}`);
        settings.clearUserState(ctx.message.from.id);
    };

    onAnswerChangeBlockedUsers = async (ctx, { targetChatId, chatId, messageId }) => {
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
        
        if (chatId && messageId) {
            await this.tryWithAllEndpoints(async () => {
                return await this.bot.telegram.editMessageText(
                    chatId, messageId, undefined,
                    this.getChangeBlockedUsersMessageText(targetChatId),
                    { parse_mode: 'Markdown' }
                );
            });
        }
    };

    getChangeBlockedUsersMessageText(chatId) {
        const config = settings.getChatConfig(chatId);
        let text = `id=${chatId} 频道当前屏蔽用户列表：\n`;
        if (!config.blockedUsers || config.blockedUsers.length === 0) {
            text += '没有屏蔽任何用户\n\n';
        } else {
            for (let i = 0; i < config.blockedUsers.length; i++) {
                text += `${i+1}. \`${config.blockedUsers[i]}\`\n`;
            }
            text += '\n';
        }
        text += '要添加或删除屏蔽用户，请回复以下格式的消息：\n' +
            'add 弹幕源ID 用户ID\n' +
            'del 弹幕源ID 用户ID\n\n' +
            '例如：\n' +
            'add bilibili 12345678\n' +
            'del bilibili 12345678\n\n' +
            '回复 /cancel 退出互动式对话。';
        return text;
    }

    onAnswerManageSchedules = async (ctx, { targetChatId, chatId, messageId }) => {
        if (!this.chatsScheduler) {
            ctx.reply('计划任务管理器未初始化');
            return;
        }
        
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
            ctx.reply('添加计划任务 `' + expression + '` 成功。',
                { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
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
            ctx.reply('移除计划任务 `' + expression + '` 成功。',
                { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
            this.user_access_log(ctx.message.from.id,
                `Remove schedule: chatId=${chatId} expression=${expression}`);
        } else if (operation === 'clear') {
            this.chatsScheduler.clearSchedulersForChat(targetChatId);
            settings.setChatSchedules(targetChatId, []);
            ctx.reply('已清除所有计划任务。', { reply_to_message_id: ctx.message.message_id });
            this.user_access_log(ctx.message.from.id,
                `Clear schedules: chatId=${chatId}`);
        }
        
        if (chatId && messageId) {
            await this.tryWithAllEndpoints(async () => {
                return await this.bot.telegram.editMessageText(
                    chatId, messageId, undefined,
                    this.getManageSchedulesMessageText(targetChatId),
                    { parse_mode: 'Markdown' }
                );
            });
        }
    };

    getManageSchedulesMessageText(chatId) {
        const config = settings.getChatConfig(chatId);
        let text = `id=${chatId} 频道当前计划任务列表：\n`;
        if (!config.schedules || config.schedules.length === 0) {
            text += '没有设置任何计划任务\n\n';
        } else {
            for (let i = 0; i < config.schedules.length; i++) {
                text += `${i+1}. \`${config.schedules[i].expression}\` : ${config.schedules[i].action}\n`;
            }
            text += '\n';
        }
        text += '要添加或删除计划任务，请回复以下格式的消息：\n' +
            'add 秒 分 时 日 月 周 操作\n' +
            'del 秒 分 时 日 月 周\n' +
            'clear (清除所有计划任务)\n\n' +
            '例如：\n' +
            'add 0 0 12 * * * 发送消息 今天中午12点啦\n' +
            'del 0 0 12 * * *\n\n' +
            '回复 /cancel 退出互动式对话。';
        return text;
    }

    getManagedChats(userId) {
        return settings.getAllRegisteredChats().filter(chat => 
            this.hasPermissionForChat(userId, chat.chatId)
        );
    }

    getManagedChatsPageCount(userId) {
        return Math.ceil(this.getManagedChats(userId).length / 10);
    }

    getManagedChatsConfigByPage(userId, page) {
        const pageSize = 10;
        const allChats = this.getManagedChats(userId);
        const startIndex = page * pageSize;
        const endIndex = Math.min(startIndex + pageSize, allChats.length);
        return allChats.slice(startIndex, endIndex);
    }

    // 添加bot-core.js中的方法以确保兼容性
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

    createManageChatsMessageKeyboard = async (userId, page) => {
        const buttons = [];
        for (let cfg of this.getManagedChatsConfigByPage(userId, page)) {
            const chat = await this.getChat(cfg.chatId);
            let displayName = '' + cfg.chatId;
            if (chat) {
                if (chat.title && !chat.username) {
                    displayName = chat.title;
                } else if (!chat.title && chat.username) {
                    displayName = '@' + chat.username;
                } else if (chat.title && chat.username) {
                    displayName = chat.title + ' (@' + chat.username + ')';
                }
            }
            buttons.push([Markup.button.callback(displayName, 'manage_chat:' + cfg.chatId)]);
        }
        const pageButtons = [];
        const pageCount = this.getManagedChatsPageCount(userId);
        pageButtons.push(Markup.button.callback('第' + (page+1) + '/' + pageCount + '页', 'noop'));
        if (page > 0) {
            pageButtons.push(Markup.button.callback('上一页', 'manage_chats_pages:' + (page - 1)));
        }
        if (page < pageCount - 1) {
            pageButtons.push(Markup.button.callback('下一页', 'manage_chats_pages:' + (page + 1)))
        }
        if (pageButtons.length > 1) {
            buttons.push(pageButtons);
        }
        return Markup.inlineKeyboard(buttons);
    };

    requestUnregisterChat = async (ctx, chatId) => {
        ctx.reply('你确定要取消注册对话 id=' + chatId + ' 吗？所有该对话的设置都会被清除且无法恢复。',
            { reply_markup: Markup.inlineKeyboard([
                Markup.button.callback('是的，我不后悔', 'confirm_unregister_chat:' + chatId)
            ])});
    };

    onForwardMessageFromChat = async (ctx) => {
        const chatId = ctx.message.forward_from_chat.id;
        if (!ctx.message.text || ctx.message.chat.type !== 'private') {
            return;
        }
        if (!this.hasPermissionForChat(ctx.message.from.id, chatId)) {
            ctx.reply('你没有这个对话的管理权限。');
            return;
        }
        if (!settings.getChatConfig(chatId)) {
            ctx.reply('这个对话没有在 Bot 注册。');
            return;
        }
        let username = null;
        let uid = 0;
        if (ctx.message.entities && ctx.message.entities.length === 1) {
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
            return;
        }

        const keyboard = Markup.inlineKeyboard([
            Markup.button.callback(
                `屏蔽用户：${username}（${uid}）`,
                `block_user:${chatId}:${uid}`
            )
        ]);

        ctx.reply('你要对这条弹幕进行什么操作：', {
            reply_to_message_id: ctx.message.message_id,
            reply_markup: keyboard
        });
    };

    onActionChangeAdmin = async (ctx) => {
        if (!this.hasUserPermissionForBot(ctx.update.callback_query.from.id)) {
            return await ctx.answerCbQuery('很抱歉，这项操作只有 Bot 管理员可以使用。', true);
        }
        const targetChatId = parseInt(ctx.match[1]);
        settings.setUserState(ctx.update.callback_query.from.id,
            USER_STATE_CODE_CHAT_CHANGE_ADMIN,
            targetChatId);
        ctx.reply('你正在编辑 id=' + targetChatId + ' 的管理员列表，' +
            '管理员可以对该频道修改\n\n' +
            '当前设置：`' + settings.getChatConfig(targetChatId).admin + '`\n' +
            '回复 /cancel 退出互动式对话。', { parse_mode: 'Markdown' });
        return await ctx.answerCbQuery();
    };

    onActionStatisticsByChat = async (ctx) => {
        if (!this.statistics || !this.statistics.enabled) {
            return await ctx.answerCbQuery('统计功能未启用', true);
        }
        
        const targetChatId = parseInt(ctx.match[1]);
        const config = settings.getChatConfig(targetChatId);
        const roomId = config.roomId;
        const src = config.danmakuSource;
        const roomIdWithSrc = src + '_' + roomId;

        const sentences = await this.statistics.countSentencesByRoomId(roomIdWithSrc);
        const words = await this.statistics.countWordsByRoomId(roomIdWithSrc);

        ctx.reply('对话 ID=' + targetChatId + ' 的统计信息（目前仅支持统计实际连接的房间，不区分对话）：\n' +
            '连接的弹幕源与房间 ID：`' + roomIdWithSrc + '`\n' +
            '已同传的弹幕数：' + sentences + '\n' +
            '已同传的字数：' + words, { parse_mode: 'Markdown' });

        return await ctx.answerCbQuery();
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
        ctx.reply('已统计同传弹幕发送信息的用户：\n`' + usersText + '`', { parse_mode: 'Markdown' });
    };

    sendHtml = async (chatId, htmlText) => {
        return await this.tryWithAllEndpoints(async () => {
            return await this.bot.telegram.sendMessage(chatId, htmlText, { parse_mode: 'HTML' });
        });
    }

    onCommandCancel = async (ctx) => {
        const userId = ctx.message.from.id;
        const stateCode = settings.getUserStateCode(userId);
        const stateData = settings.getUserStateData(userId);
        
        if (stateCode === null || stateCode === undefined) {
            return ctx.reply('你当前没有任何操作需要取消。');
        }
        
        this.logger.default.debug(`用户 ${userId} 取消了状态 ${stateCode}`);
        settings.clearUserState(userId);
        return ctx.reply('已取消当前操作。');
    }

    onCallbackQuery = async (ctx) => {
        const data = ctx.callbackQuery.data;
        const userId = ctx.callbackQuery.from.id;
        
        this.logger.default.debug(`收到回调查询: ${data} 来自用户 ${userId}`);
        
        try {
            if (data === 'noop') {
                return ctx.answerCbQuery();
            }
            
            if (data === 'back_to_chats_list') {
                const keyboard = await this.createManageChatsMessageKeyboard(userId, 0);
                await ctx.editMessageText(
                    '请选择你要管理的频道：\n如果你要找的频道没有显示，可能是你的账号没有权限。',
                    { reply_markup: keyboard }
                );
                return ctx.answerCbQuery();
            }
            
            if (data.startsWith('manage_chats_pages:')) {
                const page = parseInt(data.split(':')[1]);
                const keyboard = await this.createManageChatsMessageKeyboard(userId, page);
                await ctx.editMessageReplyMarkup(keyboard);
                return ctx.answerCbQuery();
            }
            
            if (data.startsWith('manage_chat:')) {
                const chatId = parseInt(data.split(':')[1]);
                const keyboard = this.createManageChatMessageKeyboard(chatId);
                await ctx.editMessageText(this.getManageChatMessageText(chatId), {
                    reply_markup: keyboard,
                    parse_mode: 'Markdown'
                });
                return ctx.answerCbQuery();
            }
            
            if (data.startsWith('change_pattern:')) {
                const chatId = parseInt(data.split(':')[1]);
                if (!this.hasPermissionForChat(userId, chatId)) {
                    return await ctx.answerCbQuery('你没有这个对话的管理权限', true);
                }
                settings.setUserState(userId, USER_STATE_CODE_CHAT_CHANGE_PATTERN, chatId);
                await ctx.reply('你正在编辑 id=' + chatId + ' 的消息过滤规则。\n\n' +
                    '当前设置：`' + settings.getChatConfig(chatId).pattern + '`\n\n' +
                    '请回复一条消息，包含你想设置的过滤规则（正则表达式）。\n' +
                    '回复 /cancel 退出互动式对话。', { parse_mode: 'Markdown' });
                return await ctx.answerCbQuery();
            }
            
            if (data.startsWith('change_danmaku_src:')) {
                const chatId = parseInt(data.split(':')[1]);
                if (!this.hasPermissionForChat(userId, chatId)) {
                    return await ctx.answerCbQuery('你没有这个对话的管理权限', true);
                }
                settings.setUserState(userId, USER_STATE_CODE_CHAT_CHANGE_DANMAKU_SRC, chatId);
                
                const replyText = '你正在编辑 id=' + chatId + ' 的弹幕房间号/弹幕源，' +
                    '如果你只需要修改房间号，回复房间号即可。\n' +
                    '如果你需要修改弹幕源，请按格式回复：`[房间号] [弹幕源]` 。' +
                    '例如需要使用斗鱼 10 号房间弹幕，则回复：`10 douyu`\n\n' +
                    '当前设置：房间号=`' + settings.getChatConfig(chatId).roomId +
                    '`, 弹幕源=`' + settings.getChatConfig(chatId).danmakuSource + '`\n' +
                    '回复 /cancel 退出互动式对话。';
                    
                await ctx.reply(replyText, { parse_mode: 'Markdown' });
                return await ctx.answerCbQuery();
            }
            
            if (data.startsWith('change_admin:')) {
                const chatId = parseInt(data.split(':')[1]);
                if (!this.hasUserPermissionForBot(userId)) {
                    return await ctx.answerCbQuery('很抱歉，这项操作只有 Bot 管理员可以使用。', true);
                }
                settings.setUserState(userId, USER_STATE_CODE_CHAT_CHANGE_ADMIN, chatId);
                await ctx.reply('你正在编辑 id=' + chatId + ' 的管理员列表。\n\n' +
                    '当前设置：`' + settings.getChatConfig(chatId).admin.join(', ') + '`\n\n' +
                    '请回复一条消息，包含你想设置的管理员ID列表（用空格分隔）。\n' +
                    '回复 /cancel 退出互动式对话。', { parse_mode: 'Markdown' });
                return await ctx.answerCbQuery();
            }
            
            if (data.startsWith('manage_blocked_users:')) {
                const chatId = parseInt(data.split(':')[1]);
                if (!this.hasPermissionForChat(userId, chatId)) {
                    return await ctx.answerCbQuery('你没有这个对话的管理权限', true);
                }
                const targetChatId = chatId;
                const sentMsg = await ctx.reply(this.getChangeBlockedUsersMessageText(targetChatId),
                    { parse_mode: 'Markdown' });
                settings.setUserState(userId, USER_STATE_CODE_CHAT_CHANGE_BLOCK_USERS, {
                    targetChatId,
                    chatId: sentMsg.chat.id,
                    messageId: sentMsg.message_id
                });
                return await ctx.answerCbQuery();
            }
            
            if (data.startsWith('manage_schedules:')) {
                const chatId = parseInt(data.split(':')[1]);
                if (!this.hasPermissionForChat(userId, chatId)) {
                    return await ctx.answerCbQuery('你没有这个对话的管理权限', true);
                }
                const targetChatId = chatId;
                const sentMsg = await ctx.reply(this.getManageSchedulesMessageText(targetChatId),
                    { parse_mode: 'Markdown' });
                settings.setUserState(userId, USER_STATE_CODE_CHAT_MANAGE_SCHEDULES, {
                    targetChatId,
                    chatId: sentMsg.chat.id,
                    messageId: sentMsg.message_id
                });
                return await ctx.answerCbQuery();
            }
            
            if (data.startsWith('statistics_by_chat:') || data.startsWith('stat_by_chat:')) {
                const chatId = parseInt(data.split(':')[1]);
                if (!this.statistics || !this.statistics.enabled) {
                    return await ctx.answerCbQuery('统计功能未启用', true);
                }
                
                const config = settings.getChatConfig(chatId);
                const roomId = config.roomId;
                const src = config.danmakuSource;
                const roomIdWithSrc = src + '_' + roomId;
                
                try {
                    const sentences = await this.statistics.countSentencesByRoomId(roomIdWithSrc);
                    const words = await this.statistics.countWordsByRoomId(roomIdWithSrc);
                    
                    await ctx.reply('对话 ID=' + chatId + ' 的统计信息（目前仅支持统计实际连接的房间，不区分对话）：\n' +
                        '连接的弹幕源与房间 ID：`' + roomIdWithSrc + '`\n' +
                        '已同传的弹幕数：' + sentences + '\n' +
                        '已同传的字数：' + words, { parse_mode: 'Markdown' });
                } catch (error) {
                    this.logger.default.error(`获取统计信息时出错: ${error}`);
                    await ctx.reply('获取统计信息时出错，请稍后再试');
                }
                
                return await ctx.answerCbQuery();
            }
            
            if (data.startsWith('request_unregister_chat:') || data.startsWith('unregister_chat:')) {
                const chatId = parseInt(data.split(':')[1]);
                if (!this.hasUserPermissionForBot(userId)) {
                    return await ctx.answerCbQuery('很抱歉，这项操作只有 Bot 管理员可以使用。', true);
                }
                await this.requestUnregisterChat(ctx, chatId);
                return await ctx.answerCbQuery();
            }
            
            if (data.startsWith('change_blocked_users:')) {
                const chatId = parseInt(data.split(':')[1]);
                if (!this.hasPermissionForChat(userId, chatId)) {
                    return await ctx.answerCbQuery('你没有这个对话的管理权限', true);
                }
                const targetChatId = chatId;
                const sentMsg = await ctx.reply(this.getChangeBlockedUsersMessageText(targetChatId),
                    { parse_mode: 'Markdown' });
                settings.setUserState(userId, USER_STATE_CODE_CHAT_CHANGE_BLOCK_USERS, {
                    targetChatId,
                    chatId: sentMsg.chat.id,
                    messageId: sentMsg.message_id
                });
                return await ctx.answerCbQuery();
            }
            
            if (data.startsWith('confirm_unregister_chat:')) {
                const chatId = parseInt(data.split(':')[1]);
                settings.unregisterChat(chatId);
                await ctx.editMessageText(`已成功取消注册对话 id=${chatId}`);
                this.user_access_log(userId, `Unregistered chat=${chatId}`);
                return ctx.answerCbQuery();
            }
            
            if (data.startsWith('reconnect_room:')) {
                const parts = data.split(':')[1].split('_');
                const dmSrc = parts[0];
                const roomId = parseInt(parts[1]);
                if (this.dmSrc && this.dmSrc.reconnectRoom) {
                    this.dmSrc.reconnectRoom(dmSrc, roomId);
                    await ctx.reply(`已经对直播房间 ${dmSrc} ${roomId} 重新连接中。` +
                        `（由于目前是相同直播房间的所有对话共用一个弹幕连接，可能会影响到其它频道的弹幕转发）`);
                    this.user_access_log(userId, `Reconnect room: ${dmSrc} ${roomId}`);
                } else {
                    await ctx.reply(`无法重连房间，弹幕源管理器未初始化或不支持重连功能。`);
                }
                return ctx.answerCbQuery();
            }
            
            if (data.startsWith('block_user:')) {
                const parts = data.split(':');
                const chatId = parseInt(parts[1]);
                const uid = parts[2];
                if (!this.hasPermissionForChat(userId, chatId)) {
                    return await ctx.answerCbQuery('你没有这个对话的管理权限', true);
                }
                const [src, id] = uid.split('_');
                settings.addChatBlockedUsers(chatId, uid);
                await ctx.editMessageText(`已成功屏蔽用户：${src}_${id}`);
                this.user_access_log(userId, `Blocked danmaku user: ${uid}`);
                return ctx.answerCbQuery();
            }
            
            // 默认情况，未知回调
            this.logger.default.warn(`未知的回调查询: ${data}`);
            return ctx.answerCbQuery('未知操作');
        } catch (error) {
            this.logger.default.error(`处理回调查询时出错: ${error.stack || error.message || error}`);
            return ctx.answerCbQuery('处理请求时出错');
        }
    }

    getManageChatMessageText = (chatId) => {
        const config = settings.getChatConfig(chatId);
        if (!config) {
            return `找不到ID为 ${chatId} 的聊天配置`;
        }
        
        const chat = this.getChat(chatId);
        let displayName = '' + chatId;
        if (chat) {
            if (chat.title && !chat.username) {
                displayName = chat.title;
            } else if (!chat.title && chat.username) {
                displayName = '@' + chat.username;
            } else if (chat.title && chat.username) {
                displayName = chat.title + ' (@' + chat.username + ')';
            }
        }
        
        // 转义可能导致Markdown解析错误的字符
        const escapedPattern = config.pattern.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
        
        return `你想要修改频道"${displayName}"(id: ${chatId})的什么设置?\n` +
            `房间号/弹幕源: ${config.roomId} ${config.danmakuSource}\n` +
            `过滤规则: ${escapedPattern}`;
    }

    createManageChatMessageKeyboard = (chatId) => {
        const config = settings.getChatConfig(chatId);
        return {
            inline_keyboard: [
                [
                    { text: '房间号/弹幕源', callback_data: `change_danmaku_src:${chatId}` },
                    { text: '过滤规则', callback_data: `change_pattern:${chatId}` },
                    { text: '管理员', callback_data: `change_admin:${chatId}` }
                ],
                [
                    { text: '屏蔽用户', callback_data: `change_blocked_users:${chatId}` },
                    { text: '重连房间', callback_data: `reconnect_room:${config.danmakuSource}_${config.roomId}` },
                    { text: '查看统计', callback_data: `stat_by_chat:${chatId}` }
                ],
                [
                    { text: '计划任务', callback_data: `manage_schedules:${chatId}` },
                    { text: '取消注册', callback_data: `unregister_chat:${chatId}` }
                ]
            ]
        };
    };

    onAnswerChangeDanmakuSrc = async (ctx, chatId) => {
        let [roomId, srcId] = ctx.message.text.split(' ');
        if (isNaN(roomId)) {
            ctx.reply('你输入的房间号不是合法的数字。', { reply_to_message_id: ctx.message.message_id });
            return;
        }
        roomId = Number(roomId);
        if (srcId) {
            const src = settings.getDanmakuSource(srcId);
            if (!src) {
                ctx.reply('你输入的弹幕源不是合法的弹幕源，你可以输入 /list_dmsrc 进行查询。',
                    { reply_to_message_id: ctx.message.message_id });
                return;
            }
        }
        const curRoomId = settings.getChatConfig(chatId).roomId;
        const curDanmakuSource = settings.getChatConfig(chatId).danmakuSource;
        if (curRoomId !== roomId || (srcId && curDanmakuSource !== srcId)) {
            if (curRoomId && this.dmSrc) {
                this.dmSrc.leaveRoom(curDanmakuSource, curRoomId);
            }
            settings.setChatRoomId(chatId, roomId);
            if (srcId) {
                settings.setChatDanmakuSource(chatId, srcId);
            }
            if (this.dmSrc) {
                this.dmSrc.joinRoom(settings.getChatConfig(chatId).danmakuSource, roomId);
            }
        }
        const newDanmakuSource = settings.getChatConfig(chatId).danmakuSource;
        ctx.reply(`已成功为 id=${chatId} 频道注册了 ${newDanmakuSource}:${roomId} 房间弹幕转发。`);
        this.user_access_log(ctx.message.from.id, `Set chat id=${chatId} danmaku source to`
            + ` ${newDanmakuSource}:${roomId}`)
        settings.clearUserState(ctx.message.from.id);
    };
}

module.exports = BotWrapper; 