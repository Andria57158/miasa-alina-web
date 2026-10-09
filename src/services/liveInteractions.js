// src/services/liveInteractions.js
// Étape 4 — session Zoom + commentaires/réactions écoutés en continu sur `live_interactions`.
import { supabase } from '../supabaseClient';
import { createLiveSession, endLiveSession } from './zoomLive';

export const LIVE_REACTIONS = ['🔥', '👍', '❤️', '👎'];

// L'admin lance le live : la réunion Zoom est créée côté serveur, son numéro est stocké dans zoom_session_id
export async function startLive({ userId, title, privacy = 'public' }) {
  const session = await createLiveSession({ title });               // { meetingNumber, password, sdkKey, signature, zak }
  const { data, error } = await supabase.from('stories').insert({
    user_id: userId, type: 'live', title, privacy, live_status: 'live',
    zoom_session_id: String(session.meetingNumber),
  }).select().single();
  if (error) throw new Error(error.message);
  return { story: data, session };
}

export async function stopLive(story) {
  try { await endLiveSession(story.zoom_session_id); } catch { /* la réunion peut déjà être close */ }
  await supabase.from('stories').update({ live_status: 'ended', ended_at: new Date().toISOString() }).eq('id', story.id);
}

export async function sendInteraction({ storyId, userId, kind, emoji = null, body = null }) {
  const { error } = await supabase.from('live_interactions')
    .insert({ story_id: storyId, user_id: userId, kind, emoji, body: body ? body.trim().slice(0, 500) : null });
  if (error) throw new Error(error.message);
}

export async function loadInteractions(storyId, limit = 200) {
  const { data, error } = await supabase.from('live_interactions').select('*')
    .eq('story_id', storyId).order('created_at', { ascending: true }).limit(limit);
  if (error) throw error;
  return data;
}

export function subscribeInteractions(storyId, onInsert) {
  const ch = supabase.channel(`live-inter:${storyId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_interactions', filter: `story_id=eq.${storyId}` },
      ({ new: row }) => onInsert(row))
    .subscribe();
  return () => supabase.removeChannel(ch);
}
