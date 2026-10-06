import React, { useState } from 'react';
import { Student, Trip, User, SchoolClass } from '../types';
import { ReminderTemplate, AutoReminderRunSummary, studentDuplicateKey } from '../utils/storage';
import { formatDateFr, computeCerfaCompleteness } from '../utils/cerfaValidation';
import { openOrDownloadDocument } from '../utils/documentViewer';
import { YearEndPanel } from './YearEndPanel';
import { PdfRegenerator } from './PdfRegenerator';
import {
  ShieldCheck,
  Users,
  Plane,
  Building,
  Activity,
  Plus,
  Trash2,
  Lock,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  History,
  Pencil,
  X,
  Check,
  UserCheck,
  KeyRound,
  Eye,
  EyeOff,
  CheckCircle2,
  Download,
  FileText,
  School,
  ChevronDown,
  ChevronUp,
  UserPlus,
  ShieldAlert,
  Image as ImageIcon,
  Upload,
  Mail,
  Link2,
  Link2Off,
  Loader2,
  Clock,
  Copy,
  RotateCcw,
} from 'lucide-react';

interface AdminSpaceProps {
  currentUser: User;
  users: User[];
  trips: Trip[];
  students: Student[];
  classes: SchoolClass[];
  establishmentName?: string;
  onUpdateEstablishmentName?: (name: string, applyToAllStudents?: boolean) => void;
  logoUrl?: string | null;
  onUpdateLogo?: (dataUrl: string | null) => void;
  reminderTemplate?: ReminderTemplate | null;
  onUpdateReminderTemplate?: (template: ReminderTemplate) => void;
  autoReminderEnabled?: boolean;
  onToggleAutoReminder?: (enabled: boolean) => void;
  autoReminderLastRun?: AutoReminderRunSummary | null;
  onSelectStudentToView?: (student: Student) => void;
  onAddTrip: (
    newTrip: Omit<Trip, 'id'>,
    organizerAccount?: {
      isNewOrganizer: boolean;
      name: string;
      username: string;
      password?: string;
      phone?: string;
      existingOrganizerId?: string;
    },
    secondOrganizerId?: string
  ) => void;
  onUpdateTrip?: (
    updatedTrip: Trip,
    organizerAssignment?: { organizerId1?: string; organizerId2?: string }
  ) => void;
  onDeleteTrip?: (tripId: string) => void;
  onAddUser: (newUser: Omit<User, 'id'>) => void;
  onDeleteUser?: (userId: string) => void;
  onUpdateUser?: (
    userId: string,
    updates: { name: string; email: string; role: 'parent' | 'organizer' | 'admin'; phone?: string }
  ) => void;
  onDeleteStudent?: (studentId: string) => void;
  trashedStudents?: Student[];
  onRestoreStudent?: (studentId: string) => void;
  onPermanentlyDeleteStudent?: (studentId: string) => void;
  onUpdateStudentClass?: (studentId: string, newClass: string) => void;
  onUpdateStudentBoardingStatus?: (studentId: string, newStatus: 'DP' | 'Externe' | 'Interne') => void;
  onUpdateUserPassword?: (userId: string, newPassword: string) => void | Promise<void>;
  onRegisterTrip?: (studentId: string, tripId: string) => void;
  onUnregisterTrip?: (studentId: string, tripId: string) => void;
  onAddClass: (newClass: SchoolClass) => void;
  onUpdateClass?: (updatedClass: SchoolClass) => void;
  onDeleteClass?: (classId: string) => void;
  onResetData: () => void;
  onPurgeDemo?: () => void;
}

