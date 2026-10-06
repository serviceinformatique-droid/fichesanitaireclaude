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
