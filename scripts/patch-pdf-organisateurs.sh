#!/bin/bash
# ============================================================================
# patch-pdf-organisateurs.sh  -  build pdf-organisateurs-20261006
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# VRAIS PDF pour les organisateurs : plus de COPIE D'ECRAN collee dans un PDF.
# Avant : "Telecharger PDF" photographiait la page (image : texte non selectionnable, flou,
# coupe en bas de page). Maintenant, trois PDF vectoriels (texte net, selectionnable, recherchable) :
#  1) LISTE D'EMARGEMENT & SUIVI SANITAIRE du sejour (fenetre « liste sanitaire ») : paysage A4,
#     tableau pagine (en-tetes de colonnes repetes, lignes jamais coupees), effectif / PAI /
#     allergies / regimes, regime alimentaire, allergies + conduite a tenir + traitement,
#     PAI, contact d'urgence, case d'emargement ; tri alphabetique ou par classe (titres de classe) ;
#  2) RELEVE SANITAIRE du sejour (espace organisateur) : indicateurs, filtres actifs, tableau
#     (regime, statut de la fiche, alertes PAI / allergies / traitement) ; vue par classe ou alphabetique ;
#  3) FICHE SANITAIRE INDIVIDUELLE (bouton « Telecharger PDF » de la fiche, pour tous les roles) :
#     meme PDF soigne que la copie archivee (regime et sante en grand), avec en plus le telephone
#     de l'enfant, le n° de securite sociale et le n° d'eleve ; une fiche NON finalisee porte un
#     filigrane BROUILLON et un bandeau « non valable » sur chaque page.
# « Imprimer » (impression du navigateur) reste disponible.
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-pdf-organisateurs.sh && /root/patch-pdf-organisateurs.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="pdf-organisateurs-20261006"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="src/components/TripHealthListModal.tsx src/components/OrganizerSpace.tsx src/components/CerfaOfficialView.tsx src/utils/pdfGenerator.ts"
NEWFILES="src/utils/organizerPdf.ts"
TMP="$(mktemp -d)"

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

TRIP="$APP_DIR/src/components/TripHealthListModal.tsx"
ORG="$APP_DIR/src/components/OrganizerSpace.tsx"
OFV="$APP_DIR/src/components/CerfaOfficialView.tsx"
PDF="$APP_DIR/src/utils/pdfGenerator.ts"

grep -q "draft-watermark-20261001" "$OFV" || { echo "ERREUR : le correctif « brouillon » (patch-brouillon) n'est pas installe : appliquez-le d'abord."; exit 1; }
grep -q "generateCerfaPdf" "$PDF" || { echo "ERREUR : le generateur de PDF vectoriel (patch-pdf-archive) n'est pas installe : appliquez-le d'abord."; exit 1; }

