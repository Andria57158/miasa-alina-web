// src/hooks/useDirectMessages.js
// Messagerie privée entre amis, enregistrée dans Supabase (table public.direct_messages).
// Avant : les messages restaient dans le state React du navigateur de l'expéditeur
// → ils n'arrivaient jamais chez le destinataire.
//
// RÈGLE MÉTIER : les messages expirent après 7 jours (nettoyage SQL via pg_cron).
// Ce hook filtre aussi côté client pour que les vieux messages disparaissent
// immédiatement de l'affichage, sans attendre le passage du cron.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
const isExpired = (iso) => Date.now() - new Date(iso).getTime() > SEVEN_DAYS_MS;

const byDate = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const previewOf = (m) => {
  if (m.text && m.text.trim()) return m.text;
  if (m.attachment) {
    if (m.attachment.type === 'audio') return '🎤 Message vocal';
    if (m.attachment.type === 'image') return '📷 Photo';
    return '📎 Fichier';
  }
  return '';
};

export default function useDirectMessages(myId, nameOf) {
  const [rows, setRows] = useState([]);
  const [cleared, setCleared] = useState({});          // { [idAmi]: date ISO } → historique masqué chez moi
  const nameOfRef = useRef(nameOf);
  nameOfRef.current = nameOf;
  const rowsRef = useRef([]);
  rowsRef.current = rows;

  // « Vider la conversation » = masquer chez moi (ça ne supprime pas chez l'autre personne)
  useEffect(() => {
    if (!myId) { setCleared({}); return; }
    try { setCleared(JSON.parse(localStorage.getItem(`dm_cleared_${myId}`) || '{}')); } catch { setCleared({}); }
  }, [myId]);

  useEffect(() => {
    if (!myId) { setRows([]); return undefined; }
    let alive = true;

    // Filtre 7 jours : on ignore tout message plus vieux (le cron SQL s'en charge aussi côté base)
    const keepFresh = (list) => (list || []).filter((r) => r._pending || !isExpired(r.created_at));

    const merge = (incoming) => setRows((prev) => {
      const map = new Map(prev.filter((r) => !r._pending).map((r) => [r.id, r]));
      incoming.forEach((r) => map.set(r.id, r));
      const pending = prev.filter((r) => r._pending);
      // On refiltre 7 jours après chaque fusion (au cas où un ancien message arriverait par le Realtime)
      return keepFresh([...map.values(), ...pending]).sort(byDate);
    });

    const load = async () => {
      // On ne charge QUE les 7 derniers jours depuis Supabase (économie de bande passante)
      const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
      const { data, error } = await supabase
        .from('direct_messages').select('*')
        .or(`sender_id.eq.${myId},receiver_id.eq.${myId}`)
        .gte('created_at', since)
        .order('created_at', { ascending: true }).limit(1000);
      if (!alive) return;
      if (error) { console.error('Chargement des messages :', error); return; }
      setRows((prev) => {
        const ids = new Set((data || []).map((r) => r.id));
        const pending = prev.filter((r) => r._pending && !ids.has(r.id));
        return keepFresh([...(data || []), ...pending]).sort(byDate);
      });
    };
    load();

    // Temps réel : un message reçu apparaît tout de suite
    const channel = supabase.channel(`dm-${myId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_messages' }, (p) => {
        if (p.eventType === 'DELETE') {
          setRows((prev) => prev.filter((r) => r.id !== p.old.id));
          return;
        }
        const r = p.new;
        if (r.sender_id !== myId && r.receiver_id !== myId) return;
        merge([r]);
      })
      .subscribe();

    // Filet de sécurité si le temps réel n'est pas activé sur la table
    const poll = setInterval(load, 10000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);

    // Balayage local : toutes les 5 min, on retire de l'écran les messages devenus trop vieux
    // (utile si l'utilisateur laisse l'app ouverte pendant plusieurs heures)
    const sweep = setInterval(() => {
      setRows((prev) => {
        const fresh = prev.filter((r) => r._pending || !isExpired(r.created_at));
        return fresh.length === prev.length ? prev : fresh;
      });
    }, 5 * 60 * 1000);

    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(sweep);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [myId]);

  const threads = useMemo(() => {
    const out = {};
    rows.forEach((r) => {
      if (!r._pending && isExpired(r.created_at)) return;   // sécurité supplémentaire
      const mine = r.sender_id === myId;
      const other = mine ? r.receiver_id : r.sender_id;
      if (cleared[other] && r.created_at <= cleared[other]) return;
      const rt = r.reply_to;
      const msg = {
        id: r.id,
        sender: mine ? 'me' : other,
        text: r.text || '',
        time: timeOf(r.created_at),
        createdAt: r.created_at,
        attachment: r.attachment || null,
        forwarded: !!r.forwarded,
        readAt: r.read_at,
        pending: !!r._pending,
        replyTo: rt ? {
          sender: rt.sender_id === myId ? 'me' : ((nameOfRef.current && nameOfRef.current(rt.sender_id)) || 'Contact'),
          text: rt.text || '',
        } : null,
      };
      if (!out[other]) out[other] = { messages: [], lastMsg: '' };
      out[other].messages.push(msg);
    });
    Object.values(out).forEach((t) => {
      const last = t.messages[t.messages.length - 1];
      t.lastMsg = last ? previewOf(last) : '';
    });
    return out;
  }, [rows, myId, cleared]);

  // Envoi : affichage immédiat, puis enregistrement en base (le destinataire le reçoit en temps réel)
  const send = useCallback(async (toId, { text = '', attachment = null, replyTo = null, forwarded = false } = {}) => {
    if (!myId) throw new Error('Vous n\'êtes pas connecté.');
    if (!toId) throw new Error('Destinataire inconnu.');
    const temp = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sender_id: myId, receiver_id: toId, text, attachment, reply_to: replyTo, forwarded,
      created_at: new Date().toISOString(), read_at: null, _pending: true,
    };
    setRows((prev) => [...prev, temp]);
    const { data, error } = await supabase.from('direct_messages')
      .insert({ sender_id: myId, receiver_id: toId, text, attachment, reply_to: replyTo, forwarded })
      .select().single();
    if (error) {
      setRows((prev) => prev.filter((r) => r.id !== temp.id));
      throw error;
    }
    setRows((prev) => {
      const without = prev.filter((r) => r.id !== temp.id);
      return without.some((r) => r.id === data.id) ? without : [...without, data].sort(byDate);
    });
    return data;
  }, [myId]);

  // Supprimer un de MES messages (supprimé aussi chez l'autre)
  const remove = useCallback(async (msgId) => {
    if (String(msgId).startsWith('tmp-')) return;
    const { data, error } = await supabase.from('direct_messages').delete().eq('id', msgId).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Suppression refusée (exécutez sql/direct_messages_fix.sql).');
    setRows((prev) => prev.filter((r) => r.id !== msgId));
  }, []);

  // Vider la conversation chez moi
  const clear = useCallback((otherId) => {
    const last = rowsRef.current
      .filter((r) => r.sender_id === otherId || r.receiver_id === otherId)
      .reduce((m, r) => (r.created_at > m ? r.created_at : m), '');
    if (!last) return;
    setCleared((prev) => {
      const next = { ...prev, [otherId]: last };
      try { localStorage.setItem(`dm_cleared_${myId}`, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [myId]);

  // Marquer comme lus les messages reçus d'un ami
  const markRead = useCallback(async (otherId) => {
    if (!myId || !otherId) return;
    const unread = rowsRef.current.some((r) => r.receiver_id === myId && r.sender_id === otherId && !r.read_at && !r._pending);
    if (!unread) return;
    const now = new Date().toISOString();
    setRows((prev) => prev.map((r) => (r.receiver_id === myId && r.sender_id === otherId && !r.read_at ? { ...r, read_at: now } : r)));
    const { error } = await supabase.from('direct_messages').update({ read_at: now })
      .eq('receiver_id', myId).eq('sender_id', otherId).is('read_at', null);
    if (error) console.error('Marquer comme lu :', error);
  }, [myId]);

  return { threads, send, remove, clear, markRead };
}
