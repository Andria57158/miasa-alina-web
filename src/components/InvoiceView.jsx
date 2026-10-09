// src/components/InvoiceView.jsx — facture COMPLÈTE affichée dans l'app (onglet Événements > Panier).
//   <InvoiceView order={commande} />                      facture d'une commande (numéro, client, lignes, total, QR, tampon)
//   <InvoiceView draft items={…} total={…} clientName />  facture proforma du panier en cours (avec +/− et corbeille)
import React from 'react';
import { STATUS_LABEL, STATUS_COLOR, isOrderDone, hasInvoice } from '../services/orders';
import { QrSvg } from './TicketCard';
import './SalesProtocol.css';

const fmt = (n) => `${(Number(n) || 0).toLocaleString('fr-FR')} Ar`;
const pad = (n) => String(n).padStart(6, '0');
const whoOf = (o, fallback) => o?.customer?.username || [o?.customer?.prenom, o?.customer?.nom].filter(Boolean).join(' ') || o?.sender_name || fallback || '';

const InvoiceView = ({ order, draft, items, total, clientName, onQty, onRemove, footer }) => {
  // Lignes normalisées (commande ou panier)
  const lines = draft
    ? (items || []).map((i) => ({ key: i.eventId, id: i.eventId, title: i.title, tier: null, qty: i.qty, unit: i.unitPrice }))
    : (order?.items || []).map((i, k) => ({ key: i.id || k, title: i.event_title, tier: i.tier_name && i.tier_name !== 'Standard' ? i.tier_name : null, qty: i.quantity, unit: i.unit_price }));
  const sum = draft ? total : (order?.total ?? lines.reduce((s, l) => s + l.unit * l.qty, 0));
  const isArticle = draft || order?.kind !== 'billet';
  const done = !draft && isOrderDone(order);
  const who = draft ? clientName : whoOf(order, clientName);
  const date = draft ? new Date() : new Date(order.created_at);

  return (
    <div className="inv">
      {done && <span className="sp-stamp">{order.status === 'livre' ? 'LIVRÉ' : 'VALIDÉ'}</span>}

      <div className="inv-head">
        <div>
          <div className="inv-title">{draft ? 'Facture proforma' : hasInvoice(order) ? 'Facture' : 'Demande'}</div>
          {!draft && <div className="inv-no">N° {pad(order.invoice_no)}</div>}
        </div>
        {!draft && isArticle && order.status === 'acceptee' && (
          <div className="inv-qr"><QrSvg text={order.id} size={96} /><small>À présenter au livreur</small></div>
        )}
      </div>

      <dl className="inv-meta">
        <dt>Date</dt><dd>{date.toLocaleString('fr-FR')}</dd>
        {who && (<><dt>Client</dt><dd>{who}</dd></>)}
        {!draft && order.sender_phone && (<><dt>Envoyeur</dt><dd>{order.sender_phone}</dd></>)}
        {!draft && order.transaction_no && (<><dt>Transaction</dt><dd>{order.transaction_no}</dd></>)}
        {!draft && isArticle && order.delivery_place && (<><dt>Livraison</dt><dd>{order.delivery_place}</dd></>)}
        <dt>Statut</dt>
        <dd style={{ color: draft ? '#ffbb33' : STATUS_COLOR[order.status], fontWeight: 700 }}>{draft ? 'Brouillon — non envoyé' : STATUS_LABEL[order.status] || order.status}</dd>
      </dl>

      <div className="inv-scroll">
        <table className="inv-table">
          <thead>
            <tr><th>Article</th><th className="r">Qté</th><th className="r">Prix unit.</th><th className="r">Total</th>{draft && <th />}</tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>{l.title}{l.tier && <div className="inv-sub">{l.tier}</div>}</td>
                <td className="r">
                  {draft && onQty ? (
                    <span className="sp-qty inv-qty">
                      <button type="button" onClick={() => onQty(l.id, l.qty - 1)} aria-label="Moins">−</button>{l.qty}
                      <button type="button" onClick={() => onQty(l.id, l.qty + 1)} aria-label="Plus">+</button>
                    </span>
                  ) : l.qty}
                </td>
                <td className="r">{fmt(l.unit)}</td>
                <td className="r">{fmt(l.unit * l.qty)}</td>
                {draft && <td className="r"><button type="button" className="inv-del" onClick={() => onRemove && onRemove(l.id)} aria-label="Retirer"><i className="fas fa-trash" /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="inv-total"><span>Total à payer</span><strong>{fmt(sum)}</strong></div>
      {order?.status === 'refusee' && order.reject_reason && <div className="sp-err">{order.reject_reason}</div>}
      {footer}
    </div>
  );
};
export default InvoiceView;
