#!/bin/bash
# ============================================================================
# patch-accueil.sh  -  build accueil-20261001
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# A chaque creation d'un compte PARENT (inscription par le parent, ou compte cree
# par l'administration), un MESSAGE D'ACCUEIL est depose automatiquement dans sa
# messagerie. Texte par defaut : "Merci de creer un compte par enfant ... la signature
# d'un seul responsable legal suffit".
#  - Le message est pret des la premiere connexion (badge "1" sur le bouton Messagerie).
#  - Un seul message d'accueil par compte (jamais de doublon).
#  - Texte modifiable par l'administration : Messagerie > onglet "Message d'accueil"
#    (jetons {prenom} / {nom}, activation, retour au texte par defaut).
#  - Bouton "Envoyer aussi aux parents deja inscrits" pour les comptes existants.
#  - Cote administration, un message d'accueil sans reponse n'encombre pas la boite
#    de reception (il apparait des que le parent repond).
#  - CORRECTIF au passage : les creations / suppressions de comptes passent desormais
#    l'une apres l'autre (verrou serveur). Avant, 15 creations simultanees ne conservaient
#    que 5 comptes (ecrasement mutuel).
#
# PREREQUIS : patch-messagerie.sh deja applique.
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/patch-accueil.sh && /root/patch-accueil.sh
# ============================================================================
set -e

APP_DIR="${APP_DIR:-/opt/fichesanitaire-voyages}"
BUILD="accueil-20261001"
BACKUP_DIR="$APP_DIR/backup-avant-$BUILD"
FILES="server/index.js src/components/CommunicationCenter.tsx src/utils/messaging.ts"
NEWFILES="src/components/WelcomeSettings.tsx"
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
  [ -f "$APP_DIR/$f" ] || { echo "ERREUR : $APP_DIR/$f introuvable. Appliquez d'abord patch-messagerie.sh."; exit 1; }
done
command -v perl >/dev/null || { echo "ERREUR : perl est requis (apt install -y perl)."; exit 1; }

SRV="$APP_DIR/server/index.js"
CC="$APP_DIR/src/components/CommunicationCenter.tsx"
MSG="$APP_DIR/src/utils/messaging.ts"

grep -q "COMM_PRIVATE_PREFIXES" "$SRV" || { echo "ERREUR : la messagerie n'est pas installee. Appliquez d'abord patch-messagerie.sh."; exit 1; }

m=0
grep -q "WELCOME_KEY" "$SRV" && m=$((m+1))
grep -q "getWelcomeConfig" "$MSG" && m=$((m+1))
grep -q "WelcomeSettings" "$CC" && m=$((m+1))
for f in $NEWFILES; do [ -f "$APP_DIR/$f" ] && m=$((m+1)); done
if [ "$m" -eq 4 ]; then
  echo ">>> Patch deja applique. Rien a faire."
  exit 0
elif [ "$m" -gt 0 ]; then
  echo "ERREUR : etat partiel detecte ($m/4 elements deja en place)."
  echo "Restaurez d'abord les fichiers d'origine depuis un backup-avant-* puis relancez ce script."
  exit 1
fi

# --- Fonctions utilitaires -------------------------------------------------
count_occ() { OLD="$2" perl -0777 -ne 'my $c = () = /\Q$ENV{OLD}\E/g; print $c' "$1"; }

replace_once() { # fichier  ancien_texte  nouveau_texte
  local file="$1" old="$2" new="$3" n
  n="$(count_occ "$file" "$old")"
  [ "$n" = "1" ] || { echo "ERREUR : repere trouve $n fois dans $file (attendu : 1) :"; echo "$old"; exit 1; }
  OLD="$old" NEW="$new" perl -0777 -i -pe 's/\Q$ENV{OLD}\E/$ENV{NEW}/' "$file"
}

# --- 1. Sauvegarde ----------------------------------------------------------
echo ">>> Sauvegarde dans $BACKUP_DIR ..."
for f in $FILES; do
  mkdir -p "$BACKUP_DIR/$(dirname "$f")"
  cp -p "$APP_DIR/$f" "$BACKUP_DIR/$f"
done
PATCHING=1

