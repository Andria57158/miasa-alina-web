// src/components/MyShop.jsx — onglet « Événements » côté utilisateur : Billets | Panier.
import React, { useCallback, useEffect, useState } from 'react';
import { listMyOrders, subscribeOrders, loadOrderWithItems, submitArticleOrder, STATUS_LABEL, STATUS_COLOR, hasInvoice, isOrderDone } from '../services/orders';
import { listMyTickets, subscribeTickets } from '../services/tickets';
import { downloadInvoice } from '../services/invoice';
import TicketCard, { QrSvg } from './TicketCard';
import CheckoutForm from './CheckoutForm';
import InvoiceView from './InvoiceView';
import './SalesProtocol.css';

const fmt = (n) => `${(Number(n) || 0).toLocaleString('fr-FR')} Ar`;
const no = (o) => String(o.invoice_no).padStart(6, '0');

const InvoiceButtons = ({ order }) => {
  const get = async (format) => {
    try { await downloadInvoice(await loadOrderWithItems(order.id), { format }); }
    catch (e) { alert(`Facture indisponible : ${e.message}`); }
  };
  return (
    <div className="sp-actions">
      <button className="btn-secondary" onClick={() => get('pdf')}><i className="fas fa-file-pdf" /> Facture PDF</button>
      <button className="btn-secondary" onClick={() => get('jpg')}><i className="fas fa-file-image" /> Facture JPG</button>
    </div>
  );
};

const OrderCard = ({ o, clientName }) => (
  <InvoiceView order={o} clientName={clientName} footer={
    <>
      {o.status === 'en_attente' && <div className="sp-muted" style={{ marginTop: 8 }}>L'administrateur va vérifier votre paiement.</div>}
      {o.kind !== 'billet' && o.status === 'acceptee' && <div className="sp-muted" style={{ marginTop: 8 }}>Commande acceptée — présentez le QR code ci-dessus au livreur à la réception.</div>}
      {hasInvoice(o) && <InvoiceButtons order={o} />}
    </>
  } />
);

const MyShop = ({ cart, view, setView, onGoFeed, onOrdered, clientName }) => {
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [checkout, setCheckout] = useState(false);

  const refresh = useCallback(() => {
    listMyOrders().then(setOrders).catch(() => {});
    listMyTickets().then(setTickets).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const a = subscribeOrders(refresh); const b = subscribeTickets(refresh);
    const timer = setInterval(refresh, 20000);                       // filet de sécurité si le temps réel est coupé
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { a(); b(); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);

  const articleOrders = orders.filter((o) => o.kind !== 'billet');
  const ticketOrders = orders.filter((o) => o.kind === 'billet');
  const pendingTickets = ticketOrders.filter((o) => ['en_attente', 'refusee'].includes(o.status));

  const sendCart = async (f) => {
    await submitArticleOrder(cart.items.map((i) => ({ eventId: i.eventId, quantity: i.qty })), f);
    cart.clear(); setCheckout(false); refresh(); onOrdered && onOrdered();
  };

  return (
    <div className="events-mobile">
      <div className="feed-header"><h3><i className="fas fa-ticket-alt" /> Événements</h3></div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
        <button className={view === 'billets' ? 'btn-primary' : 'btn-secondary'} style={{ flex: 1 }} onClick={() => setView('billets')}>
          <i className="fas fa-ticket-alt" /> Billets ({tickets.length})
        </button>
        <button className={view === 'panier' ? 'btn-primary' : 'btn-secondary'} style={{ flex: 1 }} onClick={() => setView('panier')}>
          <i className="fas fa-shopping-cart" /> Panier ({cart.count})
        </button>
      </div>

      {view === 'billets' && (
        <>
          {pendingTickets.length > 0 && <h4 style={{ margin: '4px 0 8px' }}>Demandes envoyées</h4>}
          {pendingTickets.map((o) => <OrderCard key={o.id} o={o} clientName={clientName} />)}
          {tickets.length > 0 && <h4 style={{ margin: '12px 0 4px' }}>Mes billets</h4>}
          {tickets.length > 0 && <p className="sp-muted" style={{ marginTop: 0 }}>Présentez le QR code à l'entrée. Un billet scanné ne peut plus être réutilisé.</p>}
          {tickets.length === 0 && pendingTickets.length === 0 && (
            <p style={{ color: '#888', textAlign: 'center', padding: 20 }}>Aucun billet pour le moment.</p>
          )}
          {tickets.map((t2) => <TicketCard key={t2.id} ticket={t2} />)}
          {ticketOrders.filter((o) => hasInvoice(o)).length > 0 && <h4 style={{ margin: '12px 0 8px' }}>Factures</h4>}
          {ticketOrders.filter((o) => hasInvoice(o)).map((o) => <OrderCard key={o.id} o={o} clientName={clientName} />)}
        </>
      )}

      {view === 'panier' && (
        <>
          {cart.items.length === 0 ? (
            <p style={{ color: '#888', textAlign: 'center', padding: 20 }}>
              Votre panier est vide. <button className="btn-secondary" onClick={onGoFeed}>Voir les articles</button>
            </p>
          ) : (
            <InvoiceView draft items={cart.items} total={cart.total} clientName={clientName}
              onQty={(id, q) => cart.setQty(id, q)} onRemove={(id) => cart.remove(id)}
              footer={
                <div className="sp-actions" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn-secondary" onClick={onGoFeed}>Ajouter un article</button>
                  <button className="btn-primary" onClick={() => setCheckout(true)}>Acheter</button>
                </div>
              } />
          )}
          {articleOrders.length === 0 ? (<><h4 style={{ margin: '16px 0 8px' }}>Mes commandes</h4><p className="sp-muted">Aucune commande.</p></>) : (
            [['en_attente', 'En attente de validation'], ['acceptee', 'À livrer — facture disponible'], ['done', 'Livrées / validées'], ['refusee', 'Refusées']].map(([k, label]) => {
              const list = articleOrders.filter((o) => (k === 'done' ? isOrderDone(o) : o.status === k));
              return list.length === 0 ? null : (
                <div key={k}><h4 style={{ margin: '16px 0 8px' }}>{label} ({list.length})</h4>{list.map((o) => <OrderCard key={o.id} o={o} clientName={clientName} />)}</div>
              );
            })
          )}
        </>
      )}

      {checkout && (
        <div className="modal-overlay" onClick={() => setCheckout(false)}>
          <div className="modal-content small" onClick={(e) => e.stopPropagation()}>
            <h3><i className="fas fa-shopping-bag" /> Finaliser l'achat</h3>
            <CheckoutForm mode="article" total={cart.total} onSubmit={sendCart} onCancel={() => setCheckout(false)} />
          </div>
        </div>
      )}
    </div>
  );
};
export default MyShop;
