// 测试使用绝对路径读取环境变量
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// 使用绝对路径
const envPath = path.resolve(__dirname, '.env');
console.log('使用绝对路径:', envPath);

// 直接读取和解析.env文件
try {
    const envFile = fs.readFileSync(envPath, 'utf8');
    console.log('环境文件内容:', envFile);
    
    // 手动解析env文件
    const envVars = dotenv.parse(envFile);
    console.log('解析结果:', JSON.stringify(envVars, null, 2));
    console.log('SESSDATA长度:', (envVars.DMQ_BILIBILI_SESSDATA || '').length);
    
    // 手动设置到环境变量
    Object.keys(envVars).forEach(key => {
        process.env[key] = envVars[key];
    });
    
    console.log('设置后环境变量长度:', process.env.DMQ_BILIBILI_SESSDATA.length);
    console.log('设置后环境变量前缀:', process.env.DMQ_BILIBILI_SESSDATA.substring(0, 10));
} catch (err) {
    console.error('读取环境文件出错:', err);
} 