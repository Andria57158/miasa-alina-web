// src/services/orders.js
// Protocole de vente : le client envoie une demande (formulaire) → l'admin accepte → facture + livraison / billets.
import { supabase } from '../supabaseClient';

// en_attente → acceptee → valide (QR scanné) | livre (bouton admin) ; refusee. « livre_paye » = ancien statut.
export const STATUS_LABEL = {
  en_attente: 'En attente de validation',
  acceptee: 'Acceptée',
  valide: 'Validé',
  livre: 'Livré',
  refusee: 'Refusée',
  livre_paye: 'Validé',
};
export const STATUS_COLOR = { en_attente: '#ffbb33', acceptee: '#4dabf7', valide: '#00C851', livre: '#00C851', livre_paye: '#00C851', refusee: '#ff5252' };
export const isOrderDone = (o) => ['valide', 'livre', 'livre_paye'].includes(o?.status);   // livré / validé
export const hasInvoice = (o) => !!o && !['en_attente', 'refusee'].includes(o.status);      // facture visible après acceptation

const ERRORS = {
  NOT_MEMBER: 'Seuls les membres validés du site peuvent acheter.',
  NOT_AUTHENTICATED: 'Connectez-vous pour continuer.',
  MISSING_PHONE: "Le numéro de l'envoyeur est obligatoire.",
  MISSING_FIELDS: 'Veuillez remplir tous les champs du formulaire.',
  EMPTY_ORDER: 'Votre panier est vide.',
  EVENT_NOT_FOUND: "Cette publication n'est plus disponible.",
  EVENT_EXPIRED: 'Cet événement est déjà passé.',
  TIER_NOT_FOUND: "Cette catégorie n'existe plus.",
  OUT_OF_STOCK: 'Stock insuffisant pour cette commande.',
  FORBIDDEN: "Seul l'administrateur peut faire cette action.",
  ORDER_NOT_FOUND: 'Commande ou billet introuvable.',
  ALREADY_DECIDED: 'Cette demande a déjà été traitée.',
  ALREADY_DONE: 'Déjà validée / livrée.',
  NOT_ACCEPTED: "Cette commande n'a pas encore été acceptée.",
  NOT_AN_ARTICLE_ORDER: "Cette action ne concerne que les commandes d'articles.",
  TICKET_INVOICE: 'Ceci est la facture de billets : scannez le QR code de chaque billet.',
};
const friendly = (error) => {
  const m = error?.message || '';
  const k = Object.keys(ERRORS).find((c) => m.includes(c));
  return new Error(k ? ERRORS[k] : m || 'Erreur inconnue');
};
const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw friendly(error);
  return Array.isArray(data) ? data[0] : data;
};

// ---------- Client ----------
/** Articles : items = [{ eventId, tierId?, quantity }] + formulaire { senderPhone, transactionNo, deliveryPlace } */
export const submitArticleOrder = (items, f) => rpc('submit_order', {
  p_kind: 'article',
  p_items: items.map((i) => ({ event_id: String(i.eventId), tier_id: i.tierId == null ? null : String(i.tierId), quantity: i.quantity })),
  p_sender_phone: f.senderPhone, p_sender_name: null, p_transaction_no: f.transactionNo, p_delivery_place: f.deliveryPlace,
});

/** Billets : une catégorie d'un événement + formulaire { senderPhone, senderName } */
export const submitTicketOrder = ({ eventId, tierId, quantity }, f) => rpc('submit_order', {
  p_kind: 'billet',
  p_items: [{ event_id: String(eventId), tier_id: tierId == null ? null : String(tierId), quantity }],
  p_sender_phone: f.senderPhone, p_sender_name: f.senderName, p_transaction_no: null, p_delivery_place: null,
});

export async function loadOrderWithItems(orderId) {
  const { data, error } = await supabase.from('orders')
    .select('*, items:order_items(*), customer:users!orders_user_id_fkey(username, nom, prenom)').eq('id', orderId).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listMyOrders() {
  const { data, error } = await supabase.from('orders').select('*, items:order_items(*), customer:users!orders_user_id_fkey(username, nom, prenom)').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
// Admin : toutes les commandes (la policy renvoie tout à l'admin)
export const listAllOrders = listMyOrders;

// ---------- Admin ----------
/** Accepter / refuser. Le nom et la photo du billet sont lus côté serveur dans le profil du membre. */
export const decideOrder = (orderId, accept, { reason } = {}) => rpc('decide_order', {
  p_order_id: orderId, p_accept: accept, p_reason: reason || null,
});
/** Livré sans facture : l'admin appuie → « Livré » sur les deux factures */
export const deliverManually = (orderId) => rpc('deliver_order_manual', { p_order_id: orderId });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isOrderId = (s) => UUID.test(String(s || '').trim());

/** Scan d'un QR (facture d'article → « Validé » ; billet → présent, retiré des invités). */
export async function scanCode(code) {
  if (!isOrderId(code)) throw new Error('QR code invalide.');
  return rpc('scan_code', { p_code: code.trim() });
}
export const confirmDelivery = scanCode;   // ancien nom

export function subscribeOrders(onChange) {
  // Nom unique : plusieurs composants peuvent écouter en même temps
  const ch = supabase.channel(`orders-sync:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onChange).subscribe();
  return () => supabase.removeChannel(ch);
}
