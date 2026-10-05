import { Student, User, SchoolClass, Trip, NotificationItem, CerfaSanitarySheet } from '../types';
import { INITIAL_USERS, INITIAL_CLASSES, INITIAL_TRIPS, INITIAL_STUDENTS, INITIAL_NOTIFICATIONS } from '../mockData';
import { computeCerfaCompleteness } from './cerfaValidation';

console.log('[fichesanitaire] build storage-fallback-20261004');

// Cache navigateur tolérant au quota (≈ 5 Mo). Quand localStorage est plein, la donnée reste
// disponible EN MÉMOIRE pour la session. Avant : une base de plus de 5 Mo faisait échouer le
// chargement (« QuotaExceededError ») → nom d'établissement par défaut, comptes de démonstration,
// mots de passe refusés, alors que la base du serveur était intacte.
const memStore = new Map<string, string>();
const kvStorage = {
  getItem(key: string): string | null {
    if (memStore.has(key)) return memStore.get(key) as string;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
      memStore.delete(key);
    } catch {
      // quota dépassé ou stockage bloqué : la valeur reste en mémoire ; l'ancienne copie locale
      // (périmée) est supprimée pour libérer de la place et ne jamais être relue après un rechargement
      memStore.set(key, value);
      try {
        localStorage.removeItem(key);
      } catch {
        /* stockage indisponible */
      }
    }
  },
  removeItem(key: string): void {
    memStore.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      /* stockage indisponible */
    }
  },
};
const STORAGE_KEYS = {
  STUDENTS: 'cerfa_students_v11',
  TRIPS: 'cerfa_trips_v2',
  CLASSES: 'cerfa_classes_v1',
  USERS: 'cerfa_users_v1',
  NOTIFICATIONS: 'cerfa_notifications_v1',
  CURRENT_USER_ID: 'cerfa_current_user_id_v1',
  ESTABLISHMENT_NAME: 'cerfa_establishment_name_v1',
  LOGO: 'cerfa_logo_v1',
  REMINDER_TEMPLATE: 'cerfa_reminder_template_v1',
  AUTO_REMINDER_ENABLED: 'cerfa_auto_reminder_enabled_v1',
  AUTO_REMINDER_LAST_RUN: 'cerfa_last_auto_reminder_run_v1',
};

// --- Synchronisation avec le backend (PostgreSQL partagé) ---
// CURRENT_USER_ID reste volontairement local à chaque appareil (session de connexion).
const API_BASE = '';

async function pushToServer(key: string, value: unknown): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/data/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  } catch (e) {
    console.error('Synchronisation serveur impossible pour', key, e);
  }
}

