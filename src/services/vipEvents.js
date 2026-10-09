// src/services/vipEvents.js
// Publications VIP, stock, réactions et commentaires — tout est dans Supabase,
// donc identique pour l'admin et pour tous les clients.
import { supabase } from '../supabaseClient';

// ---------- Règles d'affichage ----------
// Billet : la publication est supprimée à la date/heure de l'événement, ou 3 h après sa publication si aucune date n'est indiquée.
export const isEventExpired = (e) =>
  e.type === 'billet' && !!e.expiresAt && new Date(e.expiresAt) <= new Date();

// Article, album ET billet : la publication disparaît (côté client) quand il n'y a plus rien à vendre
// (article = nombre d'articles à 0 ; billet / album = toutes les catégories à 0 place).
export const isOutOfStock = (e) => {
  if (e.type === 'article') return e.stock !== null && e.stock !== undefined && Number(e.stock) <= 0;
  if (e.type === 'album' || e.type === 'billet') return Array.isArray(e.tiers) && e.tiers.length > 0 && e.tiers.every(t => (Number(t.quantity) || 0) <= 0);
  return false;
};

export const isVisibleForClient = (e) => e.published !== false && !isEventExpired(e) && !isOutOfStock(e);

export const hiddenReason = (e) =>
  e.published === false ? '📝 Brouillon — appuyez sur « Publier » pour le montrer aux clients'
  : isEventExpired(e) ? '⏳ Événement passé — masqué pour les clients'
  : isOutOfStock(e) ? (e.type === 'billet' ? '🎟️ Complet (plus de places) — masqué pour les clients' : '📦 Rupture de stock — masqué pour les clients')
  : '';

// ---------- Publications ----------
const rowToEvent = (r) => ({
  id: Number(r.id),
  type: r.type,
  title: r.title,
  desc: r.descr || '',
  eventDate: r.event_date || null,
  eventTime: r.event_time || null,
  expiresAt: r.expires_at || null,
  date: new Date(r.event_date ? `${r.event_date}T00:00:00` : r.created_at).toLocaleDateString('fr-FR') + (r.event_time ? ` à ${r.event_time}` : ''),
  price: r.price,
  image: r.image,
  category: r.category,
  stock: r.stock === null || r.stock === undefined ? null : Number(r.stock),
  tiers: Array.isArray(r.tiers) ? r.tiers : [],
  published: r.published !== false,
  pseudo: r.pseudo,
  avatar: r.avatar,
  createdAt: r.created_at,
  authorId: r.author_id || null,
});

export const fetchEvents = async () => {
  const { data, error } = await supabase.from('vip_events').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToEvent);
};

export const createEventRow = async (evt) => {
  const { error } = await supabase.from('vip_events').insert({
    id: evt.id,
    type: evt.type,
    title: evt.title,
    descr: evt.desc || '',
    event_date: evt.eventDate || null,
    event_time: evt.eventTime || null,
    expires_at: evt.expiresAt || null,
    price: Number(evt.price) || 0,
    image: evt.image || null,
    category: evt.category || 'article',
    stock: evt.stock === null || evt.stock === undefined ? null : Number(evt.stock),
    tiers: evt.tiers || [],
    published: !!evt.published,
    pseudo: evt.pseudo,
    avatar: evt.avatar,
    author_id: evt.authorId || null,
  });
  if (error) throw error;
};

// Admin : publier / retirer une publication, ajuster le stock d'un article
export const setPublished = async (id, published) => {
  const { error } = await supabase.from('vip_events').update({ published }).eq('id', id);
  if (error) throw error;
};
export const setArticleStock = async (id, stock) => {
  const { error } = await supabase.from('vip_events').update({ stock: Number(stock) }).eq('id', id);
  if (error) throw error;
};


// Seul l'auteur d'une publication peut la modifier ou la supprimer.
// Contrôle côté interface ICI + contrôle réel côté base (RLS : voir vip_events_ownership.sql).
export const isOwner = (evt, userId) => !!userId && !!evt && evt.authorId === userId;

export const updateEventRow = async (id, userId, patch) => {
  const row = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.desc !== undefined) row.descr = patch.desc;
  if (patch.price !== undefined) row.price = Number(patch.price) || 0;
  if (patch.image !== undefined) row.image = patch.image || null;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.stock !== undefined) row.stock = patch.stock === null || patch.stock === '' ? null : Number(patch.stock);
  if (patch.tiers !== undefined) row.tiers = patch.tiers;
  if (patch.eventDate !== undefined) row.event_date = patch.eventDate || null;
  if (patch.eventTime !== undefined) row.event_time = patch.eventTime || null;
  if (patch.expiresAt !== undefined) row.expires_at = patch.expiresAt || null;
  const { data, error } = await supabase.from('vip_events').update(row).eq('id', id).eq('author_id', userId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Vous n'êtes pas l'auteur de cette publication.");
};

