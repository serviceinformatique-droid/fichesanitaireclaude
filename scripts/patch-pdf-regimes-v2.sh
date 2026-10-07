#!/bin/bash
# ============================================================================
# patch-pdf-regimes-v2.sh  -  build diet-pdf-v2-20261007
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# PDF DE LA SYNTHESE DES REGIMES ALIMENTAIRES : SANS LES ELEVES « SANS RESTRICTION » :
#  - le PDF ne liste plus les eleves « Sans restriction » : uniquement les allergies alimentaires, sans porc, sans
#    viande et vegetariens, classes par categorie ;
#  - en tete : « Effectif du voyage », « Regimes particuliers » et le decompte de chaque categorie (plus de puce
#    « Sans restriction ») ; mention « Les eleves sans restriction alimentaire ne sont pas listes (N eleves) » ;
#  - SECURITE CONSERVEE : un eleve dont la fiche declare une allergie alimentaire alors que son regime est
#    « Sans restriction » reste signale (section « A verifier » + ligne rouge), sinon le traiteur ne le verrait pas ;
#  - s'applique aux deux boutons (barre d'actions et synthese des regimes) ; une entree est ajoutee au journal.
# Prerequis : patch-pdf-regimes (le PDF de la synthese des regimes).
#
# SECURITE : tous les reperes sont verifies sur une COPIE avant toute modification ; en cas d'ecart, rapport
# complet dans /root/diagnostic-regimes2.txt et AUCUN fichier modifie.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-pdf-regimes-v2.sh && /root/patch-pdf-regimes-v2.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="diet-pdf-v2-20261007"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/utils/organizerPdf.ts"
OPTIONAL_FILES="server/changelog.json"
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
    for f in $FILES $OPTIONAL_FILES; do [ -f "$BACKUP_DIR/$f" ] && cp -p "$BACKUP_DIR/$f" "$APP_DIR/$f"; done
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

ORG="$APP_DIR/src/utils/organizerPdf.ts"

grep -q "generateDietSummaryPdf" "$ORG" || { echo "ERREUR : le PDF de la synthese des regimes (patch-pdf-regimes) n'est pas installe : appliquez-le d'abord."; exit 1; }

if grep -q "g.key === 'standard' ? g.students.filter(foodAllergy)" "$ORG"; then
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
  cat > "$TMP/e1_old.txt" << 'MTEOF_X'
        groups.forEach((g) => chips.push({ label: g.label, value: String(g.students.length), tone: g.students.length ? g.tone : 'green' }));
MTEOF_X
  cat > "$TMP/e1_new.txt" << 'MTEOF_X'
        const special = groups.filter((g) => g.key !== 'standard');
        chips.push({ label: 'Régimes particuliers', value: String(special.reduce((n, g) => n + g.students.length, 0)), tone: 'blue' });
        special.forEach((g) => chips.push({ label: g.label, value: String(g.students.length), tone: g.students.length ? g.tone : 'green' }));
