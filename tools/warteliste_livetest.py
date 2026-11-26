# Live-Test der Warteliste-Regeln (ohne Konto, wie die Startseite). In Cloud Shell ausführen.
# Schickt eine echte Bestätigungs-Mail an kontakt@geheimespots.de (Ende-zu-Ende-Test).
import json, time, urllib.request, urllib.error
KEY = 'AIzaSyBi8vKQETOYjboNPN72zPrSsuZQLUGOKqI'
DB = 'projects/projekt-fs/databases/(default)'
B = 'https://firestore.googleapis.com/v1/' + DB + '/documents'
def call(url, body=None, method=None):
    h = {'content-type': 'application/json', 'Referer': 'https://app.geheimespots.de/start/'}
    req = urllib.request.Request(url + ('&' if '?' in url else '?') + 'key=' + KEY, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method or ('POST' if body is not None else 'GET'))
    try: r = urllib.request.urlopen(req); return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
S = lambda v: {'stringValue': v}
fails = 0
def chk(name, s, want):
    global fails
    ok = (s == 200) == want; fails += not ok
    print(('OK   ' if ok else 'FAIL ') + name, s)
def create(id, fields):
    w = [{'update': {'name': f'{DB}/documents/warteliste/{id}', 'fields': fields}, 'currentDocument': {'exists': False}},
         {'transform': {'document': f'{DB}/documents/warteliste/{id}', 'fieldTransforms': [{'fieldPath': 'createdAt', 'setToServerValue': 'REQUEST_TIME'}]}}]
    return call(f'https://firestore.googleapis.com/v1/{DB}/documents:commit', {'writes': w})[0]
gut = lambda e: {'email': S(e), 'einwilligung': S('2026-11-26'), 'bestaetigt': {'booleanValue': False}}
id = 'LIVETEST' + str(int(time.time()))
chk('Ungültige Adresse abgelehnt', create(id + 'x', gut('keine-adresse')), False)
chk('Falsche Einwilligungs-Version abgelehnt', create(id + 'y', {**gut('kontakt@geheimespots.de'), 'einwilligung': S('alt')}), False)
chk('Schon bestätigt beim Anlegen abgelehnt', create(id + 'z', {**gut('kontakt@geheimespots.de'), 'bestaetigt': {'booleanValue': True}}), False)
chk('Eintragen ohne Konto', create(id, gut('kontakt@geheimespots.de')), True)
chk('Lesen ohne Konto verboten', call(f'{B}/warteliste/{id}')[0], False)
chk('Liste lesen verboten', call(f'{B}:runQuery', {'structuredQuery': {'from': [{'collectionId': 'warteliste'}]}})[0], False)
upd = lambda f, mask: call(f'https://firestore.googleapis.com/v1/{DB}/documents:commit', {'writes': [{'update': {'name': f'{DB}/documents/warteliste/{id}', 'fields': f}, 'updateMask': {'fieldPaths': mask}, 'currentDocument': {'exists': True}}, {'transform': {'document': f'{DB}/documents/warteliste/{id}', 'fieldTransforms': [{'fieldPath': 'bestaetigtAm', 'setToServerValue': 'REQUEST_TIME'}]}}]})[0]
chk('E-Mail ändern verboten', upd({'email': S('x@example.org'), 'bestaetigt': {'booleanValue': True}}, ['email', 'bestaetigt']), False)
chk('Bestätigen über den Link', upd({'bestaetigt': {'booleanValue': True}}, ['bestaetigt']), True)
chk('Zweites Bestätigen verboten', upd({'bestaetigt': {'booleanValue': True}}, ['bestaetigt']), False)
time.sleep(8)
chk('Abmelden löscht den Eintrag', call(f'{B}/warteliste/{id}', method='DELETE')[0], True)
print('ALLE OK' if not fails else f'{fails} FEHLER')
