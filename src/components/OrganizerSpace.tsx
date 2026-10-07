import React, { useState, useMemo, useRef } from 'react';
import { Student, Trip, User, DietCategory } from '../types';
import { exportTripCsv } from '../utils/storage';
import { exportToPdf } from '../utils/pdfGenerator';
import { authChangePassword } from '../utils/auth';
import { generateOrganizerReportPdf, generateDietSummaryPdf } from '../utils/organizerPdf';
import { formatDateFr } from '../utils/cerfaValidation';
import { openOrDownloadDocument } from '../utils/documentViewer';
import { TripHealthListModal } from './TripHealthListModal';
import {
  Download,
  Search,
  Filter,
  CheckCircle,
  AlertTriangle,
  FileText,
  Utensils,
  GraduationCap,
  Loader2,
  Eye,
  Shield,
  Phone,
  AlertCircle,
  Lock,
  Unlock,
  Printer,
  FileSpreadsheet,
  RotateCcw,
  Sparkles,
  KeyRound,
  CheckCircle2,
  EyeOff,
  X,
} from 'lucide-react';

interface OrganizerSpaceProps {
  currentUser: User;
  trips: Trip[];
  students: Student[];
  onSelectStudentToView: (student: Student) => void;
  onUpdateUserPassword?: (userId: string, newPassword: string) => void | Promise<void>;
  onUpdateStudentBoardingStatus?: (studentId: string, newStatus: 'DP' | 'Externe' | 'Interne') => void;
}

