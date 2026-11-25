# Prüft die Firestore-Regeln gegen das echte Projekt mit einem Wegwerf-Testkonto (in Cloud Shell ausführen)
import json, time, urllib.request, urllib.error, random, string
KEY = 'AIzaSyBi8vKQETOYjboNPN72zPrSsuZQLUGOKqI'
DB = 'projects/projekt-fs/databases/(default)'
B = 'https://firestore.googleapis.com/v1/' + DB + '/documents'
def call(url, body=None, tok=None, method=None):
    h = {'content-type': 'application/json'}
    if tok: h['Authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method or ('POST' if body is not None else 'GET'))
    try: r = urllib.request.urlopen(req); return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
email = 'regeltest-' + ''.join(random.choices(string.ascii_lowercase, k=6)) + '@example.com'
s, u = call(f'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={KEY}', {'email': email, 'password': 'test-123456', 'returnSecureToken': True})
tok, uid = u['idToken'], u['localId']
print('Testkonto', s, uid)
kid = 'regeltest' + ''.join(random.choices(string.ascii_lowercase, k=6))
def doc(path, fields): return {'update': {'name': f'{DB}/documents/{path}', 'fields': fields}, 'currentDocument': {'exists': False}}
S = lambda v: {'stringValue': v}
def ts(path, field): return {'transform': {'document': f'{DB}/documents/{path}', 'fieldTransforms': [{'fieldPath': field, 'setToServerValue': 'REQUEST_TIME'}]}}
w = [doc(f'karten/{kid}', {'name': S('Regeltest'), 'owner': S(uid)}), ts(f'karten/{kid}', 'createdAt'),
     doc(f'karten/{kid}/mitglieder/{uid}', {'uid': S(uid), 'name': S('Test'), 'rolle': S('owner')}), ts(f'karten/{kid}/mitglieder/{uid}', 'joinedAt'),
     doc(f'nutzer/{uid}/meineKarten/{kid}', {'name': S('Regeltest')}), ts(f'nutzer/{uid}/meineKarten/{kid}', 'joinedAt')]
s, r = call(f'https://firestore.googleapis.com/v1/{DB}/documents:commit', {'writes': w}, tok); print('1 Karte anlegen:', s, r.get('error', {}).get('message', 'ok'))
time.sleep(1)
q = lambda parent, coll: call(f'{B}/{parent}:runQuery' if parent else f'{B}:runQuery', {'structuredQuery': {'from': [{'collectionId': coll}]}}, tok)
s, r = q(f'karten/{kid}', 'pins'); print('2 Spots lesen (Liste):', s, r[0].get('error', {}).get('message', 'ok') if isinstance(r, list) and r else r.get('error', {}).get('message', 'ok') if isinstance(r, dict) else 'ok')
s, r = call(f'{B}/karten/{kid}/pins', {'fields': {'name': S('Testspot'), 'lat': {'doubleValue': 50}, 'lng': {'doubleValue': 8}}}, tok); print('3 Spot anlegen:', s, r.get('error', {}).get('message', 'ok'))
s, r = q(f'karten/{kid}', 'pins'); print('4 Spots lesen nach Anlegen:', s, len([x for x in r if 'document' in x]) if isinstance(r, list) else r)
s, r = q(f'nutzer/{uid}', 'meineKarten'); print('5 meineKarten lesen:', s, len([x for x in r if 'document' in x]) if isinstance(r, list) else r)
s, r = call(f'{B}/karten/{kid}', tok=tok); print('6 Karte lesen:', s, r.get('error', {}).get('message', 'ok'))
s, r = q(f'karten/{kid}', 'mitglieder'); print('7 Mitglieder lesen:', s, len([x for x in r if 'document' in x]) if isinstance(r, list) else r)
# Aufräumen
for p in [f'nutzer/{uid}/meineKarten/{kid}']: call(f'{B}/{p}', tok=tok, method='DELETE')
s, r = q(f'karten/{kid}', 'pins')
for x in (r if isinstance(r, list) else []):
    if 'document' in x: call('https://firestore.googleapis.com/v1/' + x['document']['name'], tok=tok, method='DELETE')
call(f'{B}/karten/{kid}', tok=tok, method='DELETE'); call(f'{B}/karten/{kid}/mitglieder/{uid}', tok=tok, method='DELETE')
s, r = call(f'https://identitytoolkit.googleapis.com/v1/accounts:delete?key={KEY}', {'idToken': tok}); print('Aufgeräumt, Testkonto gelöscht:', s)
