# Zeigt Karten, Mitglieder, Spots, Partner-Codes und Nutzerlisten aus Firestore (nur zur Fehlersuche, in Cloud Shell ausführen)
import json, subprocess, urllib.request
T = subprocess.check_output(['gcloud', 'auth', 'print-access-token']).decode().strip()
B = 'https://firestore.googleapis.com/v1/projects/projekt-fs/databases/(default)/documents/'
def get(path):
    req = urllib.request.Request(B + path + '?pageSize=100', headers={'Authorization': 'Bearer ' + T})
    try: return json.load(urllib.request.urlopen(req)).get('documents', [])
    except Exception as e: return []
def val(v): return list(v.values())[0] if isinstance(v, dict) and v else v
def show(d, skip=('photo',)):
    return {k: (str(val(v))[:30]) for k, v in d.get('fields', {}).items() if k not in skip}
for k in get('karten'):
    kid = k['name'].split('/')[-1]
    print('KARTE', kid, show(k))
    for m in get(f'karten/{kid}/mitglieder'): print('   mitglied', m['name'].split('/')[-1][:10], show(m, ('joinedAt',)))
    for p in get(f'karten/{kid}/pins'): print('   spot', show(p, ('photo', 'r', 'desc', 'address', 'createdAt', 'updatedAt')))
for c in get('kartenEinladungen'): print('CODE', c['name'].split('/')[-1], show(c))
for n in get('nutzer'):
    uid = n['name'].split('/')[-1]
    print('NUTZER', uid[:10], show(n, ('photo', 'createdAt', 'updatedAt', 'bio')))
    for mk in get(f'nutzer/{uid}/meineKarten'): print('   meineKarte', mk['name'].split('/')[-1], show(mk))
