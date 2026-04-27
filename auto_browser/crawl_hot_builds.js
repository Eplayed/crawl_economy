/**
 * @Description: 爬取 poe2.caimogu.cc 热门BD数据
 * @Date: 2026-04-27
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// 目标URL
const TARGET_URL = 'https://poe2.caimogu.cc/planner#/plan/community-builds';

/**
 * 主函数
 */
async function crawlHotBuilds() {
  console.log('🚀 开始爬取热门BD...');
  
  const browser = await puppeteer.launch({
    headless: config.crawler.headless !== false ? "new" : false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });
  
  const page = await browser.newPage();
  
  // 设置视口
  await page.setViewport({ width: 1920, height: 1080 });
  
  // 设置User-Agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  // 拦截请求，查看是否有API调用
  // await page.on('response', response => {
  //   if (response.url().includes('api') || response.url().includes('build')) {
  //     console.log('API Response:', response.url());
  //   }
  // });
  
  try {
    console.log('📍 访问目标页面...');
    await page.goto(TARGET_URL, { 
      waitUntil: 'networkidle0',
      timeout: 120000 
    });
    
    console.log('✅ 页面加载完成，等待Vue渲染...');

    // 等待页面完全渲染 (新版Puppeteer用Promise替代waitForTimeout)
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 滚动页面加载更多数据
    console.log('📜 滚动页面加载数据...');
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // 尝试多种方式获取数据
    let bdData = [];
    
    // 方式1: 尝试从 main 元素获取
    bdData = await page.evaluate(() => {
      // 尝试多个可能的选择器
      const selectors = [
        'main',
        '.community-builds',
        '[class*="build-list"]',
        '[class*="community"]',
        '[class*="plan"]'
      ];
      
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.innerText || '';
          if (text.includes('作者') && text.includes('更新时间')) {
            return { method: sel, text: text };
          }
        }
      }
      
      // 尝试获取整个页面的文本
      const bodyText = document.body.innerText;
      if (bodyText.includes('作者') && bodyText.includes('更新时间')) {
        return { method: 'body', text: bodyText };
      }
      
      return null;
    });
    
    if (!bdData || !bdData.text) {
      console.log('⚠️ 无法找到BD列表，尝试截图分析...');
      await page.screenshot({ path: path.join(config.dataDir, 'debug_page.png'), fullPage: true });
      console.log('📸 截图已保存到 debug_page.png');
      
      // 尝试获取页面结构
      const pageStructure = await page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title,
          bodyClasses: document.body.className,
          mainExists: !!document.querySelector('main'),
          vueApp: !!document.querySelector('[data-v-app]'),
          bodyText: document.body.innerText.substring(0, 500)
        };
      });
      console.log('🔍 页面结构:', JSON.stringify(pageStructure, null, 2));
      
      bdData = { method: 'fallback', text: pageStructure.bodyText };
    } else {
      console.log(`✅ 使用选择器 "${bdData.method}" 获取到文本`);
    }
    
    // 解析BD数据
    const items = [];
    if (bdData && bdData.text) {
      const text = bdData.text;
      const parts = text.split('作者：');
      
      for (let i = 1; i < parts.length; i++) {
        const prev = parts[i - 1];
        const curr = parts[i];
        
        // 获取BD名称
        const prevLines = prev.split('\n').filter(l => l.trim());
        let name = prevLines[prevLines.length - 1] || '';
        name = name.replace(/^\s+|\s+$/g, '');
        
        if (!name || name.length > 50) continue;
        
        // 解析作者行
        const firstLine = curr.split('\n')[0] || '';
        const authorMatch = firstLine.match(/^([^|]+)/);
        const timeMatch = firstLine.match(/更新时间[：:]\s*(\d{4}年\d{2}月\d{2}日)/);
        
        // 解析赛季和数字
        const afterSeason = curr.split('赛季：')[1] || '';
        const seasonLines = afterSeason.split('\n').filter(l => l.trim());
        const season = seasonLines[0] || '';
        const numLine = seasonLines[1] || '';
        const numsMatch = numLine.match(/^(\d+)(\d{2})$/);
        
        const fav = numsMatch ? parseInt(numsMatch[1]) : 0;
        const likes = numsMatch ? parseInt(numsMatch[2]) : 0;
        
        // 提取标签
        const tags = [];
        if (curr.includes('升级')) tags.push('升级');
        if (curr.includes('攻坚')) tags.push('攻坚');
        if (curr.includes('硬核模式')) tags.push('硬核模式');
        if (curr.includes('独狼模式')) tags.push('独狼模式');
        
        items.push({
          name: name,
          author: authorMatch ? authorMatch[1].trim() : '未知',
          updateTime: timeMatch ? timeMatch[1] : '',
          season: season,
          favorites: fav,
          likes: likes,
          tags: tags
        });
      }
    }
    
    console.log(`📊 获取到 ${items.length} 条BD数据`);
    
    // 如果还是没有数据，尝试API请求
    if (items.length === 0) {
      console.log('⚠️ DOM解析失败，尝试直接请求API...');
      
      // 尝试常见的API端点
      const apiUrls = [
        'https://poe2.caimogu.cc/api/community-builds',
        'https://poe2.caimogu.cc/api/builds/hot',
        'https://poe2.caimogu.cc/planner/api/community-builds'
      ];
      
      for (const apiUrl of apiUrls) {
        try {
          const response = await page.evaluate(async (url) => {
            const res = await fetch(url);
            if (res.ok) {
              return await res.json();
            }
            return null;
          }, apiUrl);
          
          if (response) {
            console.log(`✅ API请求成功: ${apiUrl}`);
            console.log('📦 响应数据:', JSON.stringify(response).substring(0, 200));
            break;
          }
        } catch (e) {
          console.log(`❌ API请求失败: ${apiUrl}`);
        }
      }
    }
    
    // 转换为 community.json 格式
    const communityData = items.map((bd, index) => ({
      id: `CaiMoGu_${Date.now()}_${index}`,
      meta: {
        title: bd.name,
        author: bd.author,
        class: 'Druid',
        name: '德鲁伊',
        tags: bd.tags && bd.tags.length > 0 ? bd.tags : ['热门推荐']
      },
      intro: {
        desc: `来自踩蘑菇网的热门BD ${bd.name}，作者 ${bd.author}，更新于 ${bd.updateTime}`,
        pros: ['社区热门推荐', '经过玩家验证'],
        cons: ['具体效果因人而异']
      },
      skills: [],
      equipment: {
        notes: `数据来源：踩蘑菇网 | 更新时间: ${bd.updateTime} | 收藏:${bd.favorites} 点赞:${bd.likes}`
      },
      source: {
        updateTime: bd.updateTime,
        platform: 'caimogu',
        originalAuthor: bd.author,
        favorites: bd.favorites,
        likes: bd.likes
      }
    }));
    
    // 保存数据
    const outputPath = path.join(config.dataDir, 'community.json');
    fs.writeFileSync(outputPath, JSON.stringify(communityData, null, 2), 'utf8');
    console.log(`💾 数据已保存到: ${outputPath}`);
    
    // 输出预览
    if (items.length > 0) {
      console.log('\n📋 数据预览:');
      items.slice(0, 5).forEach((bd, i) => {
        console.log(`${i + 1}. ${bd.name} - ${bd.author} (收藏:${bd.favorites} 点赞:${bd.likes})`);
      });
    }
    
    // 上传到OSS
    try {
      const uploadScript = require('./upload_to_oss');
      await uploadScript();
      console.log('☁️ 数据已上传到OSS');
    } catch (e) {
      console.warn('⚠️ OSS上传失败:', e.message);
    }
    
    return communityData;
    
  } catch (error) {
    console.error('❌ 爬取失败:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// 运行
if (require.main === module) {
  crawlHotBuilds()
    .then(() => {
      console.log('✅ 爬取完成');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ 错误:', err);
      process.exit(1);
    });
}

module.exports = { crawlHotBuilds };
