// src/hooks/useVipViewportOffsets.js
// Mesure la vraie hauteur de la barre du haut (.mobile-top-nav) et du footer
// et les expose en variables CSS : --vip-top-offset / --vip-footer-h.
// Avant : 128px écrit « en dur » alors que la barre descend jusqu'à ~163px
// => l'en-tête de conversation et le champ « Rechercher un contact » passaient dessous.
import { useEffect } from 'react';

export default function useVipViewportOffsets() {
  useEffect(() => {
    const root = document.documentElement;

    const measure = () => {
      const nav = document.querySelector('.mobile-top-nav');
      const footer = document.querySelector('.admin-footer');
      if (nav && getComputedStyle(nav).display !== 'none') {
        root.style.setProperty('--vip-top-offset', `${Math.ceil(nav.getBoundingClientRect().bottom)}px`);
      }
      if (footer && getComputedStyle(footer).display !== 'none') {
        root.style.setProperty('--vip-footer-h', `${Math.ceil(footer.getBoundingClientRect().height)}px`);
      }
    };

    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    const nav = document.querySelector('.mobile-top-nav');
    const footer = document.querySelector('.admin-footer');
    if (ro) { nav && ro.observe(nav); footer && ro.observe(footer); }
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);
}
