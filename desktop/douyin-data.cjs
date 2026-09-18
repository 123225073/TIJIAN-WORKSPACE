// Normalize only responses delivered to the real platform page. Never generate signatures.
function mediaURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&['douyinvod.com','douyin.com','douyinpic.com','byteimg.com','ibytedtos.com','pstatp.com','bytecdn.cn'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.href:null}catch{return null}}
function normalize(row,sec){
 if(!row||row.author?.sec_uid!==sec||!/^\d{5,30}$/.test(String(row.aweme_id||'')))return null;
 const photos=Array.isArray(row.images)?row.images:[],video=row.video||{},stats=row.statistics||{};
 const urls=x=>(x?.url_list||[]).map(mediaURL).filter(Boolean);
 // Follow upstream's mirror fallback and H264 preference. Only use URLs supplied by the platform.
 const videoURLs=[...new Set(['play_addr_h264','play_addr_265','play_addr_256','play_addr'].flatMap(k=>urls(video[k])))];
 const media=photos.length?photos.map(p=>urls(p)):[videoURLs.length?videoURLs:urls(video.download_addr)].filter(x=>x.length);
 return {aweme_id:String(row.aweme_id),sec_uid:sec,description:String(row.desc||''),author:String(row.author.nickname||''),create_time:Number(row.create_time)||0,media_type:photos.length?'images':'video',media_count:media.length,metrics:{like:stats.digg_count||0,comment:stats.comment_count||0,share:stats.share_count||0,collect:stats.collect_count||0},media};
}
function rows(payload,sec){const input=Array.isArray(payload?.aweme_list)?payload.aweme_list:payload?.aweme_detail?[payload.aweme_detail]:[];return input.map(x=>normalize(x,sec)).filter(Boolean)}
module.exports={mediaURL,normalize,rows};
