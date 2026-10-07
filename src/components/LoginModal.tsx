import React, { useState } from 'react';
import { User, UserRole } from '../types';
import { authLogin, authFailureMessage } from '../utils/auth';
import { sortUsersByName } from '../utils/sortUsers';
import { Lock, ShieldCheck, KeyRound, AlertCircle, CheckCircle, ArrowRight, Eye, EyeOff, X } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  currentUser: User;
  targetUser?: User | null;
  onSuccessLogin: (user: User) => void;
  targetTabName?: string;
  targetRole?: UserRole;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  users,
  currentUser,
  targetUser: initialTargetUser,
  onSuccessLogin,
  targetTabName,
  targetRole,
}) => {
  const isAdmin = currentUser.role === 'admin';
  // Accès à l'espace d'un AUTRE rôle : le serveur vérifie le mot de passe (la liste des comptes de ce rôle n'est plus fournie)
  const crossRole = !isAdmin && !!targetRole && targetRole !== currentUser.role;
  const [identifierInput, setIdentifierInput] = useState<string>('');

  // Un parent ou un organisateur ne doit voir/pouvoir sélectionner que des comptes
  // de son propre rôle : les comptes Direction/Administration et Organisateurs
  // ne doivent jamais apparaître dans ce sélecteur pour un parent.
  const selectableUsers = sortUsersByName(isAdmin ? users : users.filter((u) => u.role === currentUser.role));

  const [selectedUserId, setSelectedUserId] = useState<string>(
    initialTargetUser ? initialTargetUser.id : selectableUsers[0]?.id || ''
  );
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  if (!isOpen) return null;

  const targetUser = selectableUsers.find((u) => u.id === selectedUserId) || selectableUsers[0];

  const handleSelectUser = (u: User) => {
    setSelectedUserId(u.id);
    setPasswordInput('');
    setErrorMsg('');
    setSuccessMsg('');
  };

  const handleAuthenticate = (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!targetUser && !crossRole) return;

    // Admin has access to all profiles without password check!
    if (isAdmin) {
      setSuccessMsg(`Accès Administrateur accordé pour le compte ${targetUser.name}`);
      setTimeout(() => {
        onSuccessLogin(targetUser);
        onClose();
      }, 400);
      return;
    }

    // Vérification par le serveur (build auth-20261006) : le mot de passe n'est plus comparé dans le navigateur
    const role = ((crossRole ? targetRole : targetUser && targetUser.role) || currentUser.role) as UserRole;
    const identifier = crossRole ? identifierInput.trim() : (targetUser && targetUser.email) || '';
    setErrorMsg('');
    authLogin(role, identifier, passwordInput).then((res) => {
      if (res.ok) {
        setSuccessMsg(`Authentification réussie ! Bienvenue ${res.user.name}`);
      } else {
        setErrorMsg(authFailureMessage(res, 'Mot de passe incorrect pour ce compte. Veuillez réessayer.'));
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-100 text-blue-900 rounded-xl">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Authentification & Accès sécurisé
              </h3>
              <p className="text-xs text-slate-500">
                {targetTabName ? `Accès à : ${targetTabName}` : 'Changer de profil utilisateur'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Admin Bypass Banner */}
        {isAdmin && (
          <div className="my-4 p-3 bg-purple-50 border border-purple-200 rounded-xl flex items-start gap-2.5 text-xs text-purple-900">
            <ShieldCheck className="w-5 h-5 text-purple-700 shrink-0 mt-0.5" />
            <div>
              <strong className="block font-bold">Privilège Administrateur Universel</strong>
              <span>
                Vous êtes connecté en tant qu'administrateur. Conformément aux spécifications, l'admin a accès à tous les profils et tous les espaces sans mot de passe requis.
              </span>
            </div>
          </div>
        )}

        {/* User profile selection */}
        {!crossRole && (
        <div className="my-4 space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
            Sélectionnez le profil à utiliser :
          </label>

          <div className="space-y-2">
            {selectableUsers.map((u) => {
              const isSelected = u.id === selectedUserId;
              return (
                <div
                  key={u.id}
                  onClick={() => handleSelectUser(u)}
                  className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                    isSelected
                      ? 'border-blue-900 bg-blue-50/70 ring-2 ring-blue-900/20'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs ${
                        u.role === 'admin'
                          ? 'bg-purple-100 text-purple-900'
                          : u.role === 'organizer'
                          ? 'bg-blue-100 text-blue-900'
                          : 'bg-emerald-100 text-emerald-900'
                      }`}
                    >
                      {u.name.charAt(0)}
                    </div>
                    <div>
                      <span className="font-bold text-xs text-slate-900 block leading-tight">
                        {u.name}
                      </span>
                      <span className="text-[11px] text-slate-500">{u.email}</span>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                      u.role === 'admin'
                        ? 'bg-purple-100 text-purple-800'
                        : u.role === 'organizer'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {u.role === 'admin' ? 'Direction' : u.role === 'organizer' ? 'Organisateur' : 'Parent'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {crossRole && targetRole !== 'admin' && (
          <div className="my-4">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
              {targetRole === 'organizer' ? 'Identifiant (e-mail) — facultatif' : 'Adresse e-mail'}
            </label>
            <input
              type="text"
              value={identifierInput}
              onChange={(e) => {
                setIdentifierInput(e.target.value);
                setErrorMsg('');
              }}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:ring-2 focus:ring-blue-900 focus:outline-none"
              data-testid="login-modal-identifier"
            />
          </div>
        )}

        {/* Password field (if not bypassed by admin) */}
        {!isAdmin ? (
          <form onSubmit={handleAuthenticate} className="space-y-3 mt-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-bold uppercase text-slate-700">
                  Mot de passe du compte *
                </label>
              </div>

              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoFocus
                  required
                  value={passwordInput}
                  onChange={(e) => {
                    setPasswordInput(e.target.value);
                    setErrorMsg('');
                  }}
                  placeholder="Saisissez le mot de passe..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 pr-10 text-xs text-slate-900 focus:ring-2 focus:ring-blue-900 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-800">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Déverrouiller le profil</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="pt-2">
            {successMsg && (
              <div className="p-2.5 mb-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-800">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => handleAuthenticate()}
                className="flex items-center gap-1.5 px-4 py-2 bg-purple-900 hover:bg-purple-950 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>Bascule immédiate (Admin)</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
