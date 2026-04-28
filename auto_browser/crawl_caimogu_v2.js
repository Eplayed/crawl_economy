/**
 * @Description: 踩蘑菇BD爬虫 - 完整版
 * @Date: 2026-04-28
 * 
 * 方案：DOM文本抓取
 * - 等待Vue渲染完成后读取innerText
 * - 解析技能、宝石等结构化数据
 * - 截图天赋树
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// 配置
const CONFIG = {
  headless: true,
  waitTime: 8000,        // 等待渲染时间
  viewport: { width: 1920, height: 3000 },
  timeout: 60000
};

// 过滤关键词 - 不是技能的噪音文本
const NOISE_KEYWORDS = [
  '装备', '套装', '上一页', '下一页', '默认', '作业模式', '简易模式',
  '视频介绍', '未添加视频', '天赋', 'BD说明', '写点什么', '技能装配',
  '技能轮换方案', '回复', '异界天赋', 'BUILD模拟器', 'BUILD大厅',
  '我的 BUILDS', '我的 收藏', '登录', '作者：', '更新时间：',
  '赛季：', '等级：', '等级 Lv', 'Lv.', '流放之路'
];

// BD标题关键词 - 这些不是技能，是BD名称
const BUILD_TITLE_KEYWORDS = [
  '血法', 'COC', 'COS', 'DOT', '构建', '加点', '开荒', '毕业', 
  '流派', 'build', 'Build', 'BD'
];

// 辅助技能关键词
const SUPPORT_KEYWORDS = [
  '高效', '范围集中', '元素集中', '多重范围施法', '快速施法',
  '持续时间延长', '能量保存', '范围扩大', '天顶', '残片效能',
  '暴击时施放', '元素异常状态时施放', '施法', '法术节魔'
];

// 有效技能后缀
const VALID_SUFFIXES = ['I', 'II', 'III', 'IV', 'V', '1', '2', '3', '4', '5'];

/**
 * 判断是否是有效的技能名称
 */
function isValidSkill(text) {
  if (!text || text.length < 2 || text.length > 20) return false;
  if (NOISE_KEYWORDS.some(k => text.includes(k))) return false;
  if (/^[IVX\d\s]+$/.test(text)) return false; // 纯罗马数字或数字
  // 跳过BD标题关键词
  if (BUILD_TITLE_KEYWORDS.some(k => text.includes(k)) && text.length > 3) return false;
  return true;
}

/**
 * 判断是否是辅助技能
 */
function isSupportSkill(text) {
  return SUPPORT_KEYWORDS.some(k => text.includes(k));
}

/**
 * 从文本解析技能组
 */
