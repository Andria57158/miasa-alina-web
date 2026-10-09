// src/rules.js — règles métier du plan regle.md côté front (à importer dans UserVip, AdminVip, scan admin…)

const H = 3600 * 1000;

// ---- 1.1  Une story toutes les 48 h -------------------------------------------------
export const STORY_LIMIT_MSG = 'Vous ne pouvez publier qu\'une seule story toutes les 48 heures.';

// À appeler AVANT d'ouvrir l'éditeur (showCreationMenu). Renvoie { ok, nextAt }.
export async function canPublishStory(supabase, userId) {
  const { data, error } = await supabase.from('stories').select('created_at')
    .eq('user_id', userId).neq('type', 'live').order('created_at', { ascending: false }).limit(1);
  if (error) return { ok: true }; // en cas d'erreur réseau, le trigger SQL reste le garde-fou
  if (!data?.length) return { ok: true };
  const next = new Date(data[0].created_at).getTime() + 48 * H;
  return next > Date.now() ? { ok: false, nextAt: new Date(next) } : { ok: true };
}
// À utiliser dans le catch de publishStory (erreur levée par le trigger SQL)
export const isStoryLimitError = (e) => String(e?.message || e).includes('STORY_LIMIT_48H');

// ---- 1.4  Messages : expirent après 7 jours -----------------------------------------
export function messageExpiryLabel(createdAt) {
  const left = new Date(createdAt).getTime() + 7 * 24 * H - Date.now();
  if (left <= 0) return 'Expire bientôt';
  if (left < 24 * H) return `Expire dans ${Math.max(1, Math.floor(left / H))} h`;
  return `Expire dans ${Math.floor(left / (24 * H))} j`;
}
export const isMessageExpired = (createdAt) => Date.now() - new Date(createdAt).getTime() > 7 * 24 * H;

// ---- 1.5  Facture : disponible 24 h après la livraison ------------------------------
export function invoiceExpired(order) {
  return order?.status === 'livre_paye' && !!order.delivered_at
    && Date.now() - new Date(order.delivered_at).getTime() > 24 * H;
}

// ---- 1.6  Événement terminé depuis plus de 5 h (même logique que public._event_start) -
export function eventStart(eventDate, eventTime) {
  if (!eventDate) return null;
  const m = String(eventTime || '').match(/^\s*(\d{1,2})\s*[:hH]\s*(\d{2})?/);
  let hh = 23, mm = 59;
  if (m && +m[1] <= 23 && +(m[2] || 0) <= 59) { hh = +m[1]; mm = +(m[2] || 0); }
  const p = (n) => String(n).padStart(2, '0');
  return new Date(`${eventDate}T${p(hh)}:${p(mm)}:00+03:00`); // Madagascar = UTC+3, sans heure d'été
}
export const eventScanClosed = (eventDate, eventTime) => {
  const s = eventStart(eventDate, eventTime);
  return !!s && s.getTime() < Date.now() - 5 * H;
};

// ---- 1.7  Scan QR : messages d'erreur / résultat ------------------------------------
export function scanErrorMessage(e) {
  const t = String(e?.message || e);
  if (t.includes('EVENT_ENDED')) return 'Événement terminé depuis plus de 5 h : billet refusé.';
  if (t.includes('TICKET_INVOICE')) return 'Ceci est une facture de billet, pas un QR d\'entrée.';
  if (t.includes('NOT_ACCEPTED')) return 'Commande non acceptée.';
  if (t.includes('ORDER_NOT_FOUND')) return 'QR code inconnu (ou billet déjà supprimé).';
  if (t.includes('FORBIDDEN')) return 'Accès réservé à l\'administrateur.';
  return 'Scan impossible.';
}
// résultat de scan_code : data.already_done === true → « Billet déjà scanné »
export const scanResultMessage = (d) =>
  d?.already_done ? (d.kind === 'ticket' ? 'Billet déjà scanné' : 'Commande déjà livrée') : null;

// liste des invités : seulement les billets non scannés
// supabase.from('tickets').select('*').eq('event_id', id).eq('status', 'valid')
