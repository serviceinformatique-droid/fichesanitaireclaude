#!/bin/bash
# ============================================================================
# patch-fin-annee.sh  -  build year-end-20261006
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# FIN D'ANNEE : DESINSCRIRE TOUS LES ELEVES DE TOUS LES VOYAGES.
#  - AUTOMATIQUE : chaque annee, la nuit, a partir du 15 juillet (date reglable), une seule fois,
#    et seulement dans une fenetre de 14 jours (jamais en cours d'annee scolaire, meme si le
#    serveur redemarre) ;
#  - MANUEL : bouton « Desinscrire maintenant tous les eleves de tous les voyages »
#    (Administration > Voyages scolaires), avec confirmation ;
#  - les fiches sanitaires, les comptes et les messages ne sont PAS touches ;
#  - chaque fiche concernee garde une trace dans son historique ;
#  - copie de securite des inscriptions (dossier des sauvegardes) et bouton
#    « Annuler la derniere desinscription » ;
#  - reservation a l'administration (controle serveur) ; journal : docker compose logs app | grep fin-annee
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-fin-annee.sh && /root/patch-fin-annee.sh
# ============================================================================
BUILD="year-end-20261006"
FILES="server/index.js src/components/AdminSpace.tsx"
NEWFILES="src/components/YearEndPanel.tsx"
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
TMP="$(mktemp -d)"

PATCHING=0
cleanup() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$PATCHING" = "1" ]; then
    echo ""
    echo "!!! ERREUR pendant le patch : restauration automatique des fichiers d'origine ..."
    for f in $FILES; do cp -p "$BACKUP_DIR/$f" "$APP_DIR/$f"; done
    for f in $NEWFILES; do rm -f "$APP_DIR/$f"; done
    echo "!!! Fichiers d'origine restaures : aucune modification n'a ete conservee."
    echo "!!! Envoyez le message d'erreur ci-dessus pour obtenir un script corrige."
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

echo ">>> Patch $BUILD sur $APP_DIR"

for f in $FILES; do
  [ -f "$APP_DIR/$f" ] || { echo "ERREUR : $APP_DIR/$f introuvable."; exit 1; }
done
command -v perl >/dev/null || { echo "ERREUR : perl est requis (apt install -y perl)."; exit 1; }

SRV="$APP_DIR/server/index.js"
ADM="$APP_DIR/src/components/AdminSpace.tsx"

