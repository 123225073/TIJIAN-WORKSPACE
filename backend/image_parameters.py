"""Resolve display intent to advertised model options; never invent provider support."""
import math,re

META={'requested_ratio','requested_resolution'}

def ratio(value):
    if not isinstance(value,str) or not re.fullmatch(r'\d{1,5}(?:\.\d{1,4})?\s*:\s*\d{1,5}(?:\.\d{1,4})?',value):raise ValueError('比例请填写正数，例如 2.32:1')
    a,b=map(float,value.split(':'))
    if a<=0 or b<=0 or not .05<=a/b<=20:raise ValueError('比例需在 1:20 至 20:1 之间')
    return a/b

def normalize(choices,options):
    out=dict(options)
    requested=out.get('requested_ratio')
    resolution=out.get('requested_resolution')
    if requested is not None:target=ratio(requested)
    else:target=None
    if resolution is not None and resolution not in ('1K','2K','4K'):raise ValueError('请选择 1K、2K 或 4K 分辨率')
    if target is None and resolution is None:return out
    if choices.get('size'):
        sizes=[]
        for value in choices['size']:
            match=re.fullmatch(r'(\d+)[x*](\d+)',value)
            if match:
                w,h=map(int,match.groups());sizes.append((value,w,h))
        if not sizes:raise ValueError('当前模型没有可用的尺寸')
        current=next((x for x in sizes if x[0]==out.get('size')),sizes[0])
        target=target if target is not None else current[1]/current[2]
        edge={'1K':1024,'2K':2048,'4K':4096}.get(resolution,max(current[1:]))
        selected=min(sizes,key=lambda x:(round(abs(math.log((x[1]/x[2])/target)),5),abs(math.log(max(x[1:])/edge))))
        out['size']=selected[0]
    elif choices.get('aspect_ratio'):
        if target is not None:out['aspect_ratio']=min(choices['aspect_ratio'],key=lambda x:abs(math.log(ratio(x)/target)))
        if resolution:
            values=choices.get('resolution',[])
            if not values:raise ValueError('当前模型没有可用的分辨率')
            out['resolution']=min(values,key=lambda x:abs(math.log(float(x.lower().rstrip('k'))/float(resolution[:-1]))))
    else:raise ValueError('当前模型没有可用的图片参数')
    return out

def notice(options):
    """Describe the frozen request, independently of current catalogue configuration."""
    requested=options.get('requested_ratio');resolution=options.get('requested_resolution');changes=[]
    size=options.get('size');actual=options.get('aspect_ratio')
    if size:
        match=re.fullmatch(r'(\d+)[x*](\d+)',size)
        if match:
            w,h=map(int,match.groups());div=math.gcd(w,h);actual=f'{w//div}:{h//div}'
            actual_resolution='1K' if max(w,h)<=1600 else '2K' if max(w,h)<=3000 else '4K'
        else:return ''
    else:actual_resolution=str(options.get('resolution','')).upper()
    if requested and actual and abs(math.log(ratio(actual)/ratio(requested)))>.001:changes.append(f'比例 {requested} → {actual}')
    if resolution and actual_resolution and resolution!=actual_resolution:changes.append(f'分辨率 {resolution} → {actual_resolution}')
    return '当前模型不支持所选参数，已采用最接近的可用设置：'+'；'.join(changes) if changes else ''
