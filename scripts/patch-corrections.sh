#!/bin/bash
# ============================================================================
# patch-corrections.sh  -  build audit-fixes-20261006
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# CORRECTIFS ISSUS DE L'AUDIT COMPLET DES SCRIPTS (06/10/2026). A appliquer APRES les autres.
# Chaque correction est appliquee seulement si le code concerne est present :
#  PDF DE LA FICHE (celui des copies archivees ET celui que l'on telecharge)
#   - bloc « Sejours & voyages » : le nom d'un voyage long ecrasait le texte « Destination »
#     (chevauchement) ; seuls 2 voyages sur 3 etaient imprimes ; le symbole avion n'existe pas dans
#     la police du PDF (caractere parasite) -> chaque voyage sur deux lignes, TOUS les voyages
#     (jusqu'a 6), saut de page si besoin ;
#   - symbole « coche » de la zone de signature (caractere parasite) retire ;
#   - tout symbole que la police du PDF ne sait pas ecrire (emoji, fleches, caracteres chinois ou
#     arabes saisis dans un champ libre) devient « ? » au lieu d'un caractere illisible ;
#   - un « mot » tres long sans espace (adresse, lien) passe a la ligne au lieu de deborder.
#  PDF ORGANISATEURS (liste sanitaire, releve) : memes protections ; une cellule demesuree
#   (texte libre de plus de 40 lignes) est arretee avec « suite : voir la fiche sanitaire » au lieu
#   d'etre coupee en bas de page sans prevenir.
#  ONGLET RGPD DES PARENTS : formulation corrigee. Le texte affirmait qu'un parent « ne voit
#   jamais » les enfants d'une autre famille ; or l'API du serveur n'est pas protegee (ecart connu,
#   fiche RGPD section 9). Il dit desormais ce que fait l'interface : « le portail n'affiche a une
#   famille que ses propres enfants et ses propres messages ».
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-corrections.sh && /root/patch-corrections.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="audit-fixes-20261006"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
TMP="$(mktemp -d)"

PDF="$APP_DIR/src/utils/pdfGenerator.ts"
ORG="$APP_DIR/src/utils/organizerPdf.ts"
RGPD="$APP_DIR/src/components/RgpdPanel.tsx"
SAFE="$APP_DIR/src/utils/pdfSafe.ts"
FILES=""
for f in src/utils/pdfGenerator.ts src/utils/organizerPdf.ts src/components/RgpdPanel.tsx; do
  [ -f "$APP_DIR/$f" ] && FILES="$FILES $f"
done
NEWFILES="src/utils/pdfSafe.ts"

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
[ -f "$PDF" ] || { echo "ERREUR : $PDF introuvable (le generateur de PDF vectoriel, patch-pdf-archive, n'est pas installe)."; exit 1; }
command -v perl >/dev/null || { echo "ERREUR : perl est requis (apt install -y perl)."; exit 1; }

