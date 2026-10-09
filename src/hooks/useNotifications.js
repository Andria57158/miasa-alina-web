// src/hooks/useNotifications.js — liste + compteur « non lues » + notification qui vient d'arriver (pour la bulle).
import { useCallback, useEffect, useRef, useState } from 'react';
import { listNotifications, fetchNotification, markRead, deleteNotification, subscribeNotifications } from '../services/notifications';

export default function useNotifications(userId) {
  const [items, setItems] = useState([]);
  const [latest, setLatest] = useState(null);      // dernière notification reçue en direct (bulle)
  const alive = useRef(true);

  const refresh = useCallback(() => {
    if (!userId) return;
    listNotifications(userId).then((d) => { if (alive.current) setItems(d); }).catch(() => {});
  }, [userId]);

  useEffect(() => {
    alive.current = true;
    if (!userId) { setItems([]); return undefined; }
    refresh();
    const off = subscribeNotifications(userId, async (row) => {
      const full = (await fetchNotification(row.id).catch(() => null)) || row;
      if (!alive.current) return;
      setItems((p) => (p.some((n) => n.id === full.id) ? p : [full, ...p]));
      setLatest(full);
    }, refresh);
    const timer = setInterval(refresh, 30000);                      // filet de sécurité si le temps réel est coupé
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive.current = false; off(); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [userId, refresh]);

  const unread = items.filter((n) => !n.read_at).length;
  const read = async (ids) => {
    const now = new Date().toISOString();
    setItems((p) => p.map((n) => (!ids || ids.includes(n.id) ? { ...n, read_at: n.read_at || now } : n)));
    try { await markRead(ids); } catch { refresh(); }
  };
  const remove = async (id) => { setItems((p) => p.filter((n) => n.id !== id)); try { await deleteNotification(id); } catch { refresh(); } };
  return { items, unread, latest, clearLatest: () => setLatest(null), markRead: read, remove, refresh };
}