export const AdminSpace: React.FC<AdminSpaceProps> = ({
  currentUser,
  users,
  trips,
  students,
  classes,
  establishmentName = 'Ensemble Scolaire Notre Dame des Missions',
  onUpdateEstablishmentName,
  logoUrl,
  onUpdateLogo,
  reminderTemplate,
  onUpdateReminderTemplate,
  autoReminderEnabled = true,
  onToggleAutoReminder,
  autoReminderLastRun,
  onSelectStudentToView,
  onAddTrip,
  onUpdateTrip,
  onDeleteTrip,
  onAddUser,
  onDeleteUser,
  onUpdateUser,
  onDeleteStudent,
  trashedStudents = [],
  onRestoreStudent,
  onPermanentlyDeleteStudent,
  onUpdateStudentClass,
  onUpdateStudentBoardingStatus,
  onUpdateUserPassword,
  onRegisterTrip,
  onUnregisterTrip,
  onAddClass,
  onUpdateClass,
  onDeleteClass,
  onResetData,
  onPurgeDemo,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'trips' | 'users' | 'classes' | 'establishment' | 'audit' | 'trash'>('overview');
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [editEstablishmentName, setEditEstablishmentName] = useState(establishmentName);
  const [applyToExistingStudents, setApplyToExistingStudents] = useState(true);
  const [establishmentSavedFeedback, setEstablishmentSavedFeedback] = useState(false);

  // Synchronize state if prop updates
  React.useEffect(() => {
    if (establishmentName) {
      setEditEstablishmentName(establishmentName);
    }
  }, [establishmentName]);

  const handleSaveEstablishment = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = editEstablishmentName.trim();
    if (!trimmed) return;
    if (onUpdateEstablishmentName) {
      onUpdateEstablishmentName(trimmed, applyToExistingStudents);
    }
    setEstablishmentSavedFeedback(true);
    setTimeout(() => setEstablishmentSavedFeedback(false), 3500);
  };

  // Logo de l'établissement
  const [logoError, setLogoError] = useState<string>('');

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError('');

    if (!file.type.startsWith('image/')) {
      setLogoError('Le fichier doit être une image (PNG, JPG, SVG...).');
      return;
    }
    const maxSizeBytes = 2 * 1024 * 1024; // 2 Mo
    if (file.size > maxSizeBytes) {
      setLogoError('Image trop lourde (2 Mo maximum). Compressez le logo avant import.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (onUpdateLogo && typeof reader.result === 'string') {
        onUpdateLogo(reader.result);
      }
    };
    reader.onerror = () => setLogoError("Impossible de lire ce fichier.");
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRemoveLogo = () => {
    if (onUpdateLogo) onUpdateLogo(null);
  };

  // Sécurité : changement du mot de passe de l'administrateur actuellement connecté
  const [ownNewPassword, setOwnNewPassword] = useState('');
  const [ownNewPasswordConfirm, setOwnNewPasswordConfirm] = useState('');
  const [showOwnNewPassword, setShowOwnNewPassword] = useState(false);
  const [ownPasswordError, setOwnPasswordError] = useState('');
  const [ownPasswordSaved, setOwnPasswordSaved] = useState(false);

  const handleSaveOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setOwnPasswordError('');
    if (!ownNewPassword.trim() || ownNewPassword.length < 4) {
      setOwnPasswordError('Le mot de passe doit contenir au moins 4 caractères.');
      return;
    }
    if (ownNewPassword !== ownNewPasswordConfirm) {
      setOwnPasswordError('Les deux mots de passe saisis ne correspondent pas.');
      return;
    }
    if (onUpdateUserPassword) {
      try {
        await onUpdateUserPassword(currentUser.id, ownNewPassword.trim());
      } catch (err) {
        setOwnPasswordError("Échec de l'enregistrement côté serveur. Réessayez avant de vous déconnecter.");
        return;
      }
    }
    setOwnNewPassword('');
    setOwnNewPasswordConfirm('');
    setOwnPasswordSaved(true);
    setTimeout(() => setOwnPasswordSaved(false), 3500);
  };

  // Form states for creating trips
  const [newTripName, setNewTripName] = useState('');
  const [newTripDestination, setNewTripDestination] = useState('');
  const [newTripStart, setNewTripStart] = useState('');
  const [newTripEnd, setNewTripEnd] = useState('');
  const [newTripMax, setNewTripMax] = useState<number | ''>('');
  const [newTripClasses, setNewTripClasses] = useState('');
  const [newTripRequireSelection, setNewTripRequireSelection] = useState(false);
  const [newTripTeacher1, setNewTripTeacher1] = useState('');
  const [newTripTeacher2, setNewTripTeacher2] = useState('');
  const [newTripChaperonePassword, setNewTripChaperonePassword] = useState('');
  const [newTripShowPrintReminder, setNewTripShowPrintReminder] = useState(false);
  const [newTripSecondOrganizerId, setNewTripSecondOrganizerId] = useState('');
  
  // Organizer account creation within trip creation form
  const organizerUsers = users.filter((u) => u.role === 'organizer');
  const [orgMode, setOrgMode] = useState<'new' | 'existing'>('new');
  const [orgName, setOrgName] = useState('');
  const [orgUsername, setOrgUsername] = useState('');
  const [orgPassword, setOrgPassword] = useState('');
  const [orgPhone, setOrgPhone] = useState('');
  const [showOrgPassword, setShowOrgPassword] = useState(false);
  const [selectedExistingOrgId, setSelectedExistingOrgId] = useState(organizerUsers[0]?.id || '');
  const [existingOrgNewPassword, setExistingOrgNewPassword] = useState('');

  // Password generator helper
  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
    let res = '';
    for (let i = 0; i < 10; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setOrgPassword(res);
  };

  // Confirmation banner for last created organizer
  const [lastCreatedOrgInfo, setLastCreatedOrgInfo] = useState<{
    tripName: string;
    orgName: string;
  } | null>(null);

  // Form states for creating users in Tab 3
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'parent' | 'organizer' | 'admin'>('organizer');
  const [newUserPassword, setNewUserPassword] = useState('');

  // State for updating any user's password from Users tab
  const [editingPasswordUserId, setEditingPasswordUserId] = useState<string | null>(null);
  const [adminCustomPassword, setAdminCustomPassword] = useState('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserEmail, setEditUserEmail] = useState('');
  const [editUserRole, setEditUserRole] = useState<'parent' | 'organizer' | 'admin'>('parent');
  const [editUserPhone, setEditUserPhone] = useState('');
  const [showAdminCustomPassword, setShowAdminCustomPassword] = useState(false);

  // States for deletions & trip enrollment (Admin)
  const [tripToDelete, setTripToDelete] = useState<Trip | null>(null);
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);
  const [studentToPermanentlyDelete, setStudentToPermanentlyDelete] = useState<Student | null>(null);
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null);
  const [reminderResult, setReminderResult] = useState<{ sent: number; failed: number; failedNames?: string[] } | null>(null);

  const DEFAULT_REMINDER_SUBJECT = 'Fiche sanitaire incomplète — {prenom} {nom}';
  const DEFAULT_REMINDER_BODY = `Bonjour,

La fiche sanitaire de liaison de {prenom} {nom} (classe {classe}) est actuellement incomplète ({pourcentage}%).

Éléments manquants :
{manquants}

Merci de vous connecter au portail pour la compléter :
{lien}

Cordialement,
{etablissement}`;

  // Modèle de message de relance par e-mail (éditable et enregistrable)
  const [editReminderSubject, setEditReminderSubject] = useState(
    reminderTemplate?.subject || DEFAULT_REMINDER_SUBJECT
  );
  const [editReminderBody, setEditReminderBody] = useState(
    reminderTemplate?.body || DEFAULT_REMINDER_BODY
  );
  const [reminderTemplateSaved, setReminderTemplateSaved] = useState(false);

  const handleSaveReminderTemplate = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (onUpdateReminderTemplate) {
      onUpdateReminderTemplate({ subject: editReminderSubject, body: editReminderBody });
    }
    setReminderTemplateSaved(true);
    setTimeout(() => setReminderTemplateSaved(false), 3500);
  };

  const handleResetReminderTemplate = () => {
    setEditReminderSubject(DEFAULT_REMINDER_SUBJECT);
    setEditReminderBody(DEFAULT_REMINDER_BODY);
  };

  // Déclenche immédiatement un cycle de relances automatiques (test / rattrapage)
  const [runningAutoNow, setRunningAutoNow] = useState(false);
  const handleRunAutoNow = async () => {
    setRunningAutoNow(true);
    try {
      const res = await fetch('/api/reminders/run-auto-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portalUrl: window.location.origin }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Échec du lancement des relances automatiques.");
      } else if (data.skipped) {
        alert(
          data.reason === 'disabled'
            ? 'Les relances automatiques sont désactivées.'
            : "Serveur mail non configuré (variables SMTP_* manquantes dans .env)."
        );
      } else {
        setReminderResult({ sent: data.sent, failed: data.failed });
      }
    } catch (e) {
      alert('Serveur injoignable.');
    } finally {
      setRunningAutoNow(false);
    }
  };

  const [reminderDraft, setReminderDraft] = useState<{
    mode: 'single' | 'bulk';
    targets: Student[];
    subject: string;
    body: string;
  } | null>(null);

  // Remplace les jetons {prenom}, {nom}, etc. par les vraies valeurs d'un élève
  const renderReminderTemplate = (template: string, s: Student, link?: string) => {
    const completeness = computeCerfaCompleteness(s.cerfa);
    const manquants = completeness.missingFields.length > 0
      ? completeness.missingFields.map((m) => `- ${m}`).join('\n')
      : '- (aucun élément listé)';
    return template
      .split('{prenom}').join(s.cerfa.identity.firstName)
      .split('{nom}').join(s.cerfa.identity.lastName.toUpperCase())
      .split('{classe}').join(s.schoolClass)
      .split('{pourcentage}').join(String(completeness.percent))
      .split('{manquants}').join(manquants)
      .split('{lien}').join(link || window.location.origin)
      .split('{etablissement}').join(establishmentName || 'Établissement scolaire');
  };

  // Génère (ou récupère) le lien direct sans connexion pour un élève,
  // façon DocuSeal : valable tant que sa fiche n'est pas complète.
  const fetchMagicLinkUrl = async (studentId: string): Promise<string> => {
    try {
      const res = await fetch('/api/magic-link/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId }),
      });
      if (!res.ok) return window.location.origin;
      const data = await res.json();
      return `${window.location.origin}/?ficheToken=${data.token}`;
    } catch (e) {
      return window.location.origin;
    }
  };

  const [copyingLinkId, setCopyingLinkId] = useState<string | null>(null);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const handleCopyMagicLink = async (s: Student) => {
    setCopyingLinkId(s.id);
    try {
      const url = await fetchMagicLinkUrl(s.id);
      await navigator.clipboard.writeText(url);
      setCopiedLinkId(s.id);
      setTimeout(() => setCopiedLinkId(null), 2500);
    } catch (e) {
      alert("Impossible de copier le lien automatiquement. Réessayez.");
    } finally {
      setCopyingLinkId(null);
    }
  };

  // Révoque le lien direct d'un élève : l'ancien lien cesse immédiatement
  // de fonctionner. Un nouveau jeton sera généré au prochain "Copier le lien".
  const [studentToRevokeLink, setStudentToRevokeLink] = useState<Student | null>(null);
  const [revokingLinkId, setRevokingLinkId] = useState<string | null>(null);
  const handleRevokeMagicLink = async (s: Student) => {
    setRevokingLinkId(s.id);
    try {
      const res = await fetch('/api/magic-link/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: s.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Échec de la révocation du lien.');
      }
    } catch (e) {
      alert('Serveur injoignable.');
    } finally {
      setRevokingLinkId(null);
      setStudentToRevokeLink(null);
    }
  };

  // Export "prêt à coller" pour un envoi manuel via la messagerie ÉcoleDirecte
  // (ou tout autre canal) : un bloc de texte personnalisé par famille, avec
  // le même modèle que les relances par e-mail et le lien direct de chacune.
  const [buildingEcoleDirecteExport, setBuildingEcoleDirecteExport] = useState(false);
  const [ecoleDirecteBlocks, setEcoleDirecteBlocks] = useState<{ studentId: string; label: string; text: string }[] | null>(null);
  const [copiedBlockId, setCopiedBlockId] = useState<string | null>(null);

  const handleOpenEcoleDirecteExport = async () => {
    const targets = students.filter((s) => s.status === 'incomplete');
    if (targets.length === 0) return;
    setBuildingEcoleDirecteExport(true);
    try {
      const bodyTemplate = reminderTemplate?.body || DEFAULT_REMINDER_BODY;
      const blocks = await Promise.all(
        targets.map(async (s) => {
          const link = await fetchMagicLinkUrl(s.id);
          return {
            studentId: s.id,
            label: `${s.cerfa.identity.firstName} ${s.cerfa.identity.lastName.toUpperCase()} (${s.schoolClass})`,
            text: renderReminderTemplate(bodyTemplate, s, link),
          };
        })
      );
      setEcoleDirecteBlocks(blocks);
    } catch (e) {
      alert("Impossible de préparer l'export. Réessayez.");
    } finally {
      setBuildingEcoleDirecteExport(false);
    }
  };

  const handleCopyEcoleDirecteBlock = async (block: { studentId: string; text: string }) => {
    try {
      await navigator.clipboard.writeText(block.text);
      setCopiedBlockId(block.studentId);
      setTimeout(() => setCopiedBlockId(null), 2000);
    } catch (e) {
      alert('Impossible de copier automatiquement. Sélectionnez et copiez le texte manuellement.');
    }
  };

  const handleDownloadEcoleDirecteExport = () => {
    if (!ecoleDirecteBlocks) return;
    const content = ecoleDirecteBlocks
      .map((b) => `═══ ${b.label} ═══\n\n${b.text}\n`)
      .join('\n\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `messages-a-coller-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Ouvre la fenêtre d'aperçu/édition avant envoi (relance individuelle ou en masse)
  const openReminderDraft = async (targets: Student[]) => {
    if (targets.length === 0) return;
    const subjectTemplate = reminderTemplate?.subject || DEFAULT_REMINDER_SUBJECT;
    const bodyTemplate = reminderTemplate?.body || DEFAULT_REMINDER_BODY;
    if (targets.length === 1) {
      const link = await fetchMagicLinkUrl(targets[0].id);
      setReminderDraft({
        mode: 'single',
        targets,
        subject: renderReminderTemplate(subjectTemplate, targets[0], link),
        body: renderReminderTemplate(bodyTemplate, targets[0], link),
      });
    } else {
      setReminderDraft({
        mode: 'bulk',
        targets,
        subject: subjectTemplate,
        body: bodyTemplate,
      });
    }
  };

  // Envoi effectif après validation du brouillon
  const handleConfirmSendReminders = async () => {
    if (!reminderDraft) return;
    const { mode, targets, subject, body } = reminderDraft;

    const reminders = await Promise.all(
      targets.map(async (s) => {
        const parent = users.find((u) => u.id === s.parentId);
        const link = mode === 'bulk' ? await fetchMagicLinkUrl(s.id) : undefined;
        return {
          to: parent?.email || '',
          studentName: `${s.cerfa.identity.firstName} ${s.cerfa.identity.lastName.toUpperCase()}`,
          subject: mode === 'single' ? subject : renderReminderTemplate(subject, s, link),
          text: mode === 'single' ? body : renderReminderTemplate(body, s, link),
        };
      })
    );

    const missingEmail = reminders.filter((r) => !r.to);
    const sendable = reminders.filter((r) => r.to);

    setSendingReminderId(targets.length === 1 ? targets[0].id : '__bulk__');
    setReminderDraft(null);
    try {
      let sent = 0;
      let failedNames: string[] = missingEmail.map((r) => `${r.studentName} (email parent introuvable)`);
      if (sendable.length > 0) {
        const res = await fetch('/api/reminders/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reminders: sendable }),
        });
        const data = await res.json();
        if (!res.ok) {
          failedNames = [...failedNames, ...sendable.map((r) => `${r.studentName} (${data.error || 'échec'})`)];
        } else {
          sent = data.sent;
          failedNames = [
            ...failedNames,
            ...(data.results || []).filter((r: any) => !r.ok).map((r: any) => `${r.studentName}${r.error ? ` (${r.error})` : ''}`),
          ];
        }
      }
      setReminderResult({ sent, failed: failedNames.length, failedNames: failedNames.length > 0 ? failedNames : undefined });
    } catch (e) {
      setReminderResult({ sent: 0, failed: targets.length, failedNames: ['Serveur injoignable'] });
    } finally {
      setSendingReminderId(null);
    }
  };
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [editTripName, setEditTripName] = useState('');
  const [editTripDestination, setEditTripDestination] = useState('');
  const [editTripStart, setEditTripStart] = useState('');
  const [editTripEnd, setEditTripEnd] = useState('');
  const [editTripMax, setEditTripMax] = useState<number | ''>('');
  const [editTripClasses, setEditTripClasses] = useState('');
  const [editTripRequireSelection, setEditTripRequireSelection] = useState(false);
  const [editTripTeacher1, setEditTripTeacher1] = useState('');
  const [editTripTeacher2, setEditTripTeacher2] = useState('');
  const [editTripChaperonePassword, setEditTripChaperonePassword] = useState('');
  const [editTripShowPrintReminder, setEditTripShowPrintReminder] = useState(false);
  const [editTripOrganizer1Id, setEditTripOrganizer1Id] = useState('');
  const [editTripOrganizer2Id, setEditTripOrganizer2Id] = useState('');
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [studentForTripEnrollment, setStudentForTripEnrollment] = useState<Student | null>(null);
  const [selectedTripToEnrollId, setSelectedTripToEnrollId] = useState<string>('');
  const [expandedTripIds, setExpandedTripIds] = useState<string[]>([]);
  const [studentToEnrollPerTrip, setStudentToEnrollPerTrip] = useState<Record<string, string>>({});

  // Form states for creating / editing classes
  const [newClassName, setNewClassName] = useState('');
  const [newClassLevel, setNewClassLevel] = useState('');
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [editClassName, setEditClassName] = useState('');
  const [editClassLevel, setEditClassLevel] = useState('');

  // Global metrics
  const totalStudents = students.length;
  const completeStudents = students.filter((s) => s.status === 'complete').length;
  const overallCompleteness = Math.round(
    students.reduce((acc, s) => acc + s.completenessPercent, 0) / (totalStudents || 1)
  );

  const handleCreateTrip = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTripName.trim() || !newTripDestination.trim()) return;

    let finalOrganizerName = '';
    let organizerPayload: {
      isNewOrganizer: boolean;
      name: string;
      username: string;
      password?: string;
      phone?: string;
      existingOrganizerId?: string;
    };

    if (orgMode === 'new') {
      if (!orgName.trim() || !orgUsername.trim()) {
        alert("Veuillez renseigner le nom et l'identifiant de l'organisateur.");
        return;
      }
      finalOrganizerName = orgName.trim();
      const pwd = orgPassword.trim();
      organizerPayload = {
        isNewOrganizer: true,
        name: finalOrganizerName,
        username: orgUsername.trim(),
        password: pwd,
        phone: orgPhone.trim(),
      };
      setLastCreatedOrgInfo({
        tripName: newTripName.trim(),
        orgName: finalOrganizerName,
      });
    } else {
      const selected = organizerUsers.find((u) => u.id === selectedExistingOrgId);
      finalOrganizerName = selected ? selected.name : orgName.trim();
      const pwd = existingOrgNewPassword.trim() || undefined;
      organizerPayload = {
        isNewOrganizer: false,
        name: finalOrganizerName,
        username: selected?.email || '',
        password: pwd,
        existingOrganizerId: selectedExistingOrgId,
      };
      setLastCreatedOrgInfo({
        tripName: newTripName.trim(),
        orgName: finalOrganizerName,
      });
    }

    onAddTrip(
      {
        name: newTripName.trim(),
        destination: newTripDestination.trim(),
        startDate: newTripStart,
        endDate: newTripEnd,
        maxStudents: Number(newTripMax) || 100,
        eligibleClasses: newTripClasses
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        organizerName: finalOrganizerName,
        description: `Séjour scolaire encadré par ${finalOrganizerName}`,
        requireTripSelectionToSave: newTripRequireSelection,
        contactTeacher1: newTripTeacher1.trim(),
        contactTeacher2: newTripTeacher2.trim(),
        chaperonePassword: newTripChaperonePassword.trim(),
        showPrintReminderBanner: newTripShowPrintReminder,
      },
      organizerPayload,
      newTripSecondOrganizerId || undefined
    );

    setNewTripName('');
    setNewTripDestination('');
    setNewTripStart('');
    setNewTripEnd('');
    setNewTripMax('');
    setNewTripClasses('');
    setNewTripRequireSelection(false);
    setNewTripTeacher1('');
    setNewTripTeacher2('');
    setNewTripChaperonePassword('');
    setNewTripShowPrintReminder(false);
    setNewTripSecondOrganizerId('');
    setOrgName('');
    setOrgUsername('');
    setOrgPassword('');
    setOrgPhone('');
    setExistingOrgNewPassword('');
  };

  // Ouvre la fenêtre d'édition d'un voyage existant, pré-remplie
  const openEditTrip = (trip: Trip) => {
    const assignedOrganizers = organizerUsers.filter((u) => u.assignedTripIds?.includes(trip.id));
    setEditingTrip(trip);
    setEditTripName(trip.name);
    setEditTripDestination(trip.destination);
    setEditTripStart(trip.startDate);
    setEditTripEnd(trip.endDate);
    setEditTripMax(trip.maxStudents);
    setEditTripClasses(trip.eligibleClasses.join(', '));
    setEditTripRequireSelection(Boolean(trip.requireTripSelectionToSave));
    setEditTripTeacher1(trip.contactTeacher1 || '');
    setEditTripTeacher2(trip.contactTeacher2 || '');
    setEditTripChaperonePassword(trip.chaperonePassword || '');
    setEditTripShowPrintReminder(Boolean(trip.showPrintReminderBanner));
    setEditTripOrganizer1Id(assignedOrganizers[0]?.id || '');
    setEditTripOrganizer2Id(assignedOrganizers[1]?.id || '');
  };

  const handleSaveEditTrip = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTrip || !onUpdateTrip) return;
    if (!editTripName.trim() || !editTripDestination.trim()) return;

    const organizer1 = organizerUsers.find((u) => u.id === editTripOrganizer1Id);
    const organizer2 = organizerUsers.find((u) => u.id === editTripOrganizer2Id);

    const updatedTrip: Trip = {
      ...editingTrip,
      name: editTripName.trim(),
      destination: editTripDestination.trim(),
      startDate: editTripStart,
      endDate: editTripEnd,
      maxStudents: Number(editTripMax) || 100,
      eligibleClasses: editTripClasses
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
      organizerName: organizer1?.name || editingTrip.organizerName,
      organizerId2: organizer2?.id || undefined,
      organizerName2: organizer2?.name || undefined,
      requireTripSelectionToSave: editTripRequireSelection,
      contactTeacher1: editTripTeacher1.trim(),
      contactTeacher2: editTripTeacher2.trim(),
      chaperonePassword: editTripChaperonePassword.trim(),
      showPrintReminderBanner: editTripShowPrintReminder,
    };

    onUpdateTrip(updatedTrip, {
      organizerId1: editTripOrganizer1Id || undefined,
      organizerId2: editTripOrganizer2Id || undefined,
    });

    setEditingTrip(null);
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;

    onAddUser({
      name: newUserName.trim(),
      email: newUserEmail.trim(),
      role: newUserRole,
      password: newUserPassword.trim(),
    });

    setNewUserName('');
    setNewUserEmail('');
    setNewUserPassword('');
  };

  // Ouvre la fenêtre de modification d'un compte utilisateur
  const openEditUser = (u: User) => {
    setEditingUserId(u.id);
    setEditUserName(u.name);
    setEditUserEmail(u.email);
    setEditUserRole(u.role);
    setEditUserPhone(u.phone || '');
  };

  const handleSaveEditUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUserId || !onUpdateUser) return;
    if (!editUserName.trim() || !editUserEmail.trim()) return;

    onUpdateUser(editingUserId, {
      name: editUserName.trim(),
      email: editUserEmail.trim(),
      role: editUserRole,
      phone: editUserPhone.trim(),
    });
    setEditingUserId(null);
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 space-y-8">
      {/* Top Banner */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="bg-slate-800 text-slate-300 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-md mb-2 inline-block">
            Espace 4 — Administration & Direction
          </span>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-2xl font-bold tracking-tight">
              Supervision globale — {establishmentName}
            </h2>
            <button
              type="button"
              onClick={() => setActiveTab('establishment')}
              className="inline-flex items-center gap-1 text-xs bg-slate-800 hover:bg-slate-700 text-blue-300 hover:text-white px-2.5 py-1 rounded-lg border border-slate-700 transition-colors cursor-pointer"
              title="Modifier le nom de l'établissement"
            >
              <Pencil className="w-3 h-3 text-blue-400" />
              <span>Changer l'établissement</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto gap-2 border-b border-slate-200 pb-2 no-scrollbar">
        {[
          { id: 'overview', label: 'Vue d ensemble & KPIs', icon: Activity },
          { id: 'establishment', label: 'Établissement scolaire', icon: School },
          { id: 'trips', label: `Voyages scolaires (${trips.length})`, icon: Plane },
          { id: 'users', label: `Comptes & Rôles (${users.length})`, icon: Users },
          { id: 'classes', label: `Classes (${classes.length})`, icon: Building },
          { id: 'trash', label: `Corbeille (${trashedStudents.length})`, icon: Trash2 },
          { id: 'audit', label: 'Journal d audit & RGPD', icon: History },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-blue-900 text-white shadow-xs'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* School establishment badge & quick edit */}
          <div className="bg-gradient-to-r from-blue-50 via-slate-50 to-white border border-blue-200 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-blue-900 text-white flex items-center justify-center shrink-0 shadow-xs">
                <School className="w-6 h-6 text-blue-200" />
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-800 flex items-center gap-1.5">
                  <span>Établissement scolaire rattaché</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                </span>
                <div className="text-base font-bold text-slate-900">{establishmentName}</div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ce nom officiel est appliqué au portail et figure sur l'ensemble des fiches sanitaires CERFA n°10008*02 (PDF).
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('establishment')}
              className="inline-flex items-center gap-2 bg-white hover:bg-blue-50 text-blue-900 border border-blue-300 font-semibold text-xs px-4 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer shrink-0"
            >
              <Pencil className="w-3.5 h-3.5 text-blue-700" />
              <span>Changer le nom</span>
            </button>
          </div>

          {/* Key metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-xs font-bold text-slate-500 uppercase block">Élèves enregistrés</span>
              <div className="text-3xl font-black text-slate-900 mt-2">{totalStudents}</div>
              <span className="text-[11px] text-slate-500 mt-1 block">Sur {classes.length} classes actives</span>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-xs font-bold text-emerald-700 uppercase block">Fiches CERFA complètes</span>
              <div className="text-3xl font-black text-emerald-600 mt-2">{completeStudents}</div>
              <span className="text-[11px] text-emerald-700 font-semibold mt-1 block">
                {Math.round((completeStudents / (totalStudents || 1)) * 100)}% de conformité légale
              </span>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-xs font-bold text-blue-700 uppercase block">Complétude moyenne</span>
              <div className="text-3xl font-black text-blue-900 mt-2">{overallCompleteness}%</div>
              <span className="text-[11px] text-slate-500 mt-1 block">Calculée selon barème CERFA</span>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
              <span className="text-xs font-bold text-slate-700 uppercase block">Voyages scolaires</span>
              <div className="text-3xl font-black text-slate-900 mt-2">{trips.length}</div>
              <span className="text-[11px] text-slate-500 mt-1 block">Dont Angleterre 2027</span>
            </div>
          </div>

          {/* Quick list of students and overall status */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <h3 className="text-base font-bold text-slate-900">
                Suivi global de l état des fiches sanitaires de l établissement
              </h3>
              <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                {students.some((s) => s.status === 'incomplete') && (
                  <button
                    type="button"
                    onClick={handleOpenEcoleDirecteExport}
                    disabled={buildingEcoleDirecteExport}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-800 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {buildingEcoleDirecteExport ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>Export pour ÉcoleDirecte</span>
                  </button>
                )}
                {students.some((s) => s.status === 'incomplete') && (
                  <button
                    type="button"
                    onClick={() => openReminderDraft(students.filter((s) => s.status === 'incomplete'))}
                    disabled={sendingReminderId === '__bulk__'}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>
                      {sendingReminderId === '__bulk__'
                        ? 'Envoi en cours...'
                        : `Relancer les fiches incomplètes (${students.filter((s) => s.status === 'incomplete').length})`}
                    </span>
                  </button>
                )}
              </div>
            </div>

            <div className="suivi-wrap">
              <table className="suivi-table w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3 sticky left-0 z-20 bg-slate-100 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">Élève</th>
                    <th className="p-3">Classe</th>
                    <th className="p-3">Pension</th>
                    <th className="p-3">Régime</th>
                    <th className="p-3">PAI & Justificatifs</th>
                    <th className="p-3">Complétude CERFA</th>
                    <th className="p-3">Signature électronique</th>
                    <th className="p-3">Archivage PDF</th>
                    <th className="p-3">Voyages</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map((s) => {
                    const paiDocs = s.cerfa.documents.filter((d) => d.type === 'pai');
                    const otherDocs = s.cerfa.documents.filter((d) => d.type !== 'pai');

                    return (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="p-3 font-bold text-slate-900 sticky left-0 z-10 bg-white group-hover:bg-slate-50 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">
                          <div>{s.cerfa.identity.lastName} {s.cerfa.identity.firstName}</div>
                          <div className="font-mono font-normal text-[10px] text-slate-400">{s.internalId}</div>
                          {!s.deletedAt && students.some((o) => o.id !== s.id && !o.deletedAt && studentDuplicateKey(o) === studentDuplicateKey(s)) && (
                            <div className="inline-block mt-0.5 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                              Doublon possible
                            </div>
                          )}
                          {s.updatedAt && (
                            <div className="font-normal text-[10px] text-slate-400 mt-0.5">
                              Reçue le {new Date(s.updatedAt).toLocaleDateString('fr-FR')} à{' '}
                              {new Date(s.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </td>
                        <td className="p-3 font-medium text-slate-700">
                          {onUpdateStudentClass ? (
                            <select
                              value={s.schoolClass}
                              onChange={(e) => onUpdateStudentClass(s.id, e.target.value)}
                              className="bg-white border border-slate-300 rounded px-1.5 py-1 text-xs font-medium text-slate-700 cursor-pointer"
                              title="Modifier la classe de cet élève"
                            >
                              {!classes.some((c) => c.name === s.schoolClass) && (
                                <option value={s.schoolClass}>{s.schoolClass} (actuelle)</option>
                              )}
                              {classes.map((c) => (
                                <option key={c.id} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            s.schoolClass
                          )}
                        </td>
                        <td className="p-3">
                          {onUpdateStudentBoardingStatus ? (
                            <select
                              value={s.boardingStatus}
                              onChange={(e) =>
                                onUpdateStudentBoardingStatus(s.id, e.target.value as 'DP' | 'Externe' | 'Interne')
                              }
                              className="bg-white border border-slate-300 rounded px-1.5 py-1 text-xs font-medium text-slate-700 cursor-pointer"
                              title="Modifier le régime de pension de cet élève"
                            >
                              <option value="DP">Demi-pensionnaire</option>
                              <option value="Externe">Externe</option>
                              <option value="Interne">Interne</option>
                            </select>
                          ) : (
                            s.boardingStatus
                          )}
                        </td>
                        <td className="p-3 text-slate-600">{s.cerfa.structuredDiet.category.replace('_', ' ')}</td>
                        <td className="p-3">
                          <div className="flex flex-col gap-1 items-start">
                            {s.cerfa.medicalInfo.hasPai ? (
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-800 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded">
                                  <AlertTriangle className="w-3 h-3 text-red-600" />
                                  PAI Actif
                                </span>
                                {paiDocs.length > 0 ? (
                                  paiDocs.map((doc) => (
                                    <button
                                      key={doc.id}
                                      type="button"
                                      onClick={() =>
                                        openOrDownloadDocument(
                                          doc,
                                          `${s.cerfa.identity.firstName} ${s.cerfa.identity.lastName}`
                                        )
                                      }
                                      className="text-[10px] text-red-900 bg-red-50 hover:bg-red-200 border border-red-300 font-bold px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer transition"
                                      title="Consulter / Télécharger le document officiel du PAI"
                                    >
                                      <Download className="w-2.5 h-2.5" /> PAI
                                    </button>
                                  ))
                                ) : (
                                  <span className="text-[9px] text-red-600 italic">Sans pièce jointe</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[10px]">Aucun PAI</span>
                            )}

                            {otherDocs.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap pt-0.5">
                                {otherDocs.map((doc) => (
                                  <button
                                    key={doc.id}
                                    type="button"
                                    onClick={() =>
                                      openOrDownloadDocument(
                                        doc,
                                        `${s.cerfa.identity.firstName} ${s.cerfa.identity.lastName}`
                                      )
                                    }
                                    className="text-[10px] text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 font-medium px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer transition"
                                    title={`Consulter ${doc.name}`}
                                  >
                                    <FileText className="w-2.5 h-2.5" />
                                    <span className="truncate max-w-[80px]">{doc.name}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-1.5 rounded-full ${
                                  s.completenessPercent === 100 ? 'bg-emerald-600' : 'bg-amber-500'
                                }`}
                                style={{ width: `${s.completenessPercent}%` }}
                              ></div>
                            </div>
                            <span className="font-semibold text-[11px] text-slate-700">
                              {s.completenessPercent}%
                            </span>
                          </div>
                        </td>
                        <td className="p-3">
                          {s.cerfa.signature.signatureDataUrl ? (
                            <span className="text-emerald-700 font-bold text-[11px] flex items-center gap-1">
                              <CheckCircle className="w-3.5 h-3.5" /> Signée (v{s.cerfa.signature.version || 1})
                            </span>
                          ) : (
                            <span className="text-amber-700 font-semibold text-[11px] flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5" /> En attente
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          {s.pdfSentAt ? (
                            <span className="text-emerald-700 font-semibold text-[11px] flex flex-col leading-tight">
                              <span className="flex items-center gap-1">
                                <CheckCircle className="w-3.5 h-3.5" /> Archivé
                              </span>
                              <span className="text-slate-500 font-normal">
                                {new Date(s.pdfSentAt).toLocaleDateString('fr-FR')} à{' '}
                                {new Date(s.pdfSentAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px] italic">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex flex-wrap gap-1 items-center">
                              {s.registeredTripIds.length === 0 ? (
                                <span className="text-slate-400 text-[11px] italic">Non inscrit</span>
                              ) : (
                                s.registeredTripIds.map((tId) => {
                                  const tripObj = trips.find((t) => t.id === tId);
                                  return (
                                    <span
                                      key={tId}
                                      className="inline-flex items-center gap-1 text-[10px] font-semibold bg-blue-50 text-blue-900 border border-blue-200 px-1.5 py-0.5 rounded shadow-2xs"
                                    >
                                      <Plane className="w-2.5 h-2.5 text-blue-700" />
                                      <span className="truncate max-w-[90px]">{tripObj?.name || 'Séjour'}</span>
                                      {onUnregisterTrip && (
                                        <button
                                          type="button"
                                          onClick={() => onUnregisterTrip(s.id, tId)}
                                          className="hover:text-red-700 ml-0.5 cursor-pointer text-slate-400 hover:text-red-600 font-bold"
                                          title="Désinscrire l'élève de ce séjour"
                                        >
                                          ✕
                                        </button>
                                      )}
                                    </span>
                                  );
                                })
                              )}
                            </div>
                            {onRegisterTrip && (
                              <button
                                type="button"
                                onClick={() => {
                                  setStudentForTripEnrollment(s);
                                  const availableTrip = trips.find((t) => !s.registeredTripIds.includes(t.id));
                                  setSelectedTripToEnrollId(availableTrip?.id || (trips[0]?.id || ''));
                                }}
                                className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 hover:text-blue-950 bg-slate-50 hover:bg-blue-100 border border-slate-200 px-1.5 py-0.5 rounded w-fit transition cursor-pointer"
                                title="Inscrire manuellement cet élève à un voyage scolaire"
                              >
                                <Plus className="w-2.5 h-2.5 text-blue-700" />
                                <span>Inscrire au voyage</span>
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {s.status === 'incomplete' && (
                              <button
                                type="button"
                                onClick={() => openReminderDraft([s])}
                                disabled={sendingReminderId === s.id || sendingReminderId === '__bulk__'}
                                className="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded transition-colors cursor-pointer disabled:opacity-50"
                                title={sendingReminderId === s.id ? 'Envoi...' : 'Relancer par e-mail'}
                              >
                                <Mail className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                                type="button"
                                onClick={() => handleCopyMagicLink(s)}
                                disabled={copyingLinkId === s.id}
                                className={`p-1.5 border rounded transition-colors cursor-pointer disabled:opacity-50 ${
                                  copiedLinkId === s.id
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                    : 'bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-300'
                                }`}
                                title={
                                  copiedLinkId === s.id
                                    ? 'Lien copié !'
                                    : s.status === 'complete'
                                    ? 'Copier le lien direct (sans connexion) vers la fiche de cet élève'
                                    : "Copier le lien direct (sans connexion) vers la fiche de cet élève, pour compléter ce qui manque"
                                }
                              >
                                {copyingLinkId === s.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : copiedLinkId === s.id ? (
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                ) : (
                                  <Link2 className="w-3.5 h-3.5" />
                                )}
                              </button>
                            <button
                              type="button"
                              onClick={() => setStudentToRevokeLink(s)}
                              disabled={revokingLinkId === s.id}
                              className="p-1.5 bg-slate-50 hover:bg-red-50 text-slate-500 hover:text-red-700 border border-slate-300 hover:border-red-300 rounded transition-colors cursor-pointer disabled:opacity-50"
                              title="Révoquer le lien direct de cet élève (l'ancien lien cessera de fonctionner)"
                            >
                              {revokingLinkId === s.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Link2Off className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {onSelectStudentToView && (
                              <button
                                type="button"
                                onClick={() => onSelectStudentToView(s)}
                                className="p-1.5 bg-slate-100 hover:bg-slate-200 text-blue-900 border border-slate-300 rounded transition-colors cursor-pointer"
                                title="Consulter le CERFA officiel complet de l'élève"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {onDeleteStudent && (
                              <button
                                type="button"
                                onClick={() => setStudentToDelete(s)}
                                className="p-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded transition-colors cursor-pointer"
                                title="Supprimer définitivement cette fiche sanitaire"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TRIPS MANAGEMENT */}
      {activeTab === 'trips' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Fin d'année scolaire : désinscription de tous les élèves de tous les voyages (build year-end-20261006) */}
          <div className="lg:col-span-3">
            <YearEndPanel adminId={currentUser.id} students={students} />
          </div>

          {/* List of trips */}
          <div className="lg:col-span-2 space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              Voyages scolaires programmés ({trips.length})
            </h3>

            {trips.map((trip) => {
              const enrolled = students.filter((s) => s.registeredTripIds.includes(trip.id));
              const notEnrolled = students.filter((s) => !s.registeredTripIds.includes(trip.id));
              const isExpanded = expandedTripIds.includes(trip.id);
              const selectedStudentId = studentToEnrollPerTrip[trip.id] || (notEnrolled[0]?.id || '');

              return (
                <div key={trip.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3.5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-base text-slate-900">{trip.name}</h4>
                        <span className="bg-blue-50 text-blue-900 font-bold text-xs px-2.5 py-0.5 rounded-full border border-blue-200">
                          {enrolled.length} / {trip.maxStudents} inscrits
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Destination : <strong className="text-slate-700">{trip.destination}</strong> • Du {formatDateFr(trip.startDate)} au {formatDateFr(trip.endDate)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedTripIds((prev) =>
                            prev.includes(trip.id) ? prev.filter((id) => id !== trip.id) : [...prev, trip.id]
                          );
                        }}
                        className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition cursor-pointer ${
                          isExpanded
                            ? 'bg-blue-900 text-white border-blue-900'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-300'
                        }`}
                        title="Afficher et gérer les inscriptions d'élèves pour ce voyage"
                      >
                        <Users className="w-3.5 h-3.5" />
                        <span>Inscriptions ({enrolled.length})</span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {onUpdateTrip && (
                        <button
                          type="button"
                          onClick={() => openEditTrip(trip)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-1.5 rounded-lg transition cursor-pointer"
                          title="Modifier ce voyage"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Modifier</span>
                        </button>
                      )}

                      {onDeleteTrip && (
                        <button
                          type="button"
                          onClick={() => setTripToDelete(trip)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1.5 rounded-lg transition cursor-pointer"
                          title="Supprimer définitivement ce voyage"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Supprimer</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 pt-2 border-t border-slate-100">
                    <span>
                      Organisateur{trip.organizerName2 ? 's' : ''} :{' '}
                      <strong>
                        {trip.organizerName}
                        {trip.organizerName2 ? ` & ${trip.organizerName2}` : ''}
                      </strong>
                    </span>
                    <span>Classes concernées : <strong>{trip.eligibleClasses.join(', ')}</strong></span>
                  </div>

                  {/* Expandable Section: Student Inscriptions Management */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-slate-200 bg-slate-50/75 rounded-xl p-3.5 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <h5 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                          <Users className="w-4 h-4 text-blue-700" />
                          <span>Gestion directe des inscriptions au voyage ({enrolled.length} élève(s))</span>
                        </h5>
                        <span className="text-[11px] text-slate-500">
                          Capacité : {enrolled.length} / {trip.maxStudents}
                        </span>
                      </div>

                      {/* Manual enrollment form for Admin */}
                      {onRegisterTrip && (
                        <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-2">
                          <label className="block text-[11px] font-bold text-slate-700">
                            Inscrire un élève (décision administrateur si parent non inscrit) :
                          </label>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <select
                              value={selectedStudentId}
                              onChange={(e) =>
                                setStudentToEnrollPerTrip((prev) => ({
                                  ...prev,
                                  [trip.id]: e.target.value,
                                }))
                              }
                              className="flex-1 text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-800"
                            >
                              {notEnrolled.length === 0 ? (
                                <option value="">Tous les élèves de l établissement sont déjà inscrits</option>
                              ) : (
                                notEnrolled.map((s) => {
                                  const isEligible = trip.eligibleClasses.includes(s.schoolClass);
                                  return (
                                    <option key={s.id} value={s.id}>
                                      {s.cerfa.identity.lastName.toUpperCase()} {s.cerfa.identity.firstName} ({s.schoolClass}) — {s.status === 'complete' ? 'CERFA 100%' : `${s.completenessPercent}%`} {isEligible ? '★ Classe éligible' : ''}
                                    </option>
                                  );
                                })
                              )}
                            </select>
                            <button
                              type="button"
                              disabled={!selectedStudentId || notEnrolled.length === 0}
                              onClick={() => {
                                if (selectedStudentId) {
                                  onRegisterTrip(selectedStudentId, trip.id);
                                  // Clear selection or advance to next
                                  const remaining = notEnrolled.filter((s) => s.id !== selectedStudentId);
                                  setStudentToEnrollPerTrip((prev) => ({
                                    ...prev,
                                    [trip.id]: remaining[0]?.id || '',
                                  }));
                                }
                              }}
                              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-semibold text-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shadow-2xs"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              <span>Inscrire au voyage</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* List of currently enrolled students */}
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-bold text-slate-600 block">
                          Liste des élèves inscrits pour ce voyage :
                        </span>
                        {enrolled.length === 0 ? (
                          <p className="text-xs text-slate-400 italic bg-white p-3 rounded-lg border border-slate-200">
                            Aucun élève n est encore inscrit à ce séjour.
                          </p>
                        ) : (
                          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100">
                            {enrolled.map((s) => (
                              <div key={s.id} className="p-2.5 flex items-center justify-between text-xs hover:bg-slate-50">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-900">
                                    {s.cerfa.identity.lastName.toUpperCase()} {s.cerfa.identity.firstName}
                                  </span>
                                  <span className="bg-slate-100 text-slate-700 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-slate-200">
                                    {s.schoolClass}
                                  </span>
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                    s.status === 'complete'
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : 'bg-amber-50 text-amber-700'
                                  }`}>
                                    {s.status === 'complete' ? 'Fiche validée' : `${s.completenessPercent}%`}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {onSelectStudentToView && (
                                    <button
                                      type="button"
                                      onClick={() => onSelectStudentToView(s)}
                                      className="text-blue-700 hover:text-blue-900 text-[11px] font-semibold hover:underline cursor-pointer"
                                    >
                                      Voir la fiche
                                    </button>
                                  )}
                                  {onUnregisterTrip && (
                                    <button
                                      type="button"
                                      onClick={() => onUnregisterTrip(s.id, trip.id)}
                                      className="inline-flex items-center gap-1 text-[11px] text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 px-2 py-0.5 rounded transition cursor-pointer"
                                      title="Désinscrire l'élève du voyage"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                      <span>Désinscrire</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Create new trip form */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs h-fit">
            <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-blue-700" />
              Créer un nouveau voyage
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Définit un nouveau cadre de séjour accessible aux familles et organisateurs.
            </p>

            {/* Confirmation banner for created organizer */}
            {lastCreatedOrgInfo && (
              <div className="mb-4 bg-emerald-50 border border-emerald-300 rounded-xl p-3 text-xs text-emerald-950 space-y-1.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1.5 text-emerald-900">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Voyage & Compte Organisateur enregistrés
                  </span>
                  <button
                    type="button"
                    onClick={() => setLastCreatedOrgInfo(null)}
                    className="text-slate-400 hover:text-slate-700 text-xs px-1 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-[11px]">
                  Séjour programmé : <strong>{lastCreatedOrgInfo.tripName}</strong>
                </p>
                <div className="bg-white/90 p-2.5 rounded-lg border border-emerald-200 text-[11px] space-y-1">
                  <div>Organisateur assigné : <strong className="text-slate-900">{lastCreatedOrgInfo.orgName}</strong></div>
                  <p className="text-[10px] text-emerald-800">
                    Le séjour a été enregistré et rattaché avec succès au profil de l'organisateur.
                  </p>
                </div>
              </div>
            )}

            <form onSubmit={handleCreateTrip} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">
                  Intitulé du séjour *
                </label>
                <input
                  type="text"
                  required
                  value={newTripName}
                  onChange={(e) => setNewTripName(e.target.value)}
                  placeholder="Ex : Séjour Ski 2027"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">
                  Destination *
                </label>
                <input
                  type="text"
                  required
                  value={newTripDestination}
                  onChange={(e) => setNewTripDestination(e.target.value)}
                  placeholder="Ex : Morzine, Alpes"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">Date début</label>
                  <input
                    type="date"
                    value={newTripStart}
                    onChange={(e) => setNewTripStart(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">Date fin</label>
                  <input
                    type="date"
                    value={newTripEnd}
                    onChange={(e) => setNewTripEnd(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">Capacité max</label>
                  <input
                    type="number"
                    value={newTripMax}
                    placeholder="Ex : 100"
                    onChange={(e) => setNewTripMax(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">Classes (séparées par virgule)</label>
                  <input
                    type="text"
                    value={newTripClasses}
                    placeholder="Ex : 6e A, 6e B"
                    onChange={(e) => setNewTripClasses(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>

              {/* Section Fiche sanitaire obligatoire & contacts de remise des documents */}
              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 space-y-3">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newTripRequireSelection}
                    onChange={(e) => setNewTripRequireSelection(e.target.checked)}
                    className="mt-0.5 rounded border-amber-400 text-amber-700 focus:ring-amber-600 cursor-pointer"
                  />
                  <span className="text-xs text-amber-900">
                    <strong className="block font-bold">
                      Rendre le choix d'un voyage obligatoire pour enregistrer la fiche sanitaire
                    </strong>
                    Tant qu'aucun voyage n'est sélectionné, les parents ne pourront pas enregistrer la fiche de leur enfant.
                  </span>
                </label>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="block font-bold text-slate-700 uppercase mb-1">Nom du 1er professeur référent</label>
                    <input
                      type="text"
                      value={newTripTeacher1}
                      placeholder="Ex : M. Martin"
                      onChange={(e) => setNewTripTeacher1(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 uppercase mb-1">Nom du 2e professeur référent</label>
                    <input
                      type="text"
                      value={newTripTeacher2}
                      placeholder="Ex : Mme Dupont"
                      onChange={(e) => setNewTripTeacher2(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2.5 cursor-pointer pt-2 border-t border-amber-200">
                  <input
                    type="checkbox"
                    checked={newTripShowPrintReminder}
                    onChange={(e) => setNewTripShowPrintReminder(e.target.checked)}
                    className="mt-0.5 rounded border-amber-400 text-amber-700 focus:ring-amber-600 cursor-pointer"
                  />
                  <span className="text-xs text-amber-900">
                    <strong className="block font-bold">
                      Afficher le message de remise des documents aux parents
                    </strong>
                    Fait apparaître la bannière rouge "Action obligatoire" (en haut et en bas de la fiche officielle) demandant d'imprimer la fiche sanitaire et le PAI et de les remettre aux professeurs référents ci-dessus.
                  </span>
                </label>

                <p className="text-[11px] text-amber-800">
                  Ces noms apparaîtront dans le message demandant aux parents de remettre la fiche imprimée et le PAI.
                </p>

                <div className="pt-1">
                  <label className="block font-bold text-slate-700 uppercase mb-1">
                    Mot de passe accompagnateurs (accès lecture seule aux fiches)
                  </label>
                  <input
                    type="text"
                    value={newTripChaperonePassword}
                    placeholder="Laissez vide pour désactiver cet accès"
                    onChange={(e) => setNewTripChaperonePassword(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                  />
                  <p className="text-[11px] text-amber-800 mt-1">
                    Permet aux professeurs accompagnateurs (sans compte) de consulter les fiches sanitaires PDF des élèves inscrits à ce voyage, depuis la page de connexion → "Accès professeurs accompagnateurs".
                  </p>
                </div>
              </div>

              {/* Section Organisateur du voyage (Création compte ou sélection) */}
              <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-blue-950 uppercase text-[11px] flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-blue-700" />
                    Organisateur du voyage & Identifiants *
                  </span>
                  <div className="inline-flex rounded-md border border-blue-200 bg-white p-0.5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setOrgMode('new')}
                      className={`px-2 py-0.5 rounded font-semibold transition-colors cursor-pointer ${
                        orgMode === 'new' ? 'bg-blue-900 text-white' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Nouveau compte
                    </button>
                    <button
                      type="button"
                      onClick={() => setOrgMode('existing')}
                      className={`px-2 py-0.5 rounded font-semibold transition-colors cursor-pointer ${
                        orgMode === 'existing' ? 'bg-blue-900 text-white' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Existant ({organizerUsers.length})
                    </button>
                  </div>
                </div>

                {orgMode === 'new' ? (
                  <div className="space-y-2.5">
                    <div>
                      <label className="block font-semibold text-slate-700 text-[11px] mb-0.5">
                        Nom et prénom de l'organisateur *
                      </label>
                      <input
                        type="text"
                        required
                        value={orgName}
                        onChange={(e) => setOrgName(e.target.value)}
                        placeholder="Ex : Marc DUPUIS"
                        className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block font-semibold text-slate-700 text-[11px] mb-0.5">
                          Identifiant / Email de connexion *
                        </label>
                        <input
                          type="text"
                          required
                          value={orgUsername}
                          onChange={(e) => setOrgUsername(e.target.value)}
                          placeholder="m.dupuis@etablissement.fr"
                          className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 font-mono"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-0.5">
                          <label className="font-semibold text-slate-700 text-[11px]">
                            Mot de passe *
                          </label>
                          <button
                            type="button"
                            onClick={generateRandomPassword}
                            className="text-[10px] text-blue-700 hover:underline font-semibold cursor-pointer"
                          >
                            Générer
                          </button>
                        </div>
                        <div className="relative">
                          <input
                            type={showOrgPassword ? 'text' : 'password'}
                            required
                            value={orgPassword}
                            onChange={(e) => setOrgPassword(e.target.value)}
                            placeholder="Mot de passe"
                            className="w-full bg-white border border-slate-300 rounded-lg pl-2.5 pr-8 py-1.5 text-xs text-slate-800 font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setShowOrgPassword(!showOrgPassword)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                          >
                            {showOrgPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 text-[11px] mb-0.5">
                        Téléphone de contact (optionnel)
                      </label>
                      <input
                        type="tel"
                        value={orgPhone}
                        onChange={(e) => setOrgPhone(e.target.value)}
                        placeholder="Ex : 06 12 34 56 78"
                        className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800"
                      />
                    </div>

                    <p className="text-[10px] text-blue-900 italic">
                      ℹ️ L'organisateur pourra modifier son mot de passe directement depuis son espace.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <label className="block font-semibold text-slate-700 text-[11px] mb-0.5">
                        Sélectionner l'organisateur existant *
                      </label>
                      <select
                        value={selectedExistingOrgId}
                        onChange={(e) => setSelectedExistingOrgId(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800"
                      >
                        {organizerUsers.length === 0 ? (
                          <option value="">Aucun organisateur — créez un nouveau compte ci-dessus</option>
                        ) : (
                          organizerUsers.map((org) => (
                            <option key={org.id} value={org.id}>
                              {org.name} ({org.email})
                            </option>
                          ))
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 text-[11px] mb-0.5">
                        Modifier / réinitialiser son mot de passe (optionnel)
                      </label>
                      <input
                        type="text"
                        value={existingOrgNewPassword}
                        onChange={(e) => setExistingOrgNewPassword(e.target.value)}
                        placeholder="Laisser vide pour conserver le mot de passe actuel"
                        className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Second organisateur (optionnel) — compte existant uniquement */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                <label className="block font-semibold text-slate-700 text-[11px]">
                  Second organisateur (optionnel)
                </label>
                <select
                  value={newTripSecondOrganizerId}
                  onChange={(e) => setNewTripSecondOrganizerId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800"
                >
                  <option value="">-- Aucun second organisateur --</option>
                  {organizerUsers.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name} ({org.email})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500">
                  Ce voyage apparaîtra aussi dans l'espace organisateur de ce second compte (uniquement des comptes déjà existants).
                </p>
              </div>

              <button
                type="submit"
                className="w-full mt-2 bg-blue-900 hover:bg-blue-950 text-white font-semibold py-2.5 rounded-lg text-xs transition-colors shadow-xs cursor-pointer"
              >
                Créer le voyage & configurer l'organisateur
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 3: USERS & ROLES */}
      {activeTab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="text-base font-bold text-slate-900">
                Comptes utilisateurs et affectation des rôles ({users.length})
              </h3>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3">Utilisateur</th>
                    <th className="p-3">Identifiant / Email</th>
                    <th className="p-3">Rôle</th>
                    <th className="p-3">Mot de passe</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-900">{u.name}</td>
                      <td className="p-3 text-slate-600 font-mono text-[11px]">{u.email}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            u.role === 'admin'
                              ? 'bg-purple-100 text-purple-900'
                              : u.role === 'organizer'
                              ? 'bg-blue-100 text-blue-900'
                              : 'bg-emerald-100 text-emerald-900'
                          }`}
                        >
                          {u.role === 'admin' ? 'Direction / Admin' : u.role === 'organizer' ? 'Organisateur' : 'Parent'}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="text-slate-400 font-mono tracking-widest text-xs select-none">
                          ••••••••
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {onUpdateUser && (
                            <button
                              type="button"
                              onClick={() => openEditUser(u)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded transition-colors cursor-pointer"
                              title="Modifier ce compte (nom, email, rôle)"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Modifier</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setEditingPasswordUserId(u.id);
                              setAdminCustomPassword('');
                              setShowAdminCustomPassword(false);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded transition-colors cursor-pointer"
                            title="Modifier le mot de passe de cet utilisateur"
                          >
                            <KeyRound className="w-3 h-3" />
                            <span>Mot de passe</span>
                          </button>

                          {onDeleteUser && (
                            <button
                              type="button"
                              disabled={currentUser.id === u.id}
                              onClick={() => setUserToDelete(u)}
                              className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded transition-colors ${
                                currentUser.id === u.id
                                  ? 'text-slate-300 bg-slate-100 cursor-not-allowed'
                                  : 'text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 cursor-pointer'
                              }`}
                              title={
                                currentUser.id === u.id
                                  ? 'Vous ne pouvez pas supprimer votre propre compte actuellement connecté'
                                  : 'Supprimer cet utilisateur'
                              }
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Supprimer</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Modal for admin to edit a user's account (name, email, role, phone) */}
            {editingUserId && (
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl border border-slate-200 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                      <Pencil className="w-4 h-4 text-blue-700" />
                      Modifier le compte
                    </h4>
                    <button
                      type="button"
                      onClick={() => setEditingUserId(null)}
                      className="text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <form onSubmit={handleSaveEditUser} className="space-y-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 uppercase mb-1">Nom complet *</label>
                      <input
                        type="text"
                        value={editUserName}
                        onChange={(e) => setEditUserName(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 uppercase mb-1">Email / Identifiant *</label>
                      <input
                        type="text"
                        value={editUserEmail}
                        onChange={(e) => setEditUserEmail(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                        required
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 uppercase mb-1">Téléphone</label>
                      <input
                        type="text"
                        value={editUserPhone}
                        onChange={(e) => setEditUserPhone(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 uppercase mb-1">Rôle</label>
                      <select
                        value={editUserRole}
                        onChange={(e) => setEditUserRole(e.target.value as 'parent' | 'organizer' | 'admin')}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                      >
                        <option value="parent">Parent</option>
                        <option value="organizer">Organisateur de voyage (Enseignant)</option>
                        <option value="admin">Direction / Administration</option>
                      </select>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setEditingUserId(null)}
                        className="px-3.5 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        Annuler
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
                      >
                        Enregistrer
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Modal for admin to edit user's password */}
            {editingPasswordUserId && (
              <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl border border-slate-200 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                      <KeyRound className="w-4 h-4 text-blue-700" />
                      Modifier le mot de passe
                    </h4>
                    <button
                      type="button"
                      onClick={() => setEditingPasswordUserId(null)}
                      className="text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {(() => {
                    const targetUser = users.find((u) => u.id === editingPasswordUserId);
                    if (!targetUser) return null;
                    return (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (onUpdateUserPassword && adminCustomPassword.trim()) {
                            await onUpdateUserPassword(targetUser.id, adminCustomPassword.trim());
                          }
                          setEditingPasswordUserId(null);
                        }}
                        className="space-y-3 text-xs"
                      >
                        <p className="text-slate-600">
                          Compte : <strong>{targetUser.name}</strong> ({targetUser.role === 'admin' ? 'Administrateur' : targetUser.role === 'organizer' ? 'Organisateur' : 'Parent'})
                          <br />
                          <span className="text-[11px] text-slate-500 font-mono">{targetUser.email}</span>
                        </p>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="block font-semibold text-slate-700">
                              Nouveau mot de passe :
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                const randomPwd = 'JM-' + Math.random().toString(36).slice(-6);
                                setAdminCustomPassword(randomPwd);
                              }}
                              className="text-[10px] text-blue-700 hover:underline font-semibold cursor-pointer"
                            >
                              Générer auto
                            </button>
                          </div>
                          <div className="relative">
                            <input
                              type={showAdminCustomPassword ? 'text' : 'password'}
                              value={adminCustomPassword}
                              onChange={(e) => setAdminCustomPassword(e.target.value)}
                              placeholder="Entrez le nouveau mot de passe"
                              className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono text-xs pr-8"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => setShowAdminCustomPassword(!showAdminCustomPassword)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                            >
                              {showAdminCustomPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setEditingPasswordUserId(null)}
                            className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 font-semibold cursor-pointer"
                          >
                            Annuler
                          </button>
                          <button
                            type="submit"
                            disabled={!adminCustomPassword.trim()}
                            className="px-3 py-1.5 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-semibold cursor-pointer disabled:opacity-50"
                          >
                            Enregistrer
                          </button>
                        </div>
                      </form>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Add User Form */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs h-fit">
            <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-blue-700" />
              Créer un nouvel utilisateur
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Créer un compte enseignant, organisateur ou responsable légal.
            </p>

            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Nom complet *</label>
                <input
                  type="text"
                  required
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="Ex : Sarah BENALI"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder="prenom.nom@etablissement.fr"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Rôle dans l établissement</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as any)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                >
                  <option value="organizer">Organisateur de voyage (Enseignant)</option>
                  <option value="parent">Parent / Responsable légal</option>
                  <option value="admin">Administrateur / Direction</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Mot de passe initial (optionnel)</label>
                <input
                  type="password"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  placeholder="Définir un mot de passe"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono"
                />
              </div>

              <button
                type="submit"
                className="w-full mt-2 bg-blue-900 hover:bg-blue-950 text-white font-semibold py-2 rounded-lg text-xs transition-colors cursor-pointer"
              >
                Créer l utilisateur
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 4: CLASSES */}
      {activeTab === 'classes' && (
        <div className="space-y-6">
          {/* Create New Class Form */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-blue-700" />
              Créer une nouvelle classe
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Ajoutez une division ou section pour organiser les élèves et les voyages scolaires.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newClassName.trim()) return;
                onAddClass({
                  id: 'cls-' + Date.now(),
                  name: newClassName.trim(),
                  level: newClassLevel.trim() || '6e',
                });
                setNewClassName('');
              }}
              className="flex flex-col sm:flex-row items-end gap-3 text-xs"
            >
              <div className="flex-1 w-full">
                <label className="block font-bold text-slate-700 uppercase mb-1">
                  Nom de la classe *
                </label>
                <input
                  type="text"
                  required
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  placeholder="Ex : 6e C, 3e Européenne, UPE2A..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-600 focus:outline-none"
                />
              </div>

              <div className="w-full sm:w-48">
                <label className="block font-bold text-slate-700 uppercase mb-1">
                  Niveau scolaire
                </label>
                <select
                  value={newClassLevel}
                  onChange={(e) => setNewClassLevel(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-600 focus:outline-none cursor-pointer"
                >
                  <option value="">-- Sélectionner le niveau --</option>
                  <option value="6e">6e (Sixième)</option>
                  <option value="5e">5e (Cinquième)</option>
                  <option value="4e">4e (Quatrième)</option>
                  <option value="3e">3e (Troisième)</option>
                  <option value="Seconde">Seconde</option>
                  <option value="Première">Première</option>
                  <option value="Terminale">Terminale</option>
                  <option value="Autre">Autre division</option>
                </select>
              </div>

              <button
                type="submit"
                className="w-full sm:w-auto bg-blue-900 hover:bg-blue-950 text-white font-semibold px-5 py-2 rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Ajouter la classe</span>
              </button>
            </form>
          </div>

          {/* Classes List & In-Place Modification */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Structure des classes ({classes.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Cliquez sur l'icône de crayon pour modifier le libellé ou le niveau d'une classe existante.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {classes.map((cls) => {
                const studentsInClass = students.filter((s) => s.schoolClass === cls.name);
                const isEditing = editingClassId === cls.id;

                if (isEditing) {
                  return (
                    <div
                      key={cls.id}
                      className="p-4 border-2 border-blue-500 rounded-xl bg-blue-50/40 shadow-xs space-y-3"
                    >
                      <div>
                        <label className="block text-[10px] font-bold text-blue-900 uppercase mb-0.5">
                          Nom de la classe
                        </label>
                        <input
                          type="text"
                          value={editClassName}
                          onChange={(e) => setEditClassName(e.target.value)}
                          className="w-full bg-white border border-blue-300 rounded px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-blue-900 uppercase mb-0.5">
                          Niveau
                        </label>
                        <select
                          value={editClassLevel}
                          onChange={(e) => setEditClassLevel(e.target.value)}
                          className="w-full bg-white border border-blue-300 rounded px-2.5 py-1.5 text-xs focus:outline-none"
                        >
                          <option value="6e">6e</option>
                          <option value="5e">5e</option>
                          <option value="4e">4e</option>
                          <option value="3e">3e</option>
                          <option value="Seconde">Seconde</option>
                          <option value="Première">Première</option>
                          <option value="Terminale">Terminale</option>
                          <option value="Autre">Autre</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-1 border-t border-blue-200">
                        <button
                          type="button"
                          onClick={() => setEditingClassId(null)}
                          className="p-1.5 text-slate-500 hover:text-slate-800 rounded text-xs flex items-center gap-1 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Annuler</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!editClassName.trim()) return;
                            if (onUpdateClass) {
                              onUpdateClass({
                                id: cls.id,
                                name: editClassName.trim(),
                                level: editClassLevel.trim() || cls.level,
                              });
                            }
                            setEditingClassId(null);
                          }}
                          className="px-3 py-1 bg-blue-900 hover:bg-blue-950 text-white rounded text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Enregistrer</span>
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={cls.id}
                    className="p-4 border border-slate-200 rounded-xl bg-slate-50/70 hover:bg-white hover:border-slate-300 transition-all flex flex-col justify-between gap-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-sm text-slate-900">{cls.name}</h4>
                        <span className="text-slate-500 text-xs">Niveau {cls.level}</span>
                      </div>
                      <span className="bg-white border border-slate-300 px-2.5 py-1 rounded-lg text-xs font-bold text-blue-900 font-mono shrink-0">
                        {studentsInClass.length} élève(s)
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200/80">
                      <span className="text-[11px] text-slate-400">
                        ID: {cls.id}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingClassId(cls.id);
                            setEditClassName(cls.name);
                            setEditClassLevel(cls.level);
                          }}
                          className="p-1.5 text-blue-700 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                          title="Modifier cette classe"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {onDeleteClass && (
                          <button
                            type="button"
                            onClick={() => {
                              if (studentsInClass.length > 0) {
                                if (
                                  !window.confirm(
                                    `Attention : ${studentsInClass.length} élève(s) sont rattaché(s) à la classe ${cls.name}. Voulez-vous vraiment la supprimer ?`
                                  )
                                ) {
                                  return;
                                }
                              }
                              onDeleteClass(cls.id);
                            }}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                            title="Supprimer cette classe"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB: CONFIGURATION ÉTABLISSEMENT */}
      {activeTab === 'establishment' && (
        <div className="space-y-6">
          {/* Logo de l'établissement */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs">
            <div className="flex items-center gap-3.5 border-b border-slate-200 pb-5">
              <div className="w-12 h-12 rounded-xl bg-blue-900 text-white flex items-center justify-center shadow-xs shrink-0">
                <ImageIcon className="w-6 h-6 text-blue-200" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Logo de l'établissement</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ce logo remplace l'icône par défaut dans le bandeau du portail et sur la page de connexion. Formats acceptés : PNG, JPG, SVG (2 Mo maximum).
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col sm:flex-row items-center sm:items-start gap-5">
              <div className="w-24 h-24 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo actuel" className="w-full h-full object-contain bg-white" />
                ) : (
                  <span className="text-[11px] text-slate-400 text-center px-2">Aucun logo</span>
                )}
              </div>

              <div className="flex-1 space-y-2.5">
                <label className="inline-flex items-center gap-2 bg-blue-900 hover:bg-blue-950 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer w-fit">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{logoUrl ? 'Remplacer le logo' : 'Importer un logo'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoFileChange} />
                </label>

                {logoUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="ml-0 sm:ml-2 inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-2 rounded-xl transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Retirer le logo</span>
                  </button>
                )}

                {logoError && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {logoError}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Sécurité : mot de passe de l'administrateur connecté */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs">
            <div className="flex items-center gap-3.5 border-b border-slate-200 pb-5">
              <div className="w-12 h-12 rounded-xl bg-purple-900 text-white flex items-center justify-center shadow-xs shrink-0">
                <KeyRound className="w-6 h-6 text-purple-200" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Mon mot de passe administrateur</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Choisissez le mot de passe de votre propre compte ({currentUser.name}), utilisé pour vous connecter en tant qu'administrateur.
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveOwnPassword} className="mt-5 max-w-md space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-800 mb-1.5">
                  Nouveau mot de passe
                </label>
                <div className="relative">
                  <input
                    type={showOwnNewPassword ? 'text' : 'password'}
                    value={ownNewPassword}
                    onChange={(e) => {
                      setOwnNewPassword(e.target.value);
                      setOwnPasswordError('');
                    }}
                    placeholder="Saisissez le nouveau mot de passe..."
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 pr-10 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOwnNewPassword(!showOwnNewPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showOwnNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-800 mb-1.5">
                  Confirmer le mot de passe
                </label>
                <input
                  type={showOwnNewPassword ? 'text' : 'password'}
                  value={ownNewPasswordConfirm}
                  onChange={(e) => {
                    setOwnNewPasswordConfirm(e.target.value);
                    setOwnPasswordError('');
                  }}
                  placeholder="Ressaisissez le mot de passe..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-600"
                />
              </div>

              {ownPasswordError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {ownPasswordError}
                </p>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 bg-purple-900 hover:bg-purple-950 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>Enregistrer mon mot de passe</span>
                </button>
                {ownPasswordSaved && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Mot de passe mis à jour !
                  </span>
                )}
              </div>
            </form>
          </div>

          {/* Modèle de message de relance par e-mail */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs">
            <div className="flex items-center gap-3.5 border-b border-slate-200 pb-5">
              <div className="w-12 h-12 rounded-xl bg-amber-700 text-white flex items-center justify-center shadow-xs shrink-0">
                <Mail className="w-6 h-6 text-amber-200" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Modèle de message de relance</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Personnalisez le sujet et le texte utilisés par défaut lors des relances par e-mail des fiches incomplètes. Ce modèle reste modifiable ponctuellement au moment de chaque envoi.
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveReminderTemplate} className="mt-5 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase mb-1.5">Sujet</label>
                <input
                  type="text"
                  value={editReminderSubject}
                  onChange={(e) => setEditReminderSubject(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase mb-1.5">Message</label>
                <textarea
                  value={editReminderBody}
                  onChange={(e) => setEditReminderBody(e.target.value)}
                  rows={11}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-600"
                />
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-900">
                <p className="font-bold">Jetons disponibles, remplacés automatiquement pour chaque élève :</p>
                <p className="font-mono mt-0.5">{'{prenom} {nom} {classe} {pourcentage} {manquants} {lien} {etablissement}'}</p>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 bg-amber-700 hover:bg-amber-800 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  <Mail className="w-4 h-4" />
                  <span>Enregistrer ce modèle</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetReminderTemplate}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-3 py-2.5 cursor-pointer"
                >
                  Réinitialiser au modèle par défaut
                </button>
                {reminderTemplateSaved && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Modèle enregistré !
                  </span>
                )}
              </div>
            </form>
          </div>

          {/* Relances automatiques hebdomadaires */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs">
            <div className="flex items-center gap-3.5 border-b border-slate-200 pb-5">
              <div className="w-12 h-12 rounded-xl bg-amber-700 text-white flex items-center justify-center shadow-xs shrink-0">
                <Clock className="w-6 h-6 text-amber-200" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Relances automatiques hebdomadaires</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Chaque lundi à 8h, un e-mail est envoyé automatiquement à toutes les familles dont la fiche est encore incomplète, avec le modèle de message ci-dessus et un lien direct vers la page manquante.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <label className="flex items-center gap-3 cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={autoReminderEnabled}
                  onChange={(e) => onToggleAutoReminder && onToggleAutoReminder(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-400 text-amber-700 focus:ring-amber-600 cursor-pointer"
                />
                <span className="text-sm font-semibold text-slate-800">
                  Activer les relances automatiques hebdomadaires
                </span>
              </label>

              {autoReminderLastRun && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-600">
                  <p className="font-bold text-slate-800">
                    Dernière exécution : {new Date(autoReminderLastRun.ranAt).toLocaleString('fr-FR')}
                  </p>
                  {autoReminderLastRun.error ? (
                    <p className="text-red-700 mt-1">{autoReminderLastRun.error}</p>
                  ) : (
                    <p className="mt-1">
                      <strong className="text-emerald-700">{autoReminderLastRun.sent}</strong> envoyé(s) •{' '}
                      <strong className={autoReminderLastRun.failed > 0 ? 'text-red-700' : 'text-slate-500'}>
                        {autoReminderLastRun.failed}
                      </strong> échec(s) sur {autoReminderLastRun.total} fiche(s) incomplète(s) au total
                    </p>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handleRunAutoNow}
                disabled={runningAutoNow}
                className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {runningAutoNow ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                <span>{runningAutoNow ? 'Envoi en cours...' : 'Lancer maintenant (test / rattrapage)'}</span>
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-200 pb-5">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-blue-900 text-white flex items-center justify-center shadow-xs shrink-0">
                  <School className="w-6 h-6 text-blue-200" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Configuration du Nom de l'Établissement Scolaire
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Définissez le nom officiel de l'école, collège ou lycée qui figurera sur le portail et sur l'ensemble des fiches sanitaires de liaison officielles (PDF).
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-800 text-xs font-semibold rounded-full border border-emerald-200 shrink-0">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Fiche Sanitaire Conforme
              </span>
            </div>

            <form onSubmit={handleSaveEstablishment} className="mt-6 space-y-6 max-w-2xl">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-800 mb-2">
                  Nom officiel de l'établissement <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editEstablishmentName}
                  onChange={(e) => {
                    setEditEstablishmentName(e.target.value);
                    setEstablishmentSavedFeedback(false);
                  }}
                  placeholder="Ex: Ensemble Scolaire Notre Dame des Missions, Lycée Victor Hugo..."
                  className="w-full text-sm font-semibold text-slate-900 px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 shadow-xs bg-slate-50/50"
                  required
                />
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Ce nom sera inscrit dans le bandeau du portail, dans la Rubrique 1 « Renseignements sur l'enfant » (champ Établissement) et dans le pied de page légal du PDF officiel exporté.
                </p>
              </div>

              {/* Suggestions rapides */}
              <div>
                <span className="text-xs text-slate-500 block mb-2 font-medium">Exemples & modèles fréquents :</span>
                <div className="flex flex-wrap gap-2">
                  {[
                    'Ensemble Scolaire Notre Dame des Missions',
                    'Collège Victor Hugo',
                    'Lycée Henri IV',
                    'Groupe Scolaire Pasteur',
                    'École Primaire Saint-Exupéry',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setEditEstablishmentName(preset);
                        setEstablishmentSavedFeedback(false);
                      }}
                      className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-900 text-slate-700 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Checkbox synchronize with existing students */}
              <div className="bg-blue-50/60 p-4 rounded-xl border border-blue-200 flex items-start gap-3">
                <input
                  type="checkbox"
                  id="applyToStudentsCheckbox"
                  checked={applyToExistingStudents}
                  onChange={(e) => setApplyToExistingStudents(e.target.checked)}
                  className="mt-0.5 rounded border-blue-400 text-blue-900 focus:ring-blue-700 cursor-pointer"
                />
                <label htmlFor="applyToStudentsCheckbox" className="text-xs text-slate-700 cursor-pointer">
                  <strong className="block text-slate-900 font-semibold">
                    Ce nom s'affiche automatiquement sur l'ensemble des {students.length} fiches élèves et sur les nouveaux PDF
                  </strong>
                  Le nom enregistré est utilisé partout (fiches, pied de page, nouveaux PDF, liste des inscrits). Pour corriger les PDF déjà archivés sur le serveur, utilisez le bouton « Régénérer les PDF » plus bas.
                </label>
              </div>

              {/* Submit button */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 bg-blue-900 hover:bg-blue-950 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>Enregistrer le nom de l'établissement</span>
                </button>
                {establishmentSavedFeedback && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg animate-fade-in">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Enregistré avec succès !
                  </span>
                )}
              </div>
            </form>

            {/* PDF archivés : régénération en masse avec le nom enregistré (build pdf-regeneration-20261005) */}
            <PdfRegenerator students={students} trips={trips} establishmentName={establishmentName} />

            {/* Live Visual Preview */}
            <div className="mt-8 pt-6 border-t border-slate-200">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
                Aperçu en direct (Portail & PDF officiel)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Header preview */}
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                  <div className="text-[11px] font-bold text-slate-500 uppercase mb-2">
                    En-tête de navigation du portail
                  </div>
                  <div className="flex items-center gap-2.5 bg-white p-3 rounded-lg border border-slate-200 shadow-2xs">
                    <div className="w-8 h-8 rounded-lg bg-blue-900 flex items-center justify-center text-white shrink-0 overflow-hidden">
                      {logoUrl ? (
                        <img src={logoUrl} alt="Logo" className="w-full h-full object-contain bg-white" />
                      ) : (
                        <FileText className="w-4 h-4 text-blue-200" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 leading-none">Portail Fiche Sanitaire</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                        Dématérialisation et conformité sanitaire
                      </div>
                    </div>
                    <span className="ml-auto text-[11px] bg-slate-100 text-slate-800 px-2.5 py-0.5 rounded-full border border-slate-200 font-medium truncate max-w-[160px]">
                      {editEstablishmentName || '—'}
                    </span>
                  </div>
                </div>

                {/* PDF preview */}
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                  <div className="text-[11px] font-bold text-slate-500 uppercase mb-2">
                    Fiche sanitaire de liaison (PDF 1 page)
                  </div>
                  <div className="bg-white p-3.5 rounded-lg border border-slate-200 text-xs shadow-2xs space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-slate-600 border-b border-slate-100 pb-1">
                      <span className="font-mono text-blue-900 font-bold">Fiche Sanitaire Officielle</span>
                    </div>
                    <div className="text-[11px] text-slate-800">
                      <span className="font-semibold text-slate-500">Établissement : </span>
                      <strong className="text-slate-950 font-bold">{editEstablishmentName || '—'}</strong>
                    </div>
                    <div className="text-[9px] text-slate-400 border-t border-slate-100 pt-1.5 truncate">
                      Fiche Sanitaire de Liaison — Établissement scolaire — {editEstablishmentName || '—'} — Document confidentiel
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: AUDIT & RGPD */}
      {/* TAB: CORBEILLE */}
      {activeTab === 'trash' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Corbeille</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Les fiches supprimées restent ici 30 jours avant suppression définitive et automatique. Vous pouvez les restaurer à tout moment pendant ce délai.
            </p>
          </div>

          {trashedStudents.length === 0 ? (
            <div className="text-center py-10 text-sm text-slate-400 italic">La corbeille est vide.</div>
          ) : (
            <div className="space-y-2.5">
              {trashedStudents.map((s) => {
                const deletedDate = s.deletedAt ? new Date(s.deletedAt) : null;
                const daysLeft = deletedDate
                  ? Math.max(0, 30 - Math.floor((Date.now() - deletedDate.getTime()) / 86400000))
                  : null;
                return (
                  <div
                    key={s.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-slate-200 rounded-xl p-3.5 bg-slate-50"
                  >
                    <div>
                      <p className="font-bold text-sm text-slate-900">
                        {s.cerfa.identity.lastName.toUpperCase()} {s.cerfa.identity.firstName}{' '}
                        <span className="font-normal text-slate-500">({s.schoolClass})</span>
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Supprimée le {deletedDate?.toLocaleDateString('fr-FR')} à {deletedDate?.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        {daysLeft !== null && (
                          <>
                            {' '}•{' '}
                            <span className={daysLeft <= 5 ? 'text-red-600 font-semibold' : ''}>
                              {daysLeft > 0 ? `${daysLeft} jour${daysLeft > 1 ? 's' : ''} avant suppression définitive` : 'Suppression définitive imminente'}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onRestoreStudent && onRestoreStudent(s.id)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restaurer</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setStudentToPermanentlyDelete(s)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 hover:text-red-800 bg-red-50 hover:bg-red-100 border border-red-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Supprimer définitivement</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal: Permanently delete from trash */}
      {studentToPermanentlyDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 text-red-700 rounded-xl">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-base text-slate-900">Supprimer définitivement</h4>
                <p className="text-xs text-slate-600 mt-1">
                  Cette action est <strong>irréversible</strong>. La fiche sanitaire de{' '}
                  <strong>
                    {studentToPermanentlyDelete.cerfa.identity.lastName.toUpperCase()} {studentToPermanentlyDelete.cerfa.identity.firstName}
                  </strong>{' '}
                  et toutes ses données (médical, documents joints, inscriptions aux voyages) seront perdues pour toujours.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setStudentToPermanentlyDelete(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onPermanentlyDeleteStudent) {
                    onPermanentlyDeleteStudent(studentToPermanentlyDelete.id);
                  }
                  setStudentToPermanentlyDelete(null);
                }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition cursor-pointer shadow-xs"
              >
                Supprimer définitivement
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              Journal d audit et traçabilité RGPD (Données de santé protégées)
            </h3>
            <p className="text-xs text-slate-500">
              Conformément à la réglementation sur les données sensibles de santé des mineurs, toutes les révisions et signatures sont horodatées.
            </p>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">Horodatage</th>
                  <th className="p-3">Élève concerné</th>
                  <th className="p-3">Opération</th>
                  <th className="p-3">Auteur / Identité</th>
                  <th className="p-3">Rôle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {students.flatMap((st) =>
                  st.cerfa.history.map((h) => (
                    <tr key={h.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono text-slate-500 text-[11px]">{h.date}</td>
                      <td className="p-3 font-semibold text-slate-900">
                        {st.cerfa.identity.lastName} {st.cerfa.identity.firstName} ({st.schoolClass})
                      </td>
                      <td className="p-3 font-medium text-slate-800">{h.action}</td>
                      <td className="p-3 text-slate-700">{h.authorName}</td>
                      <td className="p-3 text-slate-500">{h.authorRole}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal : Modifier un voyage */}
      {editingTrip && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-blue-800" />
                <h4 className="font-bold text-base text-slate-900">Modifier le voyage</h4>
              </div>
              <button
                type="button"
                onClick={() => setEditingTrip(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditTrip} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Nom du voyage *</label>
                <input
                  type="text"
                  value={editTripName}
                  onChange={(e) => setEditTripName(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                  required
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">Destination *</label>
                <input
                  type="text"
                  value={editTripDestination}
                  onChange={(e) => setEditTripDestination(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">Date début</label>
                  <input
                    type="date"
                    value={editTripStart}
                    onChange={(e) => setEditTripStart(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">Date fin</label>
                  <input
                    type="date"
                    value={editTripEnd}
                    onChange={(e) => setEditTripEnd(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">Capacité max</label>
                  <input
                    type="number"
                    value={editTripMax}
                    onChange={(e) => setEditTripMax(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">Classes (séparées par virgule)</label>
                  <input
                    type="text"
                    value={editTripClasses}
                    onChange={(e) => setEditTripClasses(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>

              {/* Organisateurs */}
              <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3 space-y-2.5">
                <span className="font-bold text-blue-950 uppercase text-[11px] block">
                  Organisateurs assignés (comptes existants)
                </span>
                <div>
                  <label className="block font-semibold text-slate-700 text-[11px] mb-0.5">Organisateur 1</label>
                  <select
                    value={editTripOrganizer1Id}
                    onChange={(e) => setEditTripOrganizer1Id(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                  >
                    <option value="">-- Aucun --</option>
                    {organizerUsers.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name} ({org.email})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 text-[11px] mb-0.5">Organisateur 2 (optionnel)</label>
                  <select
                    value={editTripOrganizer2Id}
                    onChange={(e) => setEditTripOrganizer2Id(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                  >
                    <option value="">-- Aucun second organisateur --</option>
                    {organizerUsers.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name} ({org.email})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Voyage obligatoire & contacts remise documents */}
              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 space-y-3">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editTripRequireSelection}
                    onChange={(e) => setEditTripRequireSelection(e.target.checked)}
                    className="mt-0.5 rounded border-amber-400 text-amber-700 focus:ring-amber-600 cursor-pointer"
                  />
                  <span className="text-xs text-amber-900">
                    <strong className="block font-bold">
                      Rendre le choix d'un voyage obligatoire pour enregistrer la fiche sanitaire
                    </strong>
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="block font-bold text-slate-700 uppercase mb-1">1er professeur référent</label>
                    <input
                      type="text"
                      value={editTripTeacher1}
                      onChange={(e) => setEditTripTeacher1(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 uppercase mb-1">2e professeur référent</label>
                    <input
                      type="text"
                      value={editTripTeacher2}
                      onChange={(e) => setEditTripTeacher2(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={editTripShowPrintReminder}
                    onChange={(e) => setEditTripShowPrintReminder(e.target.checked)}
                    className="mt-0.5 rounded border-amber-400 text-amber-700 focus:ring-amber-600 cursor-pointer"
                  />
                  <span className="text-xs text-amber-900">
                    <strong className="block font-bold">
                      Afficher le message de remise des documents aux parents
                    </strong>
                  </span>
                </label>

                <div className="pt-1">
                  <label className="block font-bold text-slate-700 uppercase mb-1">
                    Mot de passe accompagnateurs (accès lecture seule aux fiches)
                  </label>
                  <input
                    type="text"
                    value={editTripChaperonePassword}
                    placeholder="Laissez vide pour désactiver cet accès"
                    onChange={(e) => setEditTripChaperonePassword(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingTrip(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs transition cursor-pointer shadow-xs"
                >
                  Enregistrer les modifications
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Revoke magic link */}
      {studentToRevokeLink && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 text-red-700 rounded-xl">
                <Link2Off className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-base text-slate-900">Révoquer le lien direct</h4>
                <p className="text-xs text-slate-600 mt-1">
                  Le lien direct (sans connexion) de{' '}
                  <strong>
                    {studentToRevokeLink.cerfa.identity.lastName.toUpperCase()} {studentToRevokeLink.cerfa.identity.firstName}
                  </strong>{' '}
                  cessera immédiatement de fonctionner, y compris s'il a déjà été envoyé par e-mail ou copié. Un nouveau lien pourra être généré à tout moment via "Copier le lien".
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setStudentToRevokeLink(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => handleRevokeMagicLink(studentToRevokeLink)}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition cursor-pointer shadow-xs"
              >
                Révoquer le lien
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal : export "prêt à coller" pour ÉcoleDirecte (ou autre canal manuel) */}
      {ecoleDirecteBlocks && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-100 text-indigo-700 rounded-xl">
                  <Copy className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-base text-slate-900">
                    Export pour ÉcoleDirecte ({ecoleDirecteBlocks.length} famille{ecoleDirecteBlocks.length > 1 ? 's' : ''})
                  </h4>
                  <p className="text-xs text-slate-500">
                    Un message prêt à coller par famille, avec son lien direct personnel. Copiez et collez-le dans la messagerie ÉcoleDirecte, pour le destinataire indiqué.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEcoleDirecteBlocks(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDownloadEcoleDirecteExport}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Télécharger tout (.txt)</span>
              </button>
            </div>

            <div className="space-y-3">
              {ecoleDirecteBlocks.map((block) => (
                <div key={block.studentId} className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-50 border-b border-slate-200 px-3.5 py-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-800">{block.label}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyEcoleDirecteBlock(block)}
                      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                        copiedBlockId === block.studentId
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-indigo-100 hover:bg-indigo-200 text-indigo-800'
                      }`}
                    >
                      {copiedBlockId === block.studentId ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Copié !</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copier ce message</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="text-[11px] text-slate-600 whitespace-pre-wrap p-3.5 font-sans leading-relaxed max-h-32 overflow-y-auto">
                    {block.text}
                  </pre>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEcoleDirecteBlocks(null)}
                className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs transition cursor-pointer shadow-xs"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal : Aperçu / édition du message de relance avant envoi */}
      {reminderDraft && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-base text-slate-900">
                    {reminderDraft.mode === 'single'
                      ? `Relancer ${reminderDraft.targets[0].cerfa.identity.firstName} ${reminderDraft.targets[0].cerfa.identity.lastName.toUpperCase()}`
                      : `Relancer ${reminderDraft.targets.length} fiches incomplètes`}
                  </h4>
                  <p className="text-xs text-slate-500">Relisez et modifiez le message avant l'envoi</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReminderDraft(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {reminderDraft.mode === 'bulk' && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[11px] text-blue-900 space-y-1">
                <p className="font-bold">Un seul message pour {reminderDraft.targets.length} destinataires : utilisez ces jetons, remplacés automatiquement pour chaque élève au moment de l'envoi.</p>
                <p className="font-mono">{'{prenom} {nom} {classe} {pourcentage} {manquants} {lien} {etablissement}'}</p>
                <p>Le jeton {'{lien}'} devient un lien direct et personnel vers la fiche de chaque élève (sans connexion nécessaire), qui ouvre directement la page manquante.</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Sujet</label>
              <input
                type="text"
                value={reminderDraft.subject}
                onChange={(e) => setReminderDraft({ ...reminderDraft, subject: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Message</label>
              <textarea
                value={reminderDraft.body}
                onChange={(e) => setReminderDraft({ ...reminderDraft, body: e.target.value })}
                rows={12}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono leading-relaxed"
              />
            </div>

            {reminderDraft.mode === 'bulk' && (
              <div>
                <span className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Aperçu pour {reminderDraft.targets[0].cerfa.identity.firstName} {reminderDraft.targets[0].cerfa.identity.lastName.toUpperCase()} (1er destinataire)
                </span>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[11px] text-slate-600 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {renderReminderTemplate(reminderDraft.body, reminderDraft.targets[0])}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setReminderDraft(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmSendReminders}
                className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold text-xs transition cursor-pointer shadow-xs"
              >
                Envoyer {reminderDraft.mode === 'bulk' ? `(${reminderDraft.targets.length})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result Modal: reminder send outcome */}
      {reminderResult && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-xl ${reminderResult.failed > 0 && reminderResult.sent === 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {reminderResult.failed > 0 && reminderResult.sent === 0 ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-base text-slate-900">Résultat de l'envoi</h4>
                <p className="text-xs text-slate-600 mt-1">
                  <strong className="text-emerald-700">{reminderResult.sent}</strong> e-mail(s) envoyé(s)
                  {reminderResult.failed > 0 && (
                    <>
                      {' '}• <strong className="text-red-700">{reminderResult.failed}</strong> échec(s)
                    </>
                  )}
                </p>
                {reminderResult.failedNames && reminderResult.failedNames.length > 0 && (
                  <ul className="mt-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5 space-y-1 max-h-32 overflow-y-auto">
                    {reminderResult.failedNames.map((n, i) => (
                      <li key={i}>• {n}</li>
                    ))}
                  </ul>
                )}
                {reminderResult.failed > 0 && (
                  <p className="text-[11px] text-slate-500 mt-2">
                    Si tous les envois échouent, vérifiez la configuration SMTP (variables SMTP_* dans le fichier .env du serveur).
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setReminderResult(null)}
                className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs transition cursor-pointer shadow-xs"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Delete Student Sheet */}
      {studentToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-base text-slate-900">Déplacer vers la corbeille</h4>
                <p className="text-xs text-slate-600 mt-1">
                  Êtes-vous certain de vouloir déplacer vers la corbeille la fiche sanitaire de{' '}
                  <strong>
                    {studentToDelete.cerfa.identity.lastName.toUpperCase()} {studentToDelete.cerfa.identity.firstName}
                  </strong>{' '}
                  ({studentToDelete.schoolClass}) ?
                </p>
                <p className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-2 mt-2">
                  ℹ️ La fiche disparaît immédiatement de tous les espaces (parent, organisateur, admin), mais reste récupérable depuis la Corbeille pendant 30 jours avant suppression définitive automatique.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setStudentToDelete(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onDeleteStudent) {
                    onDeleteStudent(studentToDelete.id);
                  }
                  setStudentToDelete(null);
                }}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition cursor-pointer shadow-xs"
              >
                Déplacer vers la corbeille
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Delete Trip */}
      {tripToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 text-red-700 rounded-xl">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-base text-slate-900">Supprimer le voyage scolaire</h4>
                <p className="text-xs text-slate-600 mt-1">
                  Êtes-vous certain de vouloir supprimer le voyage <strong>« {tripToDelete.name} »</strong> ({tripToDelete.destination}) ?
                </p>
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
                  ⚠️ Tous les élèves inscrits à ce voyage seront automatiquement désinscrits. Cette action est irréversible.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setTripToDelete(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onDeleteTrip) {
                    onDeleteTrip(tripToDelete.id);
                  }
                  setTripToDelete(null);
                }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition cursor-pointer shadow-xs"
              >
                Confirmer la suppression
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Delete User */}
      {userToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 text-red-700 rounded-xl">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-base text-slate-900">Supprimer le compte utilisateur</h4>
                <p className="text-xs text-slate-600 mt-1">
                  Êtes-vous certain de vouloir supprimer le compte de <strong>{userToDelete.name}</strong> ?
                </p>
                <p className="text-[11px] text-slate-500 font-mono mt-1">
                  Email : {userToDelete.email} • Rôle : {userToDelete.role}
                </p>
                <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 mt-2">
                  L utilisateur ne pourra plus se connecter. Cette action est irréversible.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onDeleteUser) {
                    onDeleteUser(userToDelete.id);
                  }
                  setUserToDelete(null);
                }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition cursor-pointer shadow-xs"
              >
                Supprimer le compte
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Admin Enrollment of Student to Trip */}
      {studentForTripEnrollment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plane className="w-5 h-5 text-blue-800" />
                <h4 className="font-bold text-base text-slate-900">Inscription à un voyage</h4>
              </div>
              <button
                type="button"
                onClick={() => setStudentForTripEnrollment(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3 text-xs text-blue-950">
              Élève : <strong>{studentForTripEnrollment.cerfa.identity.lastName.toUpperCase()} {studentForTripEnrollment.cerfa.identity.firstName}</strong>
              <br />
              Classe : <span className="font-semibold text-blue-900">{studentForTripEnrollment.schoolClass}</span>
              <br />
              État CERFA : <span className="font-semibold">{studentForTripEnrollment.status === 'complete' ? 'Complet (100%)' : `Incomplet (${studentForTripEnrollment.completenessPercent}%)`}</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Sélectionner le séjour scolaire à attribuer :
              </label>
              {trips.length === 0 ? (
                <p className="text-xs text-slate-400 italic">Aucun voyage disponible.</p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {trips.map((t) => {
                    const isAlreadyEnrolled = studentForTripEnrollment.registeredTripIds.includes(t.id);
                    const isEligibleClass = t.eligibleClasses.includes(studentForTripEnrollment.schoolClass);
                    const enrolledCount = students.filter((s) => s.registeredTripIds.includes(t.id)).length;

                    return (
                      <div
                        key={t.id}
                        onClick={() => {
                          if (!isAlreadyEnrolled) {
                            setSelectedTripToEnrollId(t.id);
                          }
                        }}
                        className={`p-3 rounded-xl border text-xs cursor-pointer transition ${
                          isAlreadyEnrolled
                            ? 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
                            : selectedTripToEnrollId === t.id
                            ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-300'
                            : 'bg-white border-slate-200 hover:border-blue-300'
                        }`}
                      >
                        <div className="flex items-center justify-between font-bold text-slate-900">
                          <span>{t.name}</span>
                          <span className="text-[10px] font-semibold text-slate-500">
                            {enrolledCount} / {t.maxStudents}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {t.destination} • {formatDateFr(t.startDate)} au {formatDateFr(t.endDate)}
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className={`text-[10px] font-semibold ${isEligibleClass ? 'text-emerald-700' : 'text-slate-500'}`}>
                            {isEligibleClass ? '✓ Classe éligible' : `Classes : ${t.eligibleClasses.join(', ')}`}
                          </span>
                          {isAlreadyEnrolled && (
                            <span className="text-[10px] text-blue-700 font-bold">Déjà inscrit</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-500 italic">
              ℹ️ En tant qu administrateur, vous pouvez inscrire l élève même si le responsable légal n a pas encore effectué la démarche en ligne.
            </p>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setStudentForTripEnrollment(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50 cursor-pointer"
              >
                Fermer
              </button>
              <button
                type="button"
                disabled={!selectedTripToEnrollId || studentForTripEnrollment.registeredTripIds.includes(selectedTripToEnrollId)}
                onClick={() => {
                  if (onRegisterTrip && selectedTripToEnrollId) {
                    onRegisterTrip(studentForTripEnrollment.id, selectedTripToEnrollId);
                  }
                  setStudentForTripEnrollment(null);
                }}
                className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
              >
                Confirmer l inscription
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmation de purge des comptes démo */}
    </div>
  );
};