m=0
grep -q "generateTripHealthListPdf" "$TRIP" && m=$((m+1))
grep -q "generateOrganizerReportPdf" "$ORG" && m=$((m+1))
grep -q "generateCerfaPdf(student, trips" "$OFV" && m=$((m+1))
grep -q "pdf-organisateurs-20261006" "$PDF" && m=$((m+1))
for f in $NEWFILES; do [ -f "$APP_DIR/$f" ] && m=$((m+1)); done
if [ "$m" -eq 5 ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
elif [ "$m" -gt 0 ]; then
  echo "ERREUR : etat partiel detecte ($m/5 elements deja en place)."
  echo "Restaurez d'abord les fichiers d'origine depuis un backup-avant-* puis relancez ce script."
  exit 1
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

# --- 2. Generateur de PDF pour les organisateurs ---------------------------------
echo ">>> Creation de src/utils/organizerPdf.ts ..."
cat > "$APP_DIR/src/utils/organizerPdf.ts" << 'PDORGEOF_X'
import { jsPDF } from 'jspdf';
import { Student, Trip } from '../types';
import { formatDateFr } from './cerfaValidation';
import { getStoredEstablishmentName } from './storage';

console.log('[fichesanitaire] build pdf-organisateurs-20261006');

// ============================================================================
// VRAIS PDF pour les organisateurs (texte vectoriel, sélectionnable, imprimable) : plus de copie d'écran.
//  - Liste d'émargement & suivi sanitaire du séjour (TripHealthListModal)
//  - Relevé sanitaire du séjour (espace organisateur)
// Tableau paginé : en-tête de colonnes répété à chaque page, lignes jamais coupées, pied de page numéroté.
// ============================================================================

type RGB = [number, number, number];
interface TextLine {
  text: string;
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: RGB;
}
interface Cell {
  lines?: TextLine[];
  pill?: { text: string; fill: RGB; fg: RGB };
  box?: boolean;
  align?: 'left' | 'center';
}
interface Column {
  label: string;
  w: number;
  align?: 'left' | 'center';
}
type TableRow = { group: string; count?: number } | { cells: Cell[]; fill?: RGB };

const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 8;
const FOOTER_H = 9;
const MM_PT = 0.3528;
const lineH = (pt: number) => pt * MM_PT * 1.22;
const PAD_X = 1.8;
const PAD_Y = 1.7;

const INK: RGB = [30, 41, 59];
const GRAY: RGB = [100, 116, 139];
const RED: RGB = [153, 27, 27];
const BLUE: RGB = [30, 58, 138];

const setFill = (doc: jsPDF, c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
const setDraw = (doc: jsPDF, c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
const setInk = (doc: jsPDF, c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
const fontOf = (l: TextLine): 'normal' | 'bold' | 'italic' | 'bolditalic' =>
  l.bold && l.italic ? 'bolditalic' : l.bold ? 'bold' : l.italic ? 'italic' : 'normal';

const safeName = (v: string) => String(v || '').replace(/[^a-zA-Z0-9_-]/g, '_');

// ----------------------------------------------------------------------------------------------
// Moteur de tableau
// ----------------------------------------------------------------------------------------------
function wrapped(doc: jsPDF, cell: Cell, colW: number): { text: string; line: TextLine }[][] {
  // retourne, pour chaque ligne logique, ses lignes visuelles
  return (cell.lines || []).map((l) => {
    doc.setFont('helvetica', fontOf(l));
    doc.setFontSize(l.size || 8);
    const parts = doc.splitTextToSize(String(l.text || ''), Math.max(6, colW - PAD_X * 2)) as string[];
    return parts.map((t) => ({ text: t, line: l }));
  });
}

function cellHeight(doc: jsPDF, cell: Cell, colW: number): number {
  let h = PAD_Y * 2;
  if (cell.pill) h += 6;
  if (cell.box) h += 6;
  wrapped(doc, cell, colW).forEach((vis) => vis.forEach((v) => (h += lineH(v.line.size || 8))));
  return Math.max(h, PAD_Y * 2 + 3);
}

function drawHeaderRow(doc: jsPDF, columns: Column[], y: number): number {
  const h = 7;
  setFill(doc, INK);
  doc.rect(MARGIN, y, PAGE_W - MARGIN * 2, h, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(255, 255, 255);
  let x = MARGIN;
  columns.forEach((c) => {
    if (c.align === 'center') doc.text(c.label.toUpperCase(), x + c.w / 2, y + 4.7, { align: 'center' });
    else doc.text(c.label.toUpperCase(), x + PAD_X, y + 4.7);
    x += c.w;
  });
  return y + h;
}

function drawTable(
  doc: jsPDF,
  columns: Column[],
  rows: TableRow[],
  startY: number,
  pageHeader: () => number
): void {
  const bottom = PAGE_H - FOOTER_H - 2;
  let y = drawHeaderRow(doc, columns, startY);
  let zebra = 0;

  const newPage = () => {
    doc.addPage();
    y = drawHeaderRow(doc, columns, pageHeader());
  };

  rows.forEach((row, idx) => {
    if ('group' in row) {
      const h = 7;
      // un titre de classe n'est jamais seul en bas de page : il faut la place d'une ligne en plus
      if (y + h + 16 > bottom) newPage();
      setFill(doc, [219, 234, 254]);
      setDraw(doc, [147, 197, 253]);
      doc.setLineWidth(0.25);
      doc.rect(MARGIN, y, PAGE_W - MARGIN * 2, h, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      setInk(doc, BLUE);
      doc.text(row.group, MARGIN + 3, y + 4.8);
      if (row.count !== undefined) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.text(`${row.count} élève${row.count > 1 ? 's' : ''}`, PAGE_W - MARGIN - 3, y + 4.8, { align: 'right' });
      }
      y += h;
      zebra = 0;
      return;
    }

    let h = 0;
    row.cells.forEach((c, i) => {
      h = Math.max(h, cellHeight(doc, c, columns[i].w));
    });
    if (y + h > bottom) newPage();

    const bg: RGB = row.fill || (zebra % 2 === 0 ? [255, 255, 255] : [248, 250, 252]);
    zebra += 1;
    setFill(doc, bg);
    setDraw(doc, [203, 213, 225]);
    doc.setLineWidth(0.2);
    doc.rect(MARGIN, y, PAGE_W - MARGIN * 2, h, 'FD');

    let x = MARGIN;
    row.cells.forEach((c, i) => {
      const col = columns[i];
      // séparateur de colonnes
      if (i > 0) {
        setDraw(doc, [226, 232, 240]);
        doc.line(x, y, x, y + h);
      }
      let cy = y + PAD_Y;
      const center = (c.align || col.align) === 'center';
      const tx = center ? x + col.w / 2 : x + PAD_X;
      if (c.pill) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        const pw = doc.getTextWidth(c.pill.text) + 5;
        setFill(doc, c.pill.fill);
        doc.roundedRect(x + col.w / 2 - pw / 2, cy, pw, 5, 1.2, 1.2, 'F');
        doc.setTextColor(c.pill.fg[0], c.pill.fg[1], c.pill.fg[2]);
        doc.text(c.pill.text, x + col.w / 2, cy + 3.6, { align: 'center' });
        cy += 6;
      }
      if (c.box) {
        setDraw(doc, [71, 85, 105]);
        doc.setLineWidth(0.35);
        doc.rect(x + col.w / 2 - 3, y + h / 2 - 3, 6, 6, 'S');
        doc.setLineWidth(0.2);
      }
      wrapped(doc, c, col.w).forEach((vis) => {
        vis.forEach((v) => {
          const sz = v.line.size || 8;
          doc.setFont('helvetica', fontOf(v.line));
          doc.setFontSize(sz);
          setInk(doc, v.line.color || INK);
          cy += lineH(sz);
          doc.text(v.text, tx, cy - lineH(sz) * 0.22, center ? { align: 'center' } : undefined);
        });
      });
      x += col.w;
    });
    y += h;
    void idx;
  });
}

function drawFooters(doc: jsPDF, label: string): void {
  const n = doc.getNumberOfPages();
  const stamp = new Date();
  const when = `${stamp.toLocaleDateString('fr-FR')} à ${stamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    setDraw(doc, [203, 213, 225]);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, PAGE_H - FOOTER_H, PAGE_W - MARGIN, PAGE_H - FOOTER_H);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(120, 130, 145);
    doc.text(`${label} — Document confidentiel : données de santé réservées à l'encadrement du séjour`, MARGIN, PAGE_H - FOOTER_H + 4);
    doc.text(`Édité le ${when} — page ${p}/${n}`, PAGE_W - MARGIN, PAGE_H - FOOTER_H + 4, { align: 'right' });
  }
}

function drawChips(doc: jsPDF, y: number, chips: { label: string; value: string; tone?: 'red' | 'green' | 'amber' | 'blue' }[]): number {
  const gap = 3;
  const w = (PAGE_W - MARGIN * 2 - gap * (chips.length - 1)) / chips.length;
  const tones: Record<string, { fill: RGB; border: RGB; ink: RGB }> = {
    blue: { fill: [239, 246, 255], border: [147, 197, 253], ink: [30, 58, 138] },
    green: { fill: [236, 253, 245], border: [110, 231, 183], ink: [6, 95, 70] },
    amber: { fill: [255, 251, 235], border: [252, 211, 77], ink: [146, 64, 14] },
    red: { fill: [254, 242, 242], border: [252, 165, 165], ink: [153, 27, 27] },
  };
  chips.forEach((c, i) => {
    const t = tones[c.tone || 'blue'];
    const x = MARGIN + i * (w + gap);
    setFill(doc, t.fill);
    setDraw(doc, t.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, 12, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    setInk(doc, GRAY);
    doc.text(c.label.toUpperCase(), x + 3, y + 4.2);
    doc.setFontSize(13);
    setInk(doc, t.ink);
    doc.text(c.value, x + 3, y + 10);
  });
  return y + 15;
}

// ----------------------------------------------------------------------------------------------
// Outils communs sur les élèves
// ----------------------------------------------------------------------------------------------
const dietInfo = (s: Student) => {
  const cat = s.cerfa.structuredDiet?.category;
  const details = String(s.cerfa.structuredDiet?.details || '').trim();
  let label = 'Sans restriction';
  if (cat === 'sans_porc') label = 'Sans porc';
  else if (cat === 'sans_viande') label = 'Sans viande';
  else if (cat === 'vegetarien') label = 'Végétarien';
  else if (cat === 'allergie_alimentaire') label = 'Allergie alimentaire';
  return { label, details, special: label !== 'Sans restriction' };
};

const allergyInfo = (s: Student) => {
  const med: any = s.cerfa.medicalInfo || {};
  const al: any = med.allergies || {};
  const items: string[] = [];
  if (al.alimentaires) items.push('Alimentaire');
  if (al.asthme) items.push('Asthme');
  if (al.medicamenteuses) items.push('Médicaments');
  if (String(al.autres || '').trim()) items.push(String(al.autres).trim());
  return {
    has: items.length > 0,
    summary: items.join(', '),
    conduite: String(med.allergyCauseAndAction || '').trim(),
    treatment: Boolean(med.hasMedicalTreatment),
    treatmentDetails: String(med.treatmentDetails || '').trim(),
    pai: Boolean(med.hasPai),
    paiDetails: String(med.paiDetails || '').trim(),
  };
};

const fullName = (s: Student) => `${(s.cerfa.identity?.lastName || '').toUpperCase()} ${s.cerfa.identity?.firstName || ''}`.trim();
const byName = (a: Student, b: Student) =>
  `${a.cerfa.identity?.lastName} ${a.cerfa.identity?.firstName}`.toLowerCase().localeCompare(`${b.cerfa.identity?.lastName} ${b.cerfa.identity?.firstName}`.toLowerCase(), 'fr');

// ----------------------------------------------------------------------------------------------
// 1. Liste d'émargement & suivi sanitaire du séjour
// ----------------------------------------------------------------------------------------------
export interface TripHealthListPdfOptions {
  sortMode: 'alpha' | 'class';
  filtersLabel?: string;
  establishmentName?: string;
  filename?: string;
}

export async function generateTripHealthListPdf(trip: Trip, students: Student[], opts: TripHealthListPdfOptions): Promise<boolean> {
  try {
    const establishment = (opts.establishmentName || getStoredEstablishmentName() || '').trim();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const list = [...students];
    if (opts.sortMode === 'class') list.sort((a, b) => a.schoolClass.localeCompare(b.schoolClass, 'fr') || byName(a, b));
    else list.sort(byName);

    const paiCount = list.filter((s) => allergyInfo(s).pai).length;
    const allergyCount = list.filter((s) => allergyInfo(s).has).length;
    const dietCount = list.filter((s) => dietInfo(s).special).length;

    const columns: Column[] = [
      { label: 'N°', w: 9, align: 'center' },
      { label: 'Élève (nom & prénom)', w: 54 },
      { label: 'Classe', w: 20, align: 'center' },
      { label: 'Régime alimentaire', w: 46 },
      { label: 'Allergies & soins', w: 66 },
      { label: 'PAI', w: 17, align: 'center' },
      { label: 'Urgence (responsable)', w: 49 },
      { label: 'Émarg.', w: 20, align: 'center' },
    ];

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
        doc.text("LISTE D'ÉMARGEMENT & SUIVI SANITAIRE", MARGIN, y + 9);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        setInk(doc, [51, 65, 85]);
        doc.text(`Voyage : ${trip.name} — ${trip.destination} — du ${formatDateFr(trip.startDate)} au ${formatDateFr(trip.endDate)}`, MARGIN, y + 14.5);
        doc.setFontSize(7.5);
        setInk(doc, GRAY);
        doc.text(
          `Tri : ${opts.sortMode === 'class' ? 'par classe puis par nom' : 'alphabétique'}${opts.filtersLabel ? ' — ' + opts.filtersLabel : ''}`,
          MARGIN,
          y + 19
        );
        y = drawChips(doc, y + 22, [
          { label: 'Effectif', value: String(list.length), tone: 'blue' },
          { label: 'PAI actifs', value: String(paiCount), tone: paiCount ? 'red' : 'green' },
          { label: 'Allergies', value: String(allergyCount), tone: allergyCount ? 'amber' : 'green' },
          { label: 'Régimes particuliers', value: String(dietCount), tone: dietCount ? 'amber' : 'green' },
        ]);
        first = false;
      } else {
        doc.setFontSize(8.5);
        setInk(doc, INK);
        doc.text(`LISTE D'ÉMARGEMENT & SUIVI SANITAIRE — ${trip.name} (suite)`, MARGIN, y + 3);
        y += 7;
      }
      return y;
    };

    const rows: TableRow[] = [];
    const counts: Record<string, number> = {};
    list.forEach((s) => (counts[s.schoolClass] = (counts[s.schoolClass] || 0) + 1));
    let lastClass = '';
    let n = 0;
    list.forEach((s) => {
      if (opts.sortMode === 'class' && s.schoolClass !== lastClass) {
        rows.push({ group: `Classe ${s.schoolClass}`, count: counts[s.schoolClass] });
        lastClass = s.schoolClass;
        n = 0;
      }
      n += 1;
      const d = dietInfo(s);
      const a = allergyInfo(s);
      const g = s.cerfa.legalGuardian || ({} as any);
      const allergyLines: TextLine[] = [];
      if (a.has) {
        allergyLines.push({ text: `ALLERGIE : ${a.summary}`, bold: true, size: 8.5, color: RED });
        if (a.conduite) allergyLines.push({ text: a.conduite, size: 7.5, color: [127, 29, 29] });
      }
      if (a.treatment) allergyLines.push({ text: `Traitement : ${a.treatmentDetails || 'oui (voir la fiche)'}`, bold: true, size: 8, color: [146, 64, 14] });
      if (!allergyLines.length) allergyLines.push({ text: 'Néant', size: 8, color: GRAY });
      const paiDoc = (s.cerfa.documents || []).some((x) => x.type === 'pai');
      rows.push({
        fill: a.pai ? [255, 245, 245] : undefined,
        cells: [
          { lines: [{ text: String(n), size: 8, color: GRAY }], align: 'center' },
          {
            lines: [
              { text: fullName(s), bold: true, size: 9 },
              { text: `Né(e) le ${s.cerfa.identity?.birthDate ? formatDateFr(s.cerfa.identity.birthDate) : '—'}${s.cerfa.identity?.gender ? ' (' + s.cerfa.identity.gender + ')' : ''}`, size: 7, color: GRAY },
            ],
          },
          { lines: [{ text: s.schoolClass, bold: true, size: 9 }, { text: s.boardingStatus || '', size: 6.5, color: GRAY }], align: 'center' },
          {
            lines: [
              { text: d.label, bold: d.special, size: 8.5, color: d.special ? BLUE : INK },
              ...(d.details ? [{ text: d.details, italic: true, size: 7.5, color: GRAY } as TextLine] : []),
            ],
          },
          { lines: allergyLines },
          a.pai
            ? { pill: { text: 'OUI', fill: [185, 28, 28], fg: [255, 255, 255] }, lines: paiDoc ? [{ text: 'PAI joint', size: 6.5, color: RED }] : [], align: 'center' }
            : { lines: [{ text: '—', size: 9, color: GRAY }], align: 'center' },
          {
            lines: [
              { text: g.fullName || '—', bold: true, size: 8.5 },
              { text: g.mobilePhone || g.homePhone || 'Non renseigné', bold: true, size: 8.5, color: [22, 101, 52] },
            ],
          },
          { box: true, align: 'center' },
        ],
      });
    });
    if (!rows.length) rows.push({ cells: [{}, { lines: [{ text: 'Aucun élève ne correspond aux filtres choisis.', italic: true, size: 9, color: GRAY }] }, {}, {}, {}, {}, {}, {}] });

    drawTable(doc, columns, rows, pageHeader(), pageHeader);
    drawFooters(doc, `${establishment} — ${trip.name}`);

    const filename = opts.filename || `Liste_Sanitaire_${safeName(trip.name)}_${opts.sortMode === 'class' ? 'ParClasses' : 'Alpha'}.pdf`;
    doc.save(filename);
    return true;
  } catch (error) {
    console.error('Erreur lors de la génération du PDF (liste sanitaire) :', error);
    return false;
  }
}

// ----------------------------------------------------------------------------------------------
// 2. Relevé sanitaire du séjour (espace organisateur)
// ----------------------------------------------------------------------------------------------
export interface OrganizerReportPdfOptions {
  groupByClass: boolean;
  filtersText: string;
  stats: { totalEnrolled: number; completeCount: number; incompleteCount: number; dpCount: number; allergyAlertCount: number };
  shown: number;
  establishmentName?: string;
  filename?: string;
}

export async function generateOrganizerReportPdf(trip: Trip, students: Student[], opts: OrganizerReportPdfOptions): Promise<boolean> {
  try {
    const establishment = (opts.establishmentName || getStoredEstablishmentName() || '').trim();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    const list = [...students];
    if (opts.groupByClass) list.sort((a, b) => a.schoolClass.localeCompare(b.schoolClass, 'fr') || byName(a, b));
    else list.sort(byName);

    const columns: Column[] = [
      { label: 'Nom', w: 40 },
      { label: 'Prénom', w: 36 },
      { label: 'Classe', w: 18, align: 'center' },
      { label: 'Pension', w: 24, align: 'center' },
      { label: 'Régime alimentaire', w: 56 },
      { label: 'Fiche sanitaire', w: 38, align: 'center' },
      { label: 'Alertes / PAI', w: 69 },
    ];

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
        doc.text(`RELEVÉ SANITAIRE DU SÉJOUR — ${trip.name}`, MARGIN, y + 9);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        setInk(doc, [51, 65, 85]);
        doc.text(`Destination : ${trip.destination} — du ${formatDateFr(trip.startDate)} au ${formatDateFr(trip.endDate)}`, MARGIN, y + 14.5);
        doc.setFontSize(7.5);
        setInk(doc, GRAY);
        doc.text(opts.filtersText, MARGIN, y + 19);
        y = drawChips(doc, y + 22, [
          { label: 'Élèves inscrits', value: `${opts.stats.totalEnrolled}${trip.maxStudents ? ' / ' + trip.maxStudents : ''}`, tone: 'blue' },
          { label: 'Fiches complètes', value: String(opts.stats.completeCount), tone: 'green' },
          { label: 'Fiches incomplètes', value: String(opts.stats.incompleteCount), tone: opts.stats.incompleteCount ? 'amber' : 'green' },
          { label: 'Demi-pensionnaires', value: String(opts.stats.dpCount), tone: 'blue' },
          { label: 'Alertes santé', value: String(opts.stats.allergyAlertCount), tone: opts.stats.allergyAlertCount ? 'red' : 'green' },
        ]);
        first = false;
      } else {
        doc.setFontSize(8.5);
        setInk(doc, INK);
        doc.text(`RELEVÉ SANITAIRE DU SÉJOUR — ${trip.name} (suite)`, MARGIN, y + 3);
        y += 7;
      }
      return y;
    };

    const rows: TableRow[] = [];
    const counts: Record<string, number> = {};
    list.forEach((s) => (counts[s.schoolClass] = (counts[s.schoolClass] || 0) + 1));
    let lastClass = '';
    list.forEach((s) => {
      if (opts.groupByClass && s.schoolClass !== lastClass) {
        rows.push({ group: `Classe ${s.schoolClass}`, count: counts[s.schoolClass] });
        lastClass = s.schoolClass;
      }
      const d = dietInfo(s);
      const a = allergyInfo(s);
      const alerts: TextLine[] = [];
      if (a.pai) alerts.push({ text: 'PAI — protocole actif', bold: true, size: 8.5, color: RED });
      if (a.has) alerts.push({ text: `Allergie : ${a.summary}`, bold: true, size: 8, color: [146, 64, 14] });
      if (a.treatment) alerts.push({ text: 'Traitement médical en cours', bold: true, size: 8, color: [146, 64, 14] });
      if (!alerts.length) alerts.push({ text: 'Néant', size: 8, color: GRAY });
      rows.push({
        fill: a.pai ? [255, 245, 245] : undefined,
        cells: [
          { lines: [{ text: (s.cerfa.identity?.lastName || '').toUpperCase(), bold: true, size: 9 }] },
          { lines: [{ text: s.cerfa.identity?.firstName || '', size: 9 }] },
          { lines: [{ text: s.schoolClass, bold: true, size: 9 }], align: 'center' },
          { lines: [{ text: s.boardingStatus || '—', size: 8.5 }], align: 'center' },
          {
            lines: [
              { text: d.label, bold: d.special, size: 8.5, color: d.special ? BLUE : INK },
              ...(d.details ? [{ text: d.details, italic: true, size: 7.5, color: GRAY } as TextLine] : []),
            ],
          },
          {
            lines:
              s.status === 'complete'
                ? [{ text: 'Complète', bold: true, size: 8.5, color: [6, 95, 70] }]
                : [{ text: `Incomplète (${s.completenessPercent ?? 0} %)`, bold: true, size: 8.5, color: [146, 64, 14] }],
            align: 'center',
          },
          { lines: alerts },
        ],
      });
    });
    if (!rows.length) rows.push({ cells: [{ lines: [{ text: 'Aucun élève ne correspond aux filtres choisis.', italic: true, size: 9, color: GRAY }] }, {}, {}, {}, {}, {}, {}] });

    drawTable(doc, columns, rows, pageHeader(), pageHeader);
    drawFooters(doc, `${establishment} — ${trip.name}`);

    const filename = opts.filename || `Releve_Sanitaire_${safeName(trip.name)}.pdf`;
    doc.save(filename);
    return true;
  } catch (error) {
    console.error('Erreur lors de la génération du PDF (relevé sanitaire) :', error);
    return false;
  }
}
PDORGEOF_X

