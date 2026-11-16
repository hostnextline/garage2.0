// Recréer les comptes de connexion de l'équipe après la perte du projet (la sauvegarde ne garde pas les comptes :
// ni courriels de connexion, ni mots de passe). Pour chaque personne de staff.json qui n'est pas effacée, un compte est
// créé avec LE MÊME identifiant que sa fiche : tout ce qui pointe vers elle (rendez-vous, camions, heures, paiements,
// droits) reste juste. Aucun mot de passe n'est mis, aucun courriel n'est envoyé : chacun fait ensuite « Mot de passe
// oublié » dans l'app. Une personne désactivée reçoit un compte bloqué, comme « Désactiver » le fait.
//   SUPABASE_URL=https://<projet>.supabase.co SERVICE_ROLE_KEY=<clé service_role> node restaurer-comptes.mjs [dossier] [--essai]
// --essai : dit ce qui serait fait, sans rien faire. Un compte qui existe déjà n'est jamais touché.
// À lancer AVANT la restauration des données (la fiche staff d'une personne a besoin de son compte).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const ESSAI = args.includes('--essai');
const inconnue = args.find((a) => a.startsWith('--') && a !== '--essai');
const DOSSIER = args.find((a) => !a.startsWith('--')) || 'donnees';
const URL_ = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const CLE = process.env.SERVICE_ROLE_KEY || '';
function arreter(m) { process.stderr.write(`ERREUR : ${m}\n`); process.exit(1); }
if (inconnue) arreter(`Option inconnue : ${inconnue}  (node restaurer-comptes.mjs [dossier] [--essai])`);
if (!URL_ || !CLE) arreter('il faut SUPABASE_URL (l\'adresse du projet) et SERVICE_ROLE_KEY (Supabase → Project Settings → API).');
const f = join(DOSSIER, 'staff.json');
if (!existsSync(f)) arreter(`${f} n'existe pas : il faut le dossier « donnees » de la sauvegarde.`);
const staff = JSON.parse(readFileSync(f, 'utf8'));
if (!Array.isArray(staff)) arreter(`${f} n'est pas une liste de lignes.`);

async function auth(method, path, body) {
  const r = await fetch(`${URL_}/auth/v1/admin/users${path}`, {
    method, headers: { apikey: CLE, authorization: `Bearer ${CLE}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
  });
  let d = {};
  try { d = await r.json(); } catch { /* an empty answer */ }
  return { status: r.status, d };
}

const fait = { crees: [], bloques: [], existants: [], sansCourriel: [], refuses: [] };
for (const s of staff) {
  if (!s || s.deleted_at != null) continue;
  const nom = s.full_name || s.id;
  if (!s.email) { fait.sansCourriel.push(nom); continue; }
  const vu = await auth('GET', `/${s.id}`);
  if (vu.status === 200) {
    if (String(vu.d.email || '').toLowerCase() !== String(s.email).toLowerCase()) fait.refuses.push(`${nom} : un compte existe avec cet identifiant mais pour ${vu.d.email} (laissé tel quel)`);
    else fait.existants.push(nom);
    continue;
  }
  if (vu.status !== 404) { fait.refuses.push(`${nom} : le serveur répond ${vu.status} (${vu.d.msg || vu.d.message || vu.d.error || ''})`); continue; }
  if (ESSAI) { (s.active === false ? fait.bloques : fait.crees).push(nom); continue; }
  const c = await auth('POST', '', { id: s.id, email: s.email, email_confirm: true, user_metadata: { full_name: s.full_name || null } });
  if (c.status !== 200 && c.status !== 201) { fait.refuses.push(`${nom} : création refusée (${c.status} ${c.d.msg || c.d.message || c.d.error || ''})`); continue; }
  if (s.active === false) {
    const b = await auth('PUT', `/${s.id}`, { ban_duration: '876000h' });
    if (b.status !== 200) { fait.refuses.push(`${nom} : compte créé mais pas bloqué (${b.status}) : le bloquer dans Supabase → Authentication`); continue; }
    fait.bloques.push(nom);
  } else fait.crees.push(nom);
}

const dire = (titre, l) => { if (l.length) console.log(`${titre} (${l.length}) : ${l.join(', ')}`); };
console.log(ESSAI ? 'ESSAI : rien n\'a été fait.' : 'Comptes de l\'équipe :');
dire(ESSAI ? 'à créer' : 'créés', fait.crees);
dire(ESSAI ? 'à créer bloqués (désactivés)' : 'créés bloqués (désactivés)', fait.bloques);
dire('déjà là, pas touchés', fait.existants);
dire('SANS COURRIEL dans la sauvegarde, à refaire à la main (inviter de nouveau)', fait.sansCourriel);
for (const x of fait.refuses) console.log(`PROBLÈME : ${x}`);
if (!ESSAI && (fait.crees.length || fait.bloques.length)) console.log('Ensuite : chacun fait « Mot de passe oublié » dans l\'app avec son courriel.');
process.exitCode = fait.refuses.length || fait.sansCourriel.length ? 1 : 0;
