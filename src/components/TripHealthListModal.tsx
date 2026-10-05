import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Student, Trip } from '../types';
import { formatDateFr } from '../utils/cerfaValidation';
import { exportToPdf } from '../utils/pdfGenerator';
import { getStoredEstablishmentName } from '../utils/storage';
import { openOrDownloadDocument } from '../utils/documentViewer';
import {
  Printer,
  Download,
  Loader2,
  X,
  FileSpreadsheet,
  AlertTriangle,
  Heart,
  Utensils,
  ShieldAlert,
  ArrowUpDown,
  Filter,
  CheckCircle2,
} from 'lucide-react';

interface TripHealthListModalProps {
  trip: Trip;
  students: Student[];
  onClose: () => void;
  initialSortMode?: 'alpha' | 'class';
}

export const TripHealthListModal: React.FC<TripHealthListModalProps> = ({
  trip,
  students,
  onClose,
  initialSortMode = 'alpha',
}) => {
  const [sortMode, setSortMode] = useState<'alpha' | 'class'>(initialSortMode);
  const [filterClass, setFilterClass] = useState<string>('all');
  const [filterPaiOnly, setFilterPaiOnly] = useState<boolean>(false);
  const [filterAllergiesOnly, setFilterAllergiesOnly] = useState<boolean>(false);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);
  const tableRef = useRef<HTMLDivElement>(null);

  // Filet de sécurité : permet de fermer avec la touche Échap si un clic
  // ne fonctionne pas (ex. focus resté ailleurs après une action précédente).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);


  const handleDownloadPdf = async () => {
    if (!tableRef.current) return;
    setIsExportingPdf(true);
    try {
      const sanitizedTripName = trip.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const sortLabel = sortMode === 'class' ? 'ParClasses' : 'Alpha';
      const filename = `Liste_Sanitaire_${sanitizedTripName}_${sortLabel}.pdf`;

      await exportToPdf(tableRef.current, {
        filename,
        orientation: 'landscape',
        marginMm: 6,
      });
    } catch (error) {
      console.error('Erreur export PDF:', error);
      window.print();
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Available classes in this trip's students
  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => set.add(s.schoolClass));
    return Array.from(set).sort();
  }, [students]);

  // Filtered list
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      if (filterClass !== 'all' && s.schoolClass !== filterClass) return false;
      const hasAllergy =
        s.cerfa.medicalInfo.allergies.alimentaires ||
        s.cerfa.medicalInfo.allergies.asthme ||
        s.cerfa.medicalInfo.allergies.medicamenteuses ||
        Boolean(s.cerfa.medicalInfo.allergies.autres?.trim());
      if (filterAllergiesOnly && !hasAllergy) return false;
      if (filterPaiOnly && !s.cerfa.medicalInfo.hasPai) return false;
      return true;
    });
  }, [students, filterClass, filterPaiOnly, filterAllergiesOnly]);

  // Sorted list
  const sortedStudents = useMemo(() => {
    const list = [...filteredStudents];
    if (sortMode === 'alpha') {
      return list.sort((a, b) => {
        const nameA = `${a.cerfa.identity.lastName} ${a.cerfa.identity.firstName}`.toLowerCase();
        const nameB = `${b.cerfa.identity.lastName} ${b.cerfa.identity.firstName}`.toLowerCase();
        return nameA.localeCompare(nameB, 'fr');
      });
    } else {
      // By Class, then by Name
      return list.sort((a, b) => {
        const classComp = a.schoolClass.localeCompare(b.schoolClass, 'fr');
        if (classComp !== 0) return classComp;
        const nameA = `${a.cerfa.identity.lastName} ${a.cerfa.identity.firstName}`.toLowerCase();
        const nameB = `${b.cerfa.identity.lastName} ${b.cerfa.identity.firstName}`.toLowerCase();
        return nameA.localeCompare(nameB, 'fr');
      });
    }
  }, [filteredStudents, sortMode]);

  // Grouped by class for class mode display
  const studentsByClass = useMemo(() => {
    const map: Record<string, Student[]> = {};
    sortedStudents.forEach((s) => {
      if (!map[s.schoolClass]) map[s.schoolClass] = [];
      map[s.schoolClass].push(s);
    });
    return map;
  }, [sortedStudents]);

  const handlePrint = () => {
    window.print();
  };

  const getDietLabel = (s: Student) => {
    const cat = s.cerfa.structuredDiet.category;
    const details = s.cerfa.structuredDiet.details;
    let label = 'Sans restriction';
    if (cat === 'sans_porc') label = 'Sans porc';
    else if (cat === 'sans_viande') label = 'Sans viande';
    else if (cat === 'vegetarien') label = 'Végétarien';
    else if (cat === 'allergie_alimentaire') label = 'Allergie alimentaire';

    return { label, details };
  };

  const getAllergyDetails = (s: Student) => {
    const med = s.cerfa.medicalInfo;
    const items: string[] = [];
    if (med.allergies.alimentaires) items.push('Alimentaire');
    if (med.allergies.asthme) items.push('Asthme');
    if (med.allergies.medicamenteuses) items.push('Médicaments');
    if (med.allergies.autres?.trim()) items.push(med.allergies.autres.trim());

    return {
      hasAllergy: items.length > 0,
      summary: items.join(', '),
      conduite: med.allergyCauseAndAction,
    };
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden print:p-0 print:border-none print:shadow-none print:max-w-none print:max-h-none print:static"
      >
        {/* Header - Screen only */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50 print:hidden shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-blue-900 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded">
                Générateur Organisateur
              </span>
              <h3 className="text-base sm:text-lg font-bold text-slate-900">
                Liste d'émargement & Suivi Sanitaire (Régimes, Allergies & PAI)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Voyage : <strong>{trip.name}</strong> • {trip.destination} • Du {formatDateFr(trip.startDate)} au {formatDateFr(trip.endDate)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="flex items-center gap-1.5 bg-blue-900 hover:bg-blue-950 text-white text-xs font-semibold px-3.5 py-2 rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              title="Générer et télécharger directement le document PDF"
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
              onClick={handlePrint}
              className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer"
              title="Imprimer"
            >
              <Printer className="w-4 h-4 text-slate-600" />
              <span>Imprimer</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Controls Bar - Screen only */}
        <div className="p-3 sm:p-4 bg-slate-100/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs print:hidden shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-700">Ordre d'affichage :</span>
              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => setSortMode('alpha')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    sortMode === 'alpha' ? 'bg-blue-900 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Ordre alphabétique (Nom A-Z)
                </button>
                <button
                  type="button"
                  onClick={() => setSortMode('class')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    sortMode === 'class' ? 'bg-blue-900 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Groupé par classe
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <label htmlFor="filter-class-modal" className="font-semibold text-slate-700">
                Classe :
              </label>
              <select
                id="filter-class-modal"
                value={filterClass}
                onChange={(e) => setFilterClass(e.target.value)}
                className="bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-800"
              >
                <option value="all">Toutes ({students.length})</option>
                {availableClasses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 font-medium">
              <input
                type="checkbox"
                checked={filterPaiOnly}
                onChange={(e) => setFilterPaiOnly(e.target.checked)}
                className="rounded text-blue-900 w-3.5 h-3.5"
              />
              <span>Uniquement PAI</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 font-medium">
              <input
                type="checkbox"
                checked={filterAllergiesOnly}
                onChange={(e) => setFilterAllergiesOnly(e.target.checked)}
                className="rounded text-blue-900 w-3.5 h-3.5"
              />
              <span>Uniquement Allergies</span>
            </label>
            <span className="text-slate-400">|</span>
            <span className="font-bold text-slate-800">{sortedStudents.length} élève(s)</span>
          </div>
        </div>

        {/* Printable Content View */}
        <div ref={tableRef} className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4 print:p-0 print:overflow-visible print:space-y-3 bg-white">
          {/* Official Report Header */}
          <div className="border-b-2 border-slate-800 pb-3 mb-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200 print:bg-transparent print:p-0 print:border-none print:border-b-2 print:rounded-none">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
                  {getStoredEstablishmentName()}
                </span>
                <h1 className="text-lg sm:text-xl font-black text-slate-900 uppercase mt-0.5">
                  LISTE OFFICIELLE DES ÉLÈVES INSCRITS & DONNÉES SANITAIRES
                </h1>
                <p className="text-xs text-slate-700 mt-1">
                  <strong>Voyage :</strong> {trip.name} • <strong>Destination :</strong> {trip.destination} • <strong>Dates :</strong> Du {formatDateFr(trip.startDate)} au {formatDateFr(trip.endDate)}
                </p>
              </div>
            </div>
          </div>

          {/* Table view */}
          {sortMode === 'alpha' ? (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs print:border-slate-800 print:rounded-none">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-800 border-b border-slate-200 font-bold uppercase text-[11px] print:bg-slate-200 print:text-black print:border-slate-800">
                    <th className="py-2.5 px-3 w-8 text-center">N°</th>
                    <th className="py-2.5 px-3">Élève (Nom & Prénom)</th>
                    <th className="py-2.5 px-2 text-center">Classe</th>
                    <th className="py-2.5 px-3">Régime alimentaire</th>
                    <th className="py-2.5 px-3">Allergies & Soins</th>
                    <th className="py-2.5 px-2 text-center">PAI</th>
                    <th className="py-2.5 px-3">Urgence (Responsable)</th>
                    <th className="py-2.5 px-2 text-center print:w-16 w-14">Émarg.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 print:divide-slate-400">
                  {sortedStudents.map((s, idx) => {
                    const diet = getDietLabel(s);
                    const allergy = getAllergyDetails(s);
                    const hasPai = s.cerfa.medicalInfo.hasPai;
                    const paiDoc = s.cerfa.documents.find((d) => d.type === 'pai');

                    return (
                      <tr
                        key={s.id}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          hasPai || allergy.hasAllergy ? 'bg-amber-50/40 print:bg-transparent' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 text-center text-slate-500 font-mono">{idx + 1}</td>
                        <td className="py-2.5 px-3">
                          <strong className="text-slate-900 block uppercase font-bold">
                            {s.cerfa.identity.lastName} {s.cerfa.identity.firstName}
                          </strong>
                          <span className="text-[10px] text-slate-500">
                            Né(e) le {formatDateFr(s.cerfa.identity.birthDate)} ({s.cerfa.identity.gender})
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className="font-bold text-slate-800 px-1.5 py-0.5 bg-slate-100 rounded text-[11px] border border-slate-200 print:border-none print:bg-transparent">
                            {s.schoolClass}
                          </span>
                          <span className="block text-[9px] text-slate-400 uppercase mt-0.5">{s.boardingStatus}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`font-semibold inline-block text-[11px] ${
                              diet.label !== 'Standard' ? 'text-blue-900 font-bold' : 'text-slate-700'
                            }`}
                          >
                            {diet.label}
                          </span>
                          {diet.details && (
                            <span className="block text-[10px] text-slate-500 italic mt-0.5 leading-tight">
                              {diet.details}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {allergy.hasAllergy ? (
                            <div>
                              <span className="font-bold text-red-800 text-[11px] bg-red-100 px-1.5 py-0.5 rounded inline-block print:bg-transparent print:p-0">
                                ⚠ {allergy.summary}
                              </span>
                              {allergy.conduite && (
                                <p className="text-[10px] text-red-900 mt-0.5 leading-tight">
                                  {allergy.conduite}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">Néant</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          {hasPai ? (
                            <div>
                              <span className="bg-red-700 text-white font-bold text-[10px] px-2 py-0.5 rounded uppercase print:border print:border-red-900 print:text-red-900 print:bg-transparent">
                                OUI
                              </span>
                              {paiDoc && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    openOrDownloadDocument(
                                      paiDoc,
                                      `${s.cerfa.identity.firstName} ${s.cerfa.identity.lastName}`
                                    )
                                  }
                                  className="block text-[9px] text-red-800 hover:text-red-950 font-semibold underline mt-0.5 print:no-underline print:text-slate-500 cursor-pointer mx-auto"
                                  title="Consulter le PAI"
                                >
                                  ✓ Consulter PAI
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <strong className="text-slate-800 text-[11px] block">
                            {s.cerfa.legalGuardian.fullName || '—'}
                          </strong>
                          <span className="font-mono text-emerald-800 text-[11px] block font-bold">
                            {s.cerfa.legalGuardian.mobilePhone || s.cerfa.legalGuardian.homePhone || 'Non renseigné'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <div className="w-5 h-5 mx-auto border border-slate-300 rounded print:border-slate-800 print:w-5 print:h-5"></div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            // Grouped by Class
            <div className="space-y-6">
              {(Object.entries(studentsByClass) as [string, Student[]][]).map(([className, classStudents]) => (
                <div
                  key={className}
                  className="border border-slate-200 rounded-xl overflow-hidden shadow-xs print:border-slate-800 print:rounded-none"
                >
                  <div className="bg-slate-200 px-4 py-2 flex justify-between items-center print:bg-slate-300">
                    <h4 className="font-black text-slate-900 uppercase text-xs">
                      Classe : {className} ({classStudents.length} élèves inscrits)
                    </h4>
                    <span className="text-[11px] font-semibold text-slate-700">
                      PAI : {classStudents.filter((s) => s.cerfa.medicalInfo.hasPai).length} • Allergies :{' '}
                      {
                        classStudents.filter(
                          (s) =>
                            s.cerfa.medicalInfo.allergies.alimentaires ||
                            s.cerfa.medicalInfo.allergies.asthme ||
                            s.cerfa.medicalInfo.allergies.medicamenteuses
                        ).length
                      }
                    </span>
                  </div>

                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-700 border-b border-slate-200 font-bold uppercase text-[10px]">
                        <th className="py-2 px-3 w-8 text-center">N°</th>
                        <th className="py-2 px-3">Élève</th>
                        <th className="py-2 px-3">Régime alimentaire</th>
                        <th className="py-2 px-3">Allergies & Soins</th>
                        <th className="py-2 px-2 text-center">PAI</th>
                        <th className="py-2 px-3">Contact urgence</th>
                        <th className="py-2 px-2 text-center w-14">Émarg.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 print:divide-slate-400">
                      {classStudents.map((s, idx) => {
                        const diet = getDietLabel(s);
                        const allergy = getAllergyDetails(s);
                        const hasPai = s.cerfa.medicalInfo.hasPai;

                        return (
                          <tr
                            key={s.id}
                            className={`${hasPai || allergy.hasAllergy ? 'bg-amber-50/40 print:bg-transparent' : ''}`}
                          >
                            <td className="py-2 px-3 text-center text-slate-500 font-mono">{idx + 1}</td>
                            <td className="py-2 px-3">
                              <strong className="text-slate-900 block uppercase font-bold text-[11px]">
                                {s.cerfa.identity.lastName} {s.cerfa.identity.firstName}
                              </strong>
                              <span className="text-[10px] text-slate-500">
                                {s.boardingStatus} • Né(e) {formatDateFr(s.cerfa.identity.birthDate)}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              <span
                                className={`font-semibold text-[11px] ${
                                  diet.label !== 'Standard' ? 'text-blue-900 font-bold' : 'text-slate-700'
                                }`}
                              >
                                {diet.label}
                              </span>
                              {diet.details && (
                                <span className="block text-[10px] text-slate-500 italic leading-tight">
                                  {diet.details}
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3">
                              {allergy.hasAllergy ? (
                                <div>
                                  <span className="font-bold text-red-800 text-[10px] bg-red-100 px-1 py-0.2 rounded inline-block print:bg-transparent">
                                    ⚠ {allergy.summary}
                                  </span>
                                  {allergy.conduite && (
                                    <p className="text-[10px] text-red-900 mt-0.5 leading-tight">
                                      {allergy.conduite}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400 text-[11px]">Néant</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-center">
                              {hasPai ? (
                                <span className="bg-red-700 text-white font-bold text-[9px] px-1.5 py-0.5 rounded uppercase print:border print:border-red-900 print:text-red-900 print:bg-transparent">
                                  OUI
                                </span>
                              ) : (
                                <span className="text-slate-400 text-xs">—</span>
                              )}
                            </td>
                            <td className="py-2 px-3">
                              <span className="text-slate-800 text-[11px] block">
                                {s.cerfa.legalGuardian.fullName}
                              </span>
                              <span className="font-mono text-emerald-800 text-[11px] font-bold">
                                {s.cerfa.legalGuardian.mobilePhone || '—'}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-center">
                              <div className="w-5 h-5 mx-auto border border-slate-300 rounded print:border-slate-800"></div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {/* Footer signature on print */}
          <div className="hidden print:flex justify-between items-end pt-6 text-xs text-slate-700">
            <div>
              <p>Document officiel établi pour le bon déroulement du séjour scolaire.</p>
              <p className="text-[10px] text-slate-500">
                Conservé par le responsable du séjour avec la trousse de premier secours.
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer - Screen only */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs print:hidden shrink-0">
          <span className="text-slate-500">
            Astuce : vous pouvez choisir l'orientation <strong>Paysage</strong> dans la boîte de dialogue d'impression pour un affichage optimal des colonnes de santé.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Fermer
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white font-semibold rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {isExportingPdf ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Génération PDF...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Télécharger le PDF (.pdf)</span>
                </>
              )}
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-lg border border-slate-300 transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4 text-slate-600" />
              <span>Imprimer</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
