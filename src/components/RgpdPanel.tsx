import React, { useEffect, useState } from 'react';
import { ShieldCheck, Download, Database, Users, Clock, Scale, Mail, FileText, Lock } from 'lucide-react';
import { Student, Trip, User } from '../types';
import { getStoredEstablishmentName } from '../utils/storage';

console.log('[fichesanitaire] build rgpd-20261006');

interface RgpdPanelProps {
  currentUser: User;
  students: Student[];
  trips: Trip[];
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};

// Rubriques de données collectées : ce que contient réellement le portail
const DATA_ROWS: { title: string; what: string; why: string; note?: string }[] = [
  {
    title: 'Votre compte',
    what: 'Nom et prénom, adresse e-mail, téléphone (facultatif), mot de passe, question et réponse secrètes de récupération du mot de passe.',
    why: 'Vous identifier, retrouver vos enfants et vous permettre de récupérer votre accès.',
  },
  {
    title: "Identité de l'enfant",
    what: "Nom, prénom, date de naissance, sexe, classe, régime scolaire (demi-pension, externe, interne), téléphone portable de l'enfant (facultatif), numéro de sécurité sociale.",
    why: "Identifier l'enfant sur la fiche sanitaire de liaison officielle (CERFA n°10008*02) et auprès des services de secours.",
  },
  {
    title: 'Vaccinations',
    what: 'Vaccins obligatoires et recommandés, dates des derniers rappels, éventuelle contre-indication médicale.',
    why: "Renseigner le carnet de vaccination demandé par la fiche sanitaire officielle.",
    note: 'Donnée de santé',
  },
  {
    title: 'Renseignements médicaux',
    what: "Traitement médical en cours, Projet d'Accueil Individualisé (PAI), allergies (asthme, médicamenteuses, alimentaires, autres) avec la conduite à tenir, antécédents (maladies déjà eues), difficultés de santé, médecin traitant (nom et téléphone).",
    why: "Permettre aux accompagnateurs d'agir correctement et de prévenir les secours en cas de problème de santé pendant un séjour.",
    note: 'Donnée de santé — donnée sensible',
  },
  {
    title: 'Régime alimentaire',
    what: 'Régime (sans porc, sans viande, végétarien, allergie alimentaire…) et recommandations libres que vous écrivez.',
    why: 'Adapter les repas pendant les voyages.',
    note: 'Si vous mentionnez des convictions religieuses dans vos recommandations, elles sont enregistrées : écrivez seulement ce qui est utile.',
  },
  {
    title: 'Responsable légal',
    what: 'Nom, lien avec l’enfant, adresse, téléphones fixe, portable et travail, adresse e-mail.',
    why: 'Vous joindre en cas d’urgence ou de question.',
  },
  {
    title: 'Pièces jointes',
    what: "Documents que vous ajoutez : protocole PAI, ordonnance, justificatifs (PDF ou photo).",
    why: "Fournir au séjour les documents médicaux utiles.",
    note: 'Donnée de santé',
  },
  {
    title: 'Déclaration et signature',
    what: "Case « J'atteste sur l'honneur », nom du signataire, date, image de votre signature manuscrite électronique (ou importée par l'administration à votre demande).",
    why: "Valider la fiche : une seule signature d'un responsable légal suffit.",
  },
  {
    title: 'Voyages',
    what: "Inscriptions de votre enfant aux voyages scolaires proposés pour sa classe.",
    why: "Organiser les séjours et établir les listes des élèves partants.",
  },
  {
    title: 'Messagerie et popups',
    what: "Messages échangés avec l'établissement, date de lecture de chaque message, popups d'information lus.",
    why: "Vous informer et répondre à vos questions.",
  },
  {
    title: 'Historique de la fiche',
    what: "Qui a modifié la fiche (votre nom ou celui de l'administration) et quand.",
    why: 'Tracer les modifications et éviter les écrasements entre deux responsables.',
  },
  {
    title: 'Copie PDF et lien direct',
    what: "Copie PDF de la fiche complète conservée sur le serveur de l'établissement ; lien direct d'accès à la fiche sans connexion, si vous en avez demandé un.",
    why: "Archivage de la fiche et accès simplifié pour un deuxième responsable.",
  },
  {
    title: 'Sur votre appareil',
    what: "Le portail mémorise dans votre navigateur un identifiant de session et une copie des données affichées, pour fonctionner plus vite. Aucun cookie publicitaire ou de mesure d'audience, aucun traceur : le portail ne charge aucun service extérieur (statistiques, publicité, réseaux sociaux, polices en ligne).",
    why: 'Faire fonctionner le portail.',
  },
];

