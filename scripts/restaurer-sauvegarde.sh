#!/bin/bash
# ============================================================================
# restaurer-sauvegarde.sh  -  diagnostic et restauration de la base du portail
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# A utiliser si le portail affiche de mauvaises donnees (nom d'etablissement par
# defaut, comptes et mots de passe qui ne passent plus, fiches manquantes...).
#
#   1) ETAT ACTUEL DE LA BASE (lecture seule) :
#        ./restaurer-sauvegarde.sh --etat
#   2) SAUVEGARDES DISPONIBLES (avec le nombre de comptes / fiches de chacune) :
#        ./restaurer-sauvegarde.sh --liste
#   3) RESTAURATION (simulation d'abord, puis --apply) :
#        ./restaurer-sauvegarde.sh backup_2026-10-03_09h00.json
#        ./restaurer-sauvegarde.sh backup_2026-10-03_09h00.json --apply
#      Option : --cles=cerfa_users_v1,cerfa_establishment_name_v1 (ne restaurer que ces cles)
#
# SECURITES : l'etat actuel est copie dans /app/backups/avant-restauration_<date>.json avant
# toute ecriture (annulation possible) ; une sauvegarde vide ou plus ancienne que la base
# actuelle (moins de comptes / de fiches) est refusee sans --force ; ecriture en une seule
# transaction ; verification apres restauration.
#
# ATTENTION : l'application reecrit la sauvegarde de l'heure EN COURS a chaque redemarrage.
# Ne la redemarrez pas avant d'avoir copie les sauvegardes :
#     docker cp fichesanitaire_app:/app/backups /root/backups-secours
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/restaurer-sauvegarde.sh && /root/restaurer-sauvegarde.sh --etat
# ============================================================================
set -e

CONTAINER="${CONTAINER:-fichesanitaire_app}"

if [ "$#" -lt 1 ]; then
  echo "Usage : $0 --etat | --liste [--tout] | <fichier> [--cles=a,b] [--apply] [--force]"
  exit 1
fi
command -v docker >/dev/null 2>&1 || { echo "ERREUR : docker est introuvable. Lancez ce script sur le LXC de l'application."; exit 1; }
docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" || { echo "ERREUR : le conteneur '$CONTAINER' ne tourne pas (docker ps)."; exit 1; }

docker exec -i "$CONTAINER" node - "$@" << 'RESTAURER_EOF'
// Diagnostic et restauration de la base du portail (table kv_store) à partir des sauvegardes horaires.
// Lecture seule tant que --apply n'est pas donné.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BACKUP_DIR = process.env.BACKUP_DIR || '/app/backups';
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const a = args.find((x) => x.startsWith(n + '=')); return a ? a.slice(n.length + 1) : null; };
const positional = args.filter((a) => !a.startsWith('--'));
const apply = flag('--apply');
const force = flag('--force');
const die = (m) => { console.error('\n!!! ' + m + '\n'); process.exit(1); };

const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'fichesanitaire',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'fichesanitaire',
});

const STUDENTS = 'cerfa_students_v11';
const USERS = 'cerfa_users_v1';
const NAME = 'cerfa_establishment_name_v1';
const kb = (v) => Math.round(Buffer.byteLength(JSON.stringify(v)) / 1024);
const count = (v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : null);
const fmt = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' }) : '?');
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

function summarize(rows) {
  const get = (k) => (rows.find((r) => r.key === k) || {}).value;
  const users = get(USERS) || [];
  const students = get(STUDENTS) || [];
  const admins = Array.isArray(users) ? users.filter((u) => u && u.role === 'admin').map((u) => u.name || u.email || u.id) : [];
  return {
    nbKeys: rows.length,
    users: Array.isArray(users) ? users.length : 0,
    admins,
    students: Array.isArray(students) ? students.filter((s) => s && !s.deletedAt).length : 0,
    name: typeof get(NAME) === 'string' ? get(NAME) : null,
  };
}

function printState(rows, title) {
  console.log(`\n=== ${title} ===`);
  if (rows.length === 0) console.log('   (AUCUNE DONNEE : la table est vide)');
  rows.forEach((r) => console.log(`   ${pad(r.key, 36)} ${pad(Array.isArray(r.value) ? 'liste' : typeof r.value, 8)} ${pad(count(r.value) === null ? '' : count(r.value) + ' él.', 10)} ${pad(kb(r.value) + ' Ko', 9)} modifié ${fmt(r.updated_at)}`));
  const s = summarize(rows);
  console.log(`   -> ${s.users} compte(s) (${s.admins.length} administrateur(s) : ${s.admins.join(', ') || 'aucun'}), ${s.students} fiche(s), nom de l'établissement : ${s.name || '(non enregistré)'}`);
}

function readBackup(file) {
  const full = file.includes('/') ? file : path.join(BACKUP_DIR, path.basename(file));
  if (!fs.existsSync(full)) die(`Sauvegarde introuvable : ${full}\nListe : restaurer-sauvegarde.sh --liste`);
  let rows;
  try { rows = JSON.parse(fs.readFileSync(full, 'utf8')); } catch (e) { die('Fichier de sauvegarde illisible : ' + e.message); }
  if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.key !== 'string' || !('value' in r))) die('Format de sauvegarde inattendu (attendu : liste de {key, value, updated_at}).');
  return { full, rows };
}

