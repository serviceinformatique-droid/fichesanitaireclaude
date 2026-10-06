import React, { useState, useEffect } from 'react';
import {
  User,
  Student,
  Trip,
  SchoolClass,
  NotificationItem,
  CerfaSanitarySheet,
} from './types';
import {
  getStoredUsers,
  getStoredStudents,
  getStoredTrips,
  getStoredClasses,
  getStoredNotifications,
  saveStoredStudents,
  upsertStoredStudent,
  saveStudentChecked,
  removeStoredStudent,
  saveStoredTrips,
  saveStoredUsers,
  upsertStoredUser,
  removeStoredUser,
  saveStoredClasses,
  saveStoredNotifications,
  getStoredEstablishmentName,
  saveStoredEstablishmentName,
  getStoredLogo,
  saveStoredLogo,
  getStoredReminderTemplate,
  saveStoredReminderTemplate,
  ReminderTemplate,
  getStoredAutoReminderEnabled,
  saveStoredAutoReminderEnabled,
  getStoredAutoReminderLastRun,
  AutoReminderRunSummary,
  setCurrentUserId,
  getStoredCurrentUserId,
  clearStoredCurrentUserId,
  resetToMockData,
  purgeDemoAccounts,
  createBlankCerfa,
} from './utils/storage';
import { computeCerfaCompleteness } from './utils/cerfaValidation';
import { Header } from './components/Header';
import { CommunicationCenter } from './components/CommunicationCenter';
import { ParentSpace } from './components/ParentSpace';
import { OrganizerSpace } from './components/OrganizerSpace';
import { AdminSpace } from './components/AdminSpace';
import { CerfaEditor } from './components/CerfaEditor';
import { CerfaOfficialView } from './components/CerfaOfficialView';
import { StartupAuthGate } from './components/StartupAuthGate';
import { MagicLinkAccess } from './components/MagicLinkAccess';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { sendCompletedFichePdfByEmail } from './utils/pdfGenerator';