if [ -f "$SAFE" ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
fi

# --- Fonctions utilitaires -------------------------------------------------
count_occ() { OLD="$2" perl -0777 -ne 'my $c = () = /\Q$ENV{OLD}\E/g; print $c' "$1"; }

# Remplace UNE occurrence ; si le code attendu est absent (autre version, correctif non installe), ignore sans erreur
try_replace() { # fichier ancien nouveau etiquette [prerequis]
  local file="$1" old="$2" new="$3" label="$4" req="$5" n
  if [ -n "$req" ] && ! grep -q "$req" "$file"; then
    echo "   - ignore ($label) : pre-requis absent (patch-pdf-sante)"
    return 0
  fi
  n="$(count_occ "$file" "$old")"
  if [ "$n" = "0" ]; then echo "   - ignore ($label) : code attendu absent"; return 0; fi
  [ "$n" = "1" ] || { echo "ERREUR : repere trouve $n fois dans $file ($label)"; exit 1; }
  OLD="$old" NEW="$new" perl -0777 -i -pe 's/\Q$ENV{OLD}\E/$ENV{NEW}/' "$file"
  echo "   + corrige : $label"
}

# --- 1. Sauvegarde ----------------------------------------------------------
echo ">>> Sauvegarde dans $BACKUP_DIR ..."
for f in $FILES; do
  mkdir -p "$BACKUP_DIR/$(dirname "$f")"
  cp -p "$APP_DIR/$f" "$BACKUP_DIR/$f"
done
PATCHING=1

# --- 2. Aides communes aux PDF --------------------------------------------------
echo ">>> Creation de src/utils/pdfSafe.ts ..."
cat > "$SAFE" << 'PDSAFEEOF_X'
console.log('[fichesanitaire] build audit-fixes-20261006');

// Aides communes aux PDF vectoriels. Les polices standard de jsPDF n'écrivent que le jeu de caractères WinAnsi
// (lettres accentuées latines, ponctuation courante). Tout autre symbole (émoji, flèches, caractères chinois ou
// arabes saisis dans un champ libre) sortait en caractères parasites : il devient « ? ». Les « mots » très longs
// sans espace (adresse, lien) passent à la ligne au lieu de déborder sur la colonne voisine.
const OUTSIDE_WINANSI =
  /[^\n\u0020-\u007E\u00A0-\u00FF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/g;

export function pdfSafeText(value: unknown): string {
  return String(value === null || value === undefined ? '' : value)
    .normalize('NFC')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[\u200B-\u200F\u2060\uFE0E\uFE0F]/g, '')
    .replace(OUTSIDE_WINANSI, '?');
}

export function breakLongWords(value: string, max = 36): string {
  return value.replace(new RegExp('(\\S{' + max + '})(?=\\S)', 'g'), '$1 ');
}

// À appeler une fois après `new jsPDF(...)` : toutes les écritures de texte passent par le filtre
export function installPdfSafety(doc: any): void {
  const rawText = doc.text.bind(doc);
  doc.text = (text: any, ...rest: any[]) => rawText(Array.isArray(text) ? text.map(pdfSafeText) : pdfSafeText(text), ...rest);
  const rawSplit = doc.splitTextToSize.bind(doc);
  doc.splitTextToSize = (text: any, ...rest: any[]) =>
    rawSplit(Array.isArray(text) ? text.map((t: any) => breakLongWords(pdfSafeText(t))) : breakLongWords(pdfSafeText(text)), ...rest);
}
PDSAFEEOF_X

# --- 3. PDF de la fiche -----------------------------------------------------------
echo ">>> Correction de src/utils/pdfGenerator.ts ..."
# --- sécurité des caractères (import)
cat > "$TMP/p1_old.txt" << 'PDSAFEEOF_X'
import { jsPDF } from 'jspdf';
PDSAFEEOF_X
cat > "$TMP/p1_new.txt" << 'PDSAFEEOF_X'
import { jsPDF } from 'jspdf';
import { installPdfSafety } from './pdfSafe';
PDSAFEEOF_X
try_replace "$PDF" "$(cat "$TMP/p1_old.txt")" "$(cat "$TMP/p1_new.txt")" "sécurité des caractères (import)" ""
# --- sécurité des caractères (fiche)
cat > "$TMP/p2_old.txt" << 'PDSAFEEOF_X'
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const enrolledTrips
PDSAFEEOF_X
cat > "$TMP/p2_new.txt" << 'PDSAFEEOF_X'
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    installPdfSafety(doc); // build audit-fixes-20261006 : symboles non pris en charge, mots trop longs

    const enrolledTrips
PDSAFEEOF_X
try_replace "$PDF" "$(cat "$TMP/p2_old.txt")" "$(cat "$TMP/p2_new.txt")" "sécurité des caractères (fiche)" ""
# --- symbole ✓ de la signature
cat > "$TMP/p3_old.txt" << 'PDSAFEEOF_X'
'✓ Signé électroniquement'
PDSAFEEOF_X
cat > "$TMP/p3_new.txt" << 'PDSAFEEOF_X'
'Signé électroniquement'
PDSAFEEOF_X
try_replace "$PDF" "$(cat "$TMP/p3_old.txt")" "$(cat "$TMP/p3_new.txt")" "symbole ✓ de la signature" ""
# --- bloc des voyages (tous les voyages, sans chevauchement)
cat > "$TMP/p4_old.txt" << 'PDSAFEEOF_X'
    // --- VOYAGES SCOLAIRES ASSOCIES (if enrolled) ---
    if (enrolledTrips.length > 0) {
      drawSectionTitle('SÉJOURS & VOYAGES SCOLAIRES ASSOCIÉS');
      doc.setFillColor(240, 249, 255);
      doc.setDrawColor(186, 230, 253);
      const tripBoxHeight = Math.min(enrolledTrips.length * 5.5 + 2, 13);
      doc.rect(margin, y, contentWidth, tripBoxHeight, 'FD');

      enrolledTrips.slice(0, 2).forEach((trip, idx) => {
        const tripY = y + idx * 5.5 + 3.8;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.8);
        doc.setTextColor(3, 105, 161);
        doc.text(`✈ ${trip.name}`, margin + 3, tripY);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(70, 70, 70);
        doc.text(
          `Destination : ${trip.destination} | Du ${formatDateFr(trip.startDate)} au ${formatDateFr(trip.endDate)} | Org : ${trip.organizerName}`,
          margin + 45,
          tripY
        );
      });
      y += tripBoxHeight + 2;
    }


