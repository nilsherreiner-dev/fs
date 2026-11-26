#!/usr/bin/env python3
"""Live-Test der Regeln für /melden/ (ohne Anmeldung): gültige Meldung geht, ungültige wird abgelehnt.
Die Testmeldung wird danach mit Admin-Rechten wieder gelöscht."""
import json, subprocess, urllib.request
P = 'projekt-fs'; KEY = 'AIzaSyBi8vKQETOYjboNPN72zPrSsuZQLUGOKqI'
B = f'https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents'
def post(url, body, token=None):
    h = {'Content-Type': 'application/json', 'Referer': 'https://app.geheimespots.de/'}  # API-Schlüssel ist auf die App-Domain beschränkt
    if token: h.update({'Authorization': 'Bearer ' + token, 'x-goog-user-project': P})
    r = urllib.request.Request(url, method='POST', data=json.dumps(body).encode(), headers=h)
    try:
        with urllib.request.urlopen(r) as x: return x.status, json.loads(x.read())
    except urllib.error.HTTPError as e: return e.code, None
def doc(fields, ts=True):
    f = {k: ({'booleanValue': v} if isinstance(v, bool) else {'stringValue': v}) for k, v in fields.items()}
    w = {'update': {'name': f'projects/{P}/databases/(default)/documents/meldungen/LIVETEST', 'fields': f}}
    if ts: w['updateTransforms'] = [{'fieldPath': 'createdAt', 'setToServerValue': 'REQUEST_TIME'}]
    return {'writes': [w]}
gut = {'quelle': 'extern', 'grund': 'extern', 'was': 'Livetest bitte ignorieren', 'text': 'Automatischer Test der Regeln', 'name': '', 'email': '', 'gutglaube': True, 'status': 'offen'}
s1, _ = post(f'{B}:commit?key={KEY}', doc({**gut, 'gutglaube': False}))
print(('OK   ' if s1 == 403 else 'FAIL ') + f'ohne „guter Glaube“ abgelehnt ({s1})')
s2, _ = post(f'{B}:commit?key={KEY}', doc({**gut, 'status': 'erledigt'}))
print(('OK   ' if s2 == 403 else 'FAIL ') + f'falscher Status abgelehnt ({s2})')
s3, _ = post(f'{B}:commit?key={KEY}', doc(gut))
print(('OK   ' if s3 == 200 else 'FAIL ') + f'gültige Meldung ohne Konto angenommen ({s3})')
T = subprocess.check_output(['gcloud', 'auth', 'print-access-token']).decode().strip()
r = urllib.request.Request(f'{B}/meldungen/LIVETEST', method='DELETE', headers={'Authorization': 'Bearer ' + T, 'x-goog-user-project': P})
urllib.request.urlopen(r); print('Testmeldung gelöscht'); print('FERTIG-MELDETEST')
