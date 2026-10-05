console.log('[fichesanitaire] build attachments-limit-20261004');

// --- Pièces jointes (ordonnances, PAI, justificatifs) : contrôle et compression ---
// Les pièces jointes sont stockées dans la base en base64 et téléchargées par TOUS les navigateurs
// à l'ouverture du portail : une seule photo de 5 Mo pesait plus que le reste de la base.
// Les images sont réduites (1600 px, JPEG) ; les PDF sont limités en taille.

export const MAX_ATTACHMENT_BYTES = 1.5 * 1024 * 1024; // taille maximale d'une pièce jointe enregistrée
export const MAX_INPUT_BYTES = 40 * 1024 * 1024; // au-delà : refusé d'emblée (photo > 40 Mo)
const MAX_SIDE = 1600;

export function formatMo(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' Mo';
}

export function validateAttachment(file: { type: string; size: number }): string | null {
  const isPdf = file.type === 'application/pdf';
  const isImage = file.type.startsWith('image/');
  if (!isPdf && !isImage) return 'Format non accepté : envoyez un PDF ou une photo (JPEG, PNG).';
  if (file.size === 0) return 'Le fichier est vide.';
  if (file.size > MAX_INPUT_BYTES) return `Fichier trop volumineux (${formatMo(file.size)}).`;
  if (isPdf && file.size > MAX_ATTACHMENT_BYTES) {
    return `PDF trop volumineux (${formatMo(file.size)}) : ${formatMo(MAX_ATTACHMENT_BYTES)} maximum. Réduisez-le (scan en basse résolution, « enregistrer sous » en taille réduite) ou envoyez plutôt une photo.`;
  }
  return null;
}

// Dimensions finales d'une image : le plus grand côté ne dépasse jamais maxSide
export function fitSize(w: number, h: number, maxSide = MAX_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Lecture impossible')));
    reader.onerror = () => reject(new Error('Lecture impossible'));
    reader.readAsDataURL(file);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image illisible : enregistrez-la en JPEG ou en PNG puis recommencez."));
    };
    img.src = url;
  });
}

export interface PreparedAttachment {
  dataUrl: string;
  sizeBytes: number;
  name: string;
}

export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  const problem = validateAttachment(file);
  if (problem) throw new Error(problem);

  if (file.type === 'application/pdf') {
    return { dataUrl: await readAsDataUrl(file), sizeBytes: file.size, name: file.name };
  }

  const img = await loadImage(file);
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Traitement de l\'image impossible sur cet appareil.');
  ctx.fillStyle = '#ffffff'; // fond blanc (documents scannés / PNG transparents)
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  // qualité abaissée progressivement jusqu'à tenir sous la limite
  let blob: Blob | null = null;
  for (const q of [0.78, 0.65, 0.5, 0.4]) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
    if (blob && blob.size <= MAX_ATTACHMENT_BYTES) break;
  }
  if (!blob || blob.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Image trop détaillée pour être réduite : essayez avec une photo plus simple ou un PDF léger.');
  }
  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return { dataUrl: await readAsDataUrl(blob), sizeBytes: blob.size, name };
}

// Message temporaire : un seul minuteur à la fois (avant, le minuteur d'un message précédent pouvait
// effacer trop tôt le message suivant, par exemple un refus affiché juste après un succès).
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
export function flashNotice(set: (message: string) => void, message: string, ms: number): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  set(message);
  noticeTimer = setTimeout(() => set(''), ms);
}
