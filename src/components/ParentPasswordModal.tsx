import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, X } from 'lucide-react';
import { User } from '../types';
import { authChangePassword } from '../utils/auth';

console.log('[fichesanitaire] build parent-password-20261006 (serveur : auth-20261006)');

interface ParentPasswordModalProps {
  currentUser: User;
  onUpdateUserPassword?: (userId: string, newPassword: string) => void | Promise<void>;
  onClose: () => void;
}

const MIN_LENGTH = 6;

// Fenêtre « Changer mon mot de passe » de l'Espace Famille
export const ParentPasswordModal: React.FC<ParentPasswordModalProps> = ({ currentUser, onUpdateUserPassword, onClose }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const firstField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || success) return;
    setError('');
    if (!current) {
      setError('Veuillez saisir votre mot de passe actuel.');
      return;
    }
    if (next.trim().length < MIN_LENGTH) {
      setError(`Le nouveau mot de passe doit comporter au moins ${MIN_LENGTH} caractères.`);
      return;
    }
    if (next !== confirm) {
      setError('Les deux nouveaux mots de passe ne correspondent pas.');
      return;
    }
    if (next.trim() === current) {
      setError("Le nouveau mot de passe doit être différent de l'ancien.");
      return;
    }
    setBusy(true);
    // vérification et enregistrement par le serveur (l'ancien mot de passe n'est plus comparé dans le navigateur)
    const res = await authChangePassword(current, next.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setSuccess('Votre mot de passe a été modifié. Utilisez-le à votre prochaine connexion.');
    setTimeout(onClose, 1800);
  };

  const field = 'w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';

  return createPortal(
    <div
      className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-[60]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="parent-pwd-title"
      data-testid="parent-password-modal"
    >
      <form onSubmit={submit} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 text-blue-900 rounded-lg">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 id="parent-pwd-title" className="font-bold text-base text-slate-900">
                Changer mon mot de passe
              </h3>
              <p className="text-xs text-slate-500">Compte : {currentUser.name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer rounded-lg" aria-label="Fermer" data-testid="parent-pwd-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="block text-xs font-semibold text-slate-700">
          Mot de passe actuel
          <input
            ref={firstField}
            type={show ? 'text' : 'password'}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            className={field + ' mt-1'}
            data-testid="parent-pwd-current"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Nouveau mot de passe <span className="font-normal text-slate-500">({MIN_LENGTH} caractères au moins)</span>
          <input
            type={show ? 'text' : 'password'}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            className={field + ' mt-1'}
            data-testid="parent-pwd-new"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          Confirmer le nouveau mot de passe
          <input
            type={show ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className={field + ' mt-1'}
            data-testid="parent-pwd-confirm"
          />
        </label>

        <button type="button" onClick={() => setShow((v) => !v)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-900 hover:underline cursor-pointer" data-testid="parent-pwd-toggle">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {show ? 'Masquer les mots de passe' : 'Afficher les mots de passe'}
        </button>

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2" role="alert" data-testid="parent-pwd-error">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" /> {error}
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2" role="status" data-testid="parent-pwd-success">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" /> {success}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer">
            Annuler
          </button>
          <button type="submit" disabled={busy || !!success} className="px-4 py-2.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg cursor-pointer" data-testid="parent-pwd-submit">
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
};
