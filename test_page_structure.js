/**
 * @Description: 测试踩蘑菇网页面DOM结构
 * @Date: 2026-04-28
 */

const puppeteer = require('puppeteer');

const TARGET_URL = 'https://poe2.caimogu.cc/planner#/plan/community-builds';

async function testPageStructure() {
  console.log('🚀 启动浏览器测试踩蘑菇网页面结构...\n');

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

  try {
    console.log('📍 访问社区BD页面...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 60000 });

    // 等待Vue渲染
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 截图看效果
    await page.screenshot({ path: './test_caimogu_list.png', fullPage: true });
    console.log('📸 已保存页面截图: test_caimogu_list.png\n');

    // 分析页面结构
    const structure = await page.evaluate(() => {
      const result = {
        url: window.location.href,
        title: document.title,
        bodyClasses: document.body.className,
        vueApp: !!document.querySelector('[data-v-app]'),
        mainExists: !!document.querySelector('main'),
      };

      // 尝试找主要容器
      const containers = [
        'main', '.main-content', '#app', '[class*="content"]',
        '[class*="plan"]', '[class*="build"]', '[class*="community"]'
      ];

      for (const sel of containers) {
        const el = document.querySelector(sel);
        if (el) {
          result.mainSelector = sel;
          result.mainText = el.innerText?.substring(0, 500);
          break;
        }
      }

      // 查找所有文本内容（采样）
      result.bodyText = document.body.innerText?.substring(0, 2000);

      return result;
    });

    console.log('=== 页面结构分析 ===');
    console.log('URL:', structure.url);
    console.log('Title:', structure.title);
    console.log('Vue App:', structure.vueApp);
    console.log('Main Selector:', structure.mainSelector);
    console.log('\n--- 页面文本内容（前2000字符）---');
    console.log(structure.bodyText);

    // 检查是否能找到关键数据
    console.log('\n=== 关键数据检查 ===');
    const keyData = await page.evaluate(() => {
      return {
        hasAuthor: document.body.innerText.includes('作者'),
        hasTime: document.body.innerText.includes('更新时间'),
        hasClass: document.body.innerText.includes('游侠') || document.body.innerText.includes('女巫') || document.body.innerText.includes('战士'),
        hasSkills: document.body.innerText.includes('技能'),
        hasEquipment: document.body.innerText.includes('装备'),
        hasLevel: document.body.innerText.includes('等级'),
      };
    });
    console.log('包含「作者」:', keyData.hasAuthor);
    console.log('包含「更新时间」:', keyData.hasTime);
    console.log('包含职业名:', keyData.hasClass);
    console.log('包含「技能」:', keyData.hasSkills);
    console.log('包含「装备」:', keyData.hasEquipment);
    console.log('包含「等级」:', keyData.hasLevel);

    // 尝试访问一个具体的BD详情页
    console.log('\n\n=== 测试BD详情页 ===');
    const detailUrl = 'https://poe2.caimogu.cc/planner#/plan/YbwEdfXm';
    await page.goto(detailUrl, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise(resolve => setTimeout(resolve, 5000));

    await page.screenshot({ path: './test_caimogu_detail.png', fullPage: true });
    console.log('📸 已保存详情页截图: test_caimogu_detail.png\n');

    // 分析详情页结构
    const detailStructure = await page.evaluate(() => {
      const result = {
        url: window.location.href,
        title: document.title,
      };

      // 获取所有文本
      result.bodyText = document.body.innerText?.substring(0, 3000);

      // 尝试查找技能相关元素
      const skillElements = document.querySelectorAll('[class*="skill"], [class*="gem"], [class*="link"]');
      result.skillCount = skillElements.length;
      if (skillElements.length > 0) {
        result.sampleSkills = Array.from(skillElements).slice(0, 10).map(el => el.innerText?.trim()).filter(Boolean);
      }

      // 尝试查找装备相关元素
      const equipElements = document.querySelectorAll('[class*="equip"], [class*="item"], [class*="gear"]');
      result.equipCount = equipElements.length;
      if (equipElements.length > 0) {
        result.sampleEquip = Array.from(equipElements).slice(0, 10).map(el => el.innerText?.trim()).filter(Boolean);
      }

      // 尝试查找天赋树
      const treeCanvas = document.querySelectorAll('canvas');
      result.canvasCount = treeCanvas.length;
      result.tooltipCanvas = !!document.querySelector('[data-tooltip-canvas="true"]');

      return result;
    });

    console.log('详情页文本内容（前3000字符）:');
    console.log(detailStructure.bodyText);
    console.log('\n技能元素数量:', detailStructure.skillCount);
    console.log('装备元素数量:', detailStructure.equipCount);
    console.log('Canvas数量:', detailStructure.canvasCount);
    console.log('天赋树Canvas:', detailStructure.tooltipCanvas);

    if (detailStructure.sampleSkills?.length > 0) {
      console.log('\n示例技能元素:');
      console.log(detailStructure.sampleSkills);
    }

    if (detailStructure.sampleEquip?.length > 0) {
      console.log('\n示例装备元素:');
      console.log(detailStructure.sampleEquip);
    }

  } catch (error) {
    console.error('❌ 测试失败:', error);
  } finally {
    await browser.close();
  }
}

testPageStructure()
  .then(() => console.log('\n✅ 测试完成'))
  .catch(err => console.error('\n❌ 错误:', err));
