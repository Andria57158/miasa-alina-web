// src/services/friends.js
// Étape 2 — demandes d'ami : pending → accepted. L'onglet « Amis » affiche le statut réel.
import { supabase } from '../supabaseClient';

// Liste des membres + statut de relation vis-à-vis de moi :
//   'none' | 'sent' (j'ai envoyé, en attente) | 'received' (à accepter) | 'friend'
export async function listMembersWithStatus(myId) {
  const [{ data: users, error: e1 }, { data: rels, error: e2 }] = await Promise.all([
    supabase.from('users').select('id, username, photo_url').neq('id', myId).order('username'),
    supabase.from('friendships').select('id, requester_id, addressee_id, status'),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const byOther = new Map(rels.map((r) => [r.requester_id === myId ? r.addressee_id : r.requester_id, r]));
  return users.map((u) => {
    const r = byOther.get(u.id);
    let status = 'none';
    if (r) status = r.status === 'accepted' ? 'friend' : r.requester_id === myId ? 'sent' : 'received';
    return { id: u.id, name: u.username || 'Membre', avatar: u.photo_url, status, relationId: r?.id || null,
             isFriend: status === 'friend' };
  });
}

export async function sendFriendRequest(myId, otherId) {
  const { error } = await supabase.from('friendships').insert({ requester_id: myId, addressee_id: otherId, status: 'pending' });
  if (error) throw new Error(error.code === '23505' ? 'Une relation existe déjà avec ce membre.' : error.message);
}

export async function acceptFriendRequest(relationId) {
  const { error } = await supabase.from('friendships')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', relationId);
  if (error) throw new Error(error.message);
}

// Retirer un ami, annuler ma demande ou refuser une demande reçue
export async function removeRelation(relationId) {
  const { error } = await supabase.from('friendships').delete().eq('id', relationId);
  if (error) throw new Error(error.message);
}

export function subscribeFriendships(onChange) {
  const ch = supabase.channel('friendships-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(ch);
}
