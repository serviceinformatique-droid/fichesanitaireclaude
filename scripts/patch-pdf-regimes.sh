#!/bin/bash
# ============================================================================
# patch-pdf-regimes.sh  -  build diet-pdf-20261007
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# ESPACE PROFESSEUR : PDF DE LA SEULE « SYNTHESE DES REGIMES ALIMENTAIRES » (traiteur & hebergement)
#  - bouton « PDF Regimes alimentaires » dans la barre d'actions de l'espace professeur, et bouton
#    « PDF : synthese des regimes (traiteur) » dans la synthese elle-meme ;
#  - le PDF (A4 paysage, texte vectoriel selectionnable, pagine, pied de page) ne contient QUE : le voyage,
#    l'effectif, le decompte par categorie, puis les eleves CLASSES PAR CATEGORIE (Allergie alimentaire, Sans porc,
#    Sans viande, Vegetarien, Sans restriction) avec classe, pension, precisions du regime, remarque des parents
#    et, pour les allergies alimentaires, la cause et la conduite a tenir ;
#  - AUCUNE autre donnee de sante : ni PAI, ni traitement, ni coordonnees des familles, ni numero de securite sociale ;
#  - securite : un eleve dont la fiche declare une allergie alimentaire alors que son regime est « Sans restriction »
#    est signale en rouge (« A VERIFIER ») pour que le traiteur ne soit jamais induit en erreur ;
#  - une entree est ajoutee au journal des mises a jour.
#
# SECURITE DU PATCH : tous les reperes sont verifies sur une COPIE avant toute modification ; en cas d'ecart,
# rapport complet dans /root/diagnostic-regimes.txt et AUCUN fichier modifie.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-pdf-regimes.sh && /root/patch-pdf-regimes.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="diet-pdf-20261007"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/utils/organizerPdf.ts src/components/OrganizerSpace.tsx"
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

set_paths() { # racine
  PDF="$1/src/utils/organizerPdf.ts"
  ORG="$1/src/components/OrganizerSpace.tsx"
}
set_paths "$APP_DIR"

if grep -q "generateDietSummaryPdf" "$PDF"; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
fi
grep -q "generateOrganizerReportPdf" "$PDF" || { echo "ERREUR : les PDF organisateurs (patch-pdf-organisateurs) ne sont pas installes : appliquez-les d'abord."; exit 1; }

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
  cat > "$TMP/e1_old.txt" << 'DIETEOF_X'
// ----------------------------------------------------------------------------------------------
// 2. Relevé sanitaire du séjour (espace organisateur)
DIETEOF_X
  cat > "$TMP/e1_new.txt" << 'DIETEOF_X'
// ----------------------------------------------------------------------------------------------
// 1bis. Synthèse des régimes alimentaires (transmission traiteur & hébergement) - build diet-pdf-20261007
//   UNIQUEMENT les régimes et allergies alimentaires, classés par catégorie : ni PAI, ni traitement, ni coordonnées.
// ----------------------------------------------------------------------------------------------
export interface DietSummaryPdfOptions {
  establishmentName?: string;
  filename?: string;
}

const DIET_ORDER: { key: string; label: string; tone: 'red' | 'amber' | 'blue' | 'green' }[] = [
  { key: 'allergie_alimentaire', label: 'Allergie alimentaire', tone: 'red' },
  { key: 'sans_porc', label: 'Sans porc', tone: 'amber' },
  { key: 'sans_viande', label: 'Sans viande', tone: 'amber' },
  { key: 'vegetarien', label: 'Végétarien', tone: 'amber' },
  { key: 'standard', label: 'Sans restriction', tone: 'green' },
];

