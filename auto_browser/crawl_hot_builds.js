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
 * 解析BD列表数据
 */
function parseBDList(html) {
  // 使用正则从innerText提取数据
  const bdPattern = /([^|\n]+?)\s*\|\s*作者：([^|]+)\|\s*更新时间：(\d{4}年\d{2}月\d{2}日)\s*\|\s*赛季：([^|\n]+)\s*\|\s*(\d+)(\d+)\s*(.*?)(?=\s*(?:[^|\n]+?)\s*\|\s*作者：|$)/g;
  
  // 简单解析：按作者：分割
  const sections = html.split('作者：');
  const results = [];
  
  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const lines = section.split('\n').filter(l => l.trim());
    
    if (lines.length >= 2) {
      const authorInfo = lines[0]; // 作者信息
      const match = authorInfo.match(/^([^|]+)\|?\s*更新时间：(\d{4}年\d{2}月\d{2}日)\s*\|\s*赛季：([^|\n]+)\s*\|\s*(\d+)(\d+)/);
      
      if (match) {
        // 获取BD名称（从上一段）
        const prevSection = sections[i - 1];
        const nameMatch = prevSection.match(/([^\n|]+)\s*$/);
        const name = nameMatch ? nameMatch[1].trim() : '未命名BD';
        
        // 提取标签
        const tagsSection = section.substring(section.indexOf(lines[0]) + lines[0].length);
        const tags = [];
        if (tagsSection.includes('升级')) tags.push('升级');
        if (tagsSection.includes('攻坚')) tags.push('攻坚');
        if (tagsSection.includes('硬核模式')) tags.push('硬核模式');
        if (tagsSection.includes('独狼模式')) tags.push('独狼模式');
        
        results.push({
          name: name.replace(/^\s+|\s+$/g, ''),
          author: match[1].trim(),
          updateTime: match[2],
          season: match[3].trim(),
          favorites: parseInt(match[4]),
          likes: parseInt(match[5]),
          tags: tags
        });
      }
    }
  }
  
  return results;
}

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
      '--disable-web-security'
    ]
  });
  
  const page = await browser.newPage();
  
  // 设置视口
  await page.setViewport({ width: 1280, height: 800 });
  
  // 设置User-Agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  try {
    console.log('📍 访问目标页面...');
    await page.goto(TARGET_URL, { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });
    
    // 等待BD列表加载
    await page.waitForSelector('main', { timeout: 30000 });
    // 等待Vue渲染完成
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('✅ 页面加载完成');
    
    // 获取BD列表数据
    const bdData = await page.evaluate(() => {
      try {
        const listContainer = document.querySelector('main').children[2];
        if (!listContainer) return [];
        
        const items = [];
        const fullText = listContainer.innerText || '';
        const parts = fullText.split('作者：');
        
        for (let i = 1; i < parts.length; i++) {
          const prev = parts[i - 1];
          const curr = parts[i];
          
          // 获取BD名称（上一个块的末尾非空行）
          const prevLines = prev.split('\n').filter(l => l.trim());
          const name = prevLines[prevLines.length - 1] || '';
          
          if (!name) continue;
          
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
            author: authorMatch ? authorMatch[1].trim() : '',
            updateTime: timeMatch ? timeMatch[1] : '',
            season: season,
            favorites: fav,
            likes: likes,
            tags: tags
          });
        }
        
        return items;
      } catch (e) {
        return { error: e.message };
      }
    });
    

    
    console.log(`📊 获取到 ${bdData.length} 条BD数据`);
    
    // 构建最终数据
    const result = {
      updateTime: new Date().toISOString(),
      source: 'caimogu',
      sourceUrl: TARGET_URL,
      count: bdData.length,
      data: bdData
    };
    
    // 保存数据
    const outputPath = path.join(config.dataDir, 'hot_builds.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(`💾 数据已保存到: ${outputPath}`);
    
    // 输出预览
    console.log('\n📋 数据预览:');
    bdData.slice(0, 5).forEach((bd, i) => {
      console.log(`${i + 1}. ${bd.name} - ${bd.author} (收藏:${bd.favorites} 点赞:${bd.likes})`);
    });
    
    // 上传到OSS
    try {
      const uploadScript = require('./upload_to_oss');
      await uploadScript();
      console.log('☁️ 数据已上传到OSS');
    } catch (e) {
      console.warn('⚠️ OSS上传失败:', e.message);
    }
    
    return result;
    
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
