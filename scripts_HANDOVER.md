# 项目交接文档：PoE2 & D4 爬虫合集
## 一、项目简介
- 项目名称 ： poe2-economy-news-crawler
- 目标功能 ：
  - 定时抓取 PoE2 经济数据（汇率），生成 economy.json 并上传到阿里云 OSS。
  - 定时抓取 PoE2 新闻列表 + 详情页，生成列表与多篇详情 JSON，并上传 OSS。
  - 定时抓取 Diablo 4（D4）游戏内事件倒计时（地狱狂潮、军团、世界 Boss 等），生成 d4_events.json 并上传 OSS，供小程序/前端展示。
- 技术栈 ：
  - Node.js（脚本式项目，无框架）
  - Puppeteer（无头浏览器爬虫）
  - ali-oss（对接阿里云 OSS）
  - dotenv（加载本地环境变量）
  - GitHub Actions（定时任务 + CI 运行环境）
核心代码集中在 auto_browser 目录下。

## 二、目录结构与关键文件
项目根目录结构：

- .github/workflows/
  - d4_timer.yml ：D4 事件定时抓取。
  - update_economy.yml ：PoE2 汇率定时抓取。
  - update_news.yml ：PoE2 新闻（含详情）定时抓取。
- auto_browser/
  - 数据目录：
    - data/
      - economy.json ：PoE2 汇率数据。
      - news_caimogu.json ：PoE2 新闻列表。
      - news_detail/*.json ：多篇新闻详情。
      - d4_events.json ：D4 事件定时数据。
  - 配置与上传：
    - config.js ：统一配置（数据目录、OSS 信息、通用 crawler 配置）。
    - upload_to_oss.js ：递归上传 data/ 下的文件到 OSS。
  - 爬虫脚本：
    - crawl_economy.js ：PoE2 汇率爬虫。
    - crawl_news.js ：PoE2 新闻列表爬虫 V1。
    - crawl_news_detail.js ：新闻详情页爬虫。
    - crawl_news_with_details.js ：整合列表 + 详情 + OSS 上传的 V2 总控脚本。
    - crawl_d4_timer.js ：D4 倒计时爬虫（d2core）。
- 根目录：
  - package.json ：依赖与 npm 脚本定义。
  - package-lock.json ：锁定依赖版本。
  - .gitignore ：忽略 node_modules 等。
## 三、配置与环境说明
### 1. Node 版本
- GitHub Actions 上统一使用 Node 20 。
- 本地建议 Node 18+（推荐和 CI 一致 20）。
### 2. 环境变量（.env / GitHub Secrets）
在 auto_browser/config.js 里读取 OSS 配置：

- config.js
```
oss: {
  region: process.env.OSS_REGION || ossConfig.region || 
  'oss-cn-hangzhou',
  bucket: process.env.OSS_BUCKET || ossConfig.bucket,
  accessKeyId: process.env.OSS_ACCESS_KEY_ID || ossConfig.
  accessKeyId,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || ossConfig.
  accessKeySecret,
}
```
需要配置的环境变量：

- OSS_REGION ：如 oss-cn-hangzhou
- OSS_BUCKET ：你的 OSS bucket 名称
- OSS_ACCESS_KEY_ID
- OSS_ACCESS_KEY_SECRET
- 可选：
  - USE_PROXY=true ：本地如需走代理（如 Clash），用于 Puppeteer 访问外站。
  - NODE_ENV=production ：在 CI 中使用。
在 GitHub Actions 中，这些通过 Secrets 提供，在 workflows 中对应为：

```
env:
  OSS_REGION: ${{ secrets.OSS_REGION }}
  OSS_BUCKET: ${{ secrets.OSS_BUCKET }}
  OSS_ACCESS_KEY_ID: ${{ secrets.OSS_ACCESS_KEY_ID }}
  OSS_ACCESS_KEY_SECRET: ${{ secrets.OSS_ACCESS_KEY_SECRET }}
  CI: true
  NODE_ENV: production
```
### 3. oss-config.json（可选配置）
- auto_browser/config.js 会尝试读取根目录的 oss-config.json （ ../oss-config.json ），可在本地填入默认 OSS 配置以免每次设置环境变量。
- 在 CI 中通常只用环境变量即可。
## 四、核心爬虫脚本说明
### 1. PoE2 汇率爬虫：crawl_economy.js
文件：

- crawl_economy.js
关键点：

- 目标地址： https://poe.ninja/poe2/economy/vaal/currency
- 使用 Puppeteer + Request 拦截，只允许非图片请求。
- 通过监听 response ，捕获新版经济数据 API：
  
  ```
  if (url.includes("/economy/exchange/current/overview")) {
    const json = await res.json();
    capturedData = json.lines || json.entries || [];
  }
  ```
- 数据翻译：
  
  - 从 rawId （如 perfect-chaos-orb ）通过一系列字典 MANUAL_DICT + dict_base.json 转换为中文名称。
- 输出结构（ auto_browser/data/economy.json ）大致为：
  
  ```
  {
    "updateTime": "2026-01-15T09:00:00.000Z",
    "league": "Fate of the Vaal",
    "rates": [
      {
        "id": "divine",
        "name": "神圣石",
        "enName": "Divine Orb",
        "price": 123.4,
        "change": -2.1,
        "iconName": "divine"
      }
    ]
  }
  ```
- 运行完成后会调用 upload_to_oss.js 上传所有数据文件。
### 2. PoE2 新闻爬虫：crawl_news* 系列 2.1 列表爬虫 V1：crawl_news.js
文件：

- crawl_news.js
关键点：

- 目标地址： https://www.caimogu.cc/circle/449.html
- 反爬设置：
  
  - 自定义 User-Agent
  - 修改 navigator.webdriver
- DOM 解析：
  
  - 定位 .fast-navigate.block .content-container 下的 .nav 列表。
  - 每个 nav 生成一个分类，分类下包含若干 articles （标题 + URL）。
- 输出 JSON： auto_browser/data/news_caimogu.json ：
  
  ```
  {
    "updated_at": "2026-01-15T09:00:00.000Z",
    "source": "caimogu",
    "source_url": "https://www.caimogu.cc/circle/449.html",
    "data": [
      {
        "category": "0.4 新赛季",
        "articles": [
          { "title": "某某新赛季公告", "url": "https://...", 
          "is_new": true }
        ]
      }
    ]
  }
  ``` 2.2 详情页爬虫：crawl_news_detail.js
文件：

- crawl_news_detail.js
关键点：

- 输入：文章 URL 列表。
- 对每个 URL：
  - 打开页面，处理内容区（清理空段落，处理图片样式等）。
  - 生成 HTML 内容 + meta 信息。
  - 保存到 auto_browser/data/news_detail/<id>.json 。
  - 可选上传到 OSS（ news_details/ 路径）。 2.3 一站式爬虫：crawl_news_with_details.js
文件：

- crawl_news_with_details.js
职责：

1. 调用与 V1 相似的逻辑抓取列表。
2. 根据列表中的 URL 批量调用 crawlMultipleArticles 抓取详情。
3. 保存列表 JSON + 多个详情 JSON。
4. 调用 upload_to_oss.js 和 uploadDetailsToOSS 统一上传。
GitHub Actions 默认调用的是这个 V2 脚本。

### 3. D4 事件倒计时爬虫：crawl_d4_timer.js
文件：

- crawl_d4_timer.js
功能：从 https://www.d2core.com/ 抓取 D4 相关的倒计时卡片（地狱狂潮、军团、Boss），输出统一结构给小程序使用。

关键实现点：

1. 浏览器配置 ：
   
   - 模拟 iPhone X 视口（移动端布局）。
   - User-Agent 为移动 Safari。
   - headless: process.env.CI ? "new" : false ，CI 上无头，本地可有头。
   - 关键： await page.emulateTimezone('Asia/Shanghai'); ，保证时间计算为北京时间，避免早上 08:55 这种错误。
2. 等待策略 ：
   
   - page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 60000 }) 。
   - page.waitForSelector(".season-count-content .count-text", { timeout: 30000 }) 。
   - 滚动到页面中部触发潜在懒加载。
   - 再额外等待 5 秒，确保 Vue/uni-app 完成水合 & 计时。
3. DOM 解析 ：
   
   ```
   const cards = document.querySelectorAll(".season-count-content .
   count-text");
   
   cards.forEach(card => {
     const titleEl = card.querySelector(".count-text-row");
     const timeEl = card.querySelector(".tip");
     const rawTitle = titleEl.innerText.trim();
     const timeStr = timeEl.innerText.trim(); // 形如 2026-01-15 
     17:55:00
   });
   ```
4. 数据清洗（processData） ：
   
   - 统一转为时间戳（北京时间）：
     
     ```
     const targetTimestamp = new Date(timeStr.replace(" ", "T") + 
     "+08:00").getTime();
     ```
   - 判断类型：
     
     - 包含“地狱狂潮” → type = "helltide" ，根据是否包含“剩余”判断 status 为 active 或 pending 。
     - 包含“军团” → type = "legion" 。
     - 包含 “阿煞巴 / 贪魔 / 死魔 / 咒金兽 / BOSS / 徘徊死魔” → type = "boss" 。
     - 其他 → type = "season_event" 。
   - 最终结构（ auto_browser/data/d4_events.json ）：
     
     ```
     {
       "updateTime": 1768466024098,
       "events": [
         {
           "type": "helltide",
           "name": "本轮地狱狂潮剩余时间",
           "zone": "",
           "status": "active",
           "label": "剩余时间",
           "targetTime": 1768438500000,
           "rawTimeStr": "2026-01-15 17:55:00"
         },
         {
           "type": "boss",
           "name": "徘徊死魔",
           "zone": "",
           "status": "pending",
           "label": "距离降临",
           "targetTime": 1768446000000,
           "rawTimeStr": "2026-01-15 18:00:00"
         }
       ]
     }
     ```
   - 按规则排序：优先 status === 'active' ，再按照 targetTime 升序。
5. 上传逻辑 ：
   
   - 与其他脚本一样，调用 upload_to_oss.js 把 auto_browser/data 下所有业务数据上传到 OSS。
## 五、GitHub Actions 定时任务说明
### 1. PoE2 汇率：update_economy.yml
文件：

- update_economy.yml
要点：

- 触发：
  - cron: '0 20,2,8,14 * * *' （UTC），对应每天北京时间 04:00 / 10:00 / 16:00 / 22:00。
  - 支持 workflow_dispatch 手动触发。
- 步骤：
  - checkout → setup-node (Node 20, cache npm) → npm install → node auto_browser/crawl_economy.js 。
  - 通过 env 将 OSS 配置与 CI=true 注入。
### 2. PoE2 新闻：update_news.yml
文件：

- update_news.yml
要点：

- 触发：
  - cron: '0 22,4,10,16 * * *' （UTC），对应每天北京时间 06:00 / 12:00 / 18:00 / 24:00。
- 步骤：
  - 同样使用 Node 20、npm cache。
  - 运行 npm run crawl:news:all （对应 package.json 中 auto_browser/crawl_news_with_details.js ）。
  - 环境变量同样注入 OSS 配置。
### 3. D4 计时器：d4_timer.yml
文件：

- d4_timer.yml
要点：

- 触发：
  - cron: '*/30 * * * *' ：每 30 分钟。
  - workflow_dispatch 手动触发。
