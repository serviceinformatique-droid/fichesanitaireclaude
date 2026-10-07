import React, { useState, useMemo, useEffect } from 'react';
import { User, Trip, Student, SECRET_QUESTIONS } from '../types';
import { CerfaOfficialView } from './CerfaOfficialView';
import {
  authLogin,
  authRegister,
  authResetPassword,
  authSecretQuestion,
  authChaperone,
  authLogout,
  authFailureMessage,
  getChaperoneSession,
  takeGateMode,
  takeExpiredFlag,
} from '../utils/auth';

// État de l'écran à l'ouverture de la page (lu une seule fois) : accompagnateur déjà connecté, onglet demandé, session expirée
const GATE_BOOT = { chaperoneTrip: getChaperoneSession(), mode: takeGateMode(), expired: takeExpiredFlag() };
import {
  ShieldCheck,
  FileText,
  Lock,
  UserPlus,
  ArrowRight,
  HelpCircle,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Users,
  Shield,
  Briefcase,
  ChevronLeft,
  KeyRound,
  GraduationCap,
} from 'lucide-react';

interface StartupAuthGateProps {
  users: User[];
  trips?: Trip[];
  students?: Student[];
  onLoginSuccess: (user: User) => void;
  onRegisterParent: (newParent: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    password: string;
    secretQuestion: string;
    secretAnswer: string;
  }) => User;
  onPurgeDemo?: () => void;
  onResetDemo?: () => void;
  onResetPasswordWithSecret: (email: string, secretAnswer: string, newPassword: string) => { success: boolean; message: string; user?: User };
  logoUrl?: string | null;
  establishmentName?: string;
}

