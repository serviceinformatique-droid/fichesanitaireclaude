'use strict';
// ============================================================================
// Authentification du portail (build auth-20261006)
//  - connexion vérifiée PAR LE SERVEUR (mots de passe hachés avec scrypt, jamais renvoyés) ;
//  - sessions par jeton (parents 30 jours, personnel 7 jours, accompagnateurs 12 h, réglable) ;
//  - blocage après des essais ratés répétés ;
//  - chaque rôle ne reçoit que SES données (famille : ses enfants ; professeur : les élèves de son voyage ;
//    accompagnateur : les élèves de son voyage ; administration : tout) ;
//  - toutes les routes /api sont refusées par défaut aux non-administrateurs, sauf celles listées ci-dessous.
// Les outils d'exploitation (rattacher-fiche.sh, commandes du README) utilisent l'en-tête X-Local-Tool avec le
// secret du fichier /app/.local-tool-secret : lisible seulement dans le conteneur.
// ============================================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

console.log('[fichesanitaire] build auth-20261006');

const CFG = {
  sessionDays: Number(process.env.AUTH_SESSION_DAYS || 30), // parents
  staffSessionDays: Number(process.env.AUTH_STAFF_SESSION_DAYS || 7), // professeurs et administration
  chaperoneHours: Number(process.env.AUTH_CHAPERONE_HOURS || 12), // accompagnateurs (mot de passe de voyage)
  impersonationHours: Number(process.env.AUTH_IMPERSONATION_HOURS || 4), // administrateur qui consulte un autre compte
  maxFails: Number(process.env.AUTH_MAX_FAILS || 5), // essais ratés par adresse avant blocage
  maxFailsAccount: Number(process.env.AUTH_MAX_FAILS_ACCOUNT || 30), // essais ratés toutes adresses confondues
  lockMinutes: Number(process.env.AUTH_LOCK_MINUTES || 15),
  magicLinkDays: Number(process.env.MAGIC_LINK_DAYS || 30),
  minPassword: 6,
  testHook: process.env.AUTH_TEST_HOOK === '1',
};

const K = {
  users: 'cerfa_users_v1',
  students: 'cerfa_students_v11',
  trips: 'cerfa_trips_v2',
  classes: 'cerfa_classes_v1',
  notifications: 'cerfa_notifications_v1',
  name: 'cerfa_establishment_name_v1',
  logo: 'cerfa_logo_v1',
  reminderTpl: 'cerfa_reminder_template_v1',
  autoEnabled: 'cerfa_auto_reminder_enabled_v1',
  autoLast: 'cerfa_last_auto_reminder_run_v1',
  sessions: 'cerfa_auth_sessions_v1',
  magic: 'cerfa_magic_links_v1',
};
const ADMIN_WRITABLE = [K.users, K.students, K.trips, K.classes, K.notifications, K.name, K.logo, K.reminderTpl, K.autoEnabled, K.autoLast];

// ----------------------------------------------------------------------------- outils
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return crypto.timingSafeEqual(x, y);
};
const normAnswer = (s) => String(s == null ? '' : s).trim().toLowerCase();
const clip = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

