// src/services/instagramStory.js
//
// Schéma du fichier « arrière » :
//
//   [Image d'origine]
//        ▼
//   1. API de modification (Cloudinary)  ──►  URL publique de l'image/vidéo modifiée
//        ▼
//   2. API Instagram Graph (STORIES)     ──►  apparaît sur la Story
//
// Valable pour la story IMAGE et la story VIDÉO.
// Le jeton Instagram reste côté serveur (fonction Edge « instagram-story »).
import { uploadToCloudinary } from '../cloudinaryClient';
import { callEdgeFunction } from './edgeFunctions';

const STORY_W = 1080;
const STORY_H = 1920;
const MAX_VIDEO_SECONDS = 60;

// ---- Étape 1 : transformation Cloudinary (format Story 9:16) ----
// Insère les paramètres de transformation dans l'URL Cloudinary renvoyée par uploadToCloudinary().
export function instagramStoryUrl(uploaded, kind) {
  const url = uploaded?.url;
  if (!url || !url.includes('/upload/')) throw new Error("URL Cloudinary inattendue.");
  const transform = kind === 'video'
    ? `c_fill,w_${STORY_W},h_${STORY_H},du_${MAX_VIDEO_SECONDS},vc_h264,ac_aac,q_auto,f_mp4`
    : `c_fill,w_${STORY_W},h_${STORY_H},q_auto,f_jpg`;
  return url
    .replace('/upload/', `/upload/${transform}/`)
    .replace(/\.[a-z0-9]+(\?.*)?$/i, kind === 'video' ? '.mp4' : '.jpg');
}

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

// Cloudinary fabrique la version transformée à la première demande (surtout pour une vidéo) :
// on la « réveille » et on attend qu'elle soit disponible avant de la donner à Instagram.
export async function waitForMedia(url, { timeoutMs = 90000, intervalMs = 3000, fetchImpl = fetch, sleep = sleepDefault, now = Date.now } = {}) {
  const start = now();
  while (now() - start < timeoutMs) {
    try {
      const res = await fetchImpl(url);
      try { await res.body?.cancel?.(); } catch { /* ignore */ }
      if (res.ok) return true;
    } catch { /* réseau / CORS : on réessaie */ }
    await sleep(intervalMs);
  }
  return false; // on tente quand même : le serveur réessaie aussi
}

// ---- Étape 2 : API Instagram Graph, via la fonction Edge ----
async function pollStatus(creationId, { call, sleep, intervalMs, timeoutMs, now }) {
  const start = now();
  while (now() - start < timeoutMs) {
    const { status, detail } = await call('instagram-story', { action: 'status', creationId });
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw Object.assign(new Error(detail || `Instagram a refusé le média (${status}).`), { code: 'INSTAGRAM_MEDIA_' + status });
    }
    await sleep(intervalMs);
  }
  throw Object.assign(new Error("Instagram met trop de temps à traiter le média."), { code: 'INSTAGRAM_TIMEOUT' });
}

/**
 * @param kind  'photo' | 'video'
 * @param file  Blob/File de l'image aplatie (photo) ou de la vidéo
 * @param onStep  appelé avec : 'upload' | 'transform' | 'send' | 'process' | 'publish' | 'done'
 */
export async function publishInstagramStory({ kind, file, onStep = () => {} }, deps = {}) {
  const {
    upload = uploadToCloudinary,
    call = callEdgeFunction,
    wait = waitForMedia,
    sleep = sleepDefault,
    now = Date.now,
    pollIntervalMs = 3000,
    pollTimeoutMs = 120000,
  } = deps;
  if (kind !== 'photo' && kind !== 'video') throw new Error('Type de story non pris en charge par Instagram.');
  if (!file) throw new Error('Aucun média à envoyer.');

  onStep('upload');
  const uploaded = await upload(file, kind === 'video' ? 'video' : 'image');
  if (kind === 'video' && uploaded.duration && uploaded.duration < 3) {
    throw Object.assign(new Error('Une story vidéo doit durer au moins 3 secondes.'), { code: 'VIDEO_TOO_SHORT' });
  }

  onStep('transform');
  const igUrl = instagramStoryUrl(uploaded, kind);
  await wait(igUrl);

  onStep('send');
  const { creationId } = await call('instagram-story', { action: 'create', mediaType: kind === 'video' ? 'VIDEO' : 'IMAGE', url: igUrl });

  onStep('process');
  await pollStatus(creationId, { call, sleep, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, now });

  onStep('publish');
  const { mediaId } = await call('instagram-story', { action: 'publish', creationId });
  onStep('done');
  return { mediaId, url: igUrl };
}

// Texte affiché à l'admin pour chaque étape / erreur
export const IG_STEP_LABELS = {
  upload: 'Envoi du média vers Cloudinary…',
  transform: 'Mise au format Story (1080×1920)…',
  send: 'Envoi à Instagram…',
  process: 'Instagram traite le média…',
  publish: 'Publication sur la Story Instagram…',
  done: 'Publiée sur Instagram ✔',
};

export function friendlyInstagramError(err) {
  switch (err?.code) {
    case 'INSTAGRAM_NOT_CONFIGURED': return "Instagram n'est pas encore configuré (voir LIVE_SETUP.md). Votre story est publiée dans l'application.";
    case 'UNAVAILABLE': return "Service Instagram injoignable (fonction non déployée ?). Votre story est publiée dans l'application.";
    case 'FORBIDDEN': return "Seul l'administrateur peut publier sur Instagram.";
    case 'UNAUTHENTICATED': return 'Reconnectez-vous pour publier sur Instagram.';
    case 'VIDEO_TOO_SHORT': return err.message;
    default: return `Instagram : ${err?.message || 'échec de la publication'}. Votre story est publiée dans l'application.`;
  }
}
