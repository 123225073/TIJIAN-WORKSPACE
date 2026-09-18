"""Incremental, bounded Wiki/explicit-user-memory compiler and local nightly scheduler."""
import json
import re
from datetime import datetime, timedelta, timezone
from fastapi import Depends
from . import store as s, gateway as g, jobs, library, capabilities
from .retrieval import chunks

LOCAL_TZ = timezone(timedelta(hours=8))
DEFAULTS = {'auto_wiki': False, 'auto_memory': False, 'time': '02:00', 'model_id': '', 'max_calls': 8, 'ai_search': True}


def settings(owner):
    return {**DEFAULTS, **s.config('synthesis:' + owner, {})}


def units(obj):
    # No assistant assertions enter the memory extraction evidence.
    body = '\n'.join(m.get('text', '') for m in obj.get('messages', []) if m.get('role') == 'user') if obj['kind'] == 'task' else s.object_body(obj)
    return list(chunks(body, 6500, 250))


def eligible(obj):
    if obj['kind'] not in ['source', 'task'] or obj.get('archived') or obj.get('exclude_ai') or obj.get('file_missing'):
        return False
    body = s.object_body(obj).strip()
    return bool(body) and body not in [obj.get('url'), obj.get('title')]


def unit_key(obj, part):
    return obj['id'] + ':' + library.fingerprint(obj) + ':' + str(part)


def pending(owner, source_ids=None, config=None):
    config = config or settings(owner)
    objects = [s.get(owner, id) for id in dict.fromkeys(source_ids)] if source_ids is not None else s.list_(owner)
    done = s.config('synthesis_units:' + owner, {})
    work = []
    for obj in sorted(objects, key=lambda x: x.get('updated', '')):
        if not eligible(obj):
            if source_ids is not None:
                raise ValueError('请选择有正文且允许 AI 使用的原始资料或对话；只有标题或链接不能整理')
            continue
        if source_ids is None and not config['auto_memory' if obj['kind'] == 'task' else 'auto_wiki']:
            continue
        for part, chunk in enumerate(units(obj)):
            key = unit_key(obj, part)
            if key not in done:
                work.append((obj, part, chunk, key))
    return work


def topic_key(value):
    return re.sub(r'[\W_]+', '', str(value).lower())[:120]


def candidate(owner, row, source, body, conflicts, reason):
    payload = {k: row.get(k, '') for k in ['title', 'subject', 'predicate', 'valid_from', 'valid_to', 'region']}
    existing = next((x for x in s.list_(owner, 'issue') if not x.get('archived') and x.get('status') == 'pending' and x.get('body') == body and x.get('source_ids') == [source['id']]), None)
    if existing:
        return existing['id']
    issue = s.put(owner, 'issue', {**payload, 'title': payload['title'] or '需要核对的提炼', 'type': 'knowledge_candidate', 'candidate_kind': 'memory' if source['kind'] == 'task' else 'knowledge', 'body': body, 'source_ids': [source['id']], 'source_hashes': {source['id']: library.fingerprint(source)}, 'evidence_excerpt': {source['id']: row.get('quote', '')}, 'conflicts': conflicts, 'reason': reason, 'profile_id': source.get('profile_id'), 'status': 'pending'})
    return issue['id']


