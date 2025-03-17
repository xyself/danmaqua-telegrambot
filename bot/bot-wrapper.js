const settings = require('./util/settings');
const { Telegraf } = require('telegraf');
const { Markup } = require('telegraf');

class BotWrapper {
    constructor({ botConfig, botToken, agent, logger }) {
        this.botConfig = botConfig;
        this.apiEndpoints = [
            'https://tgapi.chenguaself.tk',
            'https://api-proxy.me/telegram',
            'https://api.telegram.org'
        ];
        this.currentApiIndex = 0;
        this.createBot(botToken, agent);
        this.botUser = null;
        this.logger = logger;
        this.commandRecords = [];
        this.startCommandSimpleMessage = '';
        this.helpCommandMessageHeader = '';

        this.bot.catch((e) => {
            this.logger.default.error(e);
        });
        this.bot.command('start', this.onCommandStart);
        this.bot.command('help', this.onCommandHelp);
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
        this.logger.default.info(`Switching to API endpoint: ${this.apiEndpoints[this.currentApiIndex]}`);
        this.createBot(botToken, agent);
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
                this.logger.default.error(`Failed to connect to ${this.apiEndpoints[this.currentApiIndex]}`);
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
        return ctx.reply(this.startCommandSimpleMessage);
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

         return await this.safeAnswerCbQuery(ctx);
    };

    sendHtml = async (chatId, htmlText) => {
        return await this.bot.telegram.sendMessage(chatId, htmlText, { parse_mode: 'HTML' });
    };

    safeAnswerCbQuery = async (ctx, text = '', showAlert = false) => {
        try {
            return await ctx.answerCbQuery(text, showAlert);
        } catch (error) {
            if (error.description && error.description.includes('query is too old')) {
                this.logger.default.warn(`回调查询超时或无效: ${error.message}`);
                return null;
            }
            throw error; // 重新抛出其他类型的错误
        }
    };
}

module.exports = BotWrapper;


