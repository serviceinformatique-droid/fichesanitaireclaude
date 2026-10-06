#!/bin/bash
# ============================================================================
# patch-fiche-une-page.sh  -  build onepage-20261006
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# LA FICHE SANITAIRE (PDF) TIENT SUR UNE SEULE PAGE A4.
#  - le generateur MESURE d'abord la hauteur reellement necessaire, puis reduit l'ensemble (textes,
#    blocs, espacements) juste assez pour tenir sur une page ; une fiche courte n'est pas reduite ;
#  - AUCUNE information n'est coupee ni masquee ;
#  - si la fiche est trop longue pour rester LISIBLE (echelle minimale 72 %), elle garde sa mise en
#    page normale sur 2 pages plutot que de devenir illisible ;
#  - vaut pour le PDF telecharge, la copie archivee (fiches-pdf/) et le PDF envoye par e-mail ;
#  - le filigrane BROUILLON, le bandeau « non valable » et le pied de page restent a la bonne taille.
# Apres installation : Administration > Etablissement scolaire > « Regenerer les PDF de toutes les fiches
# completes » refait les copies archivees.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-fiche-une-page.sh && /root/patch-fiche-une-page.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="onepage-20261006"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/utils/pdfGenerator.ts"
TMP="$(mktemp -d)"

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

PDF="$APP_DIR/src/utils/pdfGenerator.ts"
[ -f "$PDF" ] || { echo "ERREUR : $PDF introuvable."; exit 1; }
command -v perl >/dev/null || { echo "ERREUR : perl est requis (apt install -y perl)."; exit 1; }

grep -q "pdf-sante-20261006" "$PDF" || { echo "ERREUR : le correctif patch-pdf-sante n'est pas installe : appliquez-le d'abord."; exit 1; }

if grep -q "onepage-20261006" "$PDF"; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
fi

# --- Fonctions utilitaires -------------------------------------------------
count_occ() { OLD="$2" perl -0777 -ne 'my $c = () = /\Q$ENV{OLD}\E/g; print $c' "$1"; }

