const fs = require('fs');
const path = require('path');
const OSS = require('ali-oss');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const config = require('./config');

// --- ⚙️ OSS 配置 (使用环境变量或硬编码) ---
const OSS_CONFIG = {
    region: process.env.OSS_REGION || 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket: process.env.OSS_BUCKET
};

// 递归获取文件
function getAllFiles(dirPath, arrayOfFiles) {
    if (!fs.existsSync(dirPath)) return [];
    
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];

    files.forEach(function(file) {
        if (file === '.DS_Store') return;
        const fullPath = path.join(dirPath, file);
        if (fs.statSync(fullPath).isDirectory()) {
            arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
        } else {
            arrayOfFiles.push(fullPath);
        }
    });

    return arrayOfFiles;
}

module.exports = async function uploadAll() {
    console.log(`\n🚀 [OSS上传] 目标前缀: ${config.ossPath}`);
    
    let client;
    try {
        client = new OSS(OSS_CONFIG);
    } catch (e) {
        console.error('❌ OSS 初始化失败:', e.message);
        return;
    }

    const DATA_DIR = config.dataDir;
    
    if (!fs.existsSync(DATA_DIR)) {
        console.error('❌ 数据目录不存在，跳过上传');
        return;
    }

    const allFiles = getAllFiles(DATA_DIR);
    // 过滤掉大文件，只传业务数据
    const filesToUpload = allFiles.filter(f => !f.includes('all_data_full'));

    console.log(`   待上传: ${filesToUpload.length} 个文件`);

    let successCount = 0;
    for (const localPath of filesToUpload) {
        // 计算远程路径
        const relativePath = path.relative(DATA_DIR, localPath).split(path.sep).join('/');
        const remotePath = `${config.ossPath}${relativePath}`;

        try {
            await client.put(remotePath, localPath);
            successCount++;
        } catch (e) {
            console.error(`   ❌ 失败: ${relativePath}`);
        }
    }
    console.log(`📊 上传完成: ${successCount}/${filesToUpload.length}`);
};