// src/components/PlaybackModeButton.jsx
// Un seul bouton-icône qui change à chaque clic :
//   Lecture continue -> Répéter tout -> Répéter un morceau -> Aléatoire -> (retour au début)
import React from 'react';
import './PlaybackModeButton.css';

export const PLAYBACK_MODES = ['continuous', 'repeat-all', 'repeat-one', 'shuffle'];

const META = {
  continuous:  { label: 'Lecture continue',   hint: "Joue les morceaux à la suite, s'arrête à la fin de la liste" },
  'repeat-all': { label: 'Répéter tout',       hint: 'Recommence la liste depuis le début à la fin' },
  'repeat-one': { label: 'Répéter un morceau', hint: 'Rejoue sans fin le morceau en cours' },
  shuffle:     { label: 'Aléatoire',          hint: 'Joue les morceaux dans un ordre au hasard' },
};

export const normalizeMode = (m) => (PLAYBACK_MODES.includes(m) ? m : 'continuous');
export const nextMode = (m) => PLAYBACK_MODES[(PLAYBACK_MODES.indexOf(normalizeMode(m)) + 1) % PLAYBACK_MODES.length];

const Svg = ({ children }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

const ICONS = {
  continuous: (
    <Svg><path d="M3 12h12" /><path d="m11 7 5 5-5 5" /><path d="M20 6v12" /></Svg>
  ),
  'repeat-all': (
    <Svg><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></Svg>
  ),
  'repeat-one': (
    <Svg><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /><path d="M11 10h1v4" /></Svg>
  ),
  shuffle: (
    <Svg><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" /><path d="m18 2 4 4-4 4" /><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" /><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" /><path d="m18 14 4 4-4 4" /></Svg>
  ),
};

const PlaybackModeButton = ({ mode, onChange }) => {
  const current = normalizeMode(mode);
  const click = () => onChange(nextMode(current));
  const upcoming = META[nextMode(current)].label;

  return (
    <div className="pm-wrap">
      <button
        type="button"
        className={`pm-btn ${current === 'continuous' ? '' : 'pm-on'}`}
        onClick={click}
        title={`${META[current].label} — ${META[current].hint}. Cliquer : ${upcoming}`}
        aria-label={`Mode de lecture : ${META[current].label}. Cliquer pour passer à : ${upcoming}`}
      >
        {ICONS[current]}
      </button>
    </div>
  );
};

export default PlaybackModeButton;
