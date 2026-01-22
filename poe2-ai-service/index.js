// index.js
require('dotenv').config();

// Mapping from room ID to Code (Must match frontend ROOM_CODE_MAP)
const ROOM_CODE_MAP = {
    path: "P",
    guardhouse: "G",
    commanders_chamber: "C",
    armoury: "A",
    bronzeworks: "B",
    dynamo: "D",
    spymasters_study: "S",
    synthflesh_lab: "Y",
    surgeons_ward: "F",
    workshop: "W",
    chamber_of_souls: "L",
    thaumaturges_laboratory: "T",
    crimson_hall: "R",
    altar_of_sacrifice: "Z",
    joker: "J",
    sealed_vault: "SV",
    Clean: "_"
};

function generateLCode(layout) {
    try {
        let raw = "";
        // layout is an array of objects sorted by pos (1-81)
        // Ensure it's sorted just in case
        const sortedLayout = [...layout].sort((a, b) => a.pos - b.pos);

        for (const cell of sortedLayout) {
            // Default to "_" (Clean) if id is missing
            const roomCode = ROOM_CODE_MAP[cell.id] || "_";
            // Default to "1" if level is missing or 0
            const tierCode = (cell.level && cell.level > 0) ? cell.level.toString() : "1";

            raw += roomCode + tierCode;
        }

        // Base64 encode
        return Buffer.from(raw).toString('base64');
    } catch (e) {
        console.error("LCode generation failed:", e);
        return "";
    }
}

async function getTempleAIPlan(layout) {
    console.log("📡 正在准备请求数据...");

    // 优化：仅发送非空房间数据，减少 Token 消耗和推理负担
    const activeRooms = layout.filter(r => r.id !== 'Clean' && r.id !== '_' && r.name !== '空房间');
    console.log(`📉 过滤后有效房间数: ${activeRooms.length}`);

    let layoutStr = "";
    if (activeRooms.length === 0) {
        layoutStr = "当前神庙为空，所有位置都是空房间。";
    } else {
        // 使用CSV格式减少Token
        layoutStr = "Pos,ID,Level,Connected\n" + activeRooms.map(r =>
            `${r.pos},${r.id},${r.level},${r.connected ? 1 : 0}`
        ).join('\n');
    }

    const prompt = `
        你是一个PoE2专家系统。
        这是玩家当前神庙的【非空房间布局数据】（CSV格式: Pos,ID,Level,Connected，未列出位置默认为空）：
        ${layoutStr}
        
        神庙网格大小为 9x9 (位置ID 1-81)。
        
        可用房间ID列表 (Room IDs):
        - path (路径)
        - guardhouse (卫戍站/怪物群)
        - commanders_chamber (指挥官/稀有怪效果)
        - armoury (军械库/人形怪)
        - bronzeworks (铁匠铺/宝箱)
        - dynamo (发电机/构造体)
        - spymasters_study (间谍大师/增幅)
        - synthflesh_lab (合成实验室/经验)
        - surgeons_ward (血肉外科/暗金怪)
        - workshop (傀儡工坊/增幅)
        - chamber_of_souls (炼金术/物品稀有度)
        - thaumaturges_laboratory (奇术师/增幅)
        - crimson_hall (腐化密室/额外词缀)
        - altar_of_sacrifice (献祭密室/稀有宝箱)
        
        任务：
        1. 分析当前布局，给出接下来的最佳放置或升级建议。
        2. 只能基于位置 ID (1-81) 进行分析。
        3. 结合 PoE2 阿兹里神庙机制（如房间连通性、升级路线），给出最优规划。
        4. 如果建议新增或修改房间，请在 'changes' 字段中明确列出。
        5. 在 reason 中引用位置时，必须明确说明是"位置 X"，不要仅使用数字（如 "50/78" 应改为 "位置50和位置78"）。

        返回 JSON 格式（不要使用 Markdown 代码块）：
        {
        "recommend_rooms": [建议重点关注或操作的位置ID数组],
        "changes": [
            { "pos": 1, "id": "guardhouse", "level": 2 },
            { "pos": 10, "id": "path", "level": 1 }
        ],
        "reason": "简短的中文逻辑分析（100字以内）。引用数字位置时请加上'位置'二字。"
        }
        `;

    // Switch to DeepSeek-V3 via OpenAI-compatible endpoint
    // Documentation: https://help.aliyun.com/zh/model-studio/developer-reference/use-deepseek-v3-models
    const url = `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`;

    try {
        console.log("📤 正在发送请求到阿里云百炼 (DeepSeek-V3)...");

        const startTime = Date.now();
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "deepseek-v3",
                messages: [
                    { role: "user", content: prompt }
                ]
            })
        });

        const data = await response.json();
        const duration = (Date.now() - startTime) / 1000;
        console.log(`📥 收到响应！耗时: ${duration}s`);

        if (!response.ok) throw new Error(data.error?.message || JSON.stringify(data));

        // OpenAI format response
        let rawText = data.choices[0].message.content;

        // 打印原始返回
        console.log("📝 原始输出预览:", rawText.substring(0, 100) + "...");

        const cleanText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            console.log("✅ JSON 解析成功");
            const plan = JSON.parse(jsonMatch[0]);

            // Generate LCode from the updated layout based on AI suggestions
            let finalLayout = [...layout]; // Copy original layout

            if (plan.changes && Array.isArray(plan.changes)) {
                // Apply changes
                plan.changes.forEach(change => {
                    const idx = finalLayout.findIndex(r => r.pos === change.pos);
                    if (idx !== -1) {
                        // Update existing cell
                        finalLayout[idx] = { ...finalLayout[idx], id: change.id, level: change.level };
                    } else {
                        // This case is rare as input 'layout' usually has 81 items from frontend? 
                        // Actually frontend sends 'activeRooms' map. 
                        // Wait, 'layout' param in getTempleAIPlan is the RAW layout array from frontend (81 items)
                        // because we call it with body.layout.
                        // However, let's double check. 
                        // Yes, index.vue sends the full 81 grid mapped.
                        // So findIndex should work.

                        // Fallback if pos not found (shouldn't happen with 1-81 full list)
                        finalLayout.push({ pos: change.pos, id: change.id, level: change.level });
                    }
                });
            }

            // Generate valid LCode for frontend visualization
            plan.LCode = generateLCode(finalLayout);

            return plan;
        }

        throw new Error("AI 未返回有效的规划 JSON");

    } catch (error) {
        console.error('❌ DeepSeek-V3 调用异常:', error.message);
        throw error;
    }
}

