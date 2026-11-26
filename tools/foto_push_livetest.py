# Live-Test der Regeln für Push-Abos, Fotovorschläge und Ortsfotos (in Cloud Shell ausführen)
import json, urllib.request, urllib.error, random, string, base64
KEY = 'AIzaSyBi8vKQETOYjboNPN72zPrSsuZQLUGOKqI'
DB = 'projects/projekt-fs/databases/(default)'
B = 'https://firestore.googleapis.com/v1/' + DB + '/documents'
def call(url, body=None, tok=None, method=None):
    h = {'content-type': 'application/json', 'Referer': 'https://app.geheimespots.de/'}  # API-Schlüssel ist auf die App-Domain beschränkt
    if tok: h['Authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method or ('POST' if body is not None else 'GET'))
    try: r = urllib.request.urlopen(req); return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
email = 'fototest-' + ''.join(random.choices(string.ascii_lowercase, k=6)) + '@example.com'
s, u = call(f'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={KEY}', {'email': email, 'password': 'test-123456', 'returnSecureToken': True})
tok, uid = u['idToken'], u['localId']
S = lambda v: {'stringValue': v}
fails = 0
def chk(name, s, want):
    global fails
    ok = (s == 200) == want
    fails += not ok
    print(('OK   ' if ok else 'FAIL ') + name, s)
def create(path, fields, tsf='createdAt'):
    w = [{'update': {'name': f'{DB}/documents/{path}', 'fields': fields}, 'currentDocument': {'exists': False}},
         {'transform': {'document': f'{DB}/documents/{path}', 'fieldTransforms': [{'fieldPath': tsf, 'setToServerValue': 'REQUEST_TIME'}]}}]
    return call(f'https://firestore.googleapis.com/v1/{DB}/documents:commit', {'writes': w}, tok)[0]
sub = lambda ep: {'endpoint': S(ep), 'keys': {'mapValue': {'fields': {'p256dh': S('B' * 87), 'auth': S('a' * 22)}}}, 'geraet': S('Browser')}
chk('Push-Abo im eigenen Profil', create(f'nutzer/{uid}/push/t1', sub('https://push.example.org/abc')), True)
chk('Push-Abo eigenes lesen', call(f'{B}/nutzer/{uid}/push/t1', tok=tok)[0], True)
chk('Push-Abo bei anderem Konto', create('nutzer/8Vm4gmz4WzbCMdHwZFsvsXYTIXP2/push/t1', sub('https://push.example.org/abc')), False)
chk('Push-Abo mit http statt https', create(f'nutzer/{uid}/push/t2', sub('http://push.example.org/abc')), False)
chk('Push-Abo löschen', call(f'{B}/nutzer/{uid}/push/t1', tok=tok, method='DELETE')[0], True)
s, r = call(f'{B}:runQuery', {'structuredQuery': {'from': [{'collectionId': 'orte'}], 'limit': 1}}, tok)
orte = [x['document']['name'].split('/')[-1] for x in r if 'document' in x] if isinstance(r, list) else []
jpg = 'data:image/jpeg;base64,' + base64.b64encode(b'\xff\xd8\xff' + b'x' * 300).decode()
if orte:
    o = orte[0]
    f = lambda b: {'ort': S(o), 'uid': S(uid), 'bild': S(b), 'status': S('offen')}
    chk('Foto mit falscher ID', create(f'ortFotos/{o}_x', f(jpg)), False)
    chk('Foto als PNG', create(f'ortFotos/{o}_{uid}', f(jpg.replace('jpeg', 'png'))), False)
    chk('Foto zu groß', create(f'ortFotos/{o}_{uid}', f(jpg + 'A' * 360000)), False)
    chk('Foto für unbekannten Ort', create(f'ortFotos/gibtsnicht_{uid}', {'ort': S('gibtsnicht'), 'uid': S(uid), 'bild': S(jpg), 'status': S('offen')}), False)
    chk('Foto vorschlagen', create(f'ortFotos/{o}_{uid}', f(jpg)), True)
    chk('Zweites Foto für denselben Ort', create(f'ortFotos/{o}_{uid}', f(jpg)), False)
    chk('Eigenen Vorschlag lesen', call(f'{B}/ortFotos/{o}_{uid}', tok=tok)[0], True)
    chk('Alle Vorschläge auflisten (nur Admin)', call(f'{B}:runQuery', {'structuredQuery': {'from': [{'collectionId': 'ortFotos'}]}}, tok)[0], False)
    chk('Ortsfoto selbst setzen (nur Admin)', call(f'{B}/ortBilder/{o}', {'fields': {'bild': S(jpg)}}, tok, 'PATCH')[0], False)
    chk('Eigenen Vorschlag löschen', call(f'{B}/ortFotos/{o}_{uid}', tok=tok, method='DELETE')[0], True)
else:
    print('Keine öffentlichen Orte – Fototests übersprungen')
call(f'https://identitytoolkit.googleapis.com/v1/accounts:delete?key={KEY}', {'idToken': tok})
print('Testkonto gelöscht'); print('ALLE OK' if not fails else f'{fails} FEHLER')