export const OrganizerSpace: React.FC<OrganizerSpaceProps> = ({
  currentUser,
  trips,
  students,
  onSelectStudentToView,
  onUpdateStudentBoardingStatus,
  onUpdateUserPassword,
}) => {
  // Organizer only sees trips assigned to them (or all if admin/demo mode)
  const availableTrips = useMemo(() => {
    if (currentUser.role === 'admin') return trips;
    if (currentUser.assignedTripIds && currentUser.assignedTripIds.length > 0) {
      return trips.filter((t) => currentUser.assignedTripIds?.includes(t.id));
    }
    return trips;
  }, [trips, currentUser]);

  // Un professeur qui encadre plusieurs voyages choisit celui qu'il consulte ; le choix est mémorisé (par compte, dans ce navigateur) - build multi-trips-20261007
  const tripChoiceKey = `cerfa_org_trip_${currentUser.id}_v1`;
  const [selectedTripId, setSelectedTripId] = useState<string>(() => {
    try {
      return localStorage.getItem(tripChoiceKey) || '';
    } catch {
      return '';
    }
  });
  const currentTrip = availableTrips.find((t) => t.id === selectedTripId) || availableTrips[0] || trips[0];
  const chooseTrip = (id: string) => {
    setSelectedTripId(id);
    try {
      localStorage.setItem(tripChoiceKey, id);
    } catch {
      /* stockage indisponible : le choix vaut pour cette page seulement */
    }
  };
  React.useEffect(() => {
    console.log('[fichesanitaire] build multi-trips-20261007');
  }, []);

  const reportRef = useRef<HTMLDivElement>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  // PDF « Synthèse des régimes alimentaires » (transmission traiteur & hébergement), classé par catégorie - build diet-pdf-20261007
  const [isExportingDietPdf, setIsExportingDietPdf] = useState(false);
  const handleDietPdf = async () => {
    setIsExportingDietPdf(true);
    try {
      const ok = await generateDietSummaryPdf(currentTrip, enrolledStudents, {
        filename: `Synthese_Regimes_${currentTrip.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
      });
      if (!ok) window.alert("Le PDF de la synthèse des régimes alimentaires n'a pas pu être généré. Réessayez dans un instant.");
    } finally {
      setIsExportingDietPdf(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!reportRef.current) return;
    setIsExportingPdf(true);
    try {
      const sanitizedTripName = currentTrip.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      // VRAI PDF vectoriel (texte sélectionnable, pagination, en-têtes répétés) - build pdf-organisateurs-20261006
      const ok = await generateOrganizerReportPdf(currentTrip, filteredStudents, {
        filename: `Releve_Sanitaire_${sanitizedTripName}.pdf`,
        groupByClass: activeFilterView === 'class',
        filtersText: `Filtres actifs : ${kpiFilter !== 'all' ? `KPI: ${kpiFilter.toUpperCase()}` : 'Tous'} • Classe : ${selectedClassFilter} • Régime : ${selectedDietFilter} • Élèves affichés : ${filteredStudents.length}/${totalEnrolled}`,
        shown: filteredStudents.length,
        stats: { totalEnrolled, completeCount, incompleteCount, dpCount, allergyAlertCount },
      });
      if (!ok) window.print();
    } catch (error) {
      console.error('Erreur export PDF:', error);
      window.print();
    } finally {
      setIsExportingPdf(false);
    }
  };
  const [activeFilterView, setActiveFilterView] = useState<'all' | 'class' | 'diet' | 'incomplete'>('all');
  const [kpiFilter, setKpiFilter] = useState<'all' | 'complete' | 'incomplete' | 'dp' | 'medical_pai'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClassFilter, setSelectedClassFilter] = useState('all');
  const [selectedDietFilter, setSelectedDietFilter] = useState('all');
  const [unlockedSensitiveStudentId, setUnlockedSensitiveStudentId] = useState<string | null>(null);
  const [selectedDetailStudent, setSelectedDetailStudent] = useState<Student | null>(null);
  // changement de voyage : on repart de filtres vierges (une classe ou un régime d'un autre voyage n'aurait pas de sens)
  React.useEffect(() => {
    setActiveFilterView('all');
    setKpiFilter('all');
    setSearchQuery('');
    setSelectedClassFilter('all');
    setSelectedDietFilter('all');
    setSelectedDetailStudent(null);
    setUnlockedSensitiveStudentId(null);
  }, [currentTrip?.id]);
  const [showHealthReportModal, setShowHealthReportModal] = useState(false);
  const [healthReportInitialSort, setHealthReportInitialSort] = useState<'alpha' | 'class'>('class');

  // Password change modal states
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState('');

  const handlePasswordChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError('');
    setPwdSuccess('');

    if (!currentPasswordInput) {
      setPwdError('Veuillez saisir votre mot de passe actuel.');
      return;
    }

    if (!newPasswordInput.trim()) {
      setPwdError('Veuillez renseigner un nouveau mot de passe.');
      return;
    }

    if (newPasswordInput.length < 6) {
      setPwdError('Le nouveau mot de passe doit comporter au moins 6 caractères.');
      return;
    }

    if (newPasswordInput !== confirmPasswordInput) {
      setPwdError('Les deux nouveaux mots de passe ne correspondent pas.');
      return;
    }

    // vérification de l'ancien mot de passe et enregistrement par le serveur (build auth-20261006)
    const chg = await authChangePassword(currentPasswordInput, newPasswordInput.trim());
    if (!chg.ok) {
      setPwdError(chg.message);
      return;
    }

    setPwdSuccess('Votre mot de passe a été mis à jour avec succès !');
    setTimeout(() => {
      setShowPasswordModal(false);
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      setPwdSuccess('');
    }, 1200);
  };

  // Students enrolled in this trip
  const enrolledStudents = useMemo(() => {
    return students.filter((s) => s.registeredTripIds.includes(currentTrip.id));
  }, [students, currentTrip]);

  // Key stats
  const totalEnrolled = enrolledStudents.length;
  const completeCount = enrolledStudents.filter((s) => s.status === 'complete').length;
  const incompleteCount = totalEnrolled - completeCount;
  const dpCount = enrolledStudents.filter((s) => s.boardingStatus === 'DP').length;
  const externeCount = enrolledStudents.filter((s) => s.boardingStatus === 'Externe').length;
  const allergyAlertCount = enrolledStudents.filter(
    (s) =>
      s.cerfa.medicalInfo.allergies.alimentaires ||
      s.cerfa.medicalInfo.allergies.asthme ||
      s.cerfa.medicalInfo.allergies.medicamenteuses ||
      s.cerfa.medicalInfo.hasMedicalTreatment
  ).length;

  // Diet category grouping for caterers
  const dietStats = useMemo(() => {
    const counts: Record<string, { label: string; count: number; students: Student[] }> = {
      standard: { label: 'Sans restriction', count: 0, students: [] },
      sans_porc: { label: 'Sans porc', count: 0, students: [] },
      sans_viande: { label: 'Sans viande', count: 0, students: [] },
      vegetarien: { label: 'Végétarien', count: 0, students: [] },
      allergie_alimentaire: { label: 'Allergie alimentaire', count: 0, students: [] },
    };

    enrolledStudents.forEach((s) => {
      const cat = s.cerfa.structuredDiet.category || 'standard';
      if (counts[cat]) {
        counts[cat].count += 1;
        counts[cat].students.push(s);
      } else {
        counts['standard'].count += 1;
        counts['standard'].students.push(s);
      }
    });

    return counts;
  }, [enrolledStudents]);

  // Filtered student list
  const filteredStudents = useMemo(() => {
    return enrolledStudents.filter((s) => {
      // Search
      const query = searchQuery.toLowerCase().trim();
      if (query) {
        const fullName = `${s.cerfa.identity.firstName} ${s.cerfa.identity.lastName}`.toLowerCase();
        const className = s.schoolClass.toLowerCase();
        const diet = s.cerfa.structuredDiet.category.toLowerCase();
        if (!fullName.includes(query) && !className.includes(query) && !diet.includes(query)) {
          return false;
        }
      }

      // KPI Clickable Card Filter
      if (kpiFilter === 'complete' && s.status !== 'complete') {
        return false;
      }
      if (kpiFilter === 'incomplete' && s.status === 'complete') {
        return false;
      }
      if (kpiFilter === 'dp' && s.boardingStatus !== 'DP') {
        return false;
      }
      if (kpiFilter === 'medical_pai') {
        const hasMedical =
          Boolean(s.cerfa.medicalInfo.hasPai) ||
          Boolean(s.cerfa.medicalInfo.allergies.alimentaires) ||
          Boolean(s.cerfa.medicalInfo.allergies.asthme) ||
          Boolean(s.cerfa.medicalInfo.allergies.medicamenteuses) ||
          Boolean(s.cerfa.medicalInfo.hasMedicalTreatment);
        if (!hasMedical) return false;
      }

      // Quick filter tabs
      if (activeFilterView === 'incomplete' && s.status === 'complete') {
        return false;
      }

      // Class dropdown
      if (selectedClassFilter !== 'all' && s.schoolClass !== selectedClassFilter) {
        return false;
      }

      // Diet dropdown
      if (selectedDietFilter !== 'all' && s.cerfa.structuredDiet.category !== selectedDietFilter) {
        return false;
      }

      return true;
    });
  }, [
    enrolledStudents,
    searchQuery,
    kpiFilter,
    activeFilterView,
    selectedClassFilter,
    selectedDietFilter,
  ]);

  // Group by class
  const studentsByClass = useMemo(() => {
    const map: Record<string, Student[]> = {};
    filteredStudents.forEach((s) => {
      if (!map[s.schoolClass]) map[s.schoolClass] = [];
      map[s.schoolClass].push(s);
    });
    return map;
  }, [filteredStudents]);

  const handleExport = () => {
    exportTripCsv(currentTrip, enrolledStudents);
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 space-y-8">
      {/* Header & Trip Selector */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="bg-blue-100 text-blue-900 text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded">
              Espace Organisateur de séjour
            </span>
            <span className="text-xs text-slate-500">
              Organisateur connecté : <strong>{currentUser.name}</strong>
            </span>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 uppercase">
              VOYAGE : {currentTrip.name}
            </h2>
          </div>
          {availableTrips.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 mt-3" role="group" aria-label="Choisir le voyage à consulter" data-testid="organizer-trip-switch">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Mes voyages ({availableTrips.length}) :</span>
              {availableTrips.map((t) => {
                const n = students.filter((s) => !s.deletedAt && s.registeredTripIds.includes(t.id)).length;
                const active = t.id === currentTrip.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => chooseTrip(t.id)}
                    aria-pressed={active}
                    data-testid={`organizer-trip-${t.id}`}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                      active ? 'bg-blue-900 text-white border-blue-900 shadow-xs' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {t.name} · {n} élève{n > 1 ? 's' : ''}
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-xs text-slate-500 mt-1">
            Destination : <strong className="text-slate-700">{currentTrip.destination}</strong> • Dates : du {formatDateFr(currentTrip.startDate)} au {formatDateFr(currentTrip.endDate)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowPasswordModal(true)}
            className="flex items-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg shadow-xs transition-colors cursor-pointer"
            title="Modifier mon mot de passe"
          >
            <KeyRound className="w-4 h-4 text-blue-700" />
            <span>Mon mot de passe</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setHealthReportInitialSort('class');
              setShowHealthReportModal(true);
            }}
            className="flex items-center gap-1.5 bg-blue-900 hover:bg-blue-950 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-xs transition-colors cursor-pointer"
            title="Générer la liste sanitaire complète par classes ou par ordre alphabétique (régimes, allergies, PAI)"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Liste Sanitaire (Classes / Alpha / PAI)</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={isExportingPdf}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            title="Générer et télécharger un vrai fichier PDF de la vue et des filtres actuels"
          >
            {isExportingPdf ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Génération PDF...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Télécharger PDF</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDietPdf}
            disabled={isExportingDietPdf}
            data-testid="diet-pdf-button-header"
            className="flex items-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg shadow-xs transition-colors cursor-pointer"
            title="PDF de la seule synthèse des régimes alimentaires, classée par catégorie (traiteur et hébergement)"
          >
            <Utensils className="w-4 h-4 text-blue-700" />
            <span>{isExportingDietPdf ? 'Génération PDF...' : 'PDF Régimes alimentaires'}</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer"
            title="Imprimer directement"
          >
            <Printer className="w-4 h-4 text-slate-600" />
            <span>Imprimer</span>
          </button>

          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      <div ref={reportRef}>
      {/* Report Header — visible à l'écran et inclus dans le PDF / l'impression */}
      <div className="border-b-2 border-slate-900 pb-3 mb-4">
        <h1 className="text-xl font-bold text-slate-900 uppercase">
          RELEVÉ SANITAIRE DU SÉJOUR — {currentTrip.name}
        </h1>
        <p className="text-xs text-slate-600">
          Destination : {currentTrip.destination} • Dates : du {formatDateFr(currentTrip.startDate)} au {formatDateFr(currentTrip.endDate)}
        </p>
        <p className="text-[11px] text-slate-500 mt-1">
          Filtres actifs : {kpiFilter !== 'all' ? `KPI: ${kpiFilter.toUpperCase()}` : 'Tous'} • Classe : {selectedClassFilter} • Régime : {selectedDietFilter} • Élèves affichés : {filteredStudents.length}/{totalEnrolled}
        </p>
      </div>

      {/* KPI Dashboard (Cahier des charges section 22 - Clickable filters) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {/* KPI 1: Inscrits (Reset) */}
        <button
          type="button"
          onClick={() => {
            setKpiFilter('all');
            setActiveFilterView('all');
          }}
          className={`text-left p-4 rounded-xl border transition-all cursor-pointer ${
            kpiFilter === 'all'
              ? 'bg-blue-50/70 border-blue-600 ring-2 ring-blue-600/30 shadow-xs'
              : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-600 uppercase block">Élèves inscrits</span>
            {kpiFilter === 'all' && (
              <span className="text-[9px] bg-blue-900 text-white px-1.5 py-0.5 rounded font-bold">Actif</span>
            )}
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1">{totalEnrolled}</div>
          <span className="text-[10px] text-slate-400 block">Capacité max : {currentTrip.maxStudents}</span>
        </button>

        {/* KPI 2: Fiches complètes */}
        <button
          type="button"
          onClick={() => {
            setKpiFilter((prev) => (prev === 'complete' ? 'all' : 'complete'));
            setActiveFilterView('all');
          }}
          className={`text-left p-4 rounded-xl border transition-all cursor-pointer ${
            kpiFilter === 'complete'
              ? 'bg-emerald-50 border-emerald-600 ring-2 ring-emerald-600/30 shadow-xs'
              : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-700 uppercase block">Fiches complètes</span>
            {kpiFilter === 'complete' && (
              <span className="text-[9px] bg-emerald-700 text-white px-1.5 py-0.5 rounded font-bold">Filtré</span>
            )}
          </div>
          <div className="text-2xl font-black text-emerald-600 mt-1">{completeCount}</div>
          <span className="text-[10px] text-emerald-600 font-medium block">✓ Validées & signées</span>
        </button>

        {/* KPI 3: Fiches incomplètes */}
        <button
          type="button"
          onClick={() => {
            setKpiFilter((prev) => (prev === 'incomplete' ? 'all' : 'incomplete'));
            setActiveFilterView('all');
          }}
          className={`text-left p-4 rounded-xl border transition-all cursor-pointer ${
            kpiFilter === 'incomplete'
              ? 'bg-amber-50 border-amber-600 ring-2 ring-amber-600/30 shadow-xs'
              : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-700 uppercase block">Fiches incomplètes</span>
            {kpiFilter === 'incomplete' && (
              <span className="text-[9px] bg-amber-600 text-white px-1.5 py-0.5 rounded font-bold">Filtré</span>
            )}
          </div>
          <div className="text-2xl font-black text-amber-600 mt-1">{incompleteCount}</div>
          <span className="text-[10px] text-amber-600 font-medium block">⚠ Action requise</span>
        </button>

        {/* KPI 4: Demi-pensionnaires */}
        <button
          type="button"
          onClick={() => {
            setKpiFilter((prev) => (prev === 'dp' ? 'all' : 'dp'));
            setActiveFilterView('all');
          }}
          className={`text-left p-4 rounded-xl border transition-all cursor-pointer ${
            kpiFilter === 'dp'
              ? 'bg-blue-50 border-blue-600 ring-2 ring-blue-600/30 shadow-xs'
              : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-blue-700 uppercase block">Demi-pensionnaires</span>
            {kpiFilter === 'dp' && (
              <span className="text-[9px] bg-blue-700 text-white px-1.5 py-0.5 rounded font-bold">Filtré</span>
            )}
          </div>
          <div className="text-2xl font-black text-blue-900 mt-1">{dpCount}</div>
          <span className="text-[10px] text-slate-500 block">{externeCount} externes</span>
        </button>

        {/* KPI 5: Alertes médicales / PAI */}
        <button
          type="button"
          onClick={() => {
            setKpiFilter((prev) => (prev === 'medical_pai' ? 'all' : 'medical_pai'));
            setActiveFilterView('all');
          }}
          className={`text-left p-4 rounded-xl border transition-all cursor-pointer col-span-2 sm:col-span-1 ${
            kpiFilter === 'medical_pai'
              ? 'bg-red-50 border-red-600 ring-2 ring-red-600/30 shadow-xs'
              : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-red-700 uppercase block">Alertes / PAI</span>
            {kpiFilter === 'medical_pai' && (
              <span className="text-[9px] bg-red-700 text-white px-1.5 py-0.5 rounded font-bold">Filtré</span>
            )}
          </div>
          <div className="text-2xl font-black text-red-600 mt-1">{allergyAlertCount}</div>
          <span className="text-[10px] text-red-700 font-medium block">Allergies / PAI / Soins</span>
        </button>
      </div>

      {/* Quick View Switcher & Filters (Cahier des charges section 35) */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={() => setActiveFilterView('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                activeFilterView === 'all'
                  ? 'bg-blue-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              [ Toutes ]
            </button>
            <button
              onClick={() => setActiveFilterView('class')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                activeFilterView === 'class'
                  ? 'bg-blue-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              [ Classe ]
            </button>
            <button
              onClick={() => setActiveFilterView('diet')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                activeFilterView === 'diet'
                  ? 'bg-blue-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              [ Régime ]
            </button>
            <button
              onClick={() => setActiveFilterView('incomplete')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                activeFilterView === 'incomplete'
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              [ Incomplètes ({incompleteCount}) ]
            </button>
          </div>

          {/* Search bar */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher élève, classe, régime..."
              className="w-full bg-slate-50 border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        {/* Dropdown filters */}
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-semibold">Classe :</span>
            <select
              value={selectedClassFilter}
              onChange={(e) => setSelectedClassFilter(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded px-2.5 py-1 text-xs"
            >
              <option value="all">[ Toutes ▼ ]</option>
              {currentTrip.eligibleClasses.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-semibold">Régime :</span>
            <select
              value={selectedDietFilter}
              onChange={(e) => setSelectedDietFilter(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded px-2.5 py-1 text-xs"
            >
              <option value="all">[ Tous ▼ ]</option>
              <option value="standard">Sans restriction</option>
              <option value="sans_porc">Sans porc</option>
              <option value="sans_viande">Sans viande</option>
              <option value="vegetarien">Végétarien</option>
              <option value="allergie_alimentaire">Allergie alimentaire</option>
            </select>
          </div>

          <span className="text-slate-400 text-xs ml-auto">
            {filteredStudents.length} élève(s) affiché(s)
          </span>
        </div>
      </div>

      {/* CLASSEMENT PAR RÉGIME ALIMENTAIRE (Cahier des charges section 24) */}
      {activeFilterView === 'diet' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Utensils className="w-5 h-5 text-blue-700" />
                Synthèse des régimes alimentaires (Transmission traiteur & hébergement)
              </h3>
              <p className="text-xs text-slate-500">
                Décompte par régime alimentaire structuré pour la commande des repas du voyage.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDietPdf}
              disabled={isExportingDietPdf}
              data-testid="diet-pdf-button"
              className="flex items-center gap-1.5 bg-blue-900 hover:bg-blue-950 disabled:opacity-60 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-xs transition-colors cursor-pointer shrink-0"
              title="Télécharger un PDF contenant uniquement cette synthèse (classée par catégorie) pour le traiteur et l'hébergement"
            >
              <Download className="w-4 h-4" />
              <span>{isExportingDietPdf ? 'Génération PDF...' : 'PDF : synthèse des régimes (traiteur)'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(Object.entries(dietStats) as [string, { label: string; count: number; students: Student[] }][]).map(([key, stat]) => (
              <div
                key={key}
                className="border border-slate-200 rounded-xl p-4 bg-slate-50/70 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <h4 className="font-bold text-xs text-slate-900">{stat.label}</h4>
                  <span className="text-lg font-black text-blue-900 bg-white px-2 py-0.5 border border-slate-200 rounded">
                    {stat.count}
                  </span>
                </div>
                <div className="mt-3 text-xs text-slate-600">
                  {stat.students.length === 0 ? (
                    <span className="text-slate-400 italic text-[11px]">Aucun élève</span>
                  ) : (
                    <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                      {stat.students.map((s) => (
                        <div key={s.id} className="flex items-center justify-between text-[11px] bg-white p-1 rounded border border-slate-100">
                          <span className="font-semibold text-slate-800">
                            {s.cerfa.identity.lastName} {s.cerfa.identity.firstName}
                          </span>
                          <span className="text-slate-500 text-[10px]">{s.schoolClass}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CLASSEMENT PAR CLASSE (Cahier des charges section 23 & 35) */}
      {activeFilterView === 'class' ? (
        <div className="space-y-6">
          {(Object.entries(studentsByClass) as [string, Student[]][]).map(([className, classStudents]) => (
            <div key={className} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <GraduationCap className="w-5 h-5 text-blue-800" />
                  Classe : {className} ({classStudents.length} élèves)
                </h3>
                <span className="text-xs text-slate-500">
                  {classStudents.filter((s) => s.status === 'complete').length} fiches complètes / {classStudents.length}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">Nom</th>
                      <th className="p-2.5">Prénom</th>
                      <th className="p-2.5">Pension</th>
                      <th className="p-2.5">Régime</th>
                      <th className="p-2.5 text-center">Fiche sanitaire</th>
                      <th className="p-2.5 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {classStudents.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="p-2.5 font-bold text-slate-900">{s.cerfa.identity.lastName}</td>
                        <td className="p-2.5 font-medium text-slate-800">{s.cerfa.identity.firstName}</td>
                        <td className="p-2.5 text-slate-600">
                          {onUpdateStudentBoardingStatus ? (
                            <select
                              value={s.boardingStatus}
                              onChange={(e) =>
                                onUpdateStudentBoardingStatus(s.id, e.target.value as 'DP' | 'Externe' | 'Interne')
                              }
                              className="bg-white border border-slate-300 rounded px-1.5 py-1 text-xs font-medium text-slate-700 cursor-pointer"
                              title="Modifier le régime de pension de cet élève"
                            >
                              <option value="DP">DP</option>
                              <option value="Externe">Externe</option>
                              <option value="Interne">Interne</option>
                            </select>
                          ) : (
                            s.boardingStatus
                          )}
                        </td>
                        <td className="p-2.5">
                          <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded text-[11px] font-medium border border-slate-200">
                            {s.cerfa.structuredDiet.category.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="p-2.5 text-center">
                          {s.status === 'complete' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded text-[11px] border border-emerald-200">
                              ✓ Complète
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded text-[11px] border border-amber-200">
                              ⚠ Incomplète ({s.completenessPercent}%)
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 text-center">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => setSelectedDetailStudent(s)}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded text-[11px] transition-colors"
                            >
                              Fiche Voyage
                            </button>
                            <button
                              onClick={() => onSelectStudentToView(s)}
                              className="p-1 text-blue-700 hover:text-blue-900"
                              title="Voir la fiche sanitaire complète"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* STANDARD ROSTER TABLE */
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 uppercase text-[11px]">
                <tr>
                  <th className="p-3">Nom</th>
                  <th className="p-3">Prénom</th>
                  <th className="p-3">Classe</th>
                  <th className="p-3">Régime alimentaire</th>
                  <th className="p-3 text-center">Fiche CERFA</th>
                  <th className="p-3">Alertes / PAI</th>
                  <th className="p-3 text-right">Consultation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      Aucun élève correspondant aux critères de recherche.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((s) => {
                    const hasAllergy =
                      s.cerfa.medicalInfo.allergies.alimentaires ||
                      s.cerfa.medicalInfo.allergies.asthme ||
                      s.cerfa.medicalInfo.allergies.medicamenteuses ||
                      Boolean(s.cerfa.medicalInfo.allergies.autres);

                    return (
                      <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3 font-bold text-slate-950">{s.cerfa.identity.lastName}</td>
                        <td className="p-3 font-semibold text-slate-800">{s.cerfa.identity.firstName}</td>
                        <td className="p-3">
                          <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 font-semibold">
                            {s.schoolClass}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="font-medium text-slate-800">
                            {s.cerfa.structuredDiet.category.replace('_', ' ')}
                          </span>
                          {s.cerfa.structuredDiet.details && (
                            <span className="text-[10px] text-slate-500 block truncate max-w-[140px]">
                              {s.cerfa.structuredDiet.details}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {s.status === 'complete' ? (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 text-[11px]">
                              ✓ Complète
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 text-[11px]">
                              ⚠ Incomplète ({s.completenessPercent}%)
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col gap-1 items-start">
                            {s.cerfa.medicalInfo.hasPai && (
                              <div className="flex items-center gap-1">
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-800 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded">
                                  <AlertCircle className="w-3 h-3 text-red-600" />
                                  PAI
                                </span>
                                {s.cerfa.documents.filter((d) => d.type === 'pai').map((doc) => (
                                  <button
                                    key={doc.id}
                                    type="button"
                                    onClick={() => openOrDownloadDocument(doc, `${s.cerfa.identity.firstName} ${s.cerfa.identity.lastName}`)}
                                    className="text-[10px] text-red-900 bg-red-50 hover:bg-red-200 border border-red-300 font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 cursor-pointer"
                                    title="Télécharger / Consulter le document PAI officiel"
                                  >
                                    <Download className="w-2.5 h-2.5" /> PAI
                                  </button>
                                ))}
                              </div>
                            )}
                            {hasAllergy || s.cerfa.medicalInfo.hasMedicalTreatment ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                {hasAllergy ? 'Allergie' : 'Traitement'}
                              </span>
                            ) : null}
                            {!s.cerfa.medicalInfo.hasPai && !hasAllergy && !s.cerfa.medicalInfo.hasMedicalTreatment && (
                              <span className="text-slate-400 text-[11px]">Néant</span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => setSelectedDetailStudent(s)}
                              className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 font-semibold rounded text-[11px] transition-colors cursor-pointer"
                            >
                              Fiche Voyage
                            </button>
                            <button
                              onClick={() => onSelectStudentToView(s)}
                              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-semibold cursor-pointer"
                            >
                              Fiche
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>

      {/* MODAL: FICHE ÉLÈVE CÔTÉ ORGANISATEUR AVEC SÉGRÉGATION DES DROITS (Cahier des charges section 26) */}
      {selectedDetailStudent && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900">
                    Fiche Voyage — {selectedDetailStudent.cerfa.identity.firstName} {selectedDetailStudent.cerfa.identity.lastName}
                  </h3>
                  <span className="font-mono bg-slate-100 text-slate-800 text-xs px-2 py-0.5 rounded font-bold">
                    {selectedDetailStudent.schoolClass}
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  Données autorisées pour l encadrement du séjour • {currentTrip.name}
                </span>
              </div>
              <button
                onClick={() => {
                  setSelectedDetailStudent(null);
                  setUnlockedSensitiveStudentId(null);
                }}
                className="text-xs text-slate-500 hover:text-slate-800 p-1 font-semibold"
              >
                Fermer
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Part 1: Données nécessaires au voyage (immédiatement visibles) */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <span className="font-bold text-slate-900 uppercase text-[11px] block text-blue-950 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-blue-700" />
                  1. Données indispensables à la vie collective & d urgence
                </span>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-slate-500 text-[10px] uppercase block">Date de naissance :</span>
                    <strong className="text-slate-900">{formatDateFr(selectedDetailStudent.cerfa.identity.birthDate)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] uppercase block">Mobile élève :</span>
                    <strong className="text-slate-900">{selectedDetailStudent.cerfa.identity.childMobilePhone || 'Néant'}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] uppercase block">Régime alimentaire :</span>
                    <strong className="text-blue-900">{selectedDetailStudent.cerfa.structuredDiet.category.replace('_', ' ')}</strong>
                  </div>
                </div>

                {selectedDetailStudent.cerfa.structuredDiet.details && (
                  <div>
                    <span className="text-slate-500 text-[10px] uppercase block">Précisions repas :</span>
                    <p className="text-slate-800">{selectedDetailStudent.cerfa.structuredDiet.details}</p>
                  </div>
                )}

                {/* Contacts parents d'urgence */}
                <div className="p-3 bg-white border border-slate-200 rounded-lg">
                  <span className="font-bold text-slate-900 block text-[11px] mb-1 flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-emerald-600" /> Contact Responsable Légal
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-slate-500">Nom : </span>
                      <strong>{selectedDetailStudent.cerfa.legalGuardian.fullName}</strong> ({selectedDetailStudent.cerfa.legalGuardian.relationship})
                    </div>
                    <div>
                      <span className="text-slate-500">Portable : </span>
                      <strong className="text-emerald-700">{selectedDetailStudent.cerfa.legalGuardian.mobilePhone || '—'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Adresse : </span>
                      <span>{selectedDetailStudent.cerfa.legalGuardian.address || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Médecin traitant : </span>
                      <span>{selectedDetailStudent.cerfa.treatingDoctor.name || 'Non précisé'} ({selectedDetailStudent.cerfa.treatingDoctor.phone})</span>
                    </div>
                  </div>
                </div>

                {/* Allergies & conduite d'urgence */}
                <div className="p-3 bg-red-50/80 border border-red-200 rounded-lg">
                  <span className="font-bold text-red-950 block text-[11px] mb-1">
                    Allergies & Conduite à tenir en cas de crise :
                  </span>
                  <p className="text-slate-900 font-medium">
                    {selectedDetailStudent.cerfa.medicalInfo.allergyCauseAndAction || 'Aucune allergie critique déclarée.'}
                  </p>
                </div>
              </div>

              {/* Part 2: Données médicales sensibles (Ségrégation d'accès RBAC) */}
              <div className="p-4 border border-slate-300 rounded-xl bg-slate-100/70">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-900 uppercase text-[11px] block flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-slate-700" />
                      2. Informations médicales sensibles détaillées
                    </span>
                    <p className="text-[11px] text-slate-500">
                      Antécédents complets, ordonnances et dossiers PAI protégés par le secret médical.
                    </p>
                  </div>

                  {unlockedSensitiveStudentId !== selectedDetailStudent.id ? (
                    <button
                      onClick={() => setUnlockedSensitiveStudentId(selectedDetailStudent.id)}
                      className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg shadow-xs transition-colors"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      Déverrouiller l accès (Urgence)
                    </button>
                  ) : (
                    <span className="text-emerald-700 font-bold text-[11px] flex items-center gap-1">
                      <Unlock className="w-3.5 h-3.5" /> Accès autorisé
                    </span>
                  )}
                </div>

                {unlockedSensitiveStudentId === selectedDetailStudent.id && (
                  <div className="mt-4 pt-3 border-t border-slate-200 space-y-3 bg-white p-3 rounded-lg">
                    <div>
                      <strong className="text-slate-800 block text-[11px]">Traitement médical en cours :</strong>
                      <p className="text-slate-700 mt-0.5">{selectedDetailStudent.cerfa.medicalInfo.treatmentDetails || 'Aucun traitement'}</p>
                    </div>

                    <div>
                      <strong className="text-slate-800 block text-[11px]">Difficultés de santé / Antécédents :</strong>
                      <p className="text-slate-700 mt-0.5">{selectedDetailStudent.cerfa.medicalInfo.healthDifficulties || 'Néant'}</p>
                    </div>

                    {/* PAI Spécifique */}
                    {selectedDetailStudent.cerfa.medicalInfo.hasPai && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-red-950 text-xs flex items-center gap-1.5">
                            <AlertCircle className="w-4 h-4 text-red-600" />
                            Protocole d'Accueil Individualisé (PAI) Actif
                          </span>
                          <span className="bg-red-200 text-red-900 text-[10px] font-bold px-2 py-0.5 rounded">
                            Priorité Sanitaire
                          </span>
                        </div>
                        {selectedDetailStudent.cerfa.documents.filter((d) => d.type === 'pai').length > 0 ? (
                          <div className="space-y-1">
                            {selectedDetailStudent.cerfa.documents
                              .filter((d) => d.type === 'pai')
                              .map((d) => (
                                <div
                                  key={d.id}
                                  className="flex items-center justify-between bg-white border border-red-200 p-2 rounded text-xs"
                                >
                                  <div>
                                    <span className="font-bold text-slate-900 block">{d.name}</span>
                                    <span className="text-[10px] text-slate-500 font-mono">
                                      {d.fileName} • {d.sizeKb} Ko
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openOrDownloadDocument(
                                        d,
                                        `${selectedDetailStudent.cerfa.identity.firstName} ${selectedDetailStudent.cerfa.identity.lastName}`
                                      )
                                    }
                                    className="flex items-center gap-1 bg-red-700 hover:bg-red-800 text-white font-bold px-2.5 py-1 rounded text-[11px] transition cursor-pointer"
                                  >
                                    <Download className="w-3 h-3" />
                                    <span>Consulter / Télécharger PAI</span>
                                  </button>
                                </div>
                              ))}
                          </div>
                        ) : (
                          <p className="text-xs text-red-800 italic">
                            Un PAI a été déclaré par la famille mais aucun document numérique n'a encore été rattaché.
                          </p>
                        )}
                      </div>
                    )}

                    <div>
                      <strong className="text-slate-800 block text-[11px] mb-1">
                        Documents médicaux confidentiels ({selectedDetailStudent.cerfa.documents.length}) :
                      </strong>
                      {selectedDetailStudent.cerfa.documents.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">Aucun document joint pour cet élève.</p>
                      ) : (
                        <ul className="mt-1 space-y-1.5 text-slate-600">
                          {selectedDetailStudent.cerfa.documents.map((d) => (
                            <li
                              key={d.id}
                              className="flex items-center justify-between text-xs bg-slate-50 hover:bg-slate-100 p-2 rounded-lg border border-slate-200"
                            >
                              <div className="flex items-center gap-2">
                                <FileText className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                                <div>
                                  <span className="font-semibold text-slate-900 block">{d.name}</span>
                                  <span className="text-slate-500 font-mono text-[10px]">
                                    {d.fileName} • {d.sizeKb} Ko • Type: {d.type.toUpperCase()}
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  openOrDownloadDocument(
                                    d,
                                    `${selectedDetailStudent.cerfa.identity.firstName} ${selectedDetailStudent.cerfa.identity.lastName}`
                                  )
                                }
                                className="flex items-center gap-1 bg-white hover:bg-blue-50 text-blue-900 border border-blue-200 font-semibold px-2 py-1 rounded text-[11px] transition cursor-pointer"
                                title="Télécharger ou afficher ce document"
                              >
                                <Download className="w-3 h-3 text-blue-700" />
                                <span>Consulter</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-200 flex justify-between items-center">
              <button
                onClick={() => onSelectStudentToView(selectedDetailStudent)}
                className="text-xs font-semibold text-blue-900 hover:text-blue-950 flex items-center gap-1"
              >
                <FileText className="w-3.5 h-3.5" /> Ouvrir la fiche sanitaire complète
              </button>
              <button
                onClick={() => {
                  setSelectedDetailStudent(null);
                  setUnlockedSensitiveStudentId(null);
                }}
                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded font-semibold text-xs"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sanitary Health List Modal (Ordered by Class or Alphabetical, with diets, allergies, PAI) */}
      {showHealthReportModal && (
        <TripHealthListModal
          trip={currentTrip}
          students={enrolledStudents}
          initialSortMode={healthReportInitialSort}
          onClose={() => setShowHealthReportModal(false)}
        />
      )}

      {/* Organizer Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-100 text-blue-900 rounded-lg">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900">
                    Modifier mon mot de passe
                  </h3>
                  <p className="text-xs text-slate-500">
                    Espace personnel : {currentUser.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowPasswordModal(false);
                  setPwdError('');
                  setPwdSuccess('');
                }}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {pwdError && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{pwdError}</span>
              </div>
            )}

            {pwdSuccess && (
              <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 p-3 rounded-xl text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{pwdSuccess}</span>
              </div>
            )}

            <form onSubmit={handlePasswordChangeSubmit} className="space-y-3.5 text-xs">
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-slate-600 space-y-0.5">
                <div>Identifiant de connexion : <strong className="text-slate-900 font-mono">{currentUser.email}</strong></div>
                <div>Rôle : <span className="font-semibold text-blue-900">Organisateur de voyage</span></div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Mot de passe actuel
                </label>
                <input
                  type={showPasswordText ? 'text' : 'password'}
                  value={currentPasswordInput}
                  onChange={(e) => setCurrentPasswordInput(e.target.value)}
                  placeholder="Saisissez votre mot de passe actuel"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700">
                    Nouveau mot de passe *
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPasswordText(!showPasswordText)}
                    className="text-[11px] text-blue-700 hover:text-blue-900 cursor-pointer flex items-center gap-1"
                  >
                    {showPasswordText ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {showPasswordText ? 'Masquer' : 'Afficher'}
                  </button>
                </div>
                <input
                  type={showPasswordText ? 'text' : 'password'}
                  required
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  placeholder="Au moins 4 caractères"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Confirmer le nouveau mot de passe *
                </label>
                <input
                  type={showPasswordText ? 'text' : 'password'}
                  required
                  value={confirmPasswordInput}
                  onChange={(e) => setConfirmPasswordInput(e.target.value)}
                  placeholder="Répétez le nouveau mot de passe"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-semibold transition-colors shadow-xs cursor-pointer"
                >
                  Enregistrer mon nouveau mot de passe
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