# --- 3. Modifications ---------------------------------------------------------
echo ">>> Modification des fichiers ..."
cat > "$TMP/e1_old.txt" << 'PDORGEOF_X'
import { exportToPdf } from '../utils/pdfGenerator';
PDORGEOF_X
cat > "$TMP/e1_new.txt" << 'PDORGEOF_X'
import { exportToPdf } from '../utils/pdfGenerator';
import { generateTripHealthListPdf } from '../utils/organizerPdf';
PDORGEOF_X
replace_once "$TRIP" "$(cat "$TMP/e1_old.txt")" "$(cat "$TMP/e1_new.txt")"

cat > "$TMP/e2_old.txt" << 'PDORGEOF_X'
      await exportToPdf(tableRef.current, {
        filename,
        orientation: 'landscape',
        marginMm: 6,
      });
PDORGEOF_X
cat > "$TMP/e2_new.txt" << 'PDORGEOF_X'
      // VRAI PDF vectoriel (texte sélectionnable, pagination, en-têtes répétés) - build pdf-organisateurs-20261006
      const ok = await generateTripHealthListPdf(trip, sortedStudents, {
        sortMode,
        filename,
        filtersLabel:
          [
            filterClass !== 'all' ? `classe ${filterClass}` : '',
            filterPaiOnly ? 'PAI uniquement' : '',
            filterAllergiesOnly ? 'allergies uniquement' : '',
          ]
            .filter(Boolean)
            .join(', ') || undefined,
      });
      if (!ok) window.print();
