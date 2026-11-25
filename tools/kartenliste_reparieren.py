# Trägt fehlende Einträge in nutzer/{uid}/meineKarten nach – für jede Karte, in der jemand Mitglied ist (in Cloud Shell ausführen)
import json, subprocess, urllib.request, urllib.error
T = subprocess.check_output(['gcloud', 'auth', 'print-access-token']).decode().strip()
DB = 'projects/projekt-fs/databases/(default)'
B = f'https://firestore.googleapis.com/v1/{DB}/documents/'
def call(path, body=None, method=None):
    req = urllib.request.Request(B + path, data=json.dumps(body).encode() if body else None, method=method or ('PATCH' if body else 'GET'), headers={'Authorization': 'Bearer ' + T, 'content-type': 'application/json'})
    try: return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e: return {'error': e.code}
n = 0
for k in call('karten?pageSize=300').get('documents', []):
    kid = k['name'].split('/')[-1]
    name = k.get('fields', {}).get('name', {}).get('stringValue', 'Karte')
    joined = k.get('fields', {}).get('createdAt', {}).get('timestampValue')
    for m in call(f'karten/{kid}/mitglieder?pageSize=300').get('documents', []):
        uid = m['name'].split('/')[-1]
        if 'error' in call(f'nutzer/{uid}/meineKarten/{kid}'):
            fields = {'name': {'stringValue': name}}
            if joined: fields['joinedAt'] = {'timestampValue': joined}
            r = call(f'nutzer/{uid}/meineKarten/{kid}', {'fields': fields})
            print('nachgetragen:', uid[:10], kid, name, 'FEHLER' if 'error' in r else 'ok'); n += 1
print(n, 'Einträge nachgetragen')
