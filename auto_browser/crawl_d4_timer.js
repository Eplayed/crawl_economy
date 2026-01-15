require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const uploadAll = require("./upload_to_oss");

// --- 1. 配置 ---
const TARGET_URL = "https://www.d2core.com/"; 
const OUTPUT_FILE = "d4_events.json";
const OUTPUT_DIR = "./data";

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function runD4Task() {
  console.log("🔥 [D4 助手] 启动 S11 计时器抓取 (DOM 修正版)...");

  // 启动浏览器 (模拟 iPhone X)
  const browser = await puppeteer.launch({
    headless: process.env.CI ? "new" : false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=375,812"
    ],
    defaultViewport: { width: 375, height: 812, isMobile: true, hasTouch: true }
  });

  try {
    const page = await browser.newPage();
    
    // 伪装 UserAgent
    await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1");
    
    // --- 关键：设置时区为北京时间 ---
    // 很多倒计时库会依赖本地时间进行计算，如果 Puppeteer 默认是 UTC，可能导致计算出的时间偏差
    await page.emulateTimezone('Asia/Shanghai');

    // --- 监听网络响应 (尝试直接获取 API 数据) ---
    let apiData = null;
    page.on('response', async response => {
        const url = response.url();
        // 猜测 API 可能包含 timer, event, season 等关键词
        if (url.includes('/api/') && (url.includes('timer') || url.includes('event'))) {
            try {
                const json = await response.json();
                // 简单判断结构
                if (json && (json.data || Array.isArray(json))) {
                    console.log(`   🕵️ 捕获到疑似 API: ${url}`);
                    // 这里暂存，后续分析
                    // apiData = json; 
                }
            } catch (e) {}
        }
    });

    console.log(`   🔗 访问: ${TARGET_URL}`);
    
    // 访问页面
    try {
      // 增加超时时间，d2core 有时加载慢
      await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 60000 });
    } catch (e) {
      console.warn("⚠️ 页面加载较慢，尝试继续解析...");
    }

    // --- 关键修正：等待具体的子元素加载 ---
    // 截图显示数据在 .season-count-content 下的 .count-text 里
    try {
        await page.waitForSelector(".season-count-content .count-text", { timeout: 30000 });
        
        // 模拟滚动，触发可能的懒加载或 JS 激活
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight / 2);
        });

        // 额外等待 5 秒，确保 vue 数据水合完成并计算出正确时间
        console.log("   ⏳ 等待数据渲染 (5s)...");
        await new Promise(r => setTimeout(r, 5000));
    } catch (e) {
        throw new Error("❌ 未找到倒计时元素，页面结构可能已变");
    }

    // --- 2. 核心 DOM 提取 (根据截图修复) ---
    console.log("   👀 正在提取页面数据...");
    const rawData = await page.evaluate(() => {
      const items = [];
      
      // 修正点：直接选择所有的 .count-text 块
      // 截图层级：.season-count-content (父) -> .count-text (子，有多个)
      const cards = document.querySelectorAll(".season-count-content .count-text");

      cards.forEach((card, index) => {
        // 1. 提取标题
        // 路径: 当前 .count-text -> .count-text-row
        const titleEl = card.querySelector(".count-text-row");
        // 2. 提取时间
        // 路径: 当前 .count-text -> .tip
        const timeEl = card.querySelector(".tip");

        if (titleEl && timeEl) {
            const rawTitle = titleEl.innerText.trim();
            const timeStr = timeEl.innerText.trim();
            
            // 简单过滤无效数据
            if (rawTitle && timeStr.includes("-")) {
                items.push({ rawTitle, timeStr });
            }
        }
      });
      return items;
    });

    if (rawData.length === 0) {
        throw new Error("❌ 解析结果为空，请检查选择器");
    }

    console.log(`   ⚡️ 成功提取: ${rawData.length} 条数据`);
    // 打印预览，方便调试
    rawData.forEach(item => console.log(`      Found: [${item.rawTitle}] -> ${item.timeStr}`));

    // --- 3. 数据清洗 ---
    const cleanData = processData(rawData);

    // --- 4. 保存 ---
    const savePath = path.join(OUTPUT_DIR, OUTPUT_FILE);
    fs.writeFileSync(savePath, JSON.stringify(cleanData, null, 2));
    console.log(`   ✅ 本地保存成功: ${savePath}`);

    // 上传 OSS
    if (require.main === module) {
      console.log("   🚀 上传至 OSS...");
      await uploadAll();
    }

  } catch (e) {
    console.error("❌ 任务失败:", e.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// --- 🛠 数据处理逻辑 (匹配截图中的中文) ---
function processData(rawItems) {
    const result = {
        updateTime: Date.now(),
        events: [] 
    };

    rawItems.forEach(item => {
        const title = item.rawTitle; 
        const timeStr = item.timeStr; 

        // 强制解析为北京时间 UTC+8
        const targetTimestamp = new Date(timeStr.replace(" ", "T") + "+08:00").getTime();

        let type = "unknown";
        let status = "pending"; 
        let label = "距离开始";
        let zone = ""; 

        // --- 逻辑适配截图中的文字 ---
        
        // 1. 地狱狂潮
        if (title.includes("地狱狂潮")) {
            type = "helltide";
            // 截图示例: "本轮地狱狂潮剩余时间" -> Active
            if (title.includes("剩余")) {
                status = "active";
                label = "剩余时间";
            } else {
                // 截图示例: "距离下轮地狱狂潮开始" -> Pending
                status = "pending";
                label = "距离开始";
            }
        }
        // 2. 军团
        else if (title.includes("军团")) {
            type = "legion";
            label = "距离开始";
        }
        // 3. Boss (截图示例: "疫王"阿煞巴, 徘徊死魔)
        else if (
            title.includes("阿煞巴") || 
            title.includes("贪魔") || 
            title.includes("死魔") || 
            title.includes("咒金兽") || 
            title.includes("BOSS")
        ) {
            type = "boss";
            label = "距离降临";
        }
        else {
            type = "season_event";
            label = "倒计时";
        }

        result.events.push({
            type,       
            name: title,
            zone,       
            status,     
            label,      
            targetTime: targetTimestamp,
            rawTimeStr: timeStr
        });
    });

    // 排序：进行中 -> Boss -> 其他
    result.events.sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1;
        if (b.status === 'active' && a.status !== 'active') return 1;
        return a.targetTime - b.targetTime;
    });

    return result;
}

if (require.main === module) {
  runD4Task();
}

module.exports = { runD4Task };