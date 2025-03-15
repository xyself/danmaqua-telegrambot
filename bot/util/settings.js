const fs = require('fs');
const path = require('path');

// 添加安全的异步文件写入函数
function safeWriteFile(filePath, content, logPrefix = '') {
    return new Promise((resolve, reject) => {
        try {
            console.log(`${logPrefix}异步写入文件: ${filePath}`);
            // 获取调用堆栈以便追踪是谁调用了文件写入
            if (process.env.NODE_ENV === 'development') {
                const stack = new Error().stack;
                console.log(`调用栈: ${stack}`);
            }
            fs.writeFile(filePath, content, (err) => {
                if (err) {
                    console.error(`异步写入文件失败: ${filePath}`, err.message);
                    console.error(`错误详情:`, err);
                    reject(err);
                } else {
                    if (process.env.NODE_ENV === 'development') {
                        console.log(`${logPrefix}异步写入文件成功: ${filePath}`);
                    }
                    resolve();
                }
            });
        } catch (error) {
            console.error(`异步写入文件操作异常: ${filePath}`, error.message);
            console.error(`错误详情:`, error);
            reject(error);
        }
    });
}

// 添加日志功能
function safeWriteFileSync(filePath, content, logPrefix = '') {
    try {
        console.log(`${logPrefix}写入文件: ${filePath}`);
        // 获取调用堆栈以便追踪是谁调用了文件写入
        const stack = new Error().stack;
        console.log(`调用栈: ${stack}`);
        fs.writeFileSync(filePath, content);
    } catch (error) {
        console.error(`写入文件失败: ${filePath}`, error.message);
        console.error(`错误详情:`, error);
    }
}

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
    _pendingChanges = {
        global: false,
        chats: new Set(),
        userStates: false
    };

    init(botConfig, autoSave) {
        if (this._saveCallback) {
            clearInterval(this._saveCallback);
        }

        // 重置变更标记
        this._pendingChanges = {
            global: false,
            chats: new Set(),
            userStates: false
        };

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

        // 确保用户状态文件的父目录存在
        const userStatesDir = path.dirname(this.userStatesPath);
        if (!fs.existsSync(userStatesDir)) {
            fs.mkdirSync(path.resolve(userStatesDir), { recursive: true });
        }

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
        try {
            // 只有当全局配置有变化时才保存
            if (this._pendingChanges.global) {
                const globalConfigJson = JSON.stringify(this.globalConfig, null, 4);
                safeWriteFile(this.globalConfigPath, globalConfigJson, '[全局配置]')
                    .then(() => {
                        this._pendingChanges.global = false;
                    })
                    .catch(err => console.error('写入全局配置失败:', err));
            }

            // 只保存有变化的聊天配置
            for (let chatId of this._pendingChanges.chats) {
                if (this.chatsConfig[chatId]) {
                    // 确保目标路径是在chats目录下
                    const targetPath = path.join(this.chatsConfigDir, `${chatId}.json`);
                    if (!targetPath.startsWith(this.chatsConfigDir)) {
                        console.error(`[路径安全] 阻止写入非法路径: ${targetPath}`);
                        continue;
                    }
                    
                    const chatConfigJson = JSON.stringify(this.chatsConfig[chatId], null, 4);
                    safeWriteFile(targetPath, chatConfigJson, `[聊天配置-${chatId}]`)
                        .then(() => {
                            this._pendingChanges.chats.delete(chatId);
                        })
                        .catch(err => console.error(`写入聊天配置(${chatId})失败:`, err));
                }
            }

            // 只有当用户状态有变化时才保存
            if (this._pendingChanges.userStates) {
                const userStatesJson = JSON.stringify(this.userStates, null, 4);
                // 只有当内容不是空对象时才写入，或者文件不存在时
                if (userStatesJson !== "{}" || !fs.existsSync(this.userStatesPath)) {
                    safeWriteFile(this.userStatesPath, userStatesJson, '[用户状态]')
                        .then(() => {
                            this._pendingChanges.userStates = false;
                        })
                        .catch(err => console.error('写入用户状态失败:', err));
                } else {
                    // 内容为空，不需要写入
                    this._pendingChanges.userStates = false;
                }
            }
        } catch (err) {
            console.error('保存配置时出错:', err);
            // 如果是因为文件被锁定或临时无法访问，可以稍后重试
            setTimeout(() => {
                console.log('尝试重新保存配置...');
                this.saveConfig();
            }, 2000);
        }
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
        this._pendingChanges.chats.add(chatId);
    }

    setChatRoomId(chatId, roomId) {
        const c = this._ensureChatConfig(chatId);
        c.roomId = roomId;
        this._pendingChanges.chats.add(chatId);
    }

    setChatDanmakuSource(chatId, id) {
        const c = this._ensureChatConfig(chatId);
        if (id && !this.getDanmakuSource(id)) {
            throw new Error('Cannot find danmaku source by id: ' + id);
        }
        c.danmakuSource = id;
        this._pendingChanges.chats.add(chatId);
    }

    setChatPattern(chatId, pattern) {
        const c = this._ensureChatConfig(chatId);
        new RegExp(pattern);
        c.pattern = pattern;
        this._pendingChanges.chats.add(chatId);
    }

    setChatAdmin(chatId, admin) {
        const c = this._ensureChatConfig(chatId);
        if (admin instanceof Array) {
            c.admin = admin;
        } else {
            c.admin = [];
        }
        this._pendingChanges.chats.add(chatId);
    }

    setChatBlockedUsers(chatId, users) {
        const c = this._ensureChatConfig(chatId);
        c.blockedUsers = users || [];
        this._pendingChanges.chats.add(chatId);
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
            this._pendingChanges.chats.add(chatId);
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
            this._pendingChanges.chats.add(chatId);
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
        this._pendingChanges.chats.add(chatId);
    }

    addChatSchedule(chatId, expression, action) {
        const c = this._ensureChatConfig(chatId);
        if (!c.schedules) {
            c.schedules = [];
        }
        const index = c.schedules.findIndex(s => s.expression === expression);
        if (index < 0) {
            c.schedules.push({ expression, action });
            this._pendingChanges.chats.add(chatId);
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
            this._pendingChanges.chats.add(chatId);
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
        this._pendingChanges.chats.delete(chatId);
        fs.unlinkSync(path.join(this.chatsConfigDir, `${chatId}.json`));
    }

    setGlobalPattern(pattern) {
        new RegExp(pattern);
        this.globalConfig.pattern = pattern;
        this._pendingChanges.global = true;
    }

    getGlobalPattern() {
        return this.globalConfig.pattern || DEFAULT_PATTERN;
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
        this._pendingChanges.global = true;
    }

    setGlobalDanmakuSource(id) {
        if (id && !this.getDanmakuSource(id)) {
            throw new Error('Cannot find danmaku source by id: ' + id);
        }
        this.globalConfig.danmakuSource = id;
        this._pendingChanges.global = true;
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
        this._pendingChanges.userStates = true;
    }

    clearUserState(userId) {
        delete this.userStates[userId];
        this._pendingChanges.userStates = true;
    }

    _ensureChatConfig(chatId) {
        if (!Object.keys(this.chatsConfig).find(value => value == chatId)) {
            this.chatsConfig[chatId] = {};
            this._pendingChanges.chats.add(chatId);
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
