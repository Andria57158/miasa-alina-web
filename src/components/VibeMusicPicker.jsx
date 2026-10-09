// src/components/VibeMusicPicker.jsx
// Parcours Vibe : 1) choisir un morceau de la page Musique  2) choisir le passage (40 s max).
// Exporte aussi VibePlayer : lit la vidéo du Vibe en même temps que le passage choisi.
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';

export const VIBE_MAX = 40; // durée maximale d'un Vibe, en secondes
const VIBE_MIN = 5;

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------- Lecteur : vidéo (muette) + passage de la musique, en boucle ----------
export const VibePlayer = ({ url, music, id, className = 'story-media', style }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !music || !music.src) return undefined;
    const start = Number(music.start) || 0;
    const end = start + (Number(music.length) || VIBE_MAX);
    const audio = new Audio(music.src);
    audio.preload = 'auto';

    const syncAndPlay = () => {
      const t = start + Math.min(v.currentTime || 0, end - start);
      if (Math.abs(audio.currentTime - t) > 0.3) audio.currentTime = t;
      audio.play().catch(() => { /* lecture bloquée par le navigateur : la vidéo continue */ });
    };
    const onPause = () => audio.pause();
    const onEnded = () => { v.currentTime = 0; v.play().catch(() => {}); };
    const onAudioTime = () => {
      if (audio.currentTime >= end) {              // fin du passage : on reboucle les deux
        audio.currentTime = start;
        v.currentTime = 0;
        if (v.paused) v.play().catch(() => {});
      }
    };

    v.addEventListener('play', syncAndPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onAudioTime);
    if (!v.paused) syncAndPlay(); // la vidéo a déjà démarré (autoPlay)

    return () => {
      v.removeEventListener('play', syncAndPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onAudioTime);
      audio.pause();
      audio.src = '';
    };
  }, [url, music && music.src, music && music.start, music && music.length]);

  return <video ref={videoRef} id={id} src={url} className={className} style={style} autoPlay playsInline muted />;
};

// ---------- Sélecteur : morceau puis passage ----------
const box = { maxHeight: '88vh', overflowY: 'auto', width: 'min(94vw, 460px)' };
const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 6px', borderRadius: 10 };
const coverStyle = { width: 44, height: 44, borderRadius: 8, objectFit: 'cover', background: '#222', flexShrink: 0 };

const VibeMusicPicker = ({ onCancel, onConfirm }) => {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const [selected, setSelected] = useState(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(VIBE_MAX);
  const [previewing, setPreviewing] = useState(false);

  const audioRef = useRef(null);
  const seg = useRef({ start: 0, length: VIBE_MAX });

  // Morceaux de la page Musique (mêmes tables Supabase)
  useEffect(() => {
    let off = false;
    (async () => {
      const [s, a] = await Promise.all([
        supabase.from('songs').select('id, title, artist, album_id, audio_url, duration')
          .order('album_id', { ascending: true }).order('position', { ascending: true }),
        supabase.from('albums').select('id, cover_url'),
      ]);
      if (off) return;
      if (s.error) { setError('Impossible de charger la musique : ' + s.error.message); setLoading(false); return; }
      const covers = {};
      (a.data || []).forEach(x => { covers[x.id] = x.cover_url; });
      setSongs((s.data || []).filter(x => x.audio_url).map(x => ({
        id: x.id, title: x.title, artist: x.artist || 'ALP', src: x.audio_url,
        cover: covers[x.album_id] || null, duration: Number(x.duration) || 0,
      })));
      setLoading(false);
    })();
    return () => { off = true; };
  }, []);

  // Valeurs bornées : durée 5–40 s (et jamais plus que le morceau), début dans le morceau
  const dur = Math.floor(duration);
  const maxLen = Math.min(VIBE_MAX, dur);
  const minLen = Math.min(VIBE_MIN, maxLen);
  const len = Math.min(Math.max(length, minLen), maxLen);
  const startMax = Math.max(0, dur - len);
  const st = Math.min(start, startMax);
  seg.current = { start: st, length: len };

  const releaseAudio = () => {
    const a = audioRef.current;
    if (a) { a.pause(); a.src = ''; audioRef.current = null; }
    setPreviewing(false);
  };
  useEffect(() => releaseAudio, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (song) => {
    releaseAudio();
    setSelected(song);
    setDuration(song.duration);
    setStart(0);
    setLength(Math.min(VIBE_MAX, song.duration || VIBE_MAX));
    const audio = new Audio(song.src);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      if (isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    });
    audio.addEventListener('timeupdate', () => {
      const { start: s0, length: l0 } = seg.current;
      if (audio.currentTime >= s0 + l0) audio.currentTime = s0; // le passage tourne en boucle
    });
    audio.addEventListener('pause', () => setPreviewing(false));
    audio.addEventListener('play', () => setPreviewing(true));
    audioRef.current = audio;
  };

  const backToList = () => { releaseAudio(); setSelected(null); };

  const togglePreview = () => {
    const a = audioRef.current;
    if (!a) return;
    if (previewing) { a.pause(); return; }
    a.currentTime = seg.current.start;
    a.play().catch(() => {});
  };

  const changeStart = (v) => {
    setStart(v);
    if (previewing && audioRef.current) audioRef.current.currentTime = v;
  };

  const confirm = () => {
    if (!selected || dur <= 0) return;
    releaseAudio();
    onConfirm({ song: selected, start: st, length: len });
  };

  const cancel = () => { releaseAudio(); onCancel(); };

  const q = query.trim().toLowerCase();
  const shown = songs.filter(s => !q || s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));

  return (
    <div className="modal-overlay" onClick={cancel}>
      <div className="modal-content music-page" style={box} onClick={e => e.stopPropagation()}>
        {!selected ? (
          <>
            <h2>Choisissez une musique pour le Vibe</h2>
            <input type="text" className="input-text" placeholder="Rechercher un morceau..."
              value={query} onChange={e => setQuery(e.target.value)} />
            <div className="music-list" style={{ marginTop: 10 }}>
              {loading && <p style={{ color: '#888', textAlign: 'center' }}>Chargement…</p>}
              {error && <p style={{ color: '#E22134', textAlign: 'center' }}>{error}</p>}
              {!loading && !error && shown.length === 0 && (
                <p style={{ color: '#888', textAlign: 'center' }}>{songs.length === 0 ? 'Aucune musique disponible.' : 'Aucun résultat.'}</p>
              )}
              {shown.map(song => (
                <div key={song.id} className="music-item" style={rowStyle} onClick={() => pick(song)}>
                  {song.cover ? <img src={song.cover} alt="" style={coverStyle} /> : <div style={coverStyle} />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{song.artist}</div>
                  </div>
                  <i className="fas fa-chevron-right" style={{ marginLeft: 'auto', opacity: 0.5 }}></i>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn-secondary" onClick={cancel}>Annuler</button>
            </div>
          </>
        ) : (
          <>
            <h2>Choisissez le passage</h2>
            <div style={{ ...rowStyle, cursor: 'default' }}>
              {selected.cover ? <img src={selected.cover} alt="" style={coverStyle} /> : <div style={coverStyle} />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{selected.title}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{selected.artist}</div>
              </div>
            </div>

            {dur <= 0 ? (
              <p style={{ color: '#888', textAlign: 'center', padding: 16 }}>Chargement du morceau…</p>
            ) : (
              <div className="music-controls">
                {/* Frise du morceau : la zone rouge est le passage choisi */}
                <div style={{ position: 'relative', height: 14, borderRadius: 7, background: 'rgba(255,255,255,0.15)', margin: '8px 0' }}>
                  <div style={{ position: 'absolute', top: 0, bottom: 0, borderRadius: 7, background: '#E22134',
                    left: `${(st / dur) * 100}%`, width: `${(len / dur) * 100}%` }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.7 }}>
                  <span>0:00</span><span>{fmt(dur)}</span>
                </div>

                <label style={{ display: 'block', marginTop: 12 }}>Début : <strong>{fmt(st)}</strong></label>
                <input type="range" min="0" max={startMax} step="1" value={st} style={{ width: '100%' }}
                  onChange={e => changeStart(parseInt(e.target.value, 10))} disabled={startMax === 0} />

                <label style={{ display: 'block', marginTop: 8 }}>Durée : <strong>{len} s</strong> (max {VIBE_MAX} s)</label>
                <input type="range" min={minLen} max={maxLen} step="1" value={len} style={{ width: '100%' }}
                  onChange={e => setLength(parseInt(e.target.value, 10))} disabled={maxLen <= minLen} />

                <p style={{ textAlign: 'center', margin: '10px 0' }}>
                  Passage : <strong>{fmt(st)} → {fmt(st + len)}</strong>
                </p>
                <button className="btn-secondary" style={{ width: '100%', marginBottom: 8 }} onClick={togglePreview}>
                  <i className={`fas fa-${previewing ? 'pause' : 'play'}`}></i> {previewing ? 'Arrêter' : 'Écouter le passage'}
                </button>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={confirm} disabled={dur <= 0}>Continuer vers Caméra</button>
              <button className="btn-secondary" onClick={backToList}>Changer</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VibeMusicPicker;