export const RgpdPanel: React.FC<RgpdPanelProps> = ({ currentUser, students, trips }) => {
  const establishment = getStoredEstablishmentName();
  const myChildren = students.filter((s) => s.parentId === currentUser.id && !(s as any).deletedAt);
  const [yearEnd, setYearEnd] = useState<{ enabled: boolean; month: number; day: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/year-end/public')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j && typeof j.month === 'number') setYearEnd(j);
      })
      .catch(() => {
        /* le texte reste sans date précise */
      });
    return () => {
      alive = false;
    };
  }, []);

  const tripNames = (s: Student) =>
    (s.registeredTripIds || [])
      .map((id) => trips.find((t) => t.id === id)?.name)
      .filter(Boolean)
      .join(', ');

  const handleDownload = () => {
    const safe = (v: any) => v;
    const data = {
      document: 'Copie de mes données personnelles — Portail Fiche Sanitaire de Liaison',
      etablissement: establishment,
      genereLe: new Date().toISOString(),
      compte: {
        nom: currentUser.name,
        prenom: currentUser.firstName || '',
        email: currentUser.email,
        telephone: currentUser.phone || '',
        role: 'Parent / Responsable légal',
      },
      enfants: myChildren.map((s) => ({
        numeroEleve: s.internalId,
        classe: s.schoolClass,
        pension: s.boardingStatus,
        statutFiche: s.status === 'complete' ? 'complète' : 'incomplète',
        derniereModification: s.updatedAt,
        voyagesInscrits: (s.registeredTripIds || []).map((id) => trips.find((t) => t.id === id)?.name || id),
        fiche: {
          ...safe(s.cerfa),
          documents: (s.cerfa.documents || []).map((d) => ({ nom: d.fileName || d.name, type: d.type, ajouteLe: d.uploadDate })),
          signature: {
            signePar: s.cerfa.signature?.signedByName || '',
            date: s.cerfa.signature?.signedDate || '',
            imageDeLaSignature: s.cerfa.signature?.signatureDataUrl ? 'enregistrée (non incluse dans ce fichier)' : 'aucune',
          },
        },
      })),
      remarque: 'Pour recevoir aussi les messages échangés, ou demander une rectification ou une suppression, écrivez à la direction depuis la messagerie du portail.',
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Mes_donnees_${(currentUser.name || 'compte').replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="space-y-6" data-testid="rgpd-panel">
      <div className="bg-gradient-to-r from-blue-900 to-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-md">
        <span className="inline-flex items-center gap-1.5 bg-blue-800 text-blue-200 text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-md mb-2">
          <ShieldCheck className="w-3.5 h-3.5" /> Protection des données — RGPD
        </span>
        <h2 className="text-2xl font-bold tracking-tight">Vos données personnelles sur ce portail</h2>
        <p className="text-blue-200 text-sm mt-1 max-w-3xl">
          Cette page explique, simplement, quelles informations sont enregistrées sur votre compte et sur la fiche sanitaire de vos enfants,
          pourquoi, qui peut les voir, combien de temps elles sont conservées et comment exercer vos droits.
        </p>
      </div>

      {/* Qui est responsable */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Lock className="w-4 h-4 text-blue-900" /> Qui est responsable de vos données ?
        </h3>
        <p className="text-sm text-slate-700 leading-relaxed">
          <strong>{establishment}</strong> est responsable du traitement. Les données sont enregistrées sur le serveur informatique de l'établissement.
          Elles ne sont ni vendues, ni utilisées pour de la publicité, ni transmises à des organismes extérieurs au séjour. Pour toute question,
          écrivez à la direction depuis la <strong>Messagerie</strong> du portail (bouton en bas à gauche de l'écran).
        </p>
      </section>

      {/* Récapitulatif du compte */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3" data-testid="rgpd-summary">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-900" /> Ce que le portail détient aujourd'hui sur votre compte
        </h3>
        <div className="text-sm text-slate-700">
          <p>
            <strong>Compte :</strong> {currentUser.name} — {currentUser.email}
            {currentUser.phone ? ` — ${currentUser.phone}` : ''}
          </p>
          <p className="mt-1">
            <strong>Enfants rattachés à votre compte :</strong> {myChildren.length}
          </p>
        </div>
        {myChildren.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-100 text-slate-700 font-semibold">
                <tr>
                  <th className="p-2">Enfant</th>
                  <th className="p-2">Classe</th>
                  <th className="p-2">Fiche</th>
                  <th className="p-2">Pièces jointes</th>
                  <th className="p-2">Signature</th>
                  <th className="p-2">Voyages inscrits</th>
                  <th className="p-2">Dernière modification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myChildren.map((s) => (
                  <tr key={s.id}>
                    <td className="p-2 font-semibold text-slate-900">
                      {s.cerfa.identity.firstName} {s.cerfa.identity.lastName}
                    </td>
                    <td className="p-2">{s.schoolClass}</td>
                    <td className="p-2">{s.status === 'complete' ? 'Complète' : `Incomplète (${s.completenessPercent ?? 0} %)`}</td>
                    <td className="p-2">{(s.cerfa.documents || []).length}</td>
                    <td className="p-2">{s.cerfa.signature?.signatureDataUrl ? 'Enregistrée' : 'Non signée'}</td>
                    <td className="p-2">{tripNames(s) || 'Aucun'}</td>
                    <td className="p-2">{fmtDate(s.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500 italic">Aucun enfant n'est rattaché à votre compte pour le moment.</p>
        )}
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-2 bg-blue-900 hover:bg-blue-950 text-white font-semibold text-xs px-4 py-2.5 rounded-xl cursor-pointer"
          data-testid="rgpd-download"
        >
          <Download className="w-4 h-4" /> Télécharger une copie de mes données (fichier JSON)
        </button>
        <p className="text-[11px] text-slate-500">
          Le fichier contient votre compte (sans mot de passe) et la fiche complète de vos enfants ; les pièces jointes y sont listées, sans leur contenu.
        </p>
      </section>

      {/* Données collectées */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-900" /> Quelles données sont enregistrées, et pourquoi ?
        </h3>
        <div className="divide-y divide-slate-100">
          {DATA_ROWS.map((r) => (
            <div key={r.title} className="py-3 grid grid-cols-1 md:grid-cols-4 gap-1 md:gap-4">
              <div className="font-semibold text-sm text-slate-900">
                {r.title}
                {r.note && <span className="block text-[11px] font-semibold text-red-700 mt-0.5">{r.note}</span>}
              </div>
              <div className="md:col-span-2 text-sm text-slate-700 leading-relaxed">{r.what}</div>
              <div className="text-xs text-slate-500 leading-relaxed">
                <span className="font-semibold text-slate-600">Pourquoi : </span>
                {r.why}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Qui y a accès */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-900" /> Qui peut voir ces informations ?
        </h3>
        <ul className="text-sm text-slate-700 leading-relaxed list-disc pl-5 space-y-1">
          <li>
            <strong>Vous</strong>, responsable légal : votre compte et les fiches de vos enfants.
          </li>
          <li>
            <strong>La direction / administration de l'établissement</strong> : l'ensemble des fiches et des comptes, pour gérer les voyages et vous aider.
          </li>
          <li>
            <strong>Les professeurs accompagnateurs</strong> du voyage auquel votre enfant est inscrit : la liste sanitaire du séjour (régime, allergies,
            PAI, contact d'urgence) et la fiche de leurs élèves partants uniquement.
          </li>
          <li>
            <strong>Aucune autre famille</strong> : un parent ne voit jamais les enfants ou les messages d'une autre famille.
          </li>
          <li>
            Les <strong>relances par e-mail</strong> (fiche incomplète) sont envoyées depuis la messagerie électronique de l'établissement : elles contiennent le
            prénom et le nom de l'enfant, sa classe et un lien vers la fiche.
          </li>
        </ul>
      </section>

      {/* Conservation */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2" data-testid="rgpd-retention">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-900" /> Combien de temps sont-elles conservées ?
        </h3>
        <ul className="text-sm text-slate-700 leading-relaxed list-disc pl-5 space-y-1">
          {yearEnd && yearEnd.enabled && (
            <li>
              <strong>Inscriptions aux voyages</strong> : remises à zéro chaque année, vers le {yearEnd.day} {MONTHS[yearEnd.month - 1]} : vos enfants sont
              désinscrits de tous les voyages et vous les réinscrivez à la rentrée. Les fiches sanitaires ne sont pas supprimées à cette occasion.
            </li>
          )}
          <li>
            <strong>Fiche sanitaire et compte</strong> : conservés tant que votre enfant est suivi sur le portail, puis supprimés par l'établissement, ou plus
            tôt sur votre demande.
          </li>
          <li>
            <strong>Fiche supprimée</strong> : elle reste 30 jours dans une corbeille (pour annuler une erreur), puis elle est effacée définitivement,
            <strong> avec sa copie PDF archivée sur le serveur</strong>.
          </li>
          <li>
            <strong>Copies de sauvegarde</strong> : le serveur fait une sauvegarde automatique toutes les heures, conservée 14 jours ; l'établissement conserve
            aussi des sauvegardes de son infrastructure. Une donnée effacée peut donc subsister dans ces copies pendant une durée limitée, sans être utilisée.
          </li>
          <li>
            <strong>Messages</strong> : conservés tant que l'établissement ne les supprime pas.
          </li>
        </ul>
      </section>

      {/* Droits */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2">
        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Scale className="w-4 h-4 text-blue-900" /> Vos droits
        </h3>
        <p className="text-sm text-slate-700 leading-relaxed">
          Vous pouvez demander l'<strong>accès</strong> à vos données, leur <strong>rectification</strong>, leur <strong>effacement</strong>, la
          <strong> limitation</strong> de leur utilisation, vous y <strong>opposer</strong> ou recevoir une copie portable.
        </p>
        <ul className="text-sm text-slate-700 leading-relaxed list-disc pl-5 space-y-1">
          <li>
            <strong>Par vous-même, tout de suite</strong> : consulter et corriger la fiche de vos enfants (onglet « Mes enfants & voyages »), télécharger la
            fiche en PDF, désinscrire un enfant d'un voyage, et <strong>télécharger une copie de vos données</strong> avec le bouton ci-dessus.
          </li>
          <li>
            <strong>Pour le reste</strong> (suppression d'une fiche ou du compte, limitation, opposition) : écrivez à la direction depuis la
            <Mail className="w-3.5 h-3.5 inline mx-1" /> <strong>Messagerie</strong> du portail en précisant votre demande.
          </li>
          <li>
            Si vous estimez, après nous avoir contactés, que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la CNIL (cnil.fr).
          </li>
        </ul>
      </section>
    </div>
  );
};
