export type UserRole = 'parent' | 'organizer' | 'admin';

export const SECRET_QUESTIONS = [
  "Quel est le nom de jeune fille de votre mère ?",
  "Quel était le nom de votre premier animal de compagnie ?",
  "Dans quelle ville êtes-vous né(e) ?",
  "Quel est le nom de votre école primaire ?",
  "Quel est votre plat ou dessert d'enfance préféré ?",
  "Quelle est la marque ou le modèle de votre première voiture ?",
  "Quel est le prénom de votre grand-mère maternelle ?",
  "Quel est le lieu de vos vacances d'enfance inoubliables ?",
] as const;

export interface User {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email: string;
  role: UserRole;
  phone?: string;
  assignedTripIds?: string[];
  password?: string;
  secretQuestion?: string;
  secretAnswer?: string;
  isDemo?: boolean;
}

export type Gender = 'Garcon' | 'Fille';
export type BoardingStatus = 'DP' | 'Externe' | 'Interne';

export type DietCategory =
  | 'aucun'
  | 'standard'
  | 'sans_porc'
  | 'sans_viande'
  | 'vegetarien'
  | 'allergie_alimentaire';

export interface VaccineBooster {
  done?: boolean | null;
  lastBoosterDate: string; // YYYY-MM-DD or DD/MM/YYYY
}

export interface RecommendedVaccine {
  done: boolean;
  date: string;
  name?: string;
}

export interface CerfaMedicalAntecedents {
  rubeole: boolean;
  varicelle: boolean;
  angines: boolean;
  rhumatismes: boolean;
  scarlatine: boolean;
  coqueluche: boolean;
  otites: boolean;
  asthme: boolean;
  rougeole: boolean;
  oreillons: boolean;
}

export interface CerfaAllergies {
  asthme: boolean;
  medicamenteuses: boolean;
  alimentaires: boolean;
  autres: string;
}

export interface AttachedDocument {
  id: string;
  name: string;
  type: 'ordonnance' | 'certificat_contre_indication' | 'justificatif_vaccin' | 'pai' | 'autre';
  uploadDate: string;
  sizeKb: number;
  fileName: string;
  sensitiveMedical: boolean;
  dataUrl?: string;
}

export interface HistoryEntry {
  id: string;
  date: string;
  action: string;
  authorName: string;
  authorRole: string;
  details?: string;
}

export interface CerfaVersion {
  versionNumber: number;
  signedDate: string;
  signedBy: string;
  summary: string;
}

export interface CerfaSanitarySheet {
  // 1- ENFANT
  identity: {
    lastName: string;
    firstName: string;
    birthDate: string;
    gender: Gender;
    childMobilePhone: string;
    socialSecurityNumber: string;
  };
  // 2- VACCINATIONS
  vaccinations: {
    obligatoires: {
      diphterie: VaccineBooster;
      tetanos: VaccineBooster;
      poliomyelite: VaccineBooster;
      dtPolio: VaccineBooster;
      tetracoq: VaccineBooster;
    };
    hasContraindication: boolean;
    contraindicationDetails: string;
    recommandes: {
      bcg: RecommendedVaccine;
      hepatiteB: RecommendedVaccine;
      ror: RecommendedVaccine;
      coqueluche: RecommendedVaccine;
      autres: RecommendedVaccine;
    };
  };
  // 3- RENSEIGNEMENTS MEDICAUX
  medicalInfo: {
    hasMedicalTreatment: boolean;
    treatmentDetails: string;
    hasPrescriptionAttached: boolean;
    hasPai?: boolean; // Projet d'Accueil Individualisé
    paiDetails?: string;
    antecedents: CerfaMedicalAntecedents;
    allergies: CerfaAllergies;
    allergyCauseAndAction: string; // Cause de l'allergie et conduite à tenir (obligatoire si allergie)
    isSelfMedicationReported: boolean; // Si automédication, le signaler
    healthDifficulties: string; // Maladie, accident, crises convulsives, hospitalisation, etc.
  };
  // 4- RECOMMANDATIONS DES PARENTS
  parentRecommendations: string; // Champ libre CERFA ("Régime alimentaire, religieux etc.")
  structuredDiet: {
    category: DietCategory;
    details: string;
  };
  // 5- MEDECIN TRAITANT
  treatingDoctor: {
    name: string;
    phone: string;
  };
  // 6- RESPONSABLE LEGAL & DECLARATION
  legalGuardian: {
    fullName: string;
    relationship: string;
    address: string;
    homePhone: string;
    workPhone: string;
    mobilePhone: string;
    email: string;
  };
  declarationAccepted: boolean;
  signature: {
    signedByName: string;
    signedDate: string;
    signatureDataUrl: string;
    validatedAt: string;
    version: number;
    method?: 'drawn' | 'uploaded'; // tracée à l'écran ou image importée par l'administration
    uploadedBy?: string;
  };
  documents: AttachedDocument[];
  history: HistoryEntry[];
  versions: CerfaVersion[];
}

export interface Student {
  id: string;
  parentId: string;
  // Données de gestion de l'établissement (séparées du CERFA)
  schoolEstablishment: string;
  schoolClass: string;
  schoolLevel: string;
  internalId: string;
  schoolYear: string;
  boardingStatus: BoardingStatus;
  
  // Fiche sanitaire officielle CERFA n°10008*02
  cerfa: CerfaSanitarySheet;
  
  completenessPercent: number;
  status: 'complete' | 'incomplete';
  registeredTripIds: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string; // présent = fiche dans la corbeille (suppression définitive auto. après 30 jours)
  pdfSentAt?: string; // date/heure du dernier envoi automatique du PDF complet à vacances@notredamedesmissions.com
}

export interface SchoolClass {
  id: string;
  name: string; // e.g. "6e A"
  level: string; // e.g. "6e"
  studentCount: number;
  mainTeacher?: string;
}

export interface Trip {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  eligibleClasses: string[];
  organizerId: string;
  organizerName: string;
  organizerId2?: string;
  organizerName2?: string;
  maxStudents: number;
  description: string;
  status: 'ouvert' | 'clos' | 'archive';
  requireTripSelectionToSave?: boolean;
  contactTeacher1?: string;
  contactTeacher2?: string;
  chaperonePassword?: string;
  showPrintReminderBanner?: boolean;
}

export interface NotificationItem {
  id: string;
  targetRole: UserRole | 'all';
  targetUserId?: string;
  title: string;
  message: string;
  date: string;
  read: boolean;
  type: 'info' | 'warning' | 'alert';
}
