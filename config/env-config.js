const path = require('path');

const isProd = process.env.NODE_ENV === 'production';
const isDev = process.env.NODE_ENV === 'dev';

// 数据目录配置: project-root/data
// __dirname is config/
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_ROOT = path.join(PROJECT_ROOT, "data");

const DATA_DIR = isDev 
    ? path.join(DATA_ROOT, "translated-data/dev")
    : path.join(DATA_ROOT, "translated-data/release");

module.exports = {
    isProd,
    isDev: isDev,
    projectRoot: PROJECT_ROOT,
    dataRoot: DATA_ROOT,
    
    // 根据环境获取文件名
    getFileName: (baseName) => {
        return isProd ? `${baseName}.json` : `${baseName}_dev.json`;
    },
    // OSS 存储路径前缀
    ossPath: isProd ? 'poe2-ladders/release/' : 'poe2-ladders/dev/',
    // 本地数据目录
    dataDir: DATA_DIR,
    // 爬取配置
    crawler: {
        headless: isProd ? "new" : false, 
        maxRank: isProd ? 20 : 3,         
        timeout: 60000
    }
};
