const path = require('path');
const fs = require('fs');

// 尝试读取 oss-config.json
let ossConfig = {};
const ossConfigPath = path.join(__dirname, '../oss-config.json');

if (fs.existsSync(ossConfigPath)) {
    try {
        ossConfig = JSON.parse(fs.readFileSync(ossConfigPath, 'utf8'));
        console.log('✅ 已加载 OSS 配置文件');
    } catch (e) {
        console.warn('⚠️ OSS 配置文件读取失败:', e.message);
    }
}

module.exports = {
    // 数据目录
    dataDir: path.join(__dirname, 'data'),

    // OSS 配置 (优先使用环境变量，其次使用 oss-config.json)
    oss: {
        region: process.env.OSS_REGION || ossConfig.region || 'oss-cn-hangzhou',
        bucket: process.env.OSS_BUCKET || ossConfig.bucket,
        accessKeyId: process.env.OSS_ACCESS_KEY_ID || ossConfig.accessKeyId,
        accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || ossConfig.accessKeySecret,
        endpoint: ossConfig.endpoint
    },

    // OSS 上传路径前缀
    ossPath: 'poe2-economy/',  // 或 'poe2-all-class/economy/'

    // 爬虫配置
    crawler: {
        headless: process.env.CI ? "new" : false,
        useProxy: process.env.USE_PROXY === "true",
        timeout: 60000
    }
};
