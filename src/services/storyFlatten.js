// src/services/storyFlatten.js
// Une story « photo » est un montage : l'image + des textes/emojis déplaçables (éléments HTML).
// Instagram n'accepte qu'un fichier image : on « aplatit » donc le montage en un JPEG 1080×1920,
// sans aucune bibliothèque externe.

const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

// Rotation appliquée par l'outil de rotation de l'éditeur : transform: rotate(45deg)
export const rotationOf = (el) => {
  const m = /rotate\((-?[\d.]+)deg\)/.exec(el?.style?.transform || '');
  return m ? parseFloat(m[1]) : 0;
};

// Agrandit/recadre (comme object-fit: cover) un contenu src dans une boîte
export const coverTransform = (srcW, srcH, boxW, boxH) => {
  const s = Math.max(boxW / srcW, boxH / srcH);
  return { s, ox: (boxW - srcW * s) / 2, oy: (boxH - srcH * s) / 2 };
};

const isTransparent = (c) => !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';

function drawOverlay(ctx, el, getStyle) {
  const cs = getStyle(el);
  const text = (el.querySelector('span')?.textContent ?? '').trim(); // ignore les poignées (X, redimensionner…)
  if (!text) return;
  const w = el.offsetWidth, h = el.offsetHeight;
  ctx.save();
  ctx.translate(el.offsetLeft + w / 2, el.offsetTop + h / 2);
  const rot = rotationOf(el);
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  if (!isTransparent(cs.backgroundColor)) { ctx.fillStyle = cs.backgroundColor; ctx.fillRect(-w / 2, -h / 2, w, h); }
  ctx.font = `${num(cs.fontSize, 24)}px ${cs.fontFamily || 'Arial'}`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = cs.color || '#fff';
  if (el.style.display === 'flex') { // emoji : centré dans sa boîte
    ctx.textAlign = 'center';
    ctx.fillText(text, 0, 0);
  } else { // texte : aligné à gauche avec son padding
    ctx.textAlign = 'left';
    ctx.fillText(text, -w / 2 + num(cs.paddingLeft, 5), 0);
  }
  ctx.restore();
}

/**
 * @param previewEl  l'élément .preview-container de l'éditeur (image + éléments .draggable-element)
 * @returns Promise<Blob> JPEG 1080×1920
 */
export async function flattenPhotoStory(previewEl, opts = {}, env = {}) {
  const { width = 1080, height = 1920, quality = 0.92 } = opts;
  const doc = env.document || document;
  const getStyle = env.getComputedStyle || ((el) => window.getComputedStyle(el));
  const img = previewEl?.querySelector('img');
  if (!img) throw new Error("Image introuvable dans l'aperçu de la story.");
  if (typeof img.decode === 'function') await img.decode().catch(() => {});

  const boxW = previewEl.clientWidth || width;
  const boxH = previewEl.clientHeight || height;
  const canvas = doc.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  const toCanvas = coverTransform(boxW, boxH, width, height);          // aperçu → canvas
  const imgInBox = coverTransform(img.naturalWidth || boxW, img.naturalHeight || boxH, boxW, boxH); // photo → aperçu
  ctx.save();
  ctx.translate(toCanvas.ox, toCanvas.oy);
  ctx.scale(toCanvas.s, toCanvas.s);
  ctx.beginPath(); ctx.rect(0, 0, boxW, boxH); ctx.clip();
  ctx.drawImage(img, imgInBox.ox, imgInBox.oy, (img.naturalWidth || boxW) * imgInBox.s, (img.naturalHeight || boxH) * imgInBox.s);
  previewEl.querySelectorAll('.draggable-element').forEach((el) => drawOverlay(ctx, el, getStyle));
  ctx.restore();

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Impossible d'exporter l'image de la story."))), 'image/jpeg', quality));
}
