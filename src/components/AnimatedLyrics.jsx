// src/components/AnimatedLyrics.jsx
// Paroles animées (style karaoké) pour le morceau en cours de lecture.
// Utilisé par la page Admin et la page User.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { parseLyrics, activeLineIndex, downloadLyricsPdf } from '../utils/lyricsTools';
import './AnimatedLyrics.css';

const AnimatedLyrics = ({ song, currentTime = 0, duration = 0, isPlaying = false, onSeek }) => {
  const dur = duration || song?.duration || 0;
  const { lines, synced } = useMemo(() => parseLyrics(song?.lyrics || '', dur), [song?.lyrics, dur]);
  const active = activeLineIndex(lines, currentTime);
  const idle = !isPlaying && currentTime < 0.5;

  const boxRef = useRef(null);
  const lineRefs = useRef([]);
  const manualUntil = useRef(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState('');

  // Nouvelle chanson : retour en haut
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = 0;
    manualUntil.current = 0;
  }, [song?.id]);

  // Suivi automatique de la ligne active (sauf si l'utilisateur fait défiler lui-même)
  useEffect(() => {
    if (active < 0 || Date.now() < manualUntil.current) return;
    const box = boxRef.current;
    const el = lineRefs.current[active];
    if (!box || !el) return;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const top = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
    if (typeof box.scrollTo === 'function') box.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' }); else box.scrollTop = top;
  }, [active]);

  const pauseAutoScroll = () => { manualUntil.current = Date.now() + 3500; };

  const handlePdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true); setPdfMsg('');
    try {
      await downloadLyricsPdf({
        songs: [song],
        album: { title: song.album, artist: song.artist, cover: song.cover },
      });
    } catch (e) {
      console.error(e);
      setPdfMsg('PDF impossible pour le moment.');
    } finally { setPdfBusy(false); }
  };

  return (
    <div className="al-wrap">
      <div className="al-bar">
        <span className="al-title">{song?.title}</span>
        <button type="button" className="al-pdf-btn" onClick={handlePdf} disabled={pdfBusy} title="Télécharger les paroles en PDF">
          <i className={pdfBusy ? 'fas fa-spinner fa-spin' : 'fas fa-file-pdf'}></i> PDF
        </button>
      </div>
      {pdfMsg && <div className="al-msg">{pdfMsg}</div>}

      <div
        ref={boxRef}
        className={`al-box ${idle ? 'al-idle' : ''}`}
        onWheel={pauseAutoScroll}
        onTouchMove={pauseAutoScroll}
      >
        <div className="al-pad" />
        {lines.map((l, i) => {
          if (l.blank) return <div key={i} className="al-gap" ref={(el) => (lineRefs.current[i] = el)} />;
          const state = l.section ? 'section' : i === active ? 'active' : l.end <= currentTime || i < active ? 'past' : 'future';
          const p = state === 'active' ? Math.min(1, Math.max(0, (currentTime - l.start) / Math.max(0.5, l.end - l.start))) : 0;
          return (
            <div
              key={i}
              ref={(el) => (lineRefs.current[i] = el)}
              className={`al-line al-${state}`}
              onClick={() => { if (!l.section && onSeek) { manualUntil.current = 0; onSeek(l.start); } }}
              style={state === 'active' ? { '--al-p': `${p * 100}%` } : undefined}
            >
              <span className="al-text">{l.text}</span>
            </div>
          );
        })}
        <div className="al-pad" />
      </div>
      {!synced && <div className="al-hint">Défilement automatique • touchez une ligne pour y aller</div>}
    </div>
  );
};

export default AnimatedLyrics;