PDSAFEEOF_X
cat > "$TMP/p4_new.txt" << 'PDSAFEEOF_X'
    // --- VOYAGES SCOLAIRES ASSOCIES (if enrolled) --- (build audit-fixes-20261006 : tous les voyages, sans chevauchement)
    if (enrolledTrips.length > 0) {
      drawSectionTitle('SÉJOURS & VOYAGES SCOLAIRES ASSOCIÉS');
      const shownTrips = enrolledTrips.slice(0, 6);
      const tripBlocks = shownTrips.map((trip) => {
        const detail = `Destination : ${trip.destination} | Du ${formatDateFr(trip.startDate)} au ${formatDateFr(trip.endDate)}${
          trip.organizerName ? ' | Organisateur : ' + trip.organizerName : ''
        }`;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        const lines = doc.splitTextToSize(detail, contentWidth - 8) as string[];
        return { trip, lines };
      });
      const more = enrolledTrips.length - shownTrips.length;
      const tripBoxHeight = tripBlocks.reduce((h, b) => h + 4.6 + b.lines.length * 3.1 + 1, 2) + (more > 0 ? 4 : 0);
      ensureSpace(tripBoxHeight + 2);
      doc.setFillColor(240, 249, 255);
      doc.setDrawColor(186, 230, 253);
      doc.rect(margin, y, contentWidth, tripBoxHeight, 'FD');
      let ty = y + 2;
      tripBlocks.forEach((b) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.6);
        doc.setTextColor(3, 105, 161);
        doc.text(String(b.trip.name || ''), margin + 3, ty + 3.2);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.setTextColor(70, 70, 70);
        doc.text(b.lines, margin + 3, ty + 6.6);
        ty += 4.6 + b.lines.length * 3.1 + 1;
      });
      if (more > 0) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(6.5);
        doc.setTextColor(90, 90, 90);
        doc.text(`... et ${more} autre${more > 1 ? 's' : ''} voyage${more > 1 ? 's' : ''}`, margin + 3, ty + 2);
      }
      y += tripBoxHeight + 2;
    }


PDSAFEEOF_X
try_replace "$PDF" "$(cat "$TMP/p4_old.txt")" "$(cat "$TMP/p4_new.txt")" "bloc des voyages (tous les voyages, sans chevauchement)" "const ensureSpace"

# --- 4. PDF des organisateurs (fichier complet, seulement s'il est installe) ------------------
if [ -f "$ORG" ]; then
  echo ">>> Mise a jour de src/utils/organizerPdf.ts ..."
  cat > "$ORG" << 'PDSAFEEOF_X'
import { jsPDF } from 'jspdf';
import { Student, Trip } from '../types';
import { formatDateFr } from './cerfaValidation';
import { getStoredEstablishmentName } from './storage';
import { installPdfSafety } from './pdfSafe';

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
const MAX_CELL_LINES = 40;

