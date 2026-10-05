import { CerfaSanitarySheet } from '../types';

export interface CompletenessResult {
  percent: number;
  isComplete: boolean;
  missingFields: string[];
  warnings: string[];
}

export type FormSectionId = 'identite' | 'vaccins' | 'medical' | 'regime' | 'signature';

/**
 * Détermine la première page du formulaire contenant un champ obligatoire
 * manquant, pour pouvoir y amener directement un parent (lien direct sans
 * connexion, relance par e-mail...) plutôt que de le laisser repartir du début.
 */
export function getFirstIncompleteSectionId(cerfa: CerfaSanitarySheet): FormSectionId {
  if (
    !cerfa.identity.lastName.trim() ||
    !cerfa.identity.firstName.trim() ||
    !cerfa.identity.birthDate ||
    !cerfa.identity.gender
  ) {
    return 'identite';
  }

  if (cerfa.medicalInfo.hasMedicalTreatment && !cerfa.medicalInfo.treatmentDetails.trim()) {
    return 'medical';
  }
  if (cerfa.medicalInfo.hasPai && !cerfa.documents.some((d) => d.type === 'pai')) {
    return 'medical';
  }
  const hasAllergy =
    cerfa.medicalInfo.allergies.asthme ||
    cerfa.medicalInfo.allergies.medicamenteuses ||
    cerfa.medicalInfo.allergies.alimentaires ||
    (cerfa.medicalInfo.allergies.autres && cerfa.medicalInfo.allergies.autres.trim().length > 0);
  if (hasAllergy && (!cerfa.medicalInfo.allergyCauseAndAction || cerfa.medicalInfo.allergyCauseAndAction.trim().length < 3)) {
    return 'medical';
  }

  if (!cerfa.structuredDiet.category || cerfa.structuredDiet.category === 'aucun') {
    return 'regime';
  }
  if (cerfa.structuredDiet.category === 'allergie_alimentaire' && !cerfa.structuredDiet.details.trim()) {
    return 'regime';
  }

  const lg = cerfa.legalGuardian;
  const hasContact = lg.mobilePhone?.trim() || lg.homePhone?.trim();
  if (!lg.fullName.trim() || !hasContact || !lg.address?.trim()) {
    return 'signature';
  }
  if (!cerfa.declarationAccepted || !cerfa.signature.signatureDataUrl || !cerfa.signature.signedByName.trim()) {
    return 'signature';
  }

  return 'signature';
}

export function computeCerfaCompleteness(cerfa: CerfaSanitarySheet): CompletenessResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  let score = 0;
  const totalPoints = 14;

  // 1. Identité
  if (
    cerfa.identity.lastName.trim() &&
    cerfa.identity.firstName.trim() &&
    cerfa.identity.birthDate &&
    cerfa.identity.gender
  ) {
    score += 2;
  } else {
    if (!cerfa.identity.lastName.trim()) missing.push("Nom de famille de l'enfant");
    if (!cerfa.identity.firstName.trim()) missing.push("Prénom de l'enfant");
    if (!cerfa.identity.birthDate) missing.push("Date de naissance de l'enfant");
    if (!cerfa.identity.gender) missing.push("Sexe de l'enfant (Garçon / Fille)");
  }

  // 2. Vaccinations (Optionnel / Informatif - Non obligatoire)
  // Les vaccins ne bloquent plus la complétude de la fiche
  score += 2;

  // 3. Vaccins recommandés (consultés)
  score += 1;

  // 4. Traitement médical (L'ordonnance n'est plus obligatoire)
  if (cerfa.medicalInfo.hasMedicalTreatment) {
    if (cerfa.medicalInfo.treatmentDetails.trim()) {
      score += 2;
    } else {
      missing.push("Détail du traitement médical en cours (médicament, posologie)");
    }
  } else {
    score += 2;
  }

  // 5. PAI (Projet d'Accueil Individualisé)
  if (cerfa.medicalInfo.hasPai) {
    const hasPaiDoc = cerfa.documents.some((d) => d.type === 'pai');
    if (hasPaiDoc) {
      score += 1;
    } else {
      missing.push("Document PAI (téléverser le protocole médical PAI officiel)");
    }
  } else {
    score += 1;
  }

  // 6. Allergies & Conduite à tenir
  const hasAllergy =
    cerfa.medicalInfo.allergies.asthme ||
    cerfa.medicalInfo.allergies.medicamenteuses ||
    cerfa.medicalInfo.allergies.alimentaires ||
    (cerfa.medicalInfo.allergies.autres && cerfa.medicalInfo.allergies.autres.trim().length > 0);

  if (hasAllergy) {
    if (cerfa.medicalInfo.allergyCauseAndAction && cerfa.medicalInfo.allergyCauseAndAction.trim().length >= 3) {
      score += 2;
    } else {
      missing.push("Cause de l'allergie et conduite à tenir d'urgence (obligatoire en cas d'allergie)");
    }
  } else {
    score += 2;
  }

  // 7. Régime alimentaire & Restauration
  if (cerfa.structuredDiet.category && cerfa.structuredDiet.category !== 'aucun') {
    if (
      cerfa.structuredDiet.category === 'allergie_alimentaire' &&
      !cerfa.structuredDiet.details.trim()
    ) {
      missing.push("Précisions sur le régime alimentaire sélectionné");
    } else {
      score += 1;
    }
  } else {
    missing.push("Régime alimentaire (Sélectionner au moins 'Standard', 'Sans porc' ou 'Végétarien')");
  }

  // 8. Responsable légal
  const lg = cerfa.legalGuardian;
  const hasContact = lg.mobilePhone?.trim() || lg.homePhone?.trim();
  if (lg.fullName.trim() && hasContact && lg.address?.trim()) {
    score += 2;
  } else {
    if (!lg.fullName.trim()) missing.push("Nom complet du responsable légal");
    if (!hasContact) missing.push("Numéro de téléphone d'urgence du responsable légal");
    if (!lg.address?.trim()) missing.push("Adresse postale du domicile");
  }

  // 9. Déclaration légale et Signature
  if (cerfa.declarationAccepted && cerfa.signature.signatureDataUrl && cerfa.signature.signedByName.trim()) {
    score += 2;
  } else {
    if (!cerfa.declarationAccepted) missing.push("Attestation sur l'honneur et autorisation de soins cochée");
    if (!cerfa.signature.signatureDataUrl) missing.push("Signature électronique manuscrite du responsable légal");
  }

  const percent = missing.length === 0 ? 100 : Math.min(95, Math.max(0, Math.round((score / totalPoints) * 100)));
  const isComplete = missing.length === 0;

  if (cerfa.vaccinations.hasContraindication && !cerfa.vaccinations.contraindicationDetails) {
    warnings.push("Préciser le motif du certificat de contre-indication vaccinale");
  }

  return {
    percent,
    isComplete,
    missingFields: missing,
    warnings,
  };
}

export function formatDateFr(dateStr?: string): string {
  if (!dateStr) return '—';
  if (dateStr.includes('/')) return dateStr;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  } catch {
    return dateStr;
  }
}

export function formatDateTimeFr(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return dateStr;
  }
}
