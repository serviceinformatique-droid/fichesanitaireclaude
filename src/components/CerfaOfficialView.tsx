import React, { useState, useRef } from 'react';
import { Student, Trip } from '../types';
import {
  formatDateFr,
  formatDateTimeFr,
  computeCerfaCompleteness,
  getFirstIncompleteSectionId,
  FormSectionId,
} from '../utils/cerfaValidation';
import { exportSinglePagePdf } from '../utils/pdfGenerator';
import { openOrDownloadDocument } from '../utils/documentViewer';
import {
  ArrowLeft,
  Edit3,
  ShieldAlert,
  CheckCircle,
  FileCheck,
  Download,
  Loader2,
  Plane,
  Eye,
  X,
  Trash2,
  Utensils,
  AlertTriangle,
} from 'lucide-react';

console.log('[fichesanitaire] build draft-watermark-20261001');

interface CerfaOfficialViewProps {
  student: Student;
  trips?: Trip[];
  canEdit?: boolean;
  onEdit?: (section?: FormSectionId) => void;
  onBack: () => void;
  establishmentName?: string;
  onUnregisterTrip?: (studentId: string, tripId: string) => void;
  onRegisterTrip?: (studentId: string, tripId: string) => void;
}

export const CerfaOfficialView: React.FC<CerfaOfficialViewProps> = ({
  student,
  trips = [],
  canEdit = true,
  onEdit,
  onBack,
  establishmentName,
  onUnregisterTrip,
  onRegisterTrip,
}) => {
  const { cerfa } = student;
  const isSigned = Boolean(cerfa.signature.signatureDataUrl && cerfa.signature.signedByName);

  // Une fiche est un BROUILLON tant qu'elle n'est pas finalisee (signature electronique
  // + declaration + champs obligatoires). Le PDF/l'impression ne doivent alors jamais
  // pouvoir passer pour une fiche valable.
  const completeness = computeCerfaCompleteness(cerfa);
  const isDraft = student.status !== 'complete' && !completeness.isComplete;
  const targetSection = getFirstIncompleteSectionId(cerfa);
  const enrolledTrips = (trips || []).filter((t) => student.registeredTripIds?.includes(t.id));

  // Voyage(s) demandant explicitement la remise papier de la fiche + du PAI
  // (déclenché uniquement par la case "Afficher le message de remise des
  // documents" cochée dans les paramètres du voyage)
  const tripsRequiringHandoff = enrolledTrips.filter((t) => t.showPrintReminderBanner);

  const handoffBanner = tripsRequiringHandoff.length > 0 && (
    <div className="mb-4 p-4 bg-red-600 text-white rounded-xl shadow-md flex items-start gap-3 print:hidden">
      <ShieldAlert className="w-6 h-6 shrink-0 mt-0.5" />
      <div className="text-sm leading-relaxed">
        <strong className="block font-bold mb-1">
          Action obligatoire : merci d'imprimer et de remettre vos documents
        </strong>
        {tripsRequiringHandoff.map((t) => {
          const contacts = [t.contactTeacher1, t.contactTeacher2].filter((n) => n?.trim());
          return (
            <p key={t.id} className="mt-1">
              Pour le voyage <strong>« {t.name} »</strong>, veuillez imprimer la fiche sanitaire de liaison
              {' '}(et le PAI si votre enfant en bénéficie), puis remettre ces documents à{' '}
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
    </div>
  );

  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const documentRef = useRef<HTMLDivElement>(null);

  const handleDownloadPdf = async () => {
    if (!documentRef.current) return;
    setIsExportingPdf(true);
    try {
      const sanitizedName = `${cerfa.identity.lastName}_${cerfa.identity.firstName}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const ok = await exportSinglePagePdf(documentRef.current, {
        filename: `${isDraft ? 'BROUILLON_' : ''}CERFA_Fiche_Sanitaire_${sanitizedName}.pdf`,
        orientation: 'portrait',
        marginMm: 4,
      });
      if (!ok) {
        window.print();
      }
    } catch (error) {
      console.error('Erreur export PDF:', error);
      window.print();
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto py-6 px-4 sm:px-6 print:max-w-none print:w-full print:p-0 print:m-0">
      {/* Bannière rouge : rappel de remise papier de la fiche sanitaire + PAI */}
      {handoffBanner}

      {/* Top Action Bar (hidden when printing) */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs print:hidden">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            Fiche de : <strong className="text-slate-900">{cerfa.identity.firstName} {cerfa.identity.lastName}</strong>
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${
            student.status === 'complete'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}>
            {student.status === 'complete' ? '✓ Complète (100%)' : `⚠ Brouillon – incomplète (${student.completenessPercent}%)`}
          </span>
          <span className="bg-blue-50 text-blue-800 text-xs px-2 py-0.5 rounded-full border border-blue-200 font-mono">
            v{cerfa.signature.version || 1}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {canEdit && onEdit ? (
            <button
              onClick={() => onEdit?.()}
              className="flex items-center gap-1.5 text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 px-3 py-2 rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <Edit3 className="w-4 h-4 text-blue-700" />
              Modifier la fiche
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200">
              Consultation seule
            </span>
          )}
          <button
            onClick={handleDownloadPdf}
            disabled={isExportingPdf}
            className="flex items-center gap-1.5 text-xs font-semibold bg-blue-900 hover:bg-blue-950 text-white px-3.5 py-2 rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            title="Télécharger le fichier PDF officiel CERFA"
          >
            {isExportingPdf ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Génération PDF...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Télécharger PDF (.pdf)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {isDraft && (
        <div
          className="mb-4 p-4 bg-red-50 border-2 border-red-400 rounded-xl text-red-900 text-sm flex items-start gap-3 print:hidden"
          role="alert"
          data-testid="draft-banner"
        >
          <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="font-bold">
              Cette fiche n'est PAS finalisée : le PDF téléchargé ou imprimé porte la mention « BROUILLON – NON SIGNÉE » et n'est pas valable en l'état.
            </p>
            {completeness.missingFields.length > 0 && (
              <div>
                <p className="font-semibold">Il manque encore :</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {completeness.missingFields.slice(0, 8).map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                  {completeness.missingFields.length > 8 && (
                    <li>… et {completeness.missingFields.length - 8} autre(s) point(s)</li>
                  )}
                </ul>
              </div>
            )}
            <p className="text-xs text-red-800">
              Une seule fiche par élève et la signature électronique d'un seul responsable légal suffisent : il n'y a pas de seconde signature à apporter.
            </p>
            {canEdit && onEdit && (
              <button
                onClick={() => onEdit(targetSection)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white px-3.5 py-2 rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                <Edit3 className="w-4 h-4" />
                {targetSection === 'signature' ? 'Aller à la signature' : 'Compléter la fiche'}
              </button>
            )}
          </div>
        </div>
      )}
      {/* Official CERFA Document Sheet */}
      <div ref={documentRef} className="relative print-full-page bg-white border-2 border-slate-800 p-6 sm:p-8 rounded-none shadow-sm print:border-0 print:p-2 print:shadow-none font-sans text-slate-900 w-full">
        {isDraft && (
          <div
            aria-hidden="true"
            data-testid="draft-watermark"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              pointerEvents: 'none',
              zIndex: 20,
            }}
          >
            <div
              style={{
                transform: 'rotate(-28deg)',
                textAlign: 'center',
                color: 'rgba(220, 38, 38, 0.22)',
                fontWeight: 900,
                lineHeight: 1.05,
                border: '6px solid rgba(220, 38, 38, 0.22)',
                borderRadius: 16,
                padding: '12px 28px',
                whiteSpace: 'nowrap',
              }}
            >
              <div style={{ fontSize: 'clamp(40px, 9vw, 96px)' }}>BROUILLON</div>
              <div style={{ fontSize: 'clamp(18px, 4vw, 44px)' }}>NON SIGNÉE – NON VALABLE</div>
            </div>
          </div>
        )}
        
        {/* Document Header */}
        <div className="border-b-2 border-slate-800 pb-4 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="text-[10px] text-slate-500">
                Arrêté du 20 février 2003 relatif au suivi sanitaire des mineurs
              </div>
            </div>

            <div className="text-right">
              <div className="inline-block border-2 border-slate-800 px-3 py-1 font-mono text-xs font-bold bg-slate-50">
                FICHE OFFICIELLE
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                Document officiel obligatoire
              </div>
            </div>
          </div>

          <div className="text-center mt-3 pt-2 border-t border-slate-300">
            <h2 className="text-lg sm:text-xl font-bold uppercase tracking-wide text-slate-950">
              FICHE SANITAIRE DE LIAISON
            </h2>
            <p className="text-xs text-slate-600 italic">
              Cette fiche permet de recueillir les informations indispensables à la prise en charge sanitaire de l enfant durant son séjour.
            </p>
          </div>
        </div>

        {/* 1 - ENFANT */}
        <section className="mb-4 border border-slate-800">
          <div className="bg-slate-800 text-white px-3 py-1 text-xs font-bold uppercase flex justify-between items-center">
            <span>1 — ENFANT</span>
            <span className="text-[10px] font-normal lowercase italic text-slate-200">Renseignements obligatoires</span>
          </div>

          <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs bg-white">
            <div>
              <span className="text-slate-500 block uppercase text-[10px]">Nom :</span>
              <strong className="text-sm font-bold text-slate-950">{cerfa.identity.lastName || '—'}</strong>
            </div>
            <div>
              <span className="text-slate-500 block uppercase text-[10px]">Prénom :</span>
              <strong className="text-sm font-bold text-slate-950">{cerfa.identity.firstName || '—'}</strong>
            </div>
            <div>
              <span className="text-slate-500 block uppercase text-[10px]">Date de naissance :</span>
              <span className="font-semibold text-slate-900">{formatDateFr(cerfa.identity.birthDate)}</span>
            </div>
            <div>
              <span className="text-slate-500 block uppercase text-[10px]">Sexe :</span>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="flex items-center gap-1 font-medium">
                  <span className={`w-3.5 h-3.5 rounded border border-slate-700 flex items-center justify-center ${cerfa.identity.gender === 'Garcon' ? 'bg-slate-900 text-white' : ''}`}>
                    {cerfa.identity.gender === 'Garcon' ? '✓' : ''}
                  </span>
                  Garçon
                </span>
                <span className="flex items-center gap-1 font-medium">
                  <span className={`w-3.5 h-3.5 rounded border border-slate-700 flex items-center justify-center ${cerfa.identity.gender === 'Fille' ? 'bg-slate-900 text-white' : ''}`}>
                    {cerfa.identity.gender === 'Fille' ? '✓' : ''}
                  </span>
                  Fille
                </span>
              </div>
            </div>
          </div>

          {/* Téléphone portable enfant & Données Scolaires séparées */}
          <div className="px-3 py-2 border-t border-slate-200 bg-slate-50/70 text-xs flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-slate-500 text-[10px] uppercase block">Téléphone portable de l enfant :</span>
              <span className="font-semibold text-slate-900">{cerfa.identity.childMobilePhone || 'Non renseigné / Néant'}</span>
            </div>
            <div>
              <span className="text-slate-500 text-[10px] uppercase block">N° de sécurité sociale :</span>
              <span className="font-semibold text-slate-900 font-mono">{cerfa.identity.socialSecurityNumber || 'Non renseigné'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-slate-700">
              <span>Établissement : <strong>{establishmentName || student.schoolEstablishment || 'Établissement scolaire'}</strong></span>
              <span>Classe : <strong className="bg-white px-1.5 py-0.5 border border-slate-300 rounded">{student.schoolClass}</strong></span>
              <span>Régime pension : <strong>{student.boardingStatus === 'DP' ? 'Demi-pensionnaire' : 'Externe'}</strong></span>
              <span>N° élève : <strong className="font-mono">{student.internalId}</strong></span>
            </div>
          </div>
        </section>

        {/* 2 - VACCINATIONS */}
        <section className="mb-4 border border-slate-800">
          <div className="bg-slate-800 text-white px-3 py-1 text-xs font-bold uppercase flex justify-between items-center">
            <span>2 — VACCINATIONS (Se référer au carnet de santé ou aux certificats de vaccination)</span>
          </div>

          <div className="p-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              
              {/* Vaccins Obligatoires */}
              <div>
                <h4 className="font-bold text-slate-900 border-b border-slate-300 pb-1 mb-2 uppercase text-[11px]">
                  Vaccins obligatoires
                </h4>
                <table className="w-full border-collapse border border-slate-300 text-left">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700">
                      <th className="border border-slate-300 p-1.5">Vaccin</th>
                      <th className="border border-slate-300 p-1.5 text-center w-16">Oui / Non</th>
                      <th className="border border-slate-300 p-1.5 text-center">Dernier rappel</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-slate-300 p-1.5 font-medium">Diphtérie</td>
                      <td className="border border-slate-300 p-1.5 text-center">{cerfa.vaccinations.obligatoires.diphterie.done === true ? 'OUI' : cerfa.vaccinations.obligatoires.diphterie.done === false ? 'NON' : '-'}</td>
                      <td className="border border-slate-300 p-1.5 text-center">{formatDateFr(cerfa.vaccinations.obligatoires.diphterie.lastBoosterDate)}</td>
                    </tr>
                    <tr>
                      <td className="border border-slate-300 p-1.5 font-medium">Tétanos</td>
                      <td className="border border-slate-300 p-1.5 text-center">{cerfa.vaccinations.obligatoires.tetanos.done === true ? 'OUI' : cerfa.vaccinations.obligatoires.tetanos.done === false ? 'NON' : '-'}</td>
                      <td className="border border-slate-300 p-1.5 text-center">{formatDateFr(cerfa.vaccinations.obligatoires.tetanos.lastBoosterDate)}</td>
                    </tr>
                    <tr>
                      <td className="border border-slate-300 p-1.5 font-medium">Poliomyélite</td>
                      <td className="border border-slate-300 p-1.5 text-center">{cerfa.vaccinations.obligatoires.poliomyelite.done === true ? 'OUI' : cerfa.vaccinations.obligatoires.poliomyelite.done === false ? 'NON' : '-'}</td>
                      <td className="border border-slate-300 p-1.5 text-center">{formatDateFr(cerfa.vaccinations.obligatoires.poliomyelite.lastBoosterDate)}</td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="border border-slate-300 p-1.5 font-medium italic">Ou DT Polio</td>
                      <td className="border border-slate-300 p-1.5 text-center">{cerfa.vaccinations.obligatoires.dtPolio.done === true ? 'OUI' : cerfa.vaccinations.obligatoires.dtPolio.done === false ? 'NON' : '-'}</td>
                      <td className="border border-slate-300 p-1.5 text-center">{formatDateFr(cerfa.vaccinations.obligatoires.dtPolio.lastBoosterDate)}</td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="border border-slate-300 p-1.5 font-medium italic">Ou Tétracoq</td>
                      <td className="border border-slate-300 p-1.5 text-center">{cerfa.vaccinations.obligatoires.tetracoq.done === true ? 'OUI' : cerfa.vaccinations.obligatoires.tetracoq.done === false ? 'NON' : '-'}</td>
                      <td className="border border-slate-300 p-1.5 text-center">{formatDateFr(cerfa.vaccinations.obligatoires.tetracoq.lastBoosterDate)}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Contre-indication obligatoire */}
                <div className="mt-2 p-2 border border-slate-300 bg-slate-50 rounded text-[11px]">
                  <span className="font-semibold text-slate-800">Mention CERFA : </span>
                  <span className="italic">« Si les vaccins obligatoires ne sont pas réalisés, joindre un certificat médical de contre-indication. »</span>
                  {cerfa.vaccinations.hasContraindication ? (
                    <div className="mt-1 text-amber-900 font-semibold flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5" /> Contre-indication déclarée : {cerfa.vaccinations.contraindicationDetails || 'Certificat joint au dossier'}
                    </div>
                  ) : (
                    <div className="mt-1 text-slate-600">
                      ✓ Vaccinations obligatoires à jour attestées.
                    </div>
                  )}
                </div>
              </div>

              {/* Vaccins Recommandés */}
              <div>
                <h4 className="font-bold text-slate-900 border-b border-slate-300 pb-1 mb-2 uppercase text-[11px]">
                  Vaccins recommandés
                </h4>
                <table className="w-full border-collapse border border-slate-300 text-left">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700">
                      <th className="border border-slate-300 p-1.5">Vaccin</th>
                      <th className="border border-slate-300 p-1.5 text-center w-16">Fait</th>
                      <th className="border border-slate-300 p-1.5 text-center">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-slate-300 p-1.5 font-medium">BCG (Tuberculose)</td>
                      <td className="border border-slate-300 p-1.5 text-center">{cerfa.vaccinations.recommandes.bcg.done ? 'OUI' : 'NON'}</td>
                      <td className="border border-slate-300 p-1.5 text-center">{formatDateFr(cerfa.vaccinations.recommandes.bcg.date)}</td>
                    </tr>
                    <tr>
                      <td className="border border-slate-300 p-1.5 font-medium">Hépatite B</td>
                      <td className="border border-slate-300 p-1.5 text-center">{cerfa.vaccinations.recommandes.hepatiteB.done ? 'OUI' : 'NON'}</td>
                      <td className="border border-slate-300 p-1.5 text-center">{formatDateFr(cerfa.vaccinations.recommandes.hepatiteB.date)}</td>
                    </tr>
                    <tr>
                      <td className="border border-slate-300 p-1.5 font-medium">Rubéole-Oreillons-Rougeole (ROR)</td>
                      <td className="border border-slate-300 p-1.5 text-center">{cerfa.vaccinations.recommandes.ror.done ? 'OUI' : 'NON'}</td>
                      <td className="border border-slate-300 p-1.5 text-center">{formatDateFr(cerfa.vaccinations.recommandes.ror.date)}</td>
                    </tr>
                    <tr>
                      <td className="border border-slate-300 p-1.5 font-medium">Coqueluche</td>
                      <td className="border border-slate-300 p-1.5 text-center">{cerfa.vaccinations.recommandes.coqueluche.done ? 'OUI' : 'NON'}</td>
                      <td className="border border-slate-300 p-1.5 text-center">{formatDateFr(cerfa.vaccinations.recommandes.coqueluche.date)}</td>
                    </tr>
                    <tr>
                      <td className="border border-slate-300 p-1.5 font-medium">Autres {cerfa.vaccinations.recommandes.autres.name ? `(${cerfa.vaccinations.recommandes.autres.name})` : ''}</td>
                      <td className="border border-slate-300 p-1.5 text-center">{cerfa.vaccinations.recommandes.autres.done ? 'OUI' : 'NON'}</td>
                      <td className="border border-slate-300 p-1.5 text-center">{formatDateFr(cerfa.vaccinations.recommandes.autres.date)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

            </div>
          </div>
        </section>

        {/* 3 - RENSEIGNEMENTS MÉDICAUX */}
        <section className="mb-4 border border-slate-800">
          <div className="bg-slate-800 text-white px-3 py-1 text-xs font-bold uppercase flex justify-between items-center">
            <span>3 — RENSEIGNEMENTS MÉDICAUX</span>
          </div>

          <div className="p-3 space-y-3 text-xs">
            {/* Traitement médical */}
            <div className="border border-slate-300 p-2.5 bg-slate-50/50 rounded">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900">
                  L enfant suit-il un traitement médical ?
                </span>
                <span className={`px-2 py-0.5 rounded font-bold uppercase ${
                  cerfa.medicalInfo.hasMedicalTreatment ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-slate-100 text-slate-700'
                }`}>
                  {cerfa.medicalInfo.hasMedicalTreatment ? 'OUI' : 'NON'}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 mt-1 italic">
                Avertissement officiel CERFA : « Si oui, joindre une ordonnance récente et les médicaments correspondants dans leur emballage d origine. Aucun médicament ne pourra être pris sans ordonnance. »
              </p>
              {cerfa.medicalInfo.hasMedicalTreatment && (
                <div className="mt-2 p-2 bg-white border border-amber-200 rounded">
                  <span className="font-semibold text-slate-800 block text-[11px]">Détails du traitement prescrit :</span>
                  <p className="text-slate-800 mt-0.5 whitespace-pre-wrap">{cerfa.medicalInfo.treatmentDetails || '—'}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-600">
                    <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
                    Ordonnance médicale jointe au dossier : <strong>{cerfa.medicalInfo.hasPrescriptionAttached ? 'OUI' : 'NON'}</strong>
                  </div>
                </div>
              )}
            </div>

            {/* Projet d'Accueil Individualisé (PAI) */}
            <div className={`border p-2.5 rounded ${
              cerfa.medicalInfo.hasPai ? 'border-red-300 bg-red-50/60' : 'border-slate-300 bg-slate-50/50'
            }`}>
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900">
                  Projet d'Accueil Individualisé (P.A.I.) :
                </span>
                <span className={`px-2 py-0.5 rounded font-bold uppercase ${
                  cerfa.medicalInfo.hasPai ? 'bg-red-700 text-white' : 'bg-slate-100 text-slate-700'
                }`}>
                  {cerfa.medicalInfo.hasPai ? 'OUI — PROTOCOLE ACTIF' : 'NON'}
                </span>
              </div>
              {cerfa.medicalInfo.hasPai && (
                <div className="mt-2 p-2.5 bg-white border border-red-200 rounded space-y-2">
                  <div>
                    <span className="font-semibold text-slate-800 block text-[11px]">Pathologie et conduite d'urgence PAI :</span>
                    <p className="text-slate-800 text-[11px] whitespace-pre-wrap mt-0.5 font-medium">
                      {cerfa.medicalInfo.paiDetails || 'Protocole d accueil individualisé actif validé par le médecin scolaire.'}
                    </p>
                  </div>

                  {/* Documents PAI joints */}
                  <div className="pt-2 border-t border-red-100">
                    <span className="font-semibold text-slate-800 block text-[11px] mb-1.5">
                      Pièce(s) jointe(s) PAI associée(s) :
                    </span>
                    {cerfa.documents.filter((d) => d.type === 'pai').length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {cerfa.documents
                          .filter((d) => d.type === 'pai')
                          .map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() =>
                                openOrDownloadDocument(d, `${cerfa.identity.firstName} ${cerfa.identity.lastName}`)
                              }
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 border border-red-300 text-red-800 rounded font-semibold text-[11px] transition shadow-xs cursor-pointer"
                              title="Cliquer pour consulter ou télécharger ce document PAI"
                            >
                              <FileCheck className="w-4 h-4 text-red-600" />
                              <span>{d.fileName || d.name}</span>
                              <span className="text-[10px] text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                                {d.sizeKb} Ko
                              </span>
                              <Download className="w-3.5 h-3.5 text-red-700 ml-0.5" />
                            </button>
                          ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between p-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900">
                        <span>Document PAI archivé au dossier médical de l établissement.</span>
                        {cerfa.documents.length > 0 && (
                          <span className="text-[10px] text-slate-500">
                            (Consulter les justificatifs ci-dessous)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Antécédents médicaux - Tableau du CERFA */}
            <div>
              <h4 className="font-bold text-slate-900 border-b border-slate-300 pb-1 mb-2 uppercase text-[11px]">
                Antécédents médicaux (Cocher si l enfant a déjà eu ces maladies)
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                {Object.entries({
                  rubeole: 'Rubéole',
                  varicelle: 'Varicelle',
                  angines: 'Angines',
                  rhumatismes: 'Rhumatismes',
                  scarlatine: 'Scarlatine',
                  coqueluche: 'Coqueluche',
                  otites: 'Otites',
                  asthme: 'Asthme',
                  rougeole: 'Rougeole',
                  oreillons: 'Oreillons',
                }).map(([key, label]) => {
                  const hasHad = cerfa.medicalInfo.antecedents[key as keyof typeof cerfa.medicalInfo.antecedents];
                  return (
                    <div
                      key={key}
                      className={`p-1.5 border rounded flex items-center justify-between ${
                        hasHad ? 'bg-blue-50/70 border-blue-300 font-semibold' : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                    >
                      <span>{label}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${hasHad ? 'bg-blue-700 text-white' : 'text-slate-400'}`}>
                        {hasHad ? 'OUI' : 'NON'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Allergies */}
            <div className="border border-slate-300 p-2.5 rounded bg-white">
              <h4 className="font-bold text-slate-900 uppercase text-[11px] mb-1">
                Allergies
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                <div className="p-1.5 border border-slate-200 rounded flex items-center justify-between">
                  <span>Asthme :</span>
                  <strong className={cerfa.medicalInfo.allergies.asthme ? 'text-red-700' : 'text-slate-700'}>
                    {cerfa.medicalInfo.allergies.asthme ? 'OUI' : 'NON'}
                  </strong>
                </div>
                <div className="p-1.5 border border-slate-200 rounded flex items-center justify-between">
                  <span>Médicamenteuses :</span>
                  <strong className={cerfa.medicalInfo.allergies.medicamenteuses ? 'text-red-700' : 'text-slate-700'}>
                    {cerfa.medicalInfo.allergies.medicamenteuses ? 'OUI' : 'NON'}
                  </strong>
                </div>
                <div className="p-1.5 border border-slate-200 rounded flex items-center justify-between">
                  <span>Alimentaires :</span>
                  <strong className={cerfa.medicalInfo.allergies.alimentaires ? 'text-red-700' : 'text-slate-700'}>
                    {cerfa.medicalInfo.allergies.alimentaires ? 'OUI' : 'NON'}
                  </strong>
                </div>
                <div className="p-1.5 border border-slate-200 rounded flex items-center justify-between">
                  <span>Autres :</span>
                  <strong className="text-slate-700 truncate max-w-[100px]">
                    {cerfa.medicalInfo.allergies.autres || 'Néant'}
                  </strong>
                </div>
              </div>

              {/* Cause allergie et conduite à tenir */}
              {(cerfa.medicalInfo.allergies.asthme ||
                cerfa.medicalInfo.allergies.medicamenteuses ||
                cerfa.medicalInfo.allergies.alimentaires ||
                cerfa.medicalInfo.allergies.autres) && (
                <div className="p-2 bg-red-50/60 border border-red-200 rounded mt-2">
                  <span className="font-bold text-red-900 block text-[11px]">
                    Préciser la cause de l allergie et la conduite à tenir (Obligatoire) :
                  </span>
                  <p className="text-slate-800 mt-1 whitespace-pre-wrap">
                    {cerfa.medicalInfo.allergyCauseAndAction || 'Aucune conduite précisée'}
                  </p>
                  <div className="mt-1 text-[11px] text-slate-600">
                    Signalement automédication par l élève : <strong>{cerfa.medicalInfo.isSelfMedicationReported ? 'OUI (signalé)' : 'NON'}</strong>
                  </div>
                </div>
              )}
            </div>

            {/* Difficultés de santé */}
            <div className="border border-slate-300 p-2.5 rounded bg-slate-50/50">
              <h4 className="font-bold text-slate-900 uppercase text-[11px]">
                Difficultés de santé
              </h4>
              <p className="text-[10px] text-slate-500 italic mb-1">
                (Maladie, accident, crises convulsives, hospitalisation, opération, rééducation, dates, précautions à prendre)
              </p>
              <div className="p-2 bg-white border border-slate-200 rounded text-slate-800 min-h-[40px] whitespace-pre-wrap">
                {cerfa.medicalInfo.healthDifficulties || 'Néant'}
              </div>
            </div>
          </div>
        </section>

        {/* 4 - ALLERGIES ALIMENTAIRES & RÉGIME */}
        <section className={`mb-4 border-2 ${
          cerfa.medicalInfo.allergies.alimentaires || (cerfa.structuredDiet.category && cerfa.structuredDiet.category !== 'standard')
            ? 'border-amber-600 bg-amber-50/40'
            : 'border-slate-800 bg-white'
        }`}>
          <div className={`px-3 py-1.5 text-xs font-bold uppercase flex justify-between items-center ${
            cerfa.medicalInfo.allergies.alimentaires || (cerfa.structuredDiet.category && cerfa.structuredDiet.category !== 'standard')
              ? 'bg-amber-800 text-white'
              : 'bg-slate-800 text-white'
          }`}>
            <span>4 — RÉGIME ALIMENTAIRE & ALLERGIES ALIMENTAIRES</span>
            {(cerfa.medicalInfo.allergies.alimentaires || (cerfa.structuredDiet.category && cerfa.structuredDiet.category !== 'standard')) && (
              <span className="text-[10px] font-bold bg-amber-200 text-amber-950 px-2 py-0.5 rounded">
                Régime ou allergie active
              </span>
            )}
          </div>

          <div className="p-3.5 text-xs space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={`p-3 rounded-lg border-2 ${
                cerfa.structuredDiet.category && cerfa.structuredDiet.category !== 'standard'
                  ? 'bg-amber-100/60 border-amber-400'
                  : 'bg-emerald-50/60 border-emerald-300'
              }`}>
                <span className="font-bold text-slate-900 flex items-center gap-1.5 text-xs mb-1.5">
                  <Utensils className="w-3.5 h-3.5" />
                  Régime alimentaire sélectionné :
                </span>
                <div className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg font-black text-base ${
                  cerfa.structuredDiet.category && cerfa.structuredDiet.category !== 'standard'
                    ? 'bg-amber-700 text-white shadow-xs'
                    : 'bg-emerald-700 text-white shadow-xs'
                }`}>
                  {cerfa.structuredDiet.category === 'sans_porc'
                    ? 'SANS PORC'
                    : cerfa.structuredDiet.category === 'sans_viande'
                    ? 'SANS VIANDE'
                    : cerfa.structuredDiet.category === 'vegetarien'
                    ? 'VÉGÉTARIEN'
                    : cerfa.structuredDiet.category === 'allergie_alimentaire'
                    ? 'ALLERGIE ALIMENTAIRE'
                    : 'SANS RESTRICTION'}
                </div>
                {cerfa.structuredDiet.details && (
                  <p className="text-amber-950 mt-2 font-medium bg-white/80 p-2 rounded border border-amber-200 text-[11px]">
                    <strong>Précisions :</strong> {cerfa.structuredDiet.details}
                  </p>
                )}
              </div>

              <div className={`p-3 rounded-lg border-2 ${
                cerfa.medicalInfo.allergies.alimentaires
                  ? 'bg-red-50 border-red-400'
                  : 'bg-emerald-50/60 border-emerald-300'
              }`}>
                <span className={`font-bold flex items-center gap-1.5 text-xs mb-1.5 ${
                  cerfa.medicalInfo.allergies.alimentaires ? 'text-red-900' : 'text-slate-900'
                }`}>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Allergie alimentaire & Évictions :
                </span>
                <div className={`px-3.5 py-2 rounded-lg text-sm min-h-[44px] whitespace-pre-wrap font-black ${
                  cerfa.medicalInfo.allergies.alimentaires
                    ? 'bg-red-700 text-white shadow-xs'
                    : 'bg-emerald-700 text-white shadow-xs'
                }`}>
                  {cerfa.medicalInfo.allergies.alimentaires
                    ? (cerfa.parentRecommendations || 'Allergie alimentaire déclarée (consulter P.A.I. et protocole).')
                    : 'AUCUNE ALLERGIE ALIMENTAIRE DÉCLARÉE'}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 5 - MÉDECIN TRAITANT */}
        <section className="mb-4 border border-slate-800">
          <div className="bg-slate-800 text-white px-3 py-1 text-xs font-bold uppercase flex justify-between items-center">
            <span>5 — MÉDECIN TRAITANT (Facultatif)</span>
          </div>

          <div className="p-3 text-xs grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white">
            <div>
              <span className="text-slate-500 block text-[10px] uppercase">Nom du médecin :</span>
              <span className="font-semibold text-slate-900">{cerfa.treatingDoctor.name || 'Non précisé'}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase">Téléphone du cabinet :</span>
              <span className="font-semibold text-slate-900">{cerfa.treatingDoctor.phone || 'Non précisé'}</span>
            </div>
          </div>
        </section>

        {/* 6 - RESPONSABLE LÉGAL, DÉCLARATION & SIGNATURE */}
        <section className="border-2 border-slate-800">
          <div className="bg-slate-800 text-white px-3 py-1 text-xs font-bold uppercase flex justify-between items-center">
            <span>6 — RESPONSABLE LÉGAL — DÉCLARATION & SIGNATURE ÉLECTRONIQUE</span>
          </div>

          <div className="p-3 text-xs space-y-3 bg-white">
            {/* Coordonnées Responsable */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-slate-200 pb-3">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Nom et Prénom :</span>
                <strong className="text-slate-900">{cerfa.legalGuardian.fullName || '—'}</strong>
                <span className="text-slate-500 block text-[10px] mt-0.5">Lien : {cerfa.legalGuardian.relationship || 'Responsable'}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-500 block text-[10px] uppercase">Adresse du domicile :</span>
                <span className="text-slate-800">{cerfa.legalGuardian.address || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Téléphone portable :</span>
                <strong className="text-slate-900">{cerfa.legalGuardian.mobilePhone || '—'}</strong>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Téléphone travail / domicile :</span>
                <span className="text-slate-800">{cerfa.legalGuardian.workPhone || cerfa.legalGuardian.homePhone || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Adresse e-mail :</span>
                <span className="text-slate-800">{cerfa.legalGuardian.email || '—'}</span>
              </div>
            </div>

            {/* Déclaration légale */}
            <div className="bg-slate-50 border border-slate-300 p-2.5 rounded text-[11px] text-slate-800 leading-relaxed">
              <strong className="block text-slate-900 uppercase text-[10px] mb-1">
                Déclaration d engagement du responsable légal :
              </strong>
              « Je soussigné(e) <strong>{cerfa.legalGuardian.fullName || 'le responsable légal'}</strong>, déclare exacts les renseignements portés sur cette fiche et autorise le responsable du séjour à prendre, le cas échéant, toutes les mesures (traitement médical, hospitalisation, intervention chirurgicale) rendues nécessaires par l état de l enfant. »
            </div>

            {/* Bloc signature */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end pt-1">
              <div>
                <div className="text-[11px] text-slate-600 space-y-1">
                  <div>Date de signature : <strong>{formatDateFr(cerfa.signature.signedDate) || 'En attente'}</strong></div>
                  <div>Horodatage système : <span className="font-mono text-[10px] text-slate-500">{formatDateTimeFr(cerfa.signature.validatedAt)}</span></div>
                  <div>Version archivée : <strong>Version {cerfa.signature.version || 1}</strong></div>
                  <div>Signé par : <strong>{cerfa.signature.signedByName || cerfa.legalGuardian.fullName || 'Non signée'}</strong></div>
                </div>
              </div>

              <div className="border border-slate-400 p-2 bg-slate-50/50 rounded flex flex-col items-center justify-center min-h-[90px]">
                <span className="text-[10px] uppercase text-slate-500 font-bold mb-1">Signature électronique</span>
                {cerfa.signature.signatureDataUrl ? (
                  <>
                    <img
                      src={cerfa.signature.signatureDataUrl}
                      alt="Signature"
                      className="max-h-16 object-contain"
                    />
                    {cerfa.signature.method === 'uploaded' && (
                      <span className="text-[9px] text-slate-500 italic mt-1">
                        Signature importée par l'administration
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-amber-700 text-xs font-semibold italic flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5" /> Fiche non signée électroniquement
                  </span>
                )}
              </div>
            </div>

            {/* Voyage(s) scolaire(s) d'affectation */}
            <div className="mt-2 pt-2.5 border-t border-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <Plane className="w-3.5 h-3.5 text-blue-900" />
                <span className="text-[10px] uppercase font-bold text-slate-700">Voyage(s) scolaire(s) d'affectation :</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {enrolledTrips.length > 0 ? (
                  enrolledTrips.map((t) => (
                    <span key={t.id} className="bg-blue-50 text-blue-900 border border-blue-200 px-2 py-0.5 rounded font-semibold text-[11px] flex items-center gap-1.5 shadow-2xs">
                      <span><strong>{t.name}</strong> ({t.destination} • Du {formatDateFr(t.startDate)} au {formatDateFr(t.endDate)})</span>
                      {canEdit && onUnregisterTrip && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Confirmer la suppression de l'inscription au voyage "${t.name}" pour ${student.cerfa.identity.firstName} ${student.cerfa.identity.lastName} ?`)) {
                              onUnregisterTrip(student.id, t.id);
                            }
                          }}
                          className="text-red-500 hover:text-red-700 hover:bg-red-100/70 p-0.5 rounded print:hidden transition cursor-pointer"
                          title="Supprimer cette inscription au voyage"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400 italic text-[11px]">Non rattaché à un voyage scolaire</span>
                )}
              </div>
            </div>

          </div>
        </section>

        {/* Documents joints */}
        {cerfa.documents.length > 0 && (
          <div className="mt-4 border border-slate-300 p-3 rounded bg-slate-50/60 text-xs">
            <span className="font-bold text-slate-900 uppercase text-[10px] block mb-2">
              Documents et justificatifs joints au dossier ({cerfa.documents.length}) :
            </span>
            <div className="space-y-1.5">
              {cerfa.documents.map((d) => (
                <div key={d.id} className="flex items-center justify-between p-2 bg-white border border-slate-200 rounded text-[11px] hover:border-blue-300 transition">
                  <div className="flex items-center gap-2 text-slate-800 font-medium">
                    <FileCheck className="w-4 h-4 text-blue-700 shrink-0" />
                    <div>
                      <span className="font-semibold text-slate-900">{d.name}</span>
                      <span className="text-slate-500 text-[10px] ml-1.5">({d.fileName})</span>
                      <span className="text-slate-400 text-[10px] block">
                        Ajouté le {formatDateFr(d.uploadDate)} • {d.sizeKb} Ko • {d.type === 'pai' ? 'P.A.I.' : d.type}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openOrDownloadDocument(d, `${cerfa.identity.firstName} ${cerfa.identity.lastName}`)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded font-semibold text-[11px] transition shadow-xs cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Consulter / Télécharger</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer print note */}
        <div className="mt-4 pt-3 border-t border-slate-200 text-[10px] text-slate-500 flex justify-between items-center">
          <span>Portail Fiche Sanitaire de Liaison — {establishmentName || student.schoolEstablishment || 'Établissement scolaire'}</span>
          <span>Document officiel — Imprimé le {new Date().toLocaleDateString('fr-FR')}</span>
        </div>

      </div>

      {/* Bannière rouge (répétée en bas de page pour être sûr qu'elle soit vue) */}
      {handoffBanner}
    </div>
  );
};
