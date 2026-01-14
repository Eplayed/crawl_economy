require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const config = require('./config');

// --- 配置 ---
const TARGET_URL = "https://www.d2core.com/";
const OUTPUT_FILE = "d4_events.json";
const OUTPUT_DIR = config.dataDir || "./data";

// OSS 配置 (使用 config.js)
const OSS_CONFIG = {
    region: config.oss.region,
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
    bucket: config.oss.bucket
};

// 代理配置
const USE_PROXY = process.env.USE_PROXY === "true";
const LOCAL_PROXY = "http://127.0.0.1:7890";

// USER_AGENT
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function runD4Task() {
    console.log("🔥 [D4 助手] 启动 DOM 抓取...");

    // 构建启动参数
    const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080'
    ];

    if (USE_PROXY) {
        console.log(`   🌐 使用本地代理: ${LOCAL_PROXY}`);
        launchArgs.push(`--proxy-server=${LOCAL_PROXY}`);
    }

    const browser = await puppeteer.launch({
        headless: process.env.CI ? "new" : false,
        args: launchArgs,
        defaultViewport: { width: 1920, height: 1080 }
    });

    try {
        const page = await browser.newPage();

        // 设置 User-Agent
        await page.setUserAgent(USER_AGENT);

        // 反爬虫设置
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });
        });

        console.log(`   🔗 访问: ${TARGET_URL}`);

        // 访问页面，等待网络空闲
        await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });

        // 等待核心元素出现，增加超时时间和重试
        console.log("   ⏳ 等待元素渲染...");
        await page.waitForSelector(".season-count-content", { timeout: 30000 });

        // --- 核心 DOM 提取逻辑 ---
        const eventsData = await page.evaluate(() => {
            const results = [];
            
            // 1. 找到所有包含倒计时的容器 - 使用更广泛的选择器
            const containers = document.querySelectorAll("[data-v-cec54305], .season-count-content");
            
            console.log(`找到 ${containers.length} 个倒计时容器`);

            Array.from(containers).forEach(container => {
                // 2. 提取标题 - 使用更广泛的选择器
                const titleEl = container.querySelector(".count-text-row, .count-text .count-text-row, .uni-countdown__title");
                const title = titleEl ? titleEl.innerText.trim() : "";
                
                // 3. 提取时间字符串 - 使用更广泛的选择器
                const timeEl = container.querySelector(".tip, .countdown, .uni-countdown__number, .uni-countdown__splitter");
                const timeStr = timeEl ? timeEl.innerText.trim() : "";

                // 如果直接没有找到时间，尝试从子元素中提取
                if (!timeStr && container.textContent) {
                    const timeMatches = container.textContent.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);
                    if (timeMatches && timeMatches[0]) {
                        timeStr = timeMatches[0];
                    }
                }

                if (title && timeStr) {
                    results.push({
                        rawTitle: title,
                        targetTimeStr: timeStr
                    });
                }
            });

            return results;
        });

        console.log(`   ⚡️ 抓取到 ${eventsData.length} 个条目`);

        // --- 数据清洗与格式化 ---
        const cleanData = processData(eventsData);

        const savePath = path.join(OUTPUT_DIR, OUTPUT_FILE);
        fs.writeFileSync(savePath, JSON.stringify(cleanData, null, 2));
        console.log(`   ✅ 数据已保存: ${savePath}`);

        // --- 上传到 OSS ---
        if (!OSS_CONFIG.accessKeyId || !OSS_CONFIG.accessKeySecret || !OSS_CONFIG.bucket) {
            console.warn('⚠️ OSS 配置不完整，跳过上传');
            return cleanData;
        }

        console.log('☁️ 正在上传至阿里云 OSS...');
        const OSS = require('ali-oss');
        const client = new OSS(OSS_CONFIG);
        const ossPath = `${config.ossPath}${OUTPUT_FILE}`;
        const content = Buffer.from(JSON.stringify(cleanData, null, 2));

        const result = await client.put(ossPath, content);

        console.log('🎉 任务完成！');
        console.log('OSS URL:', result.url);

        return cleanData;

    } catch (e) {
        console.error("❌ 抓取失败:", e.message);
        throw e;
    } finally {
        await browser.close();
    }
}

// --- 数据处理函数 ---
function processData(rawData) {
    const finalEvents = {
        updateTime: new Date().toISOString(),
        helltide: null,
        boss: null,
        legion: null,
        events: [] // 添加所有事件的原始数据
    };

    rawData.forEach(item => {
        const title = item.rawTitle;
        const timeStr = item.targetTimeStr;

        // 解析时间戳
        const timestamp = parseChinaTime(timeStr);

        // 1. 识别 地狱狂潮
        if (title.includes("地狱狂潮")) {
            if (title.includes("剩余")) {
                finalEvents.helltide = {
                    status: "active",
                    endTime: timestamp,
                    zone: "未知区域"
                };
            } else if (title.includes("开始") && !finalEvents.helltide) {
                finalEvents.helltide = {
                    status: "pending",
                    startTime: timestamp,
                    zone: "未知区域"
                };
            }
        }
        // 2. 识别 军团
        else if (title.includes("军团")) {
            finalEvents.legion = {
                status: "pending",
                startTime: timestamp
            };
        }
        // 3. 识别 BOSS (包括徘徊死魔等)
        else if (title.includes("徘徊死魔") || title.includes("Boss")) {
            finalEvents.boss = {
                status: "pending",
                name: title,
                expectedTime: timestamp
            };
        }
        // 4. 其他事件类型
        else {
            finalEvents.events.push({
                type: "other",
                name: title,
                expectedTime: timestamp
            });
        }
    });

    return finalEvents;
}

// 辅助：将 "2026-01-14 17:30:00" (CST) 转为 UTC 时间戳
function parseChinaTime(str) {
    // str 格式: YYYY-MM-DD HH:mm:ss
    const isoStr = str.replace(" ", "T") + "+08:00";
    return new Date(isoStr).getTime();
}

// 主入口
if (require.main === module) {
    runD4Task().catch(console.error);
}

module.exports = { runD4Task };
