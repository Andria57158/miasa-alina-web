// src/components/ZoomLive.jsx
// Affiche la réunion Zoom (le « live ») dans la page grâce au Zoom Meeting SDK (Component View).
// Chargé à la demande (React.lazy) : la page se charge normalement même si le SDK n'est pas installé.
//   npm install @zoom/meetingsdk
import React, { useEffect, useRef } from 'react';
import ZoomMtgEmbedded from '@zoom/meetingsdk/embedded';

/**
 * @param session  { signature, sdkKey, meetingNumber, password, zak? }
 * @param role     1 = hôte (celui qui fait le live), 0 = spectateur
 * @param onStatus 'connecting' | 'live' | 'ended' | 'error'
 */
const ZoomLive = ({ session, role, userName, onStatus }) => {
  const rootRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const client = ZoomMtgEmbedded.createClient();
    (async () => {
      try {
        onStatus?.('connecting');
        const r = rootRef.current.getBoundingClientRect();
        await client.init({
          zoomAppRoot: rootRef.current,
          language: 'fr-FR',
          patchJsMedia: true,
          leaveOnPageUnload: true,
          customize: {
            video: {
              isResizable: false,
              viewSizes: { default: { width: Math.max(320, Math.round(r.width)), height: Math.max(240, Math.round(r.height)) } },
            },
          },
        });
        client.on?.('connection-change', (p) => { if (alive && p?.state === 'Closed') onStatus?.('ended'); });
        await client.join({
          signature: session.signature,
          sdkKey: session.sdkKey,
          meetingNumber: session.meetingNumber,
          password: session.password,
          userName: userName || 'Invité',
          ...(role === 1 && session.zak ? { zak: session.zak } : {}),
        });
        if (alive) onStatus?.('live');
      } catch (e) {
        if (alive) onStatus?.('error', e); // le SDK renvoie { type, reason, errorCode }
      }
    })();
    return () => {
      alive = false;
      try { client.leaveMeeting?.(); } catch { /* déjà quitté */ }
      try { ZoomMtgEmbedded.destroyClient?.(); } catch { /* ignore */ }
    };
  }, [session?.signature, session?.meetingNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={rootRef} className="zoom-live-root" />;
};

export default ZoomLive;
