const catalogue = require('./platforms.json');
const domains = catalogue.map(p => new URL(p.url).hostname.replace(/^www\./, ''));
const authDomains = ['open.weixin.qq.com', 'weibo.cn', 'sina.com.cn', 'sina.cn', 'passport.weibo.com', 'passport.weibo.cn', 'twitter.com', 'xhslink.com'];
const hostMatches = (host, domain) => host === domain || host.endsWith('.' + domain);
function trustedURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && [...domains, ...authDomains].some(d => hostMatches(u.hostname, d)); } catch { return false; }
}
function popupAllowed(target, opener) { return trustedURL(opener) && (target === 'about:blank' || trustedURL(target)); }
function httpsURL(value) {try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password}catch{return false}}
// Parent-domain cookies are valid for the platform even when that parent is not a login navigation target.
function cookieDomainAllowed(domain) {const host=String(domain).replace(/^\./,'');return trustedURL('https://'+host)||['weixin.qq.com','qq.com','toutiao.com'].includes(host);}

// Runs only inside a platform's rendered page. Returns state, never cookies, tokens or page contents.
function inspectPage(platform) {
  const u = new URL(location.href), text = document.body?.innerText || '';
  const visible = selector => [...document.querySelectorAll(selector)].some(el => {
    const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && el.getClientRects().length > 0;
  });
  const at = host => u.hostname === host || u.hostname.endsWith('.' + host);
  if (platform === 'wechat' && at('mp.weixin.qq.com')) {
    if (visible('iframe[src*="/connect/qrconnect"], .login__qrcode, .login_qrcode_area') || /扫码登录|扫描二维码登录/.test(text)) return 'login_required';
    if (visible('.weui-desktop-account__nickname, .weui-desktop-account__nick, .account_nickname') || (/^\d+$/.test(u.searchParams.get('token') || '') && /内容管理|发表记录/.test(text) && /数据分析|账号成长/.test(text))) return 'authenticated';
  }
  if (platform === 'channels' && at('channels.weixin.qq.com')) {
    if (/\/login(?:\.|\/|$)/.test(u.pathname) || visible('iframe[src*="open.weixin.qq.com/connect/qrconnect"], .login-mask')) return 'login_required';
    if (u.pathname.startsWith('/platform') && visible('.finder-nickname, .finder-uniq-id, .finder-ui-desktop-menu')) return 'authenticated';
  }
  if (platform === 'weibo' && (at('weibo.com') || at('weibo.cn'))) {
    if (/\/login(?:\.|\/|$)/.test(u.pathname) || visible('input[type="password"]') || /扫描二维码登录|验证码登录/.test(text)) return 'login_required';
    if (visible('a[href="/logout"], a[href*="passport.weibo.com/wbsso/logout"], a[href*="passport.weibo.cn/signout"], [node-type="account"] [node-type="loginNick"]')) return 'authenticated';
  }
  if (platform === 'github' && at('github.com') && visible('button[data-login], summary[aria-label="View profile and more"]')) return 'authenticated';
  if (/\/(login|signin)(?:\.|\/|$)/.test(u.pathname) || visible('iframe[src*="open.weixin.qq.com/connect/qrconnect"]')) return 'login_required';
  if(text.trim().length<5 && !visible('iframe, img, canvas, video')) return 'blank';
  return 'unknown';
}
module.exports = {trustedURL, popupAllowed, inspectPage, hostMatches, httpsURL, cookieDomainAllowed};
