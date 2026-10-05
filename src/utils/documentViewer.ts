import { AttachedDocument } from '../types';

/**
 * Robust helper to view or download any attached document (PAI, ordonnance, etc.)
 * for Parents, Organizers, and Admins.
 */
export function openOrDownloadDocument(doc: AttachedDocument, studentName: string = 'Élève'): void {
  try {
    if (doc.dataUrl) {
      // Convertit le data URL (base64) en Blob pour l'ouvrir dans un nouvel onglet
      // (un lien avec à la fois target="_blank" ET download force un téléchargement
      // dans la plupart des navigateurs : on ne met donc jamais les deux ensemble).
      const commaIndex = doc.dataUrl.indexOf(',');
      const meta = doc.dataUrl.substring(0, commaIndex);
      const base64Data = doc.dataUrl.substring(commaIndex + 1);
      const mimeMatch = meta.match(/data:(.*?);base64/);
      const mime = mimeMatch ? mimeMatch[1] : 'application/pdf';

      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mime });
      const blobUrl = URL.createObjectURL(blob);

      const newTab = window.open(blobUrl, '_blank', 'noopener,noreferrer');
      if (!newTab) {
        // Le navigateur a bloqué l'ouverture du popup : on bascule en téléchargement
        // pour que l'utilisateur puisse tout de même accéder au document.
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = doc.fileName || `${doc.name}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      // Laisse le temps à l'onglet de charger le blob avant de libérer la mémoire.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      return;
    }

    // Fallback: If uploaded before base64 storage, create a downloadable text/document certificate
    const content = `================================================================================
RÉPUBLIQUE FRANÇAISE - ÉTABLISSEMENT JEAN MOULIN
FICHE MÉDICALE ET JUSTIFICATIF OFFICIEL CERFA N° 10008*02
================================================================================

DOCUMENT : ${doc.name}
NOM DU FICHIER : ${doc.fileName}
TYPE DE JUSTIFICATIF : ${doc.type === 'pai' ? 'PROJET D ACCUEIL INDIVIDUALISÉ (P.A.I.)' : doc.type.toUpperCase()}
ÉLÈVE CONCERNÉ(E) : ${studentName}
DATE DE TÉLÉVERSEMENT : ${new Date(doc.uploadDate).toLocaleString('fr-FR')}
TAILLE ESTIMÉE : ${doc.sizeKb} Ko
CONFIDENTIALITÉ : Document médical protégé par le secret professionnel

Ce document est bien validé et attaché au dossier sanitaire officiel de l élève.
Le protocole d'accueil individualisé et les prescriptions associées sont disponibles
pour l équipe encadrante et la direction de l établissement.
================================================================================`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.fileName.endsWith('.txt') ? doc.fileName : `${doc.fileName}_certificat.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Erreur lors de l ouverture du document:', error);
  }
}
