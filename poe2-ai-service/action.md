``` mermaid
    stateDiagram-v2
        state "后端开发阶段" as Build {
            [*] --> Prompt设计: 编写 PoE2 专业 Prompt
            Prompt设计 --> 知识库准备: 上传 MD/Excel 到百炼
            知识库准备 --> 接口开发: Node.js 环境适配百炼 SDK
            接口开发 --> 本地测试: 模拟神庙布局数据校验 JSON
        }

        state "阿里云部署阶段" as Deploy {
            本地测试 --> 创建FC函数: Node.js 20 运行环境
            创建FC函数 --> 环境变量配置: 设置 API_KEY / AppID
            环境变量配置 --> 部署代码包: 上传 dist.zip
            部署代码包 --> 获得公网URL: 开启 HTTP 触发器
        }

        state "前端集成阶段" as Frontend {
            获得公网URL --> 小程序接入: uni.request 联调
            小程序接入 --> 广告联调: 接入微信流量主 ID
            广告联调 --> UI增强: 编写路径点亮 CSS 动画
        }

        Frontend --> [*] : 功能上线
```