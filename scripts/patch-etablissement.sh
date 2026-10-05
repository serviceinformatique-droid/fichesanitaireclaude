#!/bin/bash
# ============================================================================
# patch-etablissement.sh  -  build etablissement-20261005
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# CORRIGE : "Etablissement : College & Lycee Jean Moulin" encore affiche sur les fiches
# sanitaires, alors que le nom de l'etablissement a ete enregistre.
#
# CAUSE : chaque fiche gardait une COPIE du nom de l'etablissement au moment de sa creation
# (champ schoolEstablishment) et la vue officielle affichait cette copie en priorite.
#
# CORRECTION (affichage, PDF, valeurs par defaut) :
#  - la fiche (rubrique 1), le pied de page et les PDF affichent TOUJOURS le nom enregistre
#    de l'etablissement : toutes les fiches existantes sont corrigees d'un coup, sans toucher
#    aux donnees (pas de reecriture des 140 fiches) ;
#  - la liste officielle des eleves inscrits a un voyage lit le nom enregistre (l'en-tete
#    "College & Lycee Jean Moulin - Academie de Paris" etait ecrit en dur) ;
#  - les valeurs par defaut du code deviennent "Ensemble Scolaire Notre Dame des Missions" ;
#  - le bouton "Changer l'etablissement" ne reecrit plus TOUTE la liste des eleves depuis le
#    navigateur (operation a risque, cause de l'incident du 01/10) : le nom enregistre suffit.
# Les PDF DEJA archives gardent l'ancien nom jusqu'a ce que la fiche soit enregistree a nouveau.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-etablissement.sh && /root/patch-etablissement.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="etablissement-20261005"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/components/CerfaOfficialView.tsx src/utils/pdfGenerator.ts src/components/TripHealthListModal.tsx src/utils/storage.ts src/App.tsx src/components/AdminSpace.tsx src/components/Header.tsx"
TMP="$(mktemp -d)"

PATCHING=0
cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$PATCHING" = "1" ]; then
    echo ""
    echo "!!! ERREUR pendant le patch : restauration automatique des fichiers d'origine ..."
    for f in $FILES; do cp -p "$BACKUP_DIR/$f" "$APP_DIR/$f"; done
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

OFV="$APP_DIR/src/components/CerfaOfficialView.tsx"
PDF="$APP_DIR/src/utils/pdfGenerator.ts"
TRIP="$APP_DIR/src/components/TripHealthListModal.tsx"
STO="$APP_DIR/src/utils/storage.ts"
APP="$APP_DIR/src/App.tsx"
ADM="$APP_DIR/src/components/AdminSpace.tsx"
HDR="$APP_DIR/src/components/Header.tsx"

