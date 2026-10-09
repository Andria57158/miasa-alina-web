// src/services/storyManage.js
// Modifier / supprimer une story déjà publiée (seul l'auteur peut le faire : contrôlé par la base, voir story_manage.sql).
import { supabase } from '../supabaseClient';

export async function updateStory(id, { title, description, privacy }) {
  const { data, error } = await supabase.from('stories')
    .update({ title, description, privacy }).eq('id', id).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Modification refusée : seul l'auteur peut modifier sa story.");
  return data[0];
}

export async function deleteStory(id) {
  const { data, error } = await supabase.from('stories').delete().eq('id', id).select();
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Suppression refusée : seul l'auteur peut supprimer sa story.");
  return true;
}
