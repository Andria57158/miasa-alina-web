// src/hooks/useCart.js — panier d'articles (un par utilisateur, gardé sur l'appareil jusqu'à « Acheter »).
import { useCallback, useEffect, useState } from 'react';

const keyOf = (uid) => `vip_cart_v2_${uid || 'anon'}`;
const read = (uid) => { try { return JSON.parse(localStorage.getItem(keyOf(uid))) || []; } catch { return []; } };

export default function useCart(userId) {
  const [items, setItems] = useState(() => read(userId));
  useEffect(() => { setItems(read(userId)); }, [userId]);
  useEffect(() => {
    const onStorage = (e) => { if (e.key === keyOf(userId)) setItems(read(userId)); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [userId]);

  const commit = useCallback((next) => {
    setItems(next);
    try { localStorage.setItem(keyOf(userId), JSON.stringify(next)); } catch { /* ignore */ }
  }, [userId]);

  // evt = publication ; ajoute (ou cumule) un article, sans dépasser le stock connu
  const add = (evt, qty) => {
    const max = evt.stock == null ? Infinity : Number(evt.stock);
    const found = items.find((i) => String(i.eventId) === String(evt.id));
    const q = Math.min(max, (found ? found.qty : 0) + qty);
    const line = { eventId: evt.id, title: evt.title, image: evt.image || null, unitPrice: Number(evt.price) || 0, qty: q, max: evt.stock };
    commit(found ? items.map((i) => (i === found ? line : i)) : [...items, line]);
  };
  const setQty = (eventId, qty) => commit(items.map((i) => (String(i.eventId) === String(eventId)
    ? { ...i, qty: Math.max(1, Math.min(i.max == null ? Infinity : Number(i.max), qty)) } : i)));
  const remove = (eventId) => commit(items.filter((i) => String(i.eventId) !== String(eventId)));
  const clear = () => commit([]);
  const total = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  return { items, add, setQty, remove, clear, total, count: items.reduce((n, i) => n + i.qty, 0) };
}
