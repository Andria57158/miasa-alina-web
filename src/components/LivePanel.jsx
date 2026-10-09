// src/components/LivePanel.jsx
// Étape 4 — contenu du viewer pour une story « live » :
//   • flux vidéo : Zoom (hôte = createLive ; spectateur = joinLiveSession(zoom_session_id))
//   • réactions (🔥 👍 …) : animation flottante déclenchée par les INSERT de `live_interactions`
//   • commentaires en direct
// Si Zoom n'est pas configuré, l'hôte voit sa caméra locale (secours) et le reste fonctionne.
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { joinLiveSession, isZoomUnavailable } from '../services/zoomLive';
import { LIVE_REACTIONS } from '../services/liveInteractions';
import useLiveInteractions from '../hooks/useLiveInteractions';
import FloatingReactions from './FloatingReactions';
import useProfiles from '../hooks/useProfiles';

const ZoomLive = lazy(() => import('./ZoomLive'));   // chargé à la demande : npm install @zoom/meetingsdk

const LivePanel = ({ story, me, isHost, hostSession, hostStream, onZoomEnded }) => {
  const floatRef = useRef(null);
  const videoRef = useRef(null);
  const [session, setSession] = useState(isHost ? hostSession : null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const remote = !!story.remote && !!story.zoomSessionId;
  const { profileOf, ensure } = useProfiles();

  // Spectateur : récupère la signature pour rejoindre la réunion
  useEffect(() => {
    if (isHost || !remote) return undefined;
    let alive = true;
    joinLiveSession(story.zoomSessionId)
      .then((s) => alive && setSession(s))
      .catch((e) => alive && setError(isZoomUnavailable(e) ? "Le direct n'est pas disponible pour le moment." : e.message));
    return () => { alive = false; };
  }, [isHost, remote, story.zoomSessionId]);

  // Secours hôte : caméra locale
  useEffect(() => { if (isHost && !session && hostStream && videoRef.current) videoRef.current.srcObject = hostStream; }, [isHost, session, hostStream]);

  const { comments, counts, sendReaction, sendComment } = useLiveInteractions({
    storyId: remote ? story.id : null, userId: me.id, onReaction: (e) => floatRef.current?.burst(e),
  });

  useEffect(() => { ensure(comments.map((c) => c.user_id)); }, [comments, ensure]);

  const react = (emoji) => { floatRef.current?.burst(emoji); sendReaction(emoji); };   // retour immédiat pour celui qui clique

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#000' }}>
        {session ? (
          <Suspense fallback={<div className="live-sim">Connexion au direct…</div>}>
            <ZoomLive session={session} role={isHost ? 1 : 0} userName={me.pseudo}
              onStatus={(s, e) => { if (s === 'ended') onZoomEnded?.(); if (s === 'error') setError(e?.reason || 'Connexion Zoom impossible.'); }} />
          </Suspense>
        ) : isHost ? (
          <video ref={videoRef} autoPlay muted playsInline className="story-media" />
        ) : (
          <div className="live-sim">{remote ? (error || 'Connexion au direct…') : 'En direct : Simulation de réception'}</div>
        )}
        <FloatingReactions ref={floatRef} />
      </div>

      {remote && (
        <div style={{ padding: 8, background: 'rgba(0,0,0,.6)' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            {LIVE_REACTIONS.map((e) => (
              <button key={e} className="v-react-btn" onClick={() => react(e)} aria-label={`Réaction ${e}`}>{e} <small>{counts[e] || ''}</small></button>
            ))}
          </div>
          <div style={{ maxHeight: 90, overflowY: 'auto', fontSize: 13, color: '#fff' }}>
            {comments.slice(-30).map((c) => <div key={c.id}><b>{profileOf(c.user_id).pseudo} :</b> {c.body}</div>)}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (sendComment(text)) setText(''); }} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Écrire un commentaire…" style={{ flex: 1 }} />
            <button type="submit" className="btn-primary">Envoyer</button>
          </form>
        </div>
      )}
    </div>
  );
};
export default LivePanel;
