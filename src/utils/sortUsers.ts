console.log('[fichesanitaire] build switch-admin-20261002');

import type { User } from '../types';

// Clé de tri d'un compte : sans titre de civilité (« Mme CHERIF », « M. MATTARD », « M.ROMERO »
// sont classés sur CHERIF, MATTARD, ROMERO), insensible aux accents et à la casse.
export function userSortKey(u: Pick<User, 'name'>): string {
  const name = String(u && u.name ? u.name : '').trim();
  const stripped = name.replace(/^(?:mme|mlle|mr|m\.|monsieur|madame|mademoiselle|dr|pr)\.?\s*/i, '').trim();
  return (stripped || name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function sortUsersByName(list: User[]): User[] {
  return [...list].sort((a, b) => userSortKey(a).localeCompare(userSortKey(b), 'fr', { sensitivity: 'base', numeric: true }));
}