MTEOF_X
  replace_once "$ORG" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

  cat > "$TMP/e2_old.txt" << 'MTEOF_X'
        if (suspicious.length) {
          doc.setFont('helvetica', 'bold');
MTEOF_X
  cat > "$TMP/e2_new.txt" << 'MTEOF_X'
        const unlisted = (groups.find((g) => g.key === 'standard')?.students.length || 0) - suspicious.length;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        setInk(doc, GRAY);
        doc.text(`Les élèves sans restriction alimentaire ne sont pas listés (${unlisted} élève${unlisted > 1 ? 's' : ''}).`, MARGIN, y + 2);
        y += 5;
        if (suspicious.length) {
          doc.setFont('helvetica', 'bold');
MTEOF_X
  replace_once "$ORG" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

  cat > "$TMP/e3_old.txt" << 'MTEOF_X'
    groups.forEach((g) => {
      if (!g.students.length) return;
      rows.push({ group: g.label, count: g.students.length });
      g.students.forEach((s, i) => {
MTEOF_X
  cat > "$TMP/e3_new.txt" << 'MTEOF_X'
    groups.forEach((g) => {
      // les élèves « Sans restriction » ne sont pas listés ; seuls ceux dont la fiche déclare une allergie alimentaire restent signalés (à vérifier)
      const shown = g.key === 'standard' ? g.students.filter(foodAllergy) : g.students;
      if (!shown.length) return;
      rows.push({ group: g.key === 'standard' ? 'À vérifier : allergie alimentaire déclarée malgré le régime « Sans restriction »' : g.label, count: shown.length });
      shown.forEach((s, i) => {
MTEOF_X
  replace_once "$ORG" "$(cat "$TMP/e3_old.txt")" "$(cat "$TMP/e3_new.txt")"

  cat > "$TMP/e4_old.txt" << 'MTEOF_X'
{ lines: [{ text: 'Aucun élève inscrit à ce voyage.', italic: true, size: 9, color: GRAY }] }
MTEOF_X
  cat > "$TMP/e4_new.txt" << 'MTEOF_X'
{ lines: [{ text: list.length ? 'Aucun régime particulier ni allergie alimentaire déclarés pour ce voyage.' : 'Aucun élève inscrit à ce voyage.', italic: true, size: 9, color: GRAY }] }
MTEOF_X
  replace_once "$ORG" "$(cat "$TMP/e4_old.txt")" "$(cat "$TMP/e4_new.txt")"

}

# entree ajoutee a la fin du journal des mises a jour (si le journal est installe)
append_changelog() {
  local f="$APP_DIR/server/changelog.json"
  [ -f "$f" ] || return 0
  grep -q '"id": "diet-pdf-v2-20261007"' "$f" && return 0
  ENTRY='{"id": "diet-pdf-v2-20261007", "date": "2026-10-07", "category": "Professeurs", "title": "PDF des régimes : sans les « Sans restriction »", "details": ["Le PDF de la synthèse des régimes alimentaires ne liste plus les élèves « Sans restriction » : seulement les allergies alimentaires, sans porc, sans viande et végétariens.", "Sécurité conservée : un élève dont la fiche déclare une allergie alimentaire sans régime renseigné reste signalé en rouge (« À vérifier »)."]}' perl -0777 -i -pe 's/\n\]\s*\z/,\n  $ENV{ENTRY}\n]\n/' "$f"
  grep -q '"id": "diet-pdf-v2-20261007"' "$f" || { echo "ERREUR : entree du journal non ajoutee."; exit 1; }
}

# --- 1. Verification prealable (sur une copie : RIEN n'est modifie ici) ----------
echo ">>> Verification des reperes dans vos fichiers ..."
mkdir -p "$TMP/dry/$(dirname "$FILES")"
cp "$APP_DIR/$FILES" "$TMP/dry/$FILES"
DRY=1
ORG="$TMP/dry/$FILES"
run_edits
DRY=0
ORG="$APP_DIR/$FILES"
if [ "$FAILS" -gt 0 ]; then
  echo ""
  echo "!!! $FAILS repere(s) introuvable(s) : votre fichier differe de la version attendue."
  echo "!!! AUCUN fichier n'a ete modifie. Rapport complet :"
  echo ""
  cat "$REPORT"
  cp "$REPORT" /root/diagnostic-regimes2.txt 2>/dev/null && echo "(rapport copie dans /root/diagnostic-regimes2.txt)"
  echo ""
  echo "!!! Envoyez ce rapport pour obtenir un script adapte a votre fichier."
  exit 1
fi
echo "    tous les reperes sont presents."

# --- 2. Sauvegarde ----------------------------------------------------------
echo ">>> Sauvegarde dans $BACKUP_DIR ..."
for f in $FILES $OPTIONAL_FILES; do
  if [ -f "$APP_DIR/$f" ]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$f")"
    cp -p "$APP_DIR/$f" "$BACKUP_DIR/$f"
  fi
done
PATCHING=1

# --- 3. Modifications ---------------------------------------------------------
echo ">>> Modification de src/utils/organizerPdf.ts ..."
run_edits
append_changelog

# --- 4. Reconstruction ------------------------------------------------------
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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/. $APP_DIR/"
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

cat << MSG

============================================================
 TERMINE - build $BUILD
 - PDF de la synthese des regimes alimentaires : les eleves « Sans restriction » ne sont plus listes ;
   un eleve avec allergie alimentaire declaree mais regime « Sans restriction » reste signale (« A verifier »).
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
============================================================
MSG
