const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'fichesanitaire',
  password: process.env.DB_PASSWORD || 'changeme',
  database: process.env.DB_NAME || 'fichesanitaire',
});

app.use(express.json({ limit: '15mb' }));

// --- Limite de taille des NOUVELLES pièces jointes (build attachments-limit-20261004) ---
// Une pièce jointe de plus de ~2,2 Mo (3 000 000 caractères en base64) est refusée si elle est
// nouvelle ou modifiée. Les pièces jointes déjà enregistrées restent modifiables : l'enregistrement
// d'une fiche déjà volumineuse n'est jamais bloqué. (Le navigateur compresse déjà les images ;
// ce contrôle protège contre un ancien navigateur ou un envoi direct.)
const MAX_ATTACHMENT_CHARS = 3000000;
async function attachmentSizeGuard(req, res, next) {
  try {
    const incoming = req.body && req.body.student;
    const docs = incoming && incoming.cerfa && Array.isArray(incoming.cerfa.documents) ? incoming.cerfa.documents : [];
    const heavy = docs.filter((d) => d && typeof d.dataUrl === 'string' && d.dataUrl.length > MAX_ATTACHMENT_CHARS);
    if (heavy.length > 0 && incoming && incoming.id) {
      const list = (await readKv(STUDENTS_KEY)) || [];
      const stored = list.find((s) => s && s.id === incoming.id);
      const storedDocs = stored && stored.cerfa && Array.isArray(stored.cerfa.documents) ? stored.cerfa.documents : [];
      const refused = heavy.find((d) => !storedDocs.some((o) => o && o.id === d.id && typeof o.dataUrl === 'string' && o.dataUrl.length === d.dataUrl.length));
      if (refused) {
        console.log(`[pieces-jointes] Refusé : « ${refused.name || refused.id} » (${Math.round(refused.dataUrl.length / 1024)} Ko) pour la fiche ${incoming.id}`);
        return res.status(413).json({ error: 'document-too-large', name: refused.name || '' });
      }
    }
  } catch (e) {
    console.error('[pieces-jointes] Erreur de contrôle :', e);
  }
  next();
}
app.post('/api/students/upsert', attachmentSizeGuard);
app.put('/api/magic-link/:token', attachmentSizeGuard);

// --- Protection du parent d'une fiche (build parent-guard-20261002) ---
// 1) Une NOUVELLE fiche sans identifiant de parent est refusée (sinon elle serait invisible
//    pour tous les comptes : fiche « orpheline »).
// 2) Un enregistrement ne peut jamais EFFACER le parent déjà enregistré sur la fiche.
async function parentIdGuard(req, res, next) {
  try {
    const incoming = req.body && req.body.student;
    if (incoming && incoming.id) {
      const list = (await readKv(STUDENTS_KEY)) || [];
      const stored = list.find((s) => s && s.id === incoming.id);
      if (stored) {
        if (stored.parentId && !incoming.parentId) {
          incoming.parentId = stored.parentId;
          console.log(`[parent-guard] parentId conservé pour la fiche ${incoming.id} (l'enregistrement reçu ne le contenait pas)`);
        }
      } else if (!incoming.parentId) {
        console.log(`[parent-guard] Création refusée : fiche ${incoming.id} sans parent`);
        return res.status(400).json({ error: 'parent-required' });
      }
    }
  } catch (e) {
    console.error('[parent-guard] Erreur de contrôle :', e);
  }
  next();
}
app.post('/api/students/upsert', parentIdGuard);
app.put('/api/magic-link/:token', parentIdGuard);

// ============================================================================
// Messagerie interne + popups (build messagerie-20261001)
// Données dans le kv_store : cerfa_messages_v1 (conversations) et cerfa_popups_v1 (popups).
// Ces deux clés ne sont JAMAIS renvoyées par GET /api/data ni GET/PUT /api/data/:key.
// ============================================================================
const MESSAGES_KEY = 'cerfa_messages_v1';
const POPUPS_KEY = 'cerfa_popups_v1';
const COMM_PRIVATE_PREFIXES = ['cerfa_messages', 'cerfa_popups'];
const isPrivateKvKey = (k) => COMM_PRIVATE_PREFIXES.some((p) => String(k).startsWith(p));

