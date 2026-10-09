// src/components/LyricsSyncTool.jsx
// Outil admin : synchroniser les paroles avec la musique.
// L'admin écoute le morceau et appuie sur ESPACE (ou sur le gros bouton) au moment
// exact où chaque ligne commence. Le résultat est écrit dans les paroles sous la forme
// [mm:ss.cc] Ligne  -> l'animation suit alors la musique avec précision.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './LyricsSyncTool.css';

const LRC_RE = /^\s*\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*/;
const SECTION_RE = /^\s*[\[(][^\]\)]{1,40}[\])]\s*$/;
const LEAD = 0.25; // compense le temps de réaction humain (on appuie un peu après le début de la ligne)

export const fmtLrc = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const m = Math.floor(cs / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};
const fmtClock = (t) => {
  if (!isFinite(t)) return '0:00';
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
};

const parseItems = (text) => String(text || '').replace(/\r/g, '').split('\n').map((l) => {
  const m = l.match(LRC_RE);
  const clean = (m ? l.replace(LRC_RE, '') : l).trim();
  const kind = clean === '' ? 'blank' : SECTION_RE.test(clean) ? 'section' : 'line';
  const time = m && kind === 'line' ? (+m[1]) * 60 + (+m[2]) + (m[3] ? (+m[3]) / Math.pow(10, m[3].length) : 0) : null;
  return { text: clean, kind, time };
});

const firstTodo = (items) => {
  const i = items.findIndex(it => it.kind === 'line' && it.time === null);
  if (i !== -1) return i;
  const j = items.findIndex(it => it.kind === 'line');
  return j === -1 ? items.length : j;
};

const LyricsSyncTool = ({ audio, text, onApply, onClose }) => {
  const [items, setItems] = useState(() => parseItems(text));
  const [cursor, setCursor] = useState(() => firstTodo(parseItems(text)));
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(1);
  const [url, setUrl] = useState('');
  const audioRef = useRef(null);
  const listRef = useRef(null);
  const rowRefs = useRef([]);

  // audio : File (fichier choisi) ou URL (morceau déjà publié)
  useEffect(() => {
    if (!audio) { setUrl(''); return undefined; }
    if (typeof audio === 'string') { setUrl(audio); return undefined; }
    const u = URL.createObjectURL(audio);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [audio]);

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate, url]);

  const total = useMemo(() => items.filter(i => i.kind === 'line').length, [items]);
  const done = useMemo(() => items.filter(i => i.kind === 'line' && i.time !== null).length, [items]);

  const nextLineAfter = (from, list) => {
    for (let i = from + 1; i < list.length; i++) if (list[i].kind === 'line') return i;
    return list.length;
  };

  const stamp = useCallback(() => {
    const a = audioRef.current;
    if (!a || cursor >= items.length || items[cursor]?.kind !== 'line') return;
    const t = Math.max(0, a.currentTime - LEAD);
    setItems(prev => prev.map((it, i) => (i === cursor ? { ...it, time: t } : it)));
    setCursor(nextLineAfter(cursor, items));
  }, [cursor, items]);

  const undo = useCallback(() => {
    let i = Math.min(cursor, items.length) - 1;
    while (i >= 0 && items[i].kind !== 'line') i--;
    if (i < 0) return;
    const old = items[i].time;
    setItems(prev => prev.map((it, k) => (k === i ? { ...it, time: null } : it)));
    setCursor(i);
    const a = audioRef.current;
    if (a && old !== null) a.currentTime = Math.max(0, old - 1.5);
  }, [cursor, items]);

  // Clavier : ESPACE = marquer la ligne, Retour arrière = annuler
  useEffect(() => {
    const down = (e) => {
      if (e.code === 'Space') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) stamp(); }
      else if (e.code === 'Backspace') { e.preventDefault(); undo(); }
      else if (e.code === 'Escape') { onClose && onClose(); }
    };
    const up = (e) => { if (e.code === 'Space') e.preventDefault(); };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); };
  }, [stamp, undo, onClose]);

  // Garde la ligne à marquer au centre de la liste
  useEffect(() => {
    const el = rowRefs.current[cursor];
    const box = listRef.current;
    if (el && box) {
      const top = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
      if (typeof box.scrollTo === 'function') box.scrollTo({ top, behavior: 'smooth' }); else box.scrollTop = top;
    }
  }, [cursor]);

  const togglePlay = () => {
    const a = audioRef.current; if (!a) return;
    if (a.paused) a.play().catch(() => {}); else a.pause();
  };
  const seekBy = (d) => { const a = audioRef.current; if (a) a.currentTime = Math.max(0, Math.min(a.duration || 1e9, a.currentTime + d)); };

  const apply = () => {
    const out = items.map(it => (it.kind === 'line' && it.time !== null ? `[${fmtLrc(it.time)}] ${it.text}` : it.text)).join('\n');
    onApply(out);
  };

  const nextText = items[cursor]?.kind === 'line' ? items[cursor].text : null;

  return (
    <div className="lst-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="lst-box" role="dialog" aria-label="Synchroniser les paroles">
        <div className="lst-head">
          <h3>Synchroniser les paroles</h3>
          <button type="button" className="lst-x" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <p className="lst-help">
          Lancez la musique, puis appuyez sur <b>ESPACE</b> (ou sur le gros bouton) <b>au moment où chaque ligne commence à être chantée</b>.
          Retour arrière = annuler la dernière. Astuce : mettez la vitesse à 0.75× si c'est rapide.
        </p>

        <audio
          ref={audioRef}
          src={url || undefined}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        />

        <div className="lst-player">
          <button type="button" className="lst-ctl" onClick={() => seekBy(-5)}>−5 s</button>
          <button type="button" className="lst-ctl lst-play" onClick={togglePlay}>{playing ? '❚❚ Pause' : '▶ Lecture'}</button>
          <button type="button" className="lst-ctl" onClick={() => seekBy(5)}>+5 s</button>
          <select className="lst-rate" value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} aria-label="Vitesse">
            <option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option>
          </select>
        </div>
        <div className="lst-seek">
          <span>{fmtClock(cur)}</span>
          <input type="range" min="0" max={dur || 0} step="0.1" value={Math.min(cur, dur || 0)}
                 onChange={(e) => { if (audioRef.current) audioRef.current.currentTime = parseFloat(e.target.value); }} />
          <span>{fmtClock(dur)}</span>
        </div>

        <div className="lst-next">
          {nextText !== null ? (<><small>Prochaine ligne à marquer</small><div className="lst-next-text">{nextText}</div></>)
            : (<div className="lst-next-text lst-ok">✔ Toutes les lignes sont marquées</div>)}
        </div>
        <button type="button" className="lst-tap" onClick={stamp} disabled={nextText === null}>MARQUER (Espace)</button>

        <div className="lst-list" ref={listRef}>
          {items.map((it, i) => (
            <div
              key={i}
              ref={(el) => (rowRefs.current[i] = el)}
              className={`lst-row lst-${it.kind} ${i === cursor ? 'lst-cur' : ''} ${it.time !== null ? 'lst-done' : ''}`}
              onClick={() => { if (it.kind === 'line') setCursor(i); }}
            >
              {it.kind === 'line' && <span className="lst-time">{it.time !== null ? fmtLrc(it.time) : '--:--.--'}</span>}
              <span className="lst-txt">{it.kind === 'blank' ? '\u00A0' : it.text}</span>
            </div>
          ))}
        </div>

        <div className="lst-foot">
          <span className={done === total ? 'lst-count lst-ok' : 'lst-count'}>{done} / {total} lignes marquées</span>
          <div className="lst-actions">
            <button type="button" className="lst-ctl" onClick={undo}>↶ Annuler</button>
            <button type="button" className="lst-ctl" onClick={() => { setItems(prev => prev.map(it => ({ ...it, time: null }))); setCursor(firstTodo(items.map(it => ({ ...it, time: null })))); }}>Tout effacer</button>
            <button type="button" className="lst-ctl" onClick={onClose}>Annuler</button>
            <button type="button" className="lst-ctl lst-main" onClick={apply} disabled={done === 0}>Appliquer aux paroles</button>
          </div>
        </div>
        {done > 0 && done < total && <div className="lst-warn">Les lignes non marquées suivront la ligne précédente.</div>}
      </div>
    </div>
  );
};

export default LyricsSyncTool;