m=0
grep -q "/api/year-end/get" "$SRV" && m=$((m+1))
grep -q "YearEndPanel" "$ADM" && m=$((m+1))
for f in $NEWFILES; do [ -f "$APP_DIR/$f" ] && m=$((m+1)); done
if [ "$m" -eq 3 ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
elif [ "$m" -gt 0 ]; then
  echo "ERREUR : etat partiel detecte ($m/3 elements deja en place)."
  echo "Restaurez d'abord les fichiers d'origine depuis un backup-avant-* puis relancez ce script."
  exit 1
fi

# --- Fonctions utilitaires -------------------------------------------------
count_occ() { OLD="$2" perl -0777 -ne 'my $c = () = /\Q$ENV{OLD}\E/g; print $c' "$1"; }

replace_once() { # fichier  ancien_texte  nouveau_texte
  local file="$1" old="$2" new="$3" n
  n="$(count_occ "$file" "$old")"
  [ "$n" = "1" ] || { echo "ERREUR : repere trouve $n fois dans $file (attendu : 1) :"; echo "$old" | head -3; exit 1; }
  OLD="$old" NEW="$new" perl -0777 -i -pe 's/\Q$ENV{OLD}\E/$ENV{NEW}/' "$file"
}

# --- 1. Sauvegarde ----------------------------------------------------------
echo ">>> Sauvegarde dans $BACKUP_DIR ..."
for f in $FILES; do
  mkdir -p "$BACKUP_DIR/$(dirname "$f")"
  cp -p "$APP_DIR/$f" "$BACKUP_DIR/$f"
done
PATCHING=1

echo ">>> Creation de src/components/YearEndPanel.tsx ..."
cat > "$APP_DIR/src/components/YearEndPanel.tsx" << 'FINEOF_X'
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
FINEOF_X

echo ">>> Modification des fichiers ..."
cat > "$TMP/y1_old.txt" << 'FINEOF_X'
// --- Purge automatique de la corbeille (fiches supprimées depuis plus de 30 jours) ---
FINEOF_X
cat > "$TMP/y1_new.txt" << 'FINEOF_X'
// --- Fin d'année scolaire : désinscription de TOUS les élèves de TOUS les voyages (build year-end-20261006) ---
// Réglage (activé par défaut) : chaque année à partir du 15 juillet, de nuit, une seule fois, uniquement dans une
// fenêtre de 14 jours (jamais au milieu de l'année scolaire, même si le serveur redémarre ou si le réglage change).
// Les fiches sanitaires, les comptes et les messages ne sont PAS touchés. Une copie de sécurité des inscriptions est
// écrite dans le dossier des sauvegardes : l'opération peut être annulée depuis l'administration.
const YEAR_END_KEY = 'cerfa_year_end_v1';
const YEAR_END_DEFAULT = { enabled: true, month: 7, day: 15 };
const YEAR_END_WINDOW_DAYS = 14;
const YEAR_END_TZ = process.env.CRON_TIMEZONE || 'Europe/Paris';

function yearEndToday() {
  let s = String(process.env.YEAR_END_FAKE_TODAY || ''); // réservé aux tests (variable d'environnement du serveur)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [fy, fm, fd] = s.split('-').map(Number);
    return { y: fy, m: fm, d: fd };
  }
  s = '';
  try {
    s = new Intl.DateTimeFormat('en-CA', { timeZone: YEAR_END_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    s = '';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) s = new Date().toISOString().slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

async function yearEndState() {
  const s = (await readKv(YEAR_END_KEY)) || {};
  return { ...s, config: { ...YEAR_END_DEFAULT, ...(s.config || {}) }, last: s.last || null };
}

function yearEndNextRun(config) {
  const { y, m, d } = yearEndToday();
  const today = Date.UTC(y, m - 1, d);
  let year = y;
  const startOf = (yy) => Date.UTC(yy, config.month - 1, config.day);
  // encore dans la fenêtre de cette année : la date « prochaine » reste celle de cette année
  if (today > startOf(y) + YEAR_END_WINDOW_DAYS * 86400000) year = y + 1;
  return new Date(startOf(year)).toISOString().slice(0, 10);
}

async function yearEndRequireAdmin(userId, res) {
  const users = (await readKv(USERS_KEY)) || [];
  const user = users.find((u) => u && u.id === userId && u.role === 'admin');
  if (!user) {
    res.status(403).json({ error: 'Réservé à l\'administration.' });
    return null;
  }
  return user;
}

async function yearEndUnregisterAll({ by }) {
  const release = await lockStudentWrites();
  try {
    const students = (await readKv(STUDENTS_KEY)) || [];
    const targets = students.filter((s) => s && Array.isArray(s.registeredTripIds) && s.registeredTripIds.length > 0);
    if (targets.length === 0) return { count: 0, file: null };
    const now = new Date().toISOString();
    const entries = targets.map((s) => ({ id: s.id, tripIds: s.registeredTripIds }));
    const file = `desinscription-voyages_${now.replace(/[:.]/g, '-')}.json`;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.writeFileSync(path.join(BACKUP_DIR, file), JSON.stringify({ at: now, by, entries }));
    const ids = new Set(entries.map((e) => e.id));
    const author = by === 'auto' ? 'Système (automatique)' : by;
    const updated = students.map((s) =>
      ids.has(s.id)
        ? {
            ...s,
            registeredTripIds: [],
            // la date de modification change : une page restée ouverte ne pourra pas réinscrire l'élève par erreur (409)
            updatedAt: now,
            cerfa: {
              ...s.cerfa,
              history: [
                {
                  id: 'h-ye-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
                  date: now,
                  action: "Désinscription des voyages (fin d'année scolaire)",
                  authorName: author,
                  authorRole: 'Direction / Administration',
                },
                ...((s.cerfa && s.cerfa.history) || []),
              ],
            },
          }
        : s
    );
    await writeKv(STUDENTS_KEY, updated);
    const st = await yearEndState();
    st.last = { at: now, by, count: entries.length, file, undoneAt: null };
    await writeKv(YEAR_END_KEY, st);
    console.log(`[fin-annee] ${entries.length} élève(s) désinscrit(s) de tous les voyages (${by}) ; copie : ${file}`);
    return { count: entries.length, file };
  } finally {
    release();
  }
}

async function yearEndUndo({ by }) {
  const release = await lockStudentWrites();
  try {
    const st = await yearEndState();
    if (!st.last || st.last.undoneAt || !st.last.file) return { restored: 0, error: 'Aucune désinscription à annuler.' };
    if (!/^desinscription-voyages_[0-9TZ-]+\.json$/.test(st.last.file)) return { restored: 0, error: 'Copie de sécurité invalide.' };
    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, st.last.file), 'utf8'));
    } catch {
      return { restored: 0, error: 'Copie de sécurité introuvable : utilisez restaurer-sauvegarde.sh.' };
    }
    const byId = new Map((saved.entries || []).map((e) => [e.id, e.tripIds]));
    const now = new Date().toISOString();
    let restored = 0;
    const students = (await readKv(STUDENTS_KEY)) || [];
    const updated = students.map((s) => {
      const tripIds = byId.get(s.id);
      // on ne touche pas à un élève réinscrit depuis (ses inscriptions actuelles sont conservées)
      if (!tripIds || (s.registeredTripIds || []).length > 0) return s;
      restored += 1;
      return {
        ...s,
        registeredTripIds: tripIds,
        updatedAt: now,
        cerfa: {
          ...s.cerfa,
          history: [
            {
              id: 'h-ye-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
              date: now,
              action: "Inscriptions aux voyages rétablies (annulation de la désinscription de fin d'année)",
              authorName: by,
              authorRole: 'Direction / Administration',
            },
            ...((s.cerfa && s.cerfa.history) || []),
          ],
        },
      };
    });
    await writeKv(STUDENTS_KEY, updated);
    st.last.undoneAt = now;
    await writeKv(YEAR_END_KEY, st);
    console.log(`[fin-annee] désinscription annulée par ${by} : ${restored} élève(s) réinscrit(s)`);
    return { restored };
  } finally {
    release();
  }
}