export async function generateDietSummaryPdf(trip: Trip, students: Student[], opts: DietSummaryPdfOptions = {}): Promise<boolean> {
  try {
    const establishment = (opts.establishmentName || getStoredEstablishmentName() || '').trim();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    installPdfSafety(doc);

    const list = students.filter((s) => !(s as any).deletedAt).sort(byName);
    const catOf = (s: Student): string => {
      const c = String(s.cerfa.structuredDiet?.category || '');
      return DIET_ORDER.some((d) => d.key === c) ? c : 'standard';
    };
    const foodAllergy = (s: Student): boolean => !!(s.cerfa.medicalInfo as any)?.allergies?.alimentaires;
    const conduite = (s: Student): string => String((s.cerfa.medicalInfo as any)?.allergyCauseAndAction || '').trim();
    const groups = DIET_ORDER.map((d) => ({ ...d, students: list.filter((s) => catOf(s) === d.key) }));
    const suspicious = list.filter((s) => catOf(s) === 'standard' && foodAllergy(s));

    const columns: Column[] = [
      { label: 'N°', w: 9, align: 'center' },
      { label: 'Élève (nom & prénom)', w: 62 },
      { label: 'Classe', w: 20, align: 'center' },
      { label: 'Pension', w: 22, align: 'center' },
      { label: 'Précisions du régime', w: 80 },
      { label: 'Allergie alimentaire : cause & conduite à tenir', w: 88 },
    ];

    const TITLE = 'SYNTHÈSE DES RÉGIMES ALIMENTAIRES';
    let first = true;
    const pageHeader = (): number => {
      let y = MARGIN;
      doc.setFont('helvetica', 'bold');
      if (first) {
        doc.setFontSize(7);
        setInk(doc, GRAY);
        doc.text(establishment.toUpperCase(), MARGIN, y + 2);
        doc.setFontSize(15);
        setInk(doc, INK);
        doc.text(TITLE, MARGIN, y + 9);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        setInk(doc, BLUE);
        doc.text('Transmission traiteur & hébergement', MARGIN, y + 14);
        doc.setFontSize(8.5);
        setInk(doc, [51, 65, 85]);
        doc.text(`Voyage : ${trip.name} — ${trip.destination} — du ${formatDateFr(trip.startDate)} au ${formatDateFr(trip.endDate)}`, MARGIN, y + 19);
        const chips: { label: string; value: string; tone?: 'red' | 'green' | 'amber' | 'blue' }[] = [{ label: 'Effectif du voyage', value: String(list.length), tone: 'blue' }];
        groups.forEach((g) => chips.push({ label: g.label, value: String(g.students.length), tone: g.students.length ? g.tone : 'green' }));
        y = drawChips(doc, y + 22, chips);
        if (suspicious.length) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          setInk(doc, RED);
          doc.text(
            `ATTENTION : ${suspicious.length} élève${suspicious.length > 1 ? 's ont' : ' a'} une allergie alimentaire déclarée dans la fiche sanitaire alors que ${suspicious.length > 1 ? 'leur' : 'son'} régime est « Sans restriction » (${suspicious.length > 1 ? 'lignes' : 'ligne'} en rouge, à vérifier).`,
            MARGIN,
            y + 2
          );
          y += 6;
        }
        first = false;
      } else {
        doc.setFontSize(8.5);
        setInk(doc, INK);
        doc.text(`${TITLE} — ${trip.name} (suite)`, MARGIN, y + 3);
        y += 7;
      }
      return y;
    };

    const rows: TableRow[] = [];
    groups.forEach((g) => {
      if (!g.students.length) return;
      rows.push({ group: g.label, count: g.students.length });
      g.students.forEach((s, i) => {
        const details = String(s.cerfa.structuredDiet?.details || '').trim();
        const reco = String(s.cerfa.parentRecommendations || '').trim();
        const flagged = foodAllergy(s);
        const precision: TextLine[] = [];
        if (details) precision.push({ text: details, bold: true, size: 8.5, color: g.key === 'standard' ? INK : BLUE });
        if (reco) precision.push({ text: `Remarque des parents : ${reco}`, italic: true, size: 7.5, color: GRAY });
        if (!precision.length) precision.push({ text: g.key === 'standard' ? '—' : 'Aucune précision saisie', size: 8, color: GRAY });
        const allergy: TextLine[] = [];
        if (g.key === 'standard' && flagged) allergy.push({ text: 'À VÉRIFIER : régime « Sans restriction » malgré une allergie déclarée', bold: true, size: 7.5, color: RED });
        if (flagged) {
          allergy.push({ text: 'ALLERGIE ALIMENTAIRE', bold: true, size: 8.5, color: RED });
          allergy.push({ text: conduite(s) || 'Cause et conduite à tenir non renseignées : consulter la fiche sanitaire.', size: 7.5, color: [127, 29, 29] });
        } else if (g.key === 'allergie_alimentaire') {
          allergy.push({ text: 'Allergie à préciser : consulter la fiche sanitaire.', bold: true, size: 8, color: [146, 64, 14] });
        } else {
          allergy.push({ text: '—', size: 9, color: GRAY });
        }
        rows.push({
          fill: flagged ? [255, 245, 245] : undefined,
          cells: [
            { lines: [{ text: String(i + 1), size: 8, color: GRAY }], align: 'center' },
            { lines: [{ text: fullName(s), bold: true, size: 9 }] },
            { lines: [{ text: s.schoolClass || '—', bold: true, size: 9 }], align: 'center' },
            { lines: [{ text: s.boardingStatus || '—', size: 8.5 }], align: 'center' },
            { lines: precision },
            { lines: allergy },
          ],
        });
      });
    });
    if (!rows.length) rows.push({ cells: [{}, { lines: [{ text: 'Aucun élève inscrit à ce voyage.', italic: true, size: 9, color: GRAY }] }, {}, {}, {}, {}] });

    drawTable(doc, columns, rows, pageHeader(), pageHeader);
    drawFooters(doc, `${establishment} — ${trip.name}`);

    doc.save(opts.filename || `Synthese_Regimes_${safeName(trip.name)}.pdf`);
    return true;
  } catch (error) {
    console.error('Erreur lors de la génération du PDF (synthèse des régimes alimentaires) :', error);
    return false;
  }
}

// ----------------------------------------------------------------------------------------------
// 2. Relevé sanitaire du séjour (espace organisateur)
DIETEOF_X
  replace_once "$PDF" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

  cat > "$TMP/e2_old.txt" << 'DIETEOF_X'
