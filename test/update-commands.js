// 更新Telegram机器人命令列表的脚本
require('dotenv').config();
const { Telegraf } = require('telegraf');

// 从环境变量获取机器人token
const token = process.env.DMQ_BOT_TOKEN;
if (!token) {
  console.error('错误: 未找到BOT_TOKEN环境变量');
  process.exit(1);
}

const bot = new Telegraf(token);

// 定义机器人命令列表 - 基于bot-core.js中的定义
const commands = [
  { command: 'list_dm_src', description: '查询弹幕源' },
  { command: 'register_chat', description: '注册频道' },
  { command: 'unregister_chat', description: '取消注册频道' },
  { command: 'manage_chats', description: '管理频道' },
  { command: 'manage_chat', description: '管理特定频道' },
  { command: 'set_default_admins', description: '设置默认管理员' },
  { command: 'set_default_pattern', description: '设置默认过滤模式' },
  { command: 'set_default_source', description: '设置默认弹幕源' },
  { command: 'stat_users', description: '统计用户信息' },
  { command: 'stat_user_query', description: '查询用户统计' },
  { command: 'cancel', description: '取消当前操作' },
  { command: 'help', description: '显示帮助信息' },
  { command: 'start', description: '开始使用机器人' }
];

// 更新机器人命令列表
async function updateCommands() {
  try {
    console.log('开始更新机器人命令列表...');
    await bot.telegram.setMyCommands(commands);
    console.log('命令列表更新成功！以下命令已注册:');
    commands.forEach(cmd => {
      console.log(`/${cmd.command} - ${cmd.description}`);
    });
  } catch (error) {
    console.error('更新命令列表时出错:', error);
  }
}

// 执行更新
updateCommands().finally(() => {
  console.log('脚本执行完毕');
  process.exit(0);
}); 