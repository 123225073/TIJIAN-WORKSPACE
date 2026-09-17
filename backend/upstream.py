"""Reviewed Easel components. No OpenClaw process or arbitrary skill execution."""
import importlib.util, sys
from pathlib import Path
from .store import ROOT
VENDOR=ROOT/'vendor'/'Easel'

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,VENDOR/path)
    mod=importlib.util.module_from_spec(spec);sys.modules[name]=mod;spec.loader.exec_module(mod)
    return mod

rss=load('tijian_easel_rss','skills/openclaw/skill-rss-aggregator/scripts/rss_digest.py')
guard=load('tijian_easel_guard','skills/shared/scripts/content_guard.py')
wechat=load('tijian_easel_wechat','skills/openclaw/skill-wechat-publisher/scripts/html_converter.py')

SKILLS={
 'writing':('公众号写作','skill-wechat-publisher'),
 'research':('行业资料研究','skill-news-intelligence'),
 'benchmark':('对标文章拆解','skill-competitor-analysis'),
 'profile':('个人定位访谈','skill-profile-builder'),
 'style':('表达风格迁移','style-transfer'),
 'topics':('选题策划','skill-trending-topics'),
}

def skill_text(key):
    name=SKILLS.get(key,SKILLS['writing'])[1]
    p=VENDOR/'skills'/'openclaw'/name/'SKILL.md'
    if not p.exists():return ''
    # Only use methodology; the application owns tools and all permissions.
    return p.read_text(encoding='utf-8')[:14000]

def catalogue():
    return [{'id':k,'title':v[0],'source':'Easel','upstream':v[1]} for k,v in SKILLS.items()]
