/*
 * GS – Server-Teil für Einladungscodes
 *
 * Ablauf:
 *  1. Jemand trägt auf /anfrage/ seine E-Mail ein → Dokument anfragen/{id} mit status "neu".
 *  2. Ist im Code-Tool „Automatisch verschicken“ an, wird die Anfrage sofort freigegeben.
 *     Sonst bekommt der Admin eine Mail und gibt im Code-Tool frei (status → "freigegeben").
 *  3. Bei "freigegeben" erzeugt diese Funktion einen Code (einladungen/{code}) und
 *     schickt ihn über Brevo an die angefragte E-Mail. Danach status "verschickt".
 *
 * Der Brevo-API-Schlüssel liegt als Secret BREVO_KEY in Google Secret Manager.
 */
const { onDocumentCreated, onDocumentUpdated, onDocumentWritten, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const webpush = require('web-push');
const crypto = require('crypto');

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: 'europe-west3', maxInstances: 3 });

const BREVO_KEY = defineSecret('BREVO_KEY');
const SENDER = { name: 'GS', email: 'einladung@geheimespots.de' };
// Projekt-Adresse (Weiterleitung). Admin-Mails enthalten keine E-Mail-Adressen von Interessenten.
const ADMIN_MAIL = 'kontakt@geheimespots.de';
const APP_URL = 'https://app.geheimespots.de/';
const TOOL_URL = APP_URL + 'codes/';
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 Zeichen, ohne I/O/0/1
const AUTO_LIMIT_PER_HOUR = 30;              // Spam-Bremse für die Automatik
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const genCode = () => [...crypto.randomBytes(8)].map(b => ABC[b % 32]).join('');
const fmtCode = c => c.slice(0, 4) + '-' + c.slice(4);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendMail(to, subject, html, text) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_KEY.value(), 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: SENDER, replyTo: { email: 'kontakt@geheimespots.de', name: 'GS' }, to: [{ email: to }], subject, htmlContent: html, textContent: text })
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