PDORGEOF_X
replace_once "$TRIP" "$(cat "$TMP/e2_old.txt")" "$(cat "$TMP/e2_new.txt")"

cat > "$TMP/e3_old.txt" << 'PDORGEOF_X'
import { exportToPdf } from '../utils/pdfGenerator';
PDORGEOF_X
cat > "$TMP/e3_new.txt" << 'PDORGEOF_X'
import { exportToPdf } from '../utils/pdfGenerator';
import { generateOrganizerReportPdf } from '../utils/organizerPdf';
PDORGEOF_X
replace_once "$ORG" "$(cat "$TMP/e3_old.txt")" "$(cat "$TMP/e3_new.txt")"

cat > "$TMP/e4_old.txt" << 'PDORGEOF_X'
      await exportToPdf(reportRef.current, {
        filename: `Releve_Sanitaire_${sanitizedTripName}.pdf`,
        orientation: 'landscape',
        marginMm: 8,
      });
PDORGEOF_X
cat > "$TMP/e4_new.txt" << 'PDORGEOF_X'
      // VRAI PDF vectoriel (texte sélectionnable, pagination, en-têtes répétés) - build pdf-organisateurs-20261006
      const ok = await generateOrganizerReportPdf(currentTrip, filteredStudents, {
        filename: `Releve_Sanitaire_${sanitizedTripName}.pdf`,
        groupByClass: activeFilterView === 'class',
        filtersText: `Filtres actifs : ${kpiFilter !== 'all' ? `KPI: ${kpiFilter.toUpperCase()}` : 'Tous'} • Classe : ${selectedClassFilter} • Régime : ${selectedDietFilter} • Élèves affichés : ${filteredStudents.length}/${totalEnrolled}`,
        shown: filteredStudents.length,
        stats: { totalEnrolled, completeCount, incompleteCount, dpCount, allergyAlertCount },
      });
      if (!ok) window.print();