export default function App() {
  // Accès direct par lien à jeton (sans connexion), façon DocuSeal — détecté
  // AVANT tout chargement des données pour ne jamais synchroniser la liste
  // complète des élèves chez un visiteur non authentifié.
  const magicLinkToken = new URLSearchParams(window.location.search).get('ficheToken');

  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Administrateur d'origine quand il consulte un autre compte : retour en un clic, sans se
  // reconnecter. Mémorisé pour l'onglet du navigateur seulement (sessionStorage).
  const ORIGIN_ADMIN_KEY = 'cerfa_origin_admin_id';
  const [originAdminId, setOriginAdminId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(ORIGIN_ADMIN_KEY);
    } catch {
      return null;
    }
  });
  const updateOriginAdmin = (id: string | null) => {
    setOriginAdminId(id);
    try {
      if (id) sessionStorage.setItem(ORIGIN_ADMIN_KEY, id);
      else sessionStorage.removeItem(ORIGIN_ADMIN_KEY);
    } catch {
      /* stockage indisponible : le retour fonctionne tant que la page reste ouverte */
    }
  };
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [establishmentName, setEstablishmentName] = useState<string>('Ensemble Scolaire Notre Dame des Missions');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [reminderTemplate, setReminderTemplate] = useState<ReminderTemplate | null>(null);
  const [autoReminderEnabled, setAutoReminderEnabled] = useState<boolean>(true);
  const [autoReminderLastRun, setAutoReminderLastRun] = useState<AutoReminderRunSummary | null>(null);

  // Navigation state (parent, organizer, admin, cerfa_view, cerfa_edit)
  const [activeTab, setActiveTab] = useState<'parent' | 'organizer' | 'admin' | 'cerfa_view' | 'cerfa_edit'>('parent');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [editorInitialSection, setEditorInitialSection] = useState<'identite' | 'vaccins' | 'medical' | 'regime' | 'documents' | 'signature'>('identite');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'warning' } | null>(null);

  // Initialize storage
  useEffect(() => {
    if (magicLinkToken) return; // rien à charger : MagicLinkAccess gère tout via son propre appel scopé
    const loadedUsers = getStoredUsers();
    const loadedStudents = getStoredStudents();
    const loadedTrips = getStoredTrips();
    const loadedClasses = getStoredClasses();
    const loadedNotifs = getStoredNotifications();
    const loadedEstablishment = getStoredEstablishmentName();
    const loadedLogo = getStoredLogo();
    const loadedReminderTemplate = getStoredReminderTemplate();
    const loadedAutoReminderEnabled = getStoredAutoReminderEnabled();
    const loadedAutoReminderLastRun = getStoredAutoReminderLastRun();

    setUsers(loadedUsers);
    setStudents(loadedStudents);
    setTrips(loadedTrips);
    setClasses(loadedClasses);
    setNotifications(loadedNotifs);
    setEstablishmentName(loadedEstablishment);
    setLogoUrl(loadedLogo);
    setReminderTemplate(loadedReminderTemplate);
    setAutoReminderEnabled(loadedAutoReminderEnabled);
    setAutoReminderLastRun(loadedAutoReminderLastRun);

    // Restaure la session en cours si l'utilisateur avait déjà une session active
    // (évite d'être déconnecté à chaque rechargement / retour arrière du navigateur)
    const storedUserId = getStoredCurrentUserId();
    const restoredUser = storedUserId ? loadedUsers.find((u) => u.id === storedUserId) : undefined;
    if (restoredUser) {
      setCurrentUser(restoredUser);
      setIsAuthenticated(true);
      if (restoredUser.role === 'admin') {
        setActiveTab('admin');
      } else if (restoredUser.role === 'organizer') {
        setActiveTab('organizer');
      } else {
        setActiveTab('parent');
      }
      return;
    }
    // Sinon, demande la connexion / création de compte
    setIsAuthenticated(false);
    setCurrentUser(null);
  }, []);

  const showToast = (text: string, type: 'success' | 'info' | 'warning' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Login from StartupAuthGate
  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
    setCurrentUserId(user.id);
    if (user.role === 'admin') {
      setActiveTab('admin');
    } else if (user.role === 'organizer') {
      setActiveTab('organizer');
    } else {
      setActiveTab('parent');
    }
    showToast(`Bienvenue, ${user.name} ! Session active.`, 'success');
  };

  // Register new parent
  const handleRegisterParent = async (newParentData: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    password: string;
    secretQuestion: string;
    secretAnswer: string;
  }): Promise<User> => {
    const newUser: User = {
      id: 'parent-' + Date.now(),
      name: `${newParentData.firstName} ${newParentData.lastName}`,
      firstName: newParentData.firstName,
      lastName: newParentData.lastName,
      email: newParentData.email,
      phone: newParentData.phone,
      role: 'parent',
      password: newParentData.password,
      secretQuestion: newParentData.secretQuestion,
      secretAnswer: newParentData.secretAnswer,
      isDemo: false,
    };
    const updated = [...users, newUser];
    setUsers(updated);
    await upsertStoredUser(newUser);
    return newUser;
  };

  // Reset password with secret question
  const handleResetPasswordWithSecret = async (
    email: string,
    secretAnswer: string,
    newPassword: string
  ): Promise<{ success: boolean; message: string; user?: User }> => {
    const user = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) {
      return { success: false, message: 'Aucun compte trouvé avec cette adresse email.' };
    }
    if (!user.secretAnswer) {
      return {
        success: false,
        message: "Aucune question secrète n'a été configurée pour ce compte. Veuillez contacter l'administration.",
      };
    }
    if (user.secretAnswer.trim().toLowerCase() !== secretAnswer.trim().toLowerCase()) {
      return { success: false, message: 'Réponse secrète incorrecte.' };
    }

    const updatedUser: User = { ...user, password: newPassword };
    const updatedUsers = users.map((u) => (u.id === user.id ? updatedUser : u));
    setUsers(updatedUsers);
    await upsertStoredUser(updatedUser);
    return {
      success: true,
      message: 'Mot de passe mis à jour avec succès !',
      user: updatedUser,
    };
  };

  // Purge demo accounts
  const handlePurgeDemo = () => {
    const adminIdToKeep = currentUser?.role === 'admin' ? currentUser.id : undefined;
    const purged = purgeDemoAccounts(adminIdToKeep);
    setUsers(purged.users);
    setStudents(purged.students);
    if (adminIdToKeep) {
      const activeAdmin = purged.users.find((u) => u.id === adminIdToKeep) || purged.users.find((u) => u.role === 'admin');
      if (activeAdmin) {
        setCurrentUser(activeAdmin);
        setIsAuthenticated(true);
        showToast('Données et comptes de démonstration purgés. Votre compte administrateur est conservé.', 'success');
        return;
      }
    }
    setIsAuthenticated(false);
    setCurrentUser(null);
    showToast('Comptes et élèves de démonstration purgés avec succès.', 'info');
  };

  // Logout / Return to startup gate
  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    setSelectedStudent(null);
    clearStoredCurrentUserId();
    updateOriginAdmin(null);
    showToast('Déconnexion effectuée. À bientôt !', 'info');
  };

  // Switch role / user
  const handleSwitchUser = (newUser: User) => {
    // Un administrateur qui consulte un autre compte garde la possibilité d'y revenir
    if (currentUser && currentUser.role === 'admin' && newUser.role !== 'admin') updateOriginAdmin(currentUser.id);
    else if (newUser.role === 'admin') updateOriginAdmin(null);
    setCurrentUser(newUser);
    setCurrentUserId(newUser.id);
    if (newUser.role === 'parent') {
      setActiveTab('parent');
    } else if (newUser.role === 'organizer') {
      setActiveTab('organizer');
    } else if (newUser.role === 'admin') {
      setActiveTab('admin');
    }
    showToast(`Connecté en tant que ${newUser.name} (${newUser.role.toUpperCase()})`, 'info');
  };

  // Tab selection from Header
  const handleSelectTab = (tab: 'parent' | 'organizer' | 'admin') => {
    setActiveTab(tab);
    setSelectedStudent(null);
  };

  // Open CERFA Editor (Forbidden for organizers)
  const handleOpenEditor = (
    student: Student,
    section: 'identite' | 'vaccins' | 'medical' | 'regime' | 'documents' | 'signature' = 'identite'
  ) => {
    if (currentUser?.role === 'organizer') {
      // Organizers are restricted to consultation / read-only mode
      handleOpenOfficialView(student);
      showToast("L'organisateur dispose d'un accès en consultation seule (non modifiable).", 'info');
      return;
    }
    setSelectedStudent(student);
    setEditorInitialSection(section);
    setActiveTab('cerfa_edit');
  };

  // Open Official CERFA Printable View
  const handleOpenOfficialView = (student: Student) => {
    setSelectedStudent(student);
    setActiveTab('cerfa_view');
  };

  // Conflit d'enregistrement : la fiche a été modifiée par quelqu'un d'autre depuis l'ouverture
  const handleSaveConflict = () => {
    const reload = window.confirm(
      "Cette fiche vient d'être modifiée par quelqu'un d'autre (l'autre responsable, un autre appareil ou l'établissement) depuis votre ouverture de la page.\n\nPour ne pas écraser ses informations, votre enregistrement a été refusé.\n\nOK : recharger la dernière version.\nAnnuler : rester sur cette page (vous devrez la recharger pour pouvoir enregistrer)."
    );
    if (reload) window.location.reload();
  };

  // Save CERFA modifications
  const handleSaveStudent = async (updatedStudent: Student) => {
    const updatedList = students.map((s) => (s.id === updatedStudent.id ? updatedStudent : s));
    const knownVersion = students.find((s) => s.id === updatedStudent.id)?.updatedAt;
    setStudents(updatedList);
    const saveResult = await saveStudentChecked(updatedStudent, knownVersion);
    if (!saveResult.ok) {
      setStudents(students);
      if (saveResult.conflict) handleSaveConflict();
      else window.alert("L'enregistrement sur le serveur a échoué. Vérifiez votre connexion et réessayez.");
      return;
    }
    setSelectedStudent(updatedStudent);
    setActiveTab('cerfa_view');
    showToast(
      `Fiche CERFA de ${updatedStudent.cerfa.identity.firstName} ${updatedStudent.cerfa.identity.lastName} enregistrée avec succès. Version ${updatedStudent.cerfa.signature.version || 1} archivée.`,
      'success'
    );
    // Envoi systématique du PDF de la fiche complète par e-mail (ne bloque jamais la suite)
    if (updatedStudent.status === 'complete') {
      sendCompletedFichePdfByEmail(updatedStudent, trips, establishmentName).then((sentAt) => {
        if (sentAt) {
          setStudents((prev) => prev.map((s) => (s.id === updatedStudent.id ? { ...s, pdfSentAt: sentAt } : s)));
        }
      });
    }
  };

  // Enregistre un brouillon (fiche incomplète) sans bloquer ni quitter le formulaire,
  // pour que personne ne perde sa progression entre deux visites.
  const handleSaveDraft = async (updatedStudent: Student) => {
    const updatedList = students.map((s) => (s.id === updatedStudent.id ? updatedStudent : s));
    const knownVersion = students.find((s) => s.id === updatedStudent.id)?.updatedAt;
    setStudents(updatedList);
    const saveResult = await saveStudentChecked(updatedStudent, knownVersion);
    if (!saveResult.ok) {
      setStudents(students);
      if (saveResult.conflict) handleSaveConflict();
      else window.alert("L'enregistrement du brouillon sur le serveur a échoué. Vérifiez votre connexion et réessayez.");
      return;
    }
    setSelectedStudent(updatedStudent);
    showToast('Brouillon enregistré. Vous pourrez reprendre la saisie plus tard.', 'info');
  };

  // Add child to parent
  const handleAddChild = async (data: {
    firstName: string;
    lastName: string;
    birthDate: string;
    gender: 'Garcon' | 'Fille';
    schoolClass: string;
    boardingStatus: 'DP' | 'Externe' | 'Interne';
  }) => {
    if (!currentUser) return;
    if (!currentUser.id) {
      showToast("Votre session n'est plus valide : déconnectez-vous puis reconnectez-vous avant d'ajouter un enfant.", 'warning');
      return;
    }

    const newCerfa: CerfaSanitarySheet = createBlankCerfa({
      firstName: data.firstName,
      lastName: data.lastName,
      birthDate: data.birthDate,
      gender: data.gender,
    });

    const completeness = computeCerfaCompleteness(newCerfa);

    const newStudent: Student = {
      id: 's-' + Date.now(),
      parentId: currentUser.id,
      internalId: `E-2026-${Math.floor(Math.random() * 900) + 100}`,
      schoolEstablishment: establishmentName || 'Ensemble Scolaire Notre Dame des Missions',
      schoolClass: data.schoolClass,
      schoolLevel: data.schoolClass.startsWith('6') ? '6e' : data.schoolClass.startsWith('5') ? '5e' : data.schoolClass.startsWith('4') ? '4e' : '3e',
      schoolYear: '2026-2027',
      boardingStatus: data.boardingStatus,
      registeredTripIds: [],
      status: completeness.isComplete ? 'complete' : 'incomplete',
      completenessPercent: completeness.percent,
      cerfa: newCerfa,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const saved = await upsertStoredStudent(newStudent, { checkDuplicate: true });
    if (!saved) {
      showToast(
        `Une fiche existe déjà pour ${data.firstName} ${data.lastName}. Merci de ne pas créer de doublon : une seule fiche par élève et la signature d'un seul responsable légal suffisent.`,
        'warning'
      );
      return;
    }
    setStudents((prev) => [...prev, newStudent]);
    showToast(`Dossier de ${data.firstName} ${data.lastName} créé. Vous pouvez compléter sa fiche.`, 'success');
  };

  // Trip registration
  const handleRegisterTrip = async (studentId: string, tripId: string) => {
    let updatedStudent: Student | null = null;
    const updated = students.map((s) => {
      if (s.id === studentId) {
        if (!s.registeredTripIds.includes(tripId)) {
          updatedStudent = { ...s, registeredTripIds: [...s.registeredTripIds, tripId] };
          return updatedStudent;
        }
        updatedStudent = s;
      }
      return s;
    });
    setStudents(updated);
    if (updatedStudent) await upsertStoredStudent(updatedStudent);
    if (selectedStudent && selectedStudent.id === studentId) {
      if (!selectedStudent.registeredTripIds.includes(tripId)) {
        setSelectedStudent({
          ...selectedStudent,
          registeredTripIds: [...selectedStudent.registeredTripIds, tripId],
        });
      }
    }
    showToast('Élève inscrit au voyage avec succès.', 'success');
  };

  const handleUnregisterTrip = async (studentId: string, tripId: string) => {
    let updatedStudent: Student | null = null;
    const updated = students.map((s) => {
      if (s.id === studentId) {
        updatedStudent = {
          ...s,
          registeredTripIds: s.registeredTripIds.filter((t) => t !== tripId),
        };
        return updatedStudent;
      }
      return s;
    });
    setStudents(updated);
    if (updatedStudent) await upsertStoredStudent(updatedStudent);
    if (selectedStudent && selectedStudent.id === studentId) {
      setSelectedStudent({
        ...selectedStudent,
        registeredTripIds: selectedStudent.registeredTripIds.filter((t) => t !== tripId),
      });
    }
    showToast('Inscription au voyage retirée avec succès.', 'info');
  };

  // Add trip (Admin) with organizer account creation/assignment
  const handleAddTrip = async (
    newTripData: Omit<Trip, 'id'>,
    organizerAccount?: {
      isNewOrganizer: boolean;
      name: string;
      username: string;
      password?: string;
      phone?: string;
      existingOrganizerId?: string;
    },
    secondOrganizerId?: string
  ) => {
    const newTripId = 'trip-' + Date.now();
    const newTrip: Trip = {
      ...newTripData,
      id: newTripId,
    };

    let updatedUsers = [...users];

    if (organizerAccount) {
      if (organizerAccount.isNewOrganizer) {
        const newOrganizerUser: User = {
          id: 'user-org-' + Date.now(),
          name: organizerAccount.name.trim(),
          email: organizerAccount.username.trim(),
          role: 'organizer',
          phone: organizerAccount.phone?.trim() || '',
          password: organizerAccount.password?.trim() || 'Organisateur2027!',
          assignedTripIds: [newTripId],
          isDemo: false,
        };
        updatedUsers = [...updatedUsers, newOrganizerUser];
        newTrip.organizerName = newOrganizerUser.name;
      } else if (organizerAccount.existingOrganizerId) {
        updatedUsers = updatedUsers.map((u) => {
          if (u.id === organizerAccount.existingOrganizerId) {
            const currentTrips = u.assignedTripIds || [];
            return {
              ...u,
              assignedTripIds: currentTrips.includes(newTripId)
                ? currentTrips
                : [...currentTrips, newTripId],
              password: organizerAccount.password?.trim() ? organizerAccount.password.trim() : u.password,
            };
          }
          return u;
        });
        const existing = updatedUsers.find((u) => u.id === organizerAccount.existingOrganizerId);
        if (existing) {
          newTrip.organizerName = existing.name;
        }
      }
    }

    // Second organizer (optionnel) : compte existant uniquement
    if (secondOrganizerId) {
      updatedUsers = updatedUsers.map((u) => {
        if (u.id === secondOrganizerId) {
          const currentTrips = u.assignedTripIds || [];
          return {
            ...u,
            assignedTripIds: currentTrips.includes(newTripId) ? currentTrips : [...currentTrips, newTripId],
          };
        }
        return u;
      });
      const secondOrganizer = updatedUsers.find((u) => u.id === secondOrganizerId);
      if (secondOrganizer) {
        newTrip.organizerId2 = secondOrganizer.id;
        newTrip.organizerName2 = secondOrganizer.name;
      }
    }

    if (organizerAccount || secondOrganizerId) {
      setUsers(updatedUsers);
      await saveStoredUsers(updatedUsers);
    }

    const updatedTrips = [...trips, newTrip];
    setTrips(updatedTrips);
    await saveStoredTrips(updatedTrips);
    showToast(
      organizerAccount?.isNewOrganizer
        ? `Séjour '${newTrip.name}' créé ! Compte organisateur '${organizerAccount.name}' initialisé.`
        : `Nouveau séjour '${newTrip.name}' programmé avec succès.`,
      'success'
    );
  };

  // Update trip (Admin) — édition des informations et des organisateurs assignés
  const handleUpdateTrip = async (
    updatedTrip: Trip,
    organizerAssignment?: { organizerId1?: string; organizerId2?: string }
  ) => {
    const updatedTrips = trips.map((t) => (t.id === updatedTrip.id ? updatedTrip : t));
    setTrips(updatedTrips);
    await saveStoredTrips(updatedTrips);

    if (organizerAssignment) {
      const keepIds = [organizerAssignment.organizerId1, organizerAssignment.organizerId2].filter(
        Boolean
      ) as string[];
      const updatedUsers = users.map((u) => {
        if (u.role !== 'organizer') return u;
        const currentTrips = u.assignedTripIds || [];
        const shouldHave = keepIds.includes(u.id);
        const hasIt = currentTrips.includes(updatedTrip.id);
        if (shouldHave && !hasIt) {
          return { ...u, assignedTripIds: [...currentTrips, updatedTrip.id] };
        }
        if (!shouldHave && hasIt) {
          return { ...u, assignedTripIds: currentTrips.filter((id) => id !== updatedTrip.id) };
        }
        return u;
      });
      setUsers(updatedUsers);
      await saveStoredUsers(updatedUsers);
    }

    showToast(`Voyage '${updatedTrip.name}' mis à jour avec succès.`, 'success');
  };

  // Delete trip (Admin)
  const handleDeleteTrip = async (tripId: string) => {
    const tripToDelete = trips.find((t) => t.id === tripId);
    const updatedTrips = trips.filter((t) => t.id !== tripId);
    setTrips(updatedTrips);
    await saveStoredTrips(updatedTrips);

    // Remove trip from all students' enrolled list
    const updatedStudents = students.map((s) => ({
      ...s,
      registeredTripIds: s.registeredTripIds ? s.registeredTripIds.filter((id) => id !== tripId) : [],
    }));
    setStudents(updatedStudents);
    await saveStoredStudents(updatedStudents);

    // Remove trip from organizers assigned trips
    const updatedUsers = users.map((u) => ({
      ...u,
      assignedTripIds: u.assignedTripIds ? u.assignedTripIds.filter((id) => id !== tripId) : [],
    }));
    setUsers(updatedUsers);
    await saveStoredUsers(updatedUsers);

    showToast(`Voyage scolaire '${tripToDelete?.name || ''}' supprimé avec succès.`, 'info');
  };

  // Delete user (Admin)
  const handleDeleteUser = async (userId: string) => {
    if (currentUser?.id === userId) {
      showToast('Action impossible : vous ne pouvez pas supprimer votre propre compte connecté.', 'warning');
      return;
    }
    const userToDelete = users.find((u) => u.id === userId);
    const updatedUsers = users.filter((u) => u.id !== userId);
    setUsers(updatedUsers);
    await removeStoredUser(userId);
    showToast(`Compte utilisateur de ${userToDelete?.name || 'l\'utilisateur'} supprimé.`, 'info');
  };

  // Update password for any user (self or admin)
  const handleUpdateUserPassword = async (userId: string, newPassword: string) => {
    const target = users.find((u) => u.id === userId);
    if (!target) return;
    const updatedUser: User = { ...target, password: newPassword };
    const updatedUsers = users.map((u) => (u.id === userId ? updatedUser : u));
    setUsers(updatedUsers);
    await upsertStoredUser(updatedUser);
    if (currentUser && currentUser.id === userId) {
      setCurrentUser({ ...currentUser, password: newPassword });
    }
    showToast('Mot de passe mis à jour avec succès.', 'success');
  };

  // Update a user's account details (Admin)
  const handleUpdateUser = async (
    userId: string,
    updates: { name: string; email: string; role: 'parent' | 'organizer' | 'admin'; phone?: string }
  ) => {
    const target = users.find((u) => u.id === userId);
    if (!target) return;
    const updatedUser: User = {
      ...target,
      name: updates.name,
      email: updates.email,
      role: updates.role,
      phone: updates.phone ?? target.phone,
    };
    const updatedUsers = users.map((u) => (u.id === userId ? updatedUser : u));
    setUsers(updatedUsers);
    await upsertStoredUser(updatedUser);
    if (currentUser && currentUser.id === userId) {
      setCurrentUser({ ...currentUser, ...updates });
    }
    showToast('Compte utilisateur mis à jour avec succès.', 'success');
  };

  // Delete a student's sanitary sheet (Admin) — déplace vers la corbeille (soft delete)
  const handleDeleteStudent = async (studentId: string) => {
    const studentToDelete = students.find((s) => s.id === studentId);
    if (!studentToDelete) return;
    const updatedStudent: Student = { ...studentToDelete, deletedAt: new Date().toISOString() };
    const updatedStudents = students.map((s) => (s.id === studentId ? updatedStudent : s));
    setStudents(updatedStudents);
    await upsertStoredStudent(updatedStudent);
    if (selectedStudent && selectedStudent.id === studentId) {
      setSelectedStudent(null);
    }
    showToast(
      `Fiche sanitaire de ${studentToDelete?.cerfa.identity.firstName || ''} ${studentToDelete?.cerfa.identity.lastName || ''} déplacée vers la corbeille (récupérable 30 jours).`,
      'info'
    );
  };

  // Restaure une fiche depuis la corbeille
  const handleRestoreStudent = async (studentId: string) => {
    const restored = students.find((s) => s.id === studentId);
    if (!restored) return;
    const { deletedAt, ...rest } = restored;
    const updatedStudent = rest as Student;
    const updatedStudents = students.map((s) => (s.id === studentId ? updatedStudent : s));
    setStudents(updatedStudents);
    await upsertStoredStudent(updatedStudent);
    showToast(
      `Fiche sanitaire de ${restored?.cerfa.identity.firstName || ''} ${restored?.cerfa.identity.lastName || ''} restaurée.`,
      'success'
    );
  };

  // Suppression définitive et irréversible depuis la corbeille
  const handlePermanentlyDeleteStudent = async (studentId: string) => {
    const updatedStudents = students.filter((s) => s.id !== studentId);
    setStudents(updatedStudents);
    await removeStoredStudent(studentId);
    showToast('Fiche sanitaire supprimée définitivement.', 'info');
  };

  // Update a student's class directly (Admin)
  const handleUpdateStudentClass = async (studentId: string, newClass: string) => {
    const target = students.find((s) => s.id === studentId);
    if (!target) return;
    const updatedStudent: Student = { ...target, schoolClass: newClass, updatedAt: new Date().toISOString() };
    const updatedStudents = students.map((s) => (s.id === studentId ? updatedStudent : s));
    setStudents(updatedStudents);
    await upsertStoredStudent(updatedStudent);
    showToast('Classe mise à jour.', 'success');
  };

  // Update a student's boarding status / régime de pension (Admin, Organizer)
  const handleUpdateStudentBoardingStatus = async (studentId: string, newStatus: 'DP' | 'Externe' | 'Interne') => {
    const target = students.find((s) => s.id === studentId);
    if (!target) return;
    const updatedStudent: Student = { ...target, boardingStatus: newStatus, updatedAt: new Date().toISOString() };
    const updatedStudents = students.map((s) => (s.id === studentId ? updatedStudent : s));
    setStudents(updatedStudents);
    await upsertStoredStudent(updatedStudent);
    showToast('Régime de pension mis à jour.', 'success');
  };

  // Add user (Admin)
  const handleAddUser = async (newUserData: Omit<User, 'id'>) => {
    const newUser: User = {
      ...newUserData,
      id: 'u-' + Date.now(),
    };
    const updated = [...users, newUser];
    setUsers(updated);
    await upsertStoredUser(newUser);
    showToast(`Compte créé pour ${newUser.name}.`, 'success');
  };

  // Update establishment name (Admin)
  const handleUpdateEstablishmentName = async (newName: string, applyToAllStudents: boolean = true) => {
    await saveStoredEstablishmentName(newName);
    setEstablishmentName(newName);

    // Le nom affiché sur les fiches et dans les PDF vient TOUJOURS du nom enregistré ci-dessus :
    // il n'est plus nécessaire de réécrire TOUTE la liste des élèves depuis le navigateur
    // (opération à risque, cause de l'incident du 01/10). Le paramètre est conservé pour compatibilité.
    void applyToAllStudents;

    showToast(`Nom de l'établissement mis à jour : ${newName}`, 'success');
  };

  // Update establishment logo (Admin)
  const handleUpdateLogo = async (dataUrl: string | null) => {
    await saveStoredLogo(dataUrl);
    setLogoUrl(dataUrl);
    showToast(dataUrl ? 'Logo de l\'établissement mis à jour.' : 'Logo supprimé.', 'success');
  };

  // Update the default reminder e-mail template (Admin)
  const handleUpdateReminderTemplate = async (template: ReminderTemplate) => {
    await saveStoredReminderTemplate(template);
    setReminderTemplate(template);
    showToast('Modèle de message de relance enregistré.', 'success');
  };

  const handleToggleAutoReminder = async (enabled: boolean) => {
    await saveStoredAutoReminderEnabled(enabled);
    setAutoReminderEnabled(enabled);
    showToast(
      enabled ? 'Relances automatiques hebdomadaires activées.' : 'Relances automatiques hebdomadaires désactivées.',
      'info'
    );
  };

  // Reset to demo data
  const handleResetData = () => {
    if (window.confirm('Voulez-vous réinitialiser toutes les données de démonstration ?')) {
      resetToMockData();
      setUsers(getStoredUsers());
      setStudents(getStoredStudents());
      setTrips(getStoredTrips());
      setClasses(getStoredClasses());
      setNotifications(getStoredNotifications());
      setEstablishmentName(getStoredEstablishmentName());
      setActiveTab('parent');
      setSelectedStudent(null);
      showToast('Données de test réinitialisées.', 'info');
    }
  };

  if (magicLinkToken) {
    return <MagicLinkAccess token={magicLinkToken} />;
  }

  // Fiches actives (hors corbeille) pour tous les espaces normaux ;
  // fiches dans la corbeille réservées à l'onglet Corbeille de l'admin.
  const activeStudents = students.filter((s) => !s.deletedAt);
  const trashedStudents = students.filter((s) => s.deletedAt);

  if (!currentUser || !isAuthenticated) {
    return (
      <>
        {toastMessage && (
          <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-slate-700 text-xs animate-bounce">
            {toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {toastMessage.type === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
            {toastMessage.type === 'info' && <Info className="w-4 h-4 text-blue-400 shrink-0" />}
            <span>{toastMessage.text}</span>
          </div>
        )}
        <StartupAuthGate
          users={users}
          trips={trips}
          students={activeStudents}
          logoUrl={logoUrl}
          establishmentName={establishmentName}
          onLoginSuccess={handleLoginSuccess}
          onRegisterParent={handleRegisterParent}
          onResetPasswordWithSecret={handleResetPasswordWithSecret}
          onPurgeDemo={handlePurgeDemo}
          onResetData={handleResetData}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* Toast notifications */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-slate-700 text-xs animate-bounce">
          {toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          {toastMessage.type === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
          {toastMessage.type === 'info' && <Info className="w-4 h-4 text-blue-400 shrink-0" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Main Header */}
      <Header
        currentUser={currentUser}
        users={users}
        establishmentName={establishmentName}
        logoUrl={logoUrl}
        onSwitchUser={handleSwitchUser}
        originAdmin={originAdminId ? users.find((u) => u.id === originAdminId && u.role === 'admin') || null : null}
        notifications={notifications}
        onMarkNotificationRead={(id) => {
          const updated = notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
          setNotifications(updated);
          saveStoredNotifications(updated);
        }}
        activeTab={activeTab === 'cerfa_view' || activeTab === 'cerfa_edit' ? 'parent' : activeTab}
        onSelectTab={handleSelectTab}
        onLogout={handleLogout}
      />

      {/* Main View Area */}
      <main className="flex-1 pb-16">
        {/* VIEW 1: Official CERFA n°10008*02 View & Print */}
        {activeTab === 'cerfa_view' && selectedStudent && (
          <CerfaOfficialView
            student={selectedStudent}
            trips={trips}
            establishmentName={establishmentName}
            canEdit={currentUser.role !== 'organizer'}
            onUnregisterTrip={handleUnregisterTrip}
            onRegisterTrip={handleRegisterTrip}
            onEdit={(section) => {
              if (currentUser.role !== 'organizer') {
                if (section) setEditorInitialSection(section);
                setActiveTab('cerfa_edit');
              }
            }}
            onBack={() => {
              if (currentUser.role === 'organizer') setActiveTab('organizer');
              else if (currentUser.role === 'admin') setActiveTab('admin');
              else setActiveTab('parent');
            }}
          />
        )}

        {/* VIEW 2: Interactive CERFA Editor (Unavailable for organizers) */}
        {activeTab === 'cerfa_edit' && selectedStudent && currentUser.role !== 'organizer' && (
          <CerfaEditor
            student={selectedStudent}
            trips={trips}
            classes={classes}
            initialSection={editorInitialSection}
            authorName={currentUser.name}
            authorRole={currentUser.role === 'parent' ? 'Parent / Responsable' : 'Direction / Administration'}
            onSave={handleSaveStudent}
            onSaveDraft={handleSaveDraft}
            onRegisterTrip={handleRegisterTrip}
            onUnregisterTrip={handleUnregisterTrip}
            onCancel={() => {
              if (currentUser.role === 'admin') setActiveTab('admin');
              else setActiveTab('parent');
            }}
            onViewCerfaOfficial={() => setActiveTab('cerfa_view')}
          />
        )}

        {/* SPACE 1: Parents / Responsables légaux */}
        {activeTab === 'parent' && (
          <ParentSpace
            currentUser={currentUser}
            students={activeStudents}
            trips={trips}
            classes={classes}
            onSelectStudentToEdit={handleOpenEditor}
            onSelectStudentToView={handleOpenOfficialView}
            onAddStudent={handleAddChild}
            onRegisterTrip={handleRegisterTrip}
            onUnregisterTrip={handleUnregisterTrip}
            onUpdateUserPassword={handleUpdateUserPassword}
          />
        )}

        {/* SPACE 2: Organisateurs de voyages (Tri classe, régime, CSV, export PAI) */}
        {activeTab === 'organizer' && (
          <OrganizerSpace
            currentUser={currentUser}
            trips={trips}
            students={activeStudents}
            onSelectStudentToView={handleOpenOfficialView}
            onUpdateUserPassword={handleUpdateUserPassword}
            onUpdateStudentBoardingStatus={handleUpdateStudentBoardingStatus}
          />
        )}

        {/* SPACE 3: Administration / Direction */}
        {activeTab === 'admin' && (
          <AdminSpace
            currentUser={currentUser}
            users={users}
            trips={trips}
            students={activeStudents}
            trashedStudents={trashedStudents}
            onRestoreStudent={handleRestoreStudent}
            onPermanentlyDeleteStudent={handlePermanentlyDeleteStudent}
            classes={classes}
            establishmentName={establishmentName}
            onUpdateEstablishmentName={handleUpdateEstablishmentName}
            logoUrl={logoUrl}
            onUpdateLogo={handleUpdateLogo}
            reminderTemplate={reminderTemplate}
            onUpdateReminderTemplate={handleUpdateReminderTemplate}
            autoReminderEnabled={autoReminderEnabled}
            onToggleAutoReminder={handleToggleAutoReminder}
            autoReminderLastRun={autoReminderLastRun}
            onSelectStudentToView={handleOpenOfficialView}
            onAddTrip={handleAddTrip}
            onUpdateTrip={handleUpdateTrip}
            onDeleteTrip={handleDeleteTrip}
            onAddUser={handleAddUser}
            onDeleteUser={handleDeleteUser}
            onUpdateUser={handleUpdateUser}
            onDeleteStudent={handleDeleteStudent}
            onUpdateStudentClass={handleUpdateStudentClass}
            onUpdateStudentBoardingStatus={handleUpdateStudentBoardingStatus}
            onUpdateUserPassword={handleUpdateUserPassword}
            onRegisterTrip={handleRegisterTrip}
            onUnregisterTrip={handleUnregisterTrip}
            onAddClass={async (newCls) => {
              const updated = [...classes, newCls];
              setClasses(updated);
              await saveStoredClasses(updated);
              showToast(`Classe ${newCls.name} ajoutée.`, 'success');
            }}
            onUpdateClass={async (updatedCls) => {
              const updated = classes.map((c) => (c.id === updatedCls.id ? updatedCls : c));
              setClasses(updated);
              await saveStoredClasses(updated);
              showToast(`Classe ${updatedCls.name} modifiée avec succès.`, 'success');
            }}
            onDeleteClass={async (classId) => {
              const cls = classes.find((c) => c.id === classId);
              const updated = classes.filter((c) => c.id !== classId);
              setClasses(updated);
              await saveStoredClasses(updated);
              showToast(`Classe ${cls?.name || ''} supprimée.`, 'info');
            }}
            onResetData={handleResetData}
            onPurgeDemo={handlePurgeDemo}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500 print:hidden">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            Portail de dématérialisation des fiches sanitaires de liaison — Conforme <strong>CERFA n° 10008*02</strong>
          </span>
          <span className="text-[11px] text-slate-400">
            Hébergement souverain • Données médicales protégées • Secret professionnel
          </span>
        </div>
      </footer>

      {/* Messagerie interne + popups (build messagerie-20261001) */}
      <CommunicationCenter currentUser={currentUser} users={users} classes={classes} students={activeStudents} />
    </div>
  );
}
