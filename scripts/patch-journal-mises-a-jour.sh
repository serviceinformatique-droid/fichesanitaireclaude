#!/bin/bash
# ============================================================================
# patch-journal-mises-a-jour.sh  -  build changelog-20261007
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# JOURNAL DES MISES A JOUR (administration uniquement) + CLOCHE :
#  - Administration > nouvel onglet « Mises à jour » : toutes les mises à jour installées (28 entrées), de la plus
#    récente à la plus ancienne, avec date, catégorie, détail et recherche ;
#  - visible UNIQUEMENT par l'administration : les données viennent de la route GET /api/changelog, refusée par le
#    serveur à tout autre rôle (401 sans compte, 403 pour une famille ou un professeur) ; le texte n'est pas
#    dans le code public de la page ;
#  - la CLOCHE sert enfin à quelque chose : l'administration reçoit une notification à chaque mise à jour installée
#    (« Mise à jour installée : ... ») ; pour les familles et les professeurs, la cloche est masquée tant qu'ils
#    n'ont aucune notification ;
#  - pour ajouter une mise à jour : ajouter une entrée à la fin de server/changelog.json, puis redémarrer.
# Prerequis : patch-authentification (la route est protégee par server/auth.js).
#
# SECURITE : tous les reperes sont verifies sur une COPIE avant toute modification ; en cas d'ecart, rapport
# complet dans /root/diagnostic-journal.txt et AUCUN fichier modifie.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-journal-mises-a-jour.sh && /root/patch-journal-mises-a-jour.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="changelog-20261007"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="server/index.js server/auth.js src/components/AdminSpace.tsx src/components/Header.tsx"
NEWFILES="server/changelog.js server/changelog.json src/components/ChangelogPanel.tsx"
TMP="$(mktemp -d)"
DRY=0
FAILS=0
REPORT="$TMP/rapport.txt"
: > "$REPORT"

PATCHING=0
cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$PATCHING" = "1" ]; then
    echo ""
    echo "!!! ERREUR pendant le patch : restauration automatique des fichiers d'origine ..."
    for f in $FILES; do cp -p "$BACKUP_DIR/$f" "$APP_DIR/$f"; done
    for f in $NEWFILES; do rm -f "$APP_DIR/$f"; done
    echo "!!! Fichiers d'origine restaures : aucune modification n'a ete conservee."
    echo "!!! Envoyez le message d'erreur ci-dessus pour obtenir un script corrige."
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

echo ">>> Patch $BUILD sur $APP_DIR"

for f in $FILES; do
  [ -f "$APP_DIR/$f" ] || { echo "ERREUR : $APP_DIR/$f introuvable."; exit 1; }
done
command -v perl >/dev/null || { echo "ERREUR : perl est requis (apt install -y perl)."; exit 1; }

set_paths() { # racine
  SRV="$1/server/index.js"
  AUTH="$1/server/auth.js"
  ADMIN="$1/src/components/AdminSpace.tsx"
  HEADER="$1/src/components/Header.tsx"
}
set_paths "$APP_DIR"

[ -f "$APP_DIR/server/auth.js" ] || { echo "ERREUR : l'authentification (patch-authentification) n'est pas installee : appliquez-la d'abord."; exit 1; }
grep -q "const fsAuth = require('./auth')" "$SRV" || { echo "ERREUR : serveur de version inattendue (branchement de l'authentification introuvable)."; exit 1; }

