import concurrent.futures
import json
import pathlib
import urllib.request
from urllib.parse import urljoin
from bs4 import BeautifulSoup

OUT = pathlib.Path('work/browser-activity-research')
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'https://docs.uipath.com/activities/other/latest/ui-automation/'
PAGES = {
    'index': 'activities-index',
    'modern': 'ui-automation-modern-activities',
    'classic': 'ui-automation-classic-activities',
    'automation-mode': 'browser-automation-mode',
}

def fetch(item):
    key, slug = item
    url = BASE + slug
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as response:
        html = response.read().decode('utf-8')
    (OUT / f'{key}.html').write_text(html, encoding='utf-8')
    soup = BeautifulSoup(html, 'html.parser')
    body = soup.select_one('.theme-doc-markdown') or soup
    h1 = body.find(['h1', 'h2'])
    text = body.get_text('\n', strip=True)
    (OUT / f'{key}.txt').write_text(text, encoding='utf-8')
    tables = []
    for table in body.find_all('table'):
        rows = []
        for tr in table.find_all('tr'):
            cells = tr.find_all(['th', 'td'], recursive=False)
            rows.append([cell.get_text(' ', strip=True) for cell in cells])
        tables.append(rows)
    anchors = [{'name': a.get_text(' ', strip=True), 'url': urljoin(url, a['href'])}
               for a in body.find_all('a', href=True)]
    activities = []
    for tr in body.select('table tr'):
        cells = tr.find_all(['th', 'td'], recursive=False)
        if len(cells) < 3 or cells[0].name != 'td':
            continue
        name = cells[0].get_text(' ', strip=True)
        link = cells[0].find('a', href=True)
        activities.append({'name': name, 'url': urljoin(url, link['href']) if link else None,
                           'notes': cells[-1].get_text(' ', strip=True)})
    data = {'url': url, 'title': h1.get_text(' ', strip=True) if h1 else None,
            'activities': activities,
            'tables': tables, 'anchors': anchors}
    (OUT / f'{key}.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'key': key, 'title': data['title'], 'tableRows': [len(t) for t in tables],
            'anchors': len(anchors), 'bodyTag': body.name,
            'bodyClass': body.get('class'), 'textLength': len(text)}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for result in pool.map(fetch, PAGES.items()):
        print(json.dumps(result, ensure_ascii=False))