// FC 3.0 Handler
exports.handler = async (event) => {
    try {
        let body;

        // 1. 解析输入 event
        if (Buffer.isBuffer(event)) {
            // 如果是 Buffer (标准 Event 模式)，转字符串解析
            body = JSON.parse(event.toString());
        } else if (typeof event === 'string') {
            // 如果是 String
            body = JSON.parse(event);
        } else {
            // 如果已经是 Object (可能是 HTTP 触发器在某些环境下的行为)
            body = event;
        }

        // 2. 处理 HTTP 触发器可能的包装 (API Gateway / HTTP Invoke)
        // 如果 body 中包含 body 字段 (例如 {"body": "{\"layout\":...}", "headers":...})
        if (!body.layout && body.body) {
            try {
                const innerBody = typeof body.body === 'string' ? JSON.parse(body.body) : body.body;
                if (innerBody.layout) {
                    body = innerBody;
                }
            } catch (e) {
                console.warn("尝试解析内部 body 失败:", e);
            }
        }

        // 3. 验证数据
        if (!body.layout) {
            throw new Error(`请求缺少 'layout' 字段。收到的键: ${Object.keys(body).join(', ')}`);
        }
        if (!Array.isArray(body.layout)) {
            throw new Error(`'layout' 必须是数组。收到类型: ${typeof body.layout}`);
        }

        console.log(`✅ 接收到布局数据，包含 ${body.layout.length} 个房间`);

        const plan = await getTempleAIPlan(body.layout);

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ success: true, plan })
        };
    } catch (err) {
        console.error("❌ 处理失败:", err);
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ success: false, message: err.message, stack: err.stack })
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