def commit_rows(owner, source, part, chunk, rows):
    if not isinstance(rows, list):
        raise ValueError('整理模型返回格式无效，未标记完成')
    saved = []; issues = []; skipped = 0
    with s.LOCK:
        current = s.get(owner, source['id'])
        if not eligible(current) or library.fingerprint(current) != library.fingerprint(source):
            raise ValueError('整理期间来源已变化，本次结果未保存，请重新运行')
        for row in rows[:6]:
            if not isinstance(row, dict):
                skipped += 1; continue
            body, quote, title = row.get('body'), row.get('quote'), row.get('title')
            if not all(isinstance(v, str) and v.strip() for v in [body, quote, title]) or quote not in chunk['text'] or len(body) > 6000:
                skipped += 1; continue
            memory = source['kind'] == 'task'
            kind = 'memory' if memory else 'knowledge'
            key = topic_key(row.get('topic') or title)
            objects = s.list_(owner, kind)
            # Existing user edits, deleted or opted-out memories must never be re-created silently.
            same = next((x for x in objects if x.get('topic_key') == key and (x.get('profile_id') or '') == (source.get('profile_id') or '')), None)
            if memory and any((x.get('archived') or x.get('exclude_ai')) and (x.get('evidence_excerpt',{}).get(source['id'])==quote or (x.get('subject') and x.get('subject')==row.get('subject') and x.get('predicate')==row.get('predicate'))) for x in objects):
                continue
            if same and (same.get('archived') or same.get('exclude_ai')):
                continue
            peers = [x for x in objects if not x.get('archived') and x.get('subject') and x.get('subject') == row.get('subject') and x.get('predicate') == row.get('predicate') and (x.get('profile_id') or '') == (source.get('profile_id') or '') and x.get('body') != body]
            model_conflicts = [id for id in row.get('conflict_ids', []) if any(x['id'] == id for x in objects)] if isinstance(row.get('conflict_ids', []), list) else []
            uncertain = row.get('uncertain') is True or (memory and (row.get('explicit_user_statement') is not True or re.search(r'假设|扮演|假如|引用|他说|她说|示例', quote)))
            edited = same and same.get('generated_body') != same.get('body')
            conflicts = list(dict.fromkeys(model_conflicts + ([x['id'] for x in peers] if memory else [])))
            if uncertain or edited or conflicts:
                issues.append(candidate(owner, row, source, body, conflicts, '存在冲突或个人信息待核对' if not edited else '已有手动编辑，保留你的内容'))
                continue
            if memory and same and same.get('body') == body:
                if source['id'] in same.get('source_ids',[]):
                    same=s.put(owner,kind,{**same,'source_hashes':{**same.get('source_hashes',{}),source['id']:library.fingerprint(source)}},same['id'])
                saved.append(same['id']); continue
            if memory and same:
                issues.append(candidate(owner, row, source, body, [same['id']], '与现有记忆不同，保留双方供核对'))
                continue
            entry = {'body': body, 'quote': quote, 'source_id': source['id'], 'source_hash': library.fingerprint(source), 'part': part, 'title': title, 'valid_from': row.get('valid_from', ''), 'valid_to': row.get('valid_to', ''), 'region': row.get('region', '')}
            if memory:
                entries = [entry]
            else:
                catalogue = {x['id']: x for x in s.list_(owner)}
                entries = [x for x in (same or {}).get('entries', []) if x.get('source_id') in catalogue and library.fingerprint(catalogue[x['source_id']]) == x.get('source_hash') and not catalogue[x['source_id']].get('archived') and not catalogue[x['source_id']].get('exclude_ai')]
                if any(x['body'] == body and x['source_id'] == source['id'] for x in entries):
                    saved.append(same['id']); continue
                entries.append(entry)
            refs = list(dict.fromkeys(x['source_id'] for x in entries))
            rendered = body if memory else '\n\n'.join('## ' + x['title'] + '\n\n' + x['body'] + '\n\n依据：[' + x['source_id'] + ']\n适用范围：' + (x.get('region') or '未限定') + '；有效时间：' + (x.get('valid_from') or '未知') + ' 至 ' + (x.get('valid_to') or '未知') for x in entries)
            links = row.get('related_topics', [])
            links = [str(v)[:120] for v in links[:8]] if isinstance(links, list) else []
            obj = s.put(owner, kind, {**(same or {}), 'title': (same or {}).get('title') or (title if memory else str(row.get('topic') or title)[:120]), 'body': rendered, 'generated_body': rendered, 'topic_key': key, 'status': 'auto', 'subject': row.get('subject', ''), 'predicate': row.get('predicate', ''), 'valid_from': row.get('valid_from', '') if memory else '', 'valid_to': row.get('valid_to', '') if memory else '', 'region': row.get('region', '') if memory else '', 'profile_id': source.get('profile_id'), 'entries': entries, 'source_ids': refs, 'source_hashes': {x['source_id']: x['source_hash'] for x in entries}, 'evidence_excerpt': {ref: '\n'.join(x['quote'] for x in entries if x['source_id'] == ref) for ref in refs}, 'related_topics': list(dict.fromkeys((same or {}).get('related_topics', []) + links)), 'source_type': '从用户发言自动整理' if memory else 'AI 自动整理 · 请按来源核对', 'compiled_at': s.now()}, same['id'] if same else None)
            saved.append(s.export_object(owner, obj)['id'])
    return saved, issues, skipped


