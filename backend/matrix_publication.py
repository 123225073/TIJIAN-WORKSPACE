"""Explicit single and batch publication of versioned matrix articles."""
import json
import re

from fastapi import Depends

from . import content_matrix, flow_deliverables, jobs, matrix_publish, store, wechat_publish

PREFIX = '/api/studio/matrix-publication'


def plan(owner, data):
    flow_id = data.get('flow_id')
    flow = flow_deliverables._live(owner, flow_id, 'studio_flow')
    master = content_matrix.get_master(owner, flow)
    requested = data.get('items')
    if not isinstance(requested, list) or not 1 <= len(requested) <= len(content_matrix.CHANNELS):
        raise ValueError('请选择要发布的平台文稿')
    rows, seen = [], set()
    for item in requested:
        if not isinstance(item, dict):
            raise ValueError('发布文稿参数无效')
        platform = item.get('platform')
        if not isinstance(platform, str) or platform not in master['platforms'] or platform in seen:
            raise ValueError('请选择当前作品中不同的已选平台')
        seen.add(platform)
        content = flow_deliverables._live(owner, item.get('content_id'), 'content')
        if (content.get('flow_id') != flow_id or content.get('topic_id') != flow.get('topic_id')
                or content.get('creation_channel') != platform):
            raise ValueError('稿件不属于当前作品、选题或平台')
        if type(item.get('content_version')) is not int or content['version'] != item['content_version']:
            raise store.Conflict('稿件已修改，请刷新后重新核对发布版本')
        row = {'platform': platform, 'flow_id': flow_id, 'content_id': content['id'],
               'content_version': content['version'], 'title': content.get('title', ''), 'ready': False}
        try:
            if platform == 'wechat':
                account = wechat_publish._account(owner, item.get('account_id'))
                if not account.get('enabled') or not account.get('secret'):
                    raise ValueError('请启用公众号账号')
                delivery_id = wechat_publish._matrix_delivery_id(owner, flow_id, content)
                try:
                    delivery = wechat_publish._delivery(owner, delivery_id)
                except store.Missing:
                    delivery = {}
                cover = item.get('cover_asset_id') or delivery.get('cover_asset_id') or content.get('cover_asset_id', '')
                summary = item.get('summary', delivery.get('summary', content.get('summary', '')))
                if not isinstance(summary, str) or len(summary) > 120:
                    raise ValueError('公众号摘要须在 120 字以内')
                if not cover:
                    raise ValueError('请选择公众号封面')
                wechat_publish._image(owner, cover)
                fields = wechat_publish._matrix_fields(content)
                if not fields['title'] or len(fields['title']) > 32 or len(fields['author']) > 64 or not fields['body']:
                    raise ValueError('公众号需要完整正文、32 字内标题和 64 字内作者')
                record = wechat_publish._record(owner, delivery_id, account['id'])
                row.update(account_id=account['id'], account_name=account['name'],
                           account_revision=store.digest(json.dumps(account, sort_keys=True)),
                           cover_asset_id=cover, summary=summary, destination='微信公众号 · ' + account['name'])
                if record and record.get('status') in ('publishing', 'published', 'uncertain', 'removed', 'failed'):
                    row.update(receipt={'status': record['status'], 'url': record.get('article_url', '')})
                    if record.get('publish_id') and record['status'] in ('publishing', 'uncertain'):
                        row['checkable'] = True
                        row['delivery_id'] = delivery_id
                    raise ValueError('此版本已有发布记录，请核查原任务')
            else:
                config = store.config(matrix_publish.config_key(owner, platform), {})
                if not config.get('enabled') or not config.get('secret') or not config.get('endpoint'):
                    raise ValueError('请先在发布账号中配置并启用此平台')
                row.update(config_revision=config['revision'], destination=config['endpoint'])
                ident = store.digest(f'matrix-publish:{owner}:{platform}:{flow_id}:{content["id"]}:{content["version"]}')
                try:
                    row['receipt'] = matrix_publish.public_receipt(store.get(owner, ident))
                except store.Missing:
                    pass
                if row.get('receipt'):
                    raise ValueError('此版本已有发布记录，请核查原任务')
                matrix_publish.package_content(owner, flow, content)
            row['ready'] = True
        except (ValueError, store.Missing) as exc:
            row['reason'] = str(exc)
        row['plan_key'] = store.digest(json.dumps(row, sort_keys=True, ensure_ascii=False))
        rows.append(row)
    return rows


