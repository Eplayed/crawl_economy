const path = require('path');

module.exports = {
    // 数据目录
    dataDir: path.join(__dirname, 'data'),
    
    // OSS 配置
    ossPath: 'poe2-economy/',  // 或 'poe2-all-class/economy/'
    
    // 爬虫配置
    crawler: {
        headless: process.env.CI ? "new" : false,
        useProxy: process.env.USE_PROXY === "true",
        timeout: 60000
    }
};
