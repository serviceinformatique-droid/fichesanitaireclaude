import { User, UserRole } from '../types';
import { setCurrentUserId, clearStoredCurrentUserId, clearAllCachedData } from './storage';

console.log('[fichesanitaire] build auth-20261006');

// ============================================================================
// Authentification côté navigateur : la connexion est vérifiée PAR LE SERVEUR.
// Le navigateur ne reçoit plus la liste des comptes ni les mots de passe ; il garde seulement un jeton de session
// (valable 30 jours pour les familles) qu'il joint à chaque requête vers /api.
// Après une connexion, un changement de compte ou une déconnexion, la page est rechargée : l'application repart
// alors avec les seules données autorisées pour le nouveau compte.
// ============================================================================

const TOKEN_KEY = 'cerfa_auth_token_v1';
const CHAPERONE_KEY = 'cerfa_chaperone_trip_v1';
const GATE_MODE_KEY = 'cerfa_gate_mode_v1';
const EXPIRED_KEY = 'cerfa_session_expired_v1';
const ORIGIN_ADMIN_ID_KEY = 'cerfa_origin_admin_id'; // même clé que l'application (retour administrateur)
const ORIGIN_TOKEN_KEY = 'cerfa_origin_token_v1';
const ORIGIN_USER_KEY = 'cerfa_origin_admin_user_v1';

let memToken = '';
let magicToken: string | null = null;

export const setMagicToken = (t: string | null): void => {
  magicToken = t;
};

export const getAuthToken = (): string => {
  try {
    return localStorage.getItem(TOKEN_KEY) || memToken;
  } catch {
    return memToken;
  }
};
const setAuthToken = (t: string): void => {
  memToken = t;
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* stockage indisponible : le jeton reste en mémoire pour cette page */
  }
};
const ss = {
  get: (k: string): string | null => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string): void => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* ignoré */
    }
  },
  del: (k: string): void => {
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* ignoré */
    }
  },
};

function clearAuthState(): void {
  memToken = '';
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignoré */
  }
  [CHAPERONE_KEY, ORIGIN_ADMIN_ID_KEY, ORIGIN_TOKEN_KEY, ORIGIN_USER_KEY].forEach(ss.del);
  clearStoredCurrentUserId();
  clearAllCachedData(); // aucune donnée de santé ne reste dans le navigateur après la déconnexion
}

const reloadSoon = (ms = 350): void => {
  setTimeout(() => window.location.reload(), ms);
};

function sessionExpired(): void {
  if (!getAuthToken()) return;
  ss.set(EXPIRED_KEY, '1');
  clearAuthState();
  window.location.reload();
}

// Joint le jeton à toutes les requêtes /api ; une réponse « non connecté » ramène à l'écran de connexion
export function installAuthFetch(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const isApi = url.startsWith('/api/') || url.startsWith(window.location.origin + '/api/');
    if (!isApi) return original(input, init);
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const token = getAuthToken();
    if (token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
    if (magicToken) headers.set('X-Magic-Token', magicToken);
    const res = await original(input, { ...init, headers });
    if (res.status === 401 && token && !url.includes('/api/auth/')) sessionExpired();
    return res;
  };
}

// Au démarrage : si le jeton mémorisé n'est plus valable (expiré, mot de passe changé ailleurs), on repart de zéro
export async function validateStoredSession(): Promise<void> {
  if (!getAuthToken()) return;
  try {
    const res = await fetch('/api/auth/me');
    const j = await res.json();
    if (!j.authenticated) {
      ss.set(EXPIRED_KEY, '1');
      clearAuthState();
    }
  } catch {
    /* serveur injoignable : on garde le jeton, la reconnexion se fera plus tard */
  }
}

export const takeExpiredFlag = (): boolean => {
  const v = ss.get(EXPIRED_KEY);
  ss.del(EXPIRED_KEY);
  return !!v;
};
export const takeGateMode = (): string | null => {
  const v = ss.get(GATE_MODE_KEY);
  ss.del(GATE_MODE_KEY);
  return v;
};
// Accompagnateur déjà connecté avec le mot de passe de son voyage (jeton limité à ce voyage)
export const getChaperoneSession = (): string => (getAuthToken() ? ss.get(CHAPERONE_KEY) || '' : '');