(async () => {
  const current = (await pool.query('SELECT key, value, updated_at FROM kv_store ORDER BY key')).rows;

  // ---- --etat : état actuel de la base ----
  if (flag('--etat')) {
    printState(current, 'ETAT ACTUEL DE LA BASE');
    console.log('\n(lecture seule : rien n\'a été modifié)');
    return;
  }

  // ---- --liste : sauvegardes disponibles ----
  if (flag('--liste')) {
    if (!fs.existsSync(BACKUP_DIR)) die('Dossier de sauvegardes introuvable : ' + BACKUP_DIR);
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => /\.json$/.test(f)).map((f) => ({ f, st: fs.statSync(path.join(BACKUP_DIR, f)) })).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    const limit = flag('--tout') ? files.length : 30;
    console.log(`\n${files.length} fichier(s) dans ${BACKUP_DIR} (les ${Math.min(limit, files.length)} plus récents) :\n`);
    console.log(`   ${pad('fichier', 44)} ${pad('modifié', 22)} ${pad('taille', 9)} contenu`);
    files.slice(0, limit).forEach((x) => {
      let info = '';
      try { const rows = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, x.f), 'utf8')); if (Array.isArray(rows)) { const s = summarize(rows); info = rows.length === 0 ? 'VIDE' : `${s.users} comptes, ${s.students} fiches, ${s.nbKeys} clés${s.name ? ', nom : ' + s.name : ''}`; } } catch { info = '(non lisible)'; }
      console.log(`   ${pad(x.f, 44)} ${pad(fmt(x.st.mtime), 22)} ${pad(Math.round(x.st.size / 1024) + ' Ko', 9)} ${info}`);
    });
    console.log('\nAstuce : la sauvegarde de l\'heure en cours est RÉÉCRITE à chaque redémarrage de l\'application ; ne restaurez pas depuis un fichier VIDE.');
    return;
  }

  // ---- restauration d'une sauvegarde ----
  if (positional.length < 1) die('Usage :\n  restaurer-sauvegarde.sh --etat\n  restaurer-sauvegarde.sh --liste [--tout]\n  restaurer-sauvegarde.sh <fichier> [--cles=cle1,cle2] [--apply] [--force]');
  const { full, rows } = readBackup(positional[0]);
  const wanted = opt('--cles') ? opt('--cles').split(',').map((s) => s.trim()).filter(Boolean) : null;
  const selected = wanted ? rows.filter((r) => wanted.some((w) => r.key === w || r.key.includes(w))) : rows;
  if (rows.length === 0) die('Cette sauvegarde est VIDE (0 clé) : rien à restaurer. Choisissez un fichier plus ancien (--liste).');
  if (selected.length === 0) die('Aucune clé ne correspond à --cles. Clés de la sauvegarde : ' + rows.map((r) => r.key).join(', '));

  printState(current, 'BASE ACTUELLE');
  printState(rows, 'SAUVEGARDE ' + path.basename(full));
  console.log(`\nClés qui seraient restaurées (${selected.length}) : ${selected.map((r) => r.key).join(', ')}`);

  const cur = summarize(current), bak = summarize(selected);
  const problems = [];
  if (selected.some((r) => r.key === STUDENTS) && cur.students > bak.students) problems.push(`la base actuelle contient PLUS de fiches (${cur.students}) que la sauvegarde (${bak.students}) : ${cur.students - bak.students} fiche(s) créée(s) depuis seraient PERDUES`);
  if (selected.some((r) => r.key === USERS) && cur.users > bak.users) problems.push(`la base actuelle contient PLUS de comptes (${cur.users}) que la sauvegarde (${bak.users}) : ${cur.users - bak.users} compte(s) créé(s) depuis seraient PERDUS`);
  problems.forEach((p) => console.log('\n   ATTENTION : ' + p));

  if (!apply) {
    console.log('\nSIMULATION : rien n\'a été modifié. Pour restaurer : relancez avec --apply' + (problems.length ? ' --force (en connaissance de cause)' : ''));
    return;
  }
  if (problems.length && !force) die('Restauration refusée (voir ATTENTION ci-dessus). Si vous êtes sûr, ajoutez --force.');

  // copie de sécurité de l'état actuel (nom hors purge automatique)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safety = path.join(BACKUP_DIR, `avant-restauration_${stamp}.json`);
  fs.writeFileSync(safety, JSON.stringify(current));
  console.log(`\nCopie de sécurité de l'état actuel : ${safety}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of selected) {
      await client.query(
        `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2::jsonb, COALESCE($3::timestamp, now()))
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [r.key, JSON.stringify(r.value), r.updated_at || null]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    die('Restauration annulée (aucune modification) : ' + e.message);
  } finally {
    client.release();
  }
  const after = (await pool.query('SELECT key, value, updated_at FROM kv_store ORDER BY key')).rows;
  printState(after, 'BASE APRES RESTAURATION');
  const sa = summarize(after);
  const okRestore = selected.every((r) => JSON.stringify((after.find((x) => x.key === r.key) || {}).value) === JSON.stringify(r.value));
  if (!okRestore) die('Vérification échouée : certaines clés ne correspondent pas à la sauvegarde.');
  console.log(`\nOK : ${selected.length} clé(s) restaurée(s) et vérifiée(s) (${sa.users} comptes, ${sa.students} fiches).`);
  console.log('Faites Ctrl+F5 dans le navigateur. Annuler la restauration : restaurer-sauvegarde.sh avant-restauration_' + stamp + '.json --apply --force');
})()
  .catch((e) => die(e.message))
  .finally(() => pool.end().catch(() => {}));
RESTAURER_EOF
