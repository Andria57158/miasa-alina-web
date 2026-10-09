// src/components/FloatingReactions.jsx
// Affiche une animation d'émoji qui s'élève dès qu'une réaction arrive (hôte ET spectateurs).
// Usage : const ref = useRef(); <FloatingReactions ref={ref} />  puis  ref.current.burst('🔥')
import React, { forwardRef, useCallback, useImperativeHandle, useState } from 'react';

const STYLE_ID = 'floating-reactions-css';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  .fr-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:30}
  .fr-emoji{position:absolute;bottom:60px;font-size:34px;animation:frUp 2.4s ease-out forwards;will-change:transform,opacity}
  @keyframes frUp{0%{transform:translate(0,0) scale(.6);opacity:0}12%{opacity:1}
    100%{transform:translate(var(--dx),-340px) scale(1.25);opacity:0}}
  @media (prefers-reduced-motion:reduce){.fr-emoji{animation-duration:.01s}}`;
  document.head.appendChild(s);
}

const FloatingReactions = forwardRef(function FloatingReactions(_, ref) {
  const [items, setItems] = useState([]);
  const burst = useCallback((emoji) => {
    const id = `${Date.now()}-${Math.random()}`;
    const item = { id, emoji, left: 8 + Math.random() * 70, dx: Math.round(Math.random() * 80 - 40) };
    setItems((l) => [...l.slice(-30), item]);
    setTimeout(() => setItems((l) => l.filter((i) => i.id !== id)), 2500);
  }, []);
  useImperativeHandle(ref, () => ({ burst }), [burst]);
  return (
    <div className="fr-layer" aria-hidden="true">
      {items.map((i) => <span key={i.id} className="fr-emoji" style={{ left: `${i.left}%`, '--dx': `${i.dx}px` }}>{i.emoji}</span>)}
    </div>
  );
});
export default FloatingReactions;
