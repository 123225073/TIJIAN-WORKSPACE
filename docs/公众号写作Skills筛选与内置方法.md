# 公众号写作 Skills 筛选与接入

2026-10-07，读取公开项目的说明和方法原文，按本项目的行业身份、事实来源及生成链路筛选。以下适用性是本项目判断，不采用项目宣传中的爆款率、阅读量或排名作为已验证结论。

| 参考 | 适用方法 | 本项目取舍 |
| --- | --- | --- |
| [blader/humanizer](https://github.com/blader/humanizer/blob/main/SKILL.md) | 保留事实、作者声线，删除模板化对比、三段排比、机械小标题和空洞结尾 | 保留既有MIT文本快照；作为交稿复核方法。不能靠同义替换创造真人感 |
| [coreyhaines31/marketingskills · copywriting](https://github.com/coreyhaines31/marketingskills/blob/main/skills/copywriting/SKILL.md) | 读者语言、具体收益、诚实标题与编辑检查 | 适配标题和读者切入；营销落地页的固定结构不直接用于公众号正文 |
| [JimLiu/baoyu-skills · baoyu-cover-image](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-cover-image/SKILL.md) | 主体、色调、渲染、文字、情绪的封面构图，以及宽封面 | 原创整理为封面brief方法；不执行外部生成、上传或发布脚本 |
| [ziyetsui/wechat-article-skills](https://github.com/ziyetsui/wechat-article-skills) | 文章与封面风格分别选择，叙事、解释与教程分场景 | 仅作为分类参考；没有逐一验证其模板来源、传播指标和许可，不导入模板库 |
| [yaoleifly/wechat-writing-style](https://github.com/yaoleifly/wechat-writing-style) | 已有中文表达、读者收获与事实编辑 | 保留MIT来源快照；固定“先说结论”和强制第一人称不作为默认叙事开头 |

## 已接入的方法

管理后台“提示词与 Skills”增加两个全局写作方法：公众号场景叙事与情绪节奏、公众号标题与封面构图。既有去AI味与读者写作方法保留，管理员自建内容不被覆盖。

公众号默认采用场景进入、自然叙事、解释融入和回扣结尾；用户明确要清单或说明书时遵循用户要求。无真实经历时只能用明确标为假设的日常场景，不能编造“我的客户”、原话、报价或事故。标题在内部比较不同方向，再选择正文能兑现的一条；封面围绕唯一主题，短字、安全区和留白一起说明。

完整的Easel发布工具文档不再作为默认写作提示词注入；其确定性排版组件保留。写作方法仅提供文本指导，不能授予联网、付费生成、发布、文件执行或账号访问权限。

新方法同时进入文案创作的全局配置和AI对话公众号生成链路，两处使用相同的配置快照，遵循管理员编辑和停用状态。已有稿件不会自动重写，用户新建或要求改写时生效。结构检查和模拟接口测试只能证明规则接入；另使用已授权CPA文本模型进行小样验收，仍不承诺爆款。