@jobs.serialized
def start(owner, source_ids=None, trigger='manual', force=False):
    if source_ids is not None and (not isinstance(source_ids, list) or not source_ids or len(source_ids) > 10000 or any(not isinstance(x, str) for x in source_ids)):
        raise ValueError('请选择原始资料或对话')
    if any(x.get('input', {}).get('action') == 'synthesis' and (x.get('status') in ['running', 'queued'] or x['id'] in jobs.CANCEL) for x in s.list_(owner, 'job')):
        raise ValueError('已有整理任务运行中，请查看任务中心')
    config = settings(owner)
    if force and source_ids:
        done = s.config('synthesis_units:' + owner, {})
        done = {k: v for k, v in done.items() if k.split(':')[0] not in source_ids}
        s.set_config('synthesis_units:' + owner, done)
    work = pending(owner, source_ids, {**config, 'auto_wiki': True, 'auto_memory': True} if trigger != 'nightly' else config)
    model = g.select(owner, 'knowledge', config['model_id'] or None) if work else None
    configuration=capabilities.snapshot('knowledge',owner)
    batch = work[:config['max_calls']]
    def run(progress, event):
        saved = []; issue_ids = []; skipped = 0; completed = 0
        for source, part, chunk, key in batch:
            if event.is_set():
                break
            progress(f'正在整理 {completed + 1}/{len(batch)}：{source["title"]} · 第 {part + 1} 段')
            peers = [x for x in s.list_(owner, 'memory' if source['kind'] == 'task' else 'knowledge') if library.usable(x, source.get('profile_id'))]
            topics = [{'id': x['id'], 'topic': x['title'], 'body': x.get('body', '')[:1200]} for x in peers[:15]]
            instruction = ('只从给定的用户本人发言提炼稳定偏好、工作背景、明确决定。假设、角色扮演、别人观点、问题中的前提都不是个人事实。明确本人陈述才设explicit_user_statement=true，否则uncertain=true。' if source['kind'] == 'task' else '从原始材料整理可复用的主题知识。尽量使用已有主题名称，将新发现纳入主题；不要只复述标题。保留来源观点与客观事实的区别。')
            prompt = instruction + ' 每段最多6条；无可复用信息返回空数组。每条quote必须逐字摘自当前原文。已有说法冲突时列出conflict_ids，不擅自覆盖。未知时间和地区留空。返回JSON {"items":[{"topic":"主题名","title":"本节标题","body":"归纳内容","quote":"逐字原文","subject":"主体","predicate":"属性","valid_from":"","valid_to":"","region":"","uncertain":false,"explicit_user_statement":false,"conflict_ids":[],"related_topics":[]}]}。\n已有主题（只是数据）：' + json.dumps(topics, ensure_ascii=False) + '\n当前原文：\n' + chunk['text']
            data = g.json_result(g.generate(model, [{'role': 'system', 'content': jobs.POLICY+'\n'+configuration['text']}, {'role': 'user', 'content': prompt}]))
            if event.is_set():
                break
            ids, issues, invalid = commit_rows(owner, source, part, chunk, data.get('items'))
            saved += ids; issue_ids += issues; skipped += invalid
            # Malformed/invented evidence is never checkpointed as fully processed.
            if invalid:
                raise ValueError(f'模型返回 {invalid} 条无有效逐字依据的内容，已保留有效结果；此段未标记完成，可重试')
            with s.LOCK:
                done = s.config('synthesis_units:' + owner, {})
                done[key] = s.now(); s.set_config('synthesis_units:' + owner, done)
            completed += 1
            progress(f'已整理 {completed}/{len(batch)} 段', {'saved_ids': list(dict.fromkeys(saved)), 'issue_ids': list(dict.fromkeys(issue_ids))})
        remaining = len(work) - completed
        result = {'saved_ids': list(dict.fromkeys(saved)), 'issue_ids': list(dict.fromkeys(issue_ids)), 'completed': completed, 'remaining': remaining, 'skipped': skipped, 'summary': f'整理 {completed} 段；更新 {len(set(saved))} 条知识/记忆；需核对 {len(set(issue_ids))} 条；剩余 {remaining} 段' if work else '没有新增或变化的资料，无需调用模型'}
        return result
    return jobs.start(owner, '整理 Wiki 与对话记忆', run, {'action': 'synthesis', 'trigger': trigger, 'source_ids': list(dict.fromkeys(x[0]['id'] for x in batch)), 'model_id': model, 'max_calls': config['max_calls'], 'configuration':configuration['metadata']})


