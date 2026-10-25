import json,re,hashlib
from collections import Counter
from pathlib import Path
from datetime import datetime,timezone
from urllib.parse import unquote
from bs4 import BeautifulSoup

root=Path('.')
docs=root/'docs'
spec=json.loads((docs/'browser-feature-spec.json').read_text(encoding='utf8'))
catalog=json.loads((docs/'uipath-function-catalog.json').read_text(encoding='utf8'))
features=spec['features']; coverage=spec['activityCoverage']
ids=[f['id'] for f in features]; names=[a['name'] for a in coverage]
tools=[t for f in features for t in f['proposedTools']]
assert len(ids)==len(set(ids))==47
assert len(names)==len(set(names))==168
assert len(tools)==len(set(tools))==53
known={f['name']:f for f in catalog['functions']}
assert len(known)==88
assert len([t for f in features if f['phase']=='P0' for t in f['proposedTools']])==21
assert all(a['featureId'] in ids for a in coverage)
assert all(d in ids for f in features for d in f['dependencies'])
assert all(f[k] for f in features for k in ['purpose','inputs','outputs','acceptance','backend'])
assert all(f['implementationStatus']=='proposed' and not f['runtimeVerified'] for f in features)
assert set(spec['existingMcpTools']).isdisjoint(tools)
for f in features:
    for n in f['candidateCommands']:
        assert n in known,n
        actual=any(x['driverVersion']==spec['pinnedDriver'] for x in known[n]['implementations'])
        assert f['candidateCommandAvailability'][n]['entryPresentInPinnedDriver']==actual
        assert actual,(f['id'],n,'absent direct entry proposed without generic route')
        assert f['candidateCommandAvailability'][n]['routeStatus'] not in ['stub-no-response','partial-tab-only'],(f['id'],n)

audit=json.loads((docs/'pinned-driver-audit.json').read_text(encoding='utf8'))
live=json.loads((docs/'EXTENSION-LIVE-VERIFICATION.json').read_text(encoding='utf8'))
probes=json.loads((docs/'EXTENSION-PROTOCOL-PROBES.json').read_text(encoding='utf8'))
assert audit['sourceSha256']==live['sourceHashes']['EmbeddedDriversContainer.js']==probes['sourceSha256']
assert live['passed'] and len(live['results'])==4 and all(x['passed'] for x in live['results'])
assert live['domAutomationLiveVerified'] is False
assert all(x['passed'] for x in probes['results'])
assert len(audit['namedEntries'])==88 and sum(x['entryPresent'] for x in audit['namedEntries'])==78
assert next(x for x in audit['namedEntries'] if x['name']=='FindWebCtrlElements')['status']=='stub-no-response'
assert next(x for x in audit['namedEntries'] if x['name']=='GetHtmlIndex')['status']=='source-path-unverified'
assert all(r['contentBindings'] for r in audit['genericRoutes'])

# Compare coverage against the captured vendor HTML, not only the generated records.
research=Path('work/browser-activity-research')
baseline=set()
for fn in ['index','modern','classic']:
    s=BeautifulSoup((research/(fn+'.html')).read_text(encoding='utf8'),'html.parser').select_one('.theme-doc-markdown')
    assert s is not None
    if fn=='index':
        for tr in s.select('tr'):
            td=tr.select_one('td')
            if td:
                name=td.get_text(' ',strip=True).strip('\u200b \t\r\n')
                if name and name not in ['Activity','Windows','Classic','link']:baseline.add(name)
    else:
        for a in s.select('a[href]'):
            name=a.get_text(' ',strip=True).strip('\u200b \t\r\n')
            href=a['href']
            if name and name!='link' and 'ui-automation/' in href and '#' not in href:
                baseline.add(name)
baseline.update(['Close Popup','Extract Form Data','Extract UI Data (preview)','Fill Form','Update UI Element (former Set Value)', 'Wait for Download','Retry Scope'])
assert baseline==set(names),dict(missing=sorted(baseline-set(names)),extra=sorted(set(names)-baseline))

