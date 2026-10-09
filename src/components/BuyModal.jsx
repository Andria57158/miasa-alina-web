// src/components/BuyModal.jsx — remplace l'ancien modal « Panier ».
//   Article : quantité → « Ajouter au panier » (l'utilisateur peut ensuite ajouter d'autres articles).
//   Billet  : catégorie + nombre de billets + formulaire → « Acheter » envoie la demande à l'admin.
import React, { useState } from 'react';
import CheckoutForm from './CheckoutForm';
import './SalesProtocol.css';

const fmt = (n) => `${(Number(n) || 0).toLocaleString('fr-FR')} Ar`;

const BuyModal = ({ evt, onClose, onAddToCart, onSubmitTicket }) => {
  const isTicket = evt.type === 'billet';
  const tiers = Array.isArray(evt.tiers) ? evt.tiers : [];
  const [tier, setTier] = useState(tiers.find((t) => Number(t.quantity) > 0) || null);
  const [qty, setQty] = useState(1);
  const max = tiers.length ? Number(tier?.quantity) || 0 : (evt.stock == null ? 99 : Number(evt.stock));
  const unit = tiers.length ? Number(tier?.price) || 0 : Number(evt.price) || 0;
  const q = Math.max(1, Math.min(max || 1, qty));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content small" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        <h3><i className={`fas ${isTicket ? 'fa-ticket-alt' : 'fa-shopping-cart'}`} /> {isTicket ? 'Billets' : 'Panier'} — {evt.title}</h3>

        {tiers.length > 0 && (
          <label className="sp-field">Catégorie
            <select className="privacy-select" value={tier?.id ?? ''} onChange={(e) => { setTier(tiers.find((t) => String(t.id) === e.target.value)); setQty(1); }}>
              {tiers.map((t) => (
                <option key={t.id} value={t.id} disabled={Number(t.quantity) <= 0}>{t.name} — {fmt(t.price)} ({t.quantity} restant{t.quantity > 1 ? 's' : ''})</option>
              ))}
            </select>
          </label>
        )}
        {!tiers.length && <p>Prix unitaire : {fmt(unit)}</p>}

        <label className="sp-field">{isTicket ? 'Nombre de billets' : 'Nombre d\'articles'}
          <input className="input-text" type="number" min="1" max={max} value={qty} style={{ width: 90 }}
            onChange={(e) => setQty(parseInt(e.target.value, 10) || 1)} />
        </label>
        <p>Total : <strong>{fmt(unit * q)}</strong></p>

        {isTicket ? (
          <CheckoutForm mode="billet" total={null} onCancel={onClose}
            onSubmit={async (f) => { if (!tier) throw new Error('Choisissez une catégorie.'); await onSubmitTicket({ evt, tier, qty: q }, f); }} />
        ) : (
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button className="btn-primary" disabled={max <= 0} onClick={() => { onAddToCart(evt, q); onClose(); }}>Ajouter au panier</button>
            <button className="btn-secondary" onClick={onClose}>Fermer</button>
          </div>
        )}
      </div>
    </div>
  );
};
export default BuyModal;
