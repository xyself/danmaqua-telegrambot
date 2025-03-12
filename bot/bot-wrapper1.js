const settings = require('./util/settings');
const { Telegraf, Markup } = require('telegraf');

class BotWrapper {
    constructor({ botConfig, botToken, agent, logger }) {
        this.botConfig = botConfig;
        this.bot = new Telegraf(botToken, { telegram: { agent } });
        this.botUser = null;
        this.logger = logger;
        this.commandRecords = [];
        this.startCommandSimpleMessage = '';
        this.helpCommandMessageHeader = '';

        this.bot.catch((e) => {
            this.logger.default.error(e);
        });
        this.bot.start(this.onCommandStart);
        this.bot.command('help', this.onCommandHelp);
    }

    user_access_log(userId, out) {
        this.logger.access.debug(`UserId=${userId} ${out}`);
    }

    start = async () => {
        this.logger.default.info('Launcher: Bot is launching...');
        while (!this.botUser) {
            try {
                this.botUser = await this.bot.telegram.getMe();
            } catch (e) {
                console.error(e);
            }
        }
        return await this.bot.launch();
    };

    getChat = async (chatId) => {
        try {
            return await this.bot.telegram.getChat(chatId);
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
            let member = await this.bot.telegram.getChatMember(chatId, this.botUser.id);
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

    onCommandStart = async (ctx) => {
        const res = '欢迎使用弹幕姬 Bot！\n' +
            '输入 /help 查看使用方法。';
        return ctx.reply(res, { parse_mode: 'Markdown' });
    };

    onCommandHelp = async (ctx) => {
        const res = '这是一个用于转发直播弹幕的 Bot。\n' +
            '使用方法：\n' +
            '1. 将 Bot 添加到一个群组或频道中\n' +
            '2. 使用 /register_chat 命令注册一个直播间\n' +
            '3. 设置过滤规则\n' +
            '4. 完成！\n\n' +
            '如果你是 Bot 管理员，可以使用 /list_commands 查看所有可用的命令。';
        return ctx.reply(res, { parse_mode: 'Markdown' });
    }

    onCommandRegisterChat = async (ctx) => {
        let [_, chatId, roomId, source] = ctx.message.text.split(' ');
        if (!chatId || !roomId) {
            ctx.reply('注册命令使用方法：/register\\_chat `chatId` `roomId` `[source]`', { parse_mode: 'Markdown' });
            return;
        }
        // ... existing code ...
    }

    onCommandUnregisterChat = async (ctx) => {
        let [_, chatId] = ctx.message.text.split(' ');
        if (!chatId) {
            ctx.reply('取消注册命令使用方法：/unregister\_chat `chatId`', { parse_mode: 'Markdown' });
            return;
        }
        // ... existing code ...
    }

    onCommandManageChats = async (ctx) => {
        const userId = ctx.message.from.id;
        ctx.reply(
            '请选择你要管理的频道：\n如果你要找的频道没有显示，可能是你的账号没有权限。',
            { reply_markup: await this.createManageChatsMessageKeyboard(userId, 0) }
        );
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
        await this.bot.telegram.editMessageText(
            chatId, messageId, undefined,
            this.getChangeBlockedUsersMessageText(targetChatId),
            { parse_mode: 'Markdown' }
        );
    };

    onAnswerManageSchedules = async (ctx, { targetChatId, chatId, messageId }) => {
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
        await this.bot.telegram.editMessageText(
            chatId, messageId, undefined,
            this.getManageSchedulesMessageText(targetChatId),
            { parse_mode: 'Markdown' }
        );
    };

    requestUnregisterChat = async (ctx, chatId) => {
        ctx.reply('你确定要取消注册对话 id=' + chatId + ' 吗？所有该对话的设置都会被清除且无法恢复。',
            { reply_markup: Markup.inlineKeyboard([
                Markup.button.callback('是的，我不后悔', 'confirm_unregister_chat:' + chatId)
            ])});
    };

    sendHtml = async (chatId, htmlText) => {
        return await this.bot.telegram.sendMessage(chatId, htmlText, { parse_mode: 'HTML' });
    }

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
            ...keyboard
        });
    };

    onCommandStatUsers = async (ctx) => {
        if (!this.statistics.enabled) {
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
}

module.exports = BotWrapper;