function parseSkills(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const skills = [];
  let currentGroup = null;
  
  // 技能组开始的关键技能
  const groupStarters = [
    '残片', '大法师', '魔侍', '闪电专精', '冰霜专精', '元素要害',
    '暴击时施放', '彗星落', '冰墙', '雨淞', '冰川', '德瑞', '仪祭',
    '灵体', '陷阱', '图腾', '召唤', '打击', '施放', '引导'
  ];
  
  for (const line of lines) {
    if (!isValidSkill(line)) continue;
    
    // 检查是否是技能组开始
    const isGroupStart = groupStarters.some(s => line.includes(s));
    
    if (isGroupStart || !currentGroup) {
      if (currentGroup && currentGroup.links.length > 0) {
        skills.push(currentGroup);
      }
      currentGroup = {
        groupName: line,
        groupIndex: skills.length + 1,
        mainSkills: [],
        supportSkills: [],
        links: []
      };
    }
    
    if (currentGroup) {
      const isSupport = isSupportSkill(line);
      currentGroup.links.push({ name: line, isSupport });
      
      if (isSupport) {
        if (!currentGroup.supportSkills.includes(line)) {
          currentGroup.supportSkills.push(line);
        }
      } else {
        if (!currentGroup.mainSkills.includes(line)) {
          currentGroup.mainSkills.push(line);
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
 * 从文本解析元数据
 */
function parseMeta(text) {
  const meta = {
    title: '',
    author: '',
    class: '',
    className: '',
    tags: [],
    updateTime: ''
  };
  
  // 提取标题 - 匹配 "作者：" 之前的文本
  const titleMatch = text.match(/([^\n]+?)\s*\n\s*作者[：:]/);
  if (titleMatch) {
    const title = titleMatch[1].trim();
    // 过滤掉导航等噪音
    if (title && !NOISE_KEYWORDS.some(k => title.includes(k)) && title.length > 1 && title.length < 50) {
      meta.title = title;
    }
  }
  
  // 备用方案：从行中查找第一个非导航大文本
  if (!meta.title) {
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // 排除噪音、链接、导航等
      if (trimmed.length >= 2 && 
          trimmed.length <= 30 &&
          !NOISE_KEYWORDS.some(k => trimmed.includes(k)) &&
          !/^[IVX\d\s]+$/.test(trimmed) &&
          !trimmed.includes('http') &&
          !trimmed.includes('.com') &&
          !trimmed.includes('：降临')) { // 排除网站标题
        meta.title = trimmed;
        break;
      }
    }
  }
  
  // 提取作者
  const authorMatch = text.match(/作者[：:]\s*([^|]+)/);
  if (authorMatch) {
    meta.author = authorMatch[1].trim();
  }
  
  // 提取职业
  const classMatch = text.match(/赛季[：:]\s*([^\n]+)/);
  if (classMatch) {
    const classStr = classMatch[1].trim();
    meta.class = classStr;
    // 翻译职业名
    meta.className = translateClassName(classStr);
  }
  
  // 提取更新时间
  const timeMatch = text.match(/更新时间[：:]\s*(\d{4}年\d{2}月\d{2}日)/);
  if (timeMatch) {
    meta.updateTime = timeMatch[1];
  }
  
  // 提取标签
  if (text.includes('升级')) meta.tags.push('升级');
  if (text.includes('攻坚')) meta.tags.push('攻坚');
  if (text.includes('硬核')) meta.tags.push('硬核模式');
  if (text.includes('独狼')) meta.tags.push('独狼模式');
  
  return meta;
}

/**
 * 翻译职业名称
 */
function translateClassName(classStr) {
  const map = {
    '德鲁伊': 'Druid', '末裔德鲁伊': 'Druid',
    '游侠': 'Ranger', '冠军': 'Champion', '战士': 'Warrior',
    '女巫': 'Witch', '魔导师': 'Mage', '暗影': 'Shadow',
    '圣堂': 'Templar', '野蛮人': 'Marauder', '贵族': 'Ascendant'
  };
  
  for (const [cn, en] of Object.entries(map)) {
    if (classStr.includes(cn)) return en;
  }
  return 'Druid';
}

/**
 * 抓取单个BD详情页
 */
async function crawlBuildDetail(page, url) {
  console.log(`  访问: ${url}`);
  
  await page.goto(url, { waitUntil: 'networkidle0', timeout: CONFIG.timeout });
  await new Promise(resolve => setTimeout(resolve, CONFIG.waitTime));
  
  // 从DOM获取数据
  const data = await page.evaluate(() => {
    return {
      text: document.body.innerText,
      url: window.location.href
    };
  });
  
  // 解析数据
  const meta = parseMeta(data.text);
  const skills = parseSkills(data.text);
  
  console.log(`    标题: ${meta.title}`);
  console.log(`    职业: ${meta.class}`);
  console.log(`    技能组: ${skills.length}个`);
  
  // 生成唯一ID
  const id = url.split('/').pop() || `bd_${Date.now()}`;
  
  return {
    id: `CaiMoGu_${id}`,
    meta: {
      title: meta.title,
      author: meta.author,
      class: meta.className,
      name: meta.class,
      tags: meta.tags.length > 0 ? meta.tags : ['热门推荐']
    },
    intro: {
      desc: `来自踩蘑菇网的热门BD「${meta.title}」，${meta.class}职业，作者${meta.author}，更新于${meta.updateTime}`,
      pros: ['社区热门推荐', '经过玩家验证'],
      cons: ['具体效果因人而异']
    },
    skills: skills.slice(0, 10), // 最多10个技能组
    equipment: {
      notes: `数据来源：踩蘑菇网 | 更新时间: ${meta.updateTime}`
    },
    passive_tree: {
      // 天赋树截图暂不处理
      link: url
    },
    source: {
      platform: 'caimogu',
      originalAuthor: meta.author,
      updateTime: meta.updateTime,
      sourceUrl: url
    }
  };
}

/**
 * 获取社区BD列表
 */
async function getCommunityBuilds(page) {
  console.log('\n📜 获取社区BD列表...');
  
  const listUrl = 'https://poe2.caimogu.cc/planner#/plan/community-builds';
  await page.goto(listUrl, { waitUntil: 'networkidle0', timeout: CONFIG.timeout });
  await new Promise(resolve => setTimeout(resolve, CONFIG.waitTime));
  
  // 从页面DOM获取BD链接
  const buildLinks = await page.evaluate(() => {
    const links = [];
    const seen = new Set();
    
    // 方法1: 从导航链接获取
    const allLinks = document.querySelectorAll('a[href*="/plan/"], [href*="/plan/"]');
    allLinks.forEach(el => {
      const href = el.closest('a')?.href || el.href;
      if (!href) return;
      
      // 提取plan ID
      const match = href.match(/\/plan\/([A-Za-z0-9]+)/);
      if (match && match[1] && !match[1].includes('community')) {
        const id = match[1];
        if (!seen.has(id)) {
          seen.add(id);
          links.push({
            id: id,
            url: `https://poe2.caimogu.cc/planner#/plan/${id}`,
            title: el.innerText?.trim() || ''
          });
        }
      }
    });
    
    // 方法2: 从页面文本中提取BD名称和ID
    const text = document.body.innerText;
    const bdNamePattern = /([^\n]+?)\s*\n\s*作者[：:]/g;
    let match;
    while ((match = bdNamePattern.exec(text)) !== null) {
      const title = match[1].trim();
      if (title && title.length > 1 && title.length < 50) {
        // 查找对应的URL
        const linkEl = Array.from(document.querySelectorAll('a')).find(a => 
          a.innerText?.includes(title) || title.includes(a.innerText?.trim())
        );
        if (linkEl && linkEl.href) {
          const urlMatch = linkEl.href.match(/\/plan\/([A-Za-z0-9]+)/);
          if (urlMatch) {
            const id = urlMatch[1];
            if (!seen.has(id)) {
              seen.add(id);
              links.push({ id, url: linkEl.href, title });
            }
          }
        }
      }
    }
    
    return links.slice(0, 20);
  });
  
  console.log(`  找到 ${buildLinks.length} 个BD`);
  
  // 如果自动获取失败，添加一些默认热门BD
  if (buildLinks.length === 0) {
    console.log('  使用默认BD列表');
    buildLinks.push(
      { id: 'YbwEdfXm', url: 'https://poe2.caimogu.cc/planner#/plan/YbwEdfXm', title: '千万血法COC' }
    );
  }
  
  return buildLinks;
}

/**
 * 主函数
 */
async function crawlCommunityBuilds() {
  console.log('🚀 启动爬虫...\n');
  
  const browser = await puppeteer.launch({
    headless: CONFIG.headless ? "new" : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setViewport(CONFIG.viewport);
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
  
  const results = [];
  
  try {
    // 1. 获取社区BD列表
    const buildLinks = await getCommunityBuilds(page);
    
    if (buildLinks.length === 0) {
      console.log('⚠️ 未找到BD链接，使用默认测试URL');
      buildLinks.push({ id: 'YbwEdfXm', url: 'https://poe2.caimogu.cc/planner#/plan/YbwEdfXm' });
    }
    
    // 2. 抓取每个BD详情
    console.log('\n📦 抓取BD详情...\n');
    
    for (let i = 0; i < Math.min(buildLinks.length, 10); i++) {
      const build = buildLinks[i];
      console.log(`\n[${i + 1}/${Math.min(buildLinks.length, 10)}]`);
      try {
        const data = await crawlBuildDetail(page, build.url);
        results.push(data);
      } catch (error) {
        console.error(`  ❌ 抓取失败: ${error.message}`);
      }
    }
    
    // 3. 输出结果
    console.log('\n\n=== 抓取结果 ===');
    console.log(`成功: ${results.length} 个BD`);
    
    results.forEach((bd, i) => {
      console.log(`\n${i + 1}. ${bd.meta.title}`);
      console.log(`   职业: ${bd.meta.name} (${bd.meta.class})`);
      console.log(`   技能组: ${bd.skills.length}个`);
      bd.skills.slice(0, 3).forEach((s, j) => {
        const mainStr = s.mainSkills.slice(0, 2).join(', ');
        console.log(`     ${j + 1}. ${mainStr}... (${s.supportSkills.length}辅助)`);
      });
    });
    
    // 4. 保存结果
    const outputDir = path.join(__dirname, 'data');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputPath = path.join(outputDir, 'community.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`\n💾 数据已保存: ${outputPath}`);
    
    // 5. 上传到OSS（如果配置了）
    try {
      const uploadScript = require('./upload_to_oss');
      await uploadScript();
      console.log('☁️ 已上传到OSS');
    } catch (e) {
      console.log('⚠️ OSS上传跳过');
    }
    
  } catch (error) {
    console.error('❌ 爬取失败:', error);
  } finally {
    await browser.close();
  }
  
  return results;
}

// 运行
if (require.main === module) {
  crawlCommunityBuilds()
    .then(() => {
      console.log('\n✅ 完成');
      process.exit(0);
    })
    .catch(err => {
      console.error('\n❌ 错误:', err);
      process.exit(1);
    });
}

module.exports = { crawlCommunityBuilds, crawlBuildDetail };