replace_once() { # fichier  ancien_texte  nouveau_texte
  local file="$1" old="$2" new="$3" n
  n="$(count_occ "$file" "$old")"
  [ "$n" = "1" ] || { echo "ERREUR : repere trouve $n fois dans $file (attendu : 1) :"; echo "$old" | head -3; exit 1; }
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
echo ">>> Modification de src/utils/pdfGenerator.ts ..."
cat > "$TMP/e1_old.txt" << 'ONEPAGEEOF_X'
  asBase64: boolean = false
): Promise<boolean | string> {
  try {
    const { cerfa } = student;
ONEPAGEEOF_X
cat > "$TMP/e1_new.txt" << 'ONEPAGEEOF_X'
  asBase64: boolean = false,
  fitOptions?: { fit?: number; measure?: boolean; noBreaks?: boolean }
): Promise<boolean | string> {
  try {
    // build onepage-20261006 : la fiche tient sur UNE page. On mesure la hauteur réellement nécessaire, puis on réduit
    // l'ensemble (textes, blocs, interlignes) juste assez ; aucune information n'est coupée. Si même à l'échelle minimale
    // la fiche ne tient pas, elle garde sa mise en page normale sur plusieurs pages (jamais de texte illisible).
    if (!fitOptions) {
      const MIN_FIT = 0.72;
      const BOTTOM = 297 - 14; // hauteur utile en mm (marge basse de 14 mm pour le pied de page)
      const fits = async (k: number): Promise<boolean> => {
        const yEnd = (await generateCerfaPdf(student, trips, establishmentName, false, { fit: k, measure: true, noBreaks: true })) as unknown as number;
        return typeof yEnd === 'number' && yEnd * k <= BOTTOM;
      };
      let k = 1;
      if (!(await fits(1))) {
        if (await fits(MIN_FIT)) {
          let lo = MIN_FIT; // tient
          let hi = 1; // ne tient pas
          for (let i = 0; i < 6; i++) {
            const mid = (lo + hi) / 2;
            if (await fits(mid)) lo = mid;
            else hi = mid;
          }
          k = Math.floor(lo * 1000) / 1000;
        } else {
          k = 0; // trop long pour une page lisible : mise en page normale sur plusieurs pages
        }
      }
      return generateCerfaPdf(student, trips, establishmentName, asBase64, k > 0 ? { fit: k, noBreaks: true } : { fit: 1, noBreaks: false });
    }
    const FIT = fitOptions.fit ?? 1;
    const MEASURE = !!fitOptions.measure;
    const NO_BREAKS = !!fitOptions.noBreaks;
    const FX = 1 / FIT; // la mise en page est calculée sur une feuille « élargie » puis réduite d'un bloc

    const { cerfa } = student;
ONEPAGEEOF_X
replace_once "$PDF" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

cat > "$TMP/e2_old.txt" << 'ONEPAGEEOF_X'
    const enrolledTrips = trips.filter((t) => student.registeredTripIds?.includes(t.id));
    const pageWidth = 210;
    const margin = 6;
    const contentWidth = pageWidth - margin * 2; // 198 mm
    let y = 5;
ONEPAGEEOF_X
cat > "$TMP/e2_new.txt" << 'ONEPAGEEOF_X'
    // Réduction d'un bloc : l'origine de la transformation est en bas à gauche de la page, on recale donc sur le haut
    if (FIT < 1) {
      doc.saveGraphicsState();
      doc.setCurrentTransformationMatrix(new (doc as any).Matrix(FIT, 0, 0, FIT, 0, 297 * doc.internal.scaleFactor * (1 - FIT)));
    }

    const enrolledTrips = trips.filter((t) => student.registeredTripIds?.includes(t.id));
    const pageWidth = 210 * FX;
    const margin = 6 * FX;
    const contentWidth = pageWidth - margin * 2; // 198 mm une fois réduit
    let y = 5 * FX;
ONEPAGEEOF_X
replace_once "$PDF" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

cat > "$TMP/e3_old.txt" << 'ONEPAGEEOF_X'
    const PAGE_H = 297;
    const BOTTOM_MARGIN = 14;
ONEPAGEEOF_X
cat > "$TMP/e3_new.txt" << 'ONEPAGEEOF_X'
    const PAGE_H = 297 * FX;
    const BOTTOM_MARGIN = 14 * FX;
ONEPAGEEOF_X
replace_once "$PDF" "$(cat "$TMP/e3_old.txt")" "$(cat "$TMP/e3_new.txt")"

cat > "$TMP/e4_old.txt" << 'ONEPAGEEOF_X'
    const ensureSpace = (h: number) => {
      if (y + h > PAGE_H - BOTTOM_MARGIN) newPage();
    };
ONEPAGEEOF_X
cat > "$TMP/e4_new.txt" << 'ONEPAGEEOF_X'
    const ensureSpace = (h: number) => {
      if (!NO_BREAKS && y + h > PAGE_H - BOTTOM_MARGIN) newPage();
    };
ONEPAGEEOF_X
replace_once "$PDF" "$(cat "$TMP/e4_old.txt")" "$(cat "$TMP/e4_new.txt")"

cat > "$TMP/e5_old.txt" << 'ONEPAGEEOF_X'
    // --- PIED DE PAGE sur chaque page (build pdf-sante-20261006) ---
ONEPAGEEOF_X
cat > "$TMP/e5_new.txt" << 'ONEPAGEEOF_X'
    if (MEASURE) return (y + 25) as unknown as boolean; // passe de mesure : hauteur utilisée (bloc signature compris), rien n'est enregistré
    if (FIT < 1) doc.restoreGraphicsState(); // le pied de page et le filigrane sont écrits à l'échelle réelle de la page
    // --- PIED DE PAGE sur chaque page (build pdf-sante-20261006) ---
ONEPAGEEOF_X
replace_once "$PDF" "$(cat "$TMP/e5_old.txt")" "$(cat "$TMP/e5_new.txt")"

cat > "$TMP/e6_old.txt" << 'ONEPAGEEOF_X'
        `Fiche Sanitaire de Liaison officielle — ${resolvedEstablishment} — Document confidentiel`,
        margin,
        291
ONEPAGEEOF_X
cat > "$TMP/e6_new.txt" << 'ONEPAGEEOF_X'
        `Fiche Sanitaire de Liaison officielle — ${resolvedEstablishment} — Document confidentiel`,
        6,
        291
ONEPAGEEOF_X
replace_once "$PDF" "$(cat "$TMP/e6_old.txt")" "$(cat "$TMP/e6_new.txt")"

cat > "$TMP/e7_old.txt" << 'ONEPAGEEOF_X'
        pageWidth - margin,
        291,
        { align: 'right' }
ONEPAGEEOF_X
cat > "$TMP/e7_new.txt" << 'ONEPAGEEOF_X'
        210 - 6,
        291,
        { align: 'right' }
ONEPAGEEOF_X
replace_once "$PDF" "$(cat "$TMP/e7_old.txt")" "$(cat "$TMP/e7_new.txt")"

cat > "$TMP/o1_old.txt" << 'ONEPAGEEOF_X'
''}`, contentWidth).slice(0, 2)
ONEPAGEEOF_X
cat > "$TMP/o1_new.txt" << 'ONEPAGEEOF_X'
''}`, 198).slice(0, 2)
ONEPAGEEOF_X
if [ "$(count_occ "$PDF" "$(cat "$TMP/o1_old.txt")")" = "1" ]; then replace_once "$PDF" "$(cat "$TMP/o1_old.txt")" "$(cat "$TMP/o1_new.txt")"; fi

cat > "$TMP/o2_old.txt" << 'ONEPAGEEOF_X'
doc.text(bandeau, margin, 287 - (bandeau.length - 1) * 3.2);
ONEPAGEEOF_X
cat > "$TMP/o2_new.txt" << 'ONEPAGEEOF_X'
doc.text(bandeau, 6, 287 - (bandeau.length - 1) * 3.2);
ONEPAGEEOF_X
if [ "$(count_occ "$PDF" "$(cat "$TMP/o2_old.txt")")" = "1" ]; then replace_once "$PDF" "$(cat "$TMP/o2_old.txt")" "$(cat "$TMP/o2_new.txt")"; fi

# Les positions horizontales (« margin + 115 », « margin + 170 »...) suivent la largeur elargie de la mise en page
START="$(grep -n '^export async function generateCerfaPdf' "$PDF" | head -1 | cut -d: -f1)"
[ -n "$START" ] || { echo "ERREUR : fonction generateCerfaPdf introuvable."; exit 1; }
END="$(awk -v s="$START" 'NR>s && /^}/ {print NR; exit}' "$PDF")"
[ -n "$END" ] || { echo "ERREUR : fin de la fonction generateCerfaPdf introuvable."; exit 1; }
perl -i -pe 'BEGIN { $s = shift; $e = shift } if ($. >= $s && $. <= $e) { s/margin \+ (\d+(?:\.\d+)?)(?![\d.])/margin + $1 * FX/g }' "$START" "$END" "$PDF"
N="$(sed -n "${START},${END}p" "$PDF" | grep -c '\* FX')"
[ "$N" -ge 20 ] || { echo "ERREUR : trop peu de positions ajustees ($N) : version inattendue du generateur."; exit 1; }
echo "    $N positions horizontales ajustees."
sed -i "s|^export async function generateCerfaPdf|// build onepage-20261006 : fiche sur une seule page (mesure + reduction automatique)\nexport async function generateCerfaPdf|" "$PDF"

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
 - La fiche sanitaire (PDF) tient sur UNE page A4 (reduction automatique, aucune information coupee).
 - Fiche trop longue pour rester lisible : mise en page normale sur 2 pages.
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5), puis refaites les copies archivees :
 Administration > Etablissement scolaire > « Regenerer les PDF de toutes les fiches completes ».
============================================================
MSG
