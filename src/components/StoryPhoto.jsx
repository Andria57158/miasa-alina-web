// src/components/StoryPhoto.jsx
// Affiche une story photo : image Cloudinary + textes/émojis (positions en %), sans dangerouslySetInnerHTML.
// fit="cover"   (défaut) : remplit sa boîte (vignettes du feed)
// fit="natural"          : garde le format d'origine de l'image, sans rognage (viewer, comme Facebook)
import React, { useState } from 'react';

const safeColor = (c) => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\))$/i.test(c.trim()) ? c : undefined);
const safeFont = (f) => (typeof f === 'string' && /^[\w\s,"'-]+$/.test(f) ? f : undefined);

const Overlays = ({ overlays }) => overlays.map((o, i) => (
  <div key={i} style={{
    position: 'absolute', left: `${o.x}%`, top: `${o.y}%`, width: o.kind === 'emoji' ? `${o.w}%` : 'auto',
    transform: o.rotation ? `rotate(${Number(o.rotation) || 0}deg)` : undefined,
    fontSize: `${Math.min(30, Math.max(1, Number(o.fs) || 6))}cqw`, lineHeight: 1.15, whiteSpace: 'pre-wrap',
    color: safeColor(o.color), background: safeColor(o.bg), fontFamily: safeFont(o.font),
    padding: o.kind === 'text' ? '0.2em 0.3em' : 0, textAlign: o.kind === 'emoji' ? 'center' : 'left', pointerEvents: 'none',
  }}>{String(o.text)}</div>
));

const StoryPhoto = ({ url, overlays = [], fit = 'cover', maxWidth = '100vw', maxHeight = '100vh' }) => {
  const [ratio, setRatio] = useState(null); // largeur / hauteur réelles de l'image

  if (fit === 'natural') {
    // La boîte épouse exactement l'image (largeur max = écran, hauteur max = écran) :
    // aucun rognage, et les textes/émojis (en %) restent à la bonne place.
    return (
      <div style={{
        position: 'relative', containerType: 'inline-size', overflow: 'hidden', flexShrink: 0,
        aspectRatio: ratio || 1,
        width: ratio ? `min(${maxWidth}, calc(${maxHeight} * ${ratio}))` : '1px',
        opacity: ratio ? 1 : 0,
      }}>
        <img src={url} alt="story" onLoad={(e) => setRatio(e.target.naturalWidth / e.target.naturalHeight || 1)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        <Overlays overlays={overlays} />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', containerType: 'inline-size', overflow: 'hidden' }}>
      <img src={url} alt="story" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      <Overlays overlays={overlays} />
    </div>
  );
};
export default StoryPhoto;
