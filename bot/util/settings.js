const fs = require('fs');
const path = require('path');

const DEFAULT_PATTERN = '.*';
const DEFAULT_DANMAKU_SOURCE = 'bilibili';

class Settings {
    dataDir = '';
    dataSaveInterval = 1000;
    botToken = '';
    botProxy = '';
    botAdmins = [];
    danmakuSources = [];

    globalConfig = {};
    chatsConfig = {};

    globalConfigPath = '';
    chatsConfigDir = '';
    userStatesPath = '';

    _saveCallback = null;

    init(botConfig, autoSave) {
        if (this._saveCallback) {
            clearInterval(this._saveCallback);
        }

        // Read bot configuration
        this.dataDir = botConfig.dataDir;
        this.dataSaveInterval = botConfig.dataSaveInterval;
        this.botToken = botConfig.botToken;
        this.botProxy = botConfig.botProxy;
        this.botAdmins = botConfig.botAdmins;
        this.danmakuSources = botConfig.danmakuSources.filter(src => src.enabled !== false);
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(path.resolve(this.dataDir));
        }
        this.globalConfigPath = path.join(this.dataDir, 'global.json');
        this.chatsConfigDir = path.join(this.dataDir, 'chats');
        this.userStatesPath = path.join(this.dataDir, 'user_states.json');

        // Read global chat default configuration
        let globalConfig = {};
        if (fs.existsSync(this.globalConfigPath)) {
            const buf = fs.readFileSync(this.globalConfigPath);
            globalConfig = JSON.parse(buf.toString('utf-8'));
        }
        if (!globalConfig.pattern) {
            globalConfig.pattern = DEFAULT_PATTERN;
        }
        if (!globalConfig.admin) {
            globalConfig.admin = [];
        }
        if (!globalConfig.danmakuSource) {
            globalConfig.danmakuSource = DEFAULT_DANMAKU_SOURCE;
        }
        this.globalConfig = globalConfig;

        // Read chats configuration
        let chatsConfig = {};
        if (!fs.existsSync(this.chatsConfigDir)) {
            fs.mkdirSync(this.chatsConfigDir);
        }
        for (let filename of fs.readdirSync(this.chatsConfigDir)) {
            if (!filename.endsWith('.json') || filename.indexOf('.') !== filename.lastIndexOf('.')) {
                continue;
            }
            const [chatId] = filename.split('.');
            if (isNaN(chatId)) {
                continue;
            }
            const buf = fs.readFileSync(path.join(this.chatsConfigDir, filename));
            chatsConfig[chatId] = JSON.parse(buf.toString('utf-8'));
        }
        this.chatsConfig = chatsConfig;

        // Read user states configuration
        let userStates = {};
        if (fs.existsSync(this.userStatesPath)) {
            const buf = fs.readFileSync(this.userStatesPath);
            userStates = JSON.parse(buf.toString('utf-8'));
        }
        this.userStates = userStates;