if [ -f "$APP_DIR/server/changelog.js" ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
fi

count_occ() { OLD="$2" perl -0777 -ne 'my $c = () = /\Q$ENV{OLD}\E/g; print $c' "$1"; }

relpath() {
  local f="$1"
  f="${f#"$TMP"/dry/}"
  f="${f#"$APP_DIR"/}"
  printf '%s' "$f"
}

report_missing() { # fichier  repere  nombre
  local rel orig l1 key
  rel="$(relpath "$1")"
  orig="$APP_DIR/$rel"
  {
    echo "=========================================================="
    echo "Fichier : $rel   (repere trouve $3 fois, attendu 1)"
    echo "--- repere attendu :"
    printf '%s\n' "$2" | head -14
    l1="$(printf '%s\n' "$2" | sed 's/^[[:space:]]*//' | awk 'length($0)>14{print; exit}')"
    echo "--- dans votre fichier, autour de la ligne : $l1"
    if grep -q -F -- "$l1" "$orig"; then
      grep -n -F -m1 -B3 -A12 -- "$l1" "$orig"
    else
      echo "   (cette ligne est absente de votre fichier ; lignes proches :)"
      key="$(printf '%s' "$l1" | grep -oE '[A-Za-z_][A-Za-z0-9_]{7,}' | head -1)"
      [ -n "$key" ] && grep -n -F -m3 -B1 -A3 -- "$key" "$orig" || true
    fi
  } >> "$REPORT"
}

replace_once() { # fichier  ancien_texte  nouveau_texte
  local file="$1" old="$2" new="$3" n
  n="$(count_occ "$file" "$old")"
  if [ "$n" != "1" ]; then
    if [ "$DRY" = "1" ]; then FAILS=$((FAILS + 1)); report_missing "$file" "$old" "$n"; return 0; fi
    echo "ERREUR : repere trouve $n fois dans $file (attendu : 1) :"; echo "$old" | head -3; exit 1
  fi
  OLD="$old" NEW="$new" perl -0777 -i -pe 's/\Q$ENV{OLD}\E/$ENV{NEW}/' "$file"
}

run_edits() {
  cat > "$TMP/e1_old.txt" << 'CHGEOF_X'
  commSendWelcome: (u) => commSendWelcome(u),
});

CHGEOF_X
  cat > "$TMP/e1_new.txt" << 'CHGEOF_X'
  commSendWelcome: (u) => commSendWelcome(u),
});

// --- Journal des mises à jour (build changelog-20261007) : voir server/changelog.js (route réservée à l'administration) ---
const fsChangelog = require('./changelog').install(app, {
  readKv: (k) => readKv(k),
  writeKv: (k, v) => writeKv(k, v),
});

CHGEOF_X
  replace_once "$SRV" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

  cat > "$TMP/e2_old.txt" << 'CHGEOF_X'
fsAuth.migrate())
CHGEOF_X
  cat > "$TMP/e2_new.txt" << 'CHGEOF_X'
fsAuth.migrate().then(() => fsChangelog.notify()))
CHGEOF_X
  replace_once "$SRV" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

  cat > "$TMP/e3_old.txt" << 'CHGEOF_X'
import { PdfRegenerator } from './PdfRegenerator';
CHGEOF_X
  cat > "$TMP/e3_new.txt" << 'CHGEOF_X'
import { PdfRegenerator } from './PdfRegenerator';
import { ChangelogPanel } from './ChangelogPanel';
CHGEOF_X
  replace_once "$ADMIN" "$(cat "$TMP/e3_old.txt")" "$(cat "$TMP/e3_new.txt")"

  cat > "$TMP/e4_old.txt" << 'CHGEOF_X'
| 'audit' | 'trash'>('overview');
CHGEOF_X
  cat > "$TMP/e4_new.txt" << 'CHGEOF_X'
| 'audit' | 'trash' | 'changelog'>('overview');
CHGEOF_X
  replace_once "$ADMIN" "$(cat "$TMP/e4_old.txt")" "$(cat "$TMP/e4_new.txt")"

  cat > "$TMP/e5_old.txt" << 'CHGEOF_X'
          { id: 'audit', label: 'Journal d audit & RGPD', icon: History },
CHGEOF_X
  cat > "$TMP/e5_new.txt" << 'CHGEOF_X'
          { id: 'audit', label: 'Journal d audit & RGPD', icon: History },
          { id: 'changelog', label: 'Mises à jour', icon: RefreshCw },
