#!/bin/bash
# ============================================================================
# patch-filtre-vue-ensemble.sh  -  build overview-filter-20261006
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# ADMINISTRATION > « Vue d ensemble & KPIs » > tableau « Suivi global » :
#  - sélecteur « Toutes les fiches (N) » / « Incomplètes seulement (M) » au-dessus du tableau ;
#  - le tableau n'affiche alors que les fiches incomplètes (même définition que le bouton « Relancer les fiches
#    incomplètes ») ; compteur « X fiches affichées sur N » ; message si aucune fiche incomplète ;
#  - le choix est mémorisé dans ce navigateur (il reste après rechargement) ;
#  - les indicateurs (KPI), les boutons de relance et l'export ÉcoleDirecte ne changent pas.
#
# SECURITE : tous les reperes sont verifies sur une COPIE avant toute modification ; en cas d'ecart, rapport
# complet dans /root/diagnostic-filtre.txt et AUCUN fichier modifie.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-filtre-vue-ensemble.sh && /root/patch-filtre-vue-ensemble.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="overview-filter-20261006"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/components/AdminSpace.tsx"
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
    echo "!!! ERREUR pendant le patch : restauration automatique du fichier d'origine ..."
    for f in $FILES; do cp -p "$BACKUP_DIR/$f" "$APP_DIR/$f"; done
    echo "!!! Fichier d'origine restaure : aucune modification n'a ete conservee."
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

ADMIN="$APP_DIR/src/components/AdminSpace.tsx"

if grep -q "cerfa_overview_filter_v1" "$ADMIN"; then
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
  cat > "$TMP/e1_old.txt" << 'FILTEREOF_X'
  const [showPurgeModal, setShowPurgeModal] = useState(false);
FILTEREOF_X
  cat > "$TMP/e1_new.txt" << 'FILTEREOF_X'
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  // Vue d'ensemble : toutes les fiches ou seulement les incomplètes (préférence mémorisée dans ce navigateur) - build overview-filter-20261006
  const [overviewFilter, setOverviewFilter] = useState<'all' | 'incomplete'>(() => {
    try {
      return localStorage.getItem('cerfa_overview_filter_v1') === 'incomplete' ? 'incomplete' : 'all';
    } catch {
      return 'all';
    }
  });
  const changeOverviewFilter = (f: 'all' | 'incomplete') => {
    setOverviewFilter(f);
    try {
      localStorage.setItem('cerfa_overview_filter_v1', f);
    } catch {
      /* stockage indisponible : le choix vaut pour cette page seulement */
    }
  };
  React.useEffect(() => {
    console.log('[fichesanitaire] build overview-filter-20261006');
  }, []);
  const overviewIncompleteCount = students.filter((s) => s.status === 'incomplete').length;
  const overviewStudents = overviewFilter === 'incomplete' ? students.filter((s) => s.status === 'incomplete') : students;
FILTEREOF_X
  replace_once "$ADMIN" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

  cat > "$TMP/e2_old.txt" << 'FILTEREOF_X'
            <div className="suivi-wrap">
              <table className="suivi-table w-full text-xs text-left border-collapse">
FILTEREOF_X
  cat > "$TMP/e2_new.txt" << 'FILTEREOF_X'
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3" data-testid="overview-filter">
              <div role="group" aria-label="Filtrer les fiches affichées" className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => changeOverviewFilter('all')}
                  aria-pressed={overviewFilter === 'all'}
                  data-testid="overview-filter-all"
                  className={`px-3 py-1.5 cursor-pointer transition-colors ${
                    overviewFilter === 'all' ? 'bg-blue-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Toutes les fiches ({students.length})
                </button>
                <button
                  type="button"
                  onClick={() => changeOverviewFilter('incomplete')}
                  aria-pressed={overviewFilter === 'incomplete'}
                  data-testid="overview-filter-incomplete"
                  className={`px-3 py-1.5 border-l border-slate-300 cursor-pointer transition-colors ${
                    overviewFilter === 'incomplete' ? 'bg-amber-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Incomplètes seulement ({overviewIncompleteCount})
                </button>
              </div>
              <span className="text-[11px] text-slate-500" data-testid="overview-filter-count">
                {overviewStudents.length} fiche{overviewStudents.length > 1 ? 's' : ''} affichée{overviewStudents.length > 1 ? 's' : ''} sur {students.length}
              </span>
            </div>

            <div className="suivi-wrap">
              <table className="suivi-table w-full text-xs text-left border-collapse">
FILTEREOF_X
  replace_once "$ADMIN" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

  cat > "$TMP/e3_old.txt" << 'FILTEREOF_X'
                  {students.map((s) => {
                    const paiDocs = s.cerfa.documents.filter((d) => d.type === 'pai');
FILTEREOF_X
  cat > "$TMP/e3_new.txt" << 'FILTEREOF_X'
                  {overviewStudents.length === 0 && (
                    <tr data-testid="overview-filter-empty">
                      <td colSpan={10} className="p-6 text-center text-sm font-semibold text-emerald-700">
                        {overviewFilter === 'incomplete'
                          ? 'Aucune fiche incomplète : toutes les fiches sont complètes.'
                          : 'Aucune fiche enregistrée pour le moment.'}
                      </td>
                    </tr>
                  )}
                  {overviewStudents.map((s) => {
                    const paiDocs = s.cerfa.documents.filter((d) => d.type === 'pai');
FILTEREOF_X
  replace_once "$ADMIN" "$(cat "$TMP/e3_old.txt")" "$(cat "$TMP/e3_new.txt")"

}

# --- 1. Verification prealable (sur une copie : RIEN n'est modifie ici) ----------
echo ">>> Verification des reperes dans vos fichiers ..."
mkdir -p "$TMP/dry/$(dirname "$FILES")"
cp "$APP_DIR/$FILES" "$TMP/dry/$FILES"
DRY=1
ADMIN="$TMP/dry/$FILES"
run_edits
DRY=0
ADMIN="$APP_DIR/$FILES"
if [ "$FAILS" -gt 0 ]; then
  echo ""
  echo "!!! $FAILS repere(s) introuvable(s) : votre fichier differe de la version attendue."
  echo "!!! AUCUN fichier n'a ete modifie. Rapport complet :"
  echo ""
  cat "$REPORT"
  cp "$REPORT" /root/diagnostic-filtre.txt 2>/dev/null && echo "(rapport copie dans /root/diagnostic-filtre.txt)"
  echo ""
  echo "!!! Envoyez ce rapport pour obtenir un script adapte a votre fichier."
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

# --- 3. Modifications ---------------------------------------------------------
echo ">>> Modification de src/components/AdminSpace.tsx ..."
run_edits

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
 - Administration > Vue d ensemble & KPIs : sélecteur « Toutes les fiches / Incomplètes seulement » au-dessus
   du tableau « Suivi global » (choix mémorisé dans le navigateur).
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build overview-filter-20261006"
============================================================
MSG
