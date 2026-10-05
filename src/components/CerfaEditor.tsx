import React, { useState } from 'react';
import { Student, CerfaSanitarySheet, AttachedDocument, HistoryEntry, CerfaVersion, Trip, SchoolClass } from '../types';
import { computeCerfaCompleteness, formatDateFr } from '../utils/cerfaValidation';
import { openOrDownloadDocument } from '../utils/documentViewer';
import { SignaturePad } from './SignaturePad';
import { flashNotice, prepareAttachment, validateAttachment } from '../utils/attachments';
import { signatureFileToDataUrl, validateSignatureFile } from '../utils/signatureImage';
import {
  Save,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  ShieldCheck,
  AlertTriangle,
  Upload,
  FileText,
  Trash2,
  Calendar,
  CheckCircle2,
  Clock,
  Info,
  Lock,
  Plus,
  ShieldAlert,
  FileCheck,
  X,
  ExternalLink,
  Plane,
  MapPin,
  Download,
} from 'lucide-react';

interface CerfaEditorProps {
  student: Student;
  trips?: Trip[];
  classes?: SchoolClass[];
  initialSection?: 'identite' | 'vaccins' | 'medical' | 'regime' | 'signature';
  authorName: string;
  authorRole: string;
  onSave: (updatedStudent: Student) => void;
  onSaveDraft?: (updatedStudent: Student) => void;
  onCancel: () => void;
  onViewCerfaOfficial: () => void;
  onRegisterTrip?: (studentId: string, tripId: string) => void;
  onUnregisterTrip?: (studentId: string, tripId: string) => void;
}

