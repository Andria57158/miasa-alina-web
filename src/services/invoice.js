// src/services/invoice.js
// Facture numérotée en PDF ou JPG, avec QR code (= id de la commande) pour les articles.
//   npm install jspdf qrcode-generator --legacy-peer-deps
import { jsPDF } from 'jspdf';
import qrcode from 'qrcode-generator';
import { STATUS_LABEL, isOrderDone } from './orders';
import { ticketTheme } from './tickets';

const pad = (n) => String(n).padStart(6, '0');
const ar = (n) => `${(Number(n) || 0).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} Ar`;
const stampOf = (o) => (o.status === 'livre' ? 'LIVRÉ' : isOrderDone(o) ? 'VALIDÉ' : '');
const qrMatrix = (text) => { const qr = qrcode(0, 'M'); qr.addData(String(text)); qr.make(); return qr; };
const whoOf = (o) => o.customer?.username || [o.customer?.prenom, o.customer?.nom].filter(Boolean).join(' ') || o.sender_name || '';

// ---------------- PDF ----------------
function drawQr(doc, text, x, y, size) {
  const qr = qrMatrix(text); const n = qr.getModuleCount(); const cell = size / n;
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) doc.rect(x + c * cell, y + r * cell, cell, cell, 'F');
}

export async function buildInvoicePdf(order, { brand = 'VIP' } = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const isArticle = order.kind !== 'billet';

  doc.setFontSize(20); doc.text(`Facture ${brand}`, 15, 20);
  doc.setFontSize(10);
  doc.text(`N° ${pad(order.invoice_no)}`, 15, 28);
  doc.text(`Date : ${new Date(order.created_at).toLocaleString('fr-FR')}`, 15, 33);
  let ly = 38;
  const who = whoOf(order); if (who) { doc.text(`Client : ${who}`, 15, ly); ly += 5; }
  if (order.sender_phone) { doc.text(`Envoyeur : ${order.sender_phone}`, 15, ly); ly += 5; }
  if (order.transaction_no) { doc.text(`Transaction : ${order.transaction_no}`, 15, ly); ly += 5; }
  if (isArticle && order.delivery_place) { doc.text(`Livraison : ${String(order.delivery_place).slice(0, 60)}`, 15, ly); ly += 5; }
  doc.text(`Statut : ${STATUS_LABEL[order.status] || order.status}`, 15, ly);
  if (isArticle) {                                    // QR de la facture : présenté au livreur
    drawQr(doc, order.id, 150, 12, 45);
    doc.setFontSize(7); doc.text('À présenter au livreur', 158, 60);
  }

  let y = 70;
  doc.setFontSize(10); doc.setFont(undefined, 'bold');
  doc.text('Article', 15, y); doc.text('Catégorie', 90, y); doc.text('Qté', 130, y); doc.text('Prix unit.', 145, y); doc.text('Total', 175, y);
  doc.setFont(undefined, 'normal'); y += 3; doc.line(15, y, 195, y); y += 6;
  (order.items || []).forEach((it) => {
    doc.text(String(it.event_title).slice(0, 38), 15, y);
    doc.text(String(it.tier_name).slice(0, 18), 90, y);
    doc.text(String(it.quantity), 130, y);
    doc.text(ar(it.unit_price), 145, y);
    doc.text(ar(it.unit_price * it.quantity), 175, y);
    y += 7;
    if (y > 270) { doc.addPage(); y = 20; }
  });
  doc.line(15, y, 195, y); y += 8;
  doc.setFont(undefined, 'bold'); doc.setFontSize(12);
  doc.text(`Total : ${ar(order.total)}`, 195, y, { align: 'right' });
  const stamp = stampOf(order);
  if (stamp) { y += 12; doc.setTextColor(0, 140, 60); doc.text(stamp, 195, y, { align: 'right' }); }   // inscription « Validé » / « Livré »
  return doc.output('blob');
}

// ---------------- JPG (dessiné sur un canvas) ----------------
const W = 900;
function canvasQr(ctx, text, x, y, size) {
  const qr = qrMatrix(text); const n = qr.getModuleCount(); const cell = size / n;
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(Math.round(x + c * cell), Math.round(y + r * cell), Math.ceil(cell), Math.ceil(cell));
}
const toBlob = (canvas) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Image impossible'))), 'image/jpeg', 0.92));