- 步骤：
  - checkout + setup-node@v4 (Node 20 + npm cache)。
  - npm ci 安装依赖（更稳定）。
  - working-directory: auto_browser ，运行 node crawl_d4_timer.js 。
  - 环境变量： OSS_* + CI=true + NODE_ENV=production 。
- 运行日志中会显示：
  - Found: [徘徊死魔] -> 2026-01-15 18:00:00 等，便于手动对比是否与游戏内一致。
## 六、本地运行与调试说明
### 1. 安装依赖
```
cd crawl_economy
npm install
# 或使用 CI 同款
npm ci
```
### 2. 配置 .env（本地）
在 auto_browser 目录下创建 .env （如果需要）：

```
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=你的bucket
OSS_ACCESS_KEY_ID=你的AK
OSS_ACCESS_KEY_SECRET=你的SK

# 如果需要代理访问外网
USE_PROXY=true
```
注意： 不要 把 .env 提交到 Git。

### 3. 运行单个脚本
- PoE2 汇率：
  
  ```
  node auto_browser/crawl_economy.js
  # 或
  npm run crawl:economy
  ```
- PoE2 新闻（含详情 + OSS）：
  
  ```
  npm run crawl:news:all
  ```
- D4 计时器：
  
  ```
  cd auto_browser
  node crawl_d4_timer.js
  ```
