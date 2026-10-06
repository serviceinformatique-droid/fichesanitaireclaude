import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, RotateCcw, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Student } from '../types';

console.log('[fichesanitaire] build year-end-20261006');

interface YearEndPanelProps {
  adminId: string;
  students: Student[];
}

interface YearEndInfo {
  config: { enabled: boolean; month: number; day: number };
  last: { at: string; by: string; count: number; file: string; undoneAt: string | null } | null;
  nextRun: string | null;
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const post = async (path: string, body: any) => {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Erreur serveur');
  return j;
};

const fmt = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
};

// Fin d'année scolaire : désinscription de TOUS les élèves de TOUS les voyages (les fiches sanitaires sont conservées)
export const YearEndPanel: React.FC<YearEndPanelProps> = ({ adminId, students }) => {
  const [info, setInfo] = useState<YearEndInfo | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [month, setMonth] = useState(7);
  const [day, setDay] = useState(15);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const enrolledStudents = students.filter((s) => (s.registeredTripIds || []).length > 0);
  const enrolments = enrolledStudents.reduce((n, s) => n + (s.registeredTripIds || []).length, 0);

  const load = useCallback(async () => {
    try {
      const j = await post('/api/year-end/get', { userId: adminId });
      setInfo(j);
      setEnabled(Boolean(j.config.enabled));
      setMonth(j.config.month);
      setDay(j.config.day);
    } catch (e: any) {
      setErr(e.message || 'Chargement impossible.');
    }
  }, [adminId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveConfig = async () => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await post('/api/year-end/save', { userId: adminId, enabled, month, day });
      await load();
      setMsg('Réglage enregistré.');
    } catch (e: any) {
      setErr(e.message || 'Enregistrement impossible.');
    }
    setBusy(false);
  };

  const reloadSoon = () => setTimeout(() => window.location.reload(), 1600);

  const runNow = async () => {
    if (enrolledStudents.length === 0) {
      setMsg('Aucun élève n\'est inscrit à un voyage : rien à désinscrire.');
      return;
    }
    if (
      !window.confirm(
        `Désinscrire dès maintenant ${enrolledStudents.length} élève(s) de TOUS les voyages (${enrolments} inscription(s)) ?\n\nLes fiches sanitaires ne sont PAS supprimées. Vous pourrez annuler cette opération juste après avec « Annuler la dernière désinscription ».`
      )
    )
      return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const j = await post('/api/year-end/run', { userId: adminId });
      setMsg(`${j.count} élève(s) désinscrit(s) de tous les voyages. La page va se recharger…`);
      reloadSoon();
    } catch (e: any) {
      setErr(e.message || 'Opération impossible.');
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!window.confirm('Rétablir les inscriptions aux voyages telles qu\'elles étaient avant la dernière désinscription ?')) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const j = await post('/api/year-end/undo', { userId: adminId });
      setMsg(`${j.restored} inscription(s) d'élève rétablie(s). La page va se recharger…`);
      reloadSoon();
    } catch (e: any) {
      setErr(e.message || 'Annulation impossible.');
      setBusy(false);
    }
  };

  const nextRunLabel = info && info.nextRun ? new Date(info.nextRun + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-2xl p-5 shadow-xs space-y-3" data-testid="year-end-panel">
      <div className="flex items-start gap-3">
        <CalendarClock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-base font-bold text-slate-900">Fin d'année scolaire — remise à zéro des inscriptions aux voyages</h3>
          <p className="text-xs text-slate-700 mt-0.5 max-w-3xl">
            Une fois par an, <strong>tous les élèves sont désinscrits de tous les voyages</strong> : les familles réinscrivent leurs enfants à la rentrée. Les
            fiches sanitaires, les comptes et les messages ne sont pas touchés.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-amber-200 rounded-xl p-3 space-y-2">
          <div className="text-[11px] font-bold uppercase text-slate-500">Désinscription automatique</div>
          <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="year-end-enabled" />
            Activer la désinscription automatique chaque année
          </label>
          <div className="flex items-center gap-2 text-sm text-slate-800">
            Le
            <input
              type="number"
              min={1}
              max={31}
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
              className="w-16 border border-slate-300 rounded-md px-2 py-1 text-sm"
              data-testid="year-end-day"
            />
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white"
              data-testid="year-end-month"
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={saveConfig}
              disabled={busy}
              className="bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white font-semibold text-xs px-3 py-1.5 rounded-lg cursor-pointer"
              data-testid="year-end-save"
            >
              Enregistrer
            </button>
          </div>
          <p className="text-xs text-slate-600">
            Prochaine exécution automatique : <strong data-testid="year-end-next">{enabled && info ? nextRunLabel : 'désactivée'}</strong>
            <span className="block text-[11px] text-slate-500">
              Elle a lieu la nuit, uniquement dans les 14 jours qui suivent cette date, une seule fois par an.
            </span>
          </p>
        </div>

        <div className="bg-white border border-amber-200 rounded-xl p-3 space-y-2">
          <div className="text-[11px] font-bold uppercase text-slate-500">Inscriptions actuelles</div>
          <p className="text-sm text-slate-800" data-testid="year-end-count">
            <strong>{enrolledStudents.length}</strong> élève(s) inscrit(s) à au moins un voyage ({enrolments} inscription(s)).
          </p>
          <p className="text-xs text-slate-600" data-testid="year-end-last">
            {info && info.last ? (
              <>
                Dernière désinscription : <strong>{fmt(info.last.at)}</strong> ({info.last.by === 'auto' ? 'automatique' : info.last.by}), {info.last.count} élève(s)
                {info.last.undoneAt ? ` — annulée le ${fmt(info.last.undoneAt)}` : ''}.
              </>
            ) : (
              'Aucune désinscription n\'a encore été effectuée.'
            )}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={runNow}
              disabled={busy}
              className="inline-flex items-center gap-1.5 bg-red-700 hover:bg-red-800 disabled:opacity-40 text-white font-semibold text-xs px-3 py-2 rounded-lg cursor-pointer"
              data-testid="year-end-run"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
              Désinscrire maintenant tous les élèves de tous les voyages
            </button>
            {info && info.last && !info.last.undoneAt && (
              <button
                type="button"
                onClick={undo}
                disabled={busy}
                className="inline-flex items-center gap-1.5 border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-800 font-semibold text-xs px-3 py-2 rounded-lg cursor-pointer"
                data-testid="year-end-undo"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Annuler la dernière désinscription
              </button>
            )}
          </div>
        </div>
      </div>
      {msg && (
        <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-1.5" role="status" data-testid="year-end-msg">
          <CheckCircle2 className="w-4 h-4" /> {msg}
        </div>
      )}
      {err && (
        <div className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert" data-testid="year-end-err">
          {err}
        </div>
      )}
    </div>
  );
};
