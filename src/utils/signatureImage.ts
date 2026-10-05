console.log('[fichesanitaire] build ui-signature-20261001');

// --- Import d'une image de signature (réservé à l'administration) ---
// L'image est nettoyée avant d'être enregistrée : fond clair rendu transparent, marges
// rognées, puis centrée dans un cadre de 1300 x 200 px (même proportion que la zone
// « Signature » du PDF : 39 x 6 mm) pour ne jamais être déformée.

export const SIGNATURE_MAX_BYTES = 5 * 1024 * 1024;
export const SIGNATURE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const SIGNATURE_OUT_WIDTH = 1300;
export const SIGNATURE_OUT_HEIGHT = 200;

export function validateSignatureFile(file: { type: string; size: number }): string | null {
  if (!SIGNATURE_ACCEPTED_TYPES.includes(file.type)) {
    return 'Format non pris en charge : choisissez une image PNG, JPEG ou WebP.';
  }
  if (file.size === 0) return 'Le fichier est vide.';
  if (file.size > SIGNATURE_MAX_BYTES) return 'Image trop volumineuse (5 Mo maximum).';
  return null;
}

// Plus grand rectangle de même proportion que (srcW x srcH) contenu et centré dans (boxW x boxH)
export function containRect(srcW: number, srcH: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / srcW, boxH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

// Rend transparent le fond clair (papier blanc d'un scan) ; les traits sombres restent intacts
export function whitenToTransparent(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    if (min >= 235) data[i + 3] = 0;
    else if (min > 190) data[i + 3] = Math.round((data[i + 3] * (235 - min)) / 45);
  }
}

// Cadre englobant des pixels visibles (null si l'image est vide)
export function visibleBounds(data: Uint8ClampedArray, width: number, height: number, threshold = 24) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
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
      reject(new Error('Image illisible'));
    };
    img.src = url;
  });
}

export async function signatureFileToDataUrl(file: File): Promise<string> {
  const img = await loadImage(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const ww = Math.max(1, Math.round(img.naturalWidth * scale));
  const wh = Math.max(1, Math.round(img.naturalHeight * scale));

  const work = document.createElement('canvas');
  work.width = ww;
  work.height = wh;
  const wctx = work.getContext('2d');
  if (!wctx) throw new Error('Canvas indisponible');
  wctx.drawImage(img, 0, 0, ww, wh);
  const pixels = wctx.getImageData(0, 0, ww, wh);
  whitenToTransparent(pixels.data);
  wctx.putImageData(pixels, 0, 0);

  const b = visibleBounds(pixels.data, ww, wh);
  if (!b) throw new Error('Aucune signature visible dans cette image');
  const margin = Math.round(Math.max(b.w, b.h) * 0.02);
  const sx = Math.max(0, b.x - margin);
  const sy = Math.max(0, b.y - margin);
  const sw = Math.min(ww - sx, b.w + 2 * margin);
  const sh = Math.min(wh - sy, b.h + 2 * margin);

  const out = document.createElement('canvas');
  out.width = SIGNATURE_OUT_WIDTH;
  out.height = SIGNATURE_OUT_HEIGHT;
  const octx = out.getContext('2d');
  if (!octx) throw new Error('Canvas indisponible');
  octx.clearRect(0, 0, out.width, out.height);
  const r = containRect(sw, sh, SIGNATURE_OUT_WIDTH - 20, SIGNATURE_OUT_HEIGHT - 12);
  octx.drawImage(work, sx, sy, sw, sh, r.x + 10, r.y + 6, r.w, r.h);
  return out.toDataURL('image/png');
}
