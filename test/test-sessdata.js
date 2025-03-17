// 测试环境变量读取
const fs = require('fs');

try {
    // 创建日志输出函数
    const logFile = fs.createWriteStream('env-test.log', {flags: 'w'});
    function log(message) {
        process.stdout.write(message + '\n');
        logFile.write(message + '\n');
    }

    log('开始测试环境变量...');
    require('dotenv').config();
    log('dotenv加载完成');

    log('============= 环境变量测试 =============');
    log('1. process.env对象键: ' + JSON.stringify(Object.keys(process.env).filter(key => key.includes('DMQ'))));
    log('2. DMQ_BOT_TOKEN: ' + (process.env.DMQ_BOT_TOKEN ? '存在(已隐藏值)' : '不存在'));
    log('3. DMQ_BOT_ADMINS: ' + process.env.DMQ_BOT_ADMINS);
    log('4. DMQ_BILIBILI_SESSDATA 是否存在: ' + (process.env.DMQ_BILIBILI_SESSDATA ? '是' : '否'));
    log('5. DMQ_BILIBILI_SESSDATA 长度: ' + (process.env.DMQ_BILIBILI_SESSDATA || '').length);
    log('6. DMQ_BILIBILI_SESSDATA 前10个字符: ' + (process.env.DMQ_BILIBILI_SESSDATA || '').substring(0, 10));

    // 直接读取.env文件
    log('准备读取.env文件...');
    
    log('============= 直接读取.env文件 =============');
    try {
        const envContent = fs.readFileSync('.env', 'utf8');
        log('7. .env文件内容:');
        const lines = envContent.split('\n');
        // 显示内容但隐藏敏感值
        lines.forEach(line => {
            if (line.startsWith('DMQ_BOT_TOKEN=')) {
                log('DMQ_BOT_TOKEN=[已隐藏]');
            } else if (line.startsWith('DMQ_BILIBILI_SESSDATA=')) {
                const prefix = line.substring(0, 30);
                log(`${prefix}... (后续已隐藏)`);
            } else {
                log(line);
            }
        });
    } catch (err) {
        log('读取.env文件失败: ' + err.message);
    }

    // 输出Node.js版本信息
    log('============= Node.js信息 =============');
    log('8. Node.js版本: ' + process.version);
    log('9. process.env类型: ' + typeof process.env);
    log('10. process.env对象长度: ' + Object.keys(process.env).length);

    // 尝试直接设置环境变量
    log('============= 尝试直接设置环境变量 =============');
    process.env.TEST_VAR = 'test-value';
    log('11. 设置的TEST_VAR值: ' + process.env.TEST_VAR);

    log('测试完成!');
    log('查看env-test.log文件以获取详细信息');
    
    // 关闭日志文件
    logFile.end();
} catch (err) {
    console.error('测试过程中发生错误:', err);
    console.error(err.stack);
} 