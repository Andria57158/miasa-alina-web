// src/components/LiveStage.jsx
// Habillage d'un live façon Facebook Live — RÉEL : commentaires et réactions sont enregistrés
// dans Supabase (tables comments et live_reactions) puis diffusés en temps réel à tous les spectateurs.
// Le nombre de spectateurs vient de la présence réelle. Voir story_engagement.sql.
import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import './LiveStage.css';

const REACTS = [
  { k: 'heart', icon: 'fa-heart', color: '#e4405f' },
  { k: 'like', icon: 'fa-thumbs-up', color: '#1877f2' },
  { k: 'fire', icon: 'fa-fire', color: '#ff9500' },
];
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')}k` : String(n));
const plain = (t) => String(t || '').replace(/<[^>]*>/g, '').trim();
const AVATAR = 'https://randomuser.me/api/portraits/lego/1.jpg';

const LiveStage = ({ story, me, isHost, hostStream, onEnd, children }) => {
  const [viewers, setViewers] = useState(1);
  const [chat, setChat] = useState([]);
  const [floaters, setFloaters] = useState([]);
  const [text, setText] = useState('');
  const [, setTick] = useState(0);            // fait disparaître les vieux commentaires
  const [heartCount, setHeartCount] = useState(0);
  const [host, setHost] = useState({ cam: true, mic: true });
  const chRef = useRef(null);
  const alive = useRef(true);
  const tabKey = useRef(Math.random().toString(36).slice(2));
  const ready = !!(story?.remote && me?.id);  // un live enregistré en base + utilisateur connecté

  const pop = (k) => {
    const f = { id: `${Date.now()}${Math.random()}`, k, x: Math.round(Math.random() * 40), sway: Math.round(Math.random() * 70 - 35) };
    setFloaters(prev => [...prev.slice(-24), f]);
    setTimeout(() => { if (alive.current) setFloaters(prev => prev.filter(x => x.id !== f.id)); }, 3200);
  };
  const addMsg = (m) => setChat(prev => (prev.some(p => p.id === m.id) ? prev : [...prev.slice(-20), m]));
  const fromRow = (r) => ({ id: `db${r.id}`, pseudo: r.pseudo, avatar: r.avatar_url, text: plain(r.text), t: Date.now() });

  useEffect(() => {
    alive.current = true;
    if (!story?.id) return undefined;
    const filter = `story_id=eq.${story.id}`;
    const ch = supabase.channel(`live-${story.id}`, { config: { broadcast: { self: true }, presence: { key: tabKey.current } } });
    ch.on('presence', { event: 'sync' }, () => setViewers(Math.max(1, Object.keys(ch.presenceState()).length)))
      // commentaires : lignes insérées dans la table comments (donc réelles et conservées)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments', filter }, ({ new: r }) => {
        if (r.parent_id || !plain(r.text)) return;
        addMsg(fromRow(r));
      })
      // réactions : lignes insérées dans live_reactions
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_reactions', filter }, ({ new: r }) => {
        setHeartCount(c => c + 1);
        if (r.user_id !== me?.id) pop(r.type);          // les miennes sont déjà animées au clic
      })
      .on('broadcast', { event: 'host' }, ({ payload }) => setHost(payload))
      .subscribe(async (status) => { if (status === 'SUBSCRIBED') await ch.track({ id: me?.id || null }); });
    chRef.current = ch;

    // état de départ, lu dans la base : total des réactions + commentaires de la dernière minute
    supabase.from('live_reactions').select('id', { count: 'exact', head: true }).eq('story_id', story.id)
      .then(({ count }) => { if (alive.current) setHeartCount(count || 0); }, () => {});
    supabase.from('comments').select('id, pseudo, avatar_url, text, created_at, parent_id').eq('story_id', story.id)
      .order('created_at', { ascending: false }).limit(5).then(({ data }) => {
        if (!alive.current || !data) return;
        data.filter(r => !r.parent_id && plain(r.text) && Date.now() - Date.parse(r.created_at) < 60000)
          .reverse().forEach(r => addMsg(fromRow(r)));
      }, () => {});

    const tick = setInterval(() => setTick(n => n + 1), 2000);
    return () => { alive.current = false; clearInterval(tick); supabase.removeChannel(ch); chRef.current = null; };
  }, [story?.id]); // eslint-disable-line

  const sendReaction = async (k) => {
    if (!ready) return;
    pop(k); setTimeout(() => pop(k), 140); setTimeout(() => pop(k), 280);   // rafale visuelle
    setHeartCount(c => c + 1);
    const { error } = await supabase.from('live_reactions').insert({ story_id: story.id, user_id: me.id, type: k });
    if (error) { setHeartCount(c => Math.max(0, c - 1)); console.error('Réaction live :', error); alert('Réaction non enregistrée : ' + error.message); }
  };

  const sendChat = async () => {
    const t = text.trim().slice(0, 200);
    if (!t || !ready) return;
    const { data, error } = await supabase.from('comments')
      .insert({ story_id: story.id, author_id: me.id, pseudo: me.pseudo, avatar_url: me.avatar, text: t })
      .select().single();
    if (error) { alert('Commentaire non envoyé : ' + error.message); return; }
    addMsg(fromRow(data));     // affiché tout de suite chez moi ; les autres le reçoivent en temps réel
    setText('');
  };

  const toggle = (kind) => {
    if (!hostStream) return;
    const tracks = kind === 'cam' ? hostStream.getVideoTracks() : hostStream.getAudioTracks();
    const next = !host[kind];
    tracks.forEach(t => { t.enabled = next; });
    const state = { ...host, [kind]: next };
    setHost(state);
    chRef.current?.send({ type: 'broadcast', event: 'host', payload: state });
  };

  return (
    <div className="live-stage">
      <div className="live-base">{children}</div>

      <div className="live-top">
        <span className="live-tag">LIVE</span>
        <span className="live-views"><i className="fas fa-eye"></i> {fmt(viewers)}</span>
        {heartCount > 0 && <span className="live-views"><i className="fas fa-heart" style={{ color: '#e4405f' }}></i> {fmt(heartCount)}</span>}
        {!host.cam && <span className="live-pill"><i className="fas fa-video-slash"></i> Caméra coupée</span>}
        {!host.mic && <span className="live-pill"><i className="fas fa-microphone-slash"></i> Micro coupé</span>}
      </div>

      {isHost && (
        <div className="live-host">
          {hostStream && (
            <>
              <button className={host.cam ? '' : 'off'} onClick={() => toggle('cam')} title={host.cam ? 'Couper la caméra' : 'Activer la caméra'}>
                <i className={`fas ${host.cam ? 'fa-video' : 'fa-video-slash'}`}></i>
              </button>
              <button className={host.mic ? '' : 'off'} onClick={() => toggle('mic')} title={host.mic ? 'Couper le micro' : 'Activer le micro'}>
                <i className={`fas ${host.mic ? 'fa-microphone' : 'fa-microphone-slash'}`}></i>
              </button>
            </>
          )}
          <button className="end" onClick={onEnd}><i className="fas fa-stop-circle"></i> Terminer</button>
        </div>
      )}

      <div className="live-floaters" aria-hidden="true">
        {floaters.map(f => {
          const r = REACTS.find(x => x.k === f.k) || REACTS[0];
          return (
            <span key={f.id} className="live-floater" style={{ background: r.color, right: `${12 + f.x}px`, '--sway': `${f.sway}px` }}>
              <i className={`fas ${r.icon}`}></i>
            </span>
          );
        })}
      </div>

      <div className="live-chat">
        {chat.filter(c => Date.now() - (c.t || 0) < 20000).slice(-5).map(c => (
          <div key={c.id} className="live-msg">
            <img src={c.avatar || AVATAR} alt="" />
            <div><b>{c.pseudo}</b><span>{c.text}</span></div>
          </div>
        ))}
      </div>

      <div className="live-bottom">
        <input type="text" value={text} maxLength={200} disabled={!ready}
          placeholder={ready ? 'Ajouter un commentaire...' : 'Disponible une fois le live enregistré'}
          onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} />
        <button className="live-send" onClick={sendChat} disabled={!ready} title="Envoyer"><i className="fas fa-paper-plane"></i></button>
        {REACTS.map(r => (
          <button key={r.k} className="live-react" onClick={() => sendReaction(r.k)} disabled={!ready} title="Réagir">
            <i className={`fas ${r.icon}`} style={{ color: r.color }}></i>
          </button>
        ))}
      </div>
    </div>
  );
};
export default LiveStage;