async function yearEndTick() {
  try {
    const st = await yearEndState();
    if (!st.config.enabled) return;
    const { y, m, d } = yearEndToday();
    const today = Date.UTC(y, m - 1, d);
    // L'exécution n'a lieu que dans les 14 jours qui suivent la date réglée (de cette année, ou de l'année précédente
    // pour une date proche du 31 décembre) : jamais au milieu de l'année scolaire.
    let instance = null;
    for (const cy of [y, y - 1]) {
      const days = Math.round((today - Date.UTC(cy, st.config.month - 1, st.config.day)) / 86400000);
      if (days >= 0 && days <= YEAR_END_WINDOW_DAYS) {
        instance = cy;
        break;
      }
    }
    if (instance === null) return; // hors fenêtre
    if (st.autoYear === instance) return; // déjà fait (ou annulé) pour cette échéance
    const r = await yearEndUnregisterAll({ by: 'auto' });
    const fresh = await yearEndState();
    fresh.autoYear = instance;
    await writeKv(YEAR_END_KEY, fresh);
    console.log(`[fin-annee] exécution automatique ${instance} terminée (${r.count} élève(s))`);
  } catch (e) {
    console.error('[fin-annee] Erreur :', e);
  }
}

app.post('/api/year-end/get', async (req, res) => {
  try {
    if (!(await yearEndRequireAdmin(req.body && req.body.userId, res))) return;
    const st = await yearEndState();
    res.json({ config: st.config, last: st.last, nextRun: st.config.enabled ? yearEndNextRun(st.config) : null });
  } catch (e) {
    console.error('[fin-annee] get :', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/year-end/save', async (req, res) => {
  try {
    if (!(await yearEndRequireAdmin(req.body && req.body.userId, res))) return;
    const { enabled, month, day } = req.body || {};
    const mo = Number(month);
    const da = Number(day);
    const valid =
      Number.isInteger(mo) && Number.isInteger(da) && mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && new Date(Date.UTC(2027, mo - 1, da)).getUTCMonth() === mo - 1;
    if (!valid) return res.status(400).json({ error: 'Date invalide.' });
    const st = await yearEndState();
    st.config = { enabled: Boolean(enabled), month: mo, day: da };
    await writeKv(YEAR_END_KEY, st);
    res.json({ ok: true, config: st.config });
  } catch (e) {
    console.error('[fin-annee] save :', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/year-end/run', async (req, res) => {
  try {
    const admin = await yearEndRequireAdmin(req.body && req.body.userId, res);
    if (!admin) return;
    const r = await yearEndUnregisterAll({ by: admin.name || admin.id });
    res.json({ ok: true, count: r.count });
  } catch (e) {
    console.error('[fin-annee] run :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/year-end/undo', async (req, res) => {
  try {
    const admin = await yearEndRequireAdmin(req.body && req.body.userId, res);
    if (!admin) return;
    const r = await yearEndUndo({ by: admin.name || admin.id });
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, restored: r.restored });
  } catch (e) {
    console.error('[fin-annee] undo :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Réglage consultable par les familles (onglet RGPD) : ne contient aucune donnée personnelle
app.get('/api/year-end/public', async (req, res) => {
  try {
    const st = await yearEndState();
    res.json({ enabled: st.config.enabled, month: st.config.month, day: st.config.day });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

cron.schedule('10 4 * * *', yearEndTick, { timezone: YEAR_END_TZ });
setTimeout(yearEndTick, Number(process.env.YEAR_END_STARTUP_DELAY_MS || 45000)); // rattrapage si le serveur était arrêté la nuit prévue (toujours dans la fenêtre de 14 jours)
console.log(`[fin-annee] Désinscription annuelle des voyages : fenêtre de ${YEAR_END_WINDOW_DAYS} jours à partir du réglage (défaut : ${YEAR_END_DEFAULT.day}/${YEAR_END_DEFAULT.month}).`);

// --- Purge automatique de la corbeille (fiches supprimées depuis plus de 30 jours) ---
FINEOF_X
replace_once "$SRV" "$(cat "$TMP/y1_old.txt")" "$(cat "$TMP/y1_new.txt")"

cat > "$TMP/y2_old.txt" << 'FINEOF_X'
import { openOrDownloadDocument } from '../utils/documentViewer';
FINEOF_X
cat > "$TMP/y2_new.txt" << 'FINEOF_X'
import { openOrDownloadDocument } from '../utils/documentViewer';
import { YearEndPanel } from './YearEndPanel';
FINEOF_X
replace_once "$ADM" "$(cat "$TMP/y2_old.txt")" "$(cat "$TMP/y2_new.txt")"

cat > "$TMP/y3_old.txt" << 'FINEOF_X'
          {/* List of trips */}
FINEOF_X
cat > "$TMP/y3_new.txt" << 'FINEOF_X'
          {/* Fin d'année scolaire : désinscription de tous les élèves de tous les voyages (build year-end-20261006) */}
          <div className="lg:col-span-3">
            <YearEndPanel adminId={currentUser.id} students={students} />
          </div>

          {/* List of trips */}
FINEOF_X
replace_once "$ADM" "$(cat "$TMP/y3_old.txt")" "$(cat "$TMP/y3_new.txt")"


# --- Reconstruction ------------------------------------------------------
PATCHING=0
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo ">>> SKIP_BUILD=1 : pas de reconstruction Docker."
  exit 0
fi

echo ">>> Reconstruction de l'application (1 a 3 minutes) ..."
cd "$APP_DIR"
if ! docker compose up -d --build; then
  echo ""
  echo "!!! ECHEC de la reconstruction Docker. L'ancien conteneur reste en service s'il tournait."
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/. $APP_DIR/ && rm -f $APP_DIR/src/components/YearEndPanel.tsx"
  exit 1
fi

echo ">>> Attente du demarrage ..."
APP_PORT_VAL="$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
APP_PORT_VAL="${APP_PORT_VAL:-8099}"
for i in $(seq 1 30); do
  if curl -fsS "http://localhost:$APP_PORT_VAL/health" >/dev/null 2>&1; then
    echo ">>> /health OK"
    break
  fi
  sleep 2
done

cat << MSG

============================================================
 TERMINE - build $BUILD
 - Administration > Voyages scolaires : panneau « Fin d'annee scolaire ».
 - Desinscription automatique : activee, a partir du 15 juillet (reglable), une fois par an.
 - Aucune execution automatique avant la prochaine fenetre : rien ne change aujourd'hui.
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
============================================================
MSG
