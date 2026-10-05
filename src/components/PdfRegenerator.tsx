import React, { useRef, useState } from 'react';
import { FileText, Loader2, CheckCircle2, AlertTriangle, Square } from 'lucide-react';
import { Student, Trip } from '../types';
import { generateCerfaPdf } from '../utils/pdfGenerator';

console.log('[fichesanitaire] build pdf-regeneration-20261005');

interface PdfRegeneratorProps {
  students: Student[];
  trips: Trip[];
  establishmentName: string;
}

// Régénère le PDF archivé (fiches-pdf/<Classe>/<NOM_Prenom>.pdf) de TOUTES les fiches complètes
// avec le nom d'établissement enregistré. Les PDF déjà archivés gardent sinon l'ancien nom.
// Aucune fiche n'est modifiée : seul le fichier PDF du serveur est remplacé.
export const PdfRegenerator: React.FC<PdfRegeneratorProps> = ({ students, trips, establishmentName }) => {
  const targets = students.filter((s) => s && !(s as any).deletedAt && s.status === 'complete');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [current, setCurrent] = useState('');
  const [finished, setFinished] = useState<null | { ok: number; stopped: boolean }>(null);
  const stopRef = useRef(false);

  const labelOf = (s: Student) => `${s.cerfa?.identity?.lastName || ''} ${s.cerfa?.identity?.firstName || ''}`.trim() || s.id;

  const run = async () => {
    if (running || targets.length === 0) return;
    if (
      !window.confirm(
        `Régénérer les PDF archivés de ${targets.length} fiche${targets.length > 1 ? 's' : ''} complète${targets.length > 1 ? 's' : ''} avec le nom « ${establishmentName} » ?\n\nLes anciens fichiers du serveur seront remplacés. Ne fermez pas cette page pendant l'opération.`
      )
    )
      return;
    stopRef.current = false;
    setRunning(true);
    setFinished(null);
    setFailed([]);
    setDone(0);
    let ok = 0;
    const errs: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      if (stopRef.current) break;
      const s = targets[i];
      setCurrent(labelOf(s));
      try {
        const base64 = await generateCerfaPdf(s, trips, establishmentName, true);
        if (typeof base64 !== 'string' || !base64) throw new Error('génération impossible');
        const res = await fetch('/api/students/send-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId: s.id,
            pdfBase64: base64,
            studentName: labelOf(s),
            schoolClass: s.schoolClass,
            regenerate: true,
          }),
        });
        if (!res.ok) throw new Error('serveur ' + res.status);
        ok += 1;
      } catch (e) {
        errs.push(labelOf(s));
      }
      setDone(i + 1);
      setFailed([...errs]);
      await new Promise((r) => setTimeout(r, 20)); // laisse respirer le navigateur
    }
    setRunning(false);
    setCurrent('');
    setFinished({ ok, stopped: stopRef.current });
  };

  return (
    <div className="mt-8 pt-6 border-t border-slate-200" data-testid="pdf-regenerator">
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2 inline-flex items-center gap-2">
        <FileText className="w-4 h-4 text-blue-900" />
        PDF archivés sur le serveur
      </h4>
      <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
        Les PDF déjà archivés (dossier <code className="bg-slate-100 px-1 rounded">fiches-pdf/</code>) gardent l'ancien nom d'établissement
        tant que la fiche n'est pas enregistrée à nouveau. Ce bouton régénère d'un coup le PDF des{' '}
        <strong>{targets.length} fiche{targets.length > 1 ? 's' : ''} complète{targets.length > 1 ? 's' : ''}</strong> avec le nom
        « <strong>{establishmentName}</strong> ». Il crée aussi les PDF des fiches complètes qui n'en avaient pas. Aucune fiche n'est modifiée.
      </p>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button
          type="button"
          onClick={run}
          disabled={running || targets.length === 0}
          className="inline-flex items-center gap-2 bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white font-semibold text-xs px-4 py-2.5 rounded-xl cursor-pointer"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          Régénérer les PDF de toutes les fiches complètes
        </button>
        {running && (
          <button
            type="button"
            onClick={() => {
              stopRef.current = true;
            }}
            className="inline-flex items-center gap-1.5 border border-red-300 text-red-700 hover:bg-red-50 font-semibold text-xs px-3 py-2 rounded-xl cursor-pointer"
          >
            <Square className="w-3.5 h-3.5" /> Arrêter
          </button>
        )}
      </div>
      {(running || finished) && (
        <div className="mt-3 max-w-xl space-y-2" role="status" data-testid="pdf-regenerator-status">
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-blue-900 transition-all" style={{ width: `${targets.length ? Math.round((done / targets.length) * 100) : 0}%` }} />
          </div>
          <p className="text-xs text-slate-700">
            {done} / {targets.length}
            {running && current ? ` — ${current}` : ''}
          </p>
          {finished && (
            <p className={`text-xs font-semibold ${failed.length ? 'text-amber-700' : 'text-emerald-700'}`}>
              {failed.length ? <AlertTriangle className="w-3.5 h-3.5 inline" /> : <CheckCircle2 className="w-3.5 h-3.5 inline" />}{' '}
              {finished.ok} PDF régénéré{finished.ok > 1 ? 's' : ''}
              {finished.stopped ? ' (arrêté avant la fin)' : ''}
              {failed.length ? `, ${failed.length} échec${failed.length > 1 ? 's' : ''}` : ''}.
            </p>
          )}
          {failed.length > 0 && <p className="text-[11px] text-amber-800">Échecs : {failed.join(', ')}. Relancez le bouton pour les réessayer.</p>}
        </div>
      )}
    </div>
  );
};