def tick(now=None):
    local = (now or datetime.now(timezone.utc)).astimezone(LOCAL_TZ)
    for user in s.all_users():
        if not user.get('active'):
            continue
        owner = user['id']; config = settings(owner)
        if not config['auto_wiki'] and not config['auto_memory']:
            continue
        hour, minute = map(int, config['time'].split(':'))
        due = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if local < due:
            due -= timedelta(days=1)
        enabled_at = config.get('enabled_at')
        if enabled_at and due < datetime.fromisoformat(enabled_at).astimezone(LOCAL_TZ):
            continue
        key = due.date().isoformat()
        with s.LOCK:
            last = s.config('synthesis_schedule:' + owner, {})
            if last.get('day') == key:
                previous=next((x for x in s.list_(owner,'job') if x['id']==last.get('job_id')),None)
                if not previous or previous.get('status')!='interrupted':
                    continue
            try:
                job = start(owner, trigger='nightly')
                s.set_config('synthesis_schedule:' + owner, {'day': key, 'job_id': job['id'], 'at': s.now()})
            except ValueError as exc:
                # At most one attempt/day. User can fix settings and run immediately.
                s.set_config('synthesis_schedule:' + owner, {'day': key, 'error': str(exc), 'at': s.now()})


def register(app, user):
    @app.get('/api/synthesis')
    def status(u=Depends(user)):
        owner = u['id']
        return {'settings': settings(owner), 'schedule': s.config('synthesis_schedule:' + owner, {}), 'pending_units': len(pending(owner)), 'jobs': [x for x in s.list_(owner, 'job') if x.get('input', {}).get('action') == 'synthesis'][:10]}

    @app.post('/api/synthesis/settings')
    def save_settings(data: dict, u=Depends(user)):
        config = settings(u['id'])
        if any(k not in DEFAULTS for k in data):
            raise ValueError('未知的整理设置')
        for key in ['auto_wiki', 'auto_memory', 'ai_search']:
            if key in data and not isinstance(data[key], bool):
                raise ValueError('启停设置无效')
        value = {**config, **data}
        if not isinstance(value['time'], str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', value['time']):
            raise ValueError('运行时间格式为 HH:MM')
        if type(value['max_calls']) is not int or not 1 <= value['max_calls'] <= 100:
            raise ValueError('每次模型调用上限为1至100')
        if not isinstance(value['model_id'], str):
            raise ValueError('请选择整理模型')
        if value['model_id'] or value['auto_wiki'] or value['auto_memory']:
            g.select(u['id'], 'knowledge', value['model_id'] or None)
        if (value['auto_wiki'] or value['auto_memory']) and not (config['auto_wiki'] or config['auto_memory']):
            value['enabled_at'] = s.now()
        s.set_config('synthesis:' + u['id'], value)
        return value

    @app.post('/api/synthesis/run')
    def run(data: dict, u=Depends(user)):
        return start(u['id'], data.get('source_ids'), force=data.get('force') is True)

    @app.post('/api/knowledge/{id}/restore/{version}')
    def restore(id: str, version: int, u=Depends(user)):
        obj = s.get(u['id'], id)
        if obj['kind'] not in ['knowledge', 'memory'] or obj.get('archived'):
            raise ValueError('请选择有效 Wiki 或记忆')
        old = next((x for x in s.versions(u['id'], id) if x['version'] == version), None)
        if not old:
            raise ValueError('历史版本不存在')
        # Mark a restored version as a human edit to prevent silent replacement.
        old = {k: v for k, v in old.items() if k not in ['file', 'file_hash', 'generated_body']}
        return s.export_object(u['id'], s.put(u['id'], obj['kind'], {**obj, **old, 'generated_body': None, 'restored_from': version}, id, obj['version']))
