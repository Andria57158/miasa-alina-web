// src/utils/lyricsTools.js
// Outils partagés (Admin + User) pour les paroles ÉCRITES :
//  - parseLyrics()      : texte brut -> lignes avec temps de début/fin (animation)
//  - downloadLyricsPdf(): PDF des paroles avec la pochette de l'album
//
// Synchronisation :
//  1) Si l'admin écrit des horodatages façon LRC ([01:23.50] Ma ligne),
//     ils sont utilisés tels quels (synchro exacte).
//  2) Sinon, les lignes sont réparties automatiquement sur la durée du
//     morceau, proportionnellement à la longueur de chaque ligne.
//  Les titres de section ([Refrain], (Couplet 1)…) sont affichés mais ne
//  consomment pas de temps.

const LRC_RE = /^\s*\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*/;
const SECTION_RE = /^\s*[\[(][^\]\)]{1,40}[\])]\s*$/;

// Enlève les horodatages LRC (utile pour le PDF)
export const stripTimestamps = (text = '') =>
  String(text).replace(/\r/g, '').split('\n').map(l => l.replace(LRC_RE, '')).join('\n');

export const hasLyrics = (song) => !!(song && typeof song.lyrics === 'string' && song.lyrics.trim());

export const parseLyrics = (text = '', duration = 0) => {
  const raw = String(text).replace(/\r/g, '').replace(/^\uFEFF/, '').split('\n');
  const lines = raw.map((l) => {
    const m = l.match(LRC_RE);
    const time = m ? (+m[1]) * 60 + (+m[2]) + (m[3] ? (+m[3]) / Math.pow(10, m[3].length) : 0) : null;
    const clean = (m ? l.replace(LRC_RE, '') : l).trim();
    return {
      text: clean,
      time,
      blank: clean === '',
      section: clean !== '' && SECTION_RE.test(clean),
      start: 0,
      end: 0,
    };
  });

  const singing = lines.filter(l => !l.blank && !l.section);
  const stamped = singing.filter(l => l.time !== null);
  const synced = singing.length > 0 && stamped.length >= Math.ceil(singing.length / 2);

  if (synced) {
    // Synchro exacte : une ligne sans horodatage hérite du temps de la précédente
    let last = 0;
    lines.forEach((l) => { if (l.time !== null) last = l.time; else l.time = last; });
    lines.forEach((l, i) => {
      l.start = l.time;
      const next = lines.slice(i + 1).find(n => !n.blank && !n.section && n.time > l.time);
      l.end = next ? next.time : (duration || l.time + 4);
    });
    return { lines, synced: true };
  }

  // Synchro automatique proportionnelle à la longueur
  const weight = (l) => (l.blank ? 3 : l.section ? 0 : Math.max(l.text.length, 10));
  const total = lines.reduce((s, l) => s + weight(l), 0) || 1;
  const d = duration > 0 ? duration : Math.max(60, singing.length * 4);
  const intro = Math.min(8, d * 0.06);
  const outro = Math.min(6, d * 0.04);
  const span = Math.max(1, d - intro - outro);
  let t = intro;
  lines.forEach((l) => {
    l.start = t;
    t += (weight(l) / total) * span;
    l.end = t;
  });
  return { lines, synced: false };
};

// Index de la ligne chantée à l'instant t (-1 = avant la première)
export const activeLineIndex = (lines, t) => {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.blank || l.section) continue;
    if (l.start <= t) idx = i; else break;
  }
  return idx;
};

// ------------------------------------------------------------------
// PDF
// ------------------------------------------------------------------
const toDataUrl = async (url) => {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const blob = await res.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  // Rendu en JPEG via canvas : accepte png/webp/gif et donne les dimensions
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      resolve({ data: c.toDataURL('image/jpeg', 0.92), w: c.width, h: c.height });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
};

// Les polices PDF standard gèrent le français (WinAnsi) mais pas les emojis
const pdfSafe = (s) => String(s).replace(/[^\u0020-\u007E\u00A0-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u2018\u2019\u201A\u201C\u201D\u201E\u2013\u2014\u2022\u2026\u20AC\u2122]/g, '');

const safeName = (s) =>
  String(s || 'paroles').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);

// songs : [{ title, artist, lyrics }]   album : { title, artist, year, cover }
// Une page de garde avec la pochette, puis les paroles de chaque morceau.
export const downloadLyricsPdf = async ({ songs, album, fileName }) => {
  const list = (songs || []).filter(hasLyrics);
  if (list.length === 0) return false;

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 20;

  let cover = null;
  if (album?.cover) { try { cover = await toDataUrl(album.cover); } catch (e) { console.warn('Pochette indisponible pour le PDF :', e); } }

  const footer = (pageLabel) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(150);
    doc.text(pdfSafe(pageLabel), W / 2, H - 10, { align: 'center' });
  };

  // ----- Page de garde : pochette + titre -----
  let y = 28;
  if (cover) {
    const size = 110;
    const ratio = cover.w / cover.h;
    const w = ratio >= 1 ? size : size * ratio;
    const h = ratio >= 1 ? size / ratio : size;
    doc.addImage(cover.data, 'JPEG', (W - w) / 2, y, w, h);
    y += h + 14;
  } else { y += 40; }
  doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(26);
  const headTitle = list.length === 1 ? list[0].title : (album?.title || 'Paroles');
  doc.splitTextToSize(pdfSafe(headTitle), W - 2 * M).forEach((ln) => { doc.text(ln, W / 2, y, { align: 'center' }); y += 11; });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.setTextColor(90);
  const sub = [list.length === 1 ? album?.title : null, list.length === 1 ? list[0].artist : album?.artist, album?.year].filter(Boolean).join('  •  ');
  if (sub) doc.text(pdfSafe(sub), W / 2, y + 2, { align: 'center' });
  doc.setDrawColor(200, 30, 30); doc.setLineWidth(0.8); doc.line(W / 2 - 15, y + 10, W / 2 + 15, y + 10);
  doc.setFontSize(10); doc.setTextColor(140);
  doc.text(list.length === 1 ? 'Paroles' : `Paroles — ${list.length} titres`, W / 2, y + 20, { align: 'center' });

  // ----- Pages de paroles -----
  list.forEach((s) => {
    doc.addPage();
    let py = M + 6;
    // petite pochette en en-tête
    if (cover) {
      const t = 18; const ratio = cover.w / cover.h;
      doc.addImage(cover.data, 'JPEG', M, M - 4, ratio >= 1 ? t : t * ratio, ratio >= 1 ? t / ratio : t);
    }
    const tx = cover ? M + 24 : M;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(20);
    doc.text(pdfSafe(s.title), tx, M + 2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(110);
    doc.text(pdfSafe([s.artist, album?.title].filter(Boolean).join('  •  ')), tx, M + 9);
    py = M + 28;
    doc.setDrawColor(220); doc.setLineWidth(0.3); doc.line(M, py - 6, W - M, py - 6);

    doc.setFontSize(12);
    const lh = 6.2;
    stripTimestamps(s.lyrics).split('\n').forEach((raw) => {
      const line = pdfSafe(raw.trimEnd());
      const isSection = line.trim() !== '' && SECTION_RE.test(line);
      if (isSection) { doc.setFont('helvetica', 'bold'); doc.setTextColor(180, 30, 30); }
      else { doc.setFont('helvetica', 'normal'); doc.setTextColor(30); }
      const wrapped = line.trim() === '' ? [''] : doc.splitTextToSize(line, W - 2 * M);
      wrapped.forEach((w) => {
        if (py > H - 20) { doc.addPage(); py = M + 4; doc.setFont('helvetica', isSection ? 'bold' : 'normal'); }
        if (w) doc.text(w, M, py);
        py += w === '' ? lh * 0.7 : lh;
      });
    });
  });

  // numéros de page (sauf page de garde)
  const n = doc.getNumberOfPages();
  for (let p = 2; p <= n; p++) { doc.setPage(p); footer(`${p - 1} / ${n - 1}`); }

  doc.save(`${safeName(fileName || (list.length === 1 ? list[0].title : album?.title))}.pdf`);
  return true;
};
