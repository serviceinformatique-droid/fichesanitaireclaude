import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Loader2, AlertTriangle } from 'lucide-react';

console.log('[fichesanitaire] build changelog-20261007');

interface ChangelogEntry {
  id: string;
  date: string;
  category?: string;
  title: string;
  details?: string[];
}

const CATEGORY_STYLE: Record<string, string> = {
  Sécurité: 'bg-red-50 text-red-800 border-red-200',
  'Fiches PDF': 'bg-indigo-50 text-indigo-800 border-indigo-200',
  Fiches: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  Messagerie: 'bg-sky-50 text-sky-800 border-sky-200',
  Comptes: 'bg-amber-50 text-amber-800 border-amber-200',
  Famille: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  Administration: 'bg-blue-50 text-blue-900 border-blue-200',
  Données: 'bg-slate-100 text-slate-700 border-slate-300',
  Interface: 'bg-slate-100 text-slate-700 border-slate-300',
};

const formatDay = (d: string): string => {
  const t = Date.parse(d + 'T12:00:00');
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

// Journal des mises à jour : réservé à l'administration (les données viennent de /api/changelog, refusé aux autres rôles)
export const ChangelogPanel: React.FC = () => {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/changelog')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((j) => {
        if (alive) setEntries(Array.isArray(j.entries) ? j.entries : []);
      })
      .catch(() => {
        if (alive) setError('Le journal des mises à jour est indisponible pour le moment.');
      });
    return () => {
      alive = false;
    };
  }, []);

  const newestFirst = useMemo(() => (entries ? [...entries].reverse() : []), [entries]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return newestFirst;
    return newestFirst.filter((e) => [e.title, e.id, e.category || '', ...(e.details || [])].join(' ').toLowerCase().includes(q));
  }, [newestFirst, query]);

  const groups = useMemo(() => {
    const g: { day: string; items: ChangelogEntry[] }[] = [];
    filtered.forEach((e) => {
      const last = g[g.length - 1];
      if (last && last.day === e.date) last.items.push(e);
      else g.push({ day: e.date, items: [e] });
    });
    return g;
  }, [filtered]);

  const latest = newestFirst[0];

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5" data-testid="changelog-panel">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-blue-700" />
            Journal des mises à jour
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Toutes les évolutions du portail, de la plus récente à la plus ancienne. Cette page n'est visible que par l'administration.
          </p>
          {latest && (
            <p className="text-xs text-slate-700 mt-2" data-testid="changelog-latest">
              Dernière mise à jour installée : <span className="font-semibold">{latest.title}</span>{' '}
              <span className="font-mono text-[11px] text-slate-500">({latest.id})</span>
            </p>
          )}
        </div>
        <div className="relative sm:w-64 shrink-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une mise à jour…"
            aria-label="Rechercher dans le journal des mises à jour"
            data-testid="changelog-search"
            className="w-full border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-blue-900 focus:outline-none"
          />
        </div>
      </div>

      {!entries && !error && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}
      {entries && (
        <div className="text-[11px] text-slate-500" data-testid="changelog-count">
          {filtered.length} mise{filtered.length > 1 ? 's' : ''} à jour affichée{filtered.length > 1 ? 's' : ''} sur {entries.length}
        </div>
      )}
      {entries && filtered.length === 0 && <div className="text-sm text-slate-500">Aucune mise à jour ne correspond à cette recherche.</div>}

      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.day}>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1 mb-2 capitalize">{formatDay(g.day)}</h4>
            <ul className="space-y-3">
              {g.items.map((e) => (
                <li key={e.id} className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/50" data-testid="changelog-entry">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{e.title}</span>
                    {e.category && (
                      <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${CATEGORY_STYLE[e.category] || 'bg-slate-100 text-slate-700 border-slate-300'}`}>{e.category}</span>
                    )}
                    <span className="font-mono text-[10px] text-slate-400 ml-auto">{e.id}</span>
                  </div>
                  {e.details && e.details.length > 0 && (
                    <ul className="mt-1.5 list-disc pl-5 space-y-0.5 text-xs text-slate-700">
                      {e.details.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
};