export const StartupAuthGate: React.FC<StartupAuthGateProps> = ({
  users,
  trips = [],
  students = [],
  onLoginSuccess,
  onRegisterParent,
  onPurgeDemo,
  onResetDemo,
  onResetPasswordWithSecret,
  logoUrl,
  establishmentName,
}) => {
  // Main view modes: 'parent_login' | 'parent_register' | 'parent_forgot' | 'staff_login' | 'chaperone_access'
  const [viewMode, setViewMode] = useState<'parent_login' | 'parent_register' | 'parent_forgot' | 'staff_login' | 'chaperone_access'>(
    (GATE_BOOT.chaperoneTrip ? 'chaperone_access' : (GATE_BOOT.mode as any)) || 'parent_login'
  );

  // Accompanying teacher ("chaperone") access state
  const [chaperoneTripId, setChaperoneTripId] = useState<string>('');
  const [chaperonePasswordInput, setChaperonePasswordInput] = useState<string>('');
  const [chaperoneAuthenticatedTripId, setChaperoneAuthenticatedTripId] = useState<string>(GATE_BOOT.chaperoneTrip);
  const [chaperoneClassFilter, setChaperoneClassFilter] = useState<string>('all');
  const [chaperoneViewingStudent, setChaperoneViewingStudent] = useState<Student | null>(null);
  const [chaperoneShowPassword, setChaperoneShowPassword] = useState<boolean>(false);


  // Parent login form state
  const [parentEmailInput, setParentEmailInput] = useState<string>('');
  const [parentPasswordInput, setParentPasswordInput] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // Staff login state
  const [staffRole, setStaffRole] = useState<'organizer' | 'admin'>('organizer');
  const [staffPasswordInput, setStaffPasswordInput] = useState<string>('');
  const [staffEmailInput, setStaffEmailInput] = useState<string>('');

  // Parent registration state
  const [regFirstName, setRegFirstName] = useState<string>('');
  const [regLastName, setRegLastName] = useState<string>('');
  const [regEmail, setRegEmail] = useState<string>('');
  const [regPhone, setRegPhone] = useState<string>('');
  const [regPassword, setRegPassword] = useState<string>('');
  const [regConfirmPassword, setRegConfirmPassword] = useState<string>('');
  const [regQuestion, setRegQuestion] = useState<string>(SECRET_QUESTIONS[0]);
  const [regAnswer, setRegAnswer] = useState<string>('');

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState<string>('');
  const [forgotAnswer, setForgotAnswer] = useState<string>('');
  const [forgotNewPassword, setForgotNewPassword] = useState<string>('');

  // Messages
  const [errorMsg, setErrorMsg] = useState<string>(GATE_BOOT.expired ? 'Votre session a expiré. Veuillez vous reconnecter.' : '');
  const [successMsg, setSuccessMsg] = useState<string>('');

  // Clear errors when changing modes
  const switchMode = (mode: 'parent_login' | 'parent_register' | 'parent_forgot' | 'staff_login' | 'chaperone_access') => {
    // un accompagnateur connecté qui change d'onglet ferme sa session (le jeton de voyage ne sert qu'à ce voyage)
    if (GATE_BOOT.chaperoneTrip && chaperoneAuthenticatedTripId) {
      authLogout(mode);
      return;
    }
    setViewMode(mode);
    setErrorMsg('');
    setSuccessMsg('');
    setParentPasswordInput('');
    setStaffPasswordInput('');
    setChaperonePasswordInput('');
    setChaperoneTripId('');
    setChaperoneAuthenticatedTripId('');
    setChaperoneClassFilter('all');
    setChaperoneViewingStudent(null);
  };

  // Handle Chaperone (accompanying teacher) trip access
  const handleChaperoneAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!chaperoneTripId) {
      setErrorMsg('Veuillez sélectionner un voyage.');
      return;
    }
    // le mot de passe du voyage est vérifié par le serveur ; la page se recharge ensuite avec les seuls élèves de ce voyage
    const res = await authChaperone(chaperoneTripId, chaperonePasswordInput);
    if (!res.ok) setErrorMsg(res.message);
  };

  const chaperoneTrip = trips.find((t) => t.id === chaperoneAuthenticatedTripId) || null;

  const chaperoneEnrolledStudents = useMemo(() => {
    if (!chaperoneAuthenticatedTripId) return [];
    return students
      .filter((s) => s.registeredTripIds?.includes(chaperoneAuthenticatedTripId))
      .filter((s) => chaperoneClassFilter === 'all' || s.schoolClass === chaperoneClassFilter)
      .sort((a, b) => a.cerfa.identity.lastName.localeCompare(b.cerfa.identity.lastName, 'fr'));
  }, [students, chaperoneAuthenticatedTripId, chaperoneClassFilter]);

  const chaperoneAvailableClasses = useMemo(() => {
    const set = new Set<string>();
    students
      .filter((s) => s.registeredTripIds?.includes(chaperoneAuthenticatedTripId))
      .forEach((s) => set.add(s.schoolClass));
    return Array.from(set).sort();
  }, [students, chaperoneAuthenticatedTripId]);

  // Handle Parent Login
  const handleParentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const query = parentEmailInput.trim().toLowerCase();
    if (!query) {
      setErrorMsg('Veuillez renseigner votre adresse email ou identifiant.');
      return;
    }
    if (!parentPasswordInput) {
      setErrorMsg('Veuillez renseigner votre mot de passe.');
      return;
    }

    // Vérification par le serveur (build auth-20261006) : le mot de passe n'est plus comparé dans le navigateur
    const res = await authLogin('parent', query, parentPasswordInput);
    if (res.ok) {
      setSuccessMsg(`Connexion réussie ! Bienvenue ${res.user.name}`);
    } else {
      setErrorMsg(authFailureMessage(res, 'Identifiant ou mot de passe incorrect.'));
    }
  };

  // Handle Parent Registration
  const handleParentRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!regLastName.trim() || !regFirstName.trim() || !regEmail.trim() || !regPassword.trim() || !regAnswer.trim()) {
      setErrorMsg('Tous les champs obligatoires doivent être renseignés (Nom, Prénom, Email, Mot de passe, Question secrète).');
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setErrorMsg('Les deux mots de passe ne correspondent pas.');
      return;
    }

    if (regPassword.length < 6) {
      setErrorMsg('Le mot de passe doit comporter au moins 6 caractères.');
      return;
    }

    // Création du compte par le serveur (adresse unique, mot de passe haché, message d'accueil, connexion immédiate)
    const result = await authRegister({
      firstName: regFirstName.trim(),
      lastName: regLastName.trim(),
      email: regEmail.trim().toLowerCase(),
      phone: regPhone.trim(),
      password: regPassword,
      secretQuestion: regQuestion,
      secretAnswer: regAnswer.trim(),
    });
    if (!result.ok) {
      setErrorMsg(result.message);
      return;
    }
    setSuccessMsg(`Compte parent créé avec succès pour ${result.user.name} ! Connexion en cours...`);
  };

  // Handle Staff (Organizer / Admin) Login
  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const res =
      staffRole === 'admin'
        ? await authLogin('admin', '', staffPasswordInput)
        : await authLogin('organizer', staffEmailInput.trim(), staffPasswordInput);
    if (res.ok) {
      setSuccessMsg(`Accès autorisé : ${res.user.name}`);
    } else {
      setErrorMsg(authFailureMessage(res, staffRole === 'admin' ? 'Mot de passe administrateur incorrect.' : 'Identifiant ou mot de passe incorrect.'));
    }
  };

  // Handle Forgot Password
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!forgotEmail.trim() || !forgotAnswer.trim() || !forgotNewPassword.trim()) {
      setErrorMsg('Veuillez renseigner votre email, la réponse à la question secrète et le nouveau mot de passe.');
      return;
    }

    const res = await authResetPassword(forgotEmail.trim().toLowerCase(), forgotAnswer.trim(), forgotNewPassword);
    if (!res.ok) {
      setErrorMsg(res.message);
      return;
    }
    setSuccessMsg('Mot de passe mis à jour avec succès !');
  };

  // Question secrète du compte saisi (demandée au serveur : la liste des comptes n'est plus dans le navigateur)
  const [forgotQuestion, setForgotQuestion] = useState<string | null>(null);
  useEffect(() => {
    const email = forgotEmail.trim().toLowerCase();
    if (!email.includes('@')) {
      setForgotQuestion(null);
      return;
    }
    const timer = setTimeout(() => {
      authSecretQuestion(email).then(setForgotQuestion);
    }, 350);
    return () => clearTimeout(timer);
  }, [forgotEmail]);

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-between selection:bg-blue-500 selection:text-white">
      {/* Top Banner */}
      <header className="bg-slate-950 border-b border-slate-800 text-white text-xs py-2 px-4">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
            <span className="text-slate-400 text-xs">
              Ministère chargé de la Jeunesse et des Sports — Éducation Nationale
            </span>
          </div>
          <div className="flex items-center gap-2 text-slate-300 font-mono text-[11px]">
            <span className="bg-blue-900/60 border border-blue-700 px-2 py-0.5 rounded text-blue-300 font-medium">
              Fiche Sanitaire Officielle
            </span>
            <span className="text-emerald-400 hidden md:inline flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 inline" /> Portail Sécurisé
            </span>
          </div>
        </div>
      </header>

      {/* Main Authentication Card */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 my-6">
        <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
          {/* Card Top Title */}
          <div className="bg-gradient-to-r from-blue-950 via-slate-900 to-blue-900 text-white p-6 sm:p-7">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-600/30 border border-blue-400/30 flex items-center justify-center shrink-0 overflow-hidden">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo de l'établissement" className="w-full h-full object-contain bg-white" />
                ) : (
                  <FileText className="w-6 h-6 text-blue-300" />
                )}
              </div>
              <div>
                <span className="inline-block bg-blue-500/20 text-blue-300 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-blue-400/30 mb-1">
                  {establishmentName || 'Établissement scolaire'}
                </span>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight leading-snug">
                  Fiche Sanitaire de Liaison
                </h1>
                <p className="text-xs text-blue-200/80 mt-0.5">
                  Accès dématérialisé conforme à la réglementation des séjours scolaires
                </p>
              </div>
            </div>
          </div>

          {/* Feedback Messages */}
          {errorMsg && (
            <div className="mx-6 mt-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800 animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="mx-6 mt-5 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-xs text-emerald-800 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="p-6 sm:p-7">
            {/* ============================================================ */}
            {/* VIEW 1: PARENT LOGIN                                         */}
            {/* ============================================================ */}
            {viewMode === 'parent_login' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                      <Users className="w-5 h-5 text-blue-600" />
                      <span>Espace Parents</span>
                    </h2>
                    <p className="text-xs text-slate-500">
                      Saisissez le mot de passe de votre profil parent
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => switchMode('parent_register')}
                    className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    Créer mon compte
                  </button>
                </div>

                <form onSubmit={handleParentLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Adresse email ou identifiant :
                    </label>
                    <input
                      type="text"
                      required
                      value={parentEmailInput}
                      onChange={(e) => setParentEmailInput(e.target.value)}
                      placeholder="votre.email@exemple.fr ou identifiant"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Mot de passe parent :
                      </label>
                      <button
                        type="button"
                        onClick={() => switchMode('parent_forgot')}
                        className="text-[11px] text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                      >
                        Mot de passe oublié ?
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={parentPasswordInput}
                        onChange={(e) => setParentPasswordInput(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-blue-900 hover:bg-blue-800 text-white font-bold py-3 px-4 rounded-xl text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Se connecter à mon Espace Parent</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>

                {/* Primary option to create account for new parents */}
                <div className="pt-3 border-t border-slate-100 text-center">
                  <p className="text-xs text-slate-600 mb-2">
                    Première fois sur le portail sanitaire ?
                  </p>
                  <button
                    type="button"
                    onClick={() => switchMode('parent_register')}
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3.5 px-4 rounded-xl text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                  >
                    <UserPlus className="w-5 h-5 text-white" />
                    <span>Créer un nouveau compte parent</span>
                  </button>
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* VIEW 2: PARENT REGISTRATION (Nom, Prénom, Mot de passe, 8 Qs)*/}
            {/* ============================================================ */}
            {viewMode === 'parent_register' && (
              <div className="space-y-4">
                <div className="pb-3 border-b border-slate-100">
                  <button
                    type="button"
                    onClick={() => switchMode('parent_login')}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-2 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" /> Retour à la connexion
                  </button>
                  <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <UserPlus className="w-5 h-5 text-blue-600" />
                    <span>Création du compte Parent</span>
                  </h2>
                  <p className="text-xs text-slate-500">
                    Chaque parent doit créer son compte lors de sa première visite pour remplir et signer la fiche sanitaire.
                  </p>
                </div>

                <form onSubmit={handleParentRegister} className="space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Nom de famille <span className="text-rose-500">*</span> :
                      </label>
                      <input
                        type="text"
                        required
                        value={regLastName}
                        onChange={(e) => setRegLastName(e.target.value)}
                        placeholder="ex: DUPONT"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Prénom <span className="text-rose-500">*</span> :
                      </label>
                      <input
                        type="text"
                        required
                        value={regFirstName}
                        onChange={(e) => setRegFirstName(e.target.value)}
                        placeholder="ex: Claire"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Adresse Email <span className="text-rose-500">*</span> :
                      </label>
                      <input
                        type="email"
                        required
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="claire.dupont@email.fr"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Téléphone portable :
                      </label>
                      <input
                        type="tel"
                        value={regPhone}
                        onChange={(e) => setRegPhone(e.target.value)}
                        placeholder="06 12 34 56 78"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Mot de passe <span className="text-rose-500">*</span> :
                      </label>
                      <input
                        type="password"
                        required
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                        Confirmer le mot de passe <span className="text-rose-500">*</span> :
                      </label>
                      <input
                        type="password"
                        required
                        value={regConfirmPassword}
                        onChange={(e) => setRegConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Secret Question (8 Choices) */}
                  <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-2xl space-y-2.5">
                    <div className="flex items-center gap-2">
                      <HelpCircle className="w-4 h-4 text-blue-700 shrink-0" />
                      <label className="block text-xs font-bold text-blue-950 uppercase tracking-wider">
                        Question secrète de récupération <span className="text-rose-600">*</span> :
                      </label>
                    </div>
                    <select
                      value={regQuestion}
                      onChange={(e) => setRegQuestion(e.target.value)}
                      className="w-full bg-white border border-blue-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    >
                      {SECRET_QUESTIONS.map((q, idx) => (
                        <option key={idx} value={q}>
                          {idx + 1}. {q}
                        </option>
                      ))}
                    </select>

                    <div>
                      <label className="block text-[11px] font-bold text-blue-900 uppercase tracking-wider mb-1">
                        Votre réponse secrète <span className="text-rose-600">*</span> :
                      </label>
                      <input
                        type="text"
                        required
                        value={regAnswer}
                        onChange={(e) => setRegAnswer(e.target.value)}
                        placeholder="Votre réponse (ex: Martin, Minou, Lyon...)"
                        className="w-full bg-white border border-blue-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                      <p className="text-[10px] text-blue-800/80 mt-1">
                        Cette réponse vous permettra de réinitialiser votre mot de passe en cas d'oubli sans contacter l'établissement.
                      </p>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-blue-900 hover:bg-blue-800 text-white font-bold py-3 px-4 rounded-xl text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
                  >
                    <span>Créer mon compte et accéder à mon espace</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              </div>
            )}

            {/* ============================================================ */}
            {/* VIEW 3: PARENT FORGOT PASSWORD (Secret Question)             */}
            {/* ============================================================ */}
            {viewMode === 'parent_forgot' && (
              <div className="space-y-4">
                <div className="pb-3 border-b border-slate-100">
                  <button
                    type="button"
                    onClick={() => switchMode('parent_login')}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-2 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" /> Retour à la connexion
                  </button>
                  <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-blue-600" />
                    <span>Récupération par question secrète</span>
                  </h2>
                  <p className="text-xs text-slate-500">
                    Répondez à votre question secrète pour réinitialiser immédiatement votre mot de passe.
                  </p>
                </div>

                <form onSubmit={handleForgotPassword} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Votre adresse email :
                    </label>
                    <input
                      type="email"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="claire.dupont@email.fr"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  {forgotQuestion && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900">
                      <strong className="block font-bold">Votre question secrète enregistrée :</strong>
                      <span className="italic mt-0.5 block font-medium">
                        « {forgotQuestion} »
                      </span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Votre réponse secrète :
                    </label>
                    <input
                      type="text"
                      required
                      value={forgotAnswer}
                      onChange={(e) => setForgotAnswer(e.target.value)}
                      placeholder="Entrez votre réponse secrète"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Nouveau mot de passe :
                    </label>
                    <input
                      type="password"
                      required
                      value={forgotNewPassword}
                      onChange={(e) => setForgotNewPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-blue-900 hover:bg-blue-800 text-white font-bold py-3 px-4 rounded-xl text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Réinitialiser et me connecter</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              </div>
            )}

            {/* ============================================================ */}
            {/* VIEW 4: STAFF LOGIN (Organisateurs / Administrateur)        */}
            {/* ============================================================ */}
            {viewMode === 'staff_login' && (
              <div className="space-y-4">
                <div className="pb-3 border-b border-slate-100">
                  <button
                    type="button"
                    onClick={() => switchMode('parent_login')}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-2 cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" /> Revenir à l'Espace Parents
                  </button>
                  <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-purple-700" />
                    <span>Accès Personnel & Organisateur</span>
                  </h2>
                  <p className="text-xs text-slate-500">
                    Connexion réservée aux professeurs organisateurs et à la direction / administration.
                  </p>
                </div>

                {/* Toggle Organizer / Admin */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      setStaffRole('organizer');
                      setStaffPasswordInput('');
                      setErrorMsg('');
                    }}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      staffRole === 'organizer'
                        ? 'bg-white text-blue-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Briefcase className="w-3.5 h-3.5" />
                    <span>Organisateur</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStaffRole('admin');
                      setStaffPasswordInput('');
                      setErrorMsg('');
                    }}
                    className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      staffRole === 'admin'
                        ? 'bg-white text-purple-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span>Administration</span>
                  </button>
                </div>

                <form onSubmit={handleStaffLogin} className="space-y-3.5">
                  {staffRole === 'organizer' ? (
                    <>
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900">
                        <p className="font-semibold">
                          Espace réservé aux enseignants organisateurs de voyages scolaires.
                        </p>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                          Identifiant ou email organisateur :
                        </label>
                        <input
                          type="text"
                          required
                          value={staffEmailInput}
                          onChange={(e) => setStaffEmailInput(e.target.value)}
                          placeholder="votre.email@etablissement.fr"
                          className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-900">
                      <p className="font-semibold">
                        Direction & Administration de l'établissement.
                      </p>
                      <p className="text-[11px] text-purple-700 mt-1">
                        Accès universel à l'ensemble des dossiers scolaires et données sanitaires.
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                      Mot de passe {staffRole === 'admin' ? 'Administrateur' : 'Organisateur'} :
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={staffPasswordInput}
                        onChange={(e) => setStaffPasswordInput(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className={`w-full text-white font-bold py-3 px-4 rounded-xl text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer ${
                      staffRole === 'admin'
                        ? 'bg-purple-900 hover:bg-purple-800'
                        : 'bg-blue-900 hover:bg-blue-800'
                    }`}
                  >
                    <span>Accéder à l'espace {staffRole === 'admin' ? 'Administration' : 'Organisateur'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
              </div>
            )}

            {/* ============================================================ */}
            {/* BOUTON EN DESSOUS : CHANGER DE PROFIL (ORGANISATEUR / ADMIN) */}
            {/* ============================================================ */}
            {viewMode !== 'staff_login' && viewMode !== 'chaperone_access' && (
              <div className="mt-5 pt-4 border-t border-slate-200 space-y-2">
                <button
                  type="button"
                  onClick={() => switchMode('staff_login')}
                  className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 font-semibold py-2.5 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-2 border border-slate-300 cursor-pointer"
                >
                  <Briefcase className="w-3.5 h-3.5 text-slate-600" />
                  <span>Changer de profil (Organisateur / Administrateur)</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('chaperone_access')}
                  className="w-full bg-blue-50 hover:bg-blue-100 text-blue-800 hover:text-blue-900 font-semibold py-2.5 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-2 border border-blue-200 cursor-pointer"
                >
                  <GraduationCap className="w-3.5 h-3.5 text-blue-700" />
                  <span>Accès professeurs accompagnateurs (voyage)</span>
                </button>
              </div>
            )}

            {/* ============================================================ */}
            {/* ACCÈS PROFESSEURS ACCOMPAGNATEURS (mot de passe par voyage)   */}
            {/* ============================================================ */}
            {viewMode === 'chaperone_access' && !chaperoneAuthenticatedTripId && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => switchMode('parent_login')}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 mb-3 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Retour</span>
                </button>

                <div className="flex items-center gap-2 mb-1">
                  <GraduationCap className="w-5 h-5 text-blue-800" />
                  <h2 className="text-base font-bold text-slate-900">Accès Accompagnateurs</h2>
                </div>
                <p className="text-xs text-slate-500 mb-4">
                  Sélectionnez le voyage et saisissez le mot de passe communiqué par l'administration pour consulter les fiches sanitaires des élèves inscrits.
                </p>

                <form onSubmit={handleChaperoneAccess} className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                      Voyage :
                    </label>
                    <select
                      value={chaperoneTripId}
                      onChange={(e) => setChaperoneTripId(e.target.value)}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none"
                      required
                    >
                      <option value="">-- Choisir un voyage --</option>
                      {trips.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.destination})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                      Mot de passe accompagnateur :
                    </label>
                    <div className="relative">
                      <input
                        type={chaperoneShowPassword ? 'text' : 'password'}
                        value={chaperonePasswordInput}
                        onChange={(e) => setChaperonePasswordInput(e.target.value)}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none"
                        placeholder="Mot de passe du voyage"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setChaperoneShowPassword(!chaperoneShowPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                      >
                        {chaperoneShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {errorMsg && (
                    <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-800">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full bg-blue-900 hover:bg-blue-950 text-white font-bold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                  >
                    <Lock className="w-4 h-4" />
                    <span>Accéder aux fiches du voyage</span>
                  </button>
                </form>
              </div>
            )}

            {/* Liste des élèves inscrits au voyage, une fois authentifié */}
            {viewMode === 'chaperone_access' && chaperoneAuthenticatedTripId && chaperoneTrip && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => {
                    authLogout('chaperone_access'); // ferme la session de ce voyage (le jeton ne sert qu'à lui)
                    setChaperoneAuthenticatedTripId('');
                    setChaperonePasswordInput('');
                  }}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 mb-3 cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Changer de voyage</span>
                </button>

                <div className="flex items-center gap-2 mb-1">
                  <GraduationCap className="w-5 h-5 text-blue-800" />
                  <h2 className="text-base font-bold text-slate-900">{chaperoneTrip.name}</h2>
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  {chaperoneTrip.destination} • {chaperoneEnrolledStudents.length} élève(s) affiché(s)
                </p>

                <div className="mb-3">
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Filtrer par classe :
                  </label>
                  <select
                    value={chaperoneClassFilter}
                    onChange={(e) => setChaperoneClassFilter(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 focus:outline-none"
                  >
                    <option value="all">Toutes les classes</option>
                    {chaperoneAvailableClasses.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {chaperoneEnrolledStudents.length === 0 ? (
                    <p className="text-xs text-slate-500 p-4 text-center">Aucun élève pour ce filtre.</p>
                  ) : (
                    chaperoneEnrolledStudents.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setChaperoneViewingStudent(s)}
                        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-blue-50 transition-colors cursor-pointer text-left"
                      >
                        <span className="text-sm">
                          <strong className="text-slate-900">{s.cerfa.identity.lastName.toUpperCase()}</strong>{' '}
                          <span className="text-slate-700">{s.cerfa.identity.firstName}</span>
                          <span className="text-slate-400 text-xs ml-2">({s.schoolClass})</span>
                        </span>
                        <Eye className="w-4 h-4 text-blue-700 shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

          </div>

        </div>
      </main>

      {/* Fiche sanitaire consultée par un accompagnateur (lecture seule) */}
      {chaperoneViewingStudent && (
        <div className="fixed inset-0 bg-slate-100 z-50 overflow-y-auto">
          <CerfaOfficialView
            student={chaperoneViewingStudent}
            trips={trips}
            canEdit={false}
            establishmentName={establishmentName}
            onBack={() => setChaperoneViewingStudent(null)}
          />
        </div>
      )}

    </div>
  );
};
