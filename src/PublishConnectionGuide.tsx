import './publish-guidance.css';

const platformEntries:Record<string,{name:string;url:string}>={
 xiaohongshu:{name:'小红书创作服务平台',url:'https://creator.xiaohongshu.com/'},
 zhihu:{name:'知乎创作中心',url:'https://www.zhihu.com/creator'},
 baijiahao:{name:'百家号后台',url:'https://baijiahao.baidu.com/'},
 toutiao:{name:'头条号后台',url:'https://mp.toutiao.com/'},
 jianshu:{name:'简书写作页面',url:'https://www.jianshu.com/writer'},
 sohu:{name:'搜狐号后台',url:'https://mp.sohu.com/'},
};
export const wechatDeveloperEntry='https://developers.weixin.qq.com/platform/';
const wordpressHelp='https://developer.wordpress.org/advanced-administration/security/application-passwords/';
const OutLink=({href,children}:{href:string;children:React.ReactNode})=><a href={href} target="_blank" rel="noopener noreferrer">{children}<span aria-hidden="true"> ↗</span></a>;

export function wordpressProfileUrl(endpoint:string){
 try{
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port)return '';
  const path=url.pathname.replace(/\/+$/,'').replace(/\/wp-json\/wp\/v2$/,'');
  return url.origin+path+'/wp-admin/profile.php';
 }catch{return ''}
}

export function GatewayConnectionGuide({platform,mode,endpoint}:{platform:string;mode:'gateway'|'wordpress';endpoint:string}){
 const entry=platformEntries[platform],profile=mode==='wordpress'?wordpressProfileUrl(endpoint):'';
 return <aside className="publish-connection-guide" aria-label="发布参数获取指南">
  <div className="publish-guide-heading"><h4>{mode==='wordpress'?'连接你自己的 WordPress 网站':'先准备发布服务，再填写连接'}</h4>{entry&&<OutLink href={entry.url}>{entry.name}</OutLink>}</div>
  {mode==='wordpress'?<>
   <p>使用拥有发文和上传图片权限的网站账号。以下信息都来自你自己的 WordPress 后台。</p>
   <ol>
    <li><strong>网站地址</strong><span>复制你网站的完整 HTTPS 地址；若 WordPress 安装在子目录，也保留该目录。这里填写网站地址即可。</span></li>
    <li><strong>用户名</strong><span>用该账号登录网站后台，进入「用户 → 个人资料」，复制「用户名」；不要填写对外显示的昵称。</span></li>
    <li><strong>应用程序密码</strong><span>在同一页找到「应用程序密码」，名称可填「梯世界工作台」，点击新增并立即复制生成的密码。它与网页登录密码分开管理，只会完整显示一次。</span></li>
   </ol>
   <div className="publish-guide-links">{profile?<OutLink href={profile}>打开我的网站个人资料</OutLink>:<span>填写网站地址后，可一键打开该网站的个人资料页。</span>}<OutLink href={wordpressHelp}>WordPress 官方获取说明</OutLink></div>
   <p className="publish-guide-note">找不到「应用程序密码」时，请让建站管理员检查网站 HTTPS、账号权限及安全插件设置。</p>
  </>:<>
   <p>{platform==='website'?'官网由谁建设，就向谁确认自动发文的接入方式。WordPress 网站可在下方切换为「WordPress 官网」，直接按网站账号连接。':'当前工作台通过你自备的发布服务连接此平台。请先在该服务中授权正确的平台账号，再获取下面两项信息。'}</p>
   <ol>
    <li><strong>HTTPS 发布地址</strong><span>由你的{platform==='website'?'建站管理员或发布服务商':'发布服务商'}提供，或在该服务后台的「接口 / 自动化 / 开发者」设置中复制。先确认此地址专门用于向当前平台发文。</span></li>
    <li><strong>访问令牌</strong><span>向同一服务商申请，或在同一服务后台创建用于发文的访问凭据；必须与上面的发布地址配套。它不是平台登录密码、手机验证码或浏览器登录信息。</span></li>
    <li><strong>启用连接</strong><span>核对目标账号、地址与令牌后勾选，再点击「保存连接」。保存只保留设置，不会立即发布文章。</span></li>
   </ol>
   <p className="publish-guide-note">{entry?'上方官方后台链接用于管理平台账号和手动发文，不会提供本工具所需的发布服务地址与通用令牌。':'普通网站首页或管理后台地址不能当作发布服务地址。'}尚未接入发布服务时，请先向服务商取得这两项；工作台不会自动创建平台授权。</p>
  </>}
 </aside>;
}

export function WechatConnectionGuide(){
 return <aside className="publish-connection-guide" aria-label="公众号参数获取指南">
  <div className="publish-guide-heading"><h4>公众号参数从哪里获取？</h4><OutLink href={wechatDeveloperEntry}>打开微信开发者平台</OutLink></div>
  <p>由公众号管理员登录并选择需要连接的公众号。AppID 与 AppSecret 必须属于同一个公众号；后台菜单名称以微信当前页面为准。</p>
  <ol>
   <li><strong>账号备注名</strong><span>自己填写一个方便辨认的名称，例如「公司官方公众号」。它只用于本机区分账号。</span></li>
   <li><strong>AppID</strong><span>在对应公众号的「基础信息」中找到开发者 ID（AppID），复制到下方。</span></li>
   <li><strong>AppSecret</strong><span>在对应公众号的「开发密钥」管理中获取，由管理员按微信提示完成验证后复制到下方。已有可用密钥请优先使用，重置可能影响其他已连接工具。</span></li>
   <li><strong>IP 白名单</strong><span>保存后先测试连接。如提示需要 IP 白名单，展开本页「连接帮助」，检测并复制出口 IP，再到微信开发者平台为此公众号添加。</span></li>
  </ol>
  <p className="publish-guide-note">看不到开发设置或接口权限时，请联系该公众号管理员核对权限。无需手动获取临时访问令牌，工作台会用已保存的连接向微信申请。</p>
 </aside>;
}
