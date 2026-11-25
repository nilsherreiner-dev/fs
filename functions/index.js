/*
 * FS – Server-Teil für Einladungscodes
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
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const crypto = require('crypto');

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: 'europe-west3', maxInstances: 3 });

const BREVO_KEY = defineSecret('BREVO_KEY');
const SENDER = { name: 'FS', email: 'einladung@geheimespots.de' };
const ADMIN_MAIL = 'nilshrnr@icloud.com';
const APP_URL = 'https://nilsherreiner-dev.github.io/fs/';
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
    body: JSON.stringify({ sender: SENDER, to: [{ email: to }], subject, htmlContent: html, textContent: text })
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

function inviteMail(code) {
  const c = fmtCode(code);
  const text = `Hallo,

dein Zugang zu FS ist freigegeben. Dein persönlicher Einladungscode:

${c}

So geht's:
1. Öffne ${APP_URL} in Safari.
2. Tippe auf Teilen und wähle „Zum Home-Bildschirm“.
3. Öffne FS vom Home-Bildschirm, tippe auf „Mit Einladungscode registrieren“ und gib den Code ein.

Der Code gilt für ein Konto. Wenn du diese Mail nicht erwartet hast, kannst du sie einfach ignorieren.

FS`;
  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#f4f1ec;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#16191d">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
  <div style="background:#3a1f33;border-radius:20px 20px 0 0;padding:22px 24px;color:#f6efe2;font-size:22px;font-weight:700">FS</div>
  <div style="background:#ffffff;border-radius:0 0 20px 20px;padding:24px">
    <p style="margin:0 0 14px;font-size:16px;line-height:1.5">Hallo,<br>dein Zugang zu FS ist freigegeben. Hier ist dein persönlicher Einladungscode:</p>
    <div style="font-size:30px;font-weight:700;letter-spacing:4px;text-align:center;background:#f4f1ec;border-radius:14px;padding:16px 8px;margin:0 0 18px">${esc(c)}</div>
    <ol style="margin:0 0 18px;padding-left:20px;font-size:15px;line-height:1.6">
      <li>Öffne den Link unten in Safari.</li>
      <li>Tippe auf Teilen und wähle „Zum Home-Bildschirm“.</li>
      <li>Öffne FS, tippe auf „Mit Einladungscode registrieren“ und gib den Code ein.</li>
    </ol>
    <p style="text-align:center;margin:0 0 18px"><a href="${APP_URL}" style="display:inline-block;background:#f2542d;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:12px">FS öffnen</a></p>
    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5">Der Code gilt für ein Konto. Wenn du diese Mail nicht erwartet hast, kannst du sie einfach ignorieren.</p>
  </div>
</div></body></html>`;
  return { subject: `Dein Zugang zu FS: ${c}`, html, text };
}

async function notifyAdmin(email, note) {
  const text = `Neue Anfrage für FS von ${email}.${note ? '\n' + note : ''}\n\nFreigeben im Code-Tool: ${TOOL_URL}`;
  const html = `<p>Neue Anfrage für FS von <b>${esc(email)}</b>.</p>${note ? `<p>${esc(note)}</p>` : ''}<p><a href="${TOOL_URL}">Im Code-Tool freigeben</a></p>`;
  try { await sendMail(ADMIN_MAIL, `FS: neue Anfrage von ${email}`, html, text); } catch (e) { logger.warn('Admin-Mail fehlgeschlagen', e); }
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

// nur für lokale Tests
if (process.env.FS_TEST) exports._test = { issue, inviteMail, genCode };