async function hashSecret(plain) {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const key = await scrypt(String(plain), salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyHash(plain, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, salt, key] = parts;
    const expected = Buffer.from(key, 'base64');
    const got = await scrypt(String(plain), Buffer.from(salt, 'base64'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}
let DUMMY_HASH = null; // sert à égaliser le temps de réponse quand le compte n'existe pas

// Retire tout secret d'un compte avant de l'envoyer au navigateur
function sanitizeUser(u) {
  if (!u) return u;
  const c = { ...u };
  delete c.password;
  delete c.passwordHash;
  delete c.secretAnswer;
  delete c.secretAnswerHash;
  return c;
}
const stripTrip = (t) => {
  if (!t) return t;
  const c = { ...t };
  delete c.chaperonePassword;
  return c;
};

// ----------------------------------------------------------------------------- blocage des essais
const fails = new Map(); // clé -> { count, first, lockedUntil }
function failState(key) {
  const now = Date.now();
  let s = fails.get(key);
  if (s && !s.lockedUntil && now - s.first > CFG.lockMinutes * 60000) s = null;
  if (s && s.lockedUntil && now > s.lockedUntil) s = null;
  if (!s) {
    s = { count: 0, first: now, lockedUntil: 0 };
    fails.set(key, s);
  }
  return s;
}
function lockedFor(keys) {
  const now = Date.now();
  let wait = 0;
  keys.forEach(({ key }) => {
    const s = fails.get(key);
    if (s && s.lockedUntil && s.lockedUntil > now) wait = Math.max(wait, Math.ceil((s.lockedUntil - now) / 1000));
  });
  return wait;
}
function registerFailure(keys) {
  keys.forEach(({ key, max }) => {
    const s = failState(key);
    s.count += 1;
    if (s.count >= max) s.lockedUntil = Date.now() + CFG.lockMinutes * 60000;
  });
}
function clearFailures(keys) {
  keys.forEach(({ key }) => fails.delete(key));
}
setInterval(() => {
  const now = Date.now();
  fails.forEach((s, k) => {
    if ((s.lockedUntil && s.lockedUntil < now) || (!s.lockedUntil && now - s.first > CFG.lockMinutes * 60000)) fails.delete(k);
  });
}, 5 * 60000).unref();

// ----------------------------------------------------------------------------- module
function install(app, deps) {
  const { readKv, writeKv } = deps;

  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
  const clientIp = (req) => String(req.ip || (req.socket && req.socket.remoteAddress) || 'inconnue');

  // --- secret des outils locaux (rattacher-fiche.sh, commandes du README) ---
  const SECRET_FILE = path.join(__dirname, '..', '.local-tool-secret');
  let TOOL_SECRET = process.env.LOCAL_TOOL_SECRET || '';
  if (!TOOL_SECRET) {
    try {
      TOOL_SECRET = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(SECRET_FILE, TOOL_SECRET, { mode: 0o600 });
    } catch (e) {
      console.error('[auth] Secret des outils locaux non écrit :', e.message);
    }
  }

  // --- comptes (cache de 3 s : évite de relire toute la liste à chaque requête) ---
  let usersCache = null;
  let usersCacheAt = 0;
  async function getUsers() {
    if (usersCache && Date.now() - usersCacheAt < 3000) return usersCache;
    usersCache = (await readKv(K.users)) || [];
    usersCacheAt = Date.now();
    return usersCache;
  }
  const invalidateUsers = () => {
    usersCache = null;
  };
  async function saveUsers(list) {
    await writeKv(K.users, list);
    invalidateUsers();
  }

  // --- sessions ---
  let sessions = new Map(); // empreinte du jeton -> session
  let persistTimer = null;
  const persistSoon = () => {
    if (persistTimer) return;
    persistTimer = setTimeout(async () => {
      persistTimer = null;
      try {
        await writeKv(K.sessions, [...sessions.values()]);
      } catch (e) {
        console.error('[auth] Sauvegarde des sessions impossible :', e.message);
      }
    }, 800);
  };
  async function loadSessions() {
    const list = (await readKv(K.sessions)) || [];
    const now = Date.now();
    sessions = new Map(list.filter((s) => s && s.h && s.expiresAt > now).map((s) => [s.h, s]));
  }
  function createSession(sub, ttlMs) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    const s = { h: sha256(token), kind: sub.kind, userId: sub.userId || null, tripId: sub.tripId || null, impersonatedBy: sub.impersonatedBy || null, createdAt: now, expiresAt: now + ttlMs };
    sessions.set(s.h, s);
    persistSoon();
    return { token, expiresAt: s.expiresAt };
  }
  function revokeToken(token) {
    if (token && sessions.delete(sha256(token))) persistSoon();
  }
  function revokeUserSessions(userId, exceptHash) {
    let n = 0;
    sessions.forEach((s, h) => {
      if (s.userId === userId && h !== exceptHash) {
        sessions.delete(h);
        n += 1;
      }
    });
    if (n) persistSoon();
  }
  const ttlFor = (role) => (role === 'parent' ? CFG.sessionDays * 86400000 : CFG.staffSessionDays * 86400000);

  const bearer = (req) => {
    const h = String(req.headers.authorization || '');
    return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  };

  // --- identification de l'appelant ---
  async function authenticate(req) {
    const tool = req.headers['x-local-tool'];
    if (tool && TOOL_SECRET && safeEq(String(tool), TOOL_SECRET)) return { kind: 'system', role: 'admin' };
    const token = bearer(req);
    if (!token) return null;
    const h = sha256(token);
    const s = sessions.get(h);
    if (!s || s.expiresAt <= Date.now()) {
      if (s) sessions.delete(h);
      return null;
    }
    if (s.kind === 'chaperone') return { kind: 'chaperone', role: 'chaperone', tripId: s.tripId, hash: h };
    const users = await getUsers();
    const user = users.find((u) => u && u.id === s.userId);
    if (!user) {
      sessions.delete(h);
      return null;
    }
    return { kind: 'user', role: user.role, user, hash: h, impersonatedBy: s.impersonatedBy || null };
  }
  const isAdmin = (a) => !!a && (a.kind === 'system' || (a.kind === 'user' && a.role === 'admin'));

  // --- données visibles par chaque rôle ---
  async function buildView(auth) {
    const out = {};
    const name = await readKv(K.name);
    const logo = await readKv(K.logo);
    const trips = (await readKv(K.trips)) || [];
    if (name !== null) out[K.name] = name;
    if (logo !== null) out[K.logo] = logo;
    const admin = isAdmin(auth);
    out[K.trips] = admin ? trips : trips.map(stripTrip);
    // clés toujours présentes (vides pour un visiteur) : le navigateur n'invente pas de comptes de démonstration
    out[K.users] = [];
    out[K.students] = [];
    out[K.classes] = [];
    out[K.notifications] = [];
    if (!auth) return out;
    const [students, classes, notifs] = [(await readKv(K.students)) || [], (await readKv(K.classes)) || [], (await readKv(K.notifications)) || []];
    if (auth.kind === 'chaperone') {
      out[K.trips] = trips.filter((t) => t.id === auth.tripId).map(stripTrip);
      out[K.students] = students.filter((s) => s && !s.deletedAt && (s.registeredTripIds || []).includes(auth.tripId));
      out[K.classes] = classes;
      return out;
    }
    out[K.classes] = classes;
    if (admin) {
      const users = await getUsers();
      out[K.users] = users.map(sanitizeUser);
      out[K.students] = students;
      out[K.notifications] = notifs;
      const extra = [[K.reminderTpl], [K.autoEnabled], [K.autoLast]];
      for (const [k] of extra) {
        const v = await readKv(k);
        if (v !== null) out[k] = v;
      }
      return out;
    }
    const u = auth.user;
    out[K.users] = [sanitizeUser(u)];
    out[K.notifications] = notifs.filter((n) => n.targetRole === 'all' || n.targetRole === u.role || n.targetUserId === u.id);
    if (u.role === 'parent') out[K.students] = students.filter((s) => s && !s.deletedAt && s.parentId === u.id);
    else if (u.role === 'organizer') {
      const mine = new Set(u.assignedTripIds || []);
      out[K.students] = students.filter((s) => s && !s.deletedAt && (s.registeredTripIds || []).some((id) => mine.has(id)));
    }
    return out;
  }

  // --- règles d'accès ---
  const RULES = [
    ['GET', /^\/api\/data(\/[^/]+)?$/, 'view'],
    ['PUT', /^\/api\/data\/[^/]+$/, 'datawrite'],
    ['POST', /^\/api\/auth\/(login|register|secret-question|reset-password|chaperone|logout)$/, 'public'],
    ['GET', /^\/api\/auth\/me$/, 'public'],
    ['POST', /^\/api\/auth\/change-password$/, 'user'],
    ['POST', /^\/api\/auth\/impersonate$/, 'admin'],
    ['POST', /^\/api\/auth\/test-token$/, 'system'],
    ['GET', /^\/api\/magic-link\/[^/]+$/, 'magic'],
    ['PUT', /^\/api\/magic-link\/[^/]+$/, 'magic'],
    ['GET', /^\/api\/(popups\/public|year-end\/public)$/, 'public'],
    ['POST', /^\/api\/(comm\/poll|messages\/(list|send|read)|popups\/ack)$/, 'user'],
    ['POST', /^\/api\/students\/(upsert|check-duplicate)$/, 'parent_admin'],
    ['POST', /^\/api\/students\/send-pdf$/, 'pdf'],
    ['POST', /^\/api\/users\/upsert$/, 'users_upsert'],
  ];
  const FORCE_USERID = /^\/api\/(comm\/|messages\/|popups\/(ack|send|list|deactivate|delete)|year-end\/(get|save|run|undo)|reminders\/run-auto-now)/;

  const deny = (res, status, error) => res.status(status).json({ error });

  async function magicEntry(token) {
    const links = (await readKv(K.magic)) || {};
    const e = links[token];
    if (!e) return null;
    if (e.expiresAt && Date.parse(e.expiresAt) < Date.now()) return 'expired';
    return e;
  }

  async function middleware(req, res, next) {
    try {
      if (!req.path.startsWith('/api/')) return next();
      const p = req.path.replace(/\/+$/, '') || '/';
      let level = 'admin';
      for (const [m, re, lv] of RULES) {
        if (m === req.method && re.test(p)) {
          level = lv;
          break;
        }
      }
      const auth = await authenticate(req);
      req.auth = auth;

      if (level === 'public') return next();
      if (level === 'view') return handleView(req, res, auth, p);
      if (level === 'magic') return handleMagic(req, res, next, p);

      if (!auth && level === 'pdf') {
        // une personne qui utilise un lien direct valide archive le PDF de CET élève uniquement
        const e = await magicEntry(String(req.headers['x-magic-token'] || ''));
        if (e && e !== 'expired' && req.body && e.studentId === req.body.studentId) return next();
        return deny(res, 401, 'auth-required');
      }
      if (!auth) return deny(res, 401, 'auth-required');
      const admin = isAdmin(auth);

      if (level === 'system') {
        if (auth.kind !== 'system') return deny(res, 403, 'forbidden');
        return next();
      }
      if (level === 'datawrite') return handleDataWrite(req, res, auth, p);
      if (level === 'admin' && !admin) return deny(res, 403, 'forbidden');
      if (level === 'user' && auth.kind === 'chaperone') return deny(res, 403, 'forbidden');
      if (level === 'parent_admin') {
        if (!admin && !(auth.kind === 'user' && auth.role === 'parent')) return deny(res, 403, 'forbidden');
        return handleStudentsRoute(req, res, next, auth, p);
      }
      if (level === 'pdf') return handlePdf(req, res, next, auth);
      if (level === 'users_upsert') return handleUsersUpsert(req, res, next, auth);

      // identité imposée : le navigateur ne peut plus se faire passer pour un autre compte
      if (FORCE_USERID.test(p) && req.body && typeof req.body === 'object') {
        if (auth.kind === 'user') req.body.userId = auth.user.id;
        else if (auth.kind === 'system' && !req.body.userId) {
          const first = (await getUsers()).find((u) => u && u.role === 'admin');
          if (first) req.body.userId = first.id;
        }
      }
      if (p === '/api/users/remove') return handleUsersRemove(req, res, next, auth);
      return next();
    } catch (e) {
      console.error('[auth] Erreur de contrôle :', e);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }
  app.use(middleware);

  async function handleView(req, res, auth, p) {
    const view = await buildView(auth);
    const m = p.match(/^\/api\/data\/([^/]+)$/);
    if (!m) return res.json(view);
    let key = m[1];
    try {
      key = decodeURIComponent(key);
    } catch {
      /* clé brute */
    }
    if (!Object.prototype.hasOwnProperty.call(view, key)) return res.status(404).json({ error: 'Non trouvé' });
    return res.json({ key, value: view[key] });
  }

  async function handleMagic(req, res, next, p) {
    const token = decodeURIComponent(p.split('/').pop() || '');
    const e = await magicEntry(token);
    if (!e) return deny(res, 404, 'Lien invalide.');
    if (e === 'expired') return deny(res, 410, 'Ce lien a expiré : demandez-en un nouveau à l\'établissement.');
    if (req.method === 'GET') {
      // les trajets proposés au parent ne contiennent jamais le mot de passe accompagnateur
      const orig = res.json.bind(res);
      res.json = (obj) => {
        if (obj && Array.isArray(obj.trips)) obj = { ...obj, trips: obj.trips.map(stripTrip) };
        return orig(obj);
      };
    } else if (req.method === 'PUT') {
      // le lien ne permet pas de rattacher la fiche à un autre compte
      const students = (await readKv(K.students)) || [];
      const stored = students.find((s) => s && s.id === e.studentId);
      if (stored && req.body && req.body.student) req.body.student.parentId = stored.parentId;
    }
    return next();
  }

  async function handleDataWrite(req, res, auth, p) {
    let key = p.split('/').pop();
    try {
      key = decodeURIComponent(key);
    } catch {
      /* clé brute */
    }
    const value = req.body ? req.body.value : undefined;
    if (isAdmin(auth)) {
      if (!ADMIN_WRITABLE.includes(key)) return deny(res, 403, 'forbidden');
      if (key === K.users) return adminWriteUsers(res, value);
      await writeKv(key, value);
      return res.json({ ok: true });
    }
    // les autres rôles : seulement l'état « lu » de leurs notifications
    if (key === K.notifications && auth.kind === 'user' && Array.isArray(value)) {
      const u = auth.user;
      const list = (await readKv(K.notifications)) || [];
      const incoming = new Map(value.filter((n) => n && n.id).map((n) => [n.id, n]));
      let changed = false;
      list.forEach((n) => {
        const visible = n.targetRole === 'all' || n.targetRole === u.role || n.targetUserId === u.id;
        const inc = incoming.get(n.id);
        if (visible && inc && typeof inc.read === 'boolean' && inc.read !== n.read) {
          n.read = inc.read;
          changed = true;
        }
      });
      if (changed) await writeKv(K.notifications, list);
      return res.json({ ok: true });
    }
    return deny(res, 403, 'forbidden');
  }

  // Écriture de la liste des comptes par l'administration : les empreintes de mots de passe sont conservées
  async function mergeUser(base, incoming) {
    const merged = { ...(base || {}), ...incoming };
    merged.passwordHash = base && base.passwordHash ? base.passwordHash : undefined;
    merged.secretAnswerHash = base && base.secretAnswerHash ? base.secretAnswerHash : undefined;
    delete merged.password;
    delete merged.secretAnswer;
    if (typeof incoming.password === 'string' && incoming.password.trim()) merged.passwordHash = await hashSecret(incoming.password.trim());
    if (typeof incoming.secretAnswer === 'string' && incoming.secretAnswer.trim()) merged.secretAnswerHash = await hashSecret(normAnswer(incoming.secretAnswer));
    if (!merged.passwordHash) delete merged.passwordHash;
    if (!merged.secretAnswerHash) delete merged.secretAnswerHash;
    return merged;
  }
  async function adminWriteUsers(res, list) {
    if (!Array.isArray(list)) return deny(res, 400, 'liste invalide');
    const release = await deps.lockUserWrites();
    try {
      const stored = (await readKv(K.users)) || [];
      const byId = new Map(stored.map((u) => [u.id, u]));
      const merged = [];
      for (const u of list) {
        if (!u || !u.id) continue;
        merged.push(await mergeUser(byId.get(u.id), u));
      }
      if (!merged.some((u) => u.role === 'admin')) return deny(res, 409, 'Il doit rester au moins un administrateur.');
      const keep = new Set(merged.map((u) => u.id));
      stored.forEach((u) => {
        if (!keep.has(u.id)) revokeUserSessions(u.id);
      });
      await saveUsers(merged);
    } finally {
      release();
    }
    return res.json({ ok: true });
  }

  async function handleUsersUpsert(req, res, next, auth) {
    const incoming = req.body && req.body.user;
    if (!incoming || !incoming.id) return deny(res, 400, 'user manquant ou invalide');
    const users = await getUsers();
    const base = users.find((u) => u && u.id === incoming.id) || null;
    if (isAdmin(auth)) {
      if (!['parent', 'organizer', 'admin'].includes(incoming.role)) return deny(res, 400, 'rôle invalide');
      req.body.user = await mergeUser(base, incoming);
      invalidateUsers();
      res.on('finish', invalidateUsers);
      return next();
    }
    // un utilisateur ne modifie que son propre profil : jamais son rôle, ses voyages ni son mot de passe
    if (auth.kind !== 'user' || incoming.id !== auth.user.id || !base) return deny(res, 403, 'forbidden');
    const picked = {};
    ['name', 'firstName', 'lastName', 'phone', 'email', 'secretQuestion'].forEach((f) => {
      if (incoming[f] !== undefined) picked[f] = clip(incoming[f], 200);
    });
    if (picked.email && users.some((u) => u.id !== base.id && String(u.email || '').toLowerCase() === picked.email.toLowerCase())) return deny(res, 409, 'email-exists');
    const merged = { ...base, ...picked };
    if (typeof incoming.secretAnswer === 'string' && incoming.secretAnswer.trim()) merged.secretAnswerHash = await hashSecret(normAnswer(incoming.secretAnswer));
    req.body.user = merged;
    invalidateUsers();
    res.on('finish', invalidateUsers);
    return next();
  }

  async function handleUsersRemove(req, res, next, auth) {
    const id = req.body && req.body.userId;
    const users = await getUsers();
    const target = users.find((u) => u && u.id === id);
    if (target && target.role === 'admin' && users.filter((u) => u.role === 'admin').length <= 1) return deny(res, 409, 'Il doit rester au moins un administrateur.');
    if (id) revokeUserSessions(id);
    invalidateUsers();
    res.on('finish', invalidateUsers);
    return next();
  }

  async function handleStudentsRoute(req, res, next, auth, p) {
    const admin = isAdmin(auth);
    if (p === '/api/students/check-duplicate') {
      if (!admin && req.body && typeof req.body === 'object') req.body.parentId = auth.user.id;
      return next();
    }
    const stu = req.body && req.body.student;
    if (!stu || !stu.id) return next(); // le contrôle habituel répondra 400
    if (!admin) {
      const students = (await readKv(K.students)) || [];
      const stored = students.find((s) => s && s.id === stu.id);
      if (stored && stored.parentId !== auth.user.id) return deny(res, 403, 'forbidden');
      stu.parentId = stored ? stored.parentId : auth.user.id;
    }
    return next();
  }

  async function handlePdf(req, res, next, auth) {
    const admin = isAdmin(auth);
    const studentId = req.body && req.body.studentId;
    if (admin) return next();
    if (auth.kind === 'user' && auth.role === 'parent') {
      const students = (await readKv(K.students)) || [];
      const stored = students.find((s) => s && s.id === studentId);
      if (!stored || stored.parentId !== auth.user.id) return deny(res, 403, 'forbidden');
      return next();
    }
    return deny(res, 403, 'forbidden');
  }

  // --- connexion ---
  const sessionOut = (user, sess) => ({ ok: true, token: sess.token, expiresAt: sess.expiresAt, user: sanitizeUser(user) });

  async function verifyUserPassword(user, plain) {
    if (user.passwordHash) return verifyHash(plain, user.passwordHash);
    if (typeof user.password === 'string' && user.password) {
      // ancien format (clair) : accepté une dernière fois, puis converti en empreinte
      return safeEq(plain, user.password);
    }
    return false;
  }
  async function upgradeLegacy(user, plain) {
    const release = await deps.lockUserWrites();
    try {
      const users = await readKv(K.users);
      const i = (users || []).findIndex((u) => u.id === user.id);
      if (i === -1) return;
      users[i].passwordHash = await hashSecret(plain);
      delete users[i].password;
      await saveUsers(users);
    } finally {
      release();
    }
  }

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { role, identifier, password } = req.body || {};
      const q = clip(identifier, 200).toLowerCase();
      if (!['parent', 'organizer', 'admin'].includes(role) || typeof password !== 'string' || !password) return deny(res, 400, 'invalid');
      const ip = clientIp(req);
      const kIp = { key: `login|${ip}|${role}|${q}`, max: CFG.maxFails };
      const kAcc = { key: `login|${role}|${q}`, max: CFG.maxFailsAccount };
      const wait = lockedFor([kIp, kAcc]);
      if (wait) return res.status(429).json({ error: 'locked', retryAfterSeconds: wait });

      const users = await getUsers();
      let candidates = users.filter((u) => u && u.role === role);
      if (q) {
        candidates = candidates.filter(
          (u) =>
            String(u.email || '').toLowerCase() === q ||
            String(u.name || '').toLowerCase() === q ||
            (u.firstName && u.lastName && `${u.firstName} ${u.lastName}`.toLowerCase() === q)
        );
      } else if (role === 'parent') candidates = [];
      else if (role === 'organizer' && candidates.length !== 1) candidates = [];

      let matched = null;
      for (const u of candidates) {
        if (await verifyUserPassword(u, password)) {
          matched = u;
          break;
        }
      }
      if (!candidates.length) await verifyHash(password, DUMMY_HASH); // même durée de réponse qu'un vrai essai
      if (!matched) {
        registerFailure([kIp, kAcc]);
        console.log(`[auth] échec de connexion (${role}) depuis ${ip}`);
        return res.status(401).json({ error: 'invalid' });
      }
      clearFailures([kIp, kAcc]);
      if (!matched.passwordHash) await upgradeLegacy(matched, password);
      const sess = createSession({ kind: 'user', userId: matched.id }, ttlFor(matched.role));
      console.log(`[auth] connexion (${matched.role}) ${matched.id}`);
      return res.json(sessionOut(matched, sess));
    } catch (e) {
      console.error('[auth] login :', e);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  const regCount = new Map(); // ip -> [horodatages]
  app.post('/api/auth/register', async (req, res) => {
    try {
      const b = req.body || {};
      const firstName = clip(b.firstName, 80);
      const lastName = clip(b.lastName, 80);
      const email = clip(b.email, 150).toLowerCase();
      const phone = clip(b.phone, 40);
      const password = typeof b.password === 'string' ? b.password : '';
      const secretQuestion = clip(b.secretQuestion, 200);
      const secretAnswer = clip(b.secretAnswer, 200);
      if (!firstName || !lastName || !email || !password || !secretAnswer) return deny(res, 400, 'missing-fields');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return deny(res, 400, 'bad-email');
      if (password.length < CFG.minPassword) return res.status(400).json({ error: 'weak-password', min: CFG.minPassword });
      const ip = clientIp(req);
      const now = Date.now();
      const recent = (regCount.get(ip) || []).filter((t) => now - t < 3600000);
      if (recent.length >= 15) return res.status(429).json({ error: 'too-many', retryAfterSeconds: 600 });
      recent.push(now);
      regCount.set(ip, recent);

      const release = await deps.lockUserWrites();
      let user;
      try {
        const users = (await readKv(K.users)) || [];
        if (users.some((u) => u && String(u.email || '').toLowerCase() === email)) return deny(res, 409, 'email-exists');
        user = {
          id: 'parent-' + Date.now() + '-' + crypto.randomBytes(2).toString('hex'),
          name: `${firstName} ${lastName}`,
          firstName,
          lastName,
          email,
          phone,
          role: 'parent',
          passwordHash: await hashSecret(password),
          secretQuestion,
          secretAnswerHash: await hashSecret(normAnswer(secretAnswer)),
          isDemo: false,
        };
        users.push(user);
        await saveUsers(users);
      } finally {
        release();
      }
      try {
        await deps.commSendWelcome({ id: user.id, name: user.name, firstName: user.firstName, lastName: user.lastName });
      } catch (e) {
        console.error("[auth] Message d'accueil impossible :", e.message);
      }
      const sess = createSession({ kind: 'user', userId: user.id }, ttlFor('parent'));
      console.log(`[auth] compte parent créé ${user.id}`);
      return res.json(sessionOut(user, sess));
    } catch (e) {
      console.error('[auth] register :', e);
      if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  const questionCount = new Map();
  app.post('/api/auth/secret-question', async (req, res) => {
    try {
      const ip = clientIp(req);
      const now = Date.now();
      const recent = (questionCount.get(ip) || []).filter((t) => now - t < 900000);
      if (recent.length >= 30) return res.status(429).json({ error: 'too-many' });
      recent.push(now);
      questionCount.set(ip, recent);
      const email = clip(req.body && req.body.email, 150).toLowerCase();
      const u = email ? (await getUsers()).find((x) => x && x.role === 'parent' && String(x.email || '').toLowerCase() === email) : null;
      return res.json({ question: u && u.secretQuestion && (u.secretAnswerHash || u.secretAnswer) ? u.secretQuestion : null });
    } catch (e) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    try {
      const b = req.body || {};
      const email = clip(b.email, 150).toLowerCase();
      const answer = typeof b.secretAnswer === 'string' ? b.secretAnswer : '';
      const newPassword = typeof b.newPassword === 'string' ? b.newPassword : '';
      const ip = clientIp(req);
      const kIp = { key: `reset|${ip}|${email}`, max: CFG.maxFails };
      const kAcc = { key: `reset|${email}`, max: CFG.maxFailsAccount };
      const wait = lockedFor([kIp, kAcc]);
      if (wait) return res.status(429).json({ error: 'locked', retryAfterSeconds: wait });
      const users = (await readKv(K.users)) || [];
      const i = users.findIndex((x) => x && x.role === 'parent' && String(x.email || '').toLowerCase() === email);
      if (i === -1) {
        registerFailure([kIp, kAcc]);
        return res.status(404).json({ error: 'no-account' });
      }
      const u = users[i];
      if (!u.secretAnswerHash && !u.secretAnswer) return res.status(409).json({ error: 'no-secret' });
      if (newPassword.length < CFG.minPassword) return res.status(400).json({ error: 'weak-password', min: CFG.minPassword });
      const ok = u.secretAnswerHash ? await verifyHash(normAnswer(answer), u.secretAnswerHash) : safeEq(normAnswer(answer), normAnswer(u.secretAnswer));
      if (!ok) {
        registerFailure([kIp, kAcc]);
        return res.status(401).json({ error: 'wrong-answer' });
      }
      clearFailures([kIp, kAcc]);
      const release = await deps.lockUserWrites();
      try {
        const fresh = (await readKv(K.users)) || [];
        const j = fresh.findIndex((x) => x && x.id === u.id);
        if (j === -1) return deny(res, 404, 'no-account');
        fresh[j].passwordHash = await hashSecret(newPassword);
        delete fresh[j].password;
        if (!fresh[j].secretAnswerHash) {
          fresh[j].secretAnswerHash = await hashSecret(normAnswer(answer));
          delete fresh[j].secretAnswer;
        }
        await saveUsers(fresh);
        revokeUserSessions(u.id);
        const sess = createSession({ kind: 'user', userId: u.id }, ttlFor(fresh[j].role));
        console.log(`[auth] mot de passe réinitialisé ${u.id}`);
        return res.json(sessionOut(fresh[j], sess));
      } finally {
        release();
      }
    } catch (e) {
      console.error('[auth] reset :', e);
      if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/auth/chaperone', async (req, res) => {
    try {
      const { tripId, password } = req.body || {};
      const ip = clientIp(req);
      const kIp = { key: `chap|${ip}|${tripId}`, max: CFG.maxFails };
      const kAcc = { key: `chap|${tripId}`, max: CFG.maxFailsAccount };
      const wait = lockedFor([kIp, kAcc]);
      if (wait) return res.status(429).json({ error: 'locked', retryAfterSeconds: wait });
      const trips = (await readKv(K.trips)) || [];
      const trip = trips.find((t) => t && t.id === tripId);
      if (!trip) return deny(res, 404, 'no-trip');
      if (!trip.chaperonePassword || !String(trip.chaperonePassword).trim()) return deny(res, 409, 'no-password');
      if (typeof password !== 'string' || !safeEq(password, trip.chaperonePassword)) {
        registerFailure([kIp, kAcc]);
        return res.status(401).json({ error: 'invalid' });
      }
      clearFailures([kIp, kAcc]);
      const sess = createSession({ kind: 'chaperone', tripId: trip.id }, CFG.chaperoneHours * 3600000);
      return res.json({ ok: true, token: sess.token, expiresAt: sess.expiresAt, tripId: trip.id });
    } catch (e) {
      console.error('[auth] chaperone :', e);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    revokeToken(bearer(req));
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const a = req.auth;
    if (!a || a.kind === 'system') return res.json({ authenticated: false });
    if (a.kind === 'chaperone') return res.json({ authenticated: true, kind: 'chaperone', tripId: a.tripId });
    return res.json({ authenticated: true, kind: 'user', user: sanitizeUser(a.user), impersonatedBy: a.impersonatedBy });
  });

  app.post('/api/auth/change-password', async (req, res) => {
    try {
      const a = req.auth;
      const { currentPassword, newPassword } = req.body || {};
      if (a.kind !== 'user') return deny(res, 403, 'forbidden');
      if (typeof newPassword !== 'string' || newPassword.length < CFG.minPassword) return res.status(400).json({ error: 'weak-password', min: CFG.minPassword });
      const kAcc = { key: `chg|${a.user.id}`, max: CFG.maxFails };
      const wait = lockedFor([kAcc]);
      if (wait) return res.status(429).json({ error: 'locked', retryAfterSeconds: wait });
      const full = ((await readKv(K.users)) || []).find((u) => u.id === a.user.id);
      if (!full || !(await verifyUserPassword(full, String(currentPassword || '')))) {
        registerFailure([kAcc]);
        return res.status(401).json({ error: 'wrong-current' });
      }
      clearFailures([kAcc]);
      if (await verifyUserPassword(full, newPassword)) return deny(res, 400, 'same-password');
      const release = await deps.lockUserWrites();
      try {
        const users = (await readKv(K.users)) || [];
        const i = users.findIndex((u) => u.id === a.user.id);
        users[i].passwordHash = await hashSecret(newPassword);
        delete users[i].password;
        await saveUsers(users);
      } finally {
        release();
      }
      revokeUserSessions(a.user.id, a.hash); // les autres appareils doivent se reconnecter
      console.log(`[auth] mot de passe changé ${a.user.id}`);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[auth] change-password :', e);
      if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/auth/impersonate', async (req, res) => {
    try {
      const a = req.auth;
      const target = (await getUsers()).find((u) => u && u.id === (req.body && req.body.userId));
      if (!target) return deny(res, 404, 'no-user');
      if (a.kind === 'user' && a.impersonatedBy) return deny(res, 403, 'forbidden');
      const sess = createSession({ kind: 'user', userId: target.id, impersonatedBy: a.kind === 'user' ? a.user.id : 'system' }, CFG.impersonationHours * 3600000);
      console.log(`[auth] consultation du compte ${target.id} par ${a.kind === 'user' ? a.user.id : 'système'}`);
      return res.json(sessionOut(target, sess));
    } catch (e) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  });

  app.post('/api/auth/test-token', async (req, res) => {
    if (!CFG.testHook) return deny(res, 404, 'Not found');
    const u = (await getUsers()).find((x) => x && x.id === (req.body && req.body.userId));
    if (!u) return deny(res, 404, 'no-user');
    return res.json(sessionOut(u, createSession({ kind: 'user', userId: u.id }, ttlFor(u.role))));
  });

  // --- démarrage : conversion des mots de passe en clair, sessions, liens directs ---
  async function migrate() {
    try {
      DUMMY_HASH = await hashSecret('mot-de-passe-factice');
      await loadSessions();
      const users = (await readKv(K.users)) || [];
      let n = 0;
      for (const u of users) {
        if (typeof u.password === 'string' && u.password) {
          if (!u.passwordHash) u.passwordHash = await hashSecret(u.password);
          delete u.password;
          n += 1;
        } else if ('password' in u) {
          delete u.password;
        }
        if (typeof u.secretAnswer === 'string' && u.secretAnswer) {
          if (!u.secretAnswerHash) u.secretAnswerHash = await hashSecret(normAnswer(u.secretAnswer));
          delete u.secretAnswer;
          n += 1;
        }
      }
      if (n > 0) {
        await saveUsers(users);
        console.log(`[auth] ${n} mot(s) de passe / réponse(s) secrète(s) en clair converti(s) en empreintes illisibles.`);
      }
      // Aucun administrateur (installation neuve, ou comptes perdus) : un compte « Administrateur » est créé avec un mot de passe
      // temporaire, affiché une seule fois dans le journal (INITIAL_ADMIN_PASSWORD le fixe à l'avance, sans l'afficher)
      if (!users.some((u) => u && u.role === 'admin')) {
        const fixed = process.env.INITIAL_ADMIN_PASSWORD || '';
        const pwd = fixed.length >= CFG.minPassword ? fixed : crypto.randomBytes(9).toString('base64url');
        users.push({ id: 'admin-initial', name: 'Administrateur', email: 'administrateur@portail.local', role: 'admin', passwordHash: await hashSecret(pwd), isDemo: false });
        await saveUsers(users);
        console.log(
          fixed.length >= CFG.minPassword
            ? '[auth] AUCUN compte administrateur : compte « Administrateur » créé avec le mot de passe INITIAL_ADMIN_PASSWORD (à changer dans Administration).'
            : `[auth] AUCUN compte administrateur : compte « Administrateur » créé. Mot de passe temporaire (à changer aussitôt dans Administration) : ${pwd}`
        );
      }
      // liens directs existants : une échéance de 30 jours est posée à partir d'aujourd'hui
      const links = (await readKv(K.magic)) || {};
      let m = 0;
      const exp = new Date(Date.now() + CFG.magicLinkDays * 86400000).toISOString();
      Object.keys(links).forEach((t) => {
        if (!links[t].expiresAt) {
          links[t].expiresAt = exp;
          m += 1;
        }
      });
      if (m > 0) {
        await writeKv(K.magic, links);
        console.log(`[auth] ${m} lien(s) direct(s) existant(s) : échéance fixée au ${exp.slice(0, 10)}.`);
      }
      console.log(`[auth] authentification active : sessions parents ${CFG.sessionDays} j, personnel ${CFG.staffSessionDays} j, blocage après ${CFG.maxFails} essais (${CFG.lockMinutes} min).`);
    } catch (e) {
      console.error('[auth] Migration impossible :', e);
    }
  }

  return { migrate, K, CFG, hashSecret, sanitizeUser };
}

module.exports = { install };