PDORGEOF_X
replace_once "$ORG" "$(cat "$TMP/e4_old.txt")" "$(cat "$TMP/e4_new.txt")"

cat > "$TMP/e5_old.txt" << 'PDORGEOF_X'
import { exportSinglePagePdf } from '../utils/pdfGenerator';
PDORGEOF_X
cat > "$TMP/e5_new.txt" << 'PDORGEOF_X'
import { exportSinglePagePdf, generateCerfaPdf } from '../utils/pdfGenerator';
PDORGEOF_X
replace_once "$OFV" "$(cat "$TMP/e5_old.txt")" "$(cat "$TMP/e5_new.txt")"

cat > "$TMP/e6_old.txt" << 'PDORGEOF_X'
      const ok = await exportSinglePagePdf(documentRef.current, {
        filename: `${isDraft ? 'BROUILLON_' : ''}CERFA_Fiche_Sanitaire_${sanitizedName}.pdf`,
        orientation: 'portrait',
        marginMm: 4,
      });
PDORGEOF_X
cat > "$TMP/e6_new.txt" << 'PDORGEOF_X'
      // VRAI PDF vectoriel (texte sélectionnable) au lieu d'une copie d'écran - build pdf-organisateurs-20261006
      void sanitizedName;
      const ok = await generateCerfaPdf(student, trips, establishmentName, false);
