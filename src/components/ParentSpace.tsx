import React, { useState, useEffect } from 'react';
import { Student, Trip, User, SchoolClass } from '../types';
import { formatDateFr } from '../utils/cerfaValidation';
import { openOrDownloadDocument } from '../utils/documentViewer';
import { checkStudentDuplicate } from '../utils/storage';
import {
  UserPlus,
  FileText,
  Eye,
  Edit,
  CheckCircle,
  AlertTriangle,
  Plane,
  Download,
  History,
  ShieldCheck,
  PlusCircle,
  Calendar,
  Layers,
  Trash2,
  X,
} from 'lucide-react';

interface ParentSpaceProps {
  currentUser: User;
  students: Student[];
  trips: Trip[];
  classes: SchoolClass[];
  onSelectStudentToEdit: (student: Student) => void;
  onSelectStudentToView: (student: Student) => void;
  onAddStudent: (newStudentData: {
    firstName: string;
    lastName: string;
    birthDate: string;
    gender: 'Garcon' | 'Fille';
    schoolClass: string;
    boardingStatus: 'DP' | 'Externe' | 'Interne';
  }) => void;
  onRegisterTrip: (studentId: string, tripId: string) => void;
  onUnregisterTrip: (studentId: string, tripId: string) => void;
}

export const ParentSpace: React.FC<ParentSpaceProps> = ({
  currentUser,
  students,
  trips,
  classes,
  onSelectStudentToEdit,
  onSelectStudentToView,
  onAddStudent,
  onRegisterTrip,
  onUnregisterTrip,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedStudentForHistory, setSelectedStudentForHistory] = useState<Student | null>(null);
  const [tripToUnregister, setTripToUnregister] = useState<{ studentId: string; studentName: string; trip: Trip } | null>(null);
  const [studentForEnrollment, setStudentForEnrollment] = useState<Student | null>(null);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newBirthDate, setNewBirthDate] = useState('');
  const [newGender, setNewGender] = useState<'Garcon' | 'Fille'>('Garcon');
  const [newClass, setNewClass] = useState('');
  const [newPension, setNewPension] = useState<'DP' | 'Externe' | 'Interne'>('DP');
  const [dupInfo, setDupInfo] = useState<{ duplicate: boolean; sameAccount: boolean } | null>(null);

  // Contrôle en direct des doublons dès que prénom + nom sont saisis (étape 1)
  useEffect(() => {
    if (!showAddModal || !newFirstName.trim() || !newLastName.trim()) {
      setDupInfo(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const r = await checkStudentDuplicate(newFirstName, newLastName, currentUser.id);
      if (!cancelled) setDupInfo(r);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showAddModal, newFirstName, newLastName, currentUser.id]);

  // Filter students belonging to this parent account
  const myChildren = students.filter((s) => Boolean(currentUser.id) && s.parentId === currentUser.id);

  const handleCreateChild = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFirstName.trim() || !newLastName.trim()) return;
    if (dupInfo?.duplicate) return;

    onAddStudent({
      firstName: newFirstName.trim(),
      lastName: newLastName.trim(),
      birthDate: newBirthDate,
      gender: newGender,
      schoolClass: newClass,
      boardingStatus: newPension,
    });

    setNewFirstName('');
    setNewLastName('');
    setNewBirthDate('');
    setNewClass('');
    setShowAddModal(false);
  };

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 space-y-8">
      
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-blue-900 to-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="inline-block bg-blue-800 text-blue-200 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-md mb-2">
              Espace Famille & Responsables Légaux
            </span>
            <h2 className="text-2xl font-bold tracking-tight">
              Fiches sanitaires — Bienvenue, {currentUser.name}
            </h2>
            <p className="text-blue-200 text-sm mt-1 max-w-2xl">
              Gérez les fiches sanitaires de liaison de vos enfants, inscrivez-les aux voyages scolaires et mettez à jour leurs renseignements médicaux à tout moment.
            </p>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl font-semibold text-xs shadow-md transition-all shrink-0 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            + Ajouter un enfant
          </button>
        </div>
      </div>

      {/* Children List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <span>Mes enfants ({myChildren.length})</span>
            </h3>
            <p className="text-xs text-slate-500">
              Chaque enfant dispose d une fiche individuelle distincte et entièrement modifiable.
            </p>
          </div>
        </div>

        {myChildren.length === 0 ? (
          <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl p-8">
            <p className="text-slate-600 text-sm">Aucun enfant n est encore rattaché à votre compte.</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 inline-flex items-center gap-2 text-xs font-semibold bg-blue-900 text-white px-4 py-2 rounded-lg"
            >
              <UserPlus className="w-4 h-4" /> Ajouter mon premier enfant
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {myChildren.map((child) => {
              const isComplete = child.status === 'complete';
              const enrolledTrips = trips.filter((t) => child.registeredTripIds.includes(t.id));
              const availableTripsForChild = trips.filter(
                (t) =>
                  !child.registeredTripIds?.includes(t.id) &&
                  (t.eligibleClasses.length === 0 || t.eligibleClasses.includes(child.schoolClass))
              );

              return (
                <div
                  key={child.id}
                  className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                >
                  <div>
                    {/* Header Card */}
                    <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                      <div>
                        <h4 className="font-bold text-base text-slate-900 leading-tight">
                          {child.cerfa.identity.firstName} {child.cerfa.identity.lastName}
                        </h4>
                        <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 font-medium">
                          <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded font-mono">
                            {child.schoolClass}
                          </span>
                          <span>•</span>
                          <span>{child.boardingStatus === 'DP' ? 'Demi-pensionnaire' : 'Externe'}</span>
                        </div>
                      </div>

                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                          isComplete
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }`}
                      >
                        {isComplete ? '✓ Complète' : `⚠ ${child.completenessPercent}%`}
                      </span>
                    </div>

                    {/* Progress details */}
                    <div className="mt-3 space-y-2 text-xs">
                      <div>
                        <div className="flex justify-between text-slate-600 mb-1">
                          <span>État de complétude :</span>
                          <strong className="text-slate-900">{child.completenessPercent}%</strong>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-2 rounded-full ${
                              child.completenessPercent >= 90
                                ? 'bg-emerald-500'
                                : child.completenessPercent >= 60
                                ? 'bg-amber-500'
                                : 'bg-red-500'
                            }`}
                            style={{ width: `${child.completenessPercent}%` }}
                          ></div>
                        </div>
                      </div>

                      <div className="pt-2 text-[11px] text-slate-600 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span>Régime déclaré :</span>
                          <span className="font-semibold text-slate-800">
                            {child.cerfa.structuredDiet.category.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Signature légale :</span>
                          <span className={child.cerfa.signature.signatureDataUrl ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-medium'}>
                            {child.cerfa.signature.signatureDataUrl ? `Version ${child.cerfa.signature.version || 1} validée` : 'Non signée'}
                          </span>
                        </div>
                        
                        {/* PAI & Pièces jointes direct access */}
                        {child.cerfa.medicalInfo.hasPai && (
                          <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-red-900 flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                PAI Actif
                              </span>
                              {child.cerfa.documents.filter(d => d.type === 'pai').length > 0 ? (
                                <span className="text-[10px] bg-red-100 text-red-800 font-bold px-1.5 py-0.5 rounded">
                                  Doc joint
                                </span>
                              ) : (
                                <span className="text-[10px] text-red-600 italic">
                                  En attente du doc
                                </span>
                              )}
                            </div>
                            {child.cerfa.documents.filter(d => d.type === 'pai').map((d) => (
                              <button
                                key={d.id}
                                type="button"
                                onClick={() => openOrDownloadDocument(d, `${child.cerfa.identity.firstName} ${child.cerfa.identity.lastName}`)}
                                className="w-full flex items-center justify-between bg-white hover:bg-red-100 text-red-900 border border-red-200 px-2 py-1 rounded text-[11px] font-semibold transition cursor-pointer"
                                title="Télécharger ou consulter le PAI officiel"
                              >
                                <span className="truncate max-w-[150px]">{d.name}</span>
                                <span className="flex items-center gap-1 text-[10px] text-red-700 shrink-0">
                                  <Download className="w-3 h-3" /> Consulter
                                </span>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Other documents */}
                        <div className="flex items-center justify-between">
                          <span>Documents joints :</span>
                          <span className="text-slate-800 font-medium">{child.cerfa.documents.length} fichier(s)</span>
                        </div>

                        {child.cerfa.documents.filter(d => d.type !== 'pai').length > 0 && (
                          <div className="space-y-1 pt-1">
                            {child.cerfa.documents.filter(d => d.type !== 'pai').map((d) => (
                              <button
                                key={d.id}
                                type="button"
                                onClick={() => openOrDownloadDocument(d, `${child.cerfa.identity.firstName} ${child.cerfa.identity.lastName}`)}
                                className="w-full flex items-center justify-between bg-slate-50 hover:bg-slate-100 text-slate-800 border border-slate-200 px-2 py-1 rounded text-[10px] font-medium transition cursor-pointer"
                                title="Consulter la pièce jointe"
                              >
                                <span className="truncate max-w-[150px]">{d.name}</span>
                                <span className="flex items-center gap-1 text-[9px] text-blue-800 shrink-0">
                                  <Download className="w-2.5 h-2.5" /> Voir
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Trips section */}
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1">
                            <Plane className="w-3.5 h-3.5 text-blue-600" />
                            Voyages scolaires ({enrolledTrips.length})
                          </span>
                          {availableTripsForChild.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setStudentForEnrollment(child)}
                              className="text-xs bg-red-600 hover:bg-red-700 text-white font-bold flex items-center gap-1 cursor-pointer px-2.5 py-1.5 rounded-lg shadow-xs transition-colors"
                              title="Inscrire à un voyage scolaire"
                            >
                              <PlusCircle className="w-4 h-4" />
                              <span>Choix du séjour</span>
                            </button>
                          )}
                        </div>

                        {enrolledTrips.length === 0 ? (
                          <div className="text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
                            <span className="italic">Aucun voyage inscrit</span>
                            {availableTripsForChild.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setStudentForEnrollment(child)}
                                className="w-full sm:w-auto text-sm bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-lg shadow-xs transition cursor-pointer"
                              >
                                Choisir un séjour
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {enrolledTrips.map((t) => (
                              <div
                                key={t.id}
                                className="bg-blue-50/80 border border-blue-200 rounded-lg p-2 text-[11px] flex items-center justify-between gap-2 shadow-2xs"
                              >
                                <div className="truncate flex-1">
                                  <span className="font-bold text-blue-950 block truncate">
                                    {t.name}
                                  </span>
                                  <span className="text-blue-700 text-[10px]">
                                    {t.destination} • {formatDateFr(t.startDate)}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setTripToUnregister({
                                      studentId: child.id,
                                      studentName: `${child.cerfa.identity.firstName} ${child.cerfa.identity.lastName}`,
                                      trip: t,
                                    })
                                  }
                                  className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-red-600 hover:text-red-800 bg-white hover:bg-red-50 border border-red-200 hover:border-red-300 px-2 py-1 rounded transition cursor-pointer"
                                  title="Supprimer cette inscription au voyage"
                                >
                                  <Trash2 className="w-3 h-3 text-red-500" />
                                  <span>Supprimer</span>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="mt-5 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
                    <button
                      onClick={() => onSelectStudentToView(child)}
                      className="flex items-center justify-center gap-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 py-2 rounded-lg font-semibold transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Voir la fiche
                    </button>
                    <button
                      onClick={() => onSelectStudentToEdit(child)}
                      className="flex items-center justify-center gap-1 bg-blue-900 hover:bg-blue-950 text-white py-2 rounded-lg font-semibold transition-colors"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      {isComplete ? 'Modifier' : 'Compléter'}
                    </button>

                    <button
                      onClick={() => setSelectedStudentForHistory(child)}
                      className="col-span-2 text-[11px] text-slate-500 hover:text-slate-800 flex items-center justify-center gap-1 py-1"
                    >
                      <History className="w-3 h-3" />
                      Consulter l historique des versions
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: Add Child */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-blue-700" />
              Ajouter un enfant
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Renseignez l identité de base pour créer sa fiche sanitaire individuelle.
            </p>

            <form onSubmit={handleCreateChild} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">
                    Prénom *
                  </label>
                  <input
                    type="text"
                    required
                    value={newFirstName}
                    onChange={(e) => setNewFirstName(e.target.value)}
                    placeholder="Ex : Lucas"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">
                    Nom de famille *
                  </label>
                  <input
                    type="text"
                    required
                    value={newLastName}
                    onChange={(e) => setNewLastName(e.target.value.toUpperCase())}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">
                    Date de naissance *
                  </label>
                  <input
                    type="date"
                    required
                    value={newBirthDate}
                    onChange={(e) => setNewBirthDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">
                    Sexe *
                  </label>
                  <select
                    value={newGender}
                    onChange={(e) => setNewGender(e.target.value as any)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                  >
                    <option value="Garcon">Garçon</option>
                    <option value="Fille">Fille</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">
                    Classe
                  </label>
                  <select
                    required
                    value={newClass}
                    onChange={(e) => setNewClass(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                  >
                    <option value="">-- Choisir la classe --</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase mb-1">
                    Régime de pension
                  </label>
                  <select
                    value={newPension}
                    onChange={(e) => setNewPension(e.target.value as any)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                  >
                    <option value="DP">Demi-pensionnaire (DP)</option>
                    <option value="Externe">Externe</option>
                    <option value="Interne">Interne</option>
                  </select>
                </div>
              </div>

              {dupInfo?.duplicate && (
                <div className="rounded-xl border-2 border-red-300 bg-red-50 p-3 text-red-800 leading-relaxed" role="alert">
                  <p className="font-bold mb-1">
                    {dupInfo.sameAccount
                      ? "⚠ Cet enfant figure déjà dans votre compte."
                      : "⚠ Une fiche sanitaire existe déjà pour cet élève."}
                  </p>
                  <p>
                    {dupInfo.sameAccount
                      ? "Retrouvez-le dans « Mes enfants » pour compléter ou consulter sa fiche. Inutile d'en créer une seconde."
                      : "Merci de ne pas continuer : il n'y a qu'une seule fiche par élève et la signature d'un seul responsable légal est nécessaire. Si l'autre responsable l'a déjà remplie, il n'y a rien de plus à faire. Pour la consulter ou la modifier, connectez-vous avec le compte utilisé pour la créer, ou contactez l'établissement."}
                  </p>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 font-semibold"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={!!dupInfo?.duplicate}
                  className="px-5 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-lg font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Créer la fiche
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: History and Versions */}
      {selectedStudentForHistory && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <History className="w-5 h-5 text-blue-700" />
                  Historique des modifications — {selectedStudentForHistory.cerfa.identity.firstName} {selectedStudentForHistory.cerfa.identity.lastName}
                </h3>
                <span className="text-xs text-slate-500">Traçabilité complète des révisions et signatures</span>
              </div>
              <button
                onClick={() => setSelectedStudentForHistory(null)}
                className="text-xs text-slate-500 hover:text-slate-800 p-1"
              >
                Fermer
              </button>
            </div>

            {/* Versions */}
            <div className="mb-4">
              <h4 className="text-xs font-bold uppercase text-slate-700 mb-2">
                Versions officielles archivées
              </h4>
              {selectedStudentForHistory.cerfa.versions.length === 0 ? (
                <div className="text-xs text-slate-400 italic">Aucune version archivée pour l instant.</div>
              ) : (
                <div className="space-y-2">
                  {selectedStudentForHistory.cerfa.versions.map((v, i) => (
                    <div key={i} className="p-2.5 bg-blue-50/60 border border-blue-200 rounded-lg text-xs flex justify-between items-center">
                      <div>
                        <strong className="text-blue-950">Version {v.versionNumber}</strong>
                        <span className="text-slate-600 block text-[11px]">{v.summary}</span>
                      </div>
                      <div className="text-right text-[11px] text-slate-500">
                        <span>Signée le {v.signedDate}</span>
                        <span className="block text-[10px]">par {v.signedBy}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modifications trail */}
            <div>
              <h4 className="text-xs font-bold uppercase text-slate-700 mb-2">
                Journal des actions
              </h4>
              <table className="w-full text-xs text-left border border-slate-200">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="p-2 border-b">Date</th>
                    <th className="p-2 border-b">Modification</th>
                    <th className="p-2 border-b">Auteur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedStudentForHistory.cerfa.history.map((h) => (
                    <tr key={h.id}>
                      <td className="p-2 text-slate-500 font-mono text-[11px]">{h.date}</td>
                      <td className="p-2 font-medium text-slate-900">{h.action}</td>
                      <td className="p-2 text-slate-600">{h.authorName} ({h.authorRole})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      )}

      {/* Modal: Confirmation de suppression de l'inscription au voyage */}
      {tripToUnregister && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-red-600 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Supprimer l'inscription ?
                </h3>
                <p className="text-xs text-slate-500">
                  Voyage : <strong>{tripToUnregister.trip.name}</strong>
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4">
              Voulez-vous retirer l'inscription de <strong>{tripToUnregister.studentName}</strong> pour le voyage à <strong>{tripToUnregister.trip.destination}</strong> ? La fiche sanitaire de l'élève restera conservée mais l'enfant ne figurera plus dans la liste des participants de ce séjour.
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTripToUnregister(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  onUnregisterTrip(tripToUnregister.studentId, tripToUnregister.trip.id);
                  setTripToUnregister(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Confirmer la suppression</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Inscrire l'enfant à un voyage scolaire */}
      {studentForEnrollment && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Plane className="w-5 h-5 text-blue-900" />
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Inscrire à un voyage scolaire
                  </h3>
                  <p className="text-xs text-slate-500">
                    Élève : <strong>{studentForEnrollment.cerfa.identity.firstName} {studentForEnrollment.cerfa.identity.lastName}</strong> ({studentForEnrollment.schoolClass})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStudentForEnrollment(null)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {trips
                .filter((t) => !studentForEnrollment.registeredTripIds?.includes(t.id))
                .filter((t) => t.eligibleClasses.length === 0 || t.eligibleClasses.includes(studentForEnrollment.schoolClass))
                .map((t) => {
                  return (
                    <div
                      key={t.id}
                      className="p-3 border border-slate-200 rounded-xl hover:border-blue-300 bg-white flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-slate-900">{t.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-100 text-emerald-800">
                            ✓ Classe éligible
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {t.destination} • Du {formatDateFr(t.startDate)} au {formatDateFr(t.endDate)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onRegisterTrip(studentForEnrollment.id, t.id);
                          setStudentForEnrollment(null);
                        }}
                        className="shrink-0 text-xs bg-blue-900 hover:bg-blue-950 text-white font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer"
                      >
                        Inscrire
                      </button>
                    </div>
                  );
                })}
              {trips
                .filter((t) => !studentForEnrollment.registeredTripIds?.includes(t.id))
                .filter((t) => t.eligibleClasses.length === 0 || t.eligibleClasses.includes(studentForEnrollment.schoolClass))
                .length === 0 && (
                <div className="p-4 text-center text-xs text-slate-500 italic">
                  Aucun voyage disponible pour la classe de cet élève ({studentForEnrollment.schoolClass}).
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setStudentForEnrollment(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
