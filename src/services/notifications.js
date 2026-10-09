// src/services/notifications.js — notifications réelles (table user_notifications, remplie par des triggers Supabase : sql/4_notifications.sql)
import { supabase } from '../supabaseClient';

const SELECT = '*, actor:users!user_notifications_actor_id_fkey(username, photo_url)';

export async function listNotifications(userId, limit = 100) {
  const { data, error } = await supabase.from('user_notifications').select(SELECT)
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}
export async function fetchNotification(id) {
  const { data } = await supabase.from('user_notifications').select(SELECT).eq('id', id).maybeSingle();
  return data;
}
export const markRead = async (ids) => { const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids || null }); if (error) throw error; };
export async function deleteNotification(id) { const { error } = await supabase.from('user_notifications').delete().eq('id', id); if (error) throw error; }

export function subscribeNotifications(userId, onInsert, onChange) {
  const ch = supabase.channel(`notif:${userId}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${userId}` }, (p) => onInsert && onInsert(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${userId}` }, () => onChange && onChange())
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'user_notifications' }, () => onChange && onChange())
    .subscribe();
  return () => supabase.removeChannel(ch);
}