PDORGEOF_X
replace_once "$OFV" "$(cat "$TMP/e6_old.txt")" "$(cat "$TMP/e6_new.txt")"

cat > "$TMP/e7_old.txt" << 'PDORGEOF_X'
import { formatDateFr } from './cerfaValidation';
PDORGEOF_X
cat > "$TMP/e7_new.txt" << 'PDORGEOF_X'
import { formatDateFr, computeCerfaCompleteness } from './cerfaValidation';
PDORGEOF_X
replace_once "$PDF" "$(cat "$TMP/e7_old.txt")" "$(cat "$TMP/e7_new.txt")"

cat > "$TMP/e8_old.txt" << 'PDORGEOF_X'
    drawSectionTitle('RUBRIQUE 1 — RENSEIGNEMENTS SUR L ENFANT');
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, y, contentWidth, 13, 'FD');
PDORGEOF_X
cat > "$TMP/e8_new.txt" << 'PDORGEOF_X'
    drawSectionTitle('RUBRIQUE 1 — RENSEIGNEMENTS SUR L ENFANT');
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, y, contentWidth, 18.5, 'FD');
PDORGEOF_X
replace_once "$PDF" "$(cat "$TMP/e8_old.txt")" "$(cat "$TMP/e8_new.txt")"

cat > "$TMP/e9_old.txt" << 'PDORGEOF_X'
      margin + 170,
      y + 9.5
    );

    y += 15;