# --- 2. Client : composant de reglage + fonctions API ------------------------
echo ">>> Creation de src/components/WelcomeSettings.tsx ..."
cat > "$APP_DIR/src/components/WelcomeSettings.tsx" << 'ACCEOF_X'
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
ACCEOF_X

echo ">>> Patch de src/utils/messaging.ts ..."
cat >> "$APP_DIR/src/utils/messaging.ts" << 'ACCEOF_X'

// --- Message d'accueil par défaut (build accueil-20261001) ---
export interface WelcomeConfig {
  enabled: boolean;
  subject: string;
  body: string;
}

export const getWelcomeConfig = (userId: string) =>
  api<{ config: WelcomeConfig; defaults: { subject: string; body: string } }>('/api/messages/welcome/get', { userId });

export const saveWelcomeConfig = (userId: string, c: WelcomeConfig) =>
  api<{ ok: boolean }>('/api/messages/welcome/save', { userId, ...c });

export const sendWelcomeToExisting = (userId: string) =>
  api<{ count: number }>('/api/messages/welcome/send-existing', { userId });
ACCEOF_X

# --- 3. Client : onglet "Message d'accueil" dans la messagerie (administration) --
echo ">>> Patch de src/components/CommunicationCenter.tsx ..."
replace_once "$CC" "import { PopupModal } from './PopupModal';" "import { PopupModal } from './PopupModal';
import { WelcomeSettings } from './WelcomeSettings';"
replace_once "$CC" "type AdminView = 'inbox' | 'compose' | 'popups';" "type AdminView = 'inbox' | 'compose' | 'popups' | 'welcome';"
replace_once "$CC" "                    ['popups', 'Popups']," "                    ['popups', 'Popups'],
                    ['welcome', \"Message d'accueil\"],"

cat > "$TMP/cc_old.tsx" << 'ACCEOF_X'
    ) : adminView === 'popups' ? (
      AdminPopups
    ) : (
ACCEOF_X
cat > "$TMP/cc_new.tsx" << 'ACCEOF_X'
    ) : adminView === 'popups' ? (
      AdminPopups
    ) : adminView === 'welcome' ? (
      <WelcomeSettings adminId={currentUser.id} />
    ) : (
ACCEOF_X
replace_once "$CC" "$(cat "$TMP/cc_old.tsx")" "$(cat "$TMP/cc_new.tsx")"

# --- 4. Serveur ---------------------------------------------------------------
echo ">>> Patch de server/index.js ..."
cat > "$TMP/server_welcome.js" << 'ACCEOF_X'
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
ACCEOF_X
# (le bloc se termine par l'ancre d'origine, reinseree telle quelle)
replace_once "$SRV" "app.get('/api/popups/public', async (req, res) => {" "$(cat "$TMP/server_welcome.js")"

# Cote administration : un message d'accueil sans reponse n'encombre pas la boite de reception
replace_once "$SRV" \
  "const visible = user.role === 'admin' ? threads : threads.filter((t) => t.parentId === user.id);" \
  "const visible =
      user.role === 'admin'
        ? threads.filter((t) => !(t.kind === 'welcome' && (t.messages || []).length <= 1))
        : threads.filter((t) => t.parentId === user.id);"

# --- 5. Reconstruction ------------------------------------------------------
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
  echo "!!! Pour revenir en arriere : cp -a $BACKUP_DIR/server $BACKUP_DIR/src $APP_DIR/ && rm -f $APP_DIR/src/components/WelcomeSettings.tsx"
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

code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$APP_PORT_VAL/api/data/cerfa_messages_welcome_v1" || true)"
[ "$code" = "403" ] && echo ">>> OK : la configuration du message d'accueil n'est pas exposee (403)" || echo "!!! ATTENTION : code $code au lieu de 403 sur /api/data/cerfa_messages_welcome_v1"

cat << MSG

============================================================
 TERMINE - build $BUILD
 - Chaque NOUVEAU compte parent recoit le message d'accueil dans sa messagerie.
 - Modifier le texte : Messagerie > onglet "Message d'accueil" (administration).
 - Comptes deja existants : bouton "Envoyer aussi aux parents deja inscrits".
 Retour arriere possible : copie dans $BACKUP_DIR
 IMPORTANT : videz le cache du navigateur (Ctrl+F5).
 Logs serveur : docker compose logs app | grep "Message d'accueil"
============================================================
MSG