import { generateOrganizerReportPdf } from '../utils/organizerPdf';
DIETEOF_X
  cat > "$TMP/e2_new.txt" << 'DIETEOF_X'
import { generateOrganizerReportPdf, generateDietSummaryPdf } from '../utils/organizerPdf';
DIETEOF_X
  replace_once "$ORG" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

  cat > "$TMP/e3_old.txt" << 'DIETEOF_X'
  const [isExportingPdf, setIsExportingPdf] = useState(false);
DIETEOF_X
  cat > "$TMP/e3_new.txt" << 'DIETEOF_X'
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  // PDF « Synthèse des régimes alimentaires » (transmission traiteur & hébergement), classé par catégorie - build diet-pdf-20261007
  const [isExportingDietPdf, setIsExportingDietPdf] = useState(false);
  const handleDietPdf = async () => {
    setIsExportingDietPdf(true);
    try {
      const ok = await generateDietSummaryPdf(currentTrip, enrolledStudents, {
        filename: `Synthese_Regimes_${currentTrip.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
      });
      if (!ok) window.alert("Le PDF de la synthèse des régimes alimentaires n'a pas pu être généré. Réessayez dans un instant.");
    } finally {
      setIsExportingDietPdf(false);
    }
  };
DIETEOF_X
  replace_once "$ORG" "$(cat "$TMP/e3_old.txt")" "$(cat "$TMP/e3_new.txt")"

  cat > "$TMP/e4_old.txt" << 'DIETEOF_X'
                Décompte par régime alimentaire structuré pour la commande des repas du voyage.
              </p>
            </div>
          </div>
DIETEOF_X
  cat > "$TMP/e4_new.txt" << 'DIETEOF_X'
                Décompte par régime alimentaire structuré pour la commande des repas du voyage.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDietPdf}
              disabled={isExportingDietPdf}
              data-testid="diet-pdf-button"
              className="flex items-center gap-1.5 bg-blue-900 hover:bg-blue-950 disabled:opacity-60 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-xs transition-colors cursor-pointer shrink-0"
              title="Télécharger un PDF contenant uniquement cette synthèse (classée par catégorie) pour le traiteur et l'hébergement"
            >
              <Download className="w-4 h-4" />
              <span>{isExportingDietPdf ? 'Génération PDF...' : 'PDF : synthèse des régimes (traiteur)'}</span>
            </button>
          </div>
DIETEOF_X
  replace_once "$ORG" "$(cat "$TMP/e4_old.txt")" "$(cat "$TMP/e4_new.txt")"

  cat > "$TMP/e5_old.txt" << 'DIETEOF_X'
          <button
            type="button"
            onClick={() => window.print()}
DIETEOF_X
  cat > "$TMP/e5_new.txt" << 'DIETEOF_X'
          <button
            type="button"
            onClick={handleDietPdf}
            disabled={isExportingDietPdf}
            data-testid="diet-pdf-button-header"
            className="flex items-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg shadow-xs transition-colors cursor-pointer"
            title="PDF de la seule synthèse des régimes alimentaires, classée par catégorie (traiteur et hébergement)"
          >
            <Utensils className="w-4 h-4 text-blue-700" />
            <span>{isExportingDietPdf ? 'Génération PDF...' : 'PDF Régimes alimentaires'}</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
DIETEOF_X
  replace_once "$ORG" "$(cat "$TMP/e5_old.txt")" "$(cat "$TMP/e5_new.txt")"

}

# entree ajoutee a la fin du journal des mises a jour (si le journal est installe)
append_changelog() {
  local f="$APP_DIR/server/changelog.json"
  [ -f "$f" ] || return 0
  grep -q '"id": "diet-pdf-20261007"' "$f" && return 0
  ENTRY='{"id": "diet-pdf-20261007", "date": "2026-10-07", "category": "Professeurs", "title": "PDF de la synthèse des régimes alimentaires", "details": ["Bouton « PDF Régimes alimentaires » dans l'\''espace professeur (et dans la synthèse des régimes) : un PDF qui ne contient que les régimes et allergies alimentaires, classés par catégorie, pour le traiteur et l'\''hébergement.", "Ni PAI, ni traitement, ni coordonnées des familles ; les allergies déclarées malgré un régime « Sans restriction » sont signalées en rouge."]}' perl -0777 -i -pe 's/\n\]\s*\z/,\n  $ENV{ENTRY}\n]\n/' "$f"
  grep -q '"id": "diet-pdf-20261007"' "$f" || { echo "ERREUR : entree du journal non ajoutee."; exit 1; }
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
  cp "$REPORT" /root/diagnostic-regimes.txt 2>/dev/null && echo "(rapport copie dans /root/diagnostic-regimes.txt)"
  echo ""
  echo "!!! Envoyez ce rapport pour obtenir un script adapte a vos fichiers."
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
echo ">>> Modification des fichiers ..."
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
 - Espace professeur : bouton « PDF Regimes alimentaires » (barre d'actions) et bouton dans la synthese des regimes :
   PDF classe par categorie, UNIQUEMENT regimes et allergies alimentaires (traiteur & hebergement).
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build pdf-organisateurs-20261006" (le PDF est dans le meme module)
============================================================
MSG
