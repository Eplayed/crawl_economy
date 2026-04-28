/**
 * @Description: 踩蘑菇BD详情页DOM抓取爬虫
 * @Date: 2026-04-28
 * 
 * 方案说明：
 * - 踩蘑菇网将技能、宝石等数据渲染为DOM文本
 * - 通过 page.evaluate() 读取innerText获取完整数据
 * - 天赋树Canvas需要截图
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// 目标URL列表
const TARGET_URLS = [
  'https://poe2.caimogu.cc/planner#/plan/YbwEdfXm', // 测试用
];

/**
 * 解析技能装配数据
 * @param {string} text - 页面文本
 */
function parseSkillsFromText(text) {
  const skills = [];
  
  // 技能组标记
  const skillGroupMarkers = [
    '生命残片', '魔力残片', '大法师', '魔侍祭司', 
    '闪电专精', '冰霜专精', '元素要害', '德瑞的毁灭',
    '暴击时施放', '彗星落', '冰墙', '雨淞', '冰川'
  ];
  
  // 辅助技能标记
  const supportMarkers = [
    '高效', '范围集中', '元素集中', '多重范围施法', '快速施法',
    '持续时间延长', '能量保存', '范围扩大', '天顶'
  ];
  
  // 按行分割并分析
  const lines = text.split('\n').filter(l => l.trim());
  
  let currentGroup = null;
  let groupIndex = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // 检测是否是技能组开始
    if (skillGroupMarkers.some(m => trimmed.includes(m))) {
      if (currentGroup) {
        skills.push(currentGroup);
      }
      groupIndex++;
      currentGroup = {
        groupName: `技能组${groupIndex}`,
        groupIndex: groupIndex,
        mainSkills: [],
        supportSkills: [],
        links: []
      };
      
      // 判断是主技能还是辅助
      if (supportMarkers.some(m => trimmed.includes(m))) {
        currentGroup.supportSkills.push(trimmed);
      } else {
        currentGroup.mainSkills.push(trimmed);
      }
      currentGroup.links.push({ name: trimmed, isSupport: supportMarkers.some(m => trimmed.includes(m)) });
      continue;
    }
    
    // 如果当前有技能组，收集技能
    if (currentGroup) {
      if (trimmed.length > 0 && trimmed.length < 30) {
        const isSupport = supportMarkers.some(m => trimmed.includes(m));
        currentGroup.links.push({ name: trimmed, isSupport });
        
        if (isSupport) {
          if (!currentGroup.supportSkills.includes(trimmed)) {
            currentGroup.supportSkills.push(trimmed);
          }
        } else {
          if (!currentGroup.mainSkills.includes(trimmed)) {
            currentGroup.mainSkills.push(trimmed);
          }
        }
      }
    }
  }
  
  // 添加最后一个技能组
  if (currentGroup && currentGroup.links.length > 0) {
    skills.push(currentGroup);
  }
  
  return skills;
}

/**
 * 解析BD元数据
 * @param {string} text - 页面文本
 */
function parseMetaFromText(text) {
  const meta = {
    title: '',
    author: '',
    class: '',
    tags: []
  };
  
  // 提取标题（第一行大标题）
  const titleMatch = text.match(/([^\n]+)\n作者：/);
  if (titleMatch) {
    meta.title = titleMatch[1].trim();
  }
  
  // 提取作者
  const authorMatch = text.match(/作者：([^|]+)/);
  if (authorMatch) {
    meta.author = authorMatch[1].trim();
  }
  
  // 提取职业
  const classMatch = text.match(/赛季：([^"\n]+)/);
  if (classMatch) {
    meta.class = classMatch[1].trim();
  }
  
  // 提取标签
  if (text.includes('升级')) meta.tags.push('升级');
  if (text.includes('攻坚')) meta.tags.push('攻坚');
  if (text.includes('硬核')) meta.tags.push('硬核模式');
  if (text.includes('独狼')) meta.tags.push('独狼模式');
  
  return meta;
}

/**
 * 抓取单个BD详情页
 */
async function crawlBuildDetail(page, url) {
  console.log(`\n📍 访问: ${url}`);
  
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  
  // 等待Vue渲染
  await new Promise(resolve => setTimeout(resolve, 8000));
  
  // 从DOM获取数据
  const data = await page.evaluate(() => {
    const text = document.body.innerText;
    
    return {
      rawText: text,
      url: window.location.href,
      // 获取标题
      title: document.querySelector('h1, h2, [class*="title"]')?.innerText || '',
    };
  });
  
  // 解析数据
  const meta = parseMetaFromText(data.rawText);
  const skills = parseSkillsFromText(data.rawText);
  
  console.log(`  标题: ${meta.title}`);
  console.log(`  作者: ${meta.author}`);
  console.log(`  职业: ${meta.class}`);
  console.log(`  技能组: ${skills.length}个`);
  
  if (skills.length > 0) {
    skills.slice(0, 3).forEach((s, i) => {
      console.log(`    组${i + 1}: ${s.mainSkills.slice(0, 3).join(', ')}...`);
    });
  }
  
  // 尝试截图天赋树
  const treeRect = await page.evaluate(() => {
    // 尝试多种选择器
    const selectors = [
      '[class*="tree"] canvas',
      '[class*="passive"] canvas', 
      '[class*="天赋"] canvas',
      'canvas'
    ];
    
    for (const sel of selectors) {
      const canvas = document.querySelector(sel);
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    }
    return null;
  });
  
  if (treeRect) {
    console.log(`  天赋树Canvas: ${treeRect.width}x${treeRect.height}`);
  }
  
  return {
    meta,
    skills,
    rawText: data.rawText,
    treeRect,
    sourceUrl: url
  };
}

/**
 * 主函数 - 抓取多个BD
 */
async function crawlBuilds(urls) {
  console.log('🚀 启动浏览器...\n');
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 3000 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
  
  const results = [];
  
  try {
    for (const url of urls) {
      try {
        const build = await crawlBuildDetail(page, url);
        results.push(build);
      } catch (error) {
        console.error(`  ❌ 抓取失败: ${error.message}`);
      }
    }
    
    // 输出结果
    console.log('\n\n=== 抓取结果汇总 ===');
    console.log(`成功抓取 ${results.length} 个BD`);
    
    results.forEach((build, i) => {
      console.log(`\nBD ${i + 1}:`);
      console.log(`  标题: ${build.meta.title}`);
      console.log(`  技能组: ${build.skills.length}`);
      build.skills.forEach((s, j) => {
        console.log(`    ${j + 1}. 主技能: ${s.mainSkills.slice(0, 4).join(' → ')}`);
        if (s.supportSkills.length > 0) {
          console.log(`       辅助: ${s.supportSkills.slice(0, 4).join(', ')}`);
        }
      });
    });
    
    // 保存结果
    const outputPath = path.join(config.dataDir, 'community_full.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`\n💾 结果已保存: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ 爬取失败:', error);
  } finally {
    await browser.close();
  }
  
  return results;
}

// 运行
if (require.main === module) {
  crawlBuilds(TARGET_URLS)
    .then(() => {
      console.log('\n✅ 完成');
      process.exit(0);
    })
    .catch(err => {
      console.error('\n❌ 错误:', err);
      process.exit(1);
    });
}

module.exports = { crawlBuilds, crawlBuildDetail };