export const deleteEventRow = async (id, userId) => {
  const { data, error } = await supabase.from('vip_events').delete().eq('id', id).eq('author_id', userId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Vous n'êtes pas l'auteur de cette publication.");
};

// Supprime définitivement les ventes de billets dont la date est passée (ou > 3 h sans date)
export const purgeExpiredEvents = async () => {
  const { error } = await supabase.rpc('vip_purge_expired');
  if (error) throw error;
};

// Décrément atomique du stock côté serveur (échoue si le stock est insuffisant ou l'événement passé)
export const buyStock = async ({ eventId, tierId, qty }) => {
  const { error } = await supabase.rpc('vip_buy_stock', { p_event: eventId, p_tier: tierId ?? null, p_qty: qty });
  if (error) throw new Error(error.message);
};

let chanSeq = 0;
const listen = (tables, cb, filter) => {
  const ch = supabase.channel(`vip-${tables.join('-')}-${Date.now()}-${chanSeq++}`);
  tables.forEach((t) => ch.on('postgres_changes', { event: '*', schema: 'public', table: t, ...(filter && filter[t] ? { filter: filter[t] } : {}) }, () => cb()));
  ch.subscribe();
  return () => { supabase.removeChannel(ch); };
};

export const subscribeEvents = (cb) => listen(['vip_events'], cb);

// ---------- Réactions 🔥 + compteurs de commentaires ----------
export const fetchEngagement = async (userId) => {
  const [r, c] = await Promise.all([
    supabase.from('vip_event_reactions').select('event_id,user_id').eq('kind', 'fire'),
    supabase.from('vip_event_comments').select('event_id'),
  ]);
  if (r.error) throw r.error;
  if (c.error) throw c.error;
  const fire = {}; const mine = {}; const comments = {};
  (r.data || []).forEach((x) => { fire[x.event_id] = (fire[x.event_id] || 0) + 1; if (x.user_id === userId) mine[x.event_id] = true; });
  (c.data || []).forEach((x) => { comments[x.event_id] = (comments[x.event_id] || 0) + 1; });
  return { fire, mine, comments };
};

export const toggleFire = async (eventId, userId, alreadyOn) => {
  const q = alreadyOn
    ? supabase.from('vip_event_reactions').delete().match({ event_id: eventId, user_id: userId, kind: 'fire' })
    : supabase.from('vip_event_reactions').insert({ event_id: eventId, user_id: userId, kind: 'fire' });
  const { error } = await q;
  if (error) throw error;
};

export const subscribeEngagement = (cb) => listen(['vip_event_reactions', 'vip_event_comments'], cb);

// ---------- Commentaires d'une publication ----------
export const fetchComments = async (eventId, userId) => {
  const { data, error } = await supabase.from('vip_event_comments').select('*').eq('event_id', eventId).order('created_at', { ascending: true });
  if (error) throw error;
  const rows = data || [];
  let likes = [];
  if (rows.length) {
    const l = await supabase.from('vip_event_comment_likes').select('comment_id,user_id').in('comment_id', rows.map(r => r.id));
    if (!l.error) likes = l.data || [];
  }
  const toItem = (r) => ({
    id: r.id,
    authorId: r.author_id,
    pseudo: r.pseudo || 'Membre',
    avatar: r.avatar || 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
    text: r.body,
    timestamp: new Date(r.created_at).toLocaleString('fr-FR'),
    likes: likes.filter(x => x.comment_id === r.id).length,
    userLiked: likes.some(x => x.comment_id === r.id && x.user_id === userId),
    replies: [],
  });
  const tops = rows.filter(r => !r.parent_id).map(toItem).reverse();          // plus récent en haut
  const byId = Object.fromEntries(tops.map(t => [t.id, t]));
  rows.filter(r => r.parent_id).forEach((r) => { if (byId[r.parent_id]) byId[r.parent_id].replies.push(toItem(r)); });
  return tops;
};

export const addComment = async ({ eventId, parentId, authorId, pseudo, avatar, body }) => {
  const { error } = await supabase.from('vip_event_comments').insert({
    event_id: eventId, parent_id: parentId || null, author_id: authorId, pseudo, avatar, body,
  });
  if (error) throw error;
};

export const removeComment = async (id) => {
  const { error } = await supabase.from('vip_event_comments').delete().eq('id', id);
  if (error) throw error;
};

export const toggleCommentLike = async (commentId, userId, alreadyLiked) => {
  const q = alreadyLiked
    ? supabase.from('vip_event_comment_likes').delete().match({ comment_id: commentId, user_id: userId })
    : supabase.from('vip_event_comment_likes').insert({ comment_id: commentId, user_id: userId });
  const { error } = await q;
  if (error) throw error;
};

export const subscribeComments = (_eventId, cb) => listen(['vip_event_comments', 'vip_event_comment_likes'], cb);
