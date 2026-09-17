const catalogue=require('./platforms.json');
const aliases={wechat:['mp.weixin.qq.com'],channels:['channels.weixin.qq.com'],weibo:['weibo.com','weibo.cn'],xiaohongshu:['xiaohongshu.com','xhslink.com'],toutiao:['toutiao.com'],zhihu:['zhihu.com'],douyin:['douyin.com','iesdouyin.com'],bilibili:['bilibili.com','b23.tv'],kuaishou:['kuaishou.com','gifshow.com'],github:['github.com'],x:['x.com','twitter.com','t.co'],xianyu:['goofish.com','xianyu.com']};
function platformFor(url){try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)return null;return Object.entries(aliases).find(([,hosts])=>hosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))?.[0]||null}catch{return null}}
function candidates(state,url,explicit){
 const platform=platformFor(url),channels=state.objects.filter(x=>x.kind==='channel'&&!x.archived&&catalogue.some(p=>p.value===x.platform));
 if(explicit){const selected=channels.find(x=>x.id===explicit);if(!selected)throw Error('平台账号不存在');if(platform&&selected.platform!==platform)throw Error('所选账号与网址平台不同，请选择对应平台账号');return {platform:selected.platform,channels:[selected]};}
 return {platform,channels:platform?channels.filter(x=>x.platform===platform):[]};
}
module.exports={platformFor,candidates};