m=0
grep -q "etablissement-20261005" "$STO" && m=$((m+1))
grep -q "<strong>{establishmentName || student.schoolEstablishment" "$OFV" && m=$((m+1))
grep -q "getStoredEstablishmentName() || student.schoolEstablishment" "$PDF" && m=$((m+1))
grep -q "getStoredEstablishmentName" "$TRIP" && m=$((m+1))
grep -q "n'est plus nécessaire de réécrire TOUTE la liste" "$APP" && m=$((m+1))
grep -q "Ce nom s'affiche automatiquement" "$ADM" && m=$((m+1))
grep -q "establishmentName || 'Établissement scolaire'" "$HDR" && m=$((m+1))
if [ "$m" -eq 7 ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
elif [ "$m" -gt 0 ]; then
  echo "ERREUR : etat partiel detecte ($m/7 fichiers deja modifies)."
  echo "Restaurez d'abord les fichiers d'origine depuis un backup-avant-* puis relancez ce script."
  exit 1
fi

# --- Fonctions utilitaires -------------------------------------------------
count_occ() { OLD="$2" perl -0777 -ne 'my $c = () = /\Q$ENV{OLD}\E/g; print $c' "$1"; }

replace_once() { # fichier  ancien_texte  nouveau_texte
  local file="$1" old="$2" new="$3" n
  n="$(count_occ "$file" "$old")"
  [ "$n" = "1" ] || { echo "ERREUR : repere trouve $n fois dans $file (attendu : 1) :"; echo "$old"; exit 1; }
  OLD="$old" NEW="$new" perl -0777 -i -pe 's/\Q$ENV{OLD}\E/$ENV{NEW}/' "$file"
}

# --- 1. Sauvegarde ----------------------------------------------------------
echo ">>> Sauvegarde dans $BACKUP_DIR ..."
for f in $FILES; do
  mkdir -p "$BACKUP_DIR/$(dirname "$f")"
  cp -p "$APP_DIR/$f" "$BACKUP_DIR/$f"
done
PATCHING=1

# --- 2. Modifications ---------------------------------------------------------
echo ">>> Modification des fichiers ..."
cat > "$TMP/e1_old.txt" << 'ETBEOF_X'
{student.schoolEstablishment || establishmentName || 'Établissement scolaire'}
ETBEOF_X
cat > "$TMP/e1_new.txt" << 'ETBEOF_X'
{establishmentName || student.schoolEstablishment || 'Établissement scolaire'}
ETBEOF_X
replace_once "$OFV" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

cat > "$TMP/e2_old.txt" << 'ETBEOF_X'
establishmentName?.trim() || student.schoolEstablishment?.trim() || getStoredEstablishmentName();
ETBEOF_X
cat > "$TMP/e2_new.txt" << 'ETBEOF_X'
establishmentName?.trim() || getStoredEstablishmentName() || student.schoolEstablishment?.trim();
ETBEOF_X
replace_once "$PDF" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

cat > "$TMP/e3_old.txt" << 'ETBEOF_X'
import { exportToPdf } from '../utils/pdfGenerator';
ETBEOF_X
cat > "$TMP/e3_new.txt" << 'ETBEOF_X'
import { exportToPdf } from '../utils/pdfGenerator';
import { getStoredEstablishmentName } from '../utils/storage';
ETBEOF_X
replace_once "$TRIP" "$(cat "$TMP/e3_old.txt")" "$(cat "$TMP/e3_new.txt")"

cat > "$TMP/e4_old.txt" << 'ETBEOF_X'
Collège & Lycée Jean Moulin — Académie de Paris
ETBEOF_X
cat > "$TMP/e4_new.txt" << 'ETBEOF_X'
{getStoredEstablishmentName()}
ETBEOF_X
replace_once "$TRIP" "$(cat "$TMP/e4_old.txt")" "$(cat "$TMP/e4_new.txt")"

cat > "$TMP/e5_old.txt" << 'ETBEOF_X'
export const DEFAULT_ESTABLISHMENT_NAME = 'Collège & Lycée Jean Moulin';
ETBEOF_X
cat > "$TMP/e5_new.txt" << 'ETBEOF_X'
console.log('[fichesanitaire] build etablissement-20261005');

export const DEFAULT_ESTABLISHMENT_NAME = 'Ensemble Scolaire Notre Dame des Missions';
ETBEOF_X
replace_once "$STO" "$(cat "$TMP/e5_old.txt")" "$(cat "$TMP/e5_new.txt")"

cat > "$TMP/e6_old.txt" << 'ETBEOF_X'
useState<string>('Collège & Lycée Jean Moulin');
ETBEOF_X
cat > "$TMP/e6_new.txt" << 'ETBEOF_X'
useState<string>('Ensemble Scolaire Notre Dame des Missions');
ETBEOF_X
replace_once "$APP" "$(cat "$TMP/e6_old.txt")" "$(cat "$TMP/e6_new.txt")"

cat > "$TMP/e7_old.txt" << 'ETBEOF_X'
schoolEstablishment: establishmentName || 'Collège & Lycée Jean Moulin',
ETBEOF_X
cat > "$TMP/e7_new.txt" << 'ETBEOF_X'
schoolEstablishment: establishmentName || 'Ensemble Scolaire Notre Dame des Missions',
ETBEOF_X
replace_once "$APP" "$(cat "$TMP/e7_old.txt")" "$(cat "$TMP/e7_new.txt")"

cat > "$TMP/e8_old.txt" << 'ETBEOF_X'
    if (applyToAllStudents) {
      const updatedStudents = students.map((s) => ({
        ...s,
        schoolEstablishment: newName,
      }));
      setStudents(updatedStudents);
      await saveStoredStudents(updatedStudents);
    }

ETBEOF_X
cat > "$TMP/e8_new.txt" << 'ETBEOF_X'
    // Le nom affiché sur les fiches et dans les PDF vient TOUJOURS du nom enregistré ci-dessus :
    // il n'est plus nécessaire de réécrire TOUTE la liste des élèves depuis le navigateur
    // (opération à risque, cause de l'incident du 01/10). Le paramètre est conservé pour compatibilité.
    void applyToAllStudents;

ETBEOF_X
replace_once "$APP" "$(cat "$TMP/e8_old.txt")" "$(cat "$TMP/e8_new.txt")"

cat > "$TMP/e9_old.txt" << 'ETBEOF_X'
  establishmentName = 'Collège & Lycée Jean Moulin',
ETBEOF_X
cat > "$TMP/e9_new.txt" << 'ETBEOF_X'
  establishmentName = 'Ensemble Scolaire Notre Dame des Missions',
ETBEOF_X
replace_once "$ADM" "$(cat "$TMP/e9_old.txt")" "$(cat "$TMP/e9_new.txt")"

cat > "$TMP/e10_old.txt" << 'ETBEOF_X'
placeholder="Ex: Collège & Lycée Jean Moulin, Lycée Victor Hugo..."
ETBEOF_X
cat > "$TMP/e10_new.txt" << 'ETBEOF_X'
placeholder="Ex: Ensemble Scolaire Notre Dame des Missions, Lycée Victor Hugo..."
ETBEOF_X
replace_once "$ADM" "$(cat "$TMP/e10_old.txt")" "$(cat "$TMP/e10_new.txt")"

cat > "$TMP/e11_old.txt" << 'ETBEOF_X'
                    'Collège & Lycée Jean Moulin',
                    'Collège Victor Hugo',
ETBEOF_X
cat > "$TMP/e11_new.txt" << 'ETBEOF_X'
                    'Ensemble Scolaire Notre Dame des Missions',
                    'Collège Victor Hugo',
ETBEOF_X
replace_once "$ADM" "$(cat "$TMP/e11_old.txt")" "$(cat "$TMP/e11_new.txt")"

cat > "$TMP/e12_old.txt" << 'ETBEOF_X'
Appliquer et synchroniser automatiquement ce nom sur l'ensemble des {students.length} fiches élèves
ETBEOF_X
cat > "$TMP/e12_new.txt" << 'ETBEOF_X'
Ce nom s'affiche automatiquement sur l'ensemble des {students.length} fiches élèves et sur les nouveaux PDF
ETBEOF_X
replace_once "$ADM" "$(cat "$TMP/e12_old.txt")" "$(cat "$TMP/e12_new.txt")"

cat > "$TMP/e13_old.txt" << 'ETBEOF_X'
{establishmentName || 'Établissement Jean Moulin'}
ETBEOF_X
cat > "$TMP/e13_new.txt" << 'ETBEOF_X'
{establishmentName || 'Établissement scolaire'}
ETBEOF_X
replace_once "$HDR" "$(cat "$TMP/e13_old.txt")" "$(cat "$TMP/e13_new.txt")"

# --- 3. Reconstruction ------------------------------------------------------
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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/src $APP_DIR/"
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
 - Toutes les fiches (rubrique 1), les PDF generes desormais et la liste officielle des inscrits
   affichent le nom ENREGISTRE de l'etablissement.
 - Les PDF deja archives dans fiches-pdf/ gardent l'ancien nom jusqu'a un nouvel enregistrement
   de la fiche complete.
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build etablissement-20261005"
============================================================
MSG