PDORGEOF_X
cat > "$TMP/e9_new.txt" << 'PDORGEOF_X'
      margin + 170,
      y + 9.5
    );

    // Row 3 (build pdf-organisateurs-20261006) : téléphone de l'enfant, n° de sécurité sociale, n° d'élève
    doc.setFont('helvetica', 'bold');
    doc.text("Tél. de l'enfant :", margin + 3, y + 14.8);
    doc.setFont('helvetica', 'normal');
    doc.text(cerfa.identity?.childMobilePhone || 'Non renseigné', margin + 28, y + 14.8);
    doc.setFont('helvetica', 'bold');
    doc.text('N° de sécurité sociale :', margin + 70, y + 14.8);
    doc.setFont('helvetica', 'normal');
    doc.text(cerfa.identity?.socialSecurityNumber || 'Non renseigné', margin + 102, y + 14.8);
    doc.setFont('helvetica', 'bold');
    doc.text('N° élève :', margin + 150, y + 14.8);
    doc.setFont('helvetica', 'normal');
    doc.text(student.internalId || '—', margin + 165, y + 14.8);

    y += 20.5;
PDORGEOF_X
replace_once "$PDF" "$(cat "$TMP/e9_old.txt")" "$(cat "$TMP/e9_new.txt")"

cat > "$TMP/e10_old.txt" << 'PDORGEOF_X'
    const filename = `Fiche_Sanitaire_${sanitizedName}.pdf`;