// ----------------------------------------------------------------------------- requêtes
// Résultat d'une opération d'authentification (ok = réussie ; sinon error / message expliquent l'échec)
export interface AuthFailure {
  ok: boolean;
  error: string;
  message: string;
  retryAfterSeconds?: number;
  user?: User;
}
const success = (user?: User): AuthFailure => ({ ok: true, error: '', message: '', user });
type Raw = { status: number; body: any };

async function post(path: string, body: unknown): Promise<Raw | null> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j: any = {};
    try {
      j = await res.json();
    } catch {
      /* corps vide */
    }
    return { status: res.status, body: j };
  } catch {
    return null; // réseau
  }
}
const waitText = (s?: number): string => {
  const m = Math.max(1, Math.ceil((s || 900) / 60));
  return `Trop de tentatives. Réessayez dans ${m} minute${m > 1 ? 's' : ''}.`;
};
const NETWORK = 'Connexion au serveur impossible. Vérifiez votre connexion et réessayez.';

function failure(r: Raw | null, map: Record<string, string>, fallback: string): AuthFailure {
  if (!r) return { ok: false, error: 'network', message: NETWORK };
  const code = (r.body && r.body.error) || '';
  if (r.status === 429) return { ok: false, error: 'locked', message: waitText(r.body && r.body.retryAfterSeconds), retryAfterSeconds: r.body && r.body.retryAfterSeconds };
  return { ok: false, error: code || 'error', message: map[code] || fallback };
}

function enterSession(token: string, user: User | null): void {
  setAuthToken(token);
  [ORIGIN_ADMIN_ID_KEY, ORIGIN_TOKEN_KEY, ORIGIN_USER_KEY, CHAPERONE_KEY].forEach(ss.del);
  if (user) setCurrentUserId(user.id);
  else clearStoredCurrentUserId();
  clearAllCachedData(); // le navigateur ne garde pas les données de la session précédente
  if (user) setCurrentUserId(user.id);
  reloadSoon();
}

export type LoginResult = AuthFailure;

export async function authLogin(role: UserRole, identifier: string, password: string): Promise<LoginResult> {
  const r = await post('/api/auth/login', { role, identifier, password });
  if (r && r.status === 200 && r.body && r.body.token) {
    enterSession(r.body.token, r.body.user);
    return success(r.body.user);
  }
  return failure(r, { invalid: '' }, '');
}
// Message à afficher pour un échec de connexion (identifiant ou mot de passe incorrect par défaut)
export const authFailureMessage = (f: AuthFailure, fallback: string): string => (f.error === 'invalid' || f.error === 'error' ? fallback : f.message);

export interface RegisterData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  secretQuestion: string;
  secretAnswer: string;
}
export async function authRegister(d: RegisterData): Promise<LoginResult> {
  const r = await post('/api/auth/register', d);
  if (r && r.status === 200 && r.body && r.body.token) {
    enterSession(r.body.token, r.body.user);
    return success(r.body.user);
  }
  return failure(
    r,
    {
      'email-exists': 'Un compte existe déjà avec cette adresse email. Veuillez vous connecter ou réinitialiser votre mot de passe.',
      'weak-password': 'Le mot de passe doit comporter au moins 6 caractères.',
      'bad-email': 'Cette adresse email ne semble pas valide.',
      'missing-fields': 'Tous les champs obligatoires doivent être renseignés (Nom, Prénom, Email, Mot de passe, Question secrète).',
      'too-many': 'Trop de créations de comptes depuis cette connexion. Réessayez plus tard.',
    },
    "La création du compte a échoué. Réessayez dans un instant."
  );
}

export async function authSecretQuestion(email: string): Promise<string | null> {
  const r = await post('/api/auth/secret-question', { email });
  return r && r.status === 200 && r.body && r.body.question ? String(r.body.question) : null;
}

export async function authResetPassword(email: string, secretAnswer: string, newPassword: string): Promise<LoginResult> {
  const r = await post('/api/auth/reset-password', { email, secretAnswer, newPassword });
  if (r && r.status === 200 && r.body && r.body.token) {
    enterSession(r.body.token, r.body.user);
    return success(r.body.user);
  }
  return failure(
    r,
    {
      'no-account': 'Aucun compte trouvé avec cette adresse email.',
      'no-secret': "Aucune question secrète n'a été configurée pour ce compte. Veuillez contacter l'administration.",
      'wrong-answer': 'Réponse secrète incorrecte.',
      'weak-password': 'Le nouveau mot de passe doit comporter au moins 6 caractères.',
    },
    'La réinitialisation a échoué. Réessayez dans un instant.'
  );
}

