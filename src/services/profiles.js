// src/services/profiles.js
// Étape 1 — profil unique (id, pseudo, avatar_url), synchronisé partout en temps réel.
// Source de vérité : public.users (username = pseudo, photo_url = avatar).
import { supabase } from '../supabaseClient';

export const toProfile = (row) => row && ({ id: row.id, pseudo: row.username || 'Membre', avatar_url: row.photo_url || null });

export async function fetchProfiles(ids) {
  if (!ids?.length) return [];
  const { data, error } = await supabase.from('users').select('id, username, photo_url').in('id', ids);
  if (error) throw error;
  return data.map(toProfile);
}

// Appelé par ProfileSettingsPanel quand on change la photo ou le pseudo
export async function updateMyProfile({ pseudo, avatarUrl }) {
  const { data, error } = await supabase.rpc('update_my_profile', {
    p_username: pseudo ?? null,
    p_photo_url: avatarUrl ?? null,
  });
  if (error) throw new Error(error.message);
  return toProfile(data);
}

// ── Écoute temps réel : UN SEUL canal partagé par toute l'application ──
// Avant : chaque useProfiles() recréait supabase.channel('profiles-sync'). Supabase renvoie alors
// le canal déjà abonné et `.on()` plante ("cannot add postgres_changes callbacks after subscribe()").
// Maintenant : un canal unique, et chaque composant ajoute simplement son listener.
const listeners = new Set();
let channel = null;

export function subscribeProfiles(onChange) {
  listeners.add(onChange);

  if (!channel) {
    channel = supabase
      .channel('profiles-sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, ({ new: row }) => {
        const p = toProfile(row);
        listeners.forEach((fn) => { try { fn(p); } catch (e) { console.warn('profiles listener', e); } });
      })
      .subscribe();
  }

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}