PDORGEOF_X
cat > "$TMP/e10_new.txt" << 'PDORGEOF_X'
    // Fiche NON finalisée : filigrane BROUILLON + bandeau sur chaque page (elle ne peut pas passer pour valable)
    const completenessPdf = computeCerfaCompleteness(cerfa);
    const isDraftPdf = student.status !== 'complete' && !completenessPdf.isComplete;
    if (isDraftPdf) {
      const missing = (completenessPdf.missingFields || []).slice(0, 4).join(' ; ');
      const totalPages = doc.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        try {
          const GState = (doc as any).GState;
          doc.saveGraphicsState();
          if (GState) doc.setGState(new GState({ opacity: 0.13 }));
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(185, 28, 28);
          doc.setFontSize(58);
          doc.text('BROUILLON', 105, 150, { align: 'center', angle: 35 });
          doc.setFontSize(20);
          doc.text('NON SIGNÉE - NON VALABLE', 105, 168, { align: 'center', angle: 35 });
          doc.restoreGraphicsState();
        } catch {
          /* le filigrane est facultatif : le bandeau ci-dessous suffit */
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(185, 28, 28);
        const bandeau = doc.splitTextToSize(`FICHE NON FINALISÉE — NON VALABLE${missing ? ' : il manque ' + missing : ''}`, contentWidth).slice(0, 2) as string[];
        doc.text(bandeau, margin, 287 - (bandeau.length - 1) * 3.2);
      }
    }
    const filename = `${isDraftPdf ? 'BROUILLON_' : ''}Fiche_Sanitaire_${sanitizedName}.pdf`;
PDORGEOF_X
replace_once "$PDF" "$(cat "$TMP/e10_old.txt")" "$(cat "$TMP/e10_new.txt")"

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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/src $APP_DIR/ && rm -f $APP_DIR/src/utils/organizerPdf.ts"
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
 - Espace organisateur > "Telecharger PDF" (releve sanitaire) et fenetre "liste sanitaire" :
   vrais PDF vectoriels (texte selectionnable, pagination).
 - Fiche sanitaire > "Telecharger PDF" : PDF vectoriel (brouillon filigrane si non finalisee).
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Console navigateur : "[fichesanitaire] build pdf-organisateurs-20261006"
============================================================
MSG
