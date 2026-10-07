#!/bin/bash
# ============================================================================
# rattacher-fiche.sh  -  rattache une fiche sanitaire au compte d'un parent
# Portail Fiche Sanitaire de Liaison - Voyages scolaires (NDM)
#
# Cas d'usage : un parent ne voit pas la fiche de son enfant dans "Mes enfants"
# (la fiche existe, mais elle est rattachee a un autre compte : l'autre parent,
# un ancien compte, un compte perdu...). Le portail refuse alors de la recreer.
#
# 1) SIMULATION (ne modifie rien) : affiche a quel compte la fiche est rattachee
#       ./rattacher-fiche.sh E-2026-223 celine.nedelian@email.fr
# 2) APPLICATION :
#       ./rattacher-fiche.sh E-2026-223 celine.nedelian@email.fr --apply
# 3) LISTE de toutes les fiches sans parent rattache + comptes anormaux (diagnostic) :
#       ./rattacher-fiche.sh --orphelines
# 3bis) DOUBLONS : enfants qui ont plusieurs fiches (a verifier avant de supprimer) :
#       ./rattacher-fiche.sh --doublons
# 4) RATTACHEMENT AUTOMATIQUE des fiches orphelines dont l'e-mail du responsable legal
#    (saisi sur la fiche) est EXACTEMENT l'e-mail d'un compte parent unique. Jamais par le nom.
#       ./rattacher-fiche.sh --auto            (simulation)
#       ./rattacher-fiche.sh --auto --apply    (application)
#
# Le numero de fiche (E-2026-xxx) est affiche sous le nom de l'eleve dans le
# Suivi global. ATTENTION : ce numero est tire au hasard et peut exister en double ;
# dans ce cas le script affiche l'IDENTIFIANT TECHNIQUE a utiliser a la place.
# On peut aussi donner un nom d'eleve (ex. "NEDELIAN Noemie").
#
# A DEPOSER avec FileZilla dans : /root/
# A EXECUTER :  chmod +x /root/rattacher-fiche.sh && /root/rattacher-fiche.sh ...
# ============================================================================
set -e

CONTAINER="${CONTAINER:-fichesanitaire_app}"

if [ "$#" -lt 2 ] && [ "$1" != "--orphelines" ] && [ "$1" != "--auto" ] && [ "$1" != "--doublons" ]; then
  echo "Usage : $0 <numero de fiche | identifiant | nom de l'eleve> <e-mail du parent> [--apply]"
  echo "        $0 --orphelines"
  echo "        $0 --doublons"
  echo "        $0 --auto [--apply]"
  echo "Exemple : $0 E-2026-223 celine.nedelian@email.fr"
  exit 1
fi
command -v docker >/dev/null 2>&1 || { echo "ERREUR : docker est introuvable. Lancez ce script sur le LXC de l'application."; exit 1; }
docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" || { echo "ERREUR : le conteneur '$CONTAINER' ne tourne pas (docker ps)."; exit 1; }

docker exec -i -e BASE_URL="http://localhost:3000" "$CONTAINER" node - "$@" << 'RATTACHER_EOF'
// Rattache les fiches sanitaires aux comptes parents (utilise l'API du serveur : verrou + historique)
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const listOrphans = args.includes('--orphelines');
const auto = args.includes('--auto');
const doublons = args.includes('--doublons');
const forceAttach = args.includes('--force');
const [ficheArg, emailArg] = args.filter((a) => !a.startsWith('--'));
// Serveur authentifié (build auth-20261006) : l'outil s'identifie avec le secret local du conteneur (jamais exposé au réseau)
let SECRET = process.env.LOCAL_TOOL_SECRET || '';
try { if (!SECRET) SECRET = require('fs').readFileSync('/app/.local-tool-secret', 'utf8').trim(); } catch (e) { /* ancien serveur sans authentification : pas de secret */ }
const H = { 'Content-Type': 'application/json', ...(SECRET ? { 'X-Local-Tool': SECRET } : {}) };
const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const die = (m) => { console.error('\n!!! ' + m + '\n'); process.exit(1); };