export async function bootstrapFromServer(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/data`);
    if (!res.ok) throw new Error('Réponse serveur invalide');
    const data: Record<string, unknown> = await res.json();
    // Les clés sont enregistrées de la plus PETITE à la plus GRANDE : comptes, nom de l'établissement,
    // classes, voyages passent toujours, même si les fiches (volumineuses) dépassent le quota du navigateur.
    const entries = Object.entries(STORAGE_KEYS)
      .filter(([name, key]) => name !== 'CURRENT_USER_ID' && Object.prototype.hasOwnProperty.call(data, key))
      .map(([, key]) => [key, JSON.stringify((data as any)[key])] as [string, string])
      .sort((a, b) => a[1].length - b[1].length);
    for (const [key, value] of entries) kvStorage.setItem(key, value);
  } catch (e) {
    console.error('Impossible de charger les données depuis le serveur, utilisation du cache local existant.', e);
  }
}

console.log('[fichesanitaire] build etablissement-20261005');

export const DEFAULT_ESTABLISHMENT_NAME = 'Ensemble Scolaire Notre Dame des Missions';

export function getStoredEstablishmentName(): string {
  try {
    const raw = kvStorage.getItem(STORAGE_KEYS.ESTABLISHMENT_NAME);
    if (raw && raw.trim()) {
      let value = raw.trim();
      // Auto-réparation : d'anciennes versions pouvaient stocker la valeur
      // avec plusieurs niveaux d'encodage JSON imbriqués par erreur.
      for (let i = 0; i < 5; i++) {
        if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
          try {
            const parsed = JSON.parse(value);
            if (typeof parsed !== 'string') break;
            value = parsed;
          } catch {
            break;
          }
        } else {
          break;
        }
      }
      if (value.trim()) return value.trim();
    }
  } catch (e) {
    console.error(e);
  }
  return DEFAULT_ESTABLISHMENT_NAME;
}

export async function saveStoredEstablishmentName(name: string): Promise<void> {
  try {
    kvStorage.setItem(STORAGE_KEYS.ESTABLISHMENT_NAME, JSON.stringify(name.trim()));
    await pushToServer(STORAGE_KEYS.ESTABLISHMENT_NAME, name.trim());
  } catch (e) {
    console.error(e);
  }
}

export function getStoredLogo(): string | null {
  try {
    const raw = kvStorage.getItem(STORAGE_KEYS.LOGO);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }
  return null;
}

export async function saveStoredLogo(dataUrl: string | null): Promise<void> {
  try {
    if (dataUrl) {
      kvStorage.setItem(STORAGE_KEYS.LOGO, JSON.stringify(dataUrl));
    } else {
      kvStorage.removeItem(STORAGE_KEYS.LOGO);
    }
    await pushToServer(STORAGE_KEYS.LOGO, dataUrl);
  } catch (e) {
    console.error(e);
  }
}

export interface ReminderTemplate {
  subject: string;
  body: string;
}

export function getStoredReminderTemplate(): ReminderTemplate | null {
  try {
    const raw = kvStorage.getItem(STORAGE_KEYS.REMINDER_TEMPLATE);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }
  return null;
}

export async function saveStoredReminderTemplate(template: ReminderTemplate): Promise<void> {
  try {
    kvStorage.setItem(STORAGE_KEYS.REMINDER_TEMPLATE, JSON.stringify(template));
    await pushToServer(STORAGE_KEYS.REMINDER_TEMPLATE, template);
  } catch (e) {
    console.error(e);
  }
}

export function getStoredAutoReminderEnabled(): boolean {
  try {
    const raw = kvStorage.getItem(STORAGE_KEYS.AUTO_REMINDER_ENABLED);
    if (raw !== null) return JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }
  return true; // activé par défaut tant que l'admin ne l'a pas désactivé
}

export async function saveStoredAutoReminderEnabled(enabled: boolean): Promise<void> {
  try {
    kvStorage.setItem(STORAGE_KEYS.AUTO_REMINDER_ENABLED, JSON.stringify(enabled));
    await pushToServer(STORAGE_KEYS.AUTO_REMINDER_ENABLED, enabled);
  } catch (e) {
    console.error(e);
  }
}

export interface AutoReminderRunSummary {
  ranAt: string;
  sent: number;
  failed: number;
  total: number;
  error?: string;
}

// Lecture seule : ce statut n'est écrit que par le serveur après chaque exécution.
export function getStoredAutoReminderLastRun(): AutoReminderRunSummary | null {
  try {
    const raw = kvStorage.getItem(STORAGE_KEYS.AUTO_REMINDER_LAST_RUN);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }
  return null;
}

export function getStoredUsers(): User[] {
  try {
    const raw = kvStorage.getItem(STORAGE_KEYS.USERS);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }
  return INITIAL_USERS;
}

export async function saveStoredUsers(users: User[]): Promise<void> {
  kvStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
  await pushToServer(STORAGE_KEYS.USERS, users);
}

// Équivalent fusionné pour UN SEUL compte (création, mot de passe, édition).
export async function upsertStoredUser(user: User): Promise<void> {
  try {
    const raw = kvStorage.getItem(STORAGE_KEYS.USERS);
    const list: User[] = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex((u) => u.id === user.id);
    if (idx === -1) list.push(user);
    else list[idx] = user;
    kvStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(list));
  } catch (e) {
    console.error(e);
  }
  await fetch('/api/users/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user }),
  });
}

export async function removeStoredUser(userId: string): Promise<void> {
  try {
    const raw = kvStorage.getItem(STORAGE_KEYS.USERS);
    const list: User[] = raw ? JSON.parse(raw) : [];
    kvStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(list.filter((u) => u.id !== userId)));
  } catch (e) {
    console.error(e);
  }
  await fetch('/api/users/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
}

export function getCurrentUser(): User {
  const users = getStoredUsers();
  const id = kvStorage.getItem(STORAGE_KEYS.CURRENT_USER_ID);
  const found = users.find((u) => u.id === id);
  return found || users[0];
}

export function setCurrentUserId(id: string): void {
  kvStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, id);
}

export function getStoredCurrentUserId(): string | null {
  return kvStorage.getItem(STORAGE_KEYS.CURRENT_USER_ID);
}

export function clearStoredCurrentUserId(): void {
  kvStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
}

export function getStoredStudents(): Student[] {
  try {
    const raw = kvStorage.getItem(STORAGE_KEYS.STUDENTS);
    if (raw) {
      const parsed: Student[] = JSON.parse(raw);
      return parsed.map((s) => {
        const v = s.cerfa.vaccinations;
        const dummyDates = ['2023-05-10', '10/05/2023', '2016-03-12', '2016-09-20', '2017-04-15'];
        if (v?.obligatoires) {
          Object.keys(v.obligatoires).forEach((key) => {
            const item = (v.obligatoires as any)[key];
            if (item && dummyDates.includes(item.lastBoosterDate)) {
              item.lastBoosterDate = '';
              item.done = null;
            }
          });
        }
        if (v?.recommandes) {
          Object.keys(v.recommandes).forEach((key) => {
            const item = (v.recommandes as any)[key];
            if (item && dummyDates.includes(item.date)) {
              item.date = '';
              item.done = false;
            }
          });
        }
        const completeness = computeCerfaCompleteness(s.cerfa);
        return {
          ...s,
          completenessPercent: completeness.percent,
          status: (completeness.isComplete ? 'complete' : 'incomplete') as 'complete' | 'incomplete',
        };
      });
    }
  } catch (e) {
    console.error(e);
  }
  const initialized: Student[] = INITIAL_STUDENTS.map((s) => {
    const completeness = computeCerfaCompleteness(s.cerfa);
    return {
      ...s,
      completenessPercent: completeness.percent,
      status: (completeness.isComplete ? 'complete' : 'incomplete') as 'complete' | 'incomplete',
    };
  });
  // IMPORTANT : ne jamais ré-enregistrer ces données de démonstration vers le
  // serveur ici. Si le cache local est vide pour une raison quelconque (nouvel
  // appareil, navigation privée, cache vidé, échec réseau temporaire), cette
  // valeur de repli ne doit rester que locale et provisoire pour cet affichage
  // — jamais écraser la vraie liste déjà enregistrée côté serveur.
  return initialized;
}

export async function saveStoredStudents(students: Student[]): Promise<void> {
  kvStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));
  await pushToServer(STORAGE_KEYS.STUDENTS, students);
}

// Écriture fusionnée côté serveur pour UN SEUL élève — à utiliser pour toute
// opération qui ne touche qu'un élève (ajout, édition de fiche, inscription à
// un voyage, suppression/restauration, changement de classe/pension...).
// Contrairement à saveStoredStudents (qui envoie TOUTE la liste), ceci ne
// peut jamais écraser ce que d'autres utilisateurs ont ajouté entre-temps,
// même si le cache local de ce navigateur est périmé.
console.log('[fichesanitaire] build dup-guard-20261001');

// Clé de comparaison prénom + nom (sans accents, insensible à la casse et à l'ordre)
function dupNormClient(v: string | undefined): string {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
export function studentDuplicateKey(s: Student): string {
  const idt = s.cerfa?.identity;
  return [dupNormClient(idt?.firstName), dupNormClient(idt?.lastName)].sort().join('|');
}

// Demande au serveur si une fiche existe déjà pour ce prénom + nom (aucune donnée perso renvoyée)
export async function checkStudentDuplicate(
  firstName: string,
  lastName: string,
  parentId?: string,
  excludeStudentId?: string
): Promise<{ duplicate: boolean; sameAccount: boolean }> {
  try {
    const res = await fetch('/api/students/check-duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, parentId, excludeStudentId }),
    });
    if (!res.ok) return { duplicate: false, sameAccount: false };
    return await res.json();
  } catch {
    return { duplicate: false, sameAccount: false };
  }
}

// Retourne false si le serveur refuse la création pour cause de doublon (options.checkDuplicate)
export async function upsertStoredStudent(
  student: Student,
  options?: { checkDuplicate?: boolean }
): Promise<boolean> {
  const updateLocalCache = () => {
    // Met aussi à jour le cache local pour un affichage immédiat cohérent,
    // sans jamais l'utiliser comme source de vérité pour l'écriture serveur.
    try {
      const raw = kvStorage.getItem(STORAGE_KEYS.STUDENTS);
      const list: Student[] = raw ? JSON.parse(raw) : [];
      const idx = list.findIndex((s) => s.id === student.id);
      if (idx === -1) list.push(student);
      else list[idx] = student;
      kvStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(list));
    } catch (e) {
      console.error(e);
    }
  };

  if (options?.checkDuplicate) {
    const res = await fetch('/api/students/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student, checkDuplicate: true }),
    });
    if (res.status === 409) return false;
    updateLocalCache();
    return true;
  }

  updateLocalCache();
  await fetch('/api/students/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student }),
  });
  return true;
}

console.log('[fichesanitaire] build anti-overwrite-20261001');

// --- Anti-écrasement : enregistrements de fiche avec contrôle de version ---
// "baseUpdatedAt" = version de la fiche sur laquelle l'utilisateur s'appuie. Si le serveur
// a une version plus récente (enregistrée par quelqu'un d'autre), il refuse (conflict).
// Les enregistrements sont exécutés l'un après l'autre (jamais en parallèle).
export interface CheckedSaveResult {
  ok: boolean;
  conflict: boolean;
  error?: string;
}

let studentEditQueue: Promise<unknown> = Promise.resolve();
function enqueueStudentEdit<T>(task: () => Promise<T>): Promise<T> {
  const run = studentEditQueue.then(task, task);
  studentEditQueue = run.catch(() => undefined);
  return run;
}

function cacheStudentLocally(student: Student): void {
  try {
    const raw = kvStorage.getItem(STORAGE_KEYS.STUDENTS);
    const list: Student[] = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex((s) => s.id === student.id);
    if (idx === -1) list.push(student);
    else list[idx] = student;
    kvStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(list));
  } catch (e) {
    console.error(e);
  }
}

async function sendCheckedSave(
  url: string,
  method: 'POST' | 'PUT',
  student: Student,
  baseUpdatedAt?: string
): Promise<CheckedSaveResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student, baseUpdatedAt }),
    });
    if (res.status === 409) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, conflict: j.error === 'conflict', error: j.error };
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, conflict: false, error: j.error || `Erreur serveur (${res.status})` };
    }
    cacheStudentLocally(student);
    return { ok: true, conflict: false };
  } catch (e) {
    return { ok: false, conflict: false, error: 'Serveur injoignable' };
  }
}

// Portail connecté (parent / administration)
export function saveStudentChecked(student: Student, baseUpdatedAt?: string): Promise<CheckedSaveResult> {
  return enqueueStudentEdit(() => sendCheckedSave('/api/students/upsert', 'POST', student, baseUpdatedAt));
}

// Lien direct (sans connexion)
export function saveStudentViaLink(token: string, student: Student, baseUpdatedAt?: string): Promise<CheckedSaveResult> {
  return enqueueStudentEdit(() =>
    sendCheckedSave(`/api/magic-link/${encodeURIComponent(token)}`, 'PUT', student, baseUpdatedAt)
  );
}
// Suppression définitive fusionnée côté serveur d'UN SEUL élève (corbeille).
export async function removeStoredStudent(studentId: string): Promise<void> {
  try {
    const raw = kvStorage.getItem(STORAGE_KEYS.STUDENTS);
    const list: Student[] = raw ? JSON.parse(raw) : [];
    kvStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(list.filter((s) => s.id !== studentId)));
  } catch (e) {
    console.error(e);
  }
  await fetch('/api/students/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId }),
  });
}

export function getStoredTrips(): Trip[] {
  try {
    const raw = kvStorage.getItem(STORAGE_KEYS.TRIPS);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }
  // IMPORTANT : jamais de ré-enregistrement automatique ici (voir getStoredStudents).
  return INITIAL_TRIPS;
}

export async function saveStoredTrips(trips: Trip[]): Promise<void> {
  kvStorage.setItem(STORAGE_KEYS.TRIPS, JSON.stringify(trips));
  await pushToServer(STORAGE_KEYS.TRIPS, trips);
}

export function getStoredClasses(): SchoolClass[] {
  try {
    const raw = kvStorage.getItem(STORAGE_KEYS.CLASSES);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }
  // IMPORTANT : jamais de ré-enregistrement automatique ici (voir getStoredStudents).
  return INITIAL_CLASSES;
}

export async function saveStoredClasses(classes: SchoolClass[]): Promise<void> {
  kvStorage.setItem(STORAGE_KEYS.CLASSES, JSON.stringify(classes));
  await pushToServer(STORAGE_KEYS.CLASSES, classes);
}

export function getStoredNotifications(): NotificationItem[] {
  try {
    const raw = kvStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error(e);
  }
  saveStoredNotifications(INITIAL_NOTIFICATIONS);
  return INITIAL_NOTIFICATIONS;
}

export async function saveStoredNotifications(notifs: NotificationItem[]): Promise<void> {
  kvStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifs));
  await pushToServer(STORAGE_KEYS.NOTIFICATIONS, notifs);
}

export function createBlankCerfa(studentName: { firstName: string; lastName: string; birthDate: string; gender: 'Garcon' | 'Fille' }): CerfaSanitarySheet {
  return {
    identity: {
      lastName: studentName.lastName.toUpperCase(),
      firstName: studentName.firstName,
      birthDate: studentName.birthDate,
      gender: studentName.gender,
      childMobilePhone: '',
      socialSecurityNumber: '',
    },
    vaccinations: {
      obligatoires: {
        diphterie: { done: null, lastBoosterDate: '' },
        tetanos: { done: null, lastBoosterDate: '' },
        poliomyelite: { done: null, lastBoosterDate: '' },
        dtPolio: { done: null, lastBoosterDate: '' },
        tetracoq: { done: null, lastBoosterDate: '' },
      },
      hasContraindication: false,
      contraindicationDetails: '',
      recommandes: {
        bcg: { done: false, date: '' },
        hepatiteB: { done: false, date: '' },
        ror: { done: false, date: '' },
        coqueluche: { done: false, date: '' },
        autres: { done: false, date: '', name: '' },
      },
    },
    medicalInfo: {
      hasMedicalTreatment: false,
      treatmentDetails: '',
      hasPrescriptionAttached: false,
      antecedents: {
        rubeole: false,
        varicelle: false,
        angines: false,
        rhumatismes: false,
        scarlatine: false,
        coqueluche: false,
        otites: false,
        asthme: false,
        rougeole: false,
        oreillons: false,
      },
      allergies: {
        asthme: false,
        medicamenteuses: false,
        alimentaires: false,
        autres: '',
      },
      allergyCauseAndAction: '',
      isSelfMedicationReported: false,
      healthDifficulties: '',
    },
    parentRecommendations: '',
    structuredDiet: {
      category: 'standard',
      details: '',
    },
    treatingDoctor: {
      name: '',
      phone: '',
    },
    legalGuardian: {
      fullName: '',
      relationship: '',
      address: '',
      homePhone: '',
      workPhone: '',
      mobilePhone: '',
      email: '',
    },
    declarationAccepted: false,
    signature: {
      signedByName: '',
      signedDate: '',
      signatureDataUrl: '',
      validatedAt: '',
      version: 0,
    },
    documents: [],
    history: [
      {
        id: 'h-' + Date.now(),
        date: new Date().toISOString().replace('T', ' ').substring(0, 16),
        action: 'Création de la fiche CERFA n°10008*02',
        authorName: 'Parent',
        authorRole: 'Parent',
        details: 'Initialisation du dossier',
      },
    ],
    versions: [],
  };
}

export function updateStudentInStorage(student: Student): void {
  const students = getStoredStudents();
  const check = computeCerfaCompleteness(student.cerfa);
  student.completenessPercent = check.percent;
  student.status = check.isComplete ? 'complete' : 'incomplete';
  student.updatedAt = new Date().toISOString();

  const idx = students.findIndex((s) => s.id === student.id);
  if (idx >= 0) {
    students[idx] = student;
  } else {
    students.push(student);
  }
  saveStoredStudents(students);
}

export function exportTripCsv(trip: Trip, students: Student[]): void {
  const headers = ['Nom', 'Prenom', 'Classe', 'Regime_Alimentaire', 'Details_Regime', 'Statut_Pension', 'Statut_Fiche', 'Completude_Pourcentage', 'Allergies', 'Traitement_En_Cours', 'Tel_Responsable'];

  const rows = students.map((s) => {
    const hasAllergy = s.cerfa.medicalInfo.allergies.asthme ||
      s.cerfa.medicalInfo.allergies.medicamenteuses ||
      s.cerfa.medicalInfo.allergies.alimentaires ||
      Boolean(s.cerfa.medicalInfo.allergies.autres);

    return [
      `"${s.cerfa.identity.lastName}"`,
      `"${s.cerfa.identity.firstName}"`,
      `"${s.schoolClass}"`,
      `"${s.cerfa.structuredDiet.category}"`,
      `"${(s.cerfa.structuredDiet.details || '').replace(/"/g, '""')}"`,
      `"${s.boardingStatus}"`,
      `"${s.status === 'complete' ? 'Complete' : 'Incomplete'}"`,
      `"${s.completenessPercent}%"`,
      `"${hasAllergy ? 'OUI' : 'NON'}"`,
      `"${s.cerfa.medicalInfo.hasMedicalTreatment ? 'OUI' : 'NON'}"`,
      `"${s.cerfa.legalGuardian.mobilePhone || s.cerfa.legalGuardian.homePhone || ''}"`,
    ].join(';');
  });

  const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `liste_eleves_${trip.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function resetToMockData(): void {
  saveStoredUsers(INITIAL_USERS);
  saveStoredStudents(INITIAL_STUDENTS);
  saveStoredTrips(INITIAL_TRIPS);
  saveStoredClasses(INITIAL_CLASSES);
  saveStoredNotifications(INITIAL_NOTIFICATIONS);
  kvStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
}

export function purgeDemoAccounts(keepUserId?: string): { users: User[]; students: Student[] } {
  const currentUsers = getStoredUsers();

  const adminUser: User = (keepUserId ? currentUsers.find((u) => u.id === keepUserId) : null) ||
    currentUsers.find((u) => u.role === 'admin') || {
    id: 'user-admin-1',
    name: 'Alexandre CHEN',
    firstName: 'Alexandre',
    lastName: 'CHEN',
    email: 'admin.sanitaire@jeanmoulin.fr',
    role: 'admin',
    phone: '01 45 67 89 00',
    password: 'admin123',
    secretQuestion: 'Dans quelle ville êtes-vous né(e) ?',
    secretAnswer: 'Lyon',
    isDemo: false,
  };

  const organizerUser: User = currentUsers.find((u) => u.role === 'organizer' && u.id !== adminUser.id) || {
    id: 'user-organizer-1',
    name: 'Thomas VASSEUR',
    firstName: 'Thomas',
    lastName: 'VASSEUR',
    email: 't.vasseur@ac-paris.fr',
    role: 'organizer',
    phone: '06 98 76 54 32',
    assignedTripIds: ['trip-1'],
    password: 'prof123',
    secretQuestion: 'Quel était le nom de votre premier animal de compagnie ?',
    secretAnswer: 'Rex',
    isDemo: false,
  };

  const demoParentIds = ['user-parent-1', 'user-parent-2'];
  const nonDemoParents = currentUsers.filter(
    (u) => u.role === 'parent' && !u.isDemo && !demoParentIds.includes(u.id)
  );

  const finalUsers: User[] = [
    { ...adminUser, isDemo: false },
    { ...organizerUser, isDemo: false },
    ...nonDemoParents.filter((u) => u.id !== adminUser.id && u.id !== organizerUser.id),
  ];
  saveStoredUsers(finalUsers);

  const currentStudents = getStoredStudents();
  const demoStudentIds = ['stu-1', 'stu-2', 'stu-3', 'stu-4', 'stu-5', 'stu-6'];
  const nonDemoStudents = currentStudents.filter((s) => !demoStudentIds.includes(s.id));
  saveStoredStudents(nonDemoStudents);

  if (keepUserId) {
    setCurrentUserId(keepUserId);
  } else {
    kvStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
  }

  return { users: finalUsers, students: nonDemoStudents };
}