function inviteMail(code) {
  const c = fmtCode(code);
  const text = `Hallo,

dein Zugang zu GS ist freigegeben. Dein persönlicher Einladungscode:

${c}

So geht's:
1. Öffne ${APP_URL} in Safari.
2. Tippe auf Teilen und wähle „Zum Home-Bildschirm“.
3. Öffne GS vom Home-Bildschirm, tippe auf „Mit Einladungscode registrieren“ und gib den Code ein.

Ausführliche Anleitung: ${APP_URL}start/

Der Code gilt für ein Konto. Wenn du diese Mail nicht erwartet hast, kannst du sie einfach ignorieren.

GS`;
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head><body style="margin:0;background:#1c1016;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#f6e9e4">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
  <div style="background:#2b1424;border-radius:22px 22px 0 0;padding:22px 24px 18px">
    <div style="font-size:16px;font-weight:700;letter-spacing:.5px;color:#f6e9e4;margin:0 0 10px">GS</div>
    <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:30px;line-height:1.1;color:#f6e9e4">Dein Zugang ist da.</div>
  </div>
  <div style="background:#241520;border-radius:0 0 22px 22px;padding:24px">
    <p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#e3cfd6">Hallo,<br>hier ist dein persönlicher Einladungscode für GS – eure geheime Karte für Orte, die nur ihr zwei kennt:</p>
    <div style="font-size:30px;font-weight:700;letter-spacing:4px;text-align:center;background:#311d2b;color:#f6e9e4;border-radius:16px;padding:16px 8px;margin:0 0 18px">${esc(c)}</div>
    <ol style="margin:0 0 20px;padding-left:20px;font-size:15px;line-height:1.65;color:#e3cfd6">
      <li>Öffne den Link unten in Safari.</li>
      <li>Tippe auf Teilen und wähle „Zum Home-Bildschirm“.</li>
      <li>Öffne GS, tippe auf „Mit Einladungscode registrieren“ und gib den Code ein.</li>
    </ol>
    <p style="text-align:center;margin:0 0 16px"><a href="${APP_URL}" style="display:inline-block;background:#f2542d;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 30px;border-radius:999px">GS öffnen</a></p>
    <p style="text-align:center;margin:0 0 20px;font-size:14px"><a href="${APP_URL}start/" style="color:#ffb46b;font-weight:700">Anleitung Schritt für Schritt</a></p>
    <p style="margin:0;font-size:13px;color:#b89aa8;line-height:1.5">Der Code gilt für ein Konto. Wenn du diese Mail nicht erwartet hast, kannst du sie einfach ignorieren.</p>
  </div>
</div></body></html>`;
  return { subject: `Dein Zugang zu GS: ${c}`, html, text };
}

async function notifyAdmin(email, note) {
  // bewusst ohne die E-Mail-Adresse – die steht nur im Code-Tool
  const text = `Es gibt eine neue Anfrage für GS.${note ? '\n' + note : ''}\n\nAnsehen und freigeben im Code-Tool: ${TOOL_URL}`;
  const html = `<p>Es gibt eine neue Anfrage für GS.</p>${note ? `<p>${esc(note)}</p>` : ''}<p><a href="${TOOL_URL}">Im Code-Tool ansehen und freigeben</a></p>`;
  try { await sendMail(ADMIN_MAIL, 'GS: neue Anfrage', html, text); } catch (e) { logger.warn('Admin-Mail fehlgeschlagen', e); }
}

/* Schlichte GS-Mail (Bestätigungen, Entscheidungen, Begründungen) */
function gsMail(titel, absaetze) {
  const text = absaetze.join('\n\n') + '\n\nGS – geheime Spots\nkontakt@geheimespots.de';
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"></head><body style="margin:0;background:#1c1016;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#f6e9e4">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
  <div style="background:#2b1424;border-radius:22px 22px 0 0;padding:22px 24px 18px"><div style="font-size:16px;font-weight:700;margin:0 0 10px">GS</div><div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:26px;line-height:1.15">${esc(titel)}</div></div>
  <div style="background:#241520;border-radius:0 0 22px 22px;padding:22px 24px">${absaetze.map(a => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#e3cfd6;white-space:pre-line">${esc(a)}</p>`).join('')}
  <p style="margin:6px 0 0;font-size:13px;color:#b89aa8">GS – geheime Spots · kontakt@geheimespots.de</p></div>