        if (autoSave) {
            this._saveCallback = setInterval(() => this.saveConfig(), this.dataSaveInterval);
        }
    }

    saveConfig() {
        const globalConfigJson = JSON.stringify(this.globalConfig, null, 4);
        fs.writeFileSync(this.globalConfigPath, globalConfigJson);

        for (let chatId of Object.keys(this.chatsConfig)) {
            const chatConfigJson = JSON.stringify(this.chatsConfig[chatId], null, 4);
            fs.writeFileSync(path.join(this.chatsConfigDir, `${chatId}.json`), chatConfigJson);
        }

        const userStatesJson = JSON.stringify(this.userStates, null, 4);
        fs.writeFileSync(this.userStatesPath, userStatesJson);
    }

    getChatConfig(chatId) {
        const result = Object.assign({}, this.globalConfig, this.chatsConfig[chatId]);
        if (!result.danmakuSource) {
            result.danmakuSource = this.globalConfig.danmakuSource;
        }
        return result;
    }

    getChatConfigs() {
        const result = {};
        for (let chatId of Object.keys(this.chatsConfig)) {
            result[chatId] = this.getChatConfig(chatId);
        }
        return result;
    }

    getDanmakuSource(id) {
        for (let item of this.danmakuSources) {
            if (item.id === id) {
                return item;
            }
        }
        return null;
    }

    unsetChatRoomId(chatId) {
        const c = this._ensureChatConfig(chatId);
        c.roomId = undefined;
    }

    setChatRoomId(chatId, roomId) {
        const c = this._ensureChatConfig(chatId);
        c.roomId = roomId;
    }

    setChatDanmakuSource(chatId, id) {
        const c = this._ensureChatConfig(chatId);
        if (id && !this.getDanmakuSource(id)) {
            throw new Error('Cannot find danmaku source by id: ' + id);
        }
        c.danmakuSource = id;
    }

    setChatPattern(chatId, pattern) {
        const c = this._ensureChatConfig(chatId);
        new RegExp(pattern);
        c.pattern = pattern;
    }

    setChatAdmin(chatId, admin) {
        const c = this._ensureChatConfig(chatId);
        if (admin instanceof Array) {
            c.admin = admin;
        } else {
            c.admin = [];
        }
    }

    setChatBlockedUsers(chatId, users) {
        const c = this._ensureChatConfig(chatId);
        c.blockedUsers = users || [];
    }

    addChatBlockedUsers(chatId, userId) {
        if (userId.indexOf('_') < 0) {
            console.error('Cannot add user id=' + userId + ' to block list. Please check id format.');
            return;
        }
        const c = this._ensureChatConfig(chatId);
        if (!c.blockedUsers) {
            c.blockedUsers = [];
        }
        const index = c.blockedUsers.indexOf(userId);
        if (index < 0) {
            c.blockedUsers.push(userId);
            return true;
        }
        return false;
    }

    removeChatBlockedUsers(chatId, userId) {
        if (userId.indexOf('_') < 0) {
            console.error('Cannot add user id=' + userId + ' to block list. Please check id format.');
            return;
        }
        const c = this._ensureChatConfig(chatId);
        if (!c.blockedUsers) {
            c.blockedUsers = [];
        }
        const index = c.blockedUsers.indexOf(userId);
        if (index >= 0) {
            c.blockedUsers.splice(userId, 1);
            return true;
        }
        return false;
    }

    containsChatBlockedUser(chatId, userId, source) {
        if (source) {
            userId = source + '_' + userId;
        }
        if (userId.indexOf('_') < 0) {
            console.error('Cannot add user id=' + userId + ' to block list. Please check id format.');
            return;
        }
        const c = this._ensureChatConfig(chatId);
        if (!c.blockedUsers) {
            c.blockedUsers = [];
        }
        return c.blockedUsers.indexOf(userId) >= 0;
    }

    getChatBlockedUsers(chatId) {
        const blockedUsers = this.getChatConfig(chatId).blockedUsers || [];
        return blockedUsers.map((value) => {
            const [dmSrc, userId] = value.split('_');
            return { src: dmSrc, uid: userId };
        });
    }

    setChatSchedules(chatId, schedules) {
        const c = this._ensureChatConfig(chatId);
        c.schedules = schedules || [];
    }

    addChatSchedule(chatId, expression, action) {
        const c = this._ensureChatConfig(chatId);
        if (!c.schedules) {
            c.schedules = [];
        }
        const index = c.schedules.findIndex(s => s.expression === expression);
        if (index < 0) {
            c.schedules.push({ expression, action });
            return true;
        }
        return false;
    }

    removeChatSchedule(chatId, expression) {
        const c = this._ensureChatConfig(chatId);
        if (!c.schedules) {
            c.schedules = [];
        }
        const index = c.schedules.findIndex(s => s.expression === expression);
        if (index >= 0) {
            c.schedules.splice(index, 1);
            return true;
        }
        return false;
    }

    containsChatSchedule(chatId, expression) {
        const c = this._ensureChatConfig(chatId);
        if (!c.schedules) {
            c.schedules = [];
        }
        return c.schedules.findIndex(s => s.expression === expression) >= 0;
    }

    getChatSchedules(chatId) {
        const c = this._ensureChatConfig(chatId);
        return c.schedules || [];
    }

    deleteChatConfig(chatId) {
        delete this.chatsConfig[chatId];
        fs.unlinkSync(path.join(this.chatsConfigDir, `${chatId}.json`));
    }

    setGlobalPattern(pattern) {
        new RegExp(pattern);
        this.globalConfig.pattern = pattern;
    }

    getGlobalPattern() {
        return this.globalConfig.pattern || DEFAULT_PATTERN;
    }

    setGlobalAdmin(admin) {
        if (admin instanceof Array) {
            this.globalConfig.admin = admin;
        } else {
            this.globalConfig.admin = [];
        }
    }

    setGlobalDanmakuSource(id) {
        if (id && !this.getDanmakuSource(id)) {
            throw new Error('Cannot find danmaku source by id: ' + id);
        }
        this.globalConfig.danmakuSource = id;
    }

    registerChat(config) {
        if (!config || !config.chatId) {
            throw new Error('Invalid chat config');
        }
        this._ensureChatConfig(config.chatId);
        
        // 设置聊天配置
        if (config.roomId) this.setChatRoomId(config.chatId, config.roomId);
        if (config.danmakuSource) this.setChatDanmakuSource(config.chatId, config.danmakuSource);
        if (config.pattern) this.setChatPattern(config.chatId, config.pattern);
        if (config.admin) this.setChatAdmin(config.chatId, config.admin);
        if (config.blockedUsers) this.setChatBlockedUsers(config.chatId, config.blockedUsers);
    }

    getAllRegisteredChats() {
        const result = [];
        for (let chatId of Object.keys(this.chatsConfig)) {
            const config = this.getChatConfig(chatId);
            // 只返回有房间ID的聊天（已注册的）
            if (config.roomId) {
                result.push({
                    chatId: parseInt(chatId),
                    roomId: config.roomId,
                    danmakuSource: config.danmakuSource,
                    pattern: config.pattern,
                    admin: config.admin,
                    blockedUsers: config.blockedUsers
                });
            }
        }
        return result;
    }

    getUserStateCode(userId) {
        const state = this.userStates[userId];
        if (state) {
            return state.code;
        } else {
            return -1;
        }
    }

    getUserStateData(userId) {
        const state = this.userStates[userId];
        if (state) {
            return state.data;
        } else {
            return null;
        }
    }

    getUserState(userId) {
        return this.userStates[userId] || null;
    }

    setUserState(userId, code, data) {
        if (!Object.keys(this.userStates).find(v => v === userId)) {
            this.userStates[userId] = { code, data: data || null };
        } else {
            this.userStates[userId].code = code;
            if (data !== undefined) {
                this.userStates[userId].data = data;
            }
        }
    }

    clearUserState(userId) {
        delete this.userStates[userId];
    }

    _ensureChatConfig(chatId) {
        if (!Object.keys(this.chatsConfig).find(value => value == chatId)) {
            this.chatsConfig[chatId] = {};
        }
        return this.chatsConfig[chatId];
    }

    _printConfig() {
        console.log('Data dir: ', this.dataDir);
        console.log('Global config: ', this.globalConfig);
        console.log('Chats config: ', this.chatsConfig);
        console.log('User states: ', this.userStates);
    }
}

module.exports = new Settings();
