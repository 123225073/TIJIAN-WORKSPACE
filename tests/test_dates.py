from bs4 import BeautifulSoup
from backend.network import publication_date,within_dates

def test_publication_metadata_not_page_rebuild_time():
    html='<meta name="MakeTime" content="2026-09-16"><meta name="PubDate" content="2025-06-11 18:52">'
    assert publication_date(BeautifulSoup(html,'html.parser'),html)=='2025-06-11'
    assert within_dates('2025-06-11','2026-01-01','2026-12-31') is False
    assert within_dates('','2026-01-01','2026-12-31') is None
    assert within_dates('2025-06-11','2025-06-11','2025-06-11') is True

def test_unknown_and_invalid_dates_remain_unknown():
    html='<meta name="PubDate" content="2025-99-99">正文2026-01-01'
    assert publication_date(BeautifulSoup(html,'html.parser'),html)==''
