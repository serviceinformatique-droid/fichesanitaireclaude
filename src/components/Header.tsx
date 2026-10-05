import React, { useState } from 'react';
import { User, NotificationItem } from '../types';
import { Bell, ShieldCheck, FileText, CheckCircle2, AlertTriangle, Info, LogOut, Lock, KeyRound } from 'lucide-react';
import { LoginModal } from './LoginModal';
import { sortUsersByName } from '../utils/sortUsers';

interface HeaderProps {
  currentUser: User;
  users: User[];
  onSwitchUser: (user: User) => void;
  // Administrateur d'origine quand il consulte un autre compte (retour sans reconnexion)
  originAdmin?: User | null;
  notifications: NotificationItem[];
  onMarkNotificationRead: (id: string) => void;
  activeTab: 'parent' | 'organizer' | 'admin' | 'cerfa_view' | 'cerfa_edit';
  onSelectTab: (tab: 'parent' | 'organizer' | 'admin') => void;
  onLogout?: () => void;
  establishmentName?: string;
  logoUrl?: string | null;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  users,
  onSwitchUser,
  originAdmin = null,
  notifications,
  onMarkNotificationRead,
  activeTab,
  onSelectTab,
  onLogout,
  establishmentName,
  logoUrl,
}) => {
  const [showNotifs, setShowNotifs] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [pendingTargetUser, setPendingTargetUser] = useState<User | null>(null);
  const [pendingTargetTabName, setPendingTargetTabName] = useState<string>('');

  // Filter notifications relevant to current user/role
  const userNotifs = notifications.filter(
    (n) => n.targetRole === 'all' || n.targetRole === currentUser.role || n.targetUserId === currentUser.id
  );
  const unreadCount = userNotifs.filter((n) => !n.read).length;

  const handleTabClick = (tab: 'parent' | 'organizer' | 'admin') => {
    // Admin has access to all spaces directly!
    if (currentUser.role === 'admin') {
      onSelectTab(tab);
      return;
    }

    // L'administrateur qui consulte un autre compte retrouve son espace sans mot de passe
    if (originAdmin && tab === 'admin') {
      onSwitchUser(originAdmin);
      return;
    }

    if (tab === 'parent') {
      if (currentUser.role === 'parent') {
        onSelectTab('parent');
      } else {
        const parentUser = users.find((u) => u.role === 'parent') || users[0];
        setPendingTargetUser(parentUser);
        setPendingTargetTabName('Espace Parents');
        setShowLoginModal(true);
      }
    } else if (tab === 'organizer') {
      if (currentUser.role === 'organizer') {
        onSelectTab('organizer');
      } else {
        const orgUser = users.find((u) => u.role === 'organizer') || users[1];
        setPendingTargetUser(orgUser);
        setPendingTargetTabName('Espace Organisateurs');
        setShowLoginModal(true);
      }
    } else if (tab === 'admin') {
      const adminUser = users.find((u) => u.role === 'admin') || users[2];
      setPendingTargetUser(adminUser);
      setPendingTargetTabName('Espace Administrateur');
      setShowLoginModal(true);
    }
  };

  const handleUserSelectChange = (userId: string) => {
    const target = users.find((item) => item.id === userId);
    if (!target) return;

    if (currentUser.role === 'admin' || originAdmin) {
      // Admin (ou admin en consultation d'un autre compte) : accès immédiat sans mot de passe
      onSwitchUser(target);
    } else {
      setPendingTargetUser(target);
      setPendingTargetTabName(`Compte de ${target.name}`);
      setShowLoginModal(true);
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs print:hidden">
      {/* Top Banner: République Française */}
      <div className="bg-slate-900 text-white text-xs px-4 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-semibold tracking-wider uppercase text-[11px] text-slate-200">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
            RÉPUBLIQUE FRANÇAISE
          </div>
        </div>
        <div className="flex items-center gap-2 text-slate-300">
          <span className="bg-blue-950 text-blue-300 px-2 py-0.5 rounded text-[10px] font-mono border border-blue-800">
            Fiche Sanitaire de Liaison
          </span>
          <span className="hidden md:inline text-[11px] text-emerald-400 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 inline" /> Conforme RGPD & Données de santé
          </span>
        </div>
      </div>

      {/* Main Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-900 flex items-center justify-center text-white shadow-xs overflow-hidden shrink-0">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo de l'établissement" className="w-full h-full object-contain bg-white" />
              ) : (
                <FileText className="w-5 h-5 text-blue-200" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-slate-900 text-base sm:text-lg leading-tight tracking-tight">
                  Portail Fiche Sanitaire de Liaison
                </h1>
                <span className="bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded-full font-medium border border-slate-200 hidden sm:inline">
                  {establishmentName || 'Établissement scolaire'}
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                Dématérialisation officielle de la fiche sanitaire de liaison
              </p>
            </div>
          </div>

          {/* Navigation Spaces based on Role: Hidden for parents */}
          {currentUser.role !== 'parent' && (
            <nav className="hidden md:flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
              <button
                onClick={() => handleTabClick('parent')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'parent'
                    ? 'bg-white text-blue-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <span>👨‍👩‍👧 Espace Parents</span>
              </button>
              <button
                onClick={() => handleTabClick('organizer')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'organizer'
                    ? 'bg-white text-blue-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <span>📋 Espace Organisateurs</span>
              </button>
              <button
                onClick={() => handleTabClick('admin')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'admin'
                    ? 'bg-white text-blue-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <span>🛡️ Administrateur</span>
              </button>
            </nav>
          )}

          {/* Right Controls: Role Switcher & Notifications */}
          <div className="flex items-center gap-3">
            {/* Quick Switch User with Password — réservé aux administrateurs :
                ni les parents ni les organisateurs ne doivent pouvoir changer de compte */}
            {(currentUser.role === 'admin' || originAdmin) && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (originAdmin && currentUser.role !== 'admin') {
                      onSwitchUser(originAdmin);
                      return;
                    }
                    setPendingTargetUser(null);
                    setPendingTargetTabName('Sélection du profil');
                    setShowLoginModal(true);
                  }}
                  className={`text-xs px-2.5 py-1.5 rounded-md font-semibold flex items-center gap-1.5 border transition-all cursor-pointer ${
                    currentUser.role === 'admin'
                      ? 'bg-purple-50 text-purple-900 border-purple-200 hover:bg-purple-100'
                      : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                  }`}
                  title="Changer de profil ou vérifier mot de passe"
                >
                  {currentUser.role === 'admin' ? (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5 text-purple-700" />
                      <span className="hidden sm:inline">Admin (Accès total)</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
                      <span data-testid="return-admin">Revenir à {originAdmin ? originAdmin.name : 'l\'administrateur'}</span>
                    </>
                  )}
                </button>

                <select
                  id="user-switch"
                  value={currentUser.id}
                  onChange={(e) => handleUserSelectChange(e.target.value)}
                  className="hidden lg:block bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-md px-2 py-1.5 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer max-w-[140px] sm:max-w-none"
                >
                  {(['admin', 'organizer', 'parent'] as const).map((r) => {
                    const group = sortUsersByName(users.filter((u) => u.role === r));
                    if (group.length === 0) return null;
                    return (
                      <optgroup
                        key={r}
                        label={r === 'admin' ? 'Administrateurs' : r === 'organizer' ? 'Professeurs' : `Parents (${group.length})`}
                      >
                        {group.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.role === 'parent' ? '👨‍👩‍👧 ' : u.role === 'organizer' ? '📋 ' : '🛡️ '}
                            {u.name} ({u.role === 'admin' ? 'Admin' : u.role === 'organizer' ? 'Prof' : 'Parent'})
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>
            )}

            {/* Déconnexion / Retour portail */}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="p-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                title="Se déconnecter / Changer de profil"
                aria-label="Déconnexion"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}

            {/* Notification Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowNotifs(!showNotifs)}
                className="relative p-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                title="Notifications"
                aria-label="Notifications"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-red-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {/* Notification Popover */}
              {showNotifs && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="font-semibold text-xs text-slate-800 flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5 text-blue-600" /> Notifications système ({userNotifs.length})
                    </span>
                    <button
                      onClick={() => setShowNotifs(false)}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      Fermer
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                    {userNotifs.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-500">
                        Aucune notification pour le moment.
                      </div>
                    ) : (
                      userNotifs.map((n) => (
                        <div
                          key={n.id}
                          className={`p-3 text-xs transition-colors hover:bg-slate-50 flex items-start gap-2.5 ${
                            !n.read ? 'bg-blue-50/40' : ''
                          }`}
                        >
                          <div className="mt-0.5 shrink-0">
                            {n.type === 'alert' && <AlertTriangle className="w-4 h-4 text-red-500" />}
                            {n.type === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                            {n.type === 'info' && <Info className="w-4 h-4 text-blue-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-800 leading-snug">{n.title}</p>
                            <p className="text-slate-600 mt-0.5 leading-relaxed">{n.message}</p>
                            <span className="text-[10px] text-slate-400 mt-1 block">
                              {new Date(n.date).toLocaleDateString('fr-FR', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          {!n.read && (
                            <button
                              onClick={() => onMarkNotificationRead(n.id)}
                              className="text-slate-400 hover:text-blue-600 shrink-0"
                              title="Marquer comme lu"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Submenu tabs: Hidden for parents */}
        {currentUser.role !== 'parent' && (
          <div className="flex md:hidden items-center justify-around py-2 border-t border-slate-200 text-xs">
            <button
              onClick={() => handleTabClick('parent')}
              className={`px-2.5 py-1 font-medium rounded ${
                activeTab === 'parent' ? 'bg-blue-900 text-white' : 'text-slate-600'
              }`}
            >
              Parents
            </button>
            <button
              onClick={() => handleTabClick('organizer')}
              className={`px-2.5 py-1 font-medium rounded ${
                activeTab === 'organizer' ? 'bg-blue-900 text-white' : 'text-slate-600'
              }`}
            >
              Organisateurs
            </button>
            <button
              onClick={() => handleTabClick('admin')}
              className={`px-2.5 py-1 font-medium rounded ${
                activeTab === 'admin' ? 'bg-blue-900 text-white' : 'text-slate-600'
              }`}
            >
              Administrateur
            </button>
          </div>
        )}
      </div>

      {/* Authentication & Profile Switching Modal */}
      {showLoginModal && (
        <LoginModal
          isOpen={showLoginModal}
          onClose={() => setShowLoginModal(false)}
          users={users}
          currentUser={currentUser}
          targetUser={pendingTargetUser}
          targetTabName={pendingTargetTabName}
          onSuccessLogin={(authenticatedUser) => {
            onSwitchUser(authenticatedUser);
            // If user wanted to go to a specific tab, switch to it
            if (pendingTargetTabName.includes('Parents')) onSelectTab('parent');
            else if (pendingTargetTabName.includes('Organisateurs')) onSelectTab('organizer');
            else if (pendingTargetTabName.includes('Administration')) onSelectTab('admin');
            setShowLoginModal(false);
          }}
        />
      )}
    </header>
  );
};