export const CerfaEditor: React.FC<CerfaEditorProps> = ({
  student,
  trips = [],
  classes = [],
  initialSection = 'identite',
  authorName,
  authorRole,
  onSave,
  onSaveDraft,
  onCancel,
  onViewCerfaOfficial,
  onRegisterTrip,
  onUnregisterTrip,
}) => {
  const [formData, setFormData] = useState<CerfaSanitarySheet>(JSON.parse(JSON.stringify(student.cerfa)));
  const [selectedClass, setSelectedClass] = useState<string>(student.schoolClass);
  const [selectedBoardingStatus, setSelectedBoardingStatus] = useState<'DP' | 'Externe' | 'Interne'>(student.boardingStatus);
  const [activeSection, setActiveSection] = useState<'identite' | 'vaccins' | 'medical' | 'regime' | 'signature'>(
    initialSection === ('documents' as any) ? 'medical' : initialSection
  );
  const [selectedTripIds, setSelectedTripIds] = useState<string[]>(student.registeredTripIds || []);
  const [modificationNote, setModificationNote] = useState('');
  const [signatureUploadError, setSignatureUploadError] = useState('');
  const [showValidationBlockedModal, setShowValidationBlockedModal] = useState(false);
  const [showTripRequiredModal, setShowTripRequiredModal] = useState(false);
  const [showPostSaveReminderModal, setShowPostSaveReminderModal] = useState(false);
  const [pendingSaveStudent, setPendingSaveStudent] = useState<Student | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string>('');

  const FORM_SECTIONS: { id: 'identite' | 'vaccins' | 'medical' | 'regime' | 'signature'; label: string; shortLabel: string }[] = [
    { id: 'identite', label: '1. Enfant & Identité', shortLabel: 'Identité' },
    { id: 'vaccins', label: '2. Vaccinations (CERFA)', shortLabel: 'Vaccinations' },
    { id: 'medical', label: '3. Renseignements Médicaux', shortLabel: 'Médical' },
    { id: 'regime', label: '4. Allergies & Régimes', shortLabel: 'Régimes & Allergies' },
    { id: 'signature', label: '5. Signature & Déclaration', shortLabel: 'Signature' },
  ];

  const currentSectionIndex = FORM_SECTIONS.findIndex((s) => s.id === activeSection);
  const prevSection = currentSectionIndex > 0 ? FORM_SECTIONS[currentSectionIndex - 1] : null;
  const nextSection = currentSectionIndex < FORM_SECTIONS.length - 1 ? FORM_SECTIONS[currentSectionIndex + 1] : null;

  const handleGoToSection = (sectionId: 'identite' | 'vaccins' | 'medical' | 'regime' | 'signature') => {
    // Enregistre automatiquement un brouillon à chaque changement de page,
    // pour ne jamais perdre la saisie même si le parent ne clique pas sur
    // "Enregistrer mon brouillon" explicitement.
    if (onSaveDraft) {
      handleSaveDraftClick();
    }
    setActiveSection(sectionId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleToggleTrip = (tripId: string) => {
    const isEnrolled = selectedTripIds.includes(tripId);
    let updated: string[];
    if (isEnrolled) {
      updated = selectedTripIds.filter((id) => id !== tripId);
      if (onUnregisterTrip) onUnregisterTrip(student.id, tripId);
    } else {
      updated = [...selectedTripIds, tripId];
      if (onRegisterTrip) onRegisterTrip(student.id, tripId);
    }
    setSelectedTripIds(updated);
  };

  const completeness = computeCerfaCompleteness(formData);
  const isParent = authorRole.toLowerCase().includes('parent');
  // Import d'une image de signature : réservé à l'administration (jamais proposé aux parents)
  const isAdminAuthor = authorRole.toLowerCase().includes('administration');
  const handleAdminSignatureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !isAdminAuthor) return;
    setSignatureUploadError('');
    const problem = validateSignatureFile(file);
    if (problem) {
      setSignatureUploadError(problem);
      return;
    }
    try {
      const dataUrl = await signatureFileToDataUrl(file);
      setFormData((prev) => ({
        ...prev,
        signature: {
          ...prev.signature,
          signatureDataUrl: dataUrl,
          signedByName: prev.legalGuardian.fullName || authorName,
          signedDate: new Date().toISOString().substring(0, 10),
          method: 'uploaded',
          uploadedBy: authorName,
        },
      }));
    } catch (err) {
      setSignatureUploadError(
        "Impossible d'utiliser cette image (illisible ou sans signature visible). Essayez un autre fichier PNG ou JPEG."
      );
    }
  };
  // Activé si au moins un voyage impose le choix d'un séjour pour pouvoir enregistrer
  const tripSelectionRequired = (trips || []).some((t) => t.requireTripSelectionToSave);

  const handleIdentityChange = (field: keyof typeof formData.identity, value: any) => {
    setFormData((prev) => ({
      ...prev,
      identity: { ...prev.identity, [field]: value },
    }));
  };

  const handleObligatoryVaccineChange = (vaccineKey: keyof typeof formData.vaccinations.obligatoires, field: 'done' | 'lastBoosterDate', value: any) => {
    setFormData((prev) => {
      const current = prev.vaccinations.obligatoires[vaccineKey];
      return {
        ...prev,
        vaccinations: {
          ...prev.vaccinations,
          obligatoires: {
            ...prev.vaccinations.obligatoires,
            [vaccineKey]: {
              ...current,
              [field]: value,
              ...(field === 'done' && value === false ? { lastBoosterDate: '' } : {}),
            },
          },
        },
      };
    });
  };

  const handleRecommendedVaccineChange = (vaccineKey: keyof typeof formData.vaccinations.recommandes, field: 'done' | 'date' | 'name', value: any) => {
    setFormData((prev) => ({
      ...prev,
      vaccinations: {
        ...prev.vaccinations,
        recommandes: {
          ...prev.vaccinations.recommandes,
          [vaccineKey]: {
            ...prev.vaccinations.recommandes[vaccineKey],
            [field]: value,
          },
        },
      },
    }));
  };

  const handleAntecedentToggle = (diseaseKey: keyof typeof formData.medicalInfo.antecedents) => {
    setFormData((prev) => ({
      ...prev,
      medicalInfo: {
        ...prev.medicalInfo,
        antecedents: {
          ...prev.medicalInfo.antecedents,
          [diseaseKey]: !prev.medicalInfo.antecedents[diseaseKey],
        },
      },
    }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, docType: AttachedDocument['type']) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    // Contrôle du type et de la taille ; les photos sont réduites avant d'être enregistrées
    const problem = validateAttachment(file);
    if (problem) {
      flashNotice(setUploadNotice, problem, 9000);
      return;
    }

    prepareAttachment(file)
      .then(({ dataUrl, sizeBytes, name }) => {
        const newDoc: AttachedDocument = {
          id: 'doc-' + Date.now(),
          name: docType === 'pai' ? `Protocole PAI - ${name}` : name,
          type: docType,
          uploadDate: new Date().toISOString(),
          sizeKb: Math.max(1, Math.round(sizeBytes / 1024)),
          fileName: name,
          sensitiveMedical: true,
          dataUrl,
        };

        setFormData((prev) => ({
          ...prev,
          documents: [newDoc, ...prev.documents],
          medicalInfo: {
            ...prev.medicalInfo,
            hasPai: docType === 'pai' ? true : prev.medicalInfo.hasPai,
            hasPrescriptionAttached: docType === 'ordonnance' ? true : prev.medicalInfo.hasPrescriptionAttached,
          },
        }));

        flashNotice(setUploadNotice, `Document "${name}" ajouté avec succès !`, 4000);
      })
      .catch((err) => {
        flashNotice(setUploadNotice, err && err.message ? err.message : "Ce fichier n'a pas pu être ajouté.", 9000);
      });
  };

  const handleDeleteDocument = (docId: string) => {
    setFormData((prev) => ({
      ...prev,
      documents: prev.documents.filter((d) => d.id !== docId),
    }));
  };

  // Construit l'objet élève à jour à partir du formulaire — utilisé à la fois
  // par l'enregistrement final (validé) et par l'enregistrement de brouillon.
  const buildUpdatedStudent = (actionLabel: string): Student => {
    const now = new Date();
    const dateFormatted = now.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const isAlreadySigned = Boolean(student.cerfa.signature.signatureDataUrl);
    const newVersionNumber = isAlreadySigned ? (formData.signature.version || 1) + 1 : (formData.signature.version || 1);

    const historyEntry: HistoryEntry = {
      id: 'h-' + Date.now(),
      date: dateFormatted,
      action: modificationNote.trim() || actionLabel,
      authorName,
      authorRole,
      details:
        (modificationNote.trim() || 'Modifications enregistrées') +
        (formData.signature.method === 'uploaded' &&
        formData.signature.signatureDataUrl !== student.cerfa.signature.signatureDataUrl
          ? ` — Signature importée par l'administration (${authorName})`
          : ''),
    };

    const newVersions: CerfaVersion[] = [...(formData.versions || [])];
    if (formData.signature.signatureDataUrl && formData.declarationAccepted) {
      newVersions.push({
        versionNumber: newVersionNumber,
        signedDate: dateFormatted,
        signedBy: formData.signature.signedByName || authorName,
        summary: modificationNote.trim() || `Validation version ${newVersionNumber}`,
      });
    }

    return {
      ...student,
      schoolClass: selectedClass,
      boardingStatus: selectedBoardingStatus,
      registeredTripIds: selectedTripIds,
      completenessPercent: completeness.percent,
      status: completeness.isComplete ? 'complete' : 'incomplete',
      updatedAt: now.toISOString(),
      cerfa: {
        ...formData,
        signature: {
          ...formData.signature,
          version: newVersionNumber,
          validatedAt: formData.signature.signatureDataUrl ? now.toISOString() : formData.signature.validatedAt,
        },
        history: [historyEntry, ...(formData.history || [])],
        versions: newVersions,
      },
    };
  };

  const handleSaveForm = () => {
    // Parent constraint: un voyage doit obligatoirement être choisi (si l'option est activée)
    if (isParent && tripSelectionRequired && selectedTripIds.length === 0) {
      setShowTripRequiredModal(true);
      return;
    }

    // Parent constraint: ALL mandatory fields must be filled!
    // Le blocage s'applique à tout le monde (parent, organisateur, admin) :
    // le bouton affiche "Enregistrement bloqué" pour n'importe quel rôle dès
    // que la fiche est incomplète, donc le clic doit bloquer pour tout le monde.
    if (!completeness.isComplete) {
      setShowValidationBlockedModal(true);
      return;
    }

    const isAlreadySigned = Boolean(student.cerfa.signature.signatureDataUrl);
    const updatedStudent = buildUpdatedStudent(
      isAlreadySigned ? `Mise à jour fiche sanitaire` : 'Mise à jour des informations'
    );

    // Si l'un des voyages choisis demande la remise papier de la fiche,
    // avertir le parent par une fenêtre dédiée avant de continuer.
    const tripsNeedingHandoff = trips.filter(
      (t) => selectedTripIds.includes(t.id) && t.showPrintReminderBanner
    );
    if (isParent && tripsNeedingHandoff.length > 0) {
      setPendingSaveStudent(updatedStudent);
      setShowPostSaveReminderModal(true);
      return;
    }

    onSave(updatedStudent);
  };

  // Enregistre un brouillon : jamais bloqué, quel que soit l'état de complétude,
  // pour que personne ne perde sa progression entre deux visites.
  const [draftJustSaved, setDraftJustSaved] = useState(false);
  const handleSaveDraftClick = () => {
    if (!onSaveDraft) return;
    const updatedStudent = buildUpdatedStudent('Brouillon enregistré (fiche non finalisée)');
    onSaveDraft(updatedStudent);
    setDraftJustSaved(true);
    setTimeout(() => setDraftJustSaved(false), 3000);
  };

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 sm:px-6">
      {/* Top Banner with Student Info and Progress */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 mr-2"
            >
              <ArrowLeft className="w-4 h-4" /> Retour
            </button>
            <h2 className="text-lg font-bold text-slate-900">
              Fiche Sanitaire de Liaison — {student.cerfa.identity.firstName} {student.cerfa.identity.lastName}
            </h2>
            <span className="bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded font-mono">
              Classe {student.schoolClass}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Complétez l ensemble des rubriques officielles. Les données sont sauvegardées en toute sécurité.
          </p>
        </div>

        {/* Completeness Gauge */}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs font-semibold text-slate-700">
              Complétude légale : <strong className="text-sm font-bold text-blue-900">{completeness.percent}%</strong>
            </div>
            <div className="text-[11px] text-slate-500">
              {completeness.isComplete ? '✓ Prête et conforme' : `${completeness.missingFields.length} point(s) à renseigner`}
            </div>
          </div>
          <div className="w-24 bg-slate-200 rounded-full h-2.5 overflow-hidden">
            <div
              className={`h-2.5 rounded-full transition-all duration-300 ${
                completeness.percent >= 90 ? 'bg-emerald-600' : completeness.percent >= 60 ? 'bg-amber-500' : 'bg-red-500'
              }`}
              style={{ width: `${completeness.percent}%` }}
            ></div>
          </div>

          <button
            onClick={onViewCerfaOfficial}
            className="flex items-center gap-1.5 text-xs font-semibold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-2 rounded-lg transition-colors"
          >
            <Eye className="w-4 h-4" />
            Aperçu Fiche Sanitaire
          </button>
        </div>
      </div>

      {/* Warning box if incomplete */}
      {!completeness.isComplete && (
        <div className="mb-6 p-5 bg-red-50 border-2 border-red-400 rounded-xl text-sm text-red-900 flex items-start gap-3 shadow-md animate-pulse">
          <AlertTriangle className="w-7 h-7 text-red-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-extrabold text-base text-red-800">Éléments obligatoires restants pour validation légale :</span>
            <ul className="list-disc list-inside mt-2 space-y-1 text-red-800 font-semibold text-sm">
              {completeness.missingFields.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Enrolled Trips Banner with quick unregister */}
      {selectedTripIds.length > 0 && (
        <div className="mb-5 p-3.5 bg-blue-50/90 border border-blue-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start sm:items-center gap-2.5">
            <Plane className="w-4 h-4 text-blue-700 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <span className="font-bold text-blue-950">Inscriptions aux voyages scolaires :</span>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {selectedTripIds.map((tId) => {
                  const tr = trips.find((t) => t.id === tId);
                  if (!tr) return null;
                  return (
                    <span
                      key={tr.id}
                      className="inline-flex items-center gap-2 bg-white border border-blue-200 text-blue-950 px-2.5 py-1 rounded-lg text-xs font-semibold shadow-2xs"
                    >
                      <span>{tr.name} ({tr.destination})</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Confirmer la suppression de l'inscription au voyage "${tr.name}" ?`)) {
                            handleToggleTrip(tr.id);
                          }
                        }}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 p-0.5 rounded transition cursor-pointer flex items-center gap-0.5 text-[11px]"
                        title="Supprimer cette inscription"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        <span className="text-[10px] text-red-600 font-medium">Supprimer</span>
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Section Tabs */}
      <div className="flex overflow-x-auto gap-2 pb-2 mb-6 border-b border-slate-200 no-scrollbar">
        {[
          { id: 'identite', label: '1. Enfant & Identité' },
          { id: 'vaccins', label: '2. Vaccinations' },
          { id: 'medical', label: '3. Renseignements Médicaux' },
          { id: 'regime', label: '4. Allergie alimentaire & Régime' },
          { id: 'signature', label: '5. Signature & Déclaration' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSection(tab.id as any)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
              activeSection === tab.id
                ? 'bg-blue-900 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Form Content */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-6">

        {/* SECTION 1: IDENTITE */}
        {activeSection === 'identite' && (
          <div className="space-y-4">
            <div className="border-b border-slate-200 pb-2">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                Rubrique 1 — ENFANT (Renseignements d'état civil)
              </h3>
              <p className="text-xs text-slate-500">
                Renseignez scrupuleusement les informations d état civil de l élève.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Nom de famille *
                </label>
                <input
                  type="text"
                  value={formData.identity.lastName}
                  onChange={(e) => handleIdentityChange('lastName', e.target.value.toUpperCase())}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-600 focus:bg-white focus:outline-none"
                  placeholder="DUPONT"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Prénom *
                </label>
                <input
                  type="text"
                  value={formData.identity.firstName}
                  onChange={(e) => handleIdentityChange('firstName', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-600 focus:bg-white focus:outline-none"
                  placeholder="Paul"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Date de naissance *
                </label>
                <input
                  type="date"
                  value={formData.identity.birthDate}
                  onChange={(e) => handleIdentityChange('birthDate', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-600 focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Sexe (selon CERFA) *
                </label>
                <div className="flex items-center gap-4 mt-2">
                  <label className="flex items-center gap-1.5 text-xs text-slate-800 cursor-pointer">
                    <input
                      type="radio"
                      name="gender"
                      checked={formData.identity.gender === 'Garcon'}
                      onChange={() => handleIdentityChange('gender', 'Garcon')}
                      className="text-blue-900 focus:ring-blue-600"
                    />
                    Garçon
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-800 cursor-pointer">
                    <input
                      type="radio"
                      name="gender"
                      checked={formData.identity.gender === 'Fille'}
                      onChange={() => handleIdentityChange('gender', 'Fille')}
                      className="text-blue-900 focus:ring-blue-600"
                    />
                    Fille
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Classe
                </label>
                <select
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-600 focus:bg-white focus:outline-none"
                >
                  {!classes.some((c) => c.name === selectedClass) && (
                    <option value={selectedClass}>{selectedClass} (actuelle)</option>
                  )}
                  {classes.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Régime de pension
                </label>
                <select
                  value={selectedBoardingStatus}
                  onChange={(e) => setSelectedBoardingStatus(e.target.value as 'DP' | 'Externe' | 'Interne')}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-600 focus:bg-white focus:outline-none"
                >
                  <option value="DP">Demi-pensionnaire</option>
                  <option value="Externe">Externe</option>
                  <option value="Interne">Interne</option>
                </select>
              </div>
            </div>

            {/* Téléphone portable de l'enfant (champ officiel CERFA) */}
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Téléphone portable de l enfant (Champ CERFA)
                </label>
                <input
                  type="tel"
                  value={formData.identity.childMobilePhone}
                  onChange={(e) => handleIdentityChange('childMobilePhone', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-medium focus:ring-2 focus:ring-blue-600 focus:bg-white focus:outline-none"
                  placeholder="06 12 34 56 78"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Permet de joindre l élève en cas de besoin lors des déplacements et visites.
                </span>

                <label className="block text-xs font-bold text-slate-700 uppercase mb-1 mt-3">
                  Numéro de sécurité sociale
                </label>
                <input
                  type="text"
                  value={formData.identity.socialSecurityNumber}
                  onChange={(e) => handleIdentityChange('socialSecurityNumber', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono font-medium focus:ring-2 focus:ring-blue-600 focus:bg-white focus:outline-none"
                  placeholder="Numéro de l enfant ou du responsable légal"
                />
              </div>

              {/* Médecin traitant (facultatif) */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <span className="font-bold text-xs text-slate-800 uppercase block mb-2">
                  Médecin traitant (Rubrique 5 du CERFA — Facultatif)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={formData.treatingDoctor.name}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        treatingDoctor: { ...prev.treatingDoctor, name: e.target.value },
                      }))
                    }
                    placeholder="Nom du médecin"
                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs"
                  />
                  <input
                    type="tel"
                    value={formData.treatingDoctor.phone}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        treatingDoctor: { ...prev.treatingDoctor, phone: e.target.value },
                      }))
                    }
                    placeholder="Téléphone médecin"
                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 2: VACCINATIONS */}
        {activeSection === 'vaccins' && (
          <div className="space-y-6">
            <div className="border-b border-slate-200 pb-2">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                Rubrique 2 — VACCINATIONS
              </h3>
              <p className="text-xs text-slate-500">
                « Se référer au carnet de santé ou aux certificats de vaccination. »
              </p>
            </div>

            {/* Vaccins obligatoires */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold uppercase text-slate-800">
                  Vaccinations (Diphtérie, Tétanos, Poliomyélite, DT Polio ou Tétracoq — Facultatif)
                </h4>
                <span className="text-[11px] text-slate-500">Facultatif • Dates au format JJ/MM/AAAA</span>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">Vaccin (Optionnel)</th>
                      <th className="p-2.5 text-center w-36">Statut (Oui / Non)</th>
                      <th className="p-2.5 w-48">Date du dernier rappel</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[
                      { key: 'diphterie', name: 'Diphtérie' },
                      { key: 'tetanos', name: 'Tétanos' },
                      { key: 'poliomyelite', name: 'Poliomyélite' },
                      { key: 'dtPolio', name: 'Ou DT Polio (Combiné)' },
                      { key: 'tetracoq', name: 'Ou Tétracoq (Combiné)' },
                    ].map((item) => {
                      const v = formData.vaccinations.obligatoires[item.key as keyof typeof formData.vaccinations.obligatoires];
                      return (
                        <tr key={item.key} className="hover:bg-slate-50">
                          <td className="p-2.5 font-medium text-slate-900">{item.name}</td>
                          <td className="p-2.5 text-center">
                            <div className="inline-flex items-center gap-3">
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`vac-${item.key}`}
                                  checked={v?.done === true}
                                  onChange={() => handleObligatoryVaccineChange(item.key as any, 'done', true)}
                                />
                                Oui
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`vac-${item.key}`}
                                  checked={v?.done === false}
                                  onChange={() => handleObligatoryVaccineChange(item.key as any, 'done', false)}
                                />
                                Non
                              </label>
                            </div>
                          </td>
                          <td className="p-2.5">
                            <input
                              type="date"
                              disabled={v?.done !== true}
                              value={v?.lastBoosterDate || ''}
                              onChange={(e) => handleObligatoryVaccineChange(item.key as any, 'lastBoosterDate', e.target.value)}
                              className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1 text-xs disabled:opacity-40"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Contre-indication obligatoire */}
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.vaccinations.hasContraindication}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        vaccinations: { ...prev.vaccinations, hasContraindication: e.target.checked },
                      }))
                    }
                    className="mt-0.5 rounded text-blue-900"
                  />
                  <div>
                    <span className="font-bold text-amber-950">
                      Contre-indication médicale aux vaccins obligatoires
                    </span>
                    <p className="text-amber-800 text-[11px] mt-0.5">
                      Mention officielle CERFA : « Si les vaccins obligatoires ne sont pas réalisés, joindre un certificat médical de contre-indication. »
                    </p>
                  </div>
                </label>

                {formData.vaccinations.hasContraindication && (
                  <div className="mt-2 pl-6">
                    <input
                      type="text"
                      value={formData.vaccinations.contraindicationDetails}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          vaccinations: { ...prev.vaccinations, contraindicationDetails: e.target.value },
                        }))
                      }
                      placeholder="Préciser le motif médical et veillez à déposer le certificat médical dans l'onglet 'Justificatifs'"
                      className="w-full bg-white border border-amber-300 rounded px-3 py-1.5 text-xs text-slate-900 focus:outline-none"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Vaccins recommandés */}
            <div>
              <h4 className="text-xs font-bold uppercase text-slate-800 mb-2">
                Vaccins recommandés (CERFA n°10008*02)
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {[
                  { key: 'bcg', name: 'BCG (Tuberculose)' },
                  { key: 'hepatiteB', name: 'Hépatite B' },
                  { key: 'ror', name: 'Rubéole - Oreillons - Rougeole (ROR)' },
                  { key: 'coqueluche', name: 'Coqueluche' },
                ].map((item) => {
                  const r = formData.vaccinations.recommandes[item.key as keyof typeof formData.vaccinations.recommandes];
                  return (
                    <div key={item.key} className="p-3 border border-slate-200 rounded-lg bg-slate-50/60 flex items-center justify-between gap-2">
                      <div>
                        <span className="font-medium text-slate-900 block">{item.name}</span>
                        <label className="inline-flex items-center gap-1.5 mt-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={r.done}
                            onChange={(e) => handleRecommendedVaccineChange(item.key as any, 'done', e.target.checked)}
                            className="rounded text-blue-900"
                          />
                          <span className="text-[11px] text-slate-600">Vaccin effectué</span>
                        </label>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Date :</span>
                        <input
                          type="date"
                          disabled={!r.done}
                          value={r.date}
                          onChange={(e) => handleRecommendedVaccineChange(item.key as any, 'date', e.target.value)}
                          className="bg-white border border-slate-300 rounded px-2 py-1 text-xs disabled:opacity-40"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Autres vaccins recommandés */}
              <div className="mt-3 p-3 border border-slate-200 rounded-lg bg-slate-50/60 text-xs flex flex-wrap items-center gap-3">
                <span className="font-medium text-slate-900">Autres vaccins :</span>
                <input
                  type="text"
                  value={formData.vaccinations.recommandes.autres.name || ''}
                  onChange={(e) => handleRecommendedVaccineChange('autres', 'name', e.target.value)}
                  placeholder="Ex : Méningocoque, HPV..."
                  className="flex-1 min-w-[160px] bg-white border border-slate-300 rounded px-2.5 py-1 text-xs"
                />
                <input
                  type="date"
                  value={formData.vaccinations.recommandes.autres.date || ''}
                  onChange={(e) => handleRecommendedVaccineChange('autres', 'date', e.target.value)}
                  className="bg-white border border-slate-300 rounded px-2 py-1 text-xs"
                />
              </div>
            </div>

          </div>
        )}

        {/* SECTION 3: RENSEIGNEMENTS MEDICAUX */}
        {activeSection === 'medical' && (
          <div className="space-y-6">
            <div className="border-b border-slate-200 pb-2">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                Rubrique 3 — RENSEIGNEMENTS MÉDICAUX
              </h3>
              <p className="text-xs text-slate-500">
                Reprise intégrale du questionnaire médical CERFA n°10008*02.
              </p>
            </div>

            {/* Traitement médical */}
            <div className="p-4 border border-slate-200 rounded-lg bg-slate-50/70 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="text-xs font-bold text-slate-900 uppercase">
                  L enfant suit-il un traitement médical ? *
                </label>
                <div className="flex items-center gap-4 text-xs font-semibold">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="treatment"
                      checked={formData.medicalInfo.hasMedicalTreatment}
                      onChange={() =>
                        setFormData((prev) => ({
                          ...prev,
                          medicalInfo: { ...prev.medicalInfo, hasMedicalTreatment: true },
                        }))
                      }
                      className="text-blue-900"
                    />
                    OUI
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="treatment"
                      checked={!formData.medicalInfo.hasMedicalTreatment}
                      onChange={() =>
                        setFormData((prev) => ({
                          ...prev,
                          medicalInfo: { ...prev.medicalInfo, hasMedicalTreatment: false },
                        }))
                      }
                      className="text-blue-900"
                    />
                    NON
                  </label>
                </div>
              </div>

              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900 italic">
                Avertissement CERFA : « Si oui, joindre une ordonnance récente et les médicaments correspondants dans leur emballage d origine avec la notice. Aucun médicament ne pourra être pris sans ordonnance. »
              </div>

              {formData.medicalInfo.hasMedicalTreatment && (
                <div className="space-y-2 pt-2">
                  <label className="block text-xs font-bold text-slate-800">
                    Précisez le traitement en cours et posologie :
                  </label>
                  <textarea
                    rows={2}
                    value={formData.medicalInfo.treatmentDetails}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        medicalInfo: { ...prev.medicalInfo, treatmentDetails: e.target.value },
                      }))
                    }
                    placeholder="Nom du médicament, dosage, fréquence et horaires de prise..."
                    className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs text-slate-900 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* Antécédents médicaux - Tableau des 10 maladies CERFA */}
            <div>
              <h4 className="text-xs font-bold uppercase text-slate-800 mb-1">
                Antécédents médicaux (Cocher si l enfant a déjà eu ces maladies)
              </h4>
              <p className="text-[11px] text-slate-500 mb-3">
                Tableau figurant explicitement sur le CERFA n°10008*02.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {[
                  { key: 'rubeole', label: 'Rubéole' },
                  { key: 'varicelle', label: 'Varicelle' },
                  { key: 'angines', label: 'Angines' },
                  { key: 'rhumatismes', label: 'Rhumatismes' },
                  { key: 'scarlatine', label: 'Scarlatine' },
                  { key: 'coqueluche', label: 'Coqueluche' },
                  { key: 'otites', label: 'Otites' },
                  { key: 'asthme', label: 'Asthme' },
                  { key: 'rougeole', label: 'Rougeole' },
                  { key: 'oreillons', label: 'Oreillons' },
                ].map((item) => {
                  const isChecked = formData.medicalInfo.antecedents[item.key as keyof typeof formData.medicalInfo.antecedents];
                  return (
                    <button
                      type="button"
                      key={item.key}
                      onClick={() => handleAntecedentToggle(item.key as any)}
                      className={`p-2 rounded-lg border text-xs font-medium flex items-center justify-between transition-colors ${
                        isChecked
                          ? 'bg-blue-900 text-white border-blue-900'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <span>{item.label}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isChecked ? 'bg-white/20' : 'text-slate-400'}`}>
                        {isChecked ? 'OUI' : 'NON'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Allergies */}
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50 space-y-4">
              <h4 className="text-xs font-bold uppercase text-slate-800">
                Rubrique Allergies (CERFA n°10008*02)
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {/* Asthme */}
                <div className="p-3 bg-white border border-slate-200 rounded-lg">
                  <span className="font-bold text-slate-900 block mb-2">Asthme</span>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="allergy-asthme"
                        checked={formData.medicalInfo.allergies.asthme}
                        onChange={() =>
                          setFormData((prev) => ({
                            ...prev,
                            medicalInfo: {
                              ...prev.medicalInfo,
                              allergies: { ...prev.medicalInfo.allergies, asthme: true },
                            },
                          }))
                        }
                      />
                      Oui
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="allergy-asthme"
                        checked={!formData.medicalInfo.allergies.asthme}
                        onChange={() =>
                          setFormData((prev) => ({
                            ...prev,
                            medicalInfo: {
                              ...prev.medicalInfo,
                              allergies: { ...prev.medicalInfo.allergies, asthme: false },
                            },
                          }))
                        }
                      />
                      Non
                    </label>
                  </div>
                </div>

                {/* Médicamenteuses */}
                <div className="p-3 bg-white border border-slate-200 rounded-lg">
                  <span className="font-bold text-slate-900 block mb-2">Médicamenteuses</span>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="allergy-med"
                        checked={formData.medicalInfo.allergies.medicamenteuses}
                        onChange={() =>
                          setFormData((prev) => ({
                            ...prev,
                            medicalInfo: {
                              ...prev.medicalInfo,
                              allergies: { ...prev.medicalInfo.allergies, medicamenteuses: true },
                            },
                          }))
                        }
                      />
                      Oui
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="allergy-med"
                        checked={!formData.medicalInfo.allergies.medicamenteuses}
                        onChange={() =>
                          setFormData((prev) => ({
                            ...prev,
                            medicalInfo: {
                              ...prev.medicalInfo,
                              allergies: { ...prev.medicalInfo.allergies, medicamenteuses: false },
                            },
                          }))
                        }
                      />
                      Non
                    </label>
                  </div>
                </div>

              </div>

              {/* Autres allergies */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Autres allergies (champ texte CERFA) :
                </label>
                <input
                  type="text"
                  value={formData.medicalInfo.allergies.autres}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      medicalInfo: {
                        ...prev.medicalInfo,
                        allergies: { ...prev.medicalInfo.allergies, autres: e.target.value },
                      },
                    }))
                  }
                  placeholder="Ex : Piqûres de guêpes, poils de chat, latex..."
                  className="w-full bg-white border border-slate-300 rounded px-3 py-1.5 text-xs text-slate-900"
                />
              </div>

              {/* Champ obligatoire : Préciser la cause de l'allergie et la conduite à tenir */}
              {(formData.medicalInfo.allergies.asthme ||
                formData.medicalInfo.allergies.medicamenteuses ||
                formData.medicalInfo.allergies.alimentaires ||
                Boolean(formData.medicalInfo.allergies.autres)) && (
                <div className="p-3 bg-red-50/70 border border-red-200 rounded-lg space-y-2">
                  <label className="block text-xs font-bold text-red-950 uppercase">
                    Préciser la cause de l allergie et la conduite à tenir (Obligatoire) *
                  </label>
                  <textarea
                    rows={3}
                    value={formData.medicalInfo.allergyCauseAndAction}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        medicalInfo: { ...prev.medicalInfo, allergyCauseAndAction: e.target.value },
                      }))
                    }
                    placeholder="Symptômes déclenchés, protocole d'urgence, trousse d'urgence, personnes à prévenir immédiatement..."
                    className="w-full bg-white border border-red-300 rounded-lg p-2.5 text-xs text-slate-900 focus:outline-none"
                  />
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="self-med"
                      checked={formData.medicalInfo.isSelfMedicationReported}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          medicalInfo: { ...prev.medicalInfo, isSelfMedicationReported: e.target.checked },
                        }))
                      }
                      className="rounded text-red-900"
                    />
                    <label htmlFor="self-med" className="text-xs text-red-900 font-medium cursor-pointer">
                      Mention CERFA : « Si automédication, le signaler. » (Cocher si l élève gère son traitement de manière autonome)
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* PAI - Projet d'Accueil Individualisé */}
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/70 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-bold text-slate-900 uppercase flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-red-600" />
                    L'enfant bénéficie-t-il d'un Projet d'Accueil Individualisé (PAI) ? *
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Obligatoire si l'élève a une maladie chronique, allergie sévère nécessitant une trousse d'urgence ou un protocole médical.
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs font-semibold">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="pai-status"
                      checked={Boolean(formData.medicalInfo.hasPai)}
                      onChange={() =>
                        setFormData((prev) => ({
                          ...prev,
                          medicalInfo: { ...prev.medicalInfo, hasPai: true },
                        }))
                      }
                      className="text-blue-900"
                    />
                    OUI
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="pai-status"
                      checked={!formData.medicalInfo.hasPai}
                      onChange={() =>
                        setFormData((prev) => ({
                          ...prev,
                          medicalInfo: { ...prev.medicalInfo, hasPai: false },
                        }))
                      }
                      className="text-blue-900"
                    />
                    NON
                  </label>
                </div>
              </div>

              {formData.medicalInfo.hasPai && (
                <div className="space-y-3 pt-3 border-t border-slate-200">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      Pathologie concernée & Protocole d'urgence PAI :
                    </label>
                    <textarea
                      rows={2}
                      value={formData.medicalInfo.paiDetails || ''}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          medicalInfo: { ...prev.medicalInfo, paiDetails: e.target.value },
                        }))
                      }
                      placeholder="Ex : Allergie sévère aux arachides avec stylo auto-injecteur d'adrénaline, asthme avec nébuliseur..."
                      className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs text-slate-900 focus:outline-none"
                    />
                  </div>

                  {/* Upload Zone for PAI Documents */}
                  <div className="p-3.5 bg-white border border-dashed border-blue-300 rounded-xl space-y-2.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                          <Upload className="w-4 h-4 text-blue-700" />
                          Document(s) officiel(s) du PAI (Scan protocole médical, ordonnance PAI) *
                        </span>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Téléversez le protocole signé par le médecin scolaire / traitant et la famille (PDF, PNG, JPG).
                        </p>
                      </div>

                      <label className="cursor-pointer bg-blue-900 hover:bg-blue-950 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-xs w-fit">
                        <Plus className="w-3.5 h-3.5" />
                        <span>Téléverser le PAI</span>
                        <input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg"
                          className="hidden"
                          onChange={(e) => handleFileUpload(e, 'pai')}
                        />
                      </label>
                    </div>

                    {uploadNotice && (
                      <div
                        className={`p-2 border rounded text-xs flex items-center gap-1.5 ${
                          /ajouté avec succès/.test(uploadNotice)
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-red-50 border-red-300 text-red-800 font-semibold'
                        }`}
                        role="status"
                        data-testid="upload-notice"
                      >
                        {/ajouté avec succès/.test(uploadNotice) ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                        ) : (
                          <span aria-hidden="true">⚠</span>
                        )}
                        <span>{uploadNotice}</span>
                      </div>
                    )}

                    {/* Display PAI documents */}
                    {formData.documents.filter((d) => d.type === 'pai').length > 0 ? (
                      <div className="space-y-2 pt-1">
                        {formData.documents
                          .filter((d) => d.type === 'pai')
                          .map((doc) => (
                            <div
                              key={doc.id}
                              className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <FileText className="w-4 h-4 text-red-600 shrink-0" />
                                <div>
                                  <span className="font-bold text-slate-900 block leading-tight">{doc.name}</span>
                                  <span className="text-[10px] text-slate-500 font-mono">
                                    {doc.fileName} • {doc.sizeKb} Ko • Ajouté le {new Date(doc.uploadDate).toLocaleDateString('fr-FR')}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="bg-red-100 text-red-800 text-[10px] font-bold px-2 py-0.5 rounded">
                                  PAI Officiel
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openOrDownloadDocument(doc, `${formData.identity.firstName} ${formData.identity.lastName}`)}
                                  className="text-blue-800 hover:text-blue-950 flex items-center gap-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded px-2 py-1 text-[11px] font-semibold transition cursor-pointer"
                                  title="Consulter ou télécharger ce document"
                                >
                                  <Download className="w-3 h-3 text-blue-700" />
                                  <span>Consulter</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDocument(doc.id)}
                                  className="text-slate-400 hover:text-red-600 p-1 cursor-pointer"
                                  title="Supprimer ce document"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-800 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                        <span>
                          Vous avez indiqué que l'enfant bénéficie d'un PAI. Vous devez obligatoirement téléverser le document officiel du PAI pour valider la fiche.
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Difficultés de santé */}
            <div>
              <label className="block text-xs font-bold uppercase text-slate-800 mb-1">
                Difficultés de santé (Zone de texte importante CERFA)
              </label>
              <p className="text-[11px] text-slate-500 mb-2">
                Préciser : maladie, accident, crises convulsives, hospitalisation, opération, rééducation, dates, précautions à prendre.
              </p>
              <textarea
                rows={4}
                value={formData.medicalInfo.healthDifficulties}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    medicalInfo: { ...prev.medicalInfo, healthDifficulties: e.target.value },
                  }))
                }
                placeholder="Indiquez toute pathologie, fragilité physique ou précaution spécifique. Si aucune, indiquez 'Néant'."
                className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-xs text-slate-900 focus:ring-2 focus:ring-blue-600 focus:bg-white focus:outline-none"
              />
            </div>

          </div>
        )}

        {/* SECTION 4: ALLERGIE ALIMENTAIRE & REGIME */}
        {activeSection === 'regime' && (
          <div className="space-y-6">
            <div className="border-b border-slate-200 pb-2">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                Rubrique 4 — ALLERGIE ALIMENTAIRE & RÉGIME ALIMENTAIRE
              </h3>
              <p className="text-xs text-slate-500">
                Informations indispensables pour la restauration scolaire et les repas durant les séjours.
              </p>
            </div>

            {/* Allergie alimentaire avec case à cocher pour répondre */}
            <div className="p-4 border border-slate-200 rounded-lg bg-slate-50 space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(formData.medicalInfo.allergies.alimentaires)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setFormData((prev) => ({
                      ...prev,
                      medicalInfo: {
                        ...prev.medicalInfo,
                        allergies: {
                          ...prev.medicalInfo.allergies,
                          alimentaires: checked,
                        },
                      },
                    }));
                  }}
                  className="w-4 h-4 rounded text-blue-900 mt-0.5"
                />
                <div>
                  <span className="text-xs font-bold text-slate-900 uppercase block">
                    Allergie alimentaire
                  </span>
                  <span className="text-[11px] text-slate-600 block">
                    Cochez cette case si l'enfant présente une allergie ou intolérance alimentaire nécessitant des précautions ou un panier repas.
                  </span>
                </div>
              </label>

              {/* Case pour répondre / détailler l'allergie */}
              <div className="pt-2">
                <label className="block text-xs font-semibold text-slate-800 mb-1">
                  Précisions sur l'allergie alimentaire (aliments exclus, sévérité, trousse d'urgence...) :
                </label>
                <textarea
                  rows={3}
                  value={formData.parentRecommendations}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      parentRecommendations: e.target.value,
                    }))
                  }
                  placeholder="Ex : Allergie aux arachides et fruits à coque, intolérance au lactose, allergie au poisson... Si aucune allergie, laisser vide."
                  className="w-full bg-white border border-slate-300 rounded-lg p-3 text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-blue-900 focus:outline-none"
                />
              </div>
            </div>

            {/* Régime alimentaire structuré (pour voyages & cantine) */}
            <div className="p-4 border border-slate-200 rounded-lg bg-slate-50 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-900 mb-1">
                  Régime alimentaire structuré (Pour la restauration & voyages) *
                </label>
                <p className="text-[11px] text-slate-500 mb-3">
                  Ce champ structuré permet la transmission rapide aux traiteurs et centres d'accueil.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    { id: 'standard', label: 'Sans restriction' },
                    { id: 'sans_porc', label: 'Sans porc' },
                    { id: 'sans_viande', label: 'Sans viande' },
                    { id: 'vegetarien', label: 'Végétarien' },
                  ].map((diet) => (
                    <label
                      key={diet.id}
                      className={`p-3 rounded-lg border text-xs font-medium cursor-pointer transition-colors flex items-center gap-2 ${
                        formData.structuredDiet.category === diet.id
                          ? 'bg-blue-900 text-white border-blue-900'
                          : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <input
                        type="radio"
                        name="diet-cat"
                        checked={formData.structuredDiet.category === diet.id}
                        onChange={() =>
                          setFormData((prev) => ({
                            ...prev,
                            structuredDiet: { ...prev.structuredDiet, category: diet.id as any },
                          }))
                        }
                        className="text-white"
                      />
                      <span>{diet.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Précisions sur le régime alimentaire :
                  {formData.structuredDiet.category === 'allergie_alimentaire' && (
                    <span className="text-red-600 font-bold"> * Obligatoire</span>
                  )}
                </label>
                <input
                  type="text"
                  value={formData.structuredDiet.details}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      structuredDiet: { ...prev.structuredDiet, details: e.target.value },
                    }))
                  }
                  required={formData.structuredDiet.category === 'allergie_alimentaire'}
                  placeholder="Ex : Pas de viande mais mange du poisson, intolérance au lactose, substituts autorisés..."
                  className={`w-full bg-white border rounded px-3 py-2 text-xs text-slate-900 ${
                    formData.structuredDiet.category === 'allergie_alimentaire' &&
                    !formData.structuredDiet.details.trim()
                      ? 'border-red-400 focus:ring-2 focus:ring-red-500'
                      : 'border-slate-300'
                  }`}
                />
              </div>
            </div>

          </div>
        )}

        {/* SECTION 5: RESPONSABLE LEGAL, DECLARATION & SIGNATURE */}
        {activeSection === 'signature' && (
          <div className="space-y-6">
            <div className="border-b border-slate-200 pb-2">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                Rubrique 5 — RESPONSABLE LÉGAL, DÉCLARATION & SIGNATURE ÉLECTRONIQUE
              </h3>
              <p className="text-xs text-slate-500">
                Validation formelle de l exactitude des renseignements et engagement légal du représentant.
              </p>
            </div>

            {/* Coordonnées Responsable */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">
                  Nom et Prénom du responsable *
                </label>
                <input
                  type="text"
                  value={formData.legalGuardian.fullName}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      legalGuardian: { ...prev.legalGuardian, fullName: e.target.value },
                    }))
                  }
                  placeholder="Claire DUPONT"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">
                  Lien de parenté
                </label>
                <input
                  type="text"
                  value={formData.legalGuardian.relationship}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      legalGuardian: { ...prev.legalGuardian, relationship: e.target.value },
                    }))
                  }
                  placeholder="Mère, Père, Tuteur légal..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">
                  Téléphone portable *
                </label>
                <input
                  type="tel"
                  value={formData.legalGuardian.mobilePhone}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      legalGuardian: { ...prev.legalGuardian, mobilePhone: e.target.value },
                    }))
                  }
                  placeholder="06 12 34 56 78"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-bold text-slate-700 uppercase mb-1">
                  Adresse postale du domicile *
                </label>
                <input
                  type="text"
                  value={formData.legalGuardian.address}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      legalGuardian: { ...prev.legalGuardian, address: e.target.value },
                    }))
                  }
                  placeholder="14 rue des Alouettes, 75013 Paris"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase mb-1">
                  Adresse e-mail
                </label>
                <input
                  type="email"
                  value={formData.legalGuardian.email}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      legalGuardian: { ...prev.legalGuardian, email: e.target.value },
                    }))
                  }
                  placeholder="famille.dupont@email.fr"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs"
                />
              </div>
            </div>

            {/* Déclaration Sanitaire */}
            <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-lg space-y-3">
              <span className="font-bold text-xs text-blue-950 uppercase block">
                Déclaration d engagement (Formule obligatoire réglementaire)
              </span>
              <p className="text-xs text-blue-900 leading-relaxed italic">
                « Je soussigné(e) <strong>{formData.legalGuardian.fullName || '[Nom du responsable]'}</strong>, responsable légal de l enfant, déclare exacts les renseignements portés sur cette fiche et autorise le responsable du séjour à prendre, le cas échéant, toutes les mesures (traitement médical, hospitalisation, intervention chirurgicale) rendues nécessaires par l état de l enfant. »
              </p>

              <label className="flex items-center gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.declarationAccepted}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      declarationAccepted: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 rounded text-blue-900"
                />
                <span className="text-xs font-bold text-slate-900">
                  J atteste sur l honneur l exactitude des renseignements et valide la déclaration ci-dessus.
                </span>
              </label>
            </div>

            {/* Signature électronique manuscrite */}
            <div className="space-y-3">
              <label className="block text-xs font-bold uppercase text-slate-800">
                Signature électronique du responsable légal
              </label>

              <SignaturePad
                initialSignature={formData.signature.signatureDataUrl}
                signerName={formData.legalGuardian.fullName || authorName}
                onSave={(sigUrl) => {
                  setFormData((prev) => ({
                    ...prev,
                    signature: {
                      ...prev.signature,
                      signatureDataUrl: sigUrl,
                      signedByName: prev.legalGuardian.fullName || authorName,
                      signedDate: new Date().toISOString().substring(0, 10),
                      method: 'drawn',
                      uploadedBy: undefined,
                    },
                  }));
                }}
              />

              {/* Import d'une image de signature — réservé à l'administration */}
              {isAdminAuthor && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-2" data-testid="admin-signature-upload">
                  <div className="flex items-center gap-2 text-xs font-bold text-purple-900">
                    <Upload className="w-4 h-4" />
                    Importer une signature (réservé à l'administration)
                  </div>
                  <p className="text-[11px] text-purple-800 leading-relaxed">
                    Importez une image (PNG, JPEG ou WebP, 5 Mo maximum) de la signature du responsable légal, par exemple une signature scannée
                    sur un document papier. Elle remplace la signature tracée. Pensez à cocher l'attestation ci-dessus : elle vaut pour le
                    responsable légal dont vous détenez la signature.
                  </p>
                  <label className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white hover:bg-purple-100 text-purple-900 border border-purple-300 px-3 py-1.5 rounded-lg cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    Choisir une image…
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={handleAdminSignatureUpload}
                      data-testid="admin-signature-input"
                    />
                  </label>
                  {signatureUploadError && (
                    <p className="text-[11px] font-semibold text-red-700" role="alert">
                      {signatureUploadError}
                    </p>
                  )}
                  {formData.signature.method === 'uploaded' && formData.signature.signatureDataUrl && (
                    <p className="text-[11px] font-semibold text-emerald-800">
                      ✓ Signature importée par {formData.signature.uploadedBy || 'l\'administration'}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* BLOC DE CHOIX DES VOYAGES SCOLAIRES (Accessible uniquement au moment de la signature) */}
            <div className="mt-8 pt-6 border-t-2 border-slate-200">
              {!formData.signature.signatureDataUrl ? (
                <div className="p-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl flex items-center gap-3 text-xs text-slate-600">
                  <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-2xs shrink-0">
                    <Lock className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <span className="font-bold text-slate-800 block text-xs">
                      Choix du voyage scolaire (Disponible au moment de la signature)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Veuillez apposer votre signature électronique ci-dessus pour débloquer et sélectionner le voyage scolaire associé.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2 uppercase tracking-wide">
                        <Plane className="w-4 h-4 text-blue-700" />
                        Choix du séjour & Inscriptions aux voyages scolaires
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Signature validée. Sélectionnez le ou les voyages scolaires auxquels participe <strong>{formData.identity.firstName || student.cerfa.identity.firstName} {formData.identity.lastName || student.cerfa.identity.lastName}</strong> (Classe de {selectedClass}).
                      </p>
                    </div>
                    {selectedTripIds.length > 0 && (
                      <span className="self-start sm:self-auto bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1.5 shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        {selectedTripIds.length} séjour(s) retenu(s)
                      </span>
                    )}
                  </div>

                  {/* Liste des voyages scolaires compatibles avec la classe de l'élève */}
                  <div className="space-y-3">
                    {trips.filter((t) => t.eligibleClasses.length === 0 || t.eligibleClasses.includes(selectedClass)).length === 0 ? (
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center gap-3">
                        <Info className="w-4 h-4 text-blue-600 shrink-0" />
                        <span>Aucun voyage scolaire disponible pour la classe {selectedClass}.</span>
                      </div>
                    ) : (
                      trips
                        .filter((t) => t.eligibleClasses.length === 0 || t.eligibleClasses.includes(selectedClass))
                        .map((trip) => {
                        const isEnrolled = selectedTripIds.includes(trip.id);
                        return (
                          <div
                            key={trip.id}
                            className={`border rounded-xl p-4 transition-all ${
                              isEnrolled
                                ? 'bg-blue-50/70 border-blue-300 ring-1 ring-blue-300 shadow-xs'
                                : 'bg-white border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h5 className="font-bold text-sm text-slate-900">{trip.name}</h5>
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                                    ✓ Classe éligible
                                  </span>
                                  {isEnrolled && (
                                    <span className="bg-emerald-100 text-emerald-800 text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Fiche rattachée
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-600 leading-relaxed">{trip.description}</p>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 pt-0.5">
                                  <span className="flex items-center gap-1">
                                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                                    Destination : <strong className="text-slate-800 ml-0.5">{trip.destination}</strong>
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                    Du <strong>{formatDateFr(trip.startDate)}</strong> au <strong>{formatDateFr(trip.endDate)}</strong>
                                  </span>
                                  <span>
                                    Organisateur : <strong className="text-slate-800">{trip.organizerName}</strong>
                                  </span>
                                </div>
                              </div>

                              <div className="shrink-0 flex items-center gap-2">
                                {isEnrolled ? (
                                  <>
                                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 px-2.5 py-1.5 rounded-lg">
                                      <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                                      <span>Inscrit</span>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (window.confirm(`Supprimer l'inscription de cet élève au voyage "${trip.name}" ?`)) {
                                          handleToggleTrip(trip.id);
                                        }
                                      }}
                                      className="flex items-center gap-1.5 text-xs font-semibold bg-white hover:bg-red-50 text-red-600 hover:text-red-800 border border-red-200 hover:border-red-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-2xs"
                                      title="Supprimer cette inscription"
                                    >
                                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                                      <span>Supprimer l'inscription</span>
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleTrip(trip.id)}
                                    className="w-full md:w-auto flex items-center justify-center gap-1.5 text-xs font-semibold bg-blue-900 hover:bg-blue-800 text-white px-4 py-2 rounded-lg transition-colors cursor-pointer shadow-xs"
                                  >
                                    <Plus className="w-4 h-4" />
                                    <span>Inscrire à ce voyage</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

      </div>

      {/* Enregistrement de brouillon — toujours disponible, sur n'importe quelle page,
          pour ne jamais perdre sa progression même si la fiche n'est pas complète. */}
      {onSaveDraft && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={handleSaveDraftClick}
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-blue-900 bg-white hover:bg-blue-50 border border-slate-300 hover:border-blue-300 px-4 py-2 rounded-lg shadow-xs transition-colors cursor-pointer"
            title="Enregistre votre progression actuelle, même si la fiche n'est pas encore complète, pour la reprendre plus tard"
          >
            {draftJustSaved ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-emerald-700">Brouillon enregistré !</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4 text-slate-500" />
                <span>Enregistrer mon brouillon (reprendre plus tard)</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Bottom Step Navigation Bar (Flèches pour passer d'une page à l'autre) */}
      <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        {prevSection ? (
          <button
            type="button"
            onClick={() => handleGoToSection(prevSection.id)}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs transition-colors cursor-pointer shadow-xs"
            title={`Aller à la page précédente : ${prevSection.label}`}
          >
            <ArrowLeft className="w-4 h-4 text-slate-500" />
            <span>Page précédente : <strong>{prevSection.shortLabel}</strong></span>
          </button>
        ) : (
          <div className="text-xs text-slate-400 font-medium italic hidden sm:block">
            Première étape (Identité)
          </div>
        )}

        {/* Dots / Step progress */}
        <div className="flex items-center gap-3 text-slate-600 font-bold">
          <span className="text-sm text-slate-700">
            Étape {currentSectionIndex + 1} / {FORM_SECTIONS.length}
          </span>
          <div className="flex items-center gap-2">
            {FORM_SECTIONS.map((sec, idx) => (
              <button
                key={sec.id}
                type="button"
                onClick={() => handleGoToSection(sec.id)}
                title={`Aller à l'étape ${sec.label}`}
                className={`h-3 rounded-full transition-all cursor-pointer ${
                  sec.id === activeSection
                    ? 'bg-blue-900 w-9'
                    : idx < currentSectionIndex
                    ? 'bg-emerald-600 w-3 hover:w-4'
                    : 'bg-slate-300 hover:bg-slate-400 w-3'
                }`}
              />
            ))}
          </div>
        </div>

        {nextSection ? (
          <button
            type="button"
            onClick={() => handleGoToSection(nextSection.id)}
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg text-white font-bold transition-colors cursor-pointer shadow-xs ${
              nextSection.id === 'signature'
                ? 'px-6 py-3.5 text-sm bg-red-600 hover:bg-red-700 animate-pulse'
                : 'px-4 py-2.5 text-xs bg-blue-900 hover:bg-blue-950'
            }`}
            title={`Passer à la page suivante : ${nextSection.label}`}
          >
            <span>Page suivante : <strong>{nextSection.shortLabel}</strong></span>
            <ArrowRight className={nextSection.id === 'signature' ? 'w-5 h-5 text-white' : 'w-4 h-4 text-blue-200'} />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSaveForm}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs transition-colors cursor-pointer shadow-xs"
          >
            <span>Dernière étape • Valider</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-200" />
          </button>
        )}
      </div>

      {/* Save bar */}
      <div className="mt-4 bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex items-center justify-end gap-4">
        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors cursor-pointer"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSaveForm}
            className={`flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white rounded-lg shadow-xs transition-colors cursor-pointer ${
              !completeness.isComplete
                ? 'bg-amber-600 hover:bg-amber-700 ring-2 ring-amber-300'
                : 'bg-emerald-700 hover:bg-emerald-800'
            }`}
          >
            {!completeness.isComplete ? (
              <>
                <Lock className="w-4 h-4 text-amber-200" />
                <span>Enregistrement bloqué ({completeness.missingFields.length} manquant(s))</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                <span>Enregistrer la fiche sanitaire {completeness.isComplete ? 'validée (100%)' : ''}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Validation Blocked Modal for Parents */}
      {showTripRequiredModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-red-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5 text-red-600">
                <div className="p-2 bg-red-100 rounded-xl">
                  <Plane className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 leading-tight">
                    Enregistrement impossible
                  </h3>
                  <p className="text-xs text-red-600 font-semibold">
                    Vous devez choisir un voyage avant de pouvoir enregistrer
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowTripRequiredModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              L'établissement impose de sélectionner au moins un séjour scolaire avant de pouvoir enregistrer la fiche sanitaire.
              Rendez-vous dans la section « Inscriptions aux voyages scolaires » plus bas dans le formulaire pour en choisir un.
            </p>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowTripRequiredModal(false)}
                className="px-4 py-2 rounded-lg bg-blue-900 hover:bg-blue-950 text-white font-bold text-xs transition cursor-pointer"
              >
                Compris
              </button>
            </div>
          </div>
        </div>
      )}

      {showPostSaveReminderModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-red-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-2.5 text-red-600">
              <div className="p-2 bg-red-100 rounded-xl shrink-0">
                <ShieldAlert className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900 leading-tight">
                  Fiche enregistrée — action à faire
                </h3>
                <p className="text-xs text-red-600 font-semibold">
                  Merci de télécharger et remettre la fiche sanitaire
                </p>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 space-y-2.5">
              {trips
                .filter((t) => selectedTripIds.includes(t.id) && t.showPrintReminderBanner)
                .map((t) => {
                  const contacts = [t.contactTeacher1, t.contactTeacher2].filter((n) => n?.trim());
                  return (
                    <p key={t.id} className="text-xs text-red-900 leading-relaxed">
                      Pour le voyage <strong>« {t.name} »</strong>, veuillez <strong>télécharger le PDF</strong> de la fiche sanitaire (et le PAI si votre enfant en bénéficie), l'imprimer, puis la remettre à{' '}
                      {contacts.length > 0 ? (
                        <strong>{contacts.join(' ou ')}</strong>
                      ) : (
                        <strong>l'organisateur du séjour</strong>
                      )}
                      .
                    </p>
                  );
                })}
            </div>

            <p className="text-[11px] text-slate-500">
              Ce message réapparaîtra également en haut et en bas de la fiche officielle. Vous pourrez y télécharger le PDF à tout moment.
            </p>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setShowPostSaveReminderModal(false);
                  if (pendingSaveStudent) {
                    onSave(pendingSaveStudent);
                    setPendingSaveStudent(null);
                  }
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-xs cursor-pointer transition-colors inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>J'ai compris, continuer</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showValidationBlockedModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-red-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5 text-red-600">
                <div className="p-2 bg-red-100 rounded-xl">
                  <Lock className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 leading-tight">
                    Enregistrement impossible
                  </h3>
                  <p className="text-xs text-red-600 font-semibold">
                    Réglementation sanitaire — Champs obligatoires manquants
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowValidationBlockedModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Pour des raisons légales de responsabilité et de sécurité médicale des élèves lors des séjours scolaires,
              <strong> tous les champs obligatoires de la fiche sanitaire doivent être impérativement complétés</strong> avant de pouvoir enregistrer la fiche.
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 max-h-60 overflow-y-auto space-y-2">
              <span className="text-xs font-bold text-amber-900 block">
                Il vous reste {completeness.missingFields.length} élément(s) obligatoire(s) à compléter :
              </span>
              <ul className="space-y-1.5 text-xs text-amber-950">
                {completeness.missingFields.map((field, idx) => (
                  <li key={idx} className="flex items-start gap-2 bg-white/70 p-1.5 rounded border border-amber-200/60">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <span className="font-medium">{field}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-xs text-slate-500 font-medium">
                Complétude actuelle : <strong className="text-slate-800">{completeness.percent}%</strong>
              </span>
              <button
                type="button"
                onClick={() => setShowValidationBlockedModal(false)}
                className="px-5 py-2 text-xs font-bold text-white bg-blue-900 hover:bg-blue-950 rounded-lg shadow-xs cursor-pointer transition-colors"
              >
                Compléter maintenant
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
