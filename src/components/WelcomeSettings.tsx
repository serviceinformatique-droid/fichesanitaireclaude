import React, { useEffect, useState } from 'react';
import { CheckCircle2, Send } from 'lucide-react';
import { getWelcomeConfig, saveWelcomeConfig, sendWelcomeToExisting, WelcomeConfig } from '../utils/messaging';

// Réglage du message envoyé automatiquement dans la messagerie de chaque nouveau compte parent
export const WelcomeSettings: React.FC<{ adminId: string }> = ({ adminId }) => {
  const [cfg, setCfg] = useState<WelcomeConfig | null>(null);
  const [defaults, setDefaults] = useState<{ subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    getWelcomeConfig(adminId)
      .then((r) => {
        setCfg(r.config);
        setDefaults(r.defaults);
      })
      .catch((e) => setError(e.message || 'Chargement impossible.'));
  }, [adminId]);

  if (!cfg) {
    return <div className="p-6 text-xs text-slate-500">{error || 'Chargement…'}</div>;
  }

  const save = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await saveWelcomeConfig(adminId, cfg);
      setNotice("Message d'accueil enregistré : il sera envoyé aux prochains comptes créés.");
    } catch (e: any) {
      setError(e.message || 'Enregistrement impossible.');
    }
    setBusy(false);
  };

  const sendExisting = async () => {
    if (!window.confirm("Envoyer ce message d'accueil à tous les parents déjà inscrits qui ne l'ont pas encore reçu ?")) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await saveWelcomeConfig(adminId, cfg);
      const r = await sendWelcomeToExisting(adminId);
      setNotice(`Message d'accueil envoyé à ${r.count} parent${r.count > 1 ? 's' : ''}.`);
    } catch (e: any) {
      setError(e.message || 'Envoi impossible.');
    }
    setBusy(false);
  };

  return (
    <div className="p-4 space-y-3 overflow-y-auto h-full" data-testid="welcome-settings">
      <h3 className="text-sm font-bold text-slate-900">Message d'accueil des nouveaux comptes</h3>
      <p className="text-xs text-slate-500">
        Ce message est déposé automatiquement dans la messagerie de chaque parent qui crée un compte. Vous pouvez utiliser{' '}
        <code className="bg-slate-200 px-1 rounded">{'{prenom}'}</code> et <code className="bg-slate-200 px-1 rounded">{'{nom}'}</code> : ils sont remplacés par
        le prénom et le nom du parent.
      </p>
      <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
        Envoyer ce message à chaque nouveau compte parent
      </label>
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">Objet</label>
        <input
          value={cfg.subject}
          onChange={(e) => setCfg({ ...cfg, subject: e.target.value })}
          maxLength={150}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">Message</label>
        <textarea
          value={cfg.body}
          onChange={(e) => setCfg({ ...cfg, body: e.target.value })}
          rows={14}
          maxLength={5000}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      {error && <p className="text-xs font-medium text-red-700">{error}</p>}
      {notice && (
        <p className="text-xs font-medium text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5 inline" /> {notice}
        </p>
      )}
      <div className="flex flex-wrap gap-2 justify-end">
        {defaults && (
          <button
            type="button"
            onClick={() => setCfg({ ...cfg, subject: defaults.subject, body: defaults.body })}
            className="px-3 py-2 text-xs text-slate-600 cursor-pointer"
          >
            Rétablir le texte par défaut
          </button>
        )}
        <button
          type="button"
          onClick={sendExisting}
          disabled={busy}
          className="px-4 py-2 border border-blue-900 text-blue-900 hover:bg-blue-50 disabled:opacity-40 rounded-lg text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
        >
          <Send className="w-3.5 h-3.5" /> Envoyer aussi aux parents déjà inscrits
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="px-5 py-2 bg-blue-900 hover:bg-blue-950 disabled:opacity-40 text-white rounded-lg text-xs font-semibold cursor-pointer"
        >
          Enregistrer
        </button>
      </div>
    </div>
  );
};
