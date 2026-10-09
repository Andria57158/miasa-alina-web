// src/components/MessageBody.jsx
// Affichage commun (messagerie ET commentaires) : texte/émojis, lecteur audio compact, image/sticker, document.
import React from 'react';

const fmt = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');

const MessageBody = ({ m }) => {
  switch (m.kind) {
    case 'voice':
      return (
        <div className="voice-bubble" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <audio controls preload="metadata" src={m.media_url} style={{ height: 34, maxWidth: 220 }} />
          {m.duration_s ? <small>{fmt(m.duration_s)}</small> : null}
        </div>
      );
    case 'image':
    case 'sticker':
      return m.media_url
        ? <img src={m.media_url} alt={m.kind} loading="lazy" style={{ maxWidth: m.kind === 'sticker' ? 110 : 220, borderRadius: 10 }} />
        : <span style={{ fontSize: 40 }}>{m.body}</span>;             // sticker émoji
    case 'file':
      return <a href={m.media_url} target="_blank" rel="noopener noreferrer" download>📎 {m.file_name || 'Document'}</a>;
    default:
      return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</span>;   // React échappe le texte : pas de HTML injecté
  }
};
export default MessageBody;