async function getKv(key) {
  const r = await fetch(`${BASE}/api/data/${key}`, { headers: H });
  if (r.status === 401 || r.status === 403) die(`Accès refusé par le serveur (HTTP ${r.status}) : le secret local /app/.local-tool-secret est illisible ou absent. Redémarrez le conteneur : docker compose restart app`);
  if (!r.ok) die(`Lecture impossible de ${key} (HTTP ${r.status}).`);
  const j = await r.json();
  return Array.isArray(j) ? j : (j && Array.isArray(j.value) ? j.value : []);
}

(async () => {
  const students = (await getKv('cerfa_students_v11')).filter((s) => s && !s.deletedAt);
  const users = await getKv('cerfa_users_v1');
  const childrenOf = (id) => students.filter((s) => s.parentId === id).length;
  const label = (s) => `${s.cerfa.identity.lastName} ${s.cerfa.identity.firstName} (${s.internalId || s.id}, classe ${s.schoolClass})`;
  const lastAuthor = (s) => {
    const h = (s.cerfa && s.cerfa.history) || [];
    return h.length ? `${h[0].authorName || '?'} (${h[0].authorRole || '?'}) - ${h[0].action || ''}` : 'aucun historique';
  };
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '?');
  const isOrphan = (s) => !s.parentId || !users.some((u) => u && u.id === s.parentId);
  const mail = (v) => String(v || '').trim().toLowerCase();
  // compte probable d'une fiche orpheline : UNIQUEMENT par e-mail du responsable légal (jamais par le nom)
  const guess = (s) => {
    const g = (s.cerfa && s.cerfa.legalGuardian) || {};
    const gm = mail(g.email);
    if (!gm) return { target: null, why: 'e-mail du responsable non renseigné sur la fiche', g };
    const m = users.filter((u) => u && u.role === 'parent' && mail(u.email) === gm);
    if (m.length === 1) return { target: m[0], why: `e-mail du responsable = ${m[0].email}`, g };
    return { target: null, why: m.length > 1 ? 'plusieurs comptes avec cet e-mail' : `aucun compte parent avec l'e-mail ${gm}`, g };
  };

  // Indice pour les fiches sans e-mail exploitable : comptes parents CREES PEU AVANT la fiche
  // (un parent s'inscrit puis ajoute son enfant dans les minutes qui suivent). Simple aide à la décision.
  const idTime = (id) => { const m = String(id || '').match(/(\d{12,})/); return m ? Number(m[1]) : 0; };
  const candidates = (s) => {
    const t = s.createdAt ? Date.parse(s.createdAt) : idTime(s.id);
    if (!t) return [];
    const names = [norm(s.cerfa.identity.lastName), norm(((s.cerfa.legalGuardian || {}).fullName) || '')].filter((n) => n.length >= 3);
    return users
      .filter((u) => u && u.role === 'parent')
      .map((u) => ({ u, ut: idTime(u.id) }))
      .filter((o) => o.ut && o.ut <= t + 10 * 60000 && t - o.ut <= 2 * 3600000)
      .sort((a, b) => Math.abs(t - a.ut) - Math.abs(t - b.ut))
      .slice(0, 5)
      .map((o) => {
        const min = Math.round((t - o.ut) / 60000);
        const same = names.some((n) => norm(o.u.name).includes(n) || n.includes(norm(o.u.lastName)) && norm(o.u.lastName).length >= 3);
        return `${o.u.name} <${o.u.email}> [compte créé ${min >= 0 ? min + ' min avant' : -min + ' min après'} la fiche, ${childrenOf(o.u.id)} enfant(s)${same ? ', MEME NOM' : ''}]`;
      });
  };
  const candLine = (s) => {
    const c = candidates(s);
    return c.length ? `     candidats (comptes créés peu avant la fiche, À VÉRIFIER) :\n        - ${c.join('\n        - ')}` : '     candidats : aucun compte parent créé dans les 2 h précédant la fiche';
  };

  // Même enfant = mêmes prénom + nom (sans accents ni casse, ordre indifférent)
  const childKey = (s) => [norm(s.cerfa.identity.firstName), norm(s.cerfa.identity.lastName)].sort().join('|');
  const sameChild = (s) => students.filter((x) => x.id !== s.id && childKey(x) === childKey(s));
  const ownerLabel = (s) => {
    const u = users.find((x) => x && x.id === s.parentId);
    return u ? `${u.name} <${u.email}>` : s.parentId ? 'compte introuvable (' + s.parentId + ')' : 'AUCUN PARENT';
  };
  const sigLabel = (s) => (s.cerfa.signature && s.cerfa.signature.signatureDataUrl ? 'v' + (s.cerfa.signature.version || '?') : 'absente');
  // Plus le score est élevé, plus la fiche est « complète et utile » (jamais utilisé pour supprimer automatiquement)
  const score = (s) =>
    (s.status === 'complete' ? 1000 : 0) + (sigLabel(s) !== 'absente' ? 500 : 0) + (s.pdfSentAt ? 200 : 0) +
    Number(s.completenessPercent || 0) + (s.parentId ? 100 : -1000) + Date.parse(s.updatedAt || 0) / 1e13;
  const describe = (s) =>
    `${s.internalId || '?'} | id ${s.id} | classe ${s.schoolClass} | ${s.status === 'complete' ? 'complète' : 'incomplète'} ${s.completenessPercent ?? '?'} % | signature ${sigLabel(s)} | ${s.pdfSentAt ? 'PDF archivé' : 'PDF non archivé'} | modifiée ${fmt(s.updatedAt)} | ${Math.round(JSON.stringify(s).length / 1024)} Ko`;

  const reattach = async (student, target) => {
    const fs = require('fs');
    const now = new Date();
    const updated = {
      ...student,
      parentId: target.id,
      updatedAt: now.toISOString(),
      cerfa: {
        ...student.cerfa,
        history: [
          {
            id: 'h-' + now.getTime() + '-' + Math.random().toString(36).slice(2, 6),
            date: now.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }),
            action: 'Fiche rattachée à un compte parent par l\'administration',
            authorName: 'Administration (script)',
            authorRole: 'Direction / Administration',
            details: `Rattachement de « ${student.parentId || '(aucun parent)'} » vers « ${target.id} » (${target.email})`,
          },
          ...(student.cerfa.history || []),
        ],
      },
    };
    const r = await fetch(`${BASE}/api/students/upsert`, { method: 'POST', headers: H, body: JSON.stringify({ student: updated }) });
    if (!r.ok) die(`Le serveur a refusé la modification de ${label(student)} (HTTP ${r.status}).`);
    return updated;
  };
  const backup = (name, data) => {
    const fs = require('fs');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      fs.mkdirSync('/app/backups', { recursive: true });
      fs.writeFileSync(`/app/backups/${name}_${stamp}.json`, JSON.stringify(data, null, 2));
      console.log(`Copie de sécurité : /app/backups/${name}_${stamp}.json (dans le conteneur)`);
    } catch (e) { console.log('(copie de sécurité locale impossible : ' + e.message + ')'); }
  };

  // ===== mode : lister les fiches sans parent valide + comptes anormaux =====
  if (listOrphans) {
    const orphans = students.filter(isOrphan);
    console.log(`\n${students.length} fiche(s) au total, dont ${orphans.length} SANS PARENT RATTACHE (champ parentId absent ou compte introuvable) :\n`);
    orphans.forEach((s) => {
      const gs = guess(s);
      console.log(` - ${s.internalId || '(sans numéro)'} | ${s.cerfa.identity.lastName} ${s.cerfa.identity.firstName} | ${s.schoolClass} | ${s.parentId ? 'compte introuvable : ' + s.parentId : 'parentId ABSENT'} | créée ${fmt(s.createdAt)} | modifiée ${fmt(s.updatedAt)} | id ${s.id}`);
      console.log(`     dernier auteur : ${lastAuthor(s)}`);
      console.log(`     responsable : ${gs.g.fullName || '?'} <${mail(gs.g.email) || '?'}> ${gs.g.mobilePhone || ''} | compte probable : ${gs.target ? gs.target.name + ' <' + gs.target.email + '>  (' + gs.why + ')' : 'aucun (' + gs.why + ')'}`);
      if (!gs.target) console.log(candLine(s));
      const dups = sameChild(s);
      if (dups.length) console.log('     DOUBLON PROBABLE de : ' + dups.map((d) => `${d.internalId} (compte ${ownerLabel(d)}, ${d.status === 'complete' ? 'complète' : 'incomplète'})`).join(' ; ') + '\n     -> NE PAS rattacher : vérifier puis mettre cette fiche à la corbeille (Suivi global)');
    });
    if (orphans.length === 0) console.log('Toutes les fiches sont rattachées à un compte existant.');

    const bad = users.filter((u) => !u || !u.id || !u.name || !u.role || !u.email);
    const seenId = {}, seenMail = {};
    users.forEach((u) => { if (u && u.id) (seenId[u.id] = seenId[u.id] || []).push(u); if (u && mail(u.email)) (seenMail[mail(u.email)] = seenMail[mail(u.email)] || []).push(u); });
    const dupId = Object.entries(seenId).filter(([, l]) => l.length > 1), dupMail = Object.entries(seenMail).filter(([, l]) => l.length > 1);
    console.log(`\n${users.length} compte(s) : ${bad.length} anormal(aux) (identifiant, nom, rôle ou e-mail manquant), ${dupId.length} identifiant(s) en double, ${dupMail.length} e-mail(s) en double.`);
    bad.forEach((u) => console.log(`   ANORMAL : ${JSON.stringify({ id: u && u.id, name: u && u.name, role: u && u.role, email: u && u.email })}`));
    dupId.forEach(([id, l]) => console.log(`   IDENTIFIANT EN DOUBLE ${id} : ${l.map((u) => u.email).join(', ')}`));
    dupMail.forEach(([m, l]) => console.log(`   E-MAIL EN DOUBLE ${m} : ${l.map((u) => u.id).join(', ')}`));
    const noName = users.filter((u) => u && u.role === 'admin' && !u.name);
    if (noName.length) console.log(`   ATTENTION : ${noName.length} compte(s) ADMINISTRATEUR sans nom : l'historique des fiches modifiées avec ce compte affiche « ? » comme auteur.`);
    return;
  }

  // ===== mode : doublons (même enfant, plusieurs fiches) =====
  if (doublons) {
    const groups = {};
    students.forEach((x) => { (groups[childKey(x)] = groups[childKey(x)] || []).push(x); });
    const list = Object.values(groups).filter((g) => g.length > 1);
    const sameAccount = list.filter((g) => new Set(g.map((x) => x.parentId || '(aucun)')).size < g.length).length;
    console.log(`\n${students.length} fiche(s) ; ${list.length} enfant(s) avec PLUSIEURS fiches (${sameAccount} dont des fiches du MÊME compte).\n`);
    list.forEach((g, i) => {
      g.sort((a, b) => score(b) - score(a));
      console.log(`GROUPE ${i + 1} : ${g[0].cerfa.identity.lastName} ${g[0].cerfa.identity.firstName} — ${g.length} fiches`);
      g.forEach((x, j) => console.log(`   ${j === 0 ? '[À GARDER probable]' : '[doublon probable]  '} ${describe(x)}\n      compte : ${ownerLabel(x)}`));
      console.log('');
    });
    if (list.length === 0) console.log('Aucun doublon.');
    else console.log('Rien n\'a été modifié. Le classement « À GARDER » se base sur : fiche complète, signée, PDF archivé, % de complétude, parent rattaché, date. VÉRIFIEZ avant de mettre un doublon à la corbeille (Suivi global, restaurable 30 jours) : ne retirez jamais la seule fiche signée.');
    return;
  }

  // ===== mode : rattachement automatique par e-mail du responsable =====
  if (auto) {
    const orphans = students.filter(isOrphan);
    const plan = orphans.map((s) => {
      const g = guess(s);
      if (g.target) {
        const d = students.find((x) => x.id !== s.id && x.parentId === g.target.id && childKey(x) === childKey(s));
        if (d) return { s, target: null, g: g.g, why: `DOUBLON : le compte ${g.target.email} a DÉJÀ cet enfant (${d.internalId}) ; à mettre à la corbeille, pas à rattacher` };
      }
      return { s, ...g };
    });
    const ok = plan.filter((p) => p.target);
    const manual = plan.filter((p) => !p.target);
    console.log(`\n${orphans.length} fiche(s) sans parent : ${ok.length} rattachable(s) automatiquement (e-mail du responsable = e-mail d'un compte parent, unique), ${manual.length} à traiter à la main.\n`);
    ok.forEach((p) => console.log(` AUTO   ${label(p.s)}  ->  ${p.target.name} <${p.target.email}>`));
    manual.forEach((p) => { console.log(` MANUEL ${label(p.s)}  (${p.why})  id ${p.s.id}`); console.log(candLine(p.s)); });
    if (!apply) { console.log('\nSIMULATION : rien n\'a été modifié. Pour appliquer les rattachements AUTO : relancez avec --apply'); return; }
    if (ok.length === 0) { console.log('\nRien à rattacher automatiquement.'); return; }
    backup('rattachement_auto', ok.map((p) => ({ fiche: p.s.id, avant_parentId: p.s.parentId || null, vers: p.target.id })));
    for (const p of ok) { await reattach(p.s, p.target); console.log(` OK     ${label(p.s)} -> ${p.target.email}`); }
    const after = (await getKv('cerfa_students_v11')).filter((s) => ok.some((p) => p.s.id === s.id));
    if (after.some((s) => !ok.find((p) => p.s.id === s.id && p.target.id === s.parentId))) die('Vérification échouée : au moins une fiche n\'est pas rattachée.');
    console.log(`\n${ok.length} fiche(s) rattachée(s). Les parents les voient après Ctrl+F5. Reste à traiter à la main : ${manual.length}.`);
    return;
  }

  // ===== mode : une fiche et un compte =====
  if (!ficheArg || !emailArg) die('Usage : rattacher-fiche.sh <numero | identifiant | nom de l\'élève> <e-mail du parent> [--apply]   ou   --orphelines   ou   --doublons   ou   --auto [--apply]');
  let found = students.filter((s) => s.id === ficheArg);
  if (found.length === 0) found = students.filter((s) => String(s.internalId || '').toLowerCase() === ficheArg.toLowerCase());
  if (found.length === 0) {
    const q = norm(ficheArg);
    found = students.filter((s) => norm(s.cerfa.identity.lastName + s.cerfa.identity.firstName).includes(q) || norm(s.cerfa.identity.firstName + s.cerfa.identity.lastName).includes(q));
  }
  if (found.length === 0) die(`Aucune fiche trouvée pour « ${ficheArg} ». Utilisez le numéro affiché sous le nom de l'élève (ex. E-2026-223).`);
  if (found.length > 1) {
    console.log(`\nPlusieurs fiches correspondent à « ${ficheArg} » :`);
    found.forEach((s) => console.log(`  - ${label(s)} | identifiant technique : ${s.id} | rattachée à : ${s.parentId || '(aucun parent)'}`));
    die('Plusieurs fiches répondent à ce numéro ou à ce nom (le numéro E-2026-xxx est tiré au hasard et peut exister en double). Relancez avec l\'IDENTIFIANT TECHNIQUE de la bonne fiche.');
  }
  const student = found[0];
  const target = users.find((u) => u && mail(u.email) === mail(emailArg));
  if (!target) {
    const near = users.filter((u) => u && u.role === 'parent' && norm(u.name + u.email).includes(norm(emailArg.split('@')[0])));
    console.log(`\nAucun compte avec l'e-mail « ${emailArg} ».`);
    if (near.length) { console.log('Comptes proches :'); near.forEach((u) => console.log(`  - ${u.name} <${u.email}> (${childrenOf(u.id)} enfant(s))`)); }
    die('Vérifiez l\'adresse e-mail (le parent doit avoir créé son compte).');
  }
  if (target.role !== 'parent') die(`Le compte ${target.email} n'est pas un compte parent (rôle : ${target.role}).`);

  const owner = users.find((u) => u && u.id === student.parentId);
  console.log('\n================ DIAGNOSTIC ================');
  console.log('Fiche           : ' + label(student));
  console.log(`État            : ${student.status === 'complete' ? 'complète' : 'incomplète'}, signature ${student.cerfa.signature && student.cerfa.signature.signatureDataUrl ? 'v' + student.cerfa.signature.version : 'absente'}, ${student.pdfSentAt ? 'PDF archivé' : 'PDF non archivé'}`);
  console.log('Identifiant     : ' + student.id);
  console.log(`Créée / modifiée: ${fmt(student.createdAt)} / ${fmt(student.updatedAt)}`);
  console.log('Rattachée à     : ' + (owner ? `${owner.name} <${owner.email}> (${childrenOf(owner.id)} enfant(s))` : !student.parentId ? 'AUCUN PARENT : la fiche ne porte aucun identifiant de parent (champ parentId absent)' : `AUCUN COMPTE (identifiant « ${student.parentId} » introuvable : compte perdu ou supprimé)`));
  const hist = ((student.cerfa && student.cerfa.history) || []).slice(0, 6);
  console.log('Historique récent (du plus récent au plus ancien) :');
  if (hist.length === 0) console.log('   (aucune entrée)');
  hist.forEach((h) => console.log(`   - ${h.date || '?'} | ${h.action || ''} | ${h.authorName || '?'} (${h.authorRole || '?'})`));
  console.log(`Compte du parent: ${target.name} <${target.email}> (${childrenOf(target.id)} enfant(s))`);
  console.log('===========================================');

  const dupInTarget = students.find((x) => x.id !== student.id && x.parentId === target.id && childKey(x) === childKey(student));
  if (dupInTarget) console.log(`\nATTENTION : le compte ${target.email} a DÉJÀ une fiche pour cet enfant : ${describe(dupInTarget)}\n            Rattacher celle-ci créerait un DOUBLON dans le même compte.`);
    if (student.parentId === target.id) { console.log('\nLa fiche est DEJA rattachée à ce compte : rien à faire.'); return; }
  if (!apply) { console.log(`\nSIMULATION : rien n'a été modifié.\nPour rattacher cette fiche au compte ${target.email}, relancez la même commande avec --apply`); return; }
  if (dupInTarget && !forceAttach) die('Rattachement refusé : il créerait un doublon dans le même compte. Si vous êtes sûr, ajoutez --force.');
  backup('rattachement', { avant: student });
  await reattach(student, target);
  const check = (await getKv('cerfa_students_v11')).find((s) => s.id === student.id);
  if (!check || check.parentId !== target.id) die('Vérification échouée : la fiche n\'est pas rattachée.');
  console.log(`\nOK : ${label(student)} est maintenant rattachée à ${target.name} <${target.email}>.`);
  console.log('Le parent la voit dans « Mes enfants » après avoir rechargé la page (Ctrl+F5).');
})().catch((e) => die(e.message));
RATTACHER_EOF
