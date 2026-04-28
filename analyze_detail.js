/**
 * @Description: 详细分析踩蘑菇网页面DOM结构
 * @Date: 2026-04-28
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const TARGET_URL = 'https://poe2.caimogu.cc/planner#/plan/YbwEdfXm';

async function analyzePageStructure() {
  console.log('🚀 详细分析踩蘑菇BD详情页DOM结构...\n');

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 3000 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

  try {
    console.log('📍 访问BD详情页...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 8000)); // 等待更多时间

    // 获取完整HTML并保存
    const html = await page.content();
    fs.writeFileSync('./debug_page.html', html, 'utf8');
    console.log('📄 HTML已保存: debug_page.html\n');

    // 截图
    await page.screenshot({ path: './debug_detail.png', fullPage: false });
    console.log('📸 截图已保存: debug_detail.png\n');

    // 详细分析DOM结构
    const analysis = await page.evaluate(() => {
      const result = {
        meta: {},
        skills: [],
        equipment: [],
        passiveTree: null,
        levelingTips: [],
        rawData: {}
      };

      // 1. 获取页面元数据
      result.meta.url = window.location.href;
      result.meta.title = document.title;

      // 2. 查找BD标题和作者
      const titleSelectors = [
        'h1', 'h2', '[class*="title"]', '[class*="name"]',
        '[class*="header"]', '.build-name', '.build-title'
      ];
      for (const sel of titleSelectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim()) {
          result.meta.title = el.innerText.trim();
          break;
        }
      }

      // 3. 查找技能组（天赋树上的技能连接）
      const skillGroups = document.querySelectorAll('[class*="skill-group"], [class*="gem-group"]');
      if (skillGroups.length > 0) {
        skillGroups.forEach((group, idx) => {
          const gems = group.querySelectorAll('[class*="gem"], [class*="skill"], span, div');
          const gemNames = Array.from(gems)
            .map(g => g.innerText?.trim())
            .filter(t => t && t.length > 1 && t.length < 50)
            .slice(0, 10);
          if (gemNames.length > 0) {
            result.skills.push({
              index: idx,
              gems: gemNames
            });
          }
        });
      }

      // 4. 查找所有可能的技能/宝石文本
      const allText = document.body.innerText;
      const skillKeywords = ['技能', '宝石', 'Link'];
      const hasSkillContent = skillKeywords.some(k => allText.includes(k));

      // 提取潜在的宝石名称（通常是英文+中文或纯英文）
      const gemPattern = /(?:[A-Z][a-z]+ )+[A-Z][a-z]+|冰霜脉冲|闪电技能|烈焰冲击|致命异常|残暴|集中|秘术增强|闪电穿透|冰冷|火焰|闪电|投射物|技能|辅助|召唤|图腾|陷阱/i;
      const gemMatches = allText.match(gemPattern);
      if (gemMatches) {
        result.rawData.potentialGems = [...new Set(gemMatches)];
      }

      // 5. 查找装备相关元素
      const equipContainers = document.querySelectorAll('[class*="item"], [class*="equip"], [class*="gear"]');
      result.equipment = Array.from(equipContainers)
        .map(el => el.innerText?.trim())
        .filter(t => t && t.length > 0)
        .slice(0, 20);

      // 6. 查找Canvas（天赋树）
      const canvases = document.querySelectorAll('canvas');
      result.passiveTree = {
        count: canvases.length,
        tooltipCanvas: !!document.querySelector('[data-tooltip-canvas="true"]')
      };

      // 7. 查找等级信息
      const levelPattern = /等级|Lv\.|Level\s*:?\s*\d+/i;
      const levelMatch = allText.match(levelPattern);
      if (levelMatch) {
        result.rawData.levelInfo = levelMatch[0];
      }

      // 8. 查找升级建议
      const tipPatterns = [
        /升级.*?流程/i,
        /等级.*?优先/i,
        /优先.*?(属性|技能|天赋)/i
      ];
      tipPatterns.forEach(pattern => {
        const match = allText.match(pattern);
        if (match) {
          result.levelingTips.push(match[0]);
        }
      });

      // 9. 获取完整的innerText用于调试
      result.rawData.fullText = allText.substring(0, 5000);

      return result;
    });

    // 保存分析结果
    fs.writeFileSync('./debug_analysis.json', JSON.stringify(analysis, null, 2), 'utf8');
    console.log('📊 分析结果已保存: debug_analysis.json\n');

    // 输出关键信息
    console.log('=== 页面元数据 ===');
    console.log('标题:', analysis.meta.title);
    console.log('Canvas数量:', analysis.passiveTree?.count);

    console.log('\n=== 技能数据 ===');
    console.log('技能组数量:', analysis.skills.length);
    if (analysis.skills.length > 0) {
      analysis.skills.slice(0, 5).forEach((skill, idx) => {
        console.log(`技能组${idx + 1}:`, skill.gems.slice(0, 6).join(' -> '));
      });
    }

    console.log('\n=== 装备数据 ===');
    console.log('装备元素数量:', analysis.equipment.length);
    if (analysis.equipment.length > 0) {
      console.log('示例装备:', analysis.equipment.slice(0, 10));
    }

    console.log('\n=== 潜在宝石 ===');
    if (analysis.rawData.potentialGems) {
      console.log(analysis.rawData.potentialGems.slice(0, 20));
    }

    console.log('\n=== 完整文本（前2000字符） ===');
    console.log(analysis.rawData.fullText?.substring(0, 2000));

  } catch (error) {
    console.error('❌ 分析失败:', error);
  } finally {
    await browser.close();
  }
}

analyzePageStructure()
  .then(() => console.log('\n✅ 分析完成'))
  .catch(err => console.error('\n❌ 错误:', err));
