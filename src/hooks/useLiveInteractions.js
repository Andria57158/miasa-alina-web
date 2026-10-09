// src/hooks/useLiveInteractions.js
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadInteractions, sendInteraction, subscribeInteractions, LIVE_REACTIONS } from '../services/liveInteractions';

/**
 * @param onReaction (emoji) => void   déclenche l'animation flottante
 * Remarque : la table est écoutée en continu ; l'historique est rechargé à l'arrivée d'un spectateur.
 */
export default function useLiveInteractions({ storyId, userId, onReaction }) {
  const [comments, setComments] = useState([]);
  const [counts, setCounts] = useState({});
  const cb = useRef(onReaction); cb.current = onReaction;
  const seen = useRef(new Set());

  useEffect(() => {
    if (!storyId) return undefined;
    seen.current = new Set(); setComments([]); setCounts({});
    const apply = (row, animate) => {
      if (seen.current.has(row.id)) return;
      seen.current.add(row.id);
      if (row.kind === 'comment') setComments((l) => [...l, row].slice(-300));
      else if (LIVE_REACTIONS.includes(row.emoji)) {
        setCounts((c) => ({ ...c, [row.emoji]: (c[row.emoji] || 0) + 1 }));
        if (animate) cb.current?.(row.emoji);
      }
    };
    const unsub = subscribeInteractions(storyId, (row) => apply(row, true));
    loadInteractions(storyId).then((rows) => rows.forEach((r) => apply(r, false))).catch(() => {});
    return unsub;
  }, [storyId]);

  const lastReaction = useRef(0);
  const sendReaction = useCallback((emoji) => {
    const now = Date.now();
    if (now - lastReaction.current < 150) return;               // anti-mitraillage
    lastReaction.current = now;
    sendInteraction({ storyId, userId, kind: 'reaction', emoji }).catch(() => {});
  }, [storyId, userId]);

  const sendComment = useCallback((body) => {
    if (!body?.trim()) return false;
    sendInteraction({ storyId, userId, kind: 'comment', body }).catch((e) => alert(e.message));
    return true;
  }, [storyId, userId]);

  return { comments, counts, sendReaction, sendComment };
}
