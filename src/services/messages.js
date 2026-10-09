// src/services/messages.js
// Étape 5 — messagerie privée ET commentaires : mêmes contenus (texte+émojis, vocal, fichiers/photos/stickers).
import { supabase } from '../supabaseClient';
import { uploadToCloudinary } from '../cloudinaryClient';

// Cloudinary range l'audio dans le type « video »; les documents sont des fichiers « raw ».
const RESOURCE = { voice: 'video', image: 'image', sticker: 'image', file: 'raw' };

export const kindOfFile = (file) => (file?.type?.startsWith('image/') ? 'image' : 'file');

// Un seul format de contenu pour les deux tables
async function buildPayload({ kind = 'text', text = '', blob = null, fileName = null, durationS = null }) {
  const body = String(text || '').trim().slice(0, 2000) || null;
  if (kind === 'text' || kind === 'sticker') {
    if (!body) throw new Error('Message vide.');
    return { kind, body };
  }
  if (!blob) throw new Error('Fichier manquant.');
  const up = await uploadToCloudinary(blob, RESOURCE[kind] || 'raw');   // → URL publique
  return { kind, body, media_url: up.url, file_name: fileName || blob.name || null, duration_s: durationS ?? (up.duration ? Math.round(up.duration) : null) };
}

// ---- Messagerie privée (entre amis acceptés) ----
export async function sendPrivateMessage({ myId, toId, ...content }) {
  const payload = await buildPayload(content);
  const { data, error } = await supabase.from('private_messages')
    .insert({ sender_id: myId, recipient_id: toId, ...payload }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function loadConversation(myId, otherId, limit = 200) {
  const { data, error } = await supabase.from('private_messages').select('*')
    .or(`and(sender_id.eq.${myId},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${myId})`)
    .order('created_at', { ascending: true }).limit(limit);
  if (error) throw error;
  return data;
}

export function subscribeMessages(myId, onInsert) {
  const ch = supabase.channel(`pm:${myId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'private_messages', filter: `recipient_id=eq.${myId}` },
      ({ new: row }) => onInsert(row))
    .subscribe();
  return () => supabase.removeChannel(ch);
}

export const markRead = (myId, otherId) =>
  supabase.from('private_messages').update({ read_at: new Date().toISOString() })
    .eq('recipient_id', myId).eq('sender_id', otherId).is('read_at', null);

// ---- Commentaires sous les publications ----
export async function addEventComment({ eventId, myId, parentId = null, ...content }) {
  const payload = await buildPayload(content);
  const { data, error } = await supabase.from('event_comments')
    .insert({ event_id: String(eventId), author_id: myId, parent_id: parentId, ...payload }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function loadEventComments(eventId) {
  const { data, error } = await supabase.from('event_comments')
    .select('*, author:users!event_comments_author_id_fkey(id, username, photo_url), likes:event_comment_likes(user_id)')
    .eq('event_id', String(eventId)).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export const editEventComment = (id, text) =>
  supabase.from('event_comments').update({ body: text.trim().slice(0, 2000), edited_at: new Date().toISOString() }).eq('id', id);
export const deleteEventComment = (id) => supabase.from('event_comments').delete().eq('id', id);
export const likeEventComment = (id, myId, on) => on
  ? supabase.from('event_comment_likes').upsert({ comment_id: id, user_id: myId })
  : supabase.from('event_comment_likes').delete().match({ comment_id: id, user_id: myId });

export function subscribeEventComments(eventId, onChange) {
  const ch = supabase.channel(`evc:${eventId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_comments', filter: `event_id=eq.${eventId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_comment_likes' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(ch);
}
