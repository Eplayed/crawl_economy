// index.js
const axios = require('axios');
require('dotenv').config();

// 1. 提示词生成器
function generatePrompt(layout) {
    const layoutStr = layout.map(r => 
        `位置:${r.pos}, 房间名:${r.name}, 等级:${r.level}, 已连接位置:[${r.connections || ''}]`
    ).join('\n');

    return `
你是一名《流放之路2》（PoE2）资深大神，精通阿兹瓦特神庙（Temple of Atzoatl）的最大化收益规划。
现在神庙中有以下房间布局：
${layoutStr}

请根据 PoE2 的当前行情和机制（如：3级腐化房、3级宝石房、3级通货房价值最高），给出最优规划方案。
你的目标是：
1. 确定哪3个房间最值得通过剩余次数升级到 3 级。
2. 给出为了连接这些高价值房间，最优先需要打通的房间位置（ID）。

请直接返回 JSON 格式结果，不要包含任何额外文字说明。格式如下：
{
  "recommend_rooms": [位置ID1, 位置ID2],
  "target_upgrades": ["房间名A", "房间名B"],
  "reason": "简短的中文逻辑分析，解释为什么这么选",
  "path_suggestion": "关于如何连接房间门的具体建议"
}
`;
}

// 2. 调用 AI 接口
async function getAIPlan(layout) {
    const apiKey = process.env.AI_API_KEY;
    const apiUrl = process.env.AI_API_URL || 'https://api.deepseek.com/v1/chat/completions';

    try {
        const response = await axios.post(apiUrl, {
            model: "deepseek-chat",
            messages: [
                { role: "system", content: "你是一个专业的 PoE2 游戏助手 JSON 格式化输出引擎。" },
                { role: "user", content: generatePrompt(layout) }
            ],
            response_format: { type: 'json_object' }
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        return JSON.parse(response.data.choices[0].message.content);
    } catch (error) {
        console.error('AI API 调用失败:', error.message);
        throw error;
    }
}

// 适配阿里云函数计算 FC 3.0
exports.handler = async (event, context) => {
    // 处理 HTTP 请求体
    const body = JSON.parse(event.toString());
    const { layout } = body;

    if (!layout || !Array.isArray(layout)) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "无效的布局数据" })
        };
    }

    try {
        const plan = await getAIPlan(layout);
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true, plan })
        };
    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: err.message })
        };
    }
};

// --- 本地测试逻辑 ---
if (require.main === module) {
    const testLayout = [
        { pos: 1, name: "腐化祭坛", level: 1, connections: "2,5" },
        { pos: 2, name: "宝石工匠工坊", level: 2, connections: "1" },
        { pos: 5, name: "空房间", level: 0, connections: "1" }
    ];
    
    console.log("正在进行本地测试...");
    getAIPlan(testLayout).then(res => {
        console.log("AI 返回方案:", JSON.stringify(res, null, 2));
    }).catch(err => console.error("测试失败"));
}