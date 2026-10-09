// src/services/stories.js
// Étape 3 — une story = URL Cloudinary publique (jamais blob:/data:) + textes/émojis, enregistrés dans `stories`.
import { supabase } from '../supabaseClient';
import { uploadToCloudinary } from '../cloudinaryClient';

// Une story reste visible 48 h, puis elle est effacée (liste + base). Un direct en cours n'expire pas.
export const STORY_TTL_MS = 48 * 60 * 60 * 1000;
export const isStoryExpired = (st) => st.type !== 'live' && !!st.createdAt && Date.now() - st.createdAt > STORY_TTL_MS;

const isLocal = (u) => typeof u === 'string' && /^(blob:|data:)/.test(u);

// Textes et émojis posés sur l'aperçu. Positions en POURCENTAGE de l'aperçu (indépendant de la taille d'écran),
// rendues sans HTML brut par <StoryPhoto/> (aucun risque d'injection de code dans la story d'un autre).
// → [{ text, kind: 'text'|'emoji', x, y, w, h, fs, rotation, color, bg, font }]
export function extractOverlays(previewEl) {
  if (!previewEl) return [];
  const W = previewEl.clientWidth || 1, H = previewEl.clientHeight || 1;
  const pct = (v, base) => Math.round((v / base) * 10000) / 100;
  return [...previewEl.querySelectorAll('.draggable-element')].map((el) => {
    const cs = getComputedStyle(el);
    const rot = /rotate\((-?[\d.]+)deg\)/.exec(el.style.transform || '');
    return {
      text: (el.querySelector('span')?.textContent ?? '').trim().slice(0, 200),
      kind: el.style.display === 'flex' ? 'emoji' : 'text',
      x: pct(el.offsetLeft, W), y: pct(el.offsetTop, H), w: pct(el.offsetWidth, W), h: pct(el.offsetHeight, H),
      fs: pct(parseFloat(cs.fontSize) || 24, W),
      rotation: rot ? parseFloat(rot[1]) : 0,
      color: cs.color, bg: cs.backgroundColor, font: cs.fontFamily,
    };
  }).filter((o) => o.text);
}

// Envoie le fichier brut (Blob/File, ou blob:/data: URL) à Cloudinary → URL web publique compressée
export async function toPublicUrl(source, resourceType) {
  if (!source) throw new Error('Aucun média à envoyer.');
  let file = source;
  if (isLocal(source)) file = await (await fetch(source)).blob();
  const up = await uploadToCloudinary(file, resourceType);
  return up.url;
}

export async function saveStory({ userId, type, mediaUrl, title, description, privacy = 'public', overlays = [], music = null, instagramMediaId = null }) {
  if (type !== 'live' && (!mediaUrl || isLocal(mediaUrl))) throw new Error("L'URL publique du média est requise (pas de blob: ni data:).");
  const { data, error } = await supabase.from('stories').insert({
    user_id: userId, type, media_url: mediaUrl || null, title, description, privacy, overlays, music,
    instagram_media_id: instagramMediaId,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listStories() {
  const { data, error } = await supabase.from('stories')
    .select('*, author:users!stories_user_id_fkey(id, username, photo_url)')
    .gte('created_at', new Date(Date.now() - STORY_TTL_MS).toISOString())
    .order('created_at', { ascending: true }).limit(100);
  if (error) throw error;
  return data;
}

// Supprime en base les stories de plus de 48 h (la RLS limite à mes stories ; l'admin supprime celles de tous)
export async function purgeExpiredStories() {
  await supabase.from('stories').delete().lt('created_at', new Date(Date.now() - STORY_TTL_MS).toISOString());
}

export function subscribeStories(onChange) {
  const ch = supabase.channel('stories-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stories' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(ch);
}

// Ligne de la table `stories` → objet « story » utilisé par les pages AdminVip / UserVip
export function mapRowToStory(row, adminId) {
  return {
    id: row.id, remote: true,
    type: row.type, url: row.media_url, title: row.title || 'Sans titre', desc: row.description || '',
    privacy: row.privacy, user: row.author?.username || 'Membre', userId: row.user_id,
    role: row.user_id === adminId ? 'admin' : 'user', avatar: row.author?.photo_url || null,
    createdAt: new Date(row.created_at).getTime(), previewHtml: '',
    overlays: row.overlays || [], music: row.music || null,
    zoomSessionId: row.zoom_session_id || null, liveStatus: row.live_status || null,
  };
}