function wrapped(doc: jsPDF, cell: Cell, colW: number): { text: string; line: TextLine }[][] {
  // retourne, pour chaque ligne logique, ses lignes visuelles
  const all = (cell.lines || []).map((l) => {
    doc.setFont('helvetica', fontOf(l));
    doc.setFontSize(l.size || 8);
    const parts = doc.splitTextToSize(String(l.text || ''), Math.max(6, colW - PAD_X * 2)) as string[];
    return parts.map((t) => ({ text: t, line: l }));
  });
  // Garde-fou : une cellule démesurée (texte libre très long) ne doit jamais dépasser la hauteur d'une page,
  // sinon la fin du texte serait coupée sans prévenir ; on s'arrête et on renvoie à la fiche.
  let total = 0;
  let cut = false;
  const capped = all.map((vis) =>
    vis.filter(() => {
      total += 1;
      if (total > MAX_CELL_LINES) {
        cut = true;
        return false;
      }
      return true;
    })
  );
  if (cut) {
    const last = capped.filter((v) => v.length > 0).pop();
    if (last) last[last.length - 1] = { text: '... (suite : voir la fiche sanitaire)', line: { text: '', italic: true, size: 7, color: GRAY } };
  }
  return capped;
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
    installPdfSafety(doc);

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
    installPdfSafety(doc);

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
PDSAFEEOF_X
else
  echo "   - ignore (PDF organisateurs) : correctif patch-pdf-organisateurs non installe"
fi

# --- 5. Onglet RGPD des parents (fichier complet, seulement s'il est installe) -----------------
if [ -f "$RGPD" ]; then
  echo ">>> Mise a jour de src/components/RgpdPanel.tsx ..."
  cat > "$RGPD" << 'PDSAFEEOF_X'
import React, { useEffect, useState } from 'react';
import { ShieldCheck, Download, Database, Users, Clock, Scale, Mail, FileText, Lock } from 'lucide-react';
import { Student, Trip, User } from '../types';
import { getStoredEstablishmentName } from '../utils/storage';

console.log('[fichesanitaire] build rgpd-20261006 (texte corrigé : audit-fixes-20261006)');

interface RgpdPanelProps {
  currentUser: User;
  students: Student[];
  trips: Trip[];
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

// Rubriques de données collectées : ce que contient réellement le portail
const DATA_ROWS: { title: string; what: string; why: string; note?: string }[] = [
  {
    title: 'Votre compte',
    what: 'Nom et prénom, adresse e-mail, téléphone (facultatif), mot de passe, question et réponse secrètes de récupération du mot de passe.',
    why: 'Vous identifier, retrouver vos enfants et vous permettre de récupérer votre accès.',
  },
  {
    title: "Identité de l'enfant",
    what: "Nom, prénom, date de naissance, sexe, classe, régime scolaire (demi-pension, externe, interne), téléphone portable de l'enfant (facultatif), numéro de sécurité sociale.",
    why: "Identifier l'enfant sur la fiche sanitaire de liaison officielle (CERFA n°10008*02) et auprès des services de secours.",
  },
  {
    title: 'Vaccinations',
    what: 'Vaccins obligatoires et recommandés, dates des derniers rappels, éventuelle contre-indication médicale.',
    why: "Renseigner le carnet de vaccination demandé par la fiche sanitaire officielle.",
    note: 'Donnée de santé',
  },
  {
    title: 'Renseignements médicaux',
    what: "Traitement médical en cours, Projet d'Accueil Individualisé (PAI), allergies (asthme, médicamenteuses, alimentaires, autres) avec la conduite à tenir, antécédents (maladies déjà eues), difficultés de santé, médecin traitant (nom et téléphone).",
    why: "Permettre aux accompagnateurs d'agir correctement et de prévenir les secours en cas de problème de santé pendant un séjour.",
    note: 'Donnée de santé — donnée sensible',
  },
  {
    title: 'Régime alimentaire',
    what: 'Régime (sans porc, sans viande, végétarien, allergie alimentaire…) et recommandations libres que vous écrivez.',
    why: 'Adapter les repas pendant les voyages.',
    note: 'Si vous mentionnez des convictions religieuses dans vos recommandations, elles sont enregistrées : écrivez seulement ce qui est utile.',
  },
  {
    title: 'Responsable légal',
    what: 'Nom, lien avec l’enfant, adresse, téléphones fixe, portable et travail, adresse e-mail.',
    why: 'Vous joindre en cas d’urgence ou de question.',
  },
  {
    title: 'Pièces jointes',
    what: "Documents que vous ajoutez : protocole PAI, ordonnance, justificatifs (PDF ou photo).",
    why: "Fournir au séjour les documents médicaux utiles.",
    note: 'Donnée de santé',
  },
  {
    title: 'Déclaration et signature',
    what: "Case « J'atteste sur l'honneur », nom du signataire, date, image de votre signature manuscrite électronique (ou importée par l'administration à votre demande).",
    why: "Valider la fiche : une seule signature d'un responsable légal suffit.",
  },
  {
    title: 'Voyages',
    what: "Inscriptions de votre enfant aux voyages scolaires proposés pour sa classe.",
    why: "Organiser les séjours et établir les listes des élèves partants.",
  },
  {
    title: 'Messagerie et popups',
    what: "Messages échangés avec l'établissement, date de lecture de chaque message, popups d'information lus.",
    why: "Vous informer et répondre à vos questions.",
  },
  {
    title: 'Historique de la fiche',
    what: "Qui a modifié la fiche (votre nom ou celui de l'administration) et quand.",
    why: 'Tracer les modifications et éviter les écrasements entre deux responsables.',
  },
  {
    title: 'Copie PDF et lien direct',
    what: "Copie PDF de la fiche complète conservée sur le serveur de l'établissement ; lien direct d'accès à la fiche sans connexion, si vous en avez demandé un.",
    why: "Archivage de la fiche et accès simplifié pour un deuxième responsable.",
  },
  {
    title: 'Sur votre appareil',
    what: "Le portail mémorise dans votre navigateur un identifiant de session et une copie des données affichées, pour fonctionner plus vite. Aucun cookie publicitaire ou de mesure d'audience, aucun traceur : le portail ne charge aucun service extérieur (statistiques, publicité, réseaux sociaux, polices en ligne).",
    why: 'Faire fonctionner le portail.',
  },
];

export const RgpdPanel: React.FC<RgpdPanelProps> = ({ currentUser, students, trips }) => {
  const establishment = getStoredEstablishmentName();
  const myChildren = students.filter((s) => s.parentId === currentUser.id && !(s as any).deletedAt);
  const [yearEnd, setYearEnd] = useState<{ enabled: boolean; month: number; day: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/year-end/public')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j && typeof j.month === 'number') setYearEnd(j);
      })
      .catch(() => {
        /* le texte reste sans date précise */
      });
    return () => {
      alive = false;
    };
  }, []);

  const tripNames = (s: Student) =>
    (s.registeredTripIds || [])
      .map((id) => trips.find((t) => t.id === id)?.name)
      .filter(Boolean)
      .join(', ');

  const handleDownload = () => {
    const safe = (v: any) => v;
    const data = {
      document: 'Copie de mes données personnelles — Portail Fiche Sanitaire de Liaison',
      etablissement: establishment,
      genereLe: new Date().toISOString(),
      compte: {
        nom: currentUser.name,
        prenom: currentUser.firstName || '',
        email: currentUser.email,
        telephone: currentUser.phone || '',
        role: 'Parent / Responsable légal',
      },
      enfants: myChildren.map((s) => ({
        numeroEleve: s.internalId,
        classe: s.schoolClass,
        pension: s.boardingStatus,
        statutFiche: s.status === 'complete' ? 'complète' : 'incomplète',
        derniereModification: s.updatedAt,
        voyagesInscrits: (s.registeredTripIds || []).map((id) => trips.find((t) => t.id === id)?.name || id),
        fiche: {
          ...safe(s.cerfa),
          documents: (s.cerfa.documents || []).map((d) => ({ nom: d.fileName || d.name, type: d.type, ajouteLe: d.uploadDate })),
          signature: {
            signePar: s.cerfa.signature?.signedByName || '',
            date: s.cerfa.signature?.signedDate || '',
            imageDeLaSignature: s.cerfa.signature?.signatureDataUrl ? 'enregistrée (non incluse dans ce fichier)' : 'aucune',
          },
        },
      })),
      remarque: 'Pour recevoir aussi les messages échangés, ou demander une rectification ou une suppression, écrivez à la direction depuis la messagerie du portail.',
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Mes_donnees_${(currentUser.name || 'compte').replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="space-y-6" data-testid="rgpd-panel">
      <div className="bg-gradient-to-r from-blue-900 to-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-md">
        <span className="inline-flex items-center gap-1.5 bg-blue-800 text-blue-200 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-md mb-2">
          <ShieldCheck className="w-3.5 h-3.5" /> Protection des données — RGPD
        </span>
        <h2 className="text-2xl font-bold tracking-tight">Vos données personnelles sur ce portail</h2>
        <p className="text-blue-200 text-sm mt-1 max-w-3xl">
          Cette page explique, simplement, quelles informations sont enregistrées sur votre compte et sur la fiche sanitaire de vos enfants,
          pourquoi, qui peut les voir, combien de temps elles sont conservées et comment exercer vos droits.
        </p>
      </div>

      {/* Qui est responsable */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Lock className="w-4 h-4 text-blue-900" /> Qui est responsable de vos données ?
        </h3>
        <p className="text-sm text-slate-700 leading-relaxed">
          <strong>{establishment}</strong> est responsable du traitement. Les données sont enregistrées sur le serveur informatique de l'établissement.
          Elles ne sont ni vendues, ni utilisées pour de la publicité, ni transmises à des organismes extérieurs au séjour. Pour toute question,
          écrivez à la direction depuis la <strong>Messagerie</strong> du portail (bouton en bas à gauche de l'écran).
        </p>
      </section>

      {/* Récapitulatif du compte */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3" data-testid="rgpd-summary">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-900" /> Ce que le portail détient aujourd'hui sur votre compte
        </h3>
        <div className="text-sm text-slate-700">
          <p>
            <strong>Compte :</strong> {currentUser.name} — {currentUser.email}
            {currentUser.phone ? ` — ${currentUser.phone}` : ''}
          </p>
          <p className="mt-1">
            <strong>Enfants rattachés à votre compte :</strong> {myChildren.length}
          </p>
        </div>
        {myChildren.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-100 text-slate-700 font-semibold">
                <tr>
                  <th className="p-2">Enfant</th>
                  <th className="p-2">Classe</th>
                  <th className="p-2">Fiche</th>
                  <th className="p-2">Pièces jointes</th>
                  <th className="p-2">Signature</th>
                  <th className="p-2">Voyages inscrits</th>
                  <th className="p-2">Dernière modification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myChildren.map((s) => (
                  <tr key={s.id}>
                    <td className="p-2 font-semibold text-slate-900">
                      {s.cerfa.identity.firstName} {s.cerfa.identity.lastName}
                    </td>
                    <td className="p-2">{s.schoolClass}</td>
                    <td className="p-2">{s.status === 'complete' ? 'Complète' : `Incomplète (${s.completenessPercent ?? 0} %)`}</td>
                    <td className="p-2">{(s.cerfa.documents || []).length}</td>
                    <td className="p-2">{s.cerfa.signature?.signatureDataUrl ? 'Enregistrée' : 'Non signée'}</td>
                    <td className="p-2">{tripNames(s) || 'Aucun'}</td>
                    <td className="p-2">{fmtDate(s.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500 italic">Aucun enfant n'est rattaché à votre compte pour le moment.</p>
        )}
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-2 bg-blue-900 hover:bg-blue-950 text-white font-semibold text-xs px-4 py-2.5 rounded-xl cursor-pointer"
          data-testid="rgpd-download"
        >
          <Download className="w-4 h-4" /> Télécharger une copie de mes données (fichier JSON)
        </button>
        <p className="text-[11px] text-slate-500">
          Le fichier contient votre compte (sans mot de passe) et la fiche complète de vos enfants ; les pièces jointes y sont listées, sans leur contenu.
        </p>
      </section>

      {/* Données collectées */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-900" /> Quelles données sont enregistrées, et pourquoi ?
        </h3>
        <div className="divide-y divide-slate-100">
          {DATA_ROWS.map((r) => (
            <div key={r.title} className="py-3 grid grid-cols-1 md:grid-cols-4 gap-1 md:gap-4">
              <div className="font-semibold text-sm text-slate-900">
                {r.title}
                {r.note && <span className="block text-[11px] font-semibold text-red-700 mt-0.5">{r.note}</span>}
              </div>
              <div className="md:col-span-2 text-sm text-slate-700 leading-relaxed">{r.what}</div>
              <div className="text-xs text-slate-500 leading-relaxed">
                <span className="font-semibold text-slate-600">Pourquoi : </span>
                {r.why}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Qui y a accès */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-900" /> Qui peut voir ces informations ?
        </h3>
        <ul className="text-sm text-slate-700 leading-relaxed list-disc pl-5 space-y-1">
          <li>
            <strong>Vous</strong>, responsable légal : votre compte et les fiches de vos enfants.
          </li>
          <li>
            <strong>La direction / administration de l'établissement</strong> : l'ensemble des fiches et des comptes, pour gérer les voyages et vous aider.
          </li>
          <li>
            <strong>Les professeurs accompagnateurs</strong> du voyage auquel votre enfant est inscrit : le portail leur affiche la liste sanitaire du séjour (régime, allergies,
            PAI, contact d'urgence) et la fiche de leurs élèves partants.
          </li>
          <li>
            <strong>Aucune autre famille</strong> : le portail n'affiche à une famille que ses propres enfants et ses propres messages.
          </li>
          <li>
            Les <strong>relances par e-mail</strong> (fiche incomplète) sont envoyées depuis la messagerie électronique de l'établissement : elles contiennent le
            prénom et le nom de l'enfant, sa classe et un lien vers la fiche.
          </li>
        </ul>
      </section>

      {/* Conservation */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2" data-testid="rgpd-retention">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-900" /> Combien de temps sont-elles conservées ?
        </h3>
        <ul className="text-sm text-slate-700 leading-relaxed list-disc pl-5 space-y-1">
          {yearEnd && yearEnd.enabled && (
            <li>
              <strong>Inscriptions aux voyages</strong> : remises à zéro chaque année, vers le {yearEnd.day} {MONTHS[yearEnd.month - 1]} : vos enfants sont
              désinscrits de tous les voyages et vous les réinscrivez à la rentrée. Les fiches sanitaires ne sont pas supprimées à cette occasion.
            </li>
          )}
          <li>
            <strong>Fiche sanitaire et compte</strong> : conservés tant que votre enfant est suivi sur le portail, puis supprimés par l'établissement, ou plus
            tôt sur votre demande.
          </li>
          <li>
            <strong>Fiche supprimée</strong> : elle reste 30 jours dans une corbeille (pour annuler une erreur), puis elle est effacée définitivement,
            <strong> avec sa copie PDF archivée sur le serveur</strong>.
          </li>
          <li>
            <strong>Copies de sauvegarde</strong> : le serveur fait une sauvegarde automatique toutes les heures, conservée 14 jours ; l'établissement conserve
            aussi des sauvegardes de son infrastructure. Une donnée effacée peut donc subsister dans ces copies pendant une durée limitée, sans être utilisée.
          </li>
          <li>
            <strong>Messages</strong> : conservés tant que l'établissement ne les supprime pas.
          </li>
        </ul>
      </section>

      {/* Droits */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Scale className="w-4 h-4 text-blue-900" /> Vos droits
        </h3>
        <p className="text-sm text-slate-700 leading-relaxed">
          Vous pouvez demander l'<strong>accès</strong> à vos données, leur <strong>rectification</strong>, leur <strong>effacement</strong>, la
          <strong> limitation</strong> de leur utilisation, vous y <strong>opposer</strong> ou recevoir une copie portable.
        </p>
        <ul className="text-sm text-slate-700 leading-relaxed list-disc pl-5 space-y-1">
          <li>
            <strong>Par vous-même, tout de suite</strong> : consulter et corriger la fiche de vos enfants (onglet « Mes enfants & voyages »), télécharger la
            fiche en PDF, désinscrire un enfant d'un voyage, et <strong>télécharger une copie de vos données</strong> avec le bouton ci-dessus.
          </li>
          <li>
            <strong>Pour le reste</strong> (suppression d'une fiche ou du compte, limitation, opposition) : écrivez à la direction depuis la
            <Mail className="w-3.5 h-3.5 inline mx-1" /> <strong>Messagerie</strong> du portail en précisant votre demande.
          </li>
          <li>
            Si vous estimez, après nous avoir contactés, que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la CNIL (cnil.fr).
          </li>
        </ul>
      </section>
    </div>
  );
};
PDSAFEEOF_X
else
  echo "   - ignore (onglet RGPD) : correctif patch-rgpd non installe"
fi

# --- 6. Reconstruction ------------------------------------------------------
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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/src $APP_DIR/ && rm -f $APP_DIR/src/utils/pdfSafe.ts"
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
 - PDF : bloc voyages lisible (tous les voyages), plus de caracteres parasites, textes longs geres.
 - Onglet RGPD : formulation exacte sur l'affichage des enfants.
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5), puis regenerez les PDF archives
 (Administration > Etablissement scolaire > Regenerer les PDF).
 Console navigateur : "[fichesanitaire] build audit-fixes-20261006"
============================================================
MSG