CHGEOF_X
  replace_once "$ADMIN" "$(cat "$TMP/e5_old.txt")" "$(cat "$TMP/e5_new.txt")"

  cat > "$TMP/e6_old.txt" << 'CHGEOF_X'
      {activeTab === 'audit' && (
CHGEOF_X
  cat > "$TMP/e6_new.txt" << 'CHGEOF_X'
      {activeTab === 'changelog' && <ChangelogPanel />}

      {activeTab === 'audit' && (
CHGEOF_X
  replace_once "$ADMIN" "$(cat "$TMP/e6_old.txt")" "$(cat "$TMP/e6_new.txt")"

  cat > "$TMP/e7_old.txt" << 'CHGEOF_X'
            {/* Notification Bell */}
            <div className="relative">
CHGEOF_X
  cat > "$TMP/e7_new.txt" << 'CHGEOF_X'
            {/* Notification Bell : visible pour l'administration (avertie des mises à jour) ; masquée pour les autres rôles tant qu'ils n'ont rien à lire (build changelog-20261007) */}
            <div className={currentUser.role === 'admin' || userNotifs.length > 0 ? 'relative' : 'hidden'}>
CHGEOF_X
  replace_once "$HEADER" "$(cat "$TMP/e7_old.txt")" "$(cat "$TMP/e7_new.txt")"

  cat > "$TMP/e8_old.txt" << 'CHGEOF_X'
  async function loadSessions() {
CHGEOF_X
  cat > "$TMP/e8_new.txt" << 'CHGEOF_X'
  // Sauvegarde immédiate des sessions à l'arrêt du serveur : une connexion de moins d'une seconde ne doit pas être perdue (build changelog-20261007)
  const flushSessions = async () => {
    if (!persistTimer) return;
    clearTimeout(persistTimer);
    persistTimer = null;
    try {
      await writeKv(K.sessions, [...sessions.values()]);
    } catch (e) {
      console.error('[auth] Sauvegarde des sessions impossible :', e.message);
    }
  };
  ['SIGTERM', 'SIGINT'].forEach((sig) => process.once(sig, () => flushSessions().finally(() => process.exit(0))));
  async function loadSessions() {
CHGEOF_X
  replace_once "$AUTH" "$(cat "$TMP/e8_old.txt")" "$(cat "$TMP/e8_new.txt")"

}

# --- 1. Verification prealable (sur une copie : RIEN n'est modifie ici) ----------
echo ">>> Verification des reperes dans vos fichiers ..."
mkdir -p "$TMP/dry"
for f in $FILES; do mkdir -p "$TMP/dry/$(dirname "$f")"; cp "$APP_DIR/$f" "$TMP/dry/$f"; done
DRY=1
set_paths "$TMP/dry"
run_edits
DRY=0
set_paths "$APP_DIR"
if [ "$FAILS" -gt 0 ]; then
  echo ""
  echo "!!! $FAILS repere(s) introuvable(s) : certains de vos fichiers different de la version attendue."
  echo "!!! AUCUN fichier n'a ete modifie. Rapport complet :"
  echo ""
  cat "$REPORT"
  cp "$REPORT" /root/diagnostic-journal.txt 2>/dev/null && echo "(rapport copie dans /root/diagnostic-journal.txt)"
  echo ""
  echo "!!! Envoyez ce rapport pour obtenir un script adapte a vos fichiers."
  exit 1
fi
echo "    tous les reperes sont presents."

# --- 2. Sauvegarde ----------------------------------------------------------
echo ">>> Sauvegarde dans $BACKUP_DIR ..."
for f in $FILES; do
  mkdir -p "$BACKUP_DIR/$(dirname "$f")"
  cp -p "$APP_DIR/$f" "$BACKUP_DIR/$f"
done
PATCHING=1

# --- 3. Nouveaux fichiers --------------------------------------------------------
echo ">>> Creation des fichiers ..."
echo "    + server/changelog.js"
cat > "$APP_DIR/server/changelog.js" << 'CHGEOF_X'
'use strict';
// ============================================================================
// Journal des mises à jour (build changelog-20261007)
//  - GET /api/changelog : liste des mises à jour (server/changelog.json). Cette route n'est PAS dans la liste des routes
//    ouvertes de server/auth.js : le serveur la refuse donc à tout autre rôle que l'administration (401 sans compte).
//  - notify() : au démarrage, la cloche de l'administration reçoit une notification pour chaque mise à jour installée
//    depuis la dernière fois (une seule notification de présentation lors de la première mise en service).
// Pour ajouter une mise à jour : ajouter une entrée à la fin de server/changelog.json puis redémarrer l'application.
// ============================================================================
const fs = require('fs');
const path = require('path');

console.log('[fichesanitaire] build changelog-20261007');

const FILE = path.join(__dirname, 'changelog.json');
const K_NOTIFS = 'cerfa_notifications_v1';
const K_SEEN = 'cerfa_changelog_notified_v1'; // clé privée : jamais renvoyée par /api/data (liste blanche de auth.js)

function readEntries() {
  try {
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(list) ? list.filter((e) => e && e.id && e.title) : [];
  } catch (e) {
    console.error('[changelog] Lecture impossible :', e.message);
    return [];
  }
}

function install(app, deps) {
  const { readKv, writeKv } = deps;

  app.get('/api/changelog', (req, res) => {
    res.json({ entries: readEntries() });
  });

  async function notify() {
    try {
      const entries = readEntries();
      if (!entries.length) return;
      const last = entries[entries.length - 1];
      const seen = await readKv(K_SEEN);
      if (seen === last.id) return;
      const idx = entries.findIndex((e) => e.id === seen);
      const stamp = new Date().toISOString(); // la cloche affiche la date avec toLocaleDateString : format ISO obligatoire
      const fresh =
        idx === -1
          ? [
              {
                id: 'upd-intro',
                title: 'Journal des mises à jour',
                message: `Toutes les mises à jour sont désormais listées dans Administration > Mises à jour (dernière : ${last.title}).`,
              },
            ]
          : entries.slice(idx + 1).map((e) => ({ id: 'upd-' + e.id, title: 'Mise à jour installée', message: `${e.title} — détails dans Administration > Mises à jour.` }));
      const list = (await readKv(K_NOTIFS)) || [];
      const have = new Set(list.map((n) => n && n.id));
      fresh.forEach((n) => {
        if (!have.has(n.id)) list.push({ id: n.id, targetRole: 'admin', title: n.title, message: n.message, date: stamp, read: false, type: 'info' });
      });
      // on ne garde que les 30 notifications de mise à jour les plus récentes (les autres notifications sont conservées)
      const upd = list.filter((n) => n && String(n.id).startsWith('upd-'));
      const drop = new Set(upd.slice(0, Math.max(0, upd.length - 30)).map((n) => n.id));
      await writeKv(K_NOTIFS, list.filter((n) => !drop.has(n && n.id)));
      await writeKv(K_SEEN, last.id);
      console.log(`[changelog] ${fresh.length} notification(s) de mise à jour envoyée(s) à l'administration (dernière : ${last.id}).`);
    } catch (e) {
      console.error('[changelog] Notification impossible :', e.message);
    }
  }

  return { notify };
}

module.exports = { install };
CHGEOF_X
echo "    + server/changelog.json"
cat > "$APP_DIR/server/changelog.json" << 'CHGEOF_X'
[
  {"id": "pdf-archive-20261001", "date": "2026-10-01", "category": "Fiches PDF", "title": "Archivage des PDF sur le serveur", "details": ["Chaque fiche complète est archivée en PDF dans fiches-pdf/<Classe>/<NOM_Prénom>.pdf (volume du serveur)."]},
  {"id": "dup-guard-20261001", "date": "2026-10-01", "category": "Fiches", "title": "Anti-doublons", "details": ["Une fiche déjà créée pour le même enfant est signalée à la création (formulaire et serveur).", "Badge « Doublon possible » dans l'administration."]},
  {"id": "draft-watermark-20261001", "date": "2026-10-01", "category": "Fiches PDF", "title": "Fiches brouillon", "details": ["Filigrane BROUILLON sur les PDF de fiches non finalisées, avec bandeau listant les points manquants.", "Bouton « Aller à la signature »."]},
  {"id": "anti-overwrite-20261001", "date": "2026-10-01", "category": "Données", "title": "Protection contre les écrasements", "details": ["Contrôle de version et verrou d'écriture : deux enregistrements simultanés ne s'écrasent plus (conflit signalé)."]},
  {"id": "messagerie-20261001", "date": "2026-10-01", "category": "Messagerie", "title": "Messagerie interne et popups", "details": ["Conversations entre l'établissement et les parents, annonces en fenêtre popup.", "Messages et popups protégés (jamais exposés par les routes de données)."]},
  {"id": "accueil-20261001", "date": "2026-10-01", "category": "Comptes", "title": "Message d'accueil", "details": ["Message de bienvenue envoyé automatiquement à la création d'un compte parent, modifiable par l'administration.", "Verrou sur les créations de comptes."]},
  {"id": "ui-signature-20261001", "date": "2026-10-01", "category": "Administration", "title": "Signature importée et vue d'ensemble", "details": ["Import d'une signature par l'administration.", "Vue d'ensemble sans défilement horizontal."]},
  {"id": "parent-guard-20261002", "date": "2026-10-02", "category": "Données", "title": "Fiches toujours rattachées à un parent", "details": ["Plus de fiche sans parent ; un parent n'est jamais effacé."]},
  {"id": "switch-admin-20261002", "date": "2026-10-02", "category": "Administration", "title": "Comptes : tri et retour administrateur", "details": ["Liste des comptes triée.", "Retour à l'administrateur sans reconnexion après la consultation d'un autre compte."]},
  {"id": "storage-fallback-20261004", "date": "2026-10-04", "category": "Données", "title": "Chargement fiable des grosses bases", "details": ["L'application se charge même si la base dépasse la limite de stockage du navigateur (5 Mo)."]},
  {"id": "attachments-limit-20261004", "date": "2026-10-04", "category": "Fiches", "title": "Pièces jointes allégées", "details": ["Photos réduites automatiquement, PDF limités en taille.", "Refus propre côté serveur quand un fichier est trop lourd."]},
  {"id": "etablissement-20261005", "date": "2026-10-05", "category": "Administration", "title": "Nom de l'établissement partout", "details": ["Le nom enregistré s'affiche sur toutes les fiches, les PDF et la liste officielle des inscrits."]},
  {"id": "pdf-regeneration-20261005", "date": "2026-10-05", "category": "Fiches PDF", "title": "Régénération des PDF", "details": ["Bouton « Régénérer les PDF de toutes les fiches complètes » (Administration > Établissement scolaire)."]},
  {"id": "comm-badge-20261005", "date": "2026-10-05", "category": "Messagerie", "title": "Messagerie plus visible", "details": ["Bouton plus grand et pastille rouge clignotante du nombre de messages non lus."]},
  {"id": "pdf-sante-20261006", "date": "2026-10-06", "category": "Fiches PDF", "title": "PDF archivé : santé en grand", "details": ["Régime alimentaire, allergies, traitement et PAI en grands blocs colorés ; bandeau « RÉGIME OU ALLERGIE ACTIVE ».", "PDF paginés quand le contenu est long."]},
  {"id": "comm-delete-20261006", "date": "2026-10-06", "category": "Messagerie", "title": "Messagerie : suppression (administration)", "details": ["Suppression d'un message ou d'une conversation entière, avec confirmation."]},
  {"id": "comm-read-20261006", "date": "2026-10-06", "category": "Messagerie", "title": "Messagerie : accusé de lecture", "details": ["« Lu par le parent » avec la date, ou « Envoyé · pas encore lu » sous chaque message.", "Filtre « Envoyés pas encore lus »."]},
  {"id": "pdf-organisateurs-20261006", "date": "2026-10-06", "category": "Fiches PDF", "title": "Vrais PDF pour les organisateurs", "details": ["Liste d'émargement, suivi sanitaire, relevé sanitaire et fiche individuelle en PDF vectoriel (texte sélectionnable).", "Téléphone, numéro de sécurité sociale et numéro d'élève ajoutés."]},
  {"id": "year-end-20261006", "date": "2026-10-06", "category": "Administration", "title": "Fin d'année scolaire", "details": ["Désinscription de tous les élèves des voyages : automatique (15 juillet, fenêtre de 14 jours, une fois par an) ou manuelle.", "Annulable."]},
  {"id": "rgpd-20261006", "date": "2026-10-06", "category": "Famille", "title": "Espace parent : « Mes données (RGPD) »", "details": ["Données collectées, finalités, droits, téléchargement des données.", "Le PDF archivé est supprimé avec la fiche ; polices Google retirées."]},
  {"id": "scroll-arrows-20261006", "date": "2026-10-06", "category": "Interface", "title": "Flèches de défilement", "details": ["Flèches ▲▼ en bas à droite de toutes les pages."]},
  {"id": "audit-fixes-20261006", "date": "2026-10-06", "category": "Fiches PDF", "title": "Corrections de l'audit", "details": ["PDF : bloc voyages sans chevauchement (jusqu'à 6 voyages), symboles non imprimables remplacés, cellules très longues limitées.", "Texte RGPD précisé."]},
  {"id": "parent-password-20261006", "date": "2026-10-06", "category": "Famille", "title": "Changer son mot de passe", "details": ["Bouton « Changer mon mot de passe » dans l'Espace Famille."]},
  {"id": "onepage-20261006", "date": "2026-10-06", "category": "Fiches PDF", "title": "Fiche sanitaire sur une page", "details": ["Le PDF est réduit automatiquement pour tenir sur une page A4, sans rien couper.", "Deux pages ou plus seulement si le contenu est trop long pour rester lisible."]},
  {"id": "welcome-text-20261006", "date": "2026-10-06", "category": "Comptes", "title": "Nouveau message d'accueil", "details": ["Un seul compte par famille : « + Ajouter un enfant » pour chaque enfant.", "Le texte déjà enregistré est corrigé automatiquement au démarrage."]},
  {"id": "auth-20261006", "date": "2026-10-06", "category": "Sécurité", "title": "Authentification par le serveur", "details": ["Mots de passe stockés sous forme d'empreintes illisibles (anciens mots de passe convertis automatiquement).", "Sessions : familles 30 jours, personnel 7 jours, accompagnateurs 12 heures ; blocage 15 minutes après 5 mots de passe faux.", "Chaque rôle ne reçoit que ses données ; routes d'administration réservées ; impossible de se faire passer pour un autre compte.", "Liens directs valables 30 jours ; mot de passe de 6 caractères minimum ; outils d'exploitation protégés par un secret local."]},
  {"id": "overview-filter-20261006", "date": "2026-10-06", "category": "Administration", "title": "Vue d'ensemble : filtre des fiches", "details": ["Sélecteur « Toutes les fiches / Incomplètes seulement » au-dessus du tableau Suivi global (choix mémorisé)."]},
  {"id": "changelog-20261007", "date": "2026-10-07", "category": "Administration", "title": "Journal des mises à jour et cloche", "details": ["Cet onglet : toutes les mises à jour, visibles uniquement par l'administration.", "La cloche prévient l'administration à chaque mise à jour installée ; elle reste masquée pour les familles et les professeurs tant qu'ils n'ont aucune notification."]}
]
CHGEOF_X
echo "    + src/components/ChangelogPanel.tsx"
cat > "$APP_DIR/src/components/ChangelogPanel.tsx" << 'CHGEOF_X'
import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Loader2, AlertTriangle } from 'lucide-react';

console.log('[fichesanitaire] build changelog-20261007');

interface ChangelogEntry {
  id: string;
  date: string;
  category?: string;
  title: string;
  details?: string[];
}

const CATEGORY_STYLE: Record<string, string> = {
  Sécurité: 'bg-red-50 text-red-800 border-red-200',
  'Fiches PDF': 'bg-indigo-50 text-indigo-800 border-indigo-200',
  Fiches: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  Messagerie: 'bg-sky-50 text-sky-800 border-sky-200',
  Comptes: 'bg-amber-50 text-amber-800 border-amber-200',
  Famille: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  Administration: 'bg-blue-50 text-blue-900 border-blue-200',
  Données: 'bg-slate-100 text-slate-700 border-slate-300',
  Interface: 'bg-slate-100 text-slate-700 border-slate-300',
};

const formatDay = (d: string): string => {
  const t = Date.parse(d + 'T12:00:00');
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

// Journal des mises à jour : réservé à l'administration (les données viennent de /api/changelog, refusé aux autres rôles)
export const ChangelogPanel: React.FC = () => {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/changelog')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((j) => {
        if (alive) setEntries(Array.isArray(j.entries) ? j.entries : []);
      })
      .catch(() => {
        if (alive) setError('Le journal des mises à jour est indisponible pour le moment.');
      });
    return () => {
      alive = false;
    };
  }, []);

  const newestFirst = useMemo(() => (entries ? [...entries].reverse() : []), [entries]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return newestFirst;
    return newestFirst.filter((e) => [e.title, e.id, e.category || '', ...(e.details || [])].join(' ').toLowerCase().includes(q));
  }, [newestFirst, query]);

  const groups = useMemo(() => {
    const g: { day: string; items: ChangelogEntry[] }[] = [];
    filtered.forEach((e) => {
      const last = g[g.length - 1];
      if (last && last.day === e.date) last.items.push(e);
      else g.push({ day: e.date, items: [e] });
    });
    return g;
  }, [filtered]);

  const latest = newestFirst[0];

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5" data-testid="changelog-panel">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-blue-700" />
            Journal des mises à jour
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Toutes les évolutions du portail, de la plus récente à la plus ancienne. Cette page n'est visible que par l'administration.
          </p>
          {latest && (
            <p className="text-xs text-slate-700 mt-2" data-testid="changelog-latest">
              Dernière mise à jour installée : <span className="font-semibold">{latest.title}</span>{' '}
              <span className="font-mono text-[11px] text-slate-500">({latest.id})</span>
            </p>
          )}
        </div>
        <div className="relative sm:w-64 shrink-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une mise à jour…"
            aria-label="Rechercher dans le journal des mises à jour"
            data-testid="changelog-search"
            className="w-full border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-blue-900 focus:outline-none"
          />
        </div>
      </div>

      {!entries && !error && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}
      {entries && (
        <div className="text-[11px] text-slate-500" data-testid="changelog-count">
          {filtered.length} mise{filtered.length > 1 ? 's' : ''} à jour affichée{filtered.length > 1 ? 's' : ''} sur {entries.length}
        </div>
      )}
      {entries && filtered.length === 0 && <div className="text-sm text-slate-500">Aucune mise à jour ne correspond à cette recherche.</div>}

      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.day}>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1 mb-2 capitalize">{formatDay(g.day)}</h4>
            <ul className="space-y-3">
              {g.items.map((e) => (
                <li key={e.id} className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/50" data-testid="changelog-entry">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{e.title}</span>
                    {e.category && (
                      <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${CATEGORY_STYLE[e.category] || 'bg-slate-100 text-slate-700 border-slate-300'}`}>{e.category}</span>
                    )}
                    <span className="font-mono text-[10px] text-slate-400 ml-auto">{e.id}</span>
                  </div>
                  {e.details && e.details.length > 0 && (
                    <ul className="mt-1.5 list-disc pl-5 space-y-0.5 text-xs text-slate-700">
                      {e.details.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
};
CHGEOF_X

# --- 4. Modifications ---------------------------------------------------------
echo ">>> Modification des fichiers ..."
run_edits

# --- 5. Reconstruction ------------------------------------------------------
PATCHING=0
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo ">>> SKIP_BUILD=1 : pas de reconstruction Docker."
  exit 0
fi

echo ">>> Reconstruction de l'application (1 a 3 minutes) ..."
cd "$APP_DIR"
if ! docker compose up -d --build; then
  echo ""
  echo "!!! ECHEC de la reconstruction Docker. L'ancien conteneur reste en service s'il tournait."
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/. $APP_DIR/ && rm -f $APP_DIR/server/changelog.js $APP_DIR/server/changelog.json $APP_DIR/src/components/ChangelogPanel.tsx"
  exit 1
fi

echo ">>> Attente du demarrage ..."
APP_PORT_VAL="$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
APP_PORT_VAL="${APP_PORT_VAL:-8099}"
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:$APP_PORT_VAL/health" >/dev/null 2>&1; then
    echo ">>> /health OK"
    break
  fi
  sleep 2
done
sleep 2
docker compose logs --tail 40 app 2>/dev/null | grep "\[changelog\]" | tail -2 || true

cat << MSG

============================================================
 TERMINE - build $BUILD
 - Administration > onglet « Mises à jour » : journal de toutes les mises à jour (réservé à l'administration).
 - La cloche de l'administration signale chaque mise à jour installée (une notification de présentation ce soir).
 - Familles et professeurs : cloche masquée tant qu'ils n'ont aucune notification.
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build changelog-20261007"
============================================================
MSG
