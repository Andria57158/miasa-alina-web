// src/hooks/useLiveChannel.js
// Temps réel du live (Supabase Realtime « Broadcast » + « Presence ») :
//   • réactions      → s'affichent sur l'écran de celui qui fait le live (et des spectateurs)
//   • commentaires   → même fonctionnement que ceux de la page musique : réponses, j'aime, modifier, supprimer
//   • spectateurs    → nombre de personnes présentes
// Rien n'est stocké en base : le live est éphémère. L'hôte renvoie l'historique aux nouveaux arrivants.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { supabase as defaultClient } from '../supabaseClient';

export const LIVE_REACTIONS = ['👍', '🔥', '❤️', '👎'];
const MAX_COMMENTS = 300;
const MAX_TEXT = 500;

export const emptyLiveState = { comments: [], counts: {} };

const uid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const hhmm = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const mapComment = (state, id, parentId, fn) => ({
  ...state,
  comments: state.comments.map((c) => {
    if (parentId) return c.id === parentId ? { ...c, replies: c.replies.map((r) => (r.id === id ? fn(r) : r)) } : c;
    return c.id === id ? fn(c) : c;
  }),
});

export function liveReducer(state, action) {
  switch (action.type) {
    case 'reset':
      return emptyLiveState;
    case 'reaction':
      return { ...state, counts: { ...state.counts, [action.emoji]: (state.counts[action.emoji] || 0) + 1 } };
    case 'comment': {
      const c = action.comment;
      if (!c || !c.id) return state;
      if (c.parentId) {
        return {
          ...state,
          comments: state.comments.map((p) =>
            p.id === c.parentId && !p.replies.some((r) => r.id === c.id) ? { ...p, replies: [...p.replies, { ...c, likes: c.likes || [] }] } : p),
        };
      }
      if (state.comments.some((p) => p.id === c.id)) return state;
      return { ...state, comments: [...state.comments, { ...c, likes: c.likes || [], replies: c.replies || [] }].slice(-MAX_COMMENTS) };
    }
    case 'like': {
      const { id, parentId, userId, on } = action;
      return mapComment(state, id, parentId, (c) => {
        const has = c.likes.includes(userId);
        if (on && !has) return { ...c, likes: [...c.likes, userId] };
        if (!on && has) return { ...c, likes: c.likes.filter((u) => u !== userId) };
        return c;
      });
    }
    case 'edit':
      return mapComment(state, action.id, action.parentId, (c) => ({ ...c, text: action.text, edited: true }));
    case 'delete':
      if (action.parentId) {
        return { ...state, comments: state.comments.map((c) => (c.id === action.parentId ? { ...c, replies: c.replies.filter((r) => r.id !== action.id) } : c)) };
      }
      return { ...state, comments: state.comments.filter((c) => c.id !== action.id) };
    case 'snapshot': {
      const known = new Set(state.comments.map((c) => c.id));
      const merged = [...state.comments, ...(action.comments || []).filter((c) => !known.has(c.id))]
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(-MAX_COMMENTS);
      const counts = { ...state.counts };
      Object.entries(action.counts || {}).forEach(([k, v]) => { counts[k] = Math.max(counts[k] || 0, v); });
      return { comments: merged, counts };
    }
    default:
      return state;
  }
}

/**
 * @param me  { id, pseudo, avatar }  (objet stable : useMemo)
 */
export function useLiveChannel({ storyId, me, isHost, client = defaultClient, onReaction, onEnd }) {
  const [state, dispatch] = useReducer(liveReducer, emptyLiveState);
  const [viewers, setViewers] = useState(0);
  const [ended, setEnded] = useState(false);
  const [connected, setConnected] = useState(false);
  const chRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const cb = useRef({});
  cb.current = { onReaction, onEnd };
  const lastReaction = useRef(0);

  useEffect(() => {
    if (!storyId || !client?.channel) return undefined;
    dispatch({ type: 'reset' });
    setEnded(false); setViewers(0); setConnected(false);
    const ch = client.channel(`live:${storyId}`, { config: { broadcast: { self: true }, presence: { key: me.id } } });
    chRef.current = ch;
    ch.on('broadcast', { event: 'reaction' }, ({ payload }) => {
      if (!LIVE_REACTIONS.includes(payload?.emoji)) return;
      dispatch({ type: 'reaction', emoji: payload.emoji });
      cb.current.onReaction?.(payload);
    })
      .on('broadcast', { event: 'comment' }, ({ payload }) => dispatch({ type: 'comment', comment: payload }))
      .on('broadcast', { event: 'like' }, ({ payload }) => dispatch({ type: 'like', ...payload }))
      .on('broadcast', { event: 'edit' }, ({ payload }) => dispatch({ type: 'edit', ...payload }))
      .on('broadcast', { event: 'delete' }, ({ payload }) => dispatch({ type: 'delete', ...payload }))
      .on('broadcast', { event: 'hello' }, () => {
        if (isHost) ch.send({ type: 'broadcast', event: 'snapshot', payload: { comments: stateRef.current.comments, counts: stateRef.current.counts } });
      })
      .on('broadcast', { event: 'snapshot' }, ({ payload }) => { if (!isHost) dispatch({ type: 'snapshot', ...payload }); })
      .on('broadcast', { event: 'end' }, () => { setEnded(true); cb.current.onEnd?.(); })
      .on('presence', { event: 'sync' }, () => {
        const st = ch.presenceState();
        setViewers(Object.values(st).flat().filter((m) => !m.host).length);
      });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setConnected(true);
        ch.track({ pseudo: me.pseudo, host: !!isHost });
        if (!isHost) ch.send({ type: 'broadcast', event: 'hello', payload: { id: me.id } });
      }
    });
    return () => { chRef.current = null; client.removeChannel?.(ch); };
  }, [storyId, me.id, isHost, client]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((event, payload) => chRef.current?.send({ type: 'broadcast', event, payload }), []);

  const sendReaction = useCallback((emoji) => {
    const now = Date.now();
    if (now - lastReaction.current < 120) return; // anti-mitraillage
    lastReaction.current = now;
    send('reaction', { id: uid(), emoji, pseudo: me.pseudo, avatar: me.avatar });
  }, [send, me.pseudo, me.avatar]);

  const sendComment = useCallback(({ text = '', parentId = null, sticker = false, image = null }) => {
    const clean = String(text).trim().slice(0, MAX_TEXT);
    if (!clean && !image) return false;
    send('comment', {
      id: uid(), parentId, authorId: me.id, pseudo: me.pseudo, avatar: me.avatar,
      text: clean, sticker: !!sticker, image: image || null, timestamp: hhmm(), createdAt: Date.now(), likes: [], replies: [],
    });
    return true;
  }, [send, me.id, me.pseudo, me.avatar]);

  const toggleLike = useCallback((id, parentId, currentlyLiked) =>
    send('like', { id, parentId: parentId || null, userId: me.id, on: !currentlyLiked }), [send, me.id]);
  const editComment = useCallback((id, parentId, text) =>
    send('edit', { id, parentId: parentId || null, text: String(text).trim().slice(0, MAX_TEXT) }), [send]);
  const deleteComment = useCallback((id, parentId) => send('delete', { id, parentId: parentId || null }), [send]);
  const announceEnd = useCallback(() => send('end', {}), [send]);

  return { comments: state.comments, counts: state.counts, viewers, ended, connected, sendReaction, sendComment, toggleLike, editComment, deleteComment, announceEnd };
}