</div></body></html>`;
  return { html, text };
}
async function mailAn(to, betreff, titel, absaetze) {
  if (!to || !EMAIL_RE.test(to)) return false;
  const m = gsMail(titel, absaetze);
  try { await sendMail(to, betreff, m.html, m.text); return true; } catch (e) { logger.warn('Mail fehlgeschlagen', { betreff, e: String(e) }); return false; }
}
async function emailVon(uid) {
  if (!uid) return '';
  try { return (await getAuth().getUser(uid)).email || ''; } catch { return ''; }
}

/* Code finden oder anlegen und verschicken */
async function issue(ref, d) {
  const email = String(d.email || '').trim().toLowerCase();
  let code = null;
  // 1. Code aus einem früheren, fehlgeschlagenen Versuch weiterverwenden
  if (d.code) { const s = await db.doc('einladungen/' + d.code).get(); if (s.exists && !s.data().usedBy) code = d.code; }
  // 2. Noch offener Code für dieselbe E-Mail → denselben nochmal schicken
  if (!code) {
    const prev = await db.collection('einladungen').where('email', '==', email).get();
    const open = prev.docs.find(x => !x.data().usedBy);
    if (open) code = open.id;
  }
  // 3. Neuen Code anlegen (create() schlägt fehl, falls es ihn schon gibt)
  for (let i = 0; !code && i < 5; i++) {
    const c = genCode();
    try { await db.doc('einladungen/' + c).create({ createdAt: FieldValue.serverTimestamp(), usedBy: null, email, anfrage: ref.id }); code = c; }
    catch (e) { if (e.code !== 6) throw e; } // 6 = ALREADY_EXISTS
  }
  if (!code) throw new Error('Kein freier Code gefunden');
  await ref.update({ code, status: 'sendet' });
  const m = inviteMail(code);
  await sendMail(email, m.subject, m.html, m.text);
  await ref.update({ status: 'verschickt', sentAt: FieldValue.serverTimestamp(), error: FieldValue.delete() });
  logger.info('Code verschickt', { anfrage: ref.id, code });
}
async function run(ref, d) {
  try { await issue(ref, d); }
  catch (e) { logger.error('Versand fehlgeschlagen', e); await ref.update({ status: 'fehler', error: String((e && e.message) || e).slice(0, 300) }); }
}

/* Neue Anfrage */
exports.neueAnfrage = onDocumentCreated({ document: 'anfragen/{id}', secrets: [BREVO_KEY] }, async event => {
  const snap = event.data; if (!snap) return;
  const ref = snap.ref, d = snap.data() || {};
  const email = String(d.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) { await ref.update({ status: 'fehler', error: 'Ungültige E-Mail-Adresse' }); return; }
  if (d.email !== email) await ref.update({ email }); // einheitlich klein geschrieben speichern

  // Hat diese E-Mail schon ein Konto (Code eingelöst)?
  const codes = await db.collection('einladungen').where('email', '==', email).get();
  if (codes.docs.some(x => x.data().usedBy)) { await ref.update({ status: 'doppelt', note: 'Hat schon ein Konto' }); return; }

  // Vom Admin direkt angelegt („Code an E-Mail schicken“) → sofort verschicken
  if (d.status === 'freigegeben') { await run(ref, { ...d, email }); return; }

  // Läuft schon eine Anfrage für diese E-Mail?
  const same = await db.collection('anfragen').where('email', '==', email).get();
  if (same.docs.some(x => x.id !== ref.id && ['neu', 'freigegeben', 'sendet', 'verschickt'].includes(x.data().status))) {
    await ref.update({ status: 'doppelt', note: 'Es gibt schon eine Anfrage für diese E-Mail' });
    return;
  }

  const set = await db.doc('einstellungen/codes').get();
  if (set.exists && set.data().auto === true) {
    const since = Timestamp.fromMillis(Date.now() - 3600 * 1000);
    const n = (await db.collection('anfragen').where('createdAt', '>', since).count().get()).data().count;
    if (n <= AUTO_LIMIT_PER_HOUR) { await ref.update({ status: 'freigegeben', auto: true }); return; } // → anfrageGeaendert verschickt
    await ref.update({ note: 'Automatik pausiert: zu viele Anfragen in der letzten Stunde' });
    await notifyAdmin(email, 'Die Automatik ist wegen vieler Anfragen pausiert – bitte von Hand freigeben.');
    return;
  }
  await notifyAdmin(email);
});

/* Freigabe (vom Admin oder von der Automatik) */
exports.anfrageGeaendert = onDocumentUpdated({ document: 'anfragen/{id}', secrets: [BREVO_KEY] }, async event => {
  const before = event.data.before.data() || {}, after = event.data.after.data() || {};
  if (after.status !== 'freigegeben' || before.status === 'freigegeben') return;
  await run(event.data.after.ref, after);
});

/* Aufräumen: Anfragen und Einladungscodes nach 6 Monaten löschen (so steht es in der Datenschutzerklärung) */
async function aufraeumen(now = Date.now()) {
  const cutoff = Timestamp.fromMillis(now - 183 * 24 * 3600 * 1000);
  let n = 0;
  for (const col of ['anfragen', 'einladungen']) {
    const old = await db.collection(col).where('createdAt', '<', cutoff).get();
    for (let i = 0; i < old.docs.length; i += 400) {
      const b = db.batch(); old.docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit();
    }
    n += old.docs.length;
  }
  // Erledigte Meldungen nach einem Jahr
  const yr = Timestamp.fromMillis(now - 365 * 24 * 3600 * 1000);
  const tag = now - 24 * 3600 * 1000;
  const alt = (await db.collection('meldungen').where('createdAt', '<', yr).get()).docs.filter(d => d.data().status !== 'offen')
    .concat((await db.collection('meldungen').where('status', '==', 'spam').get()).docs.filter(d => { const c = d.data().createdAt; return c && c.toMillis() < tag; }));
  for (let i = 0; i < alt.length; i += 400) { const b = db.batch(); alt.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit(); }
  n += alt.length;
  // Nicht bearbeitete Fotovorschläge nach 90 Tagen
  const fv = await db.collection('ortFotos').where('createdAt', '<', Timestamp.fromMillis(now - 90 * 24 * 3600 * 1000)).get();
  await Promise.all(fv.docs.map(d => d.ref.delete()));
  n += fv.docs.length;
  logger.info('Aufgeräumt', { geloescht: n });
  return n;
}
exports.aufraeumen = onSchedule({ schedule: 'every day 03:17', timeZone: 'Europe/Berlin' }, () => aufraeumen());

/* ======================================================================
 * Öffentliche Karte
 *  - Ein Spot mit Feld pub = <uid> erscheint öffentlich als Eintrag oeffentlich/{eid}
 *    (ohne Foto, ohne Karten- oder Spot-ID). eid ist ein Hash aus Karte und Spot.
 *  - Einträge im Umkreis von 50 m landen beim selben Ort orte/{oid}.
 *  - orte/{oid} hält Anzahl und Durchschnitt der Bewertungen.
 *  - profile/{uid} ist das öffentliche Profil: nur Profilbild und Kürzel („N…s“).
 *  - Gesperrte Einträge (gesperrt/{eid}) werden nicht wieder veröffentlicht.
 * ====================================================================== */
const RADIUS = 50;
const eidOf = (kid, pid) => crypto.createHash('sha256').update(kid + '/' + pid).digest('hex').slice(0, 24);
const finite = v => typeof v === 'number' && isFinite(v);
const str = (v, n) => String(v || '').trim().slice(0, n);
const cl10 = v => Math.max(0, Math.min(10, Math.round(Number(v) || 0)));
const okPhoto = s => typeof s === 'string' && s.length < 400000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
function kurz(name) {
  const z = [...String(name || '')].filter(c => /[\p{L}\p{N}]/u.test(c));
  if (!z.length) return '?';
  if (z.length === 1) return z[0].toUpperCase();
  return z[0].toUpperCase() + '…' + z[z.length - 1].toLowerCase();
}
function distM(a, b) {
  const R = 6371000, t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const profilAus = n => ({ kurz: kurz(n.name), photo: okPhoto(n.photo) ? n.photo : '', updatedAt: FieldValue.serverTimestamp() });

async function ortSuchen(p) {
  const d = RADIUS / 111320;
  const q = await db.collection('orte').where('lat', '>=', p.lat - d).where('lat', '<=', p.lat + d).get();
  let best = null, bd = Infinity;
  q.forEach(x => { const o = x.data(); if (!finite(o.lat) || !finite(o.lng)) return; const m = distM(o, p); if (m <= RADIUS && m < bd) { bd = m; best = x.id; } });
  if (best) return best;
  const ref = db.collection('orte').doc();
  await ref.set({ lat: p.lat, lng: p.lng, name: str(p.name, 80) || 'Ohne Namen', address: str(p.address, 200), n: 0, r: { g: 0, a: 0, u: 0 }, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  return ref.id;
}

/* Spot → öffentlicher Eintrag (anlegen, ändern oder entfernen) */
async function spotSync(kid, pid, p) {
  const eid = eidOf(kid, pid), ref = db.doc('oeffentlich/' + eid);
  const cur = await ref.get();
  const pub = p && typeof p.pub === 'string' && p.pub.length > 0 && p.pub.length < 80 && finite(p.lat) && finite(p.lng) ? p.pub : null;
  let nutzer = null;
  if (pub) {
    const [g, n, k] = await Promise.all([db.doc('gesperrt/' + eid).get(), db.doc('nutzer/' + pub).get(), db.doc('kontosperren/' + pub).get()]);
    if (!g.exists && n.exists && !k.exists) nutzer = n.data();
  }
  if (!nutzer) { if (cur.exists) await ref.delete(); return { eid, status: 'privat' }; }
  let ort = cur.exists ? cur.data().ort : null;
  if (ort) { const o = await db.doc('orte/' + ort).get(); if (!o.exists || distM(o.data(), p) > RADIUS) ort = null; }
  if (!ort) ort = await ortSuchen(p);
  const r = p.r || {}, sc = p.rs === 10 ? 1 : 2;
  const data = { ort, uid: pub, name: str(p.name, 80) || 'Ohne Namen', desc: str(p.desc, 1000), r: { g: cl10(r.g * sc), a: cl10(r.a * sc), u: cl10(r.u * sc) }, updatedAt: FieldValue.serverTimestamp() };
  if (!cur.exists) data.createdAt = FieldValue.serverTimestamp();
  await ref.set(data, { merge: true });
  await db.doc('profile/' + pub).set(profilAus(nutzer));
  return { eid, status: 'oeffentlich', ort };
}

/* Durchschnitt und Anzahl eines Orts neu berechnen; leere Orte verschwinden */
async function ortRechnen(oid) {
  const ref = db.doc('orte/' + oid);
  const q = await db.collection('oeffentlich').where('ort', '==', oid).get();
  if (q.empty) { // leerer Ort verschwindet samt Foto und offenen Fotovorschlägen
    await ref.delete();
    await db.doc('ortBilder/' + oid).delete();
    const f = await db.collection('ortFotos').where('ort', '==', oid).get();
    await Promise.all(f.docs.map(d => d.ref.delete()));
    return 0;
  }
  const sum = { g: 0, a: 0, u: 0 }, cnt = { g: 0, a: 0, u: 0 };
  q.forEach(d => { const r = d.data().r || {}; for (const k of ['g', 'a', 'u']) if (r[k] > 0) { sum[k] += r[k]; cnt[k]++; } });
  const r = {}; for (const k of ['g', 'a', 'u']) r[k] = cnt[k] ? Math.round(sum[k] / cnt[k] * 10) / 10 : 0;
  try { await ref.update({ n: q.size, r, updatedAt: FieldValue.serverTimestamp() }); } catch (e) { if (e.code !== 5) throw e; } // 5 = NOT_FOUND
  return q.size;
}
async function profilAufraeumen(uid) {
  const q = await db.collection('oeffentlich').where('uid', '==', uid).limit(1).get();
  if (q.empty) await db.doc('profile/' + uid).delete();
}

exports.spotGeaendert = onDocumentWritten('karten/{kid}/pins/{pid}', async event => {
  let a = event.data.after.exists ? event.data.after.data() : null;
  const b = event.data.before.exists ? event.data.before.data() : null;
  if (a && a.offen === true && a.pub) a = { ...a, pub: null }; // noch nicht besucht → nie öffentlich
  if (!(a && a.pub) && !(b && b.pub)) return; // war und ist privat → nichts zu tun
  await spotSync(event.params.kid, event.params.pid, a);
});

exports.eintragGeaendert = onDocumentWritten('oeffentlich/{eid}', async event => {
  const b = event.data.before.exists ? event.data.before.data() : null;
  const a = event.data.after.exists ? event.data.after.data() : null;
  for (const o of new Set([b && b.ort, a && a.ort].filter(Boolean))) await ortRechnen(o);
  if (b && b.uid && (!a || a.uid !== b.uid)) await profilAufraeumen(b.uid);
});

exports.nutzerGeaendert = onDocumentWritten('nutzer/{uid}', async event => {
  const uid = event.params.uid;
  if (!event.data.after.exists) { // Konto gelöscht → öffentliche Einträge, Push-Abos und Profil weg
    const q = await db.collection('oeffentlich').where('uid', '==', uid).get();
    await Promise.all(q.docs.map(d => d.ref.delete()));
    const ps = await db.collection(`nutzer/${uid}/push`).get();
    await Promise.all(ps.docs.map(d => d.ref.delete()));
    const fv = await db.collection('ortFotos').where('uid', '==', uid).get();
    await Promise.all(fv.docs.map(d => d.ref.delete()));
    await db.doc('profile/' + uid).delete();
    return;
  }
  const prof = db.doc('profile/' + uid);
  if (!(await prof.get()).exists) return; // nur wer etwas öffentlich geteilt hat, hat ein öffentliches Profil
  await prof.set(profilAus(event.data.after.data() || {}));
});

/* ======================================================================
 * Meldungen und Moderation (DSA Art. 16, 17)
 *  - Meldungen kommen aus der App (quelle 'app', mit Konto) oder von /melden/ (quelle 'extern', ohne Konto).
 *  - Meldende bekommen eine Eingangsbestätigung und später die Entscheidung (wenn eine Adresse bekannt ist).
 *  - Wer gesperrt wird, bekommt eine Begründung mit Hinweis auf Widerspruch.
 * ====================================================================== */
const EXTERN_LIMIT_PER_HOUR = 20;
const GRUND = {
  person: ['Erkennbare Person oder Kennzeichen', 'Abschnitt 4 der Nutzungsbedingungen (keine Fotos mit erkennbaren Personen oder Kennzeichen)'],
  privat: ['Privatgrundstück oder Wohnadresse', 'Abschnitt 4 und 4a der Nutzungsbedingungen (keine Wohnadressen, keine Privatgrundstücke ohne Erlaubnis)'],
  illegal: ['Gefährlich oder verboten', 'Abschnitt 4 und 5 der Nutzungsbedingungen (keine rechtswidrigen Inhalte, Gesetze und Hausrecht beachten)'],
  beleidigend: ['Beleidigend oder unangemessen', 'Abschnitt 4 und 4a der Nutzungsbedingungen (keine beleidigenden Inhalte, keine sexuellen Details)'],
  falsch: ['Falsch oder gibt es nicht mehr', 'Abschnitt 4a der Nutzungsbedingungen (öffentliche Angaben müssen zutreffen)'],
  sonstiges: ['Sonstiges', 'Abschnitt 4a der Nutzungsbedingungen'],
  extern: ['Meldung von außen', 'Abschnitt 4 und 4a der Nutzungsbedingungen bzw. geltendes Recht']
};
const grundText = g => (GRUND[g] || GRUND.sonstiges)[0];
const regelText = g => (GRUND[g] || GRUND.sonstiges)[1];

exports.neueMeldung = onDocumentCreated({ document: 'meldungen/{id}', secrets: [BREVO_KEY] }, async event => {
  const snap = event.data; if (!snap) return;
  const d = snap.data() || {}, ref = snap.ref;
  const extern = d.quelle === 'extern';
  if (extern) {
    // Spam-Bremse für das öffentliche Formular
    const seit = Timestamp.fromMillis(Date.now() - 3600 * 1000);
    const n = (await db.collection('meldungen').where('createdAt', '>', seit).get()).docs.filter(x => x.data().quelle === 'extern').length;
    if (n > EXTERN_LIMIT_PER_HOUR) { await ref.update({ status: 'spam' }); logger.warn('Externe Meldungen gedrosselt', { n }); return; }
  }
  let name = 'Meldung ohne Ortsangabe';
  if (d.ort) { const o = await db.doc('orte/' + d.ort).get(); name = o.exists ? o.data().name : 'Ort nicht mehr öffentlich'; }
  // Admin: ohne personenbezogene Daten der meldenden Person
  const text = `Neue Meldung${extern ? ' (ohne Konto)' : ''} zu „${name}“: ${grundText(d.grund)}.\n\nPrüfen im Code-Tool: ${TOOL_URL}`;
  const html = `<p>Neue Meldung${extern ? ' (ohne Konto)' : ''} zu <b>${esc(name)}</b>: ${esc(grundText(d.grund))}.</p><p><a href="${TOOL_URL}">Im Code-Tool prüfen</a></p>`;
  try { await sendMail(ADMIN_MAIL, 'GS: neue Meldung', html, text); } catch (e) { logger.warn('Meldungs-Mail fehlgeschlagen', e); }
  // Eingangsbestätigung an die meldende Person (Art. 16 Abs. 4 DSA)
  const an = extern ? String(d.email || '') : await emailVon(d.by);
  if (an) await mailAn(an, 'GS: Deine Meldung ist eingegangen', 'Deine Meldung ist eingegangen.', [
    `Danke, deine Meldung${d.ort ? ` zu „${name}“` : ''} ist bei uns angekommen. Grund: ${grundText(d.grund)}.`,
    'Wir prüfen jede Meldung von Hand. Sobald wir entschieden haben, schicken wir dir eine kurze Nachricht.',
    'Fragen oder Ergänzungen? Antworte einfach auf diese Mail.'
  ]);
});

/* Entscheidung an die meldende Person (Art. 16 Abs. 5 DSA) */
exports.meldungEntschieden = onDocumentUpdated({ document: 'meldungen/{id}', secrets: [BREVO_KEY] }, async event => {
  const b = event.data.before.data() || {}, a = event.data.after.data() || {};
  if (b.status !== 'offen' || a.status !== 'erledigt') return;
  const an = a.quelle === 'extern' ? String(a.email || '') : await emailVon(a.by);
  if (!an) return;
  const ergebnis = a.aktion === 'Bewertung gesperrt' ? 'Wir haben die gemeldete Bewertung gesperrt. Sie ist nicht mehr öffentlich sichtbar.'
    : a.aktion === 'Ort gesperrt' ? 'Wir haben den gemeldeten Ort mit allen Bewertungen gesperrt. Er ist nicht mehr öffentlich sichtbar.'
    : a.aktion === 'Inhalt entfernt' ? 'Wir haben den gemeldeten Inhalt entfernt.'
    : a.aktion === 'Konto gesperrt' ? 'Wir haben den Inhalt entfernt und das Konto der verantwortlichen Person gesperrt.'
    : 'Wir haben die Meldung geprüft und keinen Verstoß gegen geltendes Recht oder unsere Nutzungsbedingungen festgestellt. Der Inhalt bleibt sichtbar.';
  await mailAn(an, 'GS: Entscheidung zu deiner Meldung', 'Wir haben deine Meldung geprüft.', [
    ergebnis,
    ...(a.begruendung ? ['Begründung: ' + a.begruendung] : []),
    'Die Prüfung erfolgte von Hand, nicht automatisch. Bist du mit der Entscheidung nicht einverstanden, antworte auf diese Mail – wir sehen uns den Fall dann noch einmal an.'
  ]);
});

/* Begründung an die Person, deren Eintrag gesperrt wurde (Art. 17 DSA) */
exports.eintragGesperrt = onDocumentCreated({ document: 'gesperrt/{eid}', secrets: [BREVO_KEY] }, async event => {
  const d = (event.data && event.data.data()) || {};
  if (!d.uid || d.stumm) return;
  const an = await emailVon(d.uid); if (!an) return;
  await mailAn(an, 'GS: Ein öffentlicher Eintrag wurde gesperrt', 'Ein Eintrag wurde gesperrt.', [
    `Dein öffentlicher Eintrag „${d.name || 'ohne Namen'}“${d.ortName ? ` am Ort „${d.ortName}“` : ''} ist ab sofort nicht mehr auf der öffentlichen Karte zu sehen und lässt sich nicht erneut teilen. In deiner privaten Karte bleibt der Spot erhalten.`,
    `Grund: ${grundText(d.grund)}. Grundlage: ${regelText(d.grund)}.`,
    ...(d.begruendung ? ['Was wir festgestellt haben: ' + d.begruendung] : []),
    'Die Entscheidung haben wir nach einer Meldung von Hand getroffen, nicht automatisch.',
    'Du kannst widersprechen: Antworte einfach auf diese Mail oder schreib an kontakt@geheimespots.de. Wir prüfen den Fall dann erneut. Außerdem stehen dir außergerichtliche Streitbeilegung und der Rechtsweg offen.'
  ]);
});

/* Kontosperre: Konto deaktivieren, öffentliche Einträge entfernen, Begründung schicken */
exports.kontoGesperrt = onDocumentCreated({ document: 'kontosperren/{uid}', secrets: [BREVO_KEY] }, async event => {
  const uid = event.params.uid, d = (event.data && event.data.data()) || {};
  const an = await emailVon(uid);
  try { await getAuth().updateUser(uid, { disabled: true }); await getAuth().revokeRefreshTokens(uid); } catch (e) { logger.warn('Konto deaktivieren fehlgeschlagen', String(e)); }
  const q = await db.collection('oeffentlich').where('uid', '==', uid).get();
  for (const x of q.docs) { await db.doc('gesperrt/' + x.id).set({ uid, ort: x.data().ort, name: x.data().name || '', grund: d.grund || 'sonstiges', konto: true, stumm: true, at: FieldValue.serverTimestamp() }); await x.ref.delete(); }
  if (an) await mailAn(an, 'GS: Dein Konto wurde gesperrt', 'Dein Konto wurde gesperrt.', [
    'Wir haben dein GS-Konto gesperrt. Du kannst dich nicht mehr anmelden, und deine öffentlichen Einträge sind nicht mehr sichtbar.',
    `Grund: ${grundText(d.grund)}. Grundlage: ${regelText(d.grund)} sowie Abschnitt 6 (Sperrung bei wiederholten oder schweren Verstößen).`,
    ...(d.begruendung ? ['Was wir festgestellt haben: ' + d.begruendung] : []),
    'Die Entscheidung haben wir von Hand getroffen, nicht automatisch.',
    'Du kannst widersprechen: Antworte einfach auf diese Mail oder schreib an kontakt@geheimespots.de. Wir prüfen den Fall dann erneut. Außerdem stehen dir außergerichtliche Streitbeilegung und der Rechtsweg offen. Möchtest du stattdessen, dass wir dein Konto und alle Daten löschen, schreib uns das ebenfalls.'
  ]);
});
/* ======================================================================
 * Push: neuer Spot auf einer gemeinsamen Karte → Benachrichtigung an die anderen Mitglieder
 *  Text bewusst neutral (kein Spot-Name auf dem Sperrbildschirm).
 * ====================================================================== */
const VAPID_PUBLIC = 'BLsC2k4Dlfc2Kr5F52hsLVqXEnTPVTh322qQsxi0gZrmi9tNMO9vL0R0qkvTqZbOHrmqPtTK8f5UlPjyM0ZdXsY';
const VAPID_PRIVATE = defineSecret('VAPID_PRIVATE');
async function pushAn(uid, payload) {
  const subs = await db.collection(`nutzer/${uid}/push`).get();
  let n = 0;
  for (const s of subs.docs) {
    const d = s.data() || {};
    try { await webpush.sendNotification({ endpoint: d.endpoint, keys: d.keys }, payload, { TTL: 86400, urgency: 'normal' }); n++; }
    catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await s.ref.delete(); else logger.warn('Push fehlgeschlagen', { code: e && e.statusCode }); }
  }
  return n;
}
exports.neuerSpot = onDocumentCreated({ document: 'karten/{kid}/pins/{pid}', secrets: [VAPID_PRIVATE] }, async event => {
  const p = (event.data && event.data.data()) || {};
  const kid = event.params.kid;
  const [k, mem] = await Promise.all([db.doc('karten/' + kid).get(), db.collection(`karten/${kid}/mitglieder`).get()]);
  const andere = mem.docs.map(d => d.id).filter(u => u !== p.by);
  if (!andere.length) return 0;
  webpush.setVapidDetails('mailto:kontakt@geheimespots.de', VAPID_PUBLIC, VAPID_PRIVATE.value());
  const name = k.exists ? String(k.data().name || '').slice(0, 40) : '';
  const was = p.offen === true ? 'Neuer Favorit' : 'Neuer Spot';
  const payload = JSON.stringify({ title: 'GS', body: name ? `${was} auf „${name}“` : `${was} auf eurer Karte`, url: './', tag: 'spot-' + kid });
  let n = 0;
  for (const u of andere) n += await pushAn(u, payload);
  return n;
});

exports.kontoEntsperrt = onDocumentDeleted('kontosperren/{uid}', async event => {
  try { await getAuth().updateUser(event.params.uid, { disabled: false }); } catch (e) { logger.warn('Konto entsperren fehlgeschlagen', String(e)); }
});

// nur für lokale Tests
if (process.env.FS_TEST) exports._test = { issue, inviteMail, genCode, aufraeumen, spotSync, ortRechnen, kurz, eidOf, distM, profilAufraeumen, gsMail };
