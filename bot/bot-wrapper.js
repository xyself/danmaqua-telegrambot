const settings = require('./util/settings');
const Telegraf = require('telegraf');
const Extra = require('telegraf/extra');

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
        this.bot.start(this.onCommandStart);
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
}

module.exports = BotWrapper;