app.use('/api/data', (req, res, next) => {
  let key = '';
  try {
    key = decodeURIComponent((req.path || '/').replace(/^\//, ''));
  } catch {
    key = '';
  }
  if (key && isPrivateKvKey(key)) return res.status(403).json({ error: 'Accès refusé' });
  if (req.method === 'GET' && !key) {
    const originalJson = res.json.bind(res);
    res.json = (obj) => {
      if (obj && typeof obj === 'object') {
        Object.keys(obj).forEach((k) => {
          if (isPrivateKvKey(k)) delete obj[k];
        });
      }
      return originalJson(obj);
    };
  }
  next();
});

// Une seule écriture de messagerie à la fois (lecture-modification-écriture atomique)
let commChain = Promise.resolve();
function withCommLock(fn) {
  const run = commChain.then(fn);
  commChain = run.catch(() => {});
  return run;
}

const commId = (prefix) => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
const commClip = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

async function commGetUser(userId) {
  if (!userId) return null;
  const users = (await readKv(USERS_KEY)) || [];
  return users.find((u) => u && u.id === userId) || null;
}

// Retourne l'utilisateur si c'est un administrateur, sinon envoie un 403 et retourne null
async function commRequireAdmin(userId, res) {
  const user = await commGetUser(userId);
  if (!user || user.role !== 'admin') {
    res.status(403).json({ error: 'Action réservée à l\'administration.' });
    return null;
  }
  return user;
}

function commUnreadFor(user, threads) {
  if (user.role === 'admin') {
    return threads.filter((t) => t.lastFromRole === 'user' && (!t.adminReadAt || t.lastMessageAt > t.adminReadAt)).length;
  }
  return threads.filter(
    (t) => t.parentId === user.id && t.lastFromRole === 'admin' && (!t.userReadAt || t.lastMessageAt > t.userReadAt)
  ).length;
}

function commThreadForViewer(t, user) {
  const unread =
    user.role === 'admin'
      ? t.lastFromRole === 'user' && (!t.adminReadAt || t.lastMessageAt > t.adminReadAt)
      : t.lastFromRole === 'admin' && (!t.userReadAt || t.lastMessageAt > t.userReadAt);
  return { ...t, unread };
}

// Destinataires d'une audience (parents ou comptes précis)
function commResolveAudience(audience, users, students) {
  const type = audience && audience.type;
  const parents = users.filter((u) => u && u.role === 'parent');
  if (type === 'all_parents') return parents;
  if (type === 'class') {
    const names = new Set((audience.classNames || []).map(String));
    const parentIds = new Set(
      students.filter((s) => s && !s.deletedAt && names.has(s.schoolClass)).map((s) => s.parentId)
    );
    return parents.filter((u) => parentIds.has(u.id));
  }
  if (type === 'users') {
    const ids = new Set((audience.userIds || []).map(String));
    return users.filter((u) => u && u.role !== 'admin' && ids.has(u.id));
  }
  return [];
}

function commCleanAudience(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.type === 'all_parents') return { type: 'all_parents' };
  if (a.type === 'class') {
    const classNames = (Array.isArray(a.classNames) ? a.classNames : []).map((n) => commClip(n, 80)).filter(Boolean).slice(0, 100);
    return classNames.length ? { type: 'class', classNames } : null;
  }
  if (a.type === 'users') {
    const userIds = (Array.isArray(a.userIds) ? a.userIds : []).map((n) => commClip(n, 120)).filter(Boolean).slice(0, 2000);
    return userIds.length ? { type: 'users', userIds } : null;
  }
  return null;
}

// --- Popups : état et ciblage ---
function popupStatus(p, now) {
  if (!p.active) return 'disabled';
  if (p.expiresAt && p.expiresAt <= now) return 'expired';
  return 'active';
}

function popupTargetsUser(p, user, students) {
  const a = p.audience || {};
  if (a.type === 'all_parents') return user.role === 'parent';
  if (a.type === 'users') return (a.userIds || []).includes(user.id);
  if (a.type === 'class') {
    if (user.role !== 'parent') return false;
    const names = new Set(a.classNames || []);
    return students.some((s) => s && !s.deletedAt && s.parentId === user.id && names.has(s.schoolClass));
  }
  return false;
}

const POPUP_LEVEL_RANK = { urgent: 0, important: 1, info: 2 };
function popupPublicView(p) {
  return { id: p.id, title: p.title, body: p.body, level: p.level, requireAck: !!p.requireAck, createdAt: p.createdAt };
}

app.post('/api/comm/poll', async (req, res) => {
  try {
    const user = await commGetUser(req.body && req.body.userId);
    if (!user) return res.json({ unreadMessages: 0, popups: [] });
    const threads = (await readKv(MESSAGES_KEY)) || [];
    const popups = (await readKv(POPUPS_KEY)) || [];
    const now = new Date().toISOString();
    let students = [];
    if (popups.some((p) => p.audience && p.audience.type === 'class')) students = (await readKv(STUDENTS_KEY)) || [];
    const mine = popups
      .filter((p) => popupStatus(p, now) === 'active' && !(p.acks && p.acks[user.id]) && popupTargetsUser(p, user, students))
      .sort((a, b) => (POPUP_LEVEL_RANK[a.level] - POPUP_LEVEL_RANK[b.level]) || (a.createdAt < b.createdAt ? 1 : -1))
      .map(popupPublicView);
    res.json({ unreadMessages: commUnreadFor(user, threads), popups: mine });
  } catch (e) {
    console.error('[messagerie] poll :', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// --- Messagerie ---
app.post('/api/messages/list', async (req, res) => {
  try {
    const user = await commGetUser(req.body && req.body.userId);
    if (!user) return res.status(403).json({ error: 'Utilisateur inconnu.' });
    const threads = (await readKv(MESSAGES_KEY)) || [];
    const visible =
      user.role === 'admin'
        ? threads.filter((t) => !(t.kind === 'welcome' && (t.messages || []).length <= 1))
        : threads.filter((t) => t.parentId === user.id);
    visible.sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
    res.json({ threads: visible.map((t) => commThreadForViewer(t, user)) });
  } catch (e) {
    console.error('[messagerie] list :', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/messages/send', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, threadId, parentId, subject, body, studentLabel } = req.body || {};
      const user = await commGetUser(userId);
      if (!user) return res.status(403).json({ error: 'Utilisateur inconnu.' });
      const text = commClip(body, 5000);
      if (!text) return res.status(400).json({ error: 'Le message est vide.' });
      const isAdmin = user.role === 'admin';
      const now = new Date().toISOString();
      const message = {
        id: commId('m'),
        fromRole: isAdmin ? 'admin' : 'user',
        fromUserId: user.id,
        fromName: user.name || 'Utilisateur',
        body: text,
        createdAt: now,
      };
      const threads = (await readKv(MESSAGES_KEY)) || [];
      let thread;
      if (threadId) {
        thread = threads.find((t) => t.id === threadId);
        if (!thread) return res.status(404).json({ error: 'Conversation introuvable.' });
        if (!isAdmin && thread.parentId !== user.id) return res.status(403).json({ error: 'Accès refusé.' });
        thread.messages.push(message);
      } else {
        let owner = user;
        if (isAdmin) {
          owner = await commGetUser(parentId);
          if (!owner || owner.role === 'admin') return res.status(400).json({ error: 'Destinataire invalide.' });
        }
        thread = {
          id: commId('t'),
          parentId: owner.id,
          parentName: owner.name || 'Parent',
          subject: commClip(subject, 150) || 'Sans objet',
          studentLabel: commClip(studentLabel, 150) || undefined,
          createdAt: now,
          messages: [message],
        };
        threads.push(thread);
      }
      thread.lastMessageAt = now;
      thread.lastFromRole = message.fromRole;
      if (isAdmin) thread.adminReadAt = now;
      else thread.userReadAt = now;
      await writeKv(MESSAGES_KEY, threads);
      res.json({ thread: commThreadForViewer(thread, user) });
    });
  } catch (e) {
    console.error('[messagerie] send :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/messages/read', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, threadId } = req.body || {};
      const user = await commGetUser(userId);
      if (!user) return res.status(403).json({ error: 'Utilisateur inconnu.' });
      const threads = (await readKv(MESSAGES_KEY)) || [];
      const t = threads.find((x) => x.id === threadId);
      if (!t) return res.status(404).json({ error: 'Conversation introuvable.' });
      if (user.role !== 'admin' && t.parentId !== user.id) return res.status(403).json({ error: 'Accès refusé.' });
      const now = new Date().toISOString();
      if (user.role === 'admin') t.adminReadAt = now;
      else t.userReadAt = now;
      await writeKv(MESSAGES_KEY, threads);
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('[messagerie] read :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/messages/delete', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, threadId } = req.body || {};
      if (!(await commRequireAdmin(userId, res))) return;
      const threads = (await readKv(MESSAGES_KEY)) || [];
      await writeKv(MESSAGES_KEY, threads.filter((t) => t.id !== threadId));
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('[messagerie] delete :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/messages/broadcast', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, audience, subject, body } = req.body || {};
      const admin = await commRequireAdmin(userId, res);
      if (!admin) return;
      const aud = commCleanAudience(audience);
      const text = commClip(body, 5000);
      if (!aud) return res.status(400).json({ error: 'Destinataires invalides.' });
      if (!text) return res.status(400).json({ error: 'Le message est vide.' });
      const users = (await readKv(USERS_KEY)) || [];
      const students = aud.type === 'class' ? (await readKv(STUDENTS_KEY)) || [] : [];
      const recipients = commResolveAudience(aud, users, students);
      if (recipients.length === 0) return res.status(400).json({ error: 'Aucun destinataire trouvé.' });
      const threads = (await readKv(MESSAGES_KEY)) || [];
      const now = new Date().toISOString();
      const subj = commClip(subject, 150) || 'Message de l\'établissement';
      recipients.forEach((r) => {
        threads.push({
          id: commId('t'),
          parentId: r.id,
          parentName: r.name || 'Parent',
          subject: subj,
          createdAt: now,
          lastMessageAt: now,
          lastFromRole: 'admin',
          adminReadAt: now,
          messages: [
            { id: commId('m'), fromRole: 'admin', fromUserId: admin.id, fromName: admin.name || 'Administration', body: text, createdAt: now, kind: 'broadcast' },
          ],
        });
      });
      await writeKv(MESSAGES_KEY, threads);
      console.log(`[messagerie] Message collectif envoyé à ${recipients.length} destinataire(s) par ${admin.id}`);
      res.json({ count: recipients.length });
    });
  } catch (e) {
    console.error('[messagerie] broadcast :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// --- Popups ---
app.post('/api/popups/send', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, title, body, level, audience, expiresInMinutes, requireAck } = req.body || {};
      const admin = await commRequireAdmin(userId, res);
      if (!admin) return;
      const aud = commCleanAudience(audience);
      const t = commClip(title, 120);
      const b = commClip(body, 2000);
      if (!aud) return res.status(400).json({ error: 'Destinataires invalides.' });
      if (!t || !b) return res.status(400).json({ error: 'Titre et message obligatoires.' });
      const lvl = ['info', 'important', 'urgent'].includes(level) ? level : 'info';
      const minutes = Number(expiresInMinutes);
      const now = new Date();
      const popup = {
        id: commId('p'),
        title: t,
        body: b,
        level: lvl,
        audience: aud,
        requireAck: lvl === 'urgent' ? true : !!requireAck,
        createdAt: now.toISOString(),
        createdBy: admin.id,
        createdByName: admin.name || 'Administration',
        expiresAt: Number.isFinite(minutes) && minutes > 0 ? new Date(now.getTime() + Math.min(minutes, 60 * 24 * 365) * 60000).toISOString() : null,
        active: true,
        acks: {},
      };
      const popups = (await readKv(POPUPS_KEY)) || [];
      popups.push(popup);
      await writeKv(POPUPS_KEY, popups);
      const users = (await readKv(USERS_KEY)) || [];
      const students = aud.type === 'class' ? (await readKv(STUDENTS_KEY)) || [] : [];
      const recipients = commResolveAudience(aud, users, students).length;
      console.log(`[messagerie] Popup "${t}" (${lvl}) publié pour ${recipients} destinataire(s) par ${admin.id}`);
      res.json({ popup: popupPublicView(popup), recipients });
    });
  } catch (e) {
    console.error('[messagerie] popup send :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/popups/list', async (req, res) => {
  try {
    if (!(await commRequireAdmin(req.body && req.body.userId, res))) return;
    const popups = (await readKv(POPUPS_KEY)) || [];
    const users = (await readKv(USERS_KEY)) || [];
    const students = (await readKv(STUDENTS_KEY)) || [];
    const now = new Date().toISOString();
    const out = popups
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((p) => ({
        ...popupPublicView(p),
        audience: p.audience,
        createdByName: p.createdByName,
        expiresAt: p.expiresAt,
        active: p.active,
        status: popupStatus(p, now),
        recipients: commResolveAudience(p.audience, users, students).length,
        acked: Object.keys(p.acks || {}).length,
      }));
    res.json({ popups: out });
  } catch (e) {
    console.error('[messagerie] popup list :', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/popups/deactivate', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, popupId } = req.body || {};
      if (!(await commRequireAdmin(userId, res))) return;
      const popups = (await readKv(POPUPS_KEY)) || [];
      const p = popups.find((x) => x.id === popupId);
      if (!p) return res.status(404).json({ error: 'Popup introuvable.' });
      p.active = false;
      await writeKv(POPUPS_KEY, popups);
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('[messagerie] popup deactivate :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/popups/delete', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, popupId } = req.body || {};
      if (!(await commRequireAdmin(userId, res))) return;
      const popups = (await readKv(POPUPS_KEY)) || [];
      await writeKv(POPUPS_KEY, popups.filter((x) => x.id !== popupId));
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('[messagerie] popup delete :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/popups/ack', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, popupId } = req.body || {};
      const user = await commGetUser(userId);
      if (!user) return res.status(403).json({ error: 'Utilisateur inconnu.' });
      const popups = (await readKv(POPUPS_KEY)) || [];
      const p = popups.find((x) => x.id === popupId);
      if (!p) return res.status(404).json({ error: 'Popup introuvable.' });
      p.acks = p.acks || {};
      if (!p.acks[user.id]) p.acks[user.id] = new Date().toISOString();
      await writeKv(POPUPS_KEY, popups);
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('[messagerie] popup ack :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Popups « tous les parents » visibles sans connexion (lien direct) : aucune donnée personnelle
// --- Message d'accueil par défaut pour chaque nouveau compte parent (build accueil-20261001) ---
// Texte modifiable par l'administration (Messagerie > Message d'accueil). Stocké dans
// cerfa_messages_welcome_v1 (clé privée : jamais renvoyée par /api/data).
const WELCOME_KEY = 'cerfa_messages_welcome_v1';
const WELCOME_DEFAULT_SUBJECT = 'Bienvenue — à lire avant de commencer';
const WELCOME_DEFAULT_BODY = `Bonjour {prenom},

Bienvenue sur le portail des fiches sanitaires de liaison de l'Ensemble Scolaire Notre Dame des Missions.

Merci de créer un compte par enfant. Chaque enfant a sa propre fiche sanitaire, et la signature d'un seul responsable légal suffit pour la valider : il n'est donc pas nécessaire que les deux parents créent un compte ni signent la fiche.

Si vous avez plusieurs enfants, utilisez une adresse e-mail différente pour chaque compte (une adresse e-mail ne peut servir qu'à un seul compte).

Si la fiche de votre enfant a déjà été créée par l'autre responsable légal, ne la recréez pas : le portail vous le signalera.

Une question ? Répondez simplement à ce message depuis la messagerie.

Cordialement,
L'établissement`;

async function commGetWelcomeConfig() {
  const c = (await readKv(WELCOME_KEY)) || {};
  return {
    enabled: c.enabled !== false,
    subject: c.subject || WELCOME_DEFAULT_SUBJECT,
    body: c.body || WELCOME_DEFAULT_BODY,
  };
}

function commRenderWelcome(text, user) {
  // Seuls firstName / lastName renseignés sont utilisés (jamais de découpage du nom complet :
  // « DUPONT Jean » serait mal salué). Sans prénom : « Bonjour, ».
  const first = commClip(user.firstName || '', 80);
  const last = commClip(user.lastName || '', 80);
  return String(text)
    .replace(/\s*\{prenom\}/g, first ? ' ' + first : '')
    .replace(/\s*\{nom\}/g, last ? ' ' + last : '');
}

function commBuildWelcomeThread(user, cfg, now) {
  return {
    id: commId('t'),
    parentId: user.id,
    parentName: user.name || 'Parent',
    subject: commRenderWelcome(cfg.subject, user),
    kind: 'welcome',
    createdAt: now,
    lastMessageAt: now,
    lastFromRole: 'admin',
    adminReadAt: now,
    messages: [
      {
        id: commId('m'),
        fromRole: 'admin',
        fromUserId: 'system',
        fromName: 'Administration',
        body: commRenderWelcome(cfg.body, user),
        createdAt: now,
      },
    ],
  };
}

// Crée le message d'accueil d'un parent (une seule fois par compte). Retourne true si créé.
async function commSendWelcome(user) {
  return withCommLock(async () => {
    const cfg = await commGetWelcomeConfig();
    if (!cfg.enabled) return false;
    const threads = (await readKv(MESSAGES_KEY)) || [];
    if (threads.some((t) => t.parentId === user.id && t.kind === 'welcome')) return false;
    threads.push(commBuildWelcomeThread(user, cfg, new Date().toISOString()));
    await writeKv(MESSAGES_KEY, threads);
    console.log(`[messagerie] Message d'accueil envoyé à ${user.id}`);
    return true;
  });
}

// --- Verrou sur les écritures de comptes ---
// Sans verrou, deux créations de compte simultanées se lisent / s'écrasent l'une l'autre
// (mesuré : 5 comptes conservés sur 15 créations simultanées). Les écritures de comptes
// passent désormais l'une après l'autre.
let userWriteChain = Promise.resolve();
function lockUserWrites() {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const previous = userWriteChain;
  userWriteChain = previous.then(() => gate);
  return previous.then(() => release);
}
async function userWriteGuard(req, res, next) {
  const release = await lockUserWrites();
  let done = false;
  let timer = null;
  const unlock = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    release();
  };
  timer = setTimeout(unlock, 20000); // sécurité : jamais de verrou bloqué
  res.on('finish', unlock);
  res.on('close', unlock);
  next();
}
app.post('/api/users/upsert', userWriteGuard);
app.post('/api/users/remove', userWriteGuard);

// Avant l'enregistrement d'un compte : si c'est un NOUVEAU parent, son message d'accueil est prêt
// avant même sa première connexion.
app.post('/api/users/upsert', async (req, res, next) => {
  try {
    const u = req.body && req.body.user;
    if (u && u.id && u.role === 'parent') {
      const users = (await readKv(USERS_KEY)) || [];
      if (!users.some((x) => x && x.id === u.id)) {
        await commSendWelcome({ id: u.id, name: u.name, firstName: u.firstName, lastName: u.lastName });
      }
    }
  } catch (e) {
    console.error("[messagerie] Message d'accueil impossible :", e);
  }
  next();
});

app.post('/api/messages/welcome/get', async (req, res) => {
  try {
    if (!(await commRequireAdmin(req.body && req.body.userId, res))) return;
    res.json({
      config: await commGetWelcomeConfig(),
      defaults: { subject: WELCOME_DEFAULT_SUBJECT, body: WELCOME_DEFAULT_BODY },
    });
  } catch (e) {
    console.error('[messagerie] welcome get :', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/messages/welcome/save', async (req, res) => {
  try {
    await withCommLock(async () => {
      const { userId, enabled, subject, body } = req.body || {};
      const admin = await commRequireAdmin(userId, res);
      if (!admin) return;
      const s = commClip(subject, 150);
      const b = commClip(body, 5000);
      if (!s || !b) return res.status(400).json({ error: 'Objet et message obligatoires.' });
      await writeKv(WELCOME_KEY, { enabled: !!enabled, subject: s, body: b, updatedAt: new Date().toISOString(), updatedBy: admin.id });
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('[messagerie] welcome save :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Envoie le message d'accueil aux parents déjà inscrits qui ne l'ont pas encore reçu
app.post('/api/messages/welcome/send-existing', async (req, res) => {
  try {
    await withCommLock(async () => {
      if (!(await commRequireAdmin(req.body && req.body.userId, res))) return;
      const cfg = await commGetWelcomeConfig();
      const users = (await readKv(USERS_KEY)) || [];
      const threads = (await readKv(MESSAGES_KEY)) || [];
      const already = new Set(threads.filter((t) => t.kind === 'welcome').map((t) => t.parentId));
      const now = new Date().toISOString();
      let count = 0;
      users
        .filter((u) => u && u.role === 'parent' && !already.has(u.id))
        .forEach((u) => {
          threads.push(commBuildWelcomeThread(u, cfg, now));
          count += 1;
        });
      if (count > 0) await writeKv(MESSAGES_KEY, threads);
      console.log(`[messagerie] Message d'accueil envoyé aux parents existants : ${count}`);
      res.json({ count });
    });
  } catch (e) {
    console.error('[messagerie] welcome send-existing :', e);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/popups/public', async (req, res) => {
  try {
    const popups = (await readKv(POPUPS_KEY)) || [];
    const now = new Date().toISOString();
    res.json({
      popups: popups
        .filter((p) => popupStatus(p, now) === 'active' && p.audience && p.audience.type === 'all_parents')
        .sort((a, b) => (POPUP_LEVEL_RANK[a.level] - POPUP_LEVEL_RANK[b.level]) || (a.createdAt < b.createdAt ? 1 : -1))
        .map(popupPublicView),
    });
  } catch (e) {
    console.error('[messagerie] popup public :', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// --- Anti-écrasement : contrôle de version des fiches + verrou d'écriture ---
// Le client envoie "baseUpdatedAt" (la version de la fiche sur laquelle il s'appuie).
// Si la fiche a été enregistrée par quelqu'un d'autre entre-temps (autre responsable,
// autre appareil, administration), l'enregistrement est refusé (409 "conflict") au lieu
// d'écraser son travail. Sans baseUpdatedAt (anciens clients), aucun contrôle n'est fait.
let studentWriteChain = Promise.resolve();
function lockStudentWrites() {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const previous = studentWriteChain;
  studentWriteChain = previous.then(() => gate);
  return previous.then(() => release);
}

async function studentVersionGuard(req, res, next) {
  const release = await lockStudentWrites();
  let done = false;
  let timer = null;
  const unlock = () => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    release();
  };
  timer = setTimeout(unlock, 20000); // sécurité : jamais de verrou bloqué
  res.on('finish', unlock);
  res.on('close', unlock);
  try {
    const body = req.body || {};
    const incoming = body.student;
    if (incoming && incoming.id) {
      const list = (await readKv(STUDENTS_KEY)) || [];
      const stored = list.find((s) => s.id === incoming.id);
      if (stored) {
        if (body.baseUpdatedAt && stored.updatedAt && stored.updatedAt !== body.baseUpdatedAt) {
          console.log(`[anti-ecrasement] Enregistrement refusé (fiche modifiée entre-temps) : ${incoming.id}`);
          return res.status(409).json({ error: 'conflict', currentUpdatedAt: stored.updatedAt });
        }
        // La date d'archivage du PDF est posée par le serveur : un enregistrement ne doit jamais la perdre
        if (stored.pdfSentAt && !incoming.pdfSentAt) incoming.pdfSentAt = stored.pdfSentAt;
      }
    }
    next();
  } catch (e) {
    console.error("[anti-ecrasement] Erreur de contrôle :", e);
    unlock();
    res.status(500).json({ error: 'Erreur serveur' });
  }
}
app.post('/api/students/upsert', studentVersionGuard);
app.put('/api/magic-link/:token', studentVersionGuard);

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
}

app.get('/api/data', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM kv_store');
    const result = {};
    rows.forEach((r) => { result[r.key] = r.value; });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/data/:key', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [req.params.key]);
    if (rows.length === 0) return res.status(404).json({ error: 'Non trouvé' });
    res.json({ key: req.params.key, value: rows[0].value });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/data/:key', async (req, res) => {
  try {
    const { value } = req.body;
    await pool.query(
      `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [req.params.key, JSON.stringify(value)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// --- Écritures fusionnées côté serveur, pour éviter qu'un navigateur resté
// ouvert trop longtemps (état périmé) n'écrase ce que d'autres ont ajouté
// entre-temps. Le client n'envoie plus jamais "toute la liste" : seulement
// l'élément à ajouter/modifier/retirer, et c'est le serveur qui fusionne. ---

async function upsertInArray(key, item, idField = 'id') {
  const list = (await readKv(key)) || [];
  const idx = list.findIndex((it) => it[idField] === item[idField]);
  if (idx === -1) {
    list.push(item);
  } else {
    list[idx] = item;
  }
  await writeKv(key, list);
  return list;
}

async function removeFromArray(key, itemId, idField = 'id') {
  const list = (await readKv(key)) || [];
  const filtered = list.filter((it) => it[idField] !== itemId);
  await writeKv(key, filtered);
  return filtered;
}

// --- Anti-doublons : un seul dossier par élève (même prénom + nom) ---
function dupNorm(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
// Clé indépendante de l'ordre (certains parents inversent nom et prénom)
function dupKey(first, last) {
  return [dupNorm(first), dupNorm(last)].sort().join('|');
}
function findDuplicateStudents(students, first, last, excludeId) {
  if (!dupNorm(first) || !dupNorm(last)) return [];
  const key = dupKey(first, last);
  return (students || []).filter((s) => {
    if (!s || s.deletedAt || s.id === excludeId) return false;
    const idt = (s.cerfa && s.cerfa.identity) || {};
    return dupKey(idt.firstName, idt.lastName) === key;
  });
}

// Vérification en direct (formulaire "Ajouter un enfant") : ne renvoie AUCUNE donnée personnelle
app.post('/api/students/check-duplicate', async (req, res) => {
  try {
    const { firstName, lastName, parentId, excludeStudentId } = req.body || {};
    const students = (await readKv(STUDENTS_KEY)) || [];
    const matches = findDuplicateStudents(students, firstName, lastName, excludeStudentId);
    res.json({
      duplicate: matches.length > 0,
      sameAccount: !!parentId && matches.some((s) => s.parentId === parentId),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/students/upsert', async (req, res) => {
  try {
    const { student, checkDuplicate } = req.body;
    if (!student || !student.id) return res.status(400).json({ error: 'student manquant ou invalide' });

    // Création par un parent : refus si une fiche existe déjà pour ce prénom + nom
    if (checkDuplicate) {
      const list = (await readKv(STUDENTS_KEY)) || [];
      const isNew = !list.some((s) => s.id === student.id);
      const idt = (student.cerfa && student.cerfa.identity) || {};
      if (isNew && findDuplicateStudents(list, idt.firstName, idt.lastName, student.id).length > 0) {
        console.log('[dup-guard] Création refusée (doublon) :', idt.lastName, idt.firstName);
        return res.status(409).json({ error: 'duplicate' });
      }
    }

    await upsertInArray(STUDENTS_KEY, student);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/students/remove', async (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId manquant' });
    await removeFromArray(STUDENTS_KEY, studentId);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const USERS_KEY = 'cerfa_users_v1';

app.post('/api/users/upsert', async (req, res) => {
  try {
    const { user } = req.body;
    if (!user || !user.id) return res.status(400).json({ error: 'user manquant ou invalide' });
    await upsertInArray(USERS_KEY, user);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/users/remove', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId manquant' });
    await removeFromArray(USERS_KEY, userId);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// --- Lien direct sans connexion (façon DocuSeal) : accès à UN SEUL élève,
// via un jeton imprévisible, sans jamais exposer les autres élèves ---
const STUDENTS_KEY = 'cerfa_students_v11';
const MAGIC_LINKS_KEY = 'cerfa_magic_links_v1';

async function readKv(key) {
  const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
  return rows.length > 0 ? rows[0].value : null;
}

async function writeKv(key, value) {
  await pool.query(
    `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

// Génère (ou réutilise) un jeton d'accès direct pour un élève donné
async function getOrCreateMagicLinkToken(studentId) {
  const links = (await readKv(MAGIC_LINKS_KEY)) || {};
  const existingEntry = Object.entries(links).find(([, v]) => v.studentId === studentId);
  if (existingEntry) return existingEntry[0];

  const token = crypto.randomBytes(24).toString('hex');
  links[token] = { studentId, createdAt: new Date().toISOString() };
  await writeKv(MAGIC_LINKS_KEY, links);
  return token;
}

app.post('/api/magic-link/generate', async (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId manquant' });
    const token = await getOrCreateMagicLinkToken(studentId);
    res.json({ token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Révoque manuellement le(s) lien(s) direct(s) existant(s) d'un élève :
// l'ancien lien cesse immédiatement de fonctionner. Un nouveau jeton sera
// généré à la prochaine demande (bouton "Copier le lien").
app.post('/api/magic-link/revoke', async (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId manquant' });

    const links = (await readKv(MAGIC_LINKS_KEY)) || {};
    let revokedCount = 0;
    for (const token of Object.keys(links)) {
      if (links[token].studentId === studentId) {
        delete links[token];
        revokedCount++;
      }
    }
    if (revokedCount > 0) {
      await writeKv(MAGIC_LINKS_KEY, links);
    }
    res.json({ ok: true, revokedCount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Lecture via jeton — ne renvoie jamais que l'élève concerné, jamais la liste complète
app.get('/api/magic-link/:token', async (req, res) => {
  try {
    const links = (await readKv(MAGIC_LINKS_KEY)) || {};
    const entry = links[req.params.token];
    if (!entry) return res.status(404).json({ error: 'Lien invalide.' });

    const students = (await readKv(STUDENTS_KEY)) || [];
    const student = students.find((s) => s.id === entry.studentId);
    if (!student) return res.status(404).json({ error: 'Élève introuvable.' });

    // Les fiches complètes restent accessibles via leur lien direct (consultation
    // et modification possibles), elles ne sont plus bloquées ici.

    const classes = (await readKv('cerfa_classes_v1')) || [];
    const trips = (await readKv('cerfa_trips_v2')) || [];
    const establishmentName = await readKv('cerfa_establishment_name_v1');
    const logoUrl = await readKv('cerfa_logo_v1');

    res.json({ student, classes, trips, establishmentName, logoUrl });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Écriture via jeton — fusionne l'élève mis à jour dans la liste complète,
// côté serveur uniquement (le client ne reçoit et n'envoie jamais la liste entière)
app.put('/api/magic-link/:token', async (req, res) => {
  try {
    const links = (await readKv(MAGIC_LINKS_KEY)) || {};
    const entry = links[req.params.token];
    if (!entry) return res.status(404).json({ error: 'Lien invalide.' });

    const updatedStudent = req.body.student;
    if (!updatedStudent || updatedStudent.id !== entry.studentId) {
      return res.status(400).json({ error: 'Données invalides pour ce lien.' });
    }

    const students = (await readKv(STUDENTS_KEY)) || [];
    const idx = students.findIndex((s) => s.id === entry.studentId);
    if (idx === -1) return res.status(404).json({ error: 'Élève introuvable.' });

    students[idx] = updatedStudent;
    await writeKv(STUDENTS_KEY, students);

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// --- Envoi de mails de relance (fiches sanitaires incomplètes) ---
let mailTransporter = null;
function getMailTransporter() {
  if (mailTransporter) return mailTransporter;
  if (!process.env.SMTP_HOST) return null;
  mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  return mailTransporter;
}

// --- Archivage des fiches sanitaires complètes (PDF) sur le serveur ---
// Plus d'envoi par e-mail : chaque PDF est enregistré dans
//   <PDF_ARCHIVE_DIR>/<Classe>/<NOM_Prenom>.pdf
// Dossiers = une classe par dossier ; fichiers triés par ordre alphabétique du nom.
// Sur l'hôte (LXC) : /opt/fichesanitaire-voyages/fiches-pdf/
const PDF_ARCHIVE_DIR = process.env.PDF_ARCHIVE_DIR || '/app/fiches-pdf';
const PDF_INDEX_FILE = path.join(PDF_ARCHIVE_DIR, '.index.json');

try {
  fs.mkdirSync(PDF_ARCHIVE_DIR, { recursive: true });
  console.log("[fiches-pdf] build pdf-archive-20261001 - dossier d'archivage :", PDF_ARCHIVE_DIR);
} catch (e) {
  console.error("[fiches-pdf] Impossible de créer le dossier d'archivage:", e);
}

// Transforme un texte en nom de fichier/dossier sûr (sans accents, sans espaces ni "/" ni ".")
function pdfSlug(value, fallback) {
  const s = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || fallback;
}

function readPdfIndex() {
  try {
    return JSON.parse(fs.readFileSync(PDF_INDEX_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Écritures séquentielles pour ne jamais corrompre l'index
let pdfArchiveQueue = Promise.resolve();
function runPdfArchiveExclusive(task) {
  const run = pdfArchiveQueue.then(task);
  pdfArchiveQueue = run.catch(() => {});
  return run;
}

async function archiveStudentPdf({ studentId, buffer, lastName, firstName, schoolClass }) {
  return runPdfArchiveExclusive(async () => {
    const classDir = pdfSlug(schoolClass, 'Sans_classe');
    const base = `${pdfSlug(String(lastName || '').toUpperCase(), 'SANS_NOM')}_${pdfSlug(firstName, 'Sans_prenom')}`;
    const index = readPdfIndex();

    let rel = `${classDir}/${base}.pdf`;
    // Homonymes dans la même classe : on suffixe avec un extrait de l'identifiant
    if (Object.keys(index).some((id) => id !== studentId && index[id] === rel)) {
      rel = `${classDir}/${base}_${pdfSlug(studentId, 'id').slice(0, 8)}.pdf`;
    }

    const target = path.join(PDF_ARCHIVE_DIR, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, target);

    // Si l'élève a changé de classe ou de nom : on supprime l'ancien fichier
    const previous = index[studentId];
    if (previous && previous !== rel) {
      const previousFile = path.join(PDF_ARCHIVE_DIR, previous);
      try { fs.unlinkSync(previousFile); } catch {}
      try { fs.rmdirSync(path.dirname(previousFile)); } catch {} // uniquement si le dossier est vide
    }

    index[studentId] = rel;
    fs.writeFileSync(PDF_INDEX_FILE, JSON.stringify(index, null, 2));
    return rel;
  });
}

app.post('/api/students/send-pdf', async (req, res) => {
  try {
    const { studentId, pdfBase64, studentName, schoolClass } = req.body || {};
    if (!studentId || !pdfBase64) {
      return res.status(400).json({ error: 'studentId ou pdfBase64 manquant' });
    }

    const buffer = Buffer.from(String(pdfBase64).replace(/^data:[^,]*,/, ''), 'base64');
    if (buffer.length < 100 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return res.status(400).json({ error: "Le contenu reçu n'est pas un PDF valide" });
    }

    const students = (await readKv(STUDENTS_KEY)) || [];
    const idx = students.findIndex((s) => s.id === studentId);
    const stored = idx !== -1 ? students[idx] : null;
    const identity = (stored && stored.cerfa && stored.cerfa.identity) || {};

    let firstName = identity.firstName;
    let lastName = identity.lastName;
    if (!firstName && !lastName && studentName) {
      const parts = String(studentName).trim().split(/\s+/);
      firstName = parts.shift();
      lastName = parts.join(' ');
    }

    const rel = await archiveStudentPdf({
      studentId,
      buffer,
      lastName,
      firstName,
      schoolClass: schoolClass || (stored && stored.schoolClass) || '',
    });
    console.log(`[fiches-pdf] Fiche archivée : ${rel} (${buffer.length} octets)`);

    // Régénération en masse (onglet Établissement) : le fichier est remplacé, la fiche N'EST PAS réécrite
    // (la date d'archivage n'est posée que si elle manquait : fiche complète d'avant l'archivage serveur)
    if (req.body && req.body.regenerate === true && stored && stored.pdfSentAt) {
      return res.json({ ok: true, sentAt: stored.pdfSentAt, path: rel, regenerated: true });
    }

    // Enregistre la date d'archivage sur CET élève uniquement (relecture juste avant écriture)
    const sentAt = new Date().toISOString();
    const fresh = (await readKv(STUDENTS_KEY)) || [];
    const freshIdx = fresh.findIndex((s) => s.id === studentId);
    if (freshIdx !== -1) {
      fresh[freshIdx] = { ...fresh[freshIdx], pdfSentAt: sentAt };
      await writeKv(STUDENTS_KEY, fresh);
    }

    res.json({ ok: true, sentAt, path: rel });
  } catch (e) {
    console.error('[fiches-pdf] Échec archivage PDF fiche sanitaire:', e);
    res.status(500).json({ error: "Erreur serveur lors de l'archivage du PDF" });
  }
});

app.post('/api/reminders/send', async (req, res) => {
  try {
    const transporter = getMailTransporter();
    if (!transporter) {
      return res.status(503).json({ error: "Serveur mail non configuré (variables SMTP_* manquantes)." });
    }

    const reminders = Array.isArray(req.body.reminders) ? req.body.reminders : [];
    if (reminders.length === 0) {
      return res.status(400).json({ error: 'Aucune relance à envoyer.' });
    }

    const results = [];
    for (const r of reminders) {
      try {
        if (!r.to) throw new Error('Adresse email du parent manquante');
        if (!r.subject || !r.text) throw new Error('Sujet ou message vide');
        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: r.to,
          subject: r.subject,
          text: r.text,
          html: String(r.text).replace(/\n/g, '<br>'),
        });
        results.push({ studentName: r.studentName, to: r.to, ok: true });
      } catch (err) {
        console.error('Échec envoi relance pour', r.studentName, err.message);
        results.push({ studentName: r.studentName, to: r.to, ok: false, error: err.message });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    res.json({ sent, failed: results.length - sent, results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur lors de l\'envoi des relances.' });
  }
});

// --- Relances automatiques hebdomadaires (fiches incomplètes) ---
const AUTO_REMINDER_ENABLED_KEY = 'cerfa_auto_reminder_enabled_v1';
const AUTO_REMINDER_LAST_RUN_KEY = 'cerfa_last_auto_reminder_run_v1';
const REMINDER_TEMPLATE_KEY = 'cerfa_reminder_template_v1';

const DEFAULT_REMINDER_SUBJECT = 'Fiche sanitaire incomplète — {prenom} {nom}';
const DEFAULT_REMINDER_BODY = `Bonjour,

La fiche sanitaire de liaison de {prenom} {nom} (classe {classe}) est actuellement incomplète ({pourcentage}%).

Éléments manquants :
{manquants}

Merci de vous connecter au portail pour la compléter :
{lien}

Cordialement,
{etablissement}`;

// Réplique en JavaScript la logique de src/utils/cerfaValidation.ts
// (computeCerfaCompleteness) pour pouvoir calculer les éléments manquants
// côté serveur, sans dépendre du code frontend TypeScript compilé.
function computeCompleteness(cerfa) {
  const missing = [];
  let score = 0;
  const totalPoints = 14;

  if (cerfa.identity?.lastName?.trim() && cerfa.identity?.firstName?.trim() && cerfa.identity?.birthDate && cerfa.identity?.gender) {
    score += 2;
  } else {
    if (!cerfa.identity?.lastName?.trim()) missing.push("Nom de famille de l'enfant");
    if (!cerfa.identity?.firstName?.trim()) missing.push("Prénom de l'enfant");
    if (!cerfa.identity?.birthDate) missing.push('Date de naissance de l\'enfant');
    if (!cerfa.identity?.gender) missing.push('Sexe de l\'enfant (Garçon / Fille)');
  }

  score += 3; // vaccinations (informatif, non bloquant)

  if (cerfa.medicalInfo?.hasMedicalTreatment) {
    if (cerfa.medicalInfo?.treatmentDetails?.trim()) score += 2;
    else missing.push('Détail du traitement médical en cours (médicament, posologie)');
  } else {
    score += 2;
  }

  if (cerfa.medicalInfo?.hasPai) {
    const hasPaiDoc = (cerfa.documents || []).some((d) => d.type === 'pai');
    if (hasPaiDoc) score += 1;
    else missing.push('Document PAI (téléverser le protocole médical PAI officiel)');
  } else {
    score += 1;
  }

  const allergies = cerfa.medicalInfo?.allergies || {};
  const hasAllergy = allergies.asthme || allergies.medicamenteuses || allergies.alimentaires || (allergies.autres && allergies.autres.trim().length > 0);
  if (hasAllergy) {
    if (cerfa.medicalInfo?.allergyCauseAndAction && cerfa.medicalInfo.allergyCauseAndAction.trim().length >= 3) score += 2;
    else missing.push("Cause de l'allergie et conduite à tenir d'urgence (obligatoire en cas d'allergie)");
  } else {
    score += 2;
  }

  if (cerfa.structuredDiet?.category && cerfa.structuredDiet.category !== 'aucun') {
    if (cerfa.structuredDiet.category === 'allergie_alimentaire' && !cerfa.structuredDiet.details?.trim()) {
      missing.push('Précisions sur le régime alimentaire sélectionné');
    } else {
      score += 1;
    }
  } else {
    missing.push("Régime alimentaire (Sélectionner au moins 'Standard', 'Sans porc' ou 'Végétarien')");
  }

  const lg = cerfa.legalGuardian || {};
  const hasContact = lg.mobilePhone?.trim() || lg.homePhone?.trim();
  if (lg.fullName?.trim() && hasContact && lg.address?.trim()) {
    score += 2;
  } else {
    if (!lg.fullName?.trim()) missing.push('Nom complet du responsable légal');
    if (!hasContact) missing.push("Numéro de téléphone d'urgence du responsable légal");
    if (!lg.address?.trim()) missing.push('Adresse postale du domicile');
  }

  if (cerfa.declarationAccepted && cerfa.signature?.signatureDataUrl && cerfa.signature?.signedByName?.trim()) {
    score += 2;
  } else {
    if (!cerfa.declarationAccepted) missing.push("Attestation sur l'honneur et autorisation de soins cochée");
    if (!cerfa.signature?.signatureDataUrl) missing.push('Signature électronique manuscrite du responsable légal');
  }

  const percent = missing.length === 0 ? 100 : Math.min(95, Math.max(0, Math.round((score / totalPoints) * 100)));
  return { percent, isComplete: missing.length === 0, missingFields: missing };
}

function renderReminderTemplate(template, student, link, establishmentName) {
  const completeness = computeCompleteness(student.cerfa);
  const manquants = completeness.missingFields.length > 0
    ? completeness.missingFields.map((m) => `- ${m}`).join('\n')
    : '- (aucun élément listé)';
  return template
    .split('{prenom}').join(student.cerfa.identity.firstName || '')
    .split('{nom}').join((student.cerfa.identity.lastName || '').toUpperCase())
    .split('{classe}').join(student.schoolClass || '')
    .split('{pourcentage}').join(String(completeness.percent))
    .split('{manquants}').join(manquants)
    .split('{lien}').join(link)
    .split('{etablissement}').join(establishmentName || 'Établissement scolaire');
}

async function runWeeklyReminders(portalUrl) {
  const startedAt = new Date().toISOString();
  console.log('[relances hebdomadaires] Démarrage...');

  const enabled = await readKv(AUTO_REMINDER_ENABLED_KEY);
  if (enabled === false) {
    console.log('[relances hebdomadaires] Désactivées, rien à faire.');
    return { skipped: true, reason: 'disabled' };
  }

  const transporter = getMailTransporter();
  if (!transporter) {
    console.log('[relances hebdomadaires] SMTP non configuré, rien à faire.');
    await writeKv(AUTO_REMINDER_LAST_RUN_KEY, { ranAt: startedAt, sent: 0, failed: 0, total: 0, error: 'SMTP non configuré' });
    return { skipped: true, reason: 'smtp' };
  }

  const students = (await readKv(STUDENTS_KEY)) || [];
  const users = (await readKv('cerfa_users_v1')) || [];
  const establishmentName = await readKv('cerfa_establishment_name_v1');
  const template = (await readKv(REMINDER_TEMPLATE_KEY)) || { subject: DEFAULT_REMINDER_SUBJECT, body: DEFAULT_REMINDER_BODY };
  const origin = portalUrl || process.env.PORTAL_URL || '';

  const incomplete = students.filter((s) => s.status === 'incomplete');
  let sent = 0;
  let failed = 0;

  for (const student of incomplete) {
    try {
      const parent = users.find((u) => u.id === student.parentId);
      if (!parent?.email) { failed++; continue; }

      const token = await getOrCreateMagicLinkToken(student.id);
      const link = `${origin}/?ficheToken=${token}`;
      const studentName = `${student.cerfa.identity.firstName} ${(student.cerfa.identity.lastName || '').toUpperCase()}`;

      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: parent.email,
        subject: renderReminderTemplate(template.subject, student, link, establishmentName),
        text: renderReminderTemplate(template.body, student, link, establishmentName),
        html: renderReminderTemplate(template.body, student, link, establishmentName).replace(/\n/g, '<br>'),
      });
      sent++;
      console.log(`[relances hebdomadaires] Envoyé à ${parent.email} (${studentName})`);
    } catch (err) {
      failed++;
      console.error('[relances hebdomadaires] Échec pour', student.id, err.message);
    }
  }

  const summary = { ranAt: startedAt, sent, failed, total: incomplete.length };
  await writeKv(AUTO_REMINDER_LAST_RUN_KEY, summary);
  console.log(`[relances hebdomadaires] Terminé : ${sent} envoyé(s), ${failed} échec(s), ${incomplete.length} fiche(s) incomplète(s) au total.`);
  return summary;
}

// Déclenchement manuel depuis l'admin (bouton "Lancer maintenant")
app.post('/api/reminders/run-auto-now', async (req, res) => {
  try {
    const portalUrl = req.body?.portalUrl;
    const result = await runWeeklyReminders(portalUrl);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur lors du lancement des relances automatiques.' });
  }
});

// Planification : chaque lundi à 8h (heure de Paris), configurable via CRON_SCHEDULE
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 8 * * 1';
cron.schedule(CRON_SCHEDULE, () => {
  runWeeklyReminders(process.env.PORTAL_URL).catch((e) => console.error('[relances hebdomadaires] Erreur inattendue :', e));
}, { timezone: process.env.CRON_TIMEZONE || 'Europe/Paris' });
console.log(`[relances hebdomadaires] Planifiées : "${CRON_SCHEDULE}" (${process.env.CRON_TIMEZONE || 'Europe/Paris'})`);

// --- Purge automatique de la corbeille (fiches supprimées depuis plus de 30 jours) ---
const TRASH_RETENTION_DAYS = Number(process.env.TRASH_RETENTION_DAYS || 30);

async function purgeTrash() {
  try {
    const students = (await readKv(STUDENTS_KEY)) || [];
    const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const remaining = students.filter((s) => {
      if (!s.deletedAt) return true;
      return new Date(s.deletedAt).getTime() > cutoff;
    });
    const purgedCount = students.length - remaining.length;
    if (purgedCount > 0) {
      await writeKv(STUDENTS_KEY, remaining);
      console.log(`[corbeille] ${purgedCount} fiche(s) supprimée(s) définitivement (plus de ${TRASH_RETENTION_DAYS} jours en corbeille).`);
    }
  } catch (e) {
    console.error('[corbeille] Erreur lors de la purge :', e.message);
  }
}

// Chaque jour à 3h du matin (heure de Paris)
cron.schedule('0 3 * * *', purgeTrash, { timezone: process.env.CRON_TIMEZONE || 'Europe/Paris' });
console.log(`[corbeille] Purge automatique planifiée tous les jours à 3h (rétention : ${TRASH_RETENTION_DAYS} jours).`);

// --- Sauvegarde automatique horaire de l'ensemble des données (kv_store) ---
// Écrit un instantané JSON par heure dans un répertoire persistant (monté en
// volume Docker), avec purge des sauvegardes trop anciennes. En cas
// d'incident similaire à celui déjà rencontré, ceci permet de retrouver un
// point de restauration récent sans dépendre uniquement des sauvegardes
// Proxmox quotidiennes.
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const BACKUP_RETENTION_HOURS = Number(process.env.BACKUP_RETENTION_HOURS || 24 * 14); // 14 jours par défaut

async function runHourlyBackup() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    const { rows } = await pool.query('SELECT key, value, updated_at FROM kv_store ORDER BY key');
    const now = new Date();
    const stamp = now.toISOString().slice(0, 13).replace('T', '_'); // ex: 2026-10-01_14
    const filePath = path.join(BACKUP_DIR, `backup_${stamp}h00.json`);
    fs.writeFileSync(filePath, JSON.stringify(rows, null, 0));

    // Purge des sauvegardes plus anciennes que la rétention configurée
    const cutoff = Date.now() - BACKUP_RETENTION_HOURS * 60 * 60 * 1000;
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('backup_') && f.endsWith('.json'));
    for (const f of files) {
      const full = path.join(BACKUP_DIR, f);
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
      }
    }
    console.log(`[sauvegarde horaire] OK : ${filePath} (${rows.length} clés)`);
  } catch (e) {
    console.error('[sauvegarde horaire] Échec :', e.message);
  }
}

// Toutes les heures, à l'heure pile
cron.schedule('0 * * * *', runHourlyBackup, { timezone: process.env.CRON_TIMEZONE || 'Europe/Paris' });
console.log(`[sauvegarde horaire] Planifiée chaque heure (rétention : ${BACKUP_RETENTION_HOURS}h, dossier : ${BACKUP_DIR}).`);
// Une première sauvegarde immédiate au démarrage, pour ne pas attendre la prochaine heure pile
runHourlyBackup();

// Permet de lister et télécharger les sauvegardes depuis l'espace Administration
app.get('/api/backups', (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return res.json({ backups: [] });
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('backup_') && f.endsWith('.json'))
      .map((f) => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ backups: files });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/backups/:name', (req, res) => {
  const safeName = path.basename(req.params.name);
  const filePath = path.join(BACKUP_DIR, safeName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Sauvegarde introuvable' });
  res.download(filePath);
});

app.use(express.static(path.join(__dirname, '..', 'dist')));
// Fallback SPA : sert index.html pour toute route non-API restante.
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

ensureTable()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => console.log(`Serveur fiche sanitaire voyages sur le port ${PORT}`));
  })
  .catch((e) => {
    console.error("Impossible d'initialiser la base :", e);
    process.exit(1);
  });
