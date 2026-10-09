// src/utils/CountUp.jsx
// Compteur animé partagé (page Visiteur + tableau de bord admin) : même animation partout.
// Le chiffre monte de la valeur affichée jusqu'à la valeur cible, en ralentissant vers la fin.
// Désactivé si l'utilisateur a demandé moins d'animations.
import React, { useState, useRef, useEffect } from 'react';

export const useCountUp = (target, duration = 1600) => {
  const [value, setValue] = useState(0);
  const shown = useRef(0);
  useEffect(() => {
    const end = Number(target) || 0;
    const start = shown.current;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || start === end) { shown.current = end; setValue(end); return; }
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(start + (end - start) * eased);
      shown.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
};

export const CountUp = ({ value, duration }) => {
  const v = useCountUp(value, duration);
  return <>{v.toLocaleString('fr-FR')}</>;
};