mapping=(docs/'BROWSER-ACTIVITY-MAPPING.vi.md').read_text(encoding='utf8')
assert sum(line.startswith('| [') for line in mapping.splitlines())==168
catalog_doc=(docs/'BROWSER-AUTOMATION-FEATURES.vi.md').read_text(encoding='utf8')
for f in features:
    assert '\n### '+f['id']+'\n' in catalog_doc
    for t in f['proposedTools']: assert '`'+t+'`' in catalog_doc

def slug(s):
    s=s.strip().lower()
    s=re.sub(r'[^\w\- ]','',s)
    return s.replace(' ','-')

checked_links=0; checked_json=0
paths=[root/'README.md', docs/'BROWSER-AUTOMATION-FEATURES.vi.md',docs/'BROWSER-ACTIVITY-MAPPING.vi.md',docs/'BROWSER-MCP-CONTRACTS.vi.md',docs/'EXTENSION-CAPABILITY-VERIFICATION.vi.md',docs/'UIPATH-EXTENSION-GUIDE.vi.md',docs/'FUNCTION-MATRIX.vi.md',docs/'PLAN-REVIEW.vi.md']
for path in paths:
    body=path.read_text(encoding='utf8')
    assert '\ufffd' not in body
    for code in re.findall(r'```json\s*\n(.*?)\n```',body,re.S):
        json.loads(code); checked_json+=1
    for target in re.findall(r'\]\(([^)]+)\)',body):
        if target.startswith(('https://','http://','mailto:')):continue
        raw,_,frag=target.partition('#')
        dst=(path.parent/unquote(raw)).resolve() if raw else path.resolve()
        assert dst.is_file() or dst==(docs/'browser-docs-validation.json').resolve(),str(dst)
        if frag and dst.suffix=='.md':
            anchors={slug(x) for x in re.findall(r'^#+ (.+)$',dst.read_text(encoding='utf8'),re.M)}
            assert frag in anchors,(dst,frag)
        checked_links+=1

for fn in ['index','modern','classic']:
    entry=next(x for x in spec['sources'] if x['id']==fn)
    assert entry['sha256']==hashlib.sha256((research/(fn+'.html')).read_bytes()).hexdigest()

report=dict(checkedAt=datetime.now(timezone.utc).isoformat(),success=True,
    scope='Documentation, source-route and evidence consistency. Fresh live verification is separately recorded and limited to four existing MCP tools; no live DOM primitive claim.',
    vendorBaselineNames=len(names),independentHtmlNameUnionMatches=True,unmappedActivities=[],duplicateActivityNames=[],
    featureGroups=len(features),proposedTools=len(tools),
    toolsByPhase={p:[t for f in features if f['phase']==p for t in f['proposedTools']] for p in ['P0','P1','P2']},
    classificationCounts=dict(Counter(x['coverage'] for x in coverage)),
    candidateCommandReferencesChecked=sum(len(f['candidateCommands']) for f in features),
    unknownCandidateCommands=[],pinnedEntryPresenceAndRouteStatusChecked=True,
    sourceHashMatchesLiveAndOfflineEvidence=True,freshLiveMcpTools=4,offlineProbes=len(probes['results']),domAutomationLiveVerified=False,
    localLinksChecked=checked_links,jsonExamplesParsed=checked_json,
    sourceSnapshotHashesChecked=3,
    unchangedRuntimeScope='Existing four uipath_* tools; browser_* names remain proposed.',
    reviewedDocuments=[str(p.relative_to(root)).replace('\\','/') for p in paths])
(docs/'browser-docs-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
assert json.loads((docs/'browser-docs-validation.json').read_text(encoding='utf8'))['success']
print(json.dumps({k:v for k,v in report.items() if k not in ['toolsByPhase','reviewedDocuments']},ensure_ascii=False,indent=2))
