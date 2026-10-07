#!/bin/bash
# ============================================================================
# patch-professeur-plusieurs-voyages.sh  -  build multi-trips-20261007
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# PROFESSEUR QUI ENCADRE PLUSIEURS VOYAGES :
#  - AVANT : l'administration pouvait affecter plusieurs voyages au meme professeur, mais son espace n'affichait
#    que le PREMIER ; le second etait inaccessible ;
#  - APRES : en haut de l'espace, des boutons « Mes voyages (2) : Angleterre 2027 · 12 eleves | Neige 2027 · 9 eleves »
#    permettent de passer de l'un a l'autre ; le voyage choisi est memorise (par compte, dans ce navigateur) ;
#    liste des eleves, releves, exports PDF/CSV et indicateurs suivent le voyage choisi ; les filtres sont
#    remis a zero quand on change de voyage ;
#  - un professeur avec UN seul voyage ne voit aucun changement ; l'administrateur qui ouvre l'espace organisateur
#    peut aussi choisir parmi tous les voyages ;
#  - une entree est ajoutee au journal des mises a jour (la cloche de l'administration la signale).
#
# SECURITE : tous les reperes sont verifies sur une COPIE avant toute modification ; en cas d'ecart, rapport
# complet dans /root/diagnostic-voyages.txt et AUCUN fichier modifie.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-professeur-plusieurs-voyages.sh && /root/patch-professeur-plusieurs-voyages.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="multi-trips-20261007"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/components/OrganizerSpace.tsx"
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

ORG="$APP_DIR/src/components/OrganizerSpace.tsx"

if grep -q "cerfa_org_trip_" "$ORG"; then
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
  const currentTrip = availableTrips[0] || trips[0];
MTEOF_X
  cat > "$TMP/e1_new.txt" << 'MTEOF_X'
  // Un professeur qui encadre plusieurs voyages choisit celui qu'il consulte ; le choix est mémorisé (par compte, dans ce navigateur) - build multi-trips-20261007
  const tripChoiceKey = `cerfa_org_trip_${currentUser.id}_v1`;
  const [selectedTripId, setSelectedTripId] = useState<string>(() => {
    try {
      return localStorage.getItem(tripChoiceKey) || '';
    } catch {
      return '';
    }
  });
  const currentTrip = availableTrips.find((t) => t.id === selectedTripId) || availableTrips[0] || trips[0];
  const chooseTrip = (id: string) => {
    setSelectedTripId(id);
    try {
      localStorage.setItem(tripChoiceKey, id);
    } catch {
      /* stockage indisponible : le choix vaut pour cette page seulement */
    }
  };
  React.useEffect(() => {
    console.log('[fichesanitaire] build multi-trips-20261007');
  }, []);
MTEOF_X
  replace_once "$ORG" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

  cat > "$TMP/e2_old.txt" << 'MTEOF_X'
  const [selectedDetailStudent, setSelectedDetailStudent] = useState<Student | null>(null);
MTEOF_X
  cat > "$TMP/e2_new.txt" << 'MTEOF_X'
  const [selectedDetailStudent, setSelectedDetailStudent] = useState<Student | null>(null);
  // changement de voyage : on repart de filtres vierges (une classe ou un régime d'un autre voyage n'aurait pas de sens)
  React.useEffect(() => {
    setActiveFilterView('all');
    setKpiFilter('all');
    setSearchQuery('');
    setSelectedClassFilter('all');
    setSelectedDietFilter('all');
    setSelectedDetailStudent(null);
    setUnlockedSensitiveStudentId(null);
  }, [currentTrip?.id]);
MTEOF_X
  replace_once "$ORG" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

  cat > "$TMP/e3_old.txt" << 'MTEOF_X'
          <div className="flex items-center gap-3 mt-2">
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 uppercase">
              VOYAGE : {currentTrip.name}
            </h2>
          </div>
MTEOF_X
  cat > "$TMP/e3_new.txt" << 'MTEOF_X'
          <div className="flex items-center gap-3 mt-2">
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 uppercase">
              VOYAGE : {currentTrip.name}
            </h2>
          </div>
          {availableTrips.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 mt-3" role="group" aria-label="Choisir le voyage à consulter" data-testid="organizer-trip-switch">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Mes voyages ({availableTrips.length}) :</span>
              {availableTrips.map((t) => {
                const n = students.filter((s) => !s.deletedAt && s.registeredTripIds.includes(t.id)).length;
                const active = t.id === currentTrip.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => chooseTrip(t.id)}
                    aria-pressed={active}
                    data-testid={`organizer-trip-${t.id}`}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                      active ? 'bg-blue-900 text-white border-blue-900 shadow-xs' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {t.name} · {n} élève{n > 1 ? 's' : ''}
                  </button>
                );
              })}
            </div>
          )}
MTEOF_X
  replace_once "$ORG" "$(cat "$TMP/e3_old.txt")" "$(cat "$TMP/e3_new.txt")"

}

# entree ajoutee a la fin du journal des mises a jour (si le journal est installe)
append_changelog() {
  local f="$APP_DIR/server/changelog.json"
  [ -f "$f" ] || return 0
  grep -q '"id": "multi-trips-20261007"' "$f" && return 0
  ENTRY='{"id": "multi-trips-20261007", "date": "2026-10-07", "category": "Professeurs", "title": "Professeur avec plusieurs voyages", "details": ["Un professeur qui encadre plusieurs voyages les voit tous : boutons « Mes voyages » en haut de son espace, avec le nombre d'\''élèves de chacun.", "Le voyage choisi est mémorisé ; les filtres sont remis à zéro quand il change.", "Avant, seul le premier voyage était accessible."]}' perl -0777 -i -pe 's/\n\]\s*\z/,\n  $ENV{ENTRY}\n]\n/' "$f"
  grep -q '"id": "multi-trips-20261007"' "$f" || { echo "ERREUR : entree du journal non ajoutee."; exit 1; }
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
  cp "$REPORT" /root/diagnostic-voyages.txt 2>/dev/null && echo "(rapport copie dans /root/diagnostic-voyages.txt)"
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
echo ">>> Modification de src/components/OrganizerSpace.tsx ..."
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
 - Espace professeur : un professeur qui encadre plusieurs voyages voit des boutons « Mes voyages » en haut
   de son espace et passe de l'un a l'autre ; le choix est memorise.
 - Un professeur avec un seul voyage ne voit aucun changement.
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build multi-trips-20261007"
============================================================
MSG
