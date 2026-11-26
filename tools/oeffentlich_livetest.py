#!/usr/bin/env python3
"""Live-Test der öffentlichen Karte mit Wegwerf-Daten (Karte _livetest, Nutzer _livetest_a/_b).
Legt zwei Spots 30 m auseinander öffentlich an, prüft Ort/Einträge/Profil, räumt danach alles weg."""
import json, subprocess, time, urllib.request
P = 'projekt-fs'
B = f'https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents'
T = subprocess.check_output(['gcloud', 'auth', 'print-access-token']).decode().strip()
def req(m, url, body=None):
    r = urllib.request.Request(url, method=m, data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': 'Bearer ' + T, 'Content-Type': 'application/json', 'x-goog-user-project': P})
    try:
        with urllib.request.urlopen(r) as x: return json.loads(x.read() or b'{}')
    except urllib.error.HTTPError as e:
        if e.code == 404: return None
        raise
def val(v):
    if v is None: return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, float): return {'doubleValue': v}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: val(x) for k, x in v.items()}}}
    return {'stringValue': str(v)}
def py(v):
    k, x = next(iter(v.items()))
    if k == 'mapValue': return {a: py(b) for a, b in x.get('fields', {}).items()}
    if k in ('integerValue',): return int(x)
    if k == 'doubleValue': return float(x)
    if k == 'nullValue': return None
    return x
def put(path, d): req('PATCH', f'{B}/{path}', {'fields': {k: val(v) for k, v in d.items()}})
def get(path):
    r = req('GET', f'{B}/{path}'); return {k: py(v) for k, v in r['fields'].items()} if r else None
def dele(path): req('DELETE', f'{B}/{path}')
def where(col, f, v):
    r = req('POST', f'{B}:runQuery', {'structuredQuery': {'from': [{'collectionId': col}], 'where': {'fieldFilter': {'field': {'fieldPath': f}, 'op': 'EQUAL', 'value': val(v)}}}})
    return [(x['document']['name'].split('/')[-1], {k: py(v) for k, v in x['document']['fields'].items()}) for x in r if 'document' in x]
def wait(cond, sec=60):
    for _ in range(sec // 3):
        r = cond()
        if r: return r
        time.sleep(3)
    return None
ok = lambda c, m: print(('OK   ' if c else 'FAIL ') + m)

put('nutzer/_livetest_a', {'name': 'Testperson', 'photo': ''})
put('nutzer/_livetest_b', {'name': 'Zweiter', 'photo': ''})
put('karten/_livetest/pins/s1', {'name': 'Livetest-Bank', 'desc': 'nur ein Test', 'address': 'Testweg', 'lat': 10.0, 'lng': 10.0, 'photo': 'data:image/jpeg;base64,AAAA', 'r': {'g': 8, 'a': 6, 'u': 10}, 'rs': 10, 'pub': '_livetest_a'})
e = wait(lambda: where('oeffentlich', 'uid', '_livetest_a'))
ok(e and len(e) == 1 and 'photo' not in e[0][1], 'Eintrag angelegt (ohne Foto)')
oid = e[0][1]['ort'] if e else None
o = wait(lambda: (get('orte/' + oid) or {}).get('n') == 1 and get('orte/' + oid)) if oid else None
ok(o and o['name'] == 'Livetest-Bank', 'Ort angelegt, Anzahl 1')
p = get('profile/_livetest_a')
ok(p and p.get('kurz') == 'T…n' and set(p) == {'kurz', 'photo', 'updatedAt'}, 'Profil: Kürzel T…n')
put('karten/_livetest/pins/s2', {'name': 'Bank 2', 'desc': '', 'address': '', 'lat': 10.00027, 'lng': 10.0, 'photo': '', 'r': {'g': 4, 'a': 0, 'u': 6}, 'rs': 10, 'pub': '_livetest_b'})
o = wait(lambda: (get('orte/' + oid) or {}).get('n') == 2 and get('orte/' + oid))
ok(o and o['r']['g'] == 6 and o['r']['u'] == 8, '30 m entfernt: zusammengeführt, Durchschnitt 6 / 8')
dele('karten/_livetest/pins/s1'); dele('karten/_livetest/pins/s2')
ok(wait(lambda: not where('oeffentlich', 'ort', oid) and get('orte/' + oid) is None and get('profile/_livetest_a') is None and get('profile/_livetest_b') is None), 'Spots gelöscht: Einträge, Ort und Profile weg')
dele('nutzer/_livetest_a'); dele('nutzer/_livetest_b'); dele('karten/_livetest')
print('FERTIG-LIVETEST')
