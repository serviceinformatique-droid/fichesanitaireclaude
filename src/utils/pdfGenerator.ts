import { jsPDF } from 'jspdf';
import { Student, Trip } from '../types';
import { formatDateFr } from './cerfaValidation';
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

    // Section title helper
    const drawSectionTitle = (title: string, subtitle?: string) => {
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
    doc.rect(margin, y, contentWidth, 13, 'FD');

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

    y += 15;

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
      doc.text(` | ⚠ Contre-indication : ${cerfa.vaccinations.contraindicationDetails || 'Certificat médical'}`, margin + 130, y + 3);
    }
    y += 6;

    // --- RUBRIQUE 3 : RENSEIGNEMENTS MÉDICAUX & P.A.I. ---
    drawSectionTitle('RUBRIQUE 3 — RENSEIGNEMENTS MÉDICAUX & P.A.I.');

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, y, contentWidth, 21, 'FD');

    // Row 1: PAI
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    if (cerfa.medicalInfo?.hasPai) {
      doc.setTextColor(185, 28, 28);
      doc.text(`PROJET D ACCUEIL INDIVIDUALISÉ (PAI) : OUI — PROTOCOLE ACTIF`, margin + 3, y + 4.2);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      const paiDocNames = cerfa.documents?.filter((d) => d.type === 'pai').map((d) => d.fileName).join(', ');
      doc.text(
        `Détails : ${cerfa.medicalInfo.paiDetails || 'Protocole d urgence établi'}${paiDocNames ? ` (Doc joint : ${paiDocNames})` : ''}`,
        margin + 85,
        y + 4.2
      );
    } else {
      doc.setTextColor(30, 41, 59);
      doc.text(`PROJET D ACCUEIL INDIVIDUALISÉ (PAI) : NON`, margin + 3, y + 4.2);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(`(Aucun protocole médical d urgence requis pour cet élève)`, margin + 70, y + 4.2);
    }

    // Row 2: Traitement médical
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(30, 41, 59);
    doc.text('Traitement médical régulier :', margin + 3, y + 8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text(
      cerfa.medicalInfo?.hasMedicalTreatment
        ? `OUI : ${cerfa.medicalInfo.treatmentDetails || 'Selon posologie'} (Ordonnance fournie : ${cerfa.medicalInfo.hasPrescriptionAttached ? 'Oui' : 'Non'})`
        : 'NON — Aucun traitement régulier',
      margin + 45,
      y + 8.5
    );

    // Row 3: Allergies médicales (Mis en valeur avec fond ou couleur d'alerte si présente)
    const hasMedAllergies = Boolean(
      cerfa.medicalInfo?.allergies?.asthme ||
      cerfa.medicalInfo?.allergies?.medicamenteuses ||
      cerfa.medicalInfo?.allergies?.autres
    );
    if (hasMedAllergies) {
      // Highlight banner for medical allergies
      doc.setFillColor(254, 242, 242);
      doc.rect(margin + 1, y + 10.5, contentWidth - 2, 4.8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(185, 28, 28);
      doc.text('⚠ ALLERGIES MÉDICALES :', margin + 3, y + 13.8);
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('Allergies médicales :', margin + 3, y + 13.8);
    }

    doc.setFont('helvetica', 'normal');
    const allgList = [
      cerfa.medicalInfo?.allergies?.asthme ? 'Asthme' : null,
      cerfa.medicalInfo?.allergies?.medicamenteuses ? 'Médicamenteuses' : null,
      cerfa.medicalInfo?.allergies?.autres ? cerfa.medicalInfo.allergies.autres : null,
    ].filter(Boolean);
    const allgStr = allgList.length > 0 ? allgList.join(', ') : 'Aucune allergie médicale signalée';
    const actionStr = cerfa.medicalInfo?.allergyCauseAndAction ? ` | Conduite : ${cerfa.medicalInfo.allergyCauseAndAction}` : '';
    if (hasMedAllergies) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(153, 27, 27);
    } else {
      doc.setTextColor(60, 60, 60);
    }
    doc.text(`${allgStr}${actionStr}`, margin + 42, y + 13.8);

    // Row 4: Maladies infantiles & difficultés
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text('Antécédents & difficultés :', margin + 3, y + 18);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    const checkedAntecedents = cerfa.medicalInfo?.antecedents
      ? Object.entries(cerfa.medicalInfo.antecedents)
          .filter(([_, val]) => Boolean(val))
          .map(([key]) => key.charAt(0).toUpperCase() + key.slice(1))
      : [];
    const anteText = checkedAntecedents.length > 0 ? checkedAntecedents.join(', ') : 'R.A.S.';
    const diffText = cerfa.medicalInfo?.healthDifficulties ? ` | Difficultés : ${cerfa.medicalInfo.healthDifficulties}` : '';
    doc.text(`${anteText}${diffText}`, margin + 42, y + 18);

    y += 23;

    // --- RUBRIQUE 4 : ALLERGIES ALIMENTAIRES & RÉGIME ALIMENTAIRE (FORTEMENT MIS EN VALEUR) ---
    drawSectionTitle('RUBRIQUE 4 — RÉGIME ALIMENTAIRE & ALLERGIES ALIMENTAIRES');

    const hasFoodAllergy = Boolean(cerfa.medicalInfo?.allergies?.alimentaires);
    const isRestrictedDiet = cerfa.structuredDiet?.category && cerfa.structuredDiet.category !== 'standard';

    // Highlighted background box: amber/orange if restriction/allergy, soft slate if standard
    if (hasFoodAllergy || isRestrictedDiet) {
      doc.setFillColor(254, 243, 199); // Amber highlight
      doc.setDrawColor(245, 158, 11);
    } else {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
    }
    doc.rect(margin, y, contentWidth, 16, 'FD');

    // Row 1: Structured Diet (Prominent)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    if (isRestrictedDiet) {
      doc.setTextColor(180, 83, 9); // Amber-800
      doc.text('★ RÉGIME ALIMENTAIRE :', margin + 3, y + 5);
    } else {
      doc.setTextColor(30, 41, 59);
      doc.text('Régime alimentaire sélectionné :', margin + 3, y + 5);
    }

    doc.setFont('helvetica', isRestrictedDiet ? 'bold' : 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(isRestrictedDiet ? 146 : 60, isRestrictedDiet ? 64 : 60, isRestrictedDiet ? 14 : 60);
    const dietLabels: Record<string, string> = {
      standard: 'Standard / Sans restriction',
      sans_porc: 'SANS PORC',
      vegetarien: 'VÉGÉTARIEN',
    };
    const dietCat = cerfa.structuredDiet?.category || 'standard';
    const dietText = `${dietLabels[dietCat] || dietCat.toUpperCase()}${cerfa.structuredDiet?.details ? ` (Précisions : ${cerfa.structuredDiet.details})` : ''}`;
    doc.text(dietText, margin + 52, y + 5);

    // Row 2: Food allergy
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    if (hasFoodAllergy) {
      doc.setTextColor(185, 28, 28);
      doc.text('⚠ ALLERGIE ALIMENTAIRE & ÉVICTIONS :', margin + 3, y + 11);
    } else {
      doc.setTextColor(30, 41, 59);
      doc.text('Allergie alimentaire & Évictions :', margin + 3, y + 11);
    }

    doc.setFont('helvetica', hasFoodAllergy ? 'bold' : 'normal');
    doc.setTextColor(hasFoodAllergy ? 185 : 60, hasFoodAllergy ? 28 : 60, hasFoodAllergy ? 28 : 60);
    const foodDesc = hasFoodAllergy
      ? `OUI — ${cerfa.parentRecommendations || 'Allergie alimentaire déclarée (consulter PAI / protocole)'}`
      : 'NON — Aucune allergie alimentaire déclarée';
    doc.text(foodDesc, margin + 52, y + 11);

    y += 18;

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
        doc.text('✓ Signé électroniquement', signBoxX + 4, signBoxY + 6.5);
      }
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(180, 83, 9);
      doc.text('(En attente de signature)', signBoxX + 4, signBoxY + 6.5);
    }

    // --- BOTTOM FOOTER (Single Page) ---
    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(140, 140, 140);
    doc.text(
      `Fiche Sanitaire de Liaison officielle — ${resolvedEstablishment} — Document confidentiel`,
      margin,
      291
    );
    doc.text(`Émis le ${new Date().toLocaleDateString('fr-FR')}`, pageWidth - margin, 291, { align: 'right' });

    // Download the single-page PDF directly
    const sanitizedName = `${cerfa.identity?.lastName || 'Eleve'}_${cerfa.identity?.firstName || 'Fiche'}`.replace(
      /[^a-zA-Z0-9_-]/g,
      '_'
    );
    const filename = `Fiche_Sanitaire_${sanitizedName}.pdf`;
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