运行成功后，可在 auto_browser/data/ 下查看 JSON，或者登录 OSS 查看对应路径下的文件。

## 七、扩展和维护建议
1. 网站结构变更 ：
   
   - 若目标站点调整页面结构：
     - PoE2 经济：检查 crawl_economy.js 中 response 监听的 API 路径与返回结构。
     - PoE2 新闻：检查 crawl_news.js 的 CSS 选择器 .fast-navigate.block 等。
     - D4 计时器：检查 crawl_d4_timer.js 中 .season-count-content .count-text 以及 .count-text-row / .tip 。
   - 一般只需调整选择器或 API URL，不需要大改逻辑。
2. OSS 路径规划 ：
   
   - 当前 config.ossPath 写死为 poe2-economy/ ：
     - PoE2 汇率/新闻/D4 计时器数据共享这个前缀。
   - 如后续要拆项目，可以考虑为不同业务使用子目录，比如 poe2/economy/ 、 poe2/news/ 、 d4/timer/ 。
3. 定时策略 ：
   
   - 如果要调整抓取频率，只需要修改对应 workflow 的 cron 表达式。
   - 建议 D4 计时器保持 15–30 分钟级别，PoE2 汇率和新闻保持当前策略即可。
4. 日志排错 ：
   
   - 所有脚本都有较详细的 console 日志。
   - GitHub Actions 失败时，可以直接在 Actions 页面查看某次 workflow run 的 Logs，定位是网络问题、选择器问题还是 OSS 认证问题。