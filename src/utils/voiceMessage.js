// src/utils/voiceMessage.js
//
// Lecteur de messages vocaux (commentaires) basé sur la Web Audio API.
// - Une seule instance d'AudioContext, un seul message vocal joué à la fois.
// - Vrai vu-mètre (AnalyserNode) pendant la lecture, pas juste un <audio>.
// - Bouton play/pause + barre de progression + durée, mis à jour en direct.
//
// Le HTML des commentaires est injecté via dangerouslySetInnerHTML : les
// attributs "onclick" fonctionnent normalement (ce ne sont pas des <script>),
// c'est ce qui permet à ce module de piloter un lecteur "riche" même si le
// commentaire est du texte brut stocké en base.

let audioCtx = null;
const players = new Map(); // id -> { audio, analyser, raf }
let currentPlayingId = null;

function getCtx() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function formatTime(t) {
  if (!isFinite(t) || t < 0) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function setIcon(id, playing) {
  const icon = document.getElementById(`vm-icon-${id}`);
  if (icon) icon.className = `fas fa-${playing ? 'pause' : 'play'}`;
}

function stopVisual(id) {
  const entry = players.get(id);
  if (entry && entry.raf) cancelAnimationFrame(entry.raf);
  if (entry) entry.raf = null;
}

function drawVisual(id) {
  const entry = players.get(id);
  const bars = document.getElementById(`vm-bars-${id}`);
  if (!entry || !bars) return;
  const data = new Uint8Array(entry.analyser.frequencyBinCount);
  const children = bars.children;
  const tick = () => {
    if (entry.audio.paused) return;
    entry.analyser.getByteFrequencyData(data);
    for (let i = 0; i < children.length; i++) {
      const v = data[i % data.length] / 255;
      children[i].style.transform = `scaleY(${0.25 + v * 0.9})`;
    }
    entry.raf = requestAnimationFrame(tick);
  };
  entry.raf = requestAnimationFrame(tick);
}

function ensurePlayer(id, url) {
  if (players.has(id)) return players.get(id);
  const ctx = getCtx();
  const audio = new Audio(url);
  audio.crossOrigin = 'anonymous';
  audio.preload = 'metadata';

  let source = null;
  let analyser = null;
  try {
    source = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 32;
    source.connect(analyser);
    analyser.connect(ctx.destination);
  } catch (e) {
    // Si la création du graphe Web Audio échoue (ex: CORS sur le CDN),
    // on retombe sur une simple lecture <audio> sans vu-mètre.
    analyser = { frequencyBinCount: 8, getByteFrequencyData: () => {} };
  }

  const entry = { audio, analyser, raf: null };
  players.set(id, entry);

  audio.addEventListener('loadedmetadata', () => {
    const durEl = document.getElementById(`vm-dur-${id}`);
    if (durEl && isFinite(audio.duration)) durEl.textContent = formatTime(audio.duration);
  });
  audio.addEventListener('timeupdate', () => {
    const fill = document.getElementById(`vm-fill-${id}`);
    const durEl = document.getElementById(`vm-dur-${id}`);
    if (fill && audio.duration) fill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
    if (durEl && audio.duration) durEl.textContent = formatTime(audio.duration - audio.currentTime);
  });
  audio.addEventListener('ended', () => {
    stopVisual(id);
    setIcon(id, false);
    const fill = document.getElementById(`vm-fill-${id}`);
    if (fill) fill.style.width = '0%';
    if (currentPlayingId === id) currentPlayingId = null;
  });

  return entry;
}

export function toggleVoiceMessage(id, url) {
  const entry = ensurePlayer(id, url);

  // Une seule lecture à la fois : on met en pause le précédent message.
  if (currentPlayingId && currentPlayingId !== id) {
    const prev = players.get(currentPlayingId);
    if (prev) {
      prev.audio.pause();
      setIcon(currentPlayingId, false);
      stopVisual(currentPlayingId);
    }
  }

  if (entry.audio.paused) {
    entry.audio.play().catch(() => {});
    setIcon(id, true);
    currentPlayingId = id;
    drawVisual(id);
  } else {
    entry.audio.pause();
    setIcon(id, false);
    stopVisual(id);
    currentPlayingId = null;
  }
}

if (typeof window !== 'undefined') {
  window.__toggleVoiceMessage = toggleVoiceMessage;
}

// Construit le fragment HTML injecté dans le texte du commentaire.
// Remplace l'ancien : <audio controls src="..."></audio>
export function buildVoiceMessageHtml(url) {
  const id = `vm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const bars = '<span></span>'.repeat(4);
  return `<br/><div class="voice-message" data-vm-id="${id}">` +
    `<button type="button" class="voice-message-btn" onclick="window.__toggleVoiceMessage('${id}', '${url}')">` +
    `<i id="vm-icon-${id}" class="fas fa-play"></i>` +
    `</button>` +
    `<div class="voice-message-track">` +
    `<div id="vm-bars-${id}" class="voice-message-bars">${bars}</div>` +
    `<div class="voice-message-progress"><div id="vm-fill-${id}" class="voice-message-fill"></div></div>` +
    `</div>` +
    `<span id="vm-dur-${id}" class="voice-message-duration">0:00</span>` +
    `</div>`;
}
