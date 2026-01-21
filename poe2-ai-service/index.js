// index.js
require('dotenv').config();

async function getTempleAIPlan(layout) {
    console.log("📡 正在准备请求数据...");
    const layoutStr = layout.map(r =>
        `位置:${r.pos}, 房间名:${r.name}, 等级:${r.level}, 连通:${r.connected ? '是' : '否'}`
    ).join(' | ');

    const prompt = `
        你是一个PoE2专家系统。
        这是玩家当前神庙的【真实布局数据】：
        ${layoutStr}

        任务：
        1. 只能基于我提供的位置 ID 进行分析。不要虚构数据中不存在的位置。
        2. 如果数据中某个位置是"空房间"，请不要将其误认为其他房间。
        3. 结合知识库，给出最优规划。

        返回 JSON 格式：
        {
        "recommend_rooms": [这里只能填数据中出现的 pos ID],
        "target_upgrades": ["建议升级的房间名"],
        "reason": "简短的中文逻辑分析"
        }
        `;
    const url = `https://dashscope.aliyuncs.com/api/v1/apps/${process.env.APP_ID}/completion`;

    try {
        console.log("📤 正在发送请求到阿里云百炼 (DeepSeek-R1)...");
        console.log("⏳ R1 正在思考和检索知识库，请耐心等待 (可能需要 20-40 秒)...");

        const startTime = Date.now();
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.API_KEY}`,
                'Content-Type': 'application/json',
                'X-DashScope-SSE': 'disable'
            },
            body: JSON.stringify({
                input: { prompt: prompt },
                parameters: { incremental_output: false }
            })
        });

        const data = await response.json();
        const duration = (Date.now() - startTime) / 1000;
        console.log(`📥 收到响应！耗时: ${duration}s`);

        if (!response.ok) throw new Error(data.message || 'API 调用失败');

        let rawText = data.output.text;

        // 打印原始返回，看看 R1 说了什么（包含 think 内容）
        console.log("📝 原始输出预览:", rawText.substring(0, 100) + "...");

        const cleanText = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            console.log("✅ JSON 解析成功");
            return JSON.parse(jsonMatch[0]);
        }

        throw new Error("AI 未返回有效的规划 JSON");

    } catch (error) {
        console.error('❌ DeepSeek-R1 调用异常:', error.message);
        throw error;
    }
}

// FC 3.0 Handler
exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.toString());
        const plan = await getTempleAIPlan(body.layout);
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ success: true, plan })
        };
    } catch (err) {
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: err.message })
        };
    }
};

// 本地测试
if (require.main === module) {
    const testLayout = [
        { pos: 1, name: "腐化房间", level: 1, connected: true },
        { pos: 10, name: "宝石房间", level: 2, connected: false }
    ];
    getTempleAIPlan(testLayout).then(res => console.log("✅ 结果:", res));
}