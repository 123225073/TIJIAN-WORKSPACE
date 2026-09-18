const assert=require('node:assert/strict'),d=require('../desktop/douyin-data.cjs');
const sec='real-author',row={aweme_id:'123456',desc:'真实响应夹具',author:{sec_uid:sec,nickname:'博主'},video:{play_addr:{url_list:['https://v.douyinvod.com/a.mp4','http://127.0.0.1/secret']}},statistics:{digg_count:3}};
assert.equal(d.rows({aweme_list:[row,{...row,author:{sec_uid:'other'}}]},sec).length,1);
assert.equal(d.rows({aweme_detail:row},sec)[0].media[0].length,1);
for(const url of ['http://v.douyinvod.com/a','https://douyin.com.evil.test/a','https://x@douyin.com/a','https://localhost/a'])assert.equal(d.mediaURL(url),null);
assert.equal(d.rows({aweme_detail:{...row,aweme_id:'../x'}},sec).length,0);
console.log('Douyin response parser: author identity, URL boundary, detail/list checks passed');