export async function authChaperone(tripId: string, password: string): Promise<AuthFailure> {
  const r = await post('/api/auth/chaperone', { tripId, password });
  if (r && r.status === 200 && r.body && r.body.token) {
    setAuthToken(r.body.token);
    clearStoredCurrentUserId();
    clearAllCachedData();
    ss.set(CHAPERONE_KEY, tripId);
    ss.set(GATE_MODE_KEY, 'chaperone_access');
    reloadSoon();
    return success();
  }
  return failure(
    r,
    {
      invalid: 'Mot de passe incorrect pour ce voyage.',
      'no-password': "Aucun mot de passe accompagnateur n'est configuré pour ce voyage. Contactez l'administration.",
      'no-trip': 'Voyage introuvable.',
    },
    'Accès impossible pour le moment. Réessayez dans un instant.'
  );
}

export async function authChangePassword(currentPassword: string, newPassword: string): Promise<AuthFailure> {
  const r = await post('/api/auth/change-password', { currentPassword, newPassword });
  if (r && r.status === 200) return success();
  return failure(
    r,
    {
      'wrong-current': 'Le mot de passe actuel saisi est incorrect.',
      'weak-password': 'Le nouveau mot de passe doit comporter au moins 6 caractères.',
      'same-password': "Le nouveau mot de passe doit être différent de l'ancien.",
    },
    "Échec de l'enregistrement. Vérifiez votre connexion et réessayez : votre ancien mot de passe reste valable."
  );
}

// Administrateur : consulte le compte d'un autre utilisateur (jeton dédié de courte durée) ; son propre jeton est conservé
export async function authImpersonate(userId: string, admin: User): Promise<boolean> {
  const r = await post('/api/auth/impersonate', { userId });
  if (!r || r.status !== 200 || !r.body || !r.body.token) return false;
  if (!ss.get(ORIGIN_TOKEN_KEY)) {
    ss.set(ORIGIN_TOKEN_KEY, getAuthToken());
    ss.set(ORIGIN_ADMIN_ID_KEY, admin.id);
    ss.set(ORIGIN_USER_KEY, JSON.stringify({ id: admin.id, name: admin.name, email: admin.email, role: admin.role }));
  }
  const origin = [ss.get(ORIGIN_TOKEN_KEY), ss.get(ORIGIN_ADMIN_ID_KEY), ss.get(ORIGIN_USER_KEY)];
  setAuthToken(r.body.token);
  clearAllCachedData();
  setCurrentUserId(r.body.user.id);
  ss.set(ORIGIN_TOKEN_KEY, origin[0] || '');
  ss.set(ORIGIN_ADMIN_ID_KEY, origin[1] || '');
  ss.set(ORIGIN_USER_KEY, origin[2] || '');
  reloadSoon(250);
  return true;
}

export const getOriginAdminUser = (): User | null => {
  try {
    const raw = ss.get(ORIGIN_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
};

export function authReturnToAdmin(): void {
  const originToken = ss.get(ORIGIN_TOKEN_KEY);
  const adminId = ss.get(ORIGIN_ADMIN_ID_KEY);
  const current = getAuthToken();
  if (!originToken || !adminId) {
    sessionExpired();
    return;
  }
  // ferme le jeton de consultation puis revient à celui de l'administrateur
  if (current && current !== originToken) {
    fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => undefined);
  }
  [ORIGIN_TOKEN_KEY, ORIGIN_ADMIN_ID_KEY, ORIGIN_USER_KEY].forEach(ss.del);
  setTimeout(() => {
    setAuthToken(originToken);
    clearAllCachedData();
    setCurrentUserId(adminId);
    window.location.reload();
  }, 120);
}

export async function authLogout(gateMode?: string): Promise<void> {
  const token = getAuthToken();
  const origin = ss.get(ORIGIN_TOKEN_KEY);
  const send = (t: string) =>
    fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, keepalive: true }).catch(() => undefined);
  const calls: Promise<unknown>[] = [];
  if (token) calls.push(send(token));
  if (origin && origin !== token) calls.push(send(origin));
  await Promise.race([Promise.all(calls), new Promise((r) => setTimeout(r, 900))]);
  clearAuthState();
  if (gateMode) ss.set(GATE_MODE_KEY, gateMode);
  window.location.reload();
}
