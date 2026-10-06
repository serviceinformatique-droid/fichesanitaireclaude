import { jsPDF } from 'jspdf';
import { installPdfSafety } from './pdfSafe';
import { Student, Trip } from '../types';
import { formatDateFr, computeCerfaCompleteness } from './cerfaValidation';
import { getStoredEstablishmentName } from './storage';

export interface PdfExportOptions {
  filename?: string;
  orientation?: 'portrait' | 'landscape';
  marginMm?: number;
}

/**
 * Generates an official, publication-quality Fiche Sanitaire de Liaison PDF document
 * on exactly ONE single page with pure vector rendering in jsPDF.
 * Clean, compact, with prominent dietary & medical allergies highlights.
 */
export async function generateCerfaPdf(
  student: Student,
  trips: Trip[] = [],
  establishmentName?: string,
  asBase64: boolean = false
): Promise<boolean | string> {
  try {
    const { cerfa } = student;
    const resolvedEstablishment =
      establishmentName?.trim() || getStoredEstablishmentName() || student.schoolEstablishment?.trim();

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });
    installPdfSafety(doc); // build audit-fixes-20261006 : symboles non pris en charge, mots trop longs

    const enrolledTrips = trips.filter((t) => student.registeredTripIds?.includes(t.id));
    const pageWidth = 210;
    const margin = 6;
    const contentWidth = pageWidth - margin * 2; // 198 mm
    let y = 5;

    // --- 1. HEADER BANNER ---
    // French tricolor bar
    doc.setFillColor(0, 38, 84); // Blue
    doc.rect(margin, y, contentWidth / 3, 1.5, 'F');
    doc.setFillColor(255, 255, 255); // White
    doc.rect(margin + contentWidth / 3, y, contentWidth / 3, 1.5, 'F');
    doc.setFillColor(239, 65, 53); // Red
    doc.rect(margin + (contentWidth / 3) * 2, y, contentWidth / 3, 1.5, 'F');
    y += 3;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(60, 60, 60);
    doc.text('RÉPUBLIQUE FRANÇAISE', margin, y);
    y += 3.5;

    doc.setFillColor(240, 244, 250);
    doc.setDrawColor(30, 58, 138);
    doc.roundedRect(margin, y, contentWidth, 10, 1.5, 1.5, 'FD');

    doc.setFontSize(11);
    doc.setTextColor(30, 58, 138);
    doc.setFont('helvetica', 'bold');
    doc.text('FICHE SANITAIRE DE LIAISON', pageWidth / 2, y + 4.5, { align: 'center' });

    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(90, 100, 115);
    doc.text(
      'Document officiel de liaison sanitaire — Arrêté ministériel relatif aux accueils et séjours scolaires',
      pageWidth / 2,
      y + 8,
      { align: 'center' }
    );
    y += 12;

    // --- build pdf-sante-20261006 : aides de mise en page (saut de page, texte à la ligne, pastilles) ---
    const PAGE_H = 297;
    const BOTTOM_MARGIN = 14;
    const newPage = () => {
      doc.addPage();
      y = 8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(90, 100, 115);
      doc.text(
        `FICHE SANITAIRE DE LIAISON — ${cerfa.identity?.lastName || ''} ${cerfa.identity?.firstName || ''} (suite)`,
        margin,
        y
      );
      y += 5;
    };
    const ensureSpace = (h: number) => {
      if (y + h > PAGE_H - BOTTOM_MARGIN) newPage();
    };
    const lineMm = (pt: number) => pt * 0.3528 * 1.28;
    const wrapLines = (text: string, width: number, pt: number, style: 'normal' | 'bold' | 'italic' = 'normal'): string[] => {
      doc.setFont('helvetica', style);
      doc.setFontSize(pt);
      return doc.splitTextToSize(String(text || ''), width) as string[];
    };
    const drawPill = (
      label: string,
      xRight: number,
      yTop: number,
      h: number,
      fill: [number, number, number],
      fg: [number, number, number],
      pt: number
    ) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(pt);
      const w = doc.getTextWidth(label) + 8;
      doc.setFillColor(fill[0], fill[1], fill[2]);
      doc.roundedRect(xRight - w, yTop, w, h, h / 2, h / 2, 'F');
      doc.setTextColor(fg[0], fg[1], fg[2]);
      doc.text(label, xRight - w / 2, yTop + h / 2 + pt * 0.3528 * 0.34, { align: 'center' });
    };
    const drawBox = (h: number, fill: [number, number, number], border: [number, number, number], x = margin, w = contentWidth) => {
      doc.setFillColor(fill[0], fill[1], fill[2]);
      doc.setDrawColor(border[0], border[1], border[2]);
      doc.setLineWidth(0.35);
      doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');
    };

    // Section title helper
    const drawSectionTitle = (title: string, subtitle?: string) => {
      ensureSpace(34);
      doc.setFillColor(30, 58, 138);
      doc.rect(margin, y, 2.5, 4.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(30, 58, 138);
      doc.text(title, margin + 4, y + 3.5);
      y += 5;

      if (subtitle) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(6);
        doc.setTextColor(110, 110, 110);
        doc.text(subtitle, margin + 4, y);
        y += 2.5;
      }
    };

    // --- RUBRIQUE 1 : IDENTITÉ ---
    drawSectionTitle('RUBRIQUE 1 — RENSEIGNEMENTS SUR L ENFANT');
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, y, contentWidth, 18.5, 'FD');

    doc.setFontSize(7.5);
    doc.setTextColor(40, 40, 40);

    // Row 1
    doc.setFont('helvetica', 'bold');
    doc.text('Nom :', margin + 3, y + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.text(cerfa.identity?.lastName || '—', margin + 14, y + 4.5);

    doc.setFont('helvetica', 'bold');
    doc.text('Prénom :', margin + 55, y + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.text(cerfa.identity?.firstName || '—', margin + 70, y + 4.5);

    doc.setFont('helvetica', 'bold');
    doc.text('Né(e) le :', margin + 115, y + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.text(cerfa.identity?.birthDate ? formatDateFr(cerfa.identity.birthDate) : '—', margin + 130, y + 4.5);

    doc.setFont('helvetica', 'bold');
    doc.text('Sexe :', margin + 165, y + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.text(cerfa.identity?.gender || '—', margin + 176, y + 4.5);

    // Row 2
    doc.setFont('helvetica', 'bold');
    doc.text('Établissement :', margin + 3, y + 9.5);
    doc.setFont('helvetica', 'normal');
    doc.text(resolvedEstablishment, margin + 26, y + 9.5);

    doc.setFont('helvetica', 'bold');
    doc.text('Classe :', margin + 115, y + 9.5);
    doc.setFont('helvetica', 'normal');
    doc.text(student.schoolClass || '—', margin + 130, y + 9.5);

    doc.setFont('helvetica', 'bold');
    doc.text('Régime :', margin + 155, y + 9.5);
    doc.setFont('helvetica', 'normal');
    doc.text(
      student.boardingStatus === 'DP'
        ? 'Demi-pensionnaire'
        : student.boardingStatus === 'Interne'
        ? 'Interne'
        : 'Externe',
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

    // --- RUBRIQUE 2 : VACCINATIONS ---
    drawSectionTitle('RUBRIQUE 2 — VACCINATIONS OBLIGATOIRES & RECOMMANDÉES (CERFA n° 10008*02)');

    // Vaccination table header
    const col1 = margin;
    const col2 = margin + 85;
    const col3 = margin + 135;
    const colWidth = contentWidth;

    doc.setFillColor(226, 232, 240);
    doc.setDrawColor(203, 213, 225);
    doc.rect(col1, y, colWidth, 4.2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(30, 41, 59);
    doc.text('VACCINS OBLIGATOIRES (CERFA)', col1 + 3, y + 3.1);
    doc.text('EFFECTUÉ (OUI / NON)', col2 + 3, y + 3.1);
    doc.text('DATE DERNIER RAPPEL', col3 + 3, y + 3.1);
    y += 4.2;

    const obligs = [
      { name: 'Diphtérie', data: cerfa.vaccinations?.obligatoires?.diphterie },
      { name: 'Tétanos', data: cerfa.vaccinations?.obligatoires?.tetanos },
      { name: 'Poliomyélite', data: cerfa.vaccinations?.obligatoires?.poliomyelite },
      { name: 'Ou DT Polio (Combiné)', data: cerfa.vaccinations?.obligatoires?.dtPolio },
      { name: 'Ou Tétracoq (Combiné)', data: cerfa.vaccinations?.obligatoires?.tetracoq },
    ];

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    obligs.forEach((v, idx) => {
      const rowY = y;
      doc.setFillColor(idx % 2 === 0 ? 255 : 248, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 252);
      doc.rect(col1, rowY, colWidth, 3.8, 'FD');

      doc.setTextColor(50, 50, 50);
      doc.text(v.name, col1 + 3, rowY + 2.8);

      const status = v.data?.done === true ? 'OUI' : v.data?.done === false ? 'NON' : 'Non renseigné';
      doc.setFont('helvetica', v.data?.done === true ? 'bold' : 'normal');
      doc.setTextColor(
        v.data?.done === true ? 21 : v.data?.done === false ? 180 : 120,
        v.data?.done === true ? 128 : 50,
        v.data?.done === true ? 61 : 50
      );
      doc.text(status, col2 + 3, rowY + 2.8);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(50, 50, 50);
      doc.text(v.data?.lastBoosterDate ? formatDateFr(v.data.lastBoosterDate) : '—', col3 + 3, rowY + 2.8);

      y += 3.8;
    });

    // Recommandés inline + contre-indication
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, y, contentWidth, 4.2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(50, 50, 50);
    doc.text('Vaccins recommandés :', margin + 3, y + 3);
    doc.setFont('helvetica', 'normal');
    const recList = [
      `BCG : ${cerfa.vaccinations?.recommandes?.bcg?.done ? `Oui (${formatDateFr(cerfa.vaccinations.recommandes.bcg.date)})` : 'Non'}`,
      `Hépatite B : ${cerfa.vaccinations?.recommandes?.hepatiteB?.done ? `Oui (${formatDateFr(cerfa.vaccinations.recommandes.hepatiteB.date)})` : 'Non'}`,
      `ROR : ${cerfa.vaccinations?.recommandes?.ror?.done ? `Oui (${formatDateFr(cerfa.vaccinations.recommandes.ror.date)})` : 'Non'}`,
      `Coqueluche : ${cerfa.vaccinations?.recommandes?.coqueluche?.done ? `Oui (${formatDateFr(cerfa.vaccinations.recommandes.coqueluche.date)})` : 'Non'}`,
    ];
    doc.text(recList.join('   |   '), margin + 34, y + 3);

    if (cerfa.vaccinations?.hasContraindication) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(185, 28, 28);
      doc.text(` | ATTENTION - Contre-indication : ${cerfa.vaccinations.contraindicationDetails || 'Certificat médical'}`, margin + 130, y + 3);
    }
    y += 6;

    // --- RUBRIQUE 3 : RENSEIGNEMENTS MÉDICAUX & P.A.I. (grands blocs lisibles, build pdf-sante-20261006) ---
    drawSectionTitle('RUBRIQUE 3 — RENSEIGNEMENTS MÉDICAUX & P.A.I.');
    const mi: any = cerfa.medicalInfo || {};
    const innerW = contentWidth - 8;
    const antecedentLabels: Record<string, string> = {
      rubeole: 'Rubéole',
      varicelle: 'Varicelle',
      angines: 'Angines',
      rhumatismes: 'Rhumatismes',
      scarlatine: 'Scarlatine',
      coqueluche: 'Coqueluche',
      otites: 'Otites',
      asthme: 'Asthme',
      rougeole: 'Rougeole',
      oreillons: 'Oreillons',
    };
    const capitalize = (v: string) => antecedentLabels[v] || v.charAt(0).toUpperCase() + v.slice(1);

    // 3a. Traitement médical
    {
      const hasTreat = Boolean(mi.hasMedicalTreatment);
      const treatLines = hasTreat ? wrapLines(mi.treatmentDetails || 'Selon posologie (voir ordonnance)', innerW, 10, 'bold') : [];
      const h = 10 + (hasTreat ? 4.5 + treatLines.length * lineMm(10) + 5 : 0);
      ensureSpace(h + 2);
      drawBox(h, hasTreat ? [255, 251, 235] : [248, 250, 252], hasTreat ? [245, 158, 11] : [203, 213, 225]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(30, 41, 59);
      doc.text("L'ENFANT SUIT-IL UN TRAITEMENT MÉDICAL ?", margin + 4, y + 6.2);
      drawPill(hasTreat ? 'OUI' : 'NON', margin + contentWidth - 4, y + 2.2, 6.2, hasTreat ? [217, 119, 6] : [100, 116, 139], [255, 255, 255], 10);
      if (hasTreat) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7);
        doc.setTextColor(120, 113, 108);
        doc.text('Détails du traitement prescrit :', margin + 4, y + 11.5);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(120, 53, 15);
        doc.text(treatLines, margin + 4, y + 16);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(87, 83, 78);
        doc.text(
          `Ordonnance médicale jointe au dossier : ${mi.hasPrescriptionAttached ? 'OUI' : 'NON'}`,
          margin + 4,
          y + h - 2.2
        );
      }
      y += h + 2.5;
    }

    // 3b. Projet d'Accueil Individualisé (P.A.I.)
    {
      const pai = Boolean(mi.hasPai);
      if (pai) {
        const paiDocs = (cerfa.documents || [])
          .filter((d) => d.type === 'pai')
          .map((d) => d.fileName || d.name)
          .filter(Boolean)
          .join(', ');
        const paiLines = wrapLines(mi.paiDetails || "Protocole d'urgence établi (voir la pièce jointe)", innerW, 10.5, 'bold');
        const docLines = paiDocs ? wrapLines(`Pièce(s) jointe(s) PAI : ${paiDocs}`, innerW, 7.5) : [];
        const h = 15.5 + paiLines.length * lineMm(10.5) + (docLines.length ? docLines.length * lineMm(7.5) + 2 : 0);
        ensureSpace(h + 2);
        drawBox(h, [254, 242, 242], [220, 38, 38]);
        doc.setFillColor(220, 38, 38);
        doc.rect(margin, y + 1.5, 1.6, h - 3, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(127, 29, 29);
        doc.text("PROJET D'ACCUEIL INDIVIDUALISÉ (P.A.I.)", margin + 4, y + 6.2);
        drawPill('OUI — PROTOCOLE ACTIF', margin + contentWidth - 4, y + 2, 6.6, [220, 38, 38], [255, 255, 255], 10);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7);
        doc.setTextColor(120, 113, 108);
        doc.text("Pathologie et conduite d'urgence PAI :", margin + 4, y + 11.8);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(153, 27, 27);
        doc.text(paiLines, margin + 4, y + 16.6);
        if (docLines.length) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(87, 83, 78);
          doc.text(docLines, margin + 4, y + 16.6 + paiLines.length * lineMm(10.5) + 1.2);
        }
        y += h + 2.5;
      } else {
        ensureSpace(10);
        drawBox(7.5, [248, 250, 252], [203, 213, 225]);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(51, 65, 85);
        doc.text("PROJET D'ACCUEIL INDIVIDUALISÉ (P.A.I.) : NON", margin + 4, y + 4.9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text("Aucun protocole médical d'urgence requis pour cet élève", margin + 82, y + 4.9);
        y += 10;
      }
    }

    // 3c. Allergies (4 cases bien visibles) + cause et conduite à tenir
    {
      const al: any = mi.allergies || {};
      const cells: [string, any, boolean][] = [
        ['ASTHME', al.asthme, false],
        ['MÉDICAMENTEUSES', al.medicamenteuses, false],
        ['ALIMENTAIRES', al.alimentaires, false],
        ['AUTRES', al.autres, true],
      ];
      const gap = 2;
      const cw = (contentWidth - gap * 3) / 4;
      const autresLines = al.autres ? wrapLines(String(al.autres), cw - 6, 8.5, 'bold') : [];
      const ch = Math.max(15.5, 9 + autresLines.length * lineMm(8.5));
      ensureSpace(ch + 3);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(51, 65, 85);
      doc.text('ALLERGIES', margin, y + 2.6);
      y += 4;
      cells.forEach(([label, val, isText], i) => {
        const x = margin + i * (cw + gap);
        const on = Boolean(val);
        doc.setFillColor(on ? 254 : 248, on ? 226 : 250, on ? 226 : 252);
        doc.setDrawColor(on ? 220 : 203, on ? 38 : 213, on ? 38 : 225);
        doc.setLineWidth(on ? 0.6 : 0.3);
        doc.roundedRect(x, y, cw, ch, 1.5, 1.5, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.8);
        doc.setTextColor(100, 116, 139);
        doc.text(label, x + 3, y + 4.4);
        if (isText && on) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.5);
          doc.setTextColor(185, 28, 28);
          doc.text(autresLines, x + 3, y + 9.4);
        } else {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(15);
          if (on) doc.setTextColor(185, 28, 28);
          else doc.setTextColor(148, 163, 184);
          doc.text(on ? 'OUI' : 'NON', x + 3, y + 12.4);
        }
      });
      y += ch + 2.5;

      const anyAllergy = Boolean(al.asthme || al.medicamenteuses || al.alimentaires || al.autres);
      const cause = String(mi.allergyCauseAndAction || '').trim();
      if (anyAllergy || cause) {
        const cl = wrapLines(cause || "À préciser : cause de l'allergie et conduite à tenir non renseignées", innerW, 10, 'bold');
        const h = 10.5 + cl.length * lineMm(10);
        ensureSpace(h + 2);
        drawBox(h, [254, 242, 242], [252, 165, 165]);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(153, 27, 27);
        doc.text("CAUSE DE L'ALLERGIE ET CONDUITE À TENIR :", margin + 4, y + 5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(87, 83, 78);
        doc.text(
          `Automédication signalée : ${mi.isSelfMedicationReported ? 'OUI' : 'NON'}`,
          margin + contentWidth - 4,
          y + 5,
          { align: 'right' }
        );
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(127, 29, 29);
        doc.text(cl, margin + 4, y + 10.2);
        y += h + 2.5;
      }
    }

    // 3d. Antécédents médicaux et difficultés de santé
    {
      const ants = mi.antecedents
        ? Object.entries(mi.antecedents)
            .filter(([, v]) => Boolean(v))
            .map(([k]) => capitalize(String(k)))
        : [];
      const anteLines = wrapLines(ants.length ? ants.join(', ') : 'Aucun antécédent signalé', innerW, 9, ants.length ? 'bold' : 'normal');
      const diffLines = wrapLines(
        String(mi.healthDifficulties || '').trim() || 'Aucune difficulté de santé signalée',
        innerW,
        9,
        mi.healthDifficulties ? 'bold' : 'normal'
      );
      const h = 20.5 + (anteLines.length + diffLines.length) * lineMm(9);
      ensureSpace(h + 2);
      drawBox(h, [248, 250, 252], [203, 213, 225]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(71, 85, 105);
      doc.text('ANTÉCÉDENTS MÉDICAUX (maladies déjà eues) :', margin + 4, y + 4.6);
      doc.setFont('helvetica', ants.length ? 'bold' : 'normal');
      doc.setFontSize(9);
      doc.setTextColor(ants.length ? 30 : 100, ants.length ? 41 : 116, ants.length ? 59 : 139);
      doc.text(anteLines, margin + 4, y + 9);
      const y2 = y + 9 + anteLines.length * lineMm(9) + 1.8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.2);
      doc.setTextColor(71, 85, 105);
      doc.text('DIFFICULTÉS DE SANTÉ (maladie, accident, hospitalisation, précautions) :', margin + 4, y2 + 2.4);
      doc.setFont('helvetica', mi.healthDifficulties ? 'bold' : 'normal');
      doc.setFontSize(9);
      doc.setTextColor(mi.healthDifficulties ? 30 : 100, mi.healthDifficulties ? 41 : 116, mi.healthDifficulties ? 59 : 139);
      doc.text(diffLines, margin + 4, y2 + 7);
      y += h + 3;
    }

    // --- RUBRIQUE 4 : RÉGIME ALIMENTAIRE & ALLERGIES ALIMENTAIRES (EN GRAND, comme la fiche imprimée par les parents) ---
    {
      const foodAllergy = Boolean(mi.allergies?.alimentaires);
      const dietCat = String(cerfa.structuredDiet?.category || 'aucun');
      const isRestrictedDiet = !['aucun', 'standard', ''].includes(dietCat);
      const active = foodAllergy || isRestrictedDiet;
      const dietLabels: Record<string, string> = {
        aucun: 'AUCUN RÉGIME PARTICULIER',
        standard: 'STANDARD / SANS RESTRICTION',
        sans_porc: 'SANS PORC',
        sans_viande: 'SANS VIANDE',
        vegetarien: 'VÉGÉTARIEN',
        allergie_alimentaire: 'ALLERGIE ALIMENTAIRE',
      };
      const dietLabel = dietLabels[dietCat] || dietCat.replace(/_/g, ' ').toUpperCase();
      const cardW = (contentWidth - 3) / 2;
      const details = String(cerfa.structuredDiet?.details || '').trim();
      const reco = String(cerfa.parentRecommendations || '').trim();

      const detLines = details ? wrapLines(details, cardW - 11, 8.5) : [];
      const leftH = 8 + 12 + 5 + (details ? 8 + detLines.length * lineMm(8.5) : 0);
      const allergyText = reco || 'Allergie alimentaire déclarée (consulter le PAI / protocole)';
      const allLines = foodAllergy ? wrapLines(allergyText, cardW - 14, 11.5, 'bold') : [];
      const recoLines = !foodAllergy && reco ? wrapLines(reco, cardW - 8, 8.5) : [];
      const rightH = foodAllergy
        ? 8 + 6 + allLines.length * lineMm(11.5)
        : 8 + 11 + (recoLines.length ? 7 + recoLines.length * lineMm(8.5) : 0);
      const cardH = Math.max(32, leftH, rightH);

      ensureSpace(cardH + 14);
      if (active) {
        doc.setFillColor(180, 83, 9);
        doc.rect(margin, y, contentWidth, 7, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(255, 255, 255);
        doc.text('4 — RÉGIME ALIMENTAIRE & ALLERGIES ALIMENTAIRES', margin + 4, y + 4.9);
        drawPill('RÉGIME OU ALLERGIE ACTIVE', margin + contentWidth - 3, y + 1.1, 4.8, [253, 224, 71], [113, 63, 18], 7.5);
        y += 9;
      } else {
        drawSectionTitle('RUBRIQUE 4 — RÉGIME ALIMENTAIRE & ALLERGIES ALIMENTAIRES');
      }

      // carte de gauche : régime alimentaire
      drawBox(cardH, isRestrictedDiet ? [254, 243, 199] : [248, 250, 252], isRestrictedDiet ? [245, 158, 11] : [203, 213, 225], margin, cardW);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(isRestrictedDiet ? 146 : 51, isRestrictedDiet ? 64 : 65, isRestrictedDiet ? 14 : 85);
      doc.text('Régime alimentaire sélectionné :', margin + 4, y + 6);
      const dietPt = dietLabel.length > 18 ? 12.5 : 16;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(dietPt);
      const dietW = Math.max(40, doc.getTextWidth(dietLabel) + 12);
      doc.setFillColor(isRestrictedDiet ? 180 : 100, isRestrictedDiet ? 83 : 116, isRestrictedDiet ? 9 : 139);
      doc.roundedRect(margin + 4, y + 9, Math.min(dietW, cardW - 8), 12, 2, 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.text(dietLabel, margin + 4 + Math.min(dietW, cardW - 8) / 2, y + 9 + 6 + dietPt * 0.3528 * 0.34, { align: 'center' });
      if (details) {
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(253, 230, 138);
        doc.roundedRect(margin + 4, y + 24, cardW - 8, 4.5 + detLines.length * lineMm(8.5), 1, 1, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(120, 53, 15);
        doc.text('Précisions :', margin + 6, y + 27.4);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(63, 63, 70);
        doc.text(detLines, margin + 6, y + 31.4);
      }

      // carte de droite : allergie alimentaire & évictions
      const rx = margin + cardW + 3;
      drawBox(cardH, foodAllergy ? [254, 242, 242] : [248, 250, 252], foodAllergy ? [252, 165, 165] : [203, 213, 225], rx, cardW);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(foodAllergy ? 153 : 51, foodAllergy ? 27 : 65, foodAllergy ? 27 : 85);
      doc.text('Allergie alimentaire & Évictions :', rx + 4, y + 6);
      if (foodAllergy) {
        const bh = allLines.length * lineMm(11.5) + 6;
        doc.setFillColor(185, 28, 28);
        doc.roundedRect(rx + 4, y + 9, cardW - 8, bh, 2, 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11.5);
        doc.setTextColor(255, 255, 255);
        doc.text(allLines, rx + 7, y + 9 + 5.6);
      } else {
        doc.setFillColor(226, 232, 240);
        doc.roundedRect(rx + 4, y + 9, cardW - 8, 9, 2, 2, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text('NON — Aucune allergie alimentaire déclarée', rx + 7, y + 14.8);
        if (recoLines.length) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.setTextColor(71, 85, 105);
          doc.text('Recommandations des parents :', rx + 4, y + 23);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8.5);
          doc.setTextColor(63, 63, 70);
          doc.text(recoLines, rx + 4, y + 27.2);
        }
      }
      y += cardH + 4;
    }

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

    // --- COORDONNÉES DES RESPONSABLES & MÉDECIN TRAITANT ---
    // User directive: "enleve le cadre gris sur le medecin. Enlève le cadre"
    // We do NOT draw ANY box or rectangle around the doctor or the guardian.
    drawSectionTitle('COORDONNÉES DES RESPONSABLES LÉGAUX & DU MÉDECIN TRAITANT');

    const colWidthHalf = (contentWidth - 8) / 2;
    const colLeft = margin;
    const colRight = margin + colWidthHalf + 8;

    // Clean, modern typography columns - WITHOUT ANY ENCLOSING FRAME OR BACKGROUND RECTANGLE
    // Left Column: Responsable légal
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(30, 41, 59);
    doc.text('Responsable légal de l enfant :', colLeft, y + 3.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(60, 60, 60);
    doc.text(`Nom : ${cerfa.legalGuardian?.fullName || '—'} (${cerfa.legalGuardian?.relationship || 'Responsable légal'})`, colLeft, y + 7.5);
    doc.text(`Téléphone portable : ${cerfa.legalGuardian?.mobilePhone || '—'}`, colLeft, y + 11.5);
    doc.text(`Adresse : ${cerfa.legalGuardian?.address || '—'}`, colLeft, y + 15.5);
    doc.text(`Email : ${cerfa.legalGuardian?.email || '—'}`, colLeft, y + 19.5);

    // Right Column: Médecin traitant & Urgences (NO FRAME / NO CADRE, Clean white canvas)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(30, 41, 59);
    doc.text('Médecin traitant & Urgences :', colRight, y + 3.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(60, 60, 60);
    doc.text(`Médecin traitant : Dr. ${cerfa.treatingDoctor?.name || '—'}`, colRight, y + 7.5);
    doc.text(`Téléphone cabinet : ${cerfa.treatingDoctor?.phone || '—'}`, colRight, y + 11.5);
    doc.text(`Téléphone fixe responsable : ${cerfa.legalGuardian?.homePhone || '—'}`, colRight, y + 15.5);
    doc.text(`Téléphone travail responsable : ${cerfa.legalGuardian?.workPhone || '—'}`, colRight, y + 19.5);

    y += 22;

    // --- DÉCLARATION SUR L'HONNEUR & SIGNATURE OFFICIELLE ---
    drawSectionTitle('DÉCLARATION SUR L HONNEUR & SIGNATURE ÉLECTRONIQUE');

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(30, 58, 138);
    doc.roundedRect(margin, y, contentWidth, 23, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(30, 58, 138);
    doc.text('ENGAGEMENT DU RESPONSABLE LÉGAL :', margin + 3, y + 3.8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(60, 60, 60);
    const legalDeclaration =
      'Je soussigné(e), responsable légal de l enfant, atteste sur l honneur l exactitude des renseignements portés sur la présente fiche sanitaire de liaison et m engage à signaler toute modification éventuelle survenant avant le départ (affection survenue, traitement en cours). J autorise le responsable du séjour ou son représentant à faire pratiquer toute intervention médicale ou chirurgicale d urgence si l état de santé de l enfant l exigeait.';
    const splitDecl = doc.splitTextToSize(legalDeclaration, contentWidth - 6);
    doc.text(splitDecl, margin + 3, y + 7);

    const signY = y + 15.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(30, 41, 59);
    doc.text(
      `Fait par : ${cerfa.signature?.signedByName || cerfa.legalGuardian?.fullName || 'Responsable légal'} | Date : ${
        cerfa.signature?.signedDate ? formatDateFr(cerfa.signature.signedDate) : formatDateFr(new Date().toISOString())
      }`,
      margin + 3,
      signY
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(100, 100, 100);
    doc.text(`Version archivée : v${cerfa.signature?.version || 1} • Statut : ${student.status === 'complete' ? 'Dossier complet' : 'Dossier en cours'}`, margin + 3, signY + 4);

    // Signature box
    const signBoxWidth = 42;
    const signBoxHeight = 9.5;
    const signBoxX = pageWidth - margin - signBoxWidth - 3;
    const signBoxY = y + 11.5;

    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(248, 250, 252);
    doc.rect(signBoxX, signBoxY, signBoxWidth, signBoxHeight, 'FD');

    doc.setFontSize(5.5);
    doc.setTextColor(120, 120, 120);
    doc.text(
      cerfa.signature?.method === 'uploaded' ? 'Signature importée (admin) :' : 'Signature électronique :',
      signBoxX + 1.5,
      signBoxY + 2.5
    );

    if (cerfa.signature?.signatureDataUrl) {
      try {
        doc.addImage(cerfa.signature.signatureDataUrl, 'PNG', signBoxX + 1.5, signBoxY + 3, signBoxWidth - 3, 6);
      } catch (imgErr) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(21, 128, 61);
        doc.text('Signé électroniquement', signBoxX + 4, signBoxY + 6.5);
      }
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(180, 83, 9);
      doc.text('(En attente de signature)', signBoxX + 4, signBoxY + 6.5);
    }

    // --- PIED DE PAGE sur chaque page (build pdf-sante-20261006) ---
    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(140, 140, 140);
      doc.text(
        `Fiche Sanitaire de Liaison officielle — ${resolvedEstablishment} — Document confidentiel`,
        margin,
        291
      );
      doc.text(
        `Émis le ${new Date().toLocaleDateString('fr-FR')}${pageCount > 1 ? ` — page ${p}/${pageCount}` : ''}`,
        pageWidth - margin,
        291,
        { align: 'right' }
      );
    }

    // Download the single-page PDF directly
    const sanitizedName = `${cerfa.identity?.lastName || 'Eleve'}_${cerfa.identity?.firstName || 'Fiche'}`.replace(
      /[^a-zA-Z0-9_-]/g,
      '_'
    );
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
    if (asBase64) {
      // Renvoie le PDF encodé en base64 (sans extension data URI), pour un
      // envoi par e-mail en pièce jointe, sans déclencher de téléchargement.
      return doc.output('datauristring').split(',')[1] || '';
    }
    doc.save(filename);
    return true;
  } catch (error) {
    console.error('Erreur lors de la génération du PDF:', error);
    return false;
  }
}

/**
 * Generates an official sanitary list PDF for a school trip (landscape).
 */
export async function generateTripRosterPdf(
  trip: Trip,
  students: Student[],
  sortLabel: string = 'Nom'
): Promise<boolean> {
  try {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = 297;
    const margin = 10;
    const contentWidth = pageWidth - margin * 2; // 277 mm
    let y = margin;

    // Header
    doc.setFillColor(30, 58, 138);
    doc.rect(margin, y, contentWidth, 14, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text(`LISTE SANITAIRE OFFICIELLE — ${trip.name.toUpperCase()}`, margin + 5, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(
      `Destination : ${trip.destination}  |  Du ${formatDateFr(trip.startDate)} au ${formatDateFr(trip.endDate)}  |  Organisateur : ${trip.organizerName}  |  Tri : ${sortLabel}`,
      margin + 5,
      y + 11
    );
    y += 18;

    // Stats bar
    const total = students.length;
    const paiCount = students.filter((s) => s.cerfa.medicalInfo.hasPai).length;
    const allergyCount = students.filter(
      (s) =>
        s.cerfa.medicalInfo.allergies.alimentaires ||
        s.cerfa.medicalInfo.allergies.asthme ||
        s.cerfa.medicalInfo.allergies.medicamenteuses ||
        Boolean(s.cerfa.parentRecommendations)
    ).length;
    const sansPorcCount = students.filter((s) => s.cerfa.structuredDiet.category === 'sans_porc').length;
    const vegeCount = students.filter((s) => s.cerfa.structuredDiet.category === 'vegetarien').length;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text(
      `Effectif inscrit : ${total} élèves  |  PAI actifs : ${paiCount}  |  Allergies / Régimes : ${allergyCount}  (Sans porc : ${sansPorcCount}, Végétariens : ${vegeCount})`,
      margin,
      y
    );
    y += 5;

    // Table Header
    doc.setFillColor(226, 232, 240);
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, y, contentWidth, 7, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);

    const cols = [
      { label: 'N°', x: margin + 2, w: 10 },
      { label: 'ÉLÈVE (NOM & PRÉNOM)', x: margin + 12, w: 48 },
      { label: 'CLASSE', x: margin + 60, w: 18 },
      { label: 'RÉGIME ALIMENTAIRE', x: margin + 78, w: 42 },
      { label: 'PAI / URGENCES', x: margin + 120, w: 42 },
      { label: 'ALLERGIES & TRAITEMENTS', x: margin + 162, w: 65 },
      { label: 'CONTACT RESPONSABLE', x: margin + 227, w: 50 },
    ];

    cols.forEach((col) => {
      doc.text(col.label, col.x, y + 4.8);
    });
    y += 7;

    // Student rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);

    students.forEach((student, index) => {
      if (y > 190) {
        doc.addPage();
        y = margin;
      }

      const { cerfa } = student;
      const isAlt = index % 2 === 1;
      const hasAlert = cerfa.medicalInfo.hasPai || cerfa.medicalInfo.allergies.alimentaires || cerfa.medicalInfo.allergies.asthme;

      doc.setFillColor(hasAlert ? 254 : isAlt ? 248 : 255, hasAlert ? 242 : isAlt ? 250 : 255, hasAlert ? 242 : isAlt ? 252 : 255);
      doc.rect(margin, y, contentWidth, 6.5, 'FD');

      doc.setTextColor(50, 50, 50);
      doc.text(String(index + 1), margin + 2, y + 4.5);

      doc.setFont('helvetica', 'bold');
      doc.text(`${cerfa.identity.lastName} ${cerfa.identity.firstName}`, margin + 12, y + 4.5);

      doc.setFont('helvetica', 'normal');
      doc.text(student.schoolClass, margin + 60, y + 4.5);

      // Diet
      const dietText = cerfa.structuredDiet.category.replace('_', ' ') + (cerfa.structuredDiet.details ? ` (${cerfa.structuredDiet.details.slice(0, 15)})` : '');
      doc.text(dietText.slice(0, 24), margin + 78, y + 4.5);

      // PAI
      if (cerfa.medicalInfo.hasPai) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(185, 28, 28);
        doc.text(`PAI : ${(cerfa.medicalInfo.paiDetails || 'Actif').slice(0, 22)}`, margin + 120, y + 4.5);
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);
        doc.text('Non', margin + 120, y + 4.5);
      }

      // Allergies
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(50, 50, 50);
      const allergyParts = [
        cerfa.parentRecommendations ? cerfa.parentRecommendations.slice(0, 25) : null,
        cerfa.medicalInfo.hasMedicalTreatment ? 'Traitement' : null,
      ].filter(Boolean);
      doc.text(allergyParts.length > 0 ? allergyParts.join(' | ') : 'R.A.S.', margin + 162, y + 4.5);

      // Contact
      doc.text(`${cerfa.legalGuardian.mobilePhone || '—'} (${cerfa.legalGuardian.fullName || 'Parent'})`.slice(0, 30), margin + 227, y + 4.5);

      y += 6.5;
    });

    const sanitizedTripName = trip.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    doc.save(`Liste_Sanitaire_${sanitizedTripName}_${sortLabel}.pdf`);
    return true;
  } catch (error) {
    console.error('Erreur export PDF de la liste sanitaire:', error);
    return false;
  }
}

/**
 * Capture un élément HTML et le place sur UNE SEULE page A4, mis à l'échelle
 * pour remplir la page le plus possible (contrairement à exportToPdf qui peut
 * répartir le contenu sur plusieurs pages).
 */
export async function exportSinglePagePdf(
  element: HTMLElement,
  options: PdfExportOptions = {}
): Promise<boolean> {
  const filename = options.filename || 'document.pdf';
  try {
    const html2canvasModule = await import('html2canvas-pro');
    const html2canvas = (html2canvasModule.default || html2canvasModule) as any;

    const canvas = await html2canvas(element, {
      scale: 1.5,
      useCORS: true,
      logging: false,
      // Force une largeur de rendu "bureau" fixe, quel que soit l'appareil qui
      // déclenche l'export (mobile ou ordinateur) : ça garantit que les classes
      // Tailwind responsives (sm:, md:...) s'appliquent toujours en mode
      // "grand écran" et que la mise en page ne change jamais selon l'appareil.
      windowWidth: 1100,
    });

    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('Canvas de capture vide (largeur ou hauteur nulle)');
    }

    const imgData = canvas.toDataURL('image/jpeg', 0.95);

    const orientation = options.orientation || 'portrait';
    const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = options.marginMm ?? 4;
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;

    // Conserve le ratio d'origine (pas d'étirement, pour éviter toute
    // déformation) : on cale sur la largeur, puis on réduit encore si ça
    // dépasse la hauteur disponible, et on centre le résultat sur la page.
    const canvasRatio = canvas.height / canvas.width;
    let renderWidth = maxWidth;
    let renderHeight = renderWidth * canvasRatio;

    if (renderHeight > maxHeight) {
      renderHeight = maxHeight;
      renderWidth = renderHeight / canvasRatio;
    }

    const x = margin + (maxWidth - renderWidth) / 2;
    const y = margin + (maxHeight - renderHeight) / 2;

    doc.addImage(imgData, 'JPEG', x, y, renderWidth, renderHeight);
    doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
    return true;
  } catch (error) {
    console.error('exportSinglePagePdf a échoué :', error);
    return false;
  }
}

/**
 * Generic multi-page export : capture l'élément avec html2canvas-pro (compatible
 * avec les couleurs modernes CSS type oklch() générées par Tailwind v4 — la
 * bibliothèque html2canvas standard plante silencieusement dessus) puis découpe
 * l'image en tranches pour paginer proprement sur autant de pages A4 que nécessaire.
 */
export async function exportToPdf(
  element: HTMLElement,
  options: PdfExportOptions = {}
): Promise<boolean> {
  const filename = options.filename || 'document.pdf';
  try {
    const html2canvasModule = await import('html2canvas-pro');
    const html2canvas = (html2canvasModule.default || html2canvasModule) as any;

    const canvas = await html2canvas(element, {
      scale: 1.5,
      useCORS: true,
      logging: false,
      windowWidth: 1100,
    });

    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('Canvas de capture vide (largeur ou hauteur nulle)');
    }

    const orientation = options.orientation || 'portrait';
    const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = options.marginMm ?? 8;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;

    const pxPerMm = canvas.width / usableWidth;
    const pageHeightPx = Math.floor(usableHeight * pxPerMm);

    let renderedPx = 0;
    let pageIndex = 0;

    while (renderedPx < canvas.height) {
      const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);

      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeightPx;
      const ctx = pageCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(
          canvas,
          0, renderedPx, canvas.width, sliceHeightPx,
          0, 0, canvas.width, sliceHeightPx
        );
      }

      const sliceImgData = pageCanvas.toDataURL('image/jpeg', 0.95);
      const sliceHeightMm = sliceHeightPx / pxPerMm;

      if (pageIndex > 0) doc.addPage();
      doc.addImage(sliceImgData, 'JPEG', margin, margin, usableWidth, sliceHeightMm);

      renderedPx += sliceHeightPx;
      pageIndex++;
    }

    doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
    return true;
  } catch (error) {
    console.error('exportToPdf a échoué :', error);
    try {
      window.print();
      return true;
    } catch {
      return false;
    }
  }
}

export function triggerPrint(): void {
  try {
    window.print();
  } catch (err) {
    console.warn('Impression bloquée:', err);
  }
}

/**
 * Génère le PDF officiel de la fiche sanitaire (complète) et l'envoie
 * automatiquement par e-mail à vacances@notredamedesmissions.com.
 * Appelé systématiquement à chaque enregistrement d'une fiche complète.
 * Ne bloque jamais le flux principal : les erreurs sont journalisées sans
 * interrompre l'utilisateur.
 */
export async function sendCompletedFichePdfByEmail(
  student: Student,
  trips: Trip[] = [],
  establishmentName?: string
): Promise<string | null> {
  try {
    const base64 = await generateCerfaPdf(student, trips, establishmentName, true);
    if (typeof base64 !== 'string' || !base64) {
      console.error('Génération du PDF (envoi automatique) : échec.');
      return null;
    }
    const studentName = `${student.cerfa.identity?.firstName || ''} ${student.cerfa.identity?.lastName || ''}`.trim();
    const res = await fetch('/api/students/send-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: student.id, pdfBase64: base64, studentName, schoolClass: student.schoolClass }),
    });
    if (!res.ok) {
      console.error("Échec de l'envoi automatique du PDF de la fiche sanitaire.");
      return null;
    }
    const data = await res.json();
    return data.sentAt || null;
  } catch (e) {
    console.error("Erreur lors de l'envoi automatique du PDF de la fiche sanitaire:", e);
    return null;
  }
}
