// src/utils/vipShared.js
// Données partagées entre AdminVip et UserVip (via localStorage).
// Admin et User lisent / écrivent les mêmes clés : ce que l'admin publie
// apparaît côté user, et les achats (stock des billets) se répercutent des deux côtés.

export const EVENTS_KEY = 'vip_events';
export const STORIES_KEY = 'vip_stories';
const STORY_TTL = 24 * 60 * 60 * 1000; // une story disparaît après 24 h

// ---------- Lecture / écriture ----------
const read = (key) => {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

// N'écrit que si la valeur change (évite les boucles d'événements "storage" entre onglets)
const writeIfChanged = (key, value) => {
  const next = JSON.stringify(value);
  if (localStorage.getItem(key) === next) return;
  localStorage.setItem(key, next);
};

export const loadEvents = () => read(EVENTS_KEY);

export const saveEvents = (events) => {
  try { writeIfChanged(EVENTS_KEY, events); }
  catch (e) { console.warn('Stockage des publications impossible (quota ?)', e); }
};

export const loadStories = () => {
  const now = Date.now();
  return read(STORIES_KEY).filter(s => now - (s.createdAt || now) < STORY_TTL);
};

// Si le quota est dépassé (vidéos lourdes), on retire les plus anciennes stories jusqu'à ce que ça rentre
export const saveStories = (stories) => {
  let items = stories;
  while (items.length > 0) {
    try { writeIfChanged(STORIES_KEY, items); return true; }
    catch { items = items.slice(1); }
  }
  try { localStorage.removeItem(STORIES_KEY); } catch { /* ignore */ }
  return false;
};

// Une story privée n'est visible que par son auteur
export const canSeeStory = (story, pseudo) => story.privacy !== 'private' || story.user === pseudo;

// Réagit aux changements faits depuis un autre onglet (ex. admin publie pendant que le user regarde le feed)
export const subscribeShared = ({ onEvents, onStories }) => {
  const handler = (e) => {
    if (e.key === EVENTS_KEY && onEvents) onEvents(loadEvents());
    if (e.key === STORIES_KEY && onStories) onStories(loadStories());
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
};

// ---------- Médias : les blob: ne survivent pas à un rechargement, on les convertit en data URL ----------
export const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

// Réduit une image (max 1280 px) pour ne pas saturer le localStorage
export const shrinkImage = (blob, maxSide = 1280, quality = 0.85) => new Promise((resolve) => {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // PNG transparents : fond blanc plutôt que noir
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    resolve(canvas.toDataURL('image/jpeg', quality));
  };
  img.onerror = () => { URL.revokeObjectURL(url); blobToDataUrl(blob).then(resolve); };
  img.src = url;
});

export const fileToPersistentUrl = (file) =>
  file.type.startsWith('image/') ? shrinkImage(file) : blobToDataUrl(file);

export const blobUrlToPersistentUrl = async (blobUrl, kind) => {
  const blob = await (await fetch(blobUrl)).blob();
  return kind === 'photo' ? shrinkImage(blob) : blobToDataUrl(blob);
};

// ---------- Icônes des paliers (même rendu côté admin et côté user) ----------
export const TIER_ICONS = {
  fanzone: 'fa-users', silver: 'fa-medal', lite: 'fa-ticket-alt', gold: 'fa-star', vip: 'fa-crown', vvip: 'fa-gem',
  reservation: 'fa-calendar-check', standard: 'fa-ticket-alt',
};
export const TIER_EMOJIS = {
  fanzone: '🙌', silver: '🥈', lite: '🎟️', gold: '🥇', vip: '⭐', vvip: '👑', reservation: '📅', standard: '🎟️',
};
export const tierIconClass = (type) => `fas ${TIER_ICONS[type] || 'fa-ticket-alt'}`;
export const tierEmoji = (type) => TIER_EMOJIS[type] || '🎟️';