def register(app, user):
    def call(path, **kwargs):
        route = next(route for route in app.routes if getattr(route, 'path', '') == path and 'POST' in getattr(route, 'methods', set()))
        return route.dependant.call(**kwargs)

    @app.post(PREFIX + '/preview')
    def preview(data: dict, u=Depends(user)):
        with store.LOCK:
            return {'items': plan(u['id'], data)}

    @app.get(PREFIX + '/jobs')
    def publication_jobs(flow_id: str, u=Depends(user)):
        flow_deliverables._live(u['id'], flow_id, 'studio_flow')
        return {'items': [row for row in store.list_(u['id'], 'job')
                          if row.get('input', {}).get('action') == 'matrix_publication'
                          and row['input'].get('flow_id') == flow_id][:20]}

    @app.post(PREFIX + '/status')
    def check_status(data: dict, u=Depends(user)):
        # Query only this owner's existing provider task; never submit again.
        with store.LOCK:
            rows = plan(u['id'], data)
        for row in rows:
            if row.get('checkable'):
                call('/api/wechat-publish/status/{delivery_id}', delivery_id=row['delivery_id'],
                     data={'account_id': row['account_id']}, u=u)
        with store.LOCK:
            return {'items': plan(u['id'], data)}

    @app.post(PREFIX + '/publish')
    def publish(data: dict, u=Depends(user)):
        request_id = data.get('request_id')
        if data.get('confirmed') is not True or not isinstance(request_id, str) or not re.fullmatch(r'[0-9a-f-]{36}', request_id):
            raise ValueError('请核对目标账号与文稿后确认发布')
        owner = u['id']
        with store.LOCK:
            for job in store.list_(owner, 'job'):
                inputs = job.get('input', {})
                if inputs.get('action') != 'matrix_publication':
                    continue
                if inputs.get('request_id') == request_id:
                    if inputs.get('flow_id') != data.get('flow_id') or inputs.get('items') != data.get('items'):
                        raise store.Conflict('发布请求编号已用于其他稿件')
                    return job
                if inputs.get('flow_id') == data.get('flow_id') and job.get('status') in ('queued', 'running'):
                    raise store.Conflict('此作品已有发布任务，请等待结果')
            rows = plan(owner, data)
            if any(not row['ready'] or row['plan_key'] != item.get('plan_key') for row, item in zip(rows, data['items'])):
                raise store.Conflict('稿件、账号或发布状态已变化，请刷新后重新核对')

            def run(progress, event):
                outcomes = []
                for row in rows:
                    if event.is_set():
                        break
                    progress('正在提交 ' + content_matrix.CHANNELS[row['platform']][0], {'items': outcomes})
                    try:
                        with store.LOCK:
                            current = plan(owner, {'flow_id': data['flow_id'], 'items': [row]})[0]
                            if current['plan_key'] != row['plan_key'] or not current['ready']:
                                raise store.Conflict('稿件或账号已更新，请重新核对')
                        if row['platform'] == 'wechat':
                            # Reuse the provider's reserved write and receipt guards.
                            delivery = call('/api/wechat-publish/matrix/{flow_id}/{content_id}',
                                flow_id=row['flow_id'], content_id=row['content_id'], u=u,
                                data={'version': row['content_version'], 'cover_asset_id': row['cover_asset_id'], 'summary': row['summary']})
                            request = {'account_id': row['account_id'], 'version': delivery['version'], 'confirmed': True}
                            call('/api/wechat-publish/drafts/{delivery_id}', delivery_id=delivery['id'], data=request, u=u)
                            receipt = call('/api/wechat-publish/publish/{delivery_id}', delivery_id=delivery['id'], data=request, u=u)
                            result = {'status': receipt['status'], 'url': receipt.get('article_url', '')}
                        else:
                            result = matrix_publish.dispatch(owner, {**row, 'confirmed': True, 'request_id': request_id})
                        outcomes.append({'platform': row['platform'], 'content_id': row['content_id'],
                                         'content_version': row['content_version'], 'receipt': result})
                    except Exception as exc:
                        # Provider records retain uncertain requests; never resend here.
                        reason = str(exc) if isinstance(exc, (ValueError, store.Conflict, store.Missing)) else '发布未完成，请核查该平台原任务'
                        outcomes.append({'platform': row['platform'], 'content_id': row['content_id'],
                                         'content_version': row['content_version'], 'error': reason})
                    progress('已处理 ' + str(len(outcomes)) + ' 个平台', {'items': outcomes})
                return {'items': outcomes, 'submitted': sum('receipt' in row for row in outcomes),
                        'failed': sum('error' in row for row in outcomes)}

            return jobs.start(owner, '内容矩阵 · 提交发布', run,
                {'action': 'matrix_publication', 'flow_id': data['flow_id'], 'items': data['items'], 'request_id': request_id})
