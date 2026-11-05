// Publishing access is deliberately separate from writing-channel support.
// An official creator page or data API does not mean this app can publish to it.
export type PublishingAccess={name:string;status:string;description:string;steps:string[];links:Array<{label:string;url:string}>};
export const publishingAccess:Record<string,PublishingAccess>={
 xiaohongshu:{name:'小红书',status:'官方后台发布 · 未接入原生自动发布',description:'图文笔记以图片、短文和话题共同呈现。工作台目前没有连接小红书创作者账号，不能直接代发笔记。',steps:[
  '在小红书创作服务平台登录你要发布的账号，选择图文笔记，上传配图并粘贴文案与话题。',
  '小程序的笔记发布能力会打开小红书发布器，需要用户操作；店铺开放平台用于商家业务，均不能当成本工作台的普通图文发文凭据。',
 ],links:[{label:'打开小红书创作服务平台',url:'https://creator.xiaohongshu.com/'},{label:'查看小程序官方能力说明',url:'https://miniapp.xiaohongshu.com/doc/DC137160'}]},
 zhihu:{name:'知乎',status:'官方后台发布 · 未接入原生自动发布',description:'知乎回答与专栏文章的发布入口不同，发布前需要确认内容是回答问题还是独立文章。',steps:[
  '在知乎创作中心登录账号，选择写文章；若内容是问题回答，应先进入对应问题再发布。',
  '知乎开放平台提供的数据、检索与用户授权能力不等于文章发文权限。本工作台尚未接入知乎原生发文。',
 ],links:[{label:'打开知乎创作中心',url:'https://www.zhihu.com/creator'},{label:'查看知乎开放平台',url:'https://developer.zhihu.com/'}]},
 baijiahao:{name:'百家号',status:'官方后台发布 · 原生接口待核实',description:'百家号的开放能力需要以你账号后台实际获得的权限为准，不能套用其他平台的参数。',steps:[
  '登录百家号后台，在内容发布入口核对标题、正文、封面及分类后发布。',
  '若后台开放平台入口可用，请由账号管理员核对当前图文发布权限和官方文档。历史 app_id、app_token 不能代替本工作台所需的服务连接，当前版本尚未实现百家号原生适配。',
 ],links:[{label:'打开百家号后台',url:'https://baijiahao.baidu.com/'},{label:'查看百家号开放文档',url:'https://baijiahao.baidu.com/builder/author/opendoc/index'}]},
 toutiao:{name:'今日头条',status:'官方后台发布 · 内容源需符合资格',description:'普通创作者可在头条号后台发布图文；网站内容源同步有单独的账号资格与配置要求。',steps:[
  '登录头条号，在「主页 → 创作 → 图文」进入编辑器，核对封面、正文与发布选项。',
  '官方文档中的网站内容源接入目前仅面向新闻媒体、国家机构类账号；有资格时在「工具 → 同步发文 → 网站内容源」申请。它不是通用访问令牌，也不是本工具的直连发文。',
 ],links:[{label:'打开头条号后台',url:'https://mp.toutiao.com/'},{label:'官方图文发布说明',url:'https://baike.toutiao.com/detail/211/212/214'},{label:'内容源申请条件',url:'https://baike.toutiao.com/detail/242/248/0?enter_from=left_navigation'}]},
 jianshu:{name:'简书',status:'官方编辑器发布 · 未接入原生自动发布',description:'在简书写作页完成文章发布。本次未核实面向普通创作者的公开图文发文接口，当前版本也未实现原生连接。',steps:[
  '登录简书并进入写作页，新建文章后粘贴正文，上传配图并检查排版。',
  '在简书官方编辑器中核对文章和发布选项。无需在此填写网页登录密码或浏览器 Cookie。',
 ],links:[{label:'打开简书写作页',url:'https://www.jianshu.com/writer'}]},
 sohu:{name:'搜狐号',status:'官方后台发布 · 可申请内容同步权益',description:'搜狐号支持后台发文；符合规则的账号还可申请平台自己的内容同步功能。',steps:[
  '登录搜狐号，在官方后台创建图文并核对发布选项。',
  '如需同步已有平台内容，在「账号权益 → 内容同步」查看准入要求并申请；需要提供本人或已获授权的第三方账号信息。此权益不是一个通用 HTTPS 发文地址。',
 ],links:[{label:'打开搜狐号后台',url:'https://mp.sohu.com/'},{label:'官方内容同步规则',url:'https://www.sohu.com/a/741336891_120635073'}]},
};
