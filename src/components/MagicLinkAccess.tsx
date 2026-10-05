import React, { useEffect, useRef, useState } from 'react';
import { Student, Trip, SchoolClass } from '../types';
import { getFirstIncompleteSectionId } from '../utils/cerfaValidation';
import { CerfaEditor } from './CerfaEditor';
import { CerfaOfficialView } from './CerfaOfficialView';
import { Loader2, AlertCircle, ShieldCheck, FileText } from 'lucide-react';
import { sendCompletedFichePdfByEmail } from '../utils/pdfGenerator';
import { saveStudentViaLink } from '../utils/storage';

interface MagicLinkAccessProps {
  token: string;
}

interface MagicLinkData {
  student: Student;
  classes: SchoolClass[];
  trips: Trip[];
  establishmentName: string | null;
  logoUrl: string | null;
}

export const MagicLinkAccess: React.FC<MagicLinkAccessProps> = ({ token }) => {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [data, setData] = useState<MagicLinkData | null>(null);
  const [showOfficialView, setShowOfficialView] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  // Version de la fiche sur laquelle cette page s'appuie (sert à détecter une modification faite ailleurs)
  const baseRef = useRef<string | undefined>(undefined);

  const fetchData = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/magic-link/${token}`);
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Lien invalide.');
        setData(null);
      } else {
        setData(json);
        baseRef.current = json.student?.updatedAt;
        // Une fiche déjà complète s'ouvre directement en consultation plutôt
        // que sur le formulaire d'édition.
        if (json.student?.status === 'complete') {
          setShowOfficialView(true);
        }
      }
    } catch (e) {
      setErrorMsg('Impossible de contacter le serveur. Vérifiez votre connexion internet.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Conflit : l'autre responsable (ou un autre appareil) a enregistré cette fiche entre-temps.
  const handleConflict = () => {
    const reload = window.confirm(
      "Cette fiche vient d'être modifiée par quelqu'un d'autre (l'autre responsable, un autre appareil ou l'établissement) depuis votre ouverture de la page.\n\nPour ne pas écraser ses informations, votre enregistrement a été refusé.\n\nOK : recharger la dernière version de la fiche.\nAnnuler : rester sur cette page (vous devrez la recharger pour pouvoir enregistrer)."
    );
    if (reload) fetchData();
  };

  const handleSave = async (updatedStudent: Student) => {
    const base = baseRef.current;
    baseRef.current = updatedStudent.updatedAt;
    const result = await saveStudentViaLink(token, updatedStudent, base);
    if (!result.ok) {
      baseRef.current = base;
      if (result.conflict) {
        handleConflict();
        return;
      }
      alert(result.error || "L'enregistrement a échoué. Merci de réessayer.");
      return;
    }
    setData((prev) => (prev ? { ...prev, student: updatedStudent } : prev));
    if (updatedStudent.status === 'complete') {
      setJustCompleted(true);
      sendCompletedFichePdfByEmail(updatedStudent, data?.trips || [], data?.establishmentName || undefined).then(
        (sentAt) => {
          if (sentAt) {
            setData((prev) => (prev ? { ...prev, student: { ...prev.student, pdfSentAt: sentAt } } : prev));
          }
        }
      );
    }
    setShowOfficialView(true);
  };

  // Enregistre un brouillon sans quitter le formulaire ni exiger que tout soit rempli —
  // essentiel ici puisque le parent n'a que ce lien pour revenir plus tard.
  const handleSaveDraft = async (updatedStudent: Student) => {
    const base = baseRef.current;
    baseRef.current = updatedStudent.updatedAt;
    const result = await saveStudentViaLink(token, updatedStudent, base);
    if (!result.ok) {
      baseRef.current = base;
      if (result.conflict) {
        handleConflict();
        return;
      }
      alert(result.error || "L'enregistrement du brouillon a échoué. Merci de réessayer.");
      return;
    }
    setData((prev) => (prev ? { ...prev, student: updatedStudent } : prev));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-3 text-slate-600">
          <Loader2 className="w-8 h-8 animate-spin text-blue-800" />
          <span className="text-sm font-medium">Chargement de la fiche...</span>
        </div>
      </div>
    );
  }

  if (errorMsg || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="font-bold text-slate-900 text-base">Lien indisponible</h2>
          <p className="text-sm text-slate-600">{errorMsg}</p>
          <p className="text-xs text-slate-400">
            Vous pouvez vous connecter normalement au portail avec votre compte parent pour consulter ou compléter cette fiche.
          </p>
        </div>
      </div>
    );
  }

  const { student, classes, trips, establishmentName, logoUrl } = data;

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="bg-blue-950 text-white px-4 py-3 flex items-center gap-2.5">
        {logoUrl ? (
          <img src={logoUrl} alt="Logo" className="w-7 h-7 rounded bg-white object-contain" />
        ) : (
          <FileText className="w-5 h-5 text-blue-300" />
        )}
        <div>
          <p className="text-xs font-bold leading-tight">{establishmentName || 'Fiche Sanitaire de Liaison'}</p>
          <p className="text-[10px] text-blue-300 leading-tight flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> Accès direct sécurisé — sans connexion
          </p>
        </div>
      </div>

      {showOfficialView ? (
        justCompleted ? (
          <div className="max-w-2xl mx-auto py-10 px-4 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Fiche complétée, merci !</h2>
            <p className="text-sm text-slate-600">
              La fiche sanitaire de {student.cerfa.identity.firstName} {student.cerfa.identity.lastName} est maintenant complète et signée. Vous pouvez la consulter ou la télécharger ci-dessous.
            </p>
            <CerfaOfficialView
              student={student}
              trips={trips}
              canEdit={false}
              establishmentName={establishmentName || undefined}
              onBack={() => setJustCompleted(false)}
            />
          </div>
        ) : (
          <CerfaOfficialView
            student={student}
            trips={trips}
            canEdit={true}
            establishmentName={establishmentName || undefined}
            onEdit={() => setShowOfficialView(false)}
            onBack={() => setShowOfficialView(false)}
          />
        )
      ) : (
        <CerfaEditor
          student={student}
          trips={trips}
          classes={classes}
          initialSection={getFirstIncompleteSectionId(student.cerfa)}
          authorName={`${student.cerfa.legalGuardian.fullName || 'Parent'} (lien direct)`}
          authorRole="Parent / Responsable"
          onSave={handleSave}
          onSaveDraft={handleSaveDraft}
          onCancel={() => setShowOfficialView(true)}
          onViewCerfaOfficial={() => setShowOfficialView(true)}
        />
      )}
    </div>
  );
};
