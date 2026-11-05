import './publish-guidance.css';
import {publishingAccess} from './publishPlatforms';

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

export function PlatformPublishingGuide({platform}:{platform:string}){
 const access=publishingAccess[platform];
 if(!access)return null;
 return <aside className="publish-connection-guide publish-platform-guide" aria-label={access.name+'发布方式'}>
  <span className="publish-access-status">{access.status}</span>
  <div className="publish-guide-heading"><h4>{access.name}怎么发布？</h4></div>
  <p>{access.description}</p>
  <ol>{access.steps.map(step=><li key={step}><span>{step}</span></li>)}</ol>
  <div className="publish-guide-links">{access.links.map(link=><OutLink key={link.url} href={link.url}>{link.label}</OutLink>)}</div>
 </aside>;
}

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
  <div className="publish-guide-heading"><h4>{mode==='wordpress'?'WordPress 官方接口直连':'自定义发布服务 · 高级接入'}</h4>{entry&&<OutLink href={entry.url}>{entry.name}</OutLink>}</div>
  {mode==='wordpress'?<>
   <p>工作台已适配 WordPress 官方文章与媒体接口。使用拥有发文和上传图片权限的网站账号；以下信息都来自你自己的网站，不需要第三方发布服务。</p>
   <ol>
    <li><strong>网站地址</strong><span>复制你网站的完整 HTTPS 地址；若 WordPress 安装在子目录，也保留该目录。这里填写网站地址即可。</span></li>
    <li><strong>用户名</strong><span>用该账号登录网站后台，进入「用户 → 个人资料」，复制「用户名」；不要填写对外显示的昵称。</span></li>
    <li><strong>应用程序密码</strong><span>在同一页找到「应用程序密码」，名称可填「梯世界工作台」，点击新增并立即复制生成的密码。它与网页登录密码分开管理，只会完整显示一次。</span></li>
   </ol>
   <div className="publish-guide-links">{profile?<OutLink href={profile}>打开我的网站个人资料</OutLink>:<span>填写网站地址后，可一键打开该网站的个人资料页。</span>}<OutLink href={wordpressHelp}>WordPress 官方获取说明</OutLink></div>
   <p className="publish-guide-note">找不到「应用程序密码」时，请让建站管理员检查网站 HTTPS、账号权限及安全插件设置。</p>
  </>:<>
   <p>{platform==='website'?'适用于已有专用发文接口的官网。由建站管理员提供兼容本工作台的服务地址与凭据；普通网站首页不能代替发文接口。':'仅适用于你已经拥有的、已授权当前平台账号且兼容本工作台的发布服务。这是第三方接入，不是平台原生接口。'}</p>
   <ol>
    <li><strong>HTTPS 发布地址</strong><span>由你的{platform==='website'?'建站管理员或发布服务商':'发布服务商'}提供，或在该服务后台的「接口 / 自动化 / 开发者」设置中复制。先确认此地址专门用于向当前平台发文。</span></li>
    <li><strong>访问令牌</strong><span>向同一服务商申请，或在同一服务后台创建用于发文的访问凭据；必须与上面的发布地址配套。它不是平台登录密码、手机验证码或浏览器登录信息。</span></li>
    <li><strong>启用连接</strong><span>核对目标账号、地址与令牌后勾选，再点击「保存连接」。保存只保留设置，不会立即发布文章。</span></li>
   </ol>
   <p className="publish-guide-note">{entry?'官方创作后台不会提供本工具的通用发布服务地址与令牌。':'请由建站管理员确认接口兼容性。'}保存连接不代表已通过真实账号发文验证；工作台不会自动创建平台授权。</p>
  </>}
 </aside>;
}

export function WechatConnectionGuide(){
 return <aside className="publish-connection-guide" aria-label="公众号参数获取指南">
  <span className="publish-access-status native">已适配公众号官方草稿与发布接口</span>
  <div className="publish-guide-heading"><h4>公众号参数从哪里获取？</h4><OutLink href={wechatDeveloperEntry}>打开微信开发者平台</OutLink></div>
  <p>由公众号管理员登录并选择需要连接的公众号。AppID 与 AppSecret 必须属于同一个公众号；后台菜单名称以微信当前页面为准。</p>
  <ol>
   <li><strong>账号备注名</strong><span>自己填写一个方便辨认的名称，例如「公司官方公众号」。它只用于本机区分账号。</span></li>
   <li><strong>AppID</strong><span>在对应公众号的「基础信息」中找到开发者 ID（AppID），复制到下方。</span></li>
   <li><strong>AppSecret</strong><span>在对应公众号的「开发密钥」管理中获取，由管理员按微信提示完成验证后复制到下方。已有可用密钥请优先使用，重置可能影响其他已连接工具。</span></li>
   <li><strong>IP 白名单</strong><span>保存后先测试连接。如提示需要 IP 白名单，展开本页「连接帮助」，检测并复制出口 IP，再到微信开发者平台为此公众号添加。</span></li>
  </ol>
  <p className="publish-guide-note">看不到开发设置或接口权限时，请联系该公众号管理员核对权限。无需手动获取临时访问令牌，工作台会用已保存的连接向微信申请。测试连接成功只证明鉴权通过；草稿、发布权限和账号资格仍以微信实际返回为准。凭据可保留到被撤销或失效，不承诺永久授权。</p>
 </aside>;
}
