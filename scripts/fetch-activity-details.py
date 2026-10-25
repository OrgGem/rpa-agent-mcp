import concurrent.futures
import json
import pathlib
import urllib.request
from urllib.parse import urljoin
from bs4 import BeautifulSoup

OUT = pathlib.Path('work/browser-activity-research')
base = 'https://docs.uipath.com/activities/other/latest/ui-automation/'
links = {}
for key in ['modern', 'classic']:
    page = json.loads((OUT / f'{key}.json').read_text(encoding='utf-8'))
    for a in page['anchors']:
        if a['name'].strip('\u200b \n') and a['name'] != 'link' and '/ui-automation/' in a['url']:
            links.setdefault(a['name'], a['url'])
extra = {
    'semantic': base + 'ui-automation-semantic-activities',
    'Wait for Download': 'https://docs.uipath.com/activities/other/latest/workflow/get-last-downloaded-file',
    'Retry Scope': 'https://docs.uipath.com/activities/other/latest/workflow/retry-scope',
    'Browser how to': base + 'how-to-guide',
}
selected = ['Use Application/Browser','Find Elements','For Each UI Element','Element Scope','Check App State','Check Element',
 'Click','Type Into','Set Text','Get Text','Get Attribute','Hover','Drag and Drop','Mouse Scroll','Set Focus','Select Item',
 'Inject Js Script','Extract Table Data','Take Screenshot','Browser Dialog Scope','Browser File Picker Scope','Save Image',
 'Application Event Trigger','Click Event Trigger','Keypress Event Trigger','Window Operation','Get Browser Data','Set Browser Data',
 'Navigate Browser','Go to URL','Set Runtime Browser','Find Element','Find Children','Get Ancestor','Wait Attribute',
 'Wait Element Vanish','Extract Structured Data','Select Multiple Items','Set Web Attribute','Get Position','Find Relative Element']
tasks = {name: links[name] for name in selected if name in links}
tasks.update(extra)

def fetch(item):
    name, url = item
    try:
        req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as response:
            html = response.read().decode('utf-8')
        soup = BeautifulSoup(html, 'html.parser')
        body = soup.select_one('.theme-doc-markdown')
        if body is None:
            raise ValueError('Missing documentation body')
        text = body.get_text('\n', strip=True)
        slug = url.split('/')[-1].split('#')[0]
        (OUT / f'detail-{slug}.txt').write_text(text, encoding='utf-8')
        data = {'name': name, 'url': url, 'text': text,
                'anchors': [{'name':a.get_text(' ',strip=True), 'url':urljoin(url,a['href'])} for a in body.find_all('a',href=True)]}
        return data
    except Exception as error:
        return {'name':name,'url':url,'error':str(error)}

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    results = list(pool.map(fetch,tasks.items()))
(OUT / 'details.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
for item in results:
    print(json.dumps({'name':item['name'],'url':item['url'],'error':item.get('error'),'summary':item.get('text','')[:1250]},ensure_ascii=False))
