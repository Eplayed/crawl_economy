require("dotenv").config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const uploadAll = require("./upload_to_oss");

// --- 1. 配置 ---
// 目标地址 (d2core 首页或 D4 专题页)
const TARGET_URL = "https://www.d2core.com/"; 
const OUTPUT_FILE = "d4_events.json";
const OUTPUT_DIR = "./data";

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function runD4Task() {
  console.log("🔥 [D4 助手] 启动 S11 计时器抓取...");
  
  // 启动浏览器 (模拟 iPhone X)
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 375, height: 812, isMobile: true, hasTouch: true }
  });

  try {
    const page = await browser.newPage();
    
    // 设置 UserAgent，防止被识别为爬虫，同时请求移动端页面
    await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1");

    console.log(`   🔗 访问: ${TARGET_URL}`);
    
    // 访问页面，等待网络空闲 (确保 uni-app 数据加载完毕)
    await page.goto(TARGET_URL, { waitUntil: "networkidle0", timeout: 60000 });

    // 根据截图，核心卡片的类名是 .season-count-content
    // 等待该元素出现，最多等 15 秒
    try {
        await page.waitForSelector(".season-count-content", { timeout: 15000 });
    } catch (e) {
        throw new Error("❌ 页面加载超时或结构已变，未找到 .season-count-content");
    }

    // --- 2. 核心 DOM 提取 ---
    console.log("   👀 正在提取页面数据...");
    const rawData = await page.evaluate(() => {
      const items = [];
      // 获取所有计时卡片
      const cards = document.querySelectorAll(".season-count-content");

      cards.forEach(card => {
        // 提取标题: 截图中的 "徘徊死魔", "本轮地狱狂潮剩余时间"
        // 路径: .count-text -> .count-text-row (取第一个非空的)
        const titleEl = card.querySelector(".count-text .count-text-row");
        let rawTitle = titleEl ? titleEl.innerText.trim() : "";
        
        // 提取时间: 截图中的 "2026-01-14 17:30:00"
        // 路径: .tip
        const timeEl = card.querySelector(".tip");
        let timeStr = timeEl ? timeEl.innerText.trim() : "";

        // 有些布局可能不同，简单校验
        if (rawTitle && timeStr) {
            items.push({ rawTitle, timeStr });
        }
      });
      return items;
    });

    if (rawData.length === 0) {
        throw new Error("❌ 未抓取到任何事件数据，请检查选择器");
    }

    console.log(`   ⚡️ 原始抓取: ${rawData.length} 条数据`);

    // --- 3. 数据清洗与格式化 (适配小程序) ---
    const cleanData = processData(rawData);

    // --- 4. 保存与上传 ---
    const savePath = path.join(OUTPUT_DIR, OUTPUT_FILE);
    fs.writeFileSync(savePath, JSON.stringify(cleanData, null, 2));
    console.log(`   ✅ 本地保存成功: ${savePath}`);

    // 如果作为主模块运行，则执行上传
    if (require.main === module) {
      console.log("   🚀 准备上传至 OSS...");
      // 这里调用你之前的 upload_to_oss 脚本
      await uploadAll();
    }

  } catch (e) {
    console.error("❌ 任务失败:", e.message);
    process.exit(1); // 报错退出，让 GitHub Actions 知道失败了
  } finally {
    await browser.close();
  }
}

// --- 🛠 数据处理逻辑 (核心算法) ---
function processData(rawItems) {
    const result = {
        updateTime: Date.now(),
        // 采用数组结构，方便前端 v-for 渲染 S11 新事件
        events: [] 
    };

    rawItems.forEach(item => {
        const title = item.rawTitle; // e.g., "本轮地狱狂潮剩余时间"
        const timeStr = item.timeStr; // e.g., "2026-01-14 17:30:00"

        // 1. 解析时间 (强制北京时间 UTC+8)
        // timeStr 格式通常是 YYYY-MM-DD HH:mm:ss
        // 加上 "+08:00" 让 Date 对象知道这是中国时间
        const targetTimestamp = new Date(timeStr.replace(" ", "T") + "+08:00").getTime();

        // 2. 识别事件类型
        let type = "unknown";
        let status = "pending"; // pending=等待开始, active=进行中
        let label = "距离开始";
        let zone = ""; // 区域名

        // --- 地狱狂潮逻辑 ---
        if (title.includes("地狱狂潮")) {
            type = "helltide";
            // 判断状态：截图里有 "剩余时间" 字样代表进行中
            if (title.includes("剩余")) {
                status = "active";
                label = "剩余时间";
            } else {
                status = "pending";
                label = "距离开始";
            }
            
            // 尝试提取区域名 (如果 d2core 写在标题里)
            // 比如 "地狱狂潮(干燥平原)"
            // 如果没写，前端可以根据 hour % 5 的算法自己算，或者显示“未知区域”
            const zoneMatch = title.match(/[\(（](.*?)[\)）]/) || title.match(/-(\S+)/);
            if (zoneMatch) zone = zoneMatch[1];
        }
        // --- 军团事件逻辑 ---
        else if (title.includes("军团")) {
            type = "legion";
            label = "距离开始";
        }
        // --- 世界BOSS逻辑 (包含常见名字) ---
        else if (["BOSS", "阿煞巴", "贪魔", "死魔", "咒金兽"].some(k => title.includes(k))) {
            type = "boss";
            label = "距离降临";
        }
        // --- S11 赛季专属 (兜底逻辑) ---
        else {
            type = "season_event"; // 标记为赛季事件
            label = "倒计时";
        }

        result.events.push({
            type,       // helltide, boss, legion, season_event
            name: title, // 显示的标题
            zone,       // 区域 (如果有)
            status,     // active / pending
            label,      // 前端显示的文案
            targetTime: targetTimestamp,
            rawTimeStr: timeStr
        });
    });

    // 排序优化：把正在进行(active)的放前面，然后按时间排序
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