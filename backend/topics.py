"""Owner-scoped topic library and editable platform delivery drafts."""
from __future__ import annotations

import json
from fastapi import Depends

from . import capabilities, gateway as g, jobs, store as s
from .creation import model

TOPIC_FIELDS = {'title', 'angle', 'rationale', 'audience', 'source_ids', 'profile_id', 'origin', 'origin_ref', 'status'}
DELIVERY_FIELDS = {
    'wechat': ('title', 'summary', 'body', 'cover_brief', 'keywords', 'publishing_notes'),
    'channels': ('title', 'caption', 'script', 'shotlist', 'cover_brief', 'tags'),
    'douyin': ('title', 'caption', 'script', 'shotlist', 'cover_brief', 'tags'),
}
PLATFORM_NAMES = {'wechat': '公众号', 'channels': '视频号', 'douyin': '抖音'}
MEDIA_FIELDS = {'wechat': {'cover_asset_id': 'image'}, 'channels': {'cover_asset_id': 'image', 'video_asset_id': 'video'}, 'douyin': {'cover_asset_id': 'image', 'video_asset_id': 'video'}}
DELIVERY_GUIDES = {
    'wechat': '为公众号写可直接编辑的完整文章：标题点明读者问题；摘要概括收益；正文要有引入、分节解释、适用边界和收束。事实句尽量附[资料ID]，不可编造法规、数字、报价或客户案例。cover_brief 写封面画面而非声称已经生成图片；keywords 是检索词；publishing_notes 列出发布前要核对的事实、图片授权与链接。',
    'channels': '为视频号写适合真人或数字人口播的稿件：标题清楚可信；caption 是发布文案；script 用自然口语讲一个核心问题；shotlist 按镜头说明画面、动作及对应口播，素材不足写待补充；cover_brief 是封面建议；tags 与内容直接相关，不堆热门词。',
    'douyin': '为抖音短视频写适合拍摄的稿件：开头迅速提出真实问题，随后给具体解释或行动建议；caption 与 script 各司其职，shotlist 按镜头列画面与口播对应关系；封面建议和标签准确、克制，不承诺爆款或编造冲突。',
}


def _owned(owner, id, kind):
    obj = s.get(owner, id)
    if obj['kind'] != kind or obj.get('archived'):
        raise s.Missing('对象不存在或无权访问')
    return obj


def _sources(owner, ids):
    if not isinstance(ids, list) or len(ids) > 20 or any(not isinstance(id, str) for id in ids) or len(set(ids)) != len(ids):
        raise ValueError('最多选择20份不重复的资料')
    result = []
    for id in ids:
        obj = s.get(owner, id)
        if obj['kind'] not in {'source', 'content'} or obj.get('archived'):
            raise ValueError('只能引用当前账户的原始资料或作品')
        result.append(obj)
    return result


def _topic_payload(owner, data, old=None):
    if not isinstance(data, dict) or set(data) - (TOPIC_FIELDS | {'version'}):
        raise ValueError('选题字段不受支持')
    item = {**(old or {}), **data}
    title = item.get('title', '')
    if not isinstance(title, str) or not 0 < len(title.strip()) <= 200:
        raise ValueError('请填写200字以内的选题')
    for key in ('angle', 'rationale', 'audience', 'origin', 'origin_ref'):
        if not isinstance(item.get(key, ''), str) or len(item.get(key, '')) > 3000:
            raise ValueError(key + ' 不得超过3000字')
    if item.get('status', 'idea') not in {'idea', 'selected', 'used'}:
        raise ValueError('选题状态无效')
    _sources(owner, item.get('source_ids', []))
    if item.get('profile_id'):
        _owned(owner, item['profile_id'], 'profile')
    return {k: item.get(k, [] if k == 'source_ids' else 'idea' if k == 'status' else '') for k in TOPIC_FIELDS}


def _delivery_payload(platform, data, old=None, owner=None):
    fields = DELIVERY_FIELDS[platform]
    if not isinstance(data, dict) or set(data) - (set(fields) | set(MEDIA_FIELDS[platform]) | {'version'}):
        raise ValueError('交付字段不受支持')
    values = {key: data.get(key, (old or {}).get(key, '')) for key in fields}
    if any(not isinstance(value, str) or len(value) > (30000 if key in {'body', 'script', 'shotlist'} else 3000) for key, value in values.items()):
        raise ValueError('交付内容格式或长度不正确')
    if owner is not None:
        for key, kind in MEDIA_FIELDS[platform].items():
            asset_id = data.get(key, (old or {}).get(key, ''))
            if not isinstance(asset_id, str) or len(asset_id) > 128:
                raise ValueError('素材编号无效')
            if asset_id:
                asset = _owned(owner, asset_id, 'studio_asset')
                if asset.get('asset_type') != kind or asset.get('status') != 'ready':
                    raise ValueError('请选择可用的' + ('图片' if kind == 'image' else '视频') + '素材')
            values[key] = asset_id
    return values


def _delivery(owner, id):
    return _owned(owner, id, 'studio_delivery')


def register(app, user, error):
    @app.get('/api/studio/topics')
    def topic_list(include_archived: bool = False, u=Depends(user)):
        topics = [x for x in s.list_(u['id'], 'studio_topic') if include_archived or not x.get('archived')]
        deliveries = [x for x in s.list_(u['id'], 'studio_delivery') if not x.get('archived')]
        counts = {x['id']: sum(d['topic_id'] == x['id'] for d in deliveries) for x in topics}
        return {'items': [{**x, 'delivery_count': counts[x['id']]} for x in topics]}

    @app.post('/api/studio/topics')
    def topic_create(data: dict, u=Depends(user)):
        payload = _topic_payload(u['id'], data)
        with s.LOCK:
            if payload.get('origin_ref'):
                previous = next((x for x in s.list_(u['id'], 'studio_topic') if not x.get('archived') and x.get('origin_ref') == payload['origin_ref']), None)
                if previous:
                    return previous
            item = s.put(u['id'], 'studio_topic', payload)
        s.audit(u['id'], 'create_topic', item['id'])
        return item

    @app.patch('/api/studio/topics/{id}')
    def topic_update(id: str, data: dict, u=Depends(user)):
        old = _owned(u['id'], id, 'studio_topic')
        if type(data.get('version')) is not int:
            raise ValueError('保存选题需要当前版本号')
        item = s.put(u['id'], 'studio_topic', _topic_payload(u['id'], data, old), id, expected=data['version'])
        s.audit(u['id'], 'update_topic', id)
        return item

    @app.post('/api/studio/topics/{id}/archive')
    def topic_archive(id: str, u=Depends(user)):
        old = _owned(u['id'], id, 'studio_topic')
        s.put(u['id'], 'studio_topic', {**old, 'archived': True}, id, expected=old['version'])
        s.audit(u['id'], 'archive_topic', id)
        return {'ok': True}

    @app.post('/api/studio/topics/{id}/restore')
    def topic_restore(id: str, u=Depends(user)):
        old = s.get(u['id'], id)
        if old['kind'] != 'studio_topic':
            raise s.Missing('选题不存在')
        item = s.put(u['id'], 'studio_topic', {**old, 'archived': False}, id, expected=old['version'])
        s.audit(u['id'], 'restore_topic', id)
        return item

    @app.post('/api/studio/topics/generate')
    def topic_generate(data: dict, u=Depends(user)):
        if not isinstance(data, dict) or set(data) - {'brief', 'source_ids', 'profile_id', 'request_id', 'count'}:
            raise ValueError('生成选题参数无效')
        brief = str(data.get('brief', '')).strip()
        if not brief or len(brief) > 2000:
            raise ValueError('请写下2000字以内的找题方向')
        count = data.get('count', 5)
        if type(count) is not int or count not in (3, 5, 10, 20):
            raise ValueError('每次可生成3、5、10或20条选题')
        sources = _sources(u['id'], data.get('source_ids', []))
        profile = _owned(u['id'], data['profile_id'], 'profile') if data.get('profile_id') else None
        model_id = model(u['id'], 'topics', {})
        method = capabilities.snapshot('topics')
        request_id = str(data.get('request_id', ''))[:100]
        owner = u['id']
        def work(progress, event):
            progress('正在结合已选资料生成选题')
            payload = {'方向': brief, 'IP定位': {k: profile.get(k, '') for k in ('title', 'position', 'audience')} if profile else None,
                       '资料': [{'id': x['id'], 'title': x.get('title'), 'body': x.get('body', '')[:6000], 'url': x.get('url'), 'published': x.get('published')} for x in sources]}
            text = g.generate(model_id, [{'role': 'system', 'content': jobs.POLICY + '\n' + method['text'] + f'\n只返回 JSON 对象，格式为 {{"topics":[{{"title":"","angle":"","rationale":"","audience":""}}]}}，按推荐顺序最多给出{count}个选题。rationale 要包含依据资料 ID、是否属常青问题或近期信息、资料日期或缺口，以及选择理由；没有资料时明确写“仅为方向建议，待查证”。禁止编造热点、数据、业绩、政策与资料 ID。'}, {'role': 'user', 'content': json.dumps(payload, ensure_ascii=False)}])
            result = g.json_result(text)
            rows = result.get('topics')
            if not isinstance(rows, list) or not 1 <= len(rows) <= count:
                raise ValueError('模型未返回有效选题列表，请重新尝试')
            if event.is_set():
                raise InterruptedError('已取消')
            validated = [_topic_payload(owner, {**row, 'source_ids': [x['id'] for x in sources], 'profile_id': profile['id'] if profile else '', 'origin': 'AI 建议，待编辑', 'status': 'idea'}) for row in rows]
            created = [s.put(owner, 'studio_topic', fields)['id'] for fields in validated]
            return {'topic_ids': created}
        fingerprint = s.digest(json.dumps(data, sort_keys=True))
        with s.LOCK:
            if request_id:
                old = next((j for j in s.list_(owner, 'job') if j.get('input', {}).get('topic_request') == request_id), None)
                if old:
                    if old['input'].get('topic_fingerprint') != fingerprint:
                        raise s.Conflict('提交编号已用于另一项找题请求')
                    return old
            return jobs.start(owner, '生成选题建议', work, {'action': 'studio_topics', 'topic_request': request_id, 'topic_fingerprint': fingerprint})

    @app.get('/api/studio/deliveries')
    def deliveries(topic_id: str = '', u=Depends(user)):
        if topic_id:
            _owned(u['id'], topic_id, 'studio_topic')
        return {'items': [x for x in s.list_(u['id'], 'studio_delivery') if not x.get('archived') and (not topic_id or x['topic_id'] == topic_id)]}

    @app.post('/api/studio/deliveries')
    def delivery_create(data: dict, u=Depends(user)):
        if not isinstance(data, dict) or set(data) - {'topic_id', 'platform'}:
            raise ValueError('新建交付参数无效')
        topic = _owned(u['id'], data.get('topic_id'), 'studio_topic')
        platform = data.get('platform')
        if platform not in DELIVERY_FIELDS:
            raise ValueError('请选择支持的平台')
        item = s.put(u['id'], 'studio_delivery', {'topic_id': topic['id'], 'topic_version': topic['version'], 'platform': platform,
                     'status': 'draft', 'source_ids': topic.get('source_ids', []), **{k: '' for k in DELIVERY_FIELDS[platform]}, **{k: '' for k in MEDIA_FIELDS[platform]}})
        s.audit(u['id'], 'create_delivery', item['id'])
        return item

    @app.patch('/api/studio/deliveries/{id}')
    def delivery_update(id: str, data: dict, u=Depends(user)):
        old = _delivery(u['id'], id)
        if type(data.get('version')) is not int:
            raise ValueError('保存交付稿需要当前版本号')
        values = _delivery_payload(old['platform'], data, old, u['id'])
        item = s.put(u['id'], 'studio_delivery', {**old, **values, 'status': 'draft'}, id, expected=data['version'])
        s.audit(u['id'], 'update_delivery', id)
        return item

    @app.post('/api/studio/deliveries/{id}/generate')
    def delivery_generate(id: str, data: dict, u=Depends(user)):
        delivery = _delivery(u['id'], id)
        topic = _owned(u['id'], delivery['topic_id'], 'studio_topic')
        if data.get('version') != delivery['version']:
            raise s.Conflict('交付稿已更新，请刷新后重试')
        model_id = model(u['id'], 'writing', {})
        method = capabilities.snapshot('writing')
        sources = _sources(u['id'], topic.get('source_ids', []))
        profile = _owned(u['id'], topic['profile_id'], 'profile') if topic.get('profile_id') else None
        owner = u['id']
        def work(progress, event):
            progress('正在生成' + PLATFORM_NAMES[delivery['platform']] + '交付稿')
            fields = DELIVERY_FIELDS[delivery['platform']]
            instructions = '只返回 JSON 对象，字段为 ' + '、'.join(fields) + '，全部为非空字符串。' + DELIVERY_GUIDES[delivery['platform']] + '把用户已有交付稿作为可保留的素材，除明显错误外不要无故覆盖其意思。缺失事实在对应字段标记“待补充”，不得虚构行业法规、资质、报价、案例、已有画面或已发布状态。生成的是可编辑草稿。'
            payload = {'平台': PLATFORM_NAMES[delivery['platform']], '选题': {k: topic.get(k) for k in ('title', 'angle', 'rationale', 'audience')},
                       'IP': {k: profile.get(k, '') for k in ('title', 'position', 'audience', 'style')} if profile else None,
                       '资料': [{'id': x['id'], 'title': x.get('title'), 'body': x.get('body', '')[:8000], 'url': x.get('url')} for x in sources],
                       '已有交付稿': {k: delivery.get(k, '') for k in fields}}
            text = g.generate(model_id, [{'role': 'system', 'content': jobs.POLICY + '\n' + method['text'] + '\n' + instructions}, {'role': 'user', 'content': json.dumps(payload, ensure_ascii=False)}])
            result = g.json_result(text)
            values = _delivery_payload(delivery['platform'], {k: result.get(k, '') for k in fields})
            if any(not value.strip() for value in values.values()):
                raise ValueError('模型返回内容不完整，未覆盖现有交付稿')
            if event.is_set():
                raise InterruptedError('已取消')
            current = _delivery(owner, id)
            if current['version'] != delivery['version']:
                raise s.Conflict('生成期间交付稿已被编辑，未覆盖用户修改')
            saved = s.put(owner, 'studio_delivery', {**current, **values, 'status': 'draft', 'model_id': model_id, 'topic_version': topic['version'], 'source_ids': [x['id'] for x in sources], 'generated_at': s.now()}, id, expected=delivery['version'])
            return {'delivery_id': saved['id'], 'version': saved['version']}
        with s.LOCK:
            previous = next((j for j in s.list_(owner, 'job') if j.get('input', {}).get('action') == 'studio_delivery' and j['input'].get('delivery_id') == id and j['input'].get('delivery_version') == delivery['version'] and j.get('status') in ('queued', 'running', 'done')), None)
            if previous:
                return previous
            return jobs.start(owner, '生成平台交付稿', work, {'action': 'studio_delivery', 'delivery_id': id, 'delivery_version': delivery['version']})
