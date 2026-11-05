export const automaticPictureStyle={id:'auto',title:'自动匹配文章 / 原图风格',description:'根据文章内容与已说明的风格匹配，整组配图保持统一',prompt:'依据文章内容匹配视觉风格；如正文明确说明配图的色彩和笔触，则优先沿用。没有风格说明时，采用清爽专业的行业插画：米白背景、墨绿主色和少量暖金色重点，设备结构与人物动作合理，主体清楚，舒适留白。'};
export const pictureStyles=[
 {id:'industry',title:'清晰行业插画',description:'设备、施工、服务场景，清楚说明一个问题',prompt:'清爽专业的电梯行业插画：米白背景、墨绿主色和少量暖金色重点，清楚的设备结构与人物动作，构图克制，主体清楚，适合公众号或品牌文章。'},
 {id:'editorial',title:'杂志纪实',description:'现场感与自然光，适合经验分享',prompt:'杂志纪实摄影风格，自然光，真实的中国建筑与电梯服务场景，克制的构图，专业可信，不出现可识别品牌与虚假项目标识。'},
 {id:'diagram',title:'知识图解',description:'步骤、流程、费用项目，适合讲解',prompt:'简洁知识信息图，清楚的分区与流程关系，图形比文字更突出，米白底、深蓝线条和少量金色重点，短标签清晰，不编造数字。'},
 {id:'handdrawn',title:'温暖手绘',description:'轻松的人物故事，适合大众阅读',prompt:'温暖细腻的手绘插画，纸张质感，低饱和暖色，清楚的人物表情和生活场景，画面通透，适合公众号大众科普。'},
 {id:'minimal',title:'极简商务',description:'大留白与重点元素，适合观点文章',prompt:'极简商务插画，大面积留白，深蓝和米白，精确的几何形与主题元素，层次清楚，克制专业，避免装饰堆砌。'},
 {id:'architecture',title:'建筑空间效果图',description:'看懂别墅、家用电梯与建筑空间的关系',prompt:'精致建筑空间可视化效果图，写实材质、柔和日光、清晰的透视和尺度关系，展示电梯与住宅空间的合理衔接。建筑与设备是概念示意，不冒充已竣工项目；不凭空添加品牌、尺寸和技术认证。'},
 {id:'blueprint',title:'工程线稿',description:'用干净线条，解释井道、部件和结构关系',prompt:'工程知识线稿插画，浅蓝白底、清楚的深蓝轮廓线与少量橙色重点，适当使用局部放大或剖面表达设备关系。线条清爽、层次明确，只作科普示意，不虚构工程尺寸、施工图编号或安全认证。'},
];
export const imageStyleTemplates=[automaticPictureStyle,...pictureStyles];
export const pictureStyleById=(id?:string)=>imageStyleTemplates.find(style=>style.id===id)||automaticPictureStyle;
/** Persist the selected instruction with the draft so a task keeps its exact style. */
export const imageStyleInput=(id:string)=>{const style=pictureStyleById(id);return {id:style.id,prompt:style.id==='auto'?'':style.prompt+' 风格只影响视觉呈现；保留用户要求、参考图主体和已确认事实，不改写品牌、价格或数据。'}};
export const socialStyles=[
 {id:'cards',title:'清爽知识卡片',description:'统一底色与排版，重点突出',prompt:'小红书现代知识卡片：浅色底、深色文字与一个明亮强调色；标题、主体和辅助信息层次分明，网格对齐，充足留白。根据本页信息选用步骤、对照或重点图解，避免深色底深色字和密集小字。整组保持一致的配色、字体和边距，但每页构图可变化。'},
 {id:'sketch',title:'亲切手绘笔记',description:'手绘线条与便签，适合知识分享',prompt:'小红书手绘知识笔记：暖白纸张、简洁手绘线条和少量柔和强调色；主体清楚、有大标题和留白，便签只承载简短重点，不堆贴纸。整组保持一致色板和笔触，逐页变换有意义的构图。'},
 {id:'photo',title:'专业纪实',description:'自然真实的行业场景',prompt:'专业杂志纪实视觉，自然光、清楚的行业场景主体与简洁留白，必要短标题置于高对比的干净区域；同组保持统一色调与文字层级。画面是生成示意，不冒充真实项目、实拍证据或品牌授权。'},
];
