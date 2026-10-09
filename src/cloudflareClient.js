// src/cloudflareClient.js
import { supabase } from './supabaseClient';

const WORKER_URL = import.meta.env.VITE_CLOUDFLARE_WORKER_URL;

const safeName = (n = 'file') =>
  n
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(-80);

// Renvoie { url } (objet), pour que tous les appels `uploaded.url` fonctionnent
export async function uploadToR2(file, kind) {
  if (!WORKER_URL) throw new Error('VITE_CLOUDFLARE_WORKER_URL manquante');
  if (!file) throw new Error('Aucun fichier fourni');

  const name = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${safeName(
    file.name || 'fichier'
  )}`;

  const headers = { 'Content-Type': file.type || 'application/octet-stream' };

  // Les avatars (inscription) sont publics : pas de session requise.
  // Tout le reste (chat, voice, stories, events, covers, audio, lyrics) nécessite un token Supabase.
  if (kind !== 'avatars') {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Session expirée : reconnectez-vous.');
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  const res = await fetch(
    `${WORKER_URL}/upload/${kind}/${encodeURIComponent(name)}`,
    { method: 'PUT', headers, body: file }
  );

  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Envoi refusé (${res.status})`);
  return { url: out.url };   // ✅ objet { url }
}

// Convertit une URL blob: / data: en File, puis l'envoie sur R2.
// Renvoie une string (URL publique), pas un objet.
export async function urlToR2(blobOrDataUrl, kind = 'stories') {
  if (!blobOrDataUrl) return null;
  const response = await fetch(blobOrDataUrl);
  const blob = await response.blob();
  const ext = blob.type.includes('video') ? 'mp4'
            : blob.type.includes('audio') ? 'webm'
            : blob.type.includes('png')   ? 'png'
            : 'jpg';
  const file = new File([blob], `media_${Date.now()}.${ext}`, { type: blob.type });
  const { url } = await uploadToR2(file, kind);
  return url;
}

export async function deleteFromR2(url) {
  if (!url) return;
  try {
    const m = url.match(/\/([a-z-]+)\/([^/?]+)$/);
    if (!m) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch(`${WORKER_URL}/delete/${m[1]}/${m[2]}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  } catch (e) {
    console.warn('Suppression R2 impossible :', e);
  }
}