export async function buildInvoiceJpg(order, { brand = 'VIP' } = {}) {
  const items = order.items || [];
  const isArticle = order.kind !== 'billet';
  const H = 520 + items.length * 44 + 140;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#111'; ctx.font = 'bold 44px Arial'; ctx.fillText(`Facture ${brand}`, 50, 80);
  ctx.font = '24px Arial';
  const lines = [
    `N° ${pad(order.invoice_no)}`,
    `Date : ${new Date(order.created_at).toLocaleString('fr-FR')}`,
    whoOf(order) && `Client : ${whoOf(order)}`,
    order.sender_phone && `Envoyeur : ${order.sender_phone}`,
    order.transaction_no && `Transaction : ${order.transaction_no}`,
    isArticle && order.delivery_place && `Livraison : ${String(order.delivery_place).slice(0, 40)}`,
    `Statut : ${STATUS_LABEL[order.status] || order.status}`,
  ].filter(Boolean);
  lines.forEach((l, i) => ctx.fillText(l, 50, 130 + i * 36));
  if (isArticle) { canvasQr(ctx, order.id, W - 290, 40, 240); ctx.font = '18px Arial'; ctx.fillText('À présenter au livreur', W - 270, 302); }

  let y = 400;
  ctx.font = 'bold 22px Arial'; ctx.fillStyle = '#111';
  [['Article', 50], ['Catégorie', 360], ['Qté', 560], ['Prix unit.', 620], ['Total', 760]].forEach(([t, x]) => ctx.fillText(t, x, y));
  ctx.fillRect(50, y + 12, W - 100, 2); y += 52;
  ctx.font = '22px Arial';
  items.forEach((it) => {
    ctx.fillText(String(it.event_title).slice(0, 22), 50, y);
    ctx.fillText(String(it.tier_name).slice(0, 12), 360, y);
    ctx.fillText(String(it.quantity), 560, y);
    ctx.fillText(ar(it.unit_price), 620, y);
    ctx.fillText(ar(it.unit_price * it.quantity), 760, y);
    y += 44;
  });
  ctx.fillRect(50, y - 20, W - 100, 2); y += 20;
  ctx.font = 'bold 30px Arial'; ctx.textAlign = 'right'; ctx.fillText(`Total : ${ar(order.total)}`, W - 50, y);
  const stamp = stampOf(order);
  if (stamp) {                                                    // tampon « Validé » / « Livré »
    ctx.save(); ctx.translate(W / 2, y + 60); ctx.rotate(-0.12);
    ctx.strokeStyle = ctx.fillStyle = '#008c3c'; ctx.lineWidth = 6; ctx.font = 'bold 54px Arial'; ctx.textAlign = 'center';
    const tw = ctx.measureText(stamp).width; ctx.strokeRect(-tw / 2 - 24, -52, tw + 48, 76); ctx.fillText(stamp, 0, 4);
    ctx.restore();
  }
  return toBlob(canvas);
}

// ---------------- Billet en JPG ----------------
const loadImg = (src) => new Promise((res) => { if (!src) return res(null); const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

export async function buildTicketJpg(ticket) {
  const th = ticketTheme(ticket.tier_name);
  const w = 700; const h = th.colored ? 1000 : 620;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (th.colored) {
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, th.from); g.addColorStop(1, th.to);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = th.text; ctx.textAlign = 'center';
    ctx.font = 'bold 64px Arial'; ctx.fillText(th.label, w / 2, 100);
    ctx.font = '26px Arial'; ctx.fillText(String(ticket.event_title || '').slice(0, 40), w / 2, 145);
    const img = await loadImg(ticket.holder_image);
    ctx.save(); ctx.beginPath(); ctx.arc(w / 2, 280, 90, 0, Math.PI * 2); ctx.clip();
    if (img) ctx.drawImage(img, w / 2 - 90, 190, 180, 180); else { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(w / 2 - 90, 190, 180, 180); }
    ctx.restore();
    ctx.fillStyle = th.text; ctx.font = 'bold 40px Arial'; ctx.fillText(String(ticket.holder_name || '').slice(0, 26), w / 2, 430);
    ctx.fillStyle = '#fff'; ctx.fillRect(w / 2 - 190, 480, 380, 380); canvasQr(ctx, ticket.id, w / 2 - 170, 500, 340);
  } else {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); canvasQr(ctx, ticket.id, 90, 90, 520);   // seulement le QR code
  }
  return toBlob(canvas);
}

// ---------------- Téléchargements ----------------
const save = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};
/** opts.format : 'pdf' (défaut) ou 'jpg' */
export async function downloadInvoice(order, opts = {}) {
  const jpg = opts.format === 'jpg';
  save(jpg ? await buildInvoiceJpg(order, opts) : await buildInvoicePdf(order, opts), `facture-${pad(order.invoice_no)}.${jpg ? 'jpg' : 'pdf'}`);
}
export async function downloadTicket(ticket) { save(await buildTicketJpg(ticket), `billet-${ticket.tier_name}-${ticket.id.slice(0, 8)}.jpg`); }
