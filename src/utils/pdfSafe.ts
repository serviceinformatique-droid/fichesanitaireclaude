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
