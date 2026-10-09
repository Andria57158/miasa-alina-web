// src/utils/voiceBubble.js
// Bulle de message vocal : capsule rouge, bouton lecture blanc à gauche,
// forme d'onde blanche au centre, durée (mm:ss) à droite.
//
// Les commentaires sont affichés via dangerouslySetInnerHTML : le lecteur
// fonctionne donc par délégation d'événements (un seul écouteur global,
// installé à l'import du module). Les anciens commentaires vocaux
// (utils/voiceMessage.js) restent lisibles : ce fichier ne touche pas à leur balisage.

const STYLE_ID = 'vb-styles';
const BARS = 32;

const CSS = `
.vb{display:inline-flex;align-items:center;gap:10px;box-sizing:border-box;
  min-width:220px;max-width:100%;padding:6px 14px 6px 6px;border-radius:999px;
  background:#e11d2e;color:#fff;box-shadow:0 4px 14px rgba(225,29,46,.35);
  user-select:none;-webkit-user-select:none;vertical-align:middle}
.vb-play{flex:none;width:36px;height:36px;padding:0;border:0;border-radius:50%;
  background:#fff;color:#e11d2e;display:grid;place-items:center;cursor:pointer;
  transition:transform .12s ease}
.vb-play:active{transform:scale(.92)}
.vb-play svg{width:16px;height:16px;fill:currentColor;display:block}
.vb-play .vb-ico-pause{display:none}
.vb.playing .vb-ico-play{display:none}
.vb.playing .vb-ico-pause{display:block}
.vb-wave{flex:1;min-width:80px;height:28px;display:flex;align-items:center;gap:2px;cursor:pointer}
.vb-bar{flex:1;min-width:2px;border-radius:2px;background:rgba(255,255,255,.45);transition:background .1s}
.vb-bar.on{background:#fff}
.vb-time{flex:none;font:600 12px/1 system-ui,-apple-system,sans-serif;
  font-variant-numeric:tabular-nums;letter-spacing:.2px}
`;

const PLAY_SVG = '<svg class="vb-ico-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const PAUSE_SVG = '<svg class="vb-ico-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const formatVoiceTime = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// Hauteurs de barres stables pour une même URL (même bulle = même forme).
const barHeights = (seed) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const out = [];
  for (let i = 0; i < BARS; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) + i; h ^= h >>> 13;
    const r = (h >>> 0) / 4294967295;
    const envelope = 0.55 + 0.45 * Math.sin((i / (BARS - 1)) * Math.PI); // plus haut au centre
    out.push(Math.round(22 + r * 78 * envelope));
  }
  return out;
};

export const buildVoiceBubbleHtml = (url, durationSec = 0) => {
  const bars = barHeights(String(url)).map((h) => `<span class="vb-bar" style="height:${h}%"></span>`).join('');
  const d = Math.max(0, Math.round(Number(durationSec) || 0));
  return (
    `<div class="vb" data-src="${esc(url)}" data-duration="${d}">` +
      `<button type="button" class="vb-play" aria-label="Lire le message vocal">${PLAY_SVG}${PAUSE_SVG}</button>` +
      `<div class="vb-wave">${bars}</div>` +
      `<span class="vb-time">${formatVoiceTime(d)}</span>` +
    `</div>`
  );
};

// ---------- Lecteur (délégation d'événements) ----------
let audio = null;
let currentSrc = null;

const bubblesFor = (src) => Array.from(document.querySelectorAll('.vb')).filter((el) => el.dataset.src === src);
const knownDuration = (root) => (audio && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(root.dataset.duration) || 0);

const paint = (src, playing) => {
  bubblesFor(src).forEach((root) => {
    const dur = knownDuration(root);
    const cur = audio && currentSrc === src ? audio.currentTime : 0;
    const on = dur ? Math.round((cur / dur) * BARS) : 0;
    root.classList.toggle('playing', playing);
    root.querySelectorAll('.vb-bar').forEach((b, i) => b.classList.toggle('on', i < on));
    const t = root.querySelector('.vb-time');
    if (t) t.textContent = formatVoiceTime(playing || cur > 0 ? cur : dur);
  });
};

const resetBubbles = (src) => {
  bubblesFor(src).forEach((root) => {
    root.classList.remove('playing');
    root.querySelectorAll('.vb-bar.on').forEach((b) => b.classList.remove('on'));
    const t = root.querySelector('.vb-time');
    if (t) t.textContent = formatVoiceTime(root.dataset.duration);
  });
};

const load = (src) => {
  if (audio && currentSrc === src) return audio;
  if (audio) { audio.pause(); resetBubbles(currentSrc); }
  audio = new Audio(src);
  audio.preload = 'metadata';
  currentSrc = src;
  audio.addEventListener('timeupdate', () => paint(src, !audio.paused));
  audio.addEventListener('play', () => paint(src, true));
  audio.addEventListener('pause', () => paint(src, false));
  audio.addEventListener('ended', () => { audio.currentTime = 0; resetBubbles(src); });
  return audio;
};

const toggle = (root, ratio = null) => {
  const src = root.dataset.src;
  const a = load(src);
  const seek = () => {
    const dur = knownDuration(root);
    if (ratio !== null && dur) a.currentTime = ratio * dur;
  };
  if (ratio === null && !a.paused) { a.pause(); return; }
  seek();
  a.play().catch(() => {});
};

const onClick = (e) => {
  const wave = e.target.closest && e.target.closest('.vb-wave');
  const btn = e.target.closest && e.target.closest('.vb-play');
  if (wave) {
    const root = wave.closest('.vb');
    const rect = wave.getBoundingClientRect();
    toggle(root, Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  } else if (btn) {
    toggle(btn.closest('.vb'));
  }
};

if (typeof document !== 'undefined' && !window.__vbInstalled) {
  window.__vbInstalled = true;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  document.addEventListener('click', onClick);
}
