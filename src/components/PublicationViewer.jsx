// src/components/PublicationViewer.jsx — une publication s'ouvre EXACTEMENT comme une story (mêmes classes vp-*) :
//   en-tête (avatar, nom, date · 🌐, ✕) → titre / texte « Voir plus » → grande image → barre d'achat → réactions + commentaires.
//   Vente d'article / album → bouton « Panier » ; billet → bouton « Billet » ; publication simple → pas de bouton.
import React, { useState } from 'react';
import { EventEngagementBar, storyTimeLabel } from './StoryEngagement';
import './PublicationViewer.css';

const fmt = (n) => `${(Number(n) || 0).toLocaleString('fr-FR')} Ar`;

const PublicationViewer = ({ evt, onClose, onBuy, currentUserId, currentUserAvatar, currentUserPseudo, fallbackAvatar, fallbackName }) => {
  const [descOpen, setDescOpen] = useState(false);
  if (!evt) return null;

  const tiers = Array.isArray(evt.tiers) ? evt.tiers : [];
  const isTicket = evt.type === 'billet';
  const sellable = evt.type !== 'scrolle' && (isTicket || evt.type === 'article' || evt.type === 'album');
  const left = tiers.length ? tiers.reduce((n, t) => n + (Number(t.quantity) || 0), 0) : (evt.stock == null ? null : Number(evt.stock));
  const soldOut = left !== null && left <= 0;

  return (
    <div className="modal-overlay story-viewer" onClick={onClose}>
      <div className="viewer-container viewer-post" onClick={(e) => e.stopPropagation()}>
        <div className="vp-header">
          <img className="vp-avatar" alt="avatar" src={evt.avatar || fallbackAvatar} />
          <div className="vp-who">
            <span className="vp-name">{evt.pseudo || fallbackName}</span>
            <span className="vp-meta">{storyTimeLabel(evt.createdAt)} · <i className="fas fa-globe-africa"></i></span>
          </div>
          <button className="vp-icon-btn" title="Fermer" onClick={onClose}><i className="fas fa-times"></i></button>
        </div>

        <div className="vp-body">
          <div className="vp-text">
            {evt.title && <div className="vp-title">{evt.title}</div>}
            {evt.desc && <div className={`vp-desc ${descOpen ? 'open' : ''}`}>{evt.desc}</div>}
            {evt.desc && evt.desc.length > 120 && (
              <button className="vp-more-link" onClick={() => setDescOpen(!descOpen)}>{descOpen ? 'Voir moins' : 'Voir plus'}</button>
            )}
          </div>

          {evt.image && <div className="vp-media"><img className="pv-img" src={evt.image} alt={evt.title || ''} /></div>}

          {sellable && (
            <div className="pv-buy">
              <div className="pv-info">
                {tiers.length > 0
                  ? tiers.map((t) => <div key={t.id} className="pv-tier"><span>{t.name}</span><span>{fmt(t.price)} · {t.quantity} restant(s)</span></div>)
                  : evt.price ? <div className="pv-tier"><span>Prix</span><strong>{fmt(evt.price)}</strong></div> : null}
                {isTicket && evt.date && <div className="pv-tier"><span><i className="fas fa-calendar-alt"></i> Date</span><span>{evt.date}</span></div>}
              </div>
              <button type="button" className="pv-cta" disabled={soldOut} onClick={() => onBuy && onBuy(evt)}>
                <i className={`fas ${isTicket ? 'fa-ticket-alt' : 'fa-shopping-cart'}`}></i> {soldOut ? 'Épuisé' : isTicket ? 'Billet' : 'Panier'}
              </button>
            </div>
          )}

          <EventEngagementBar eventId={evt.id} currentUserId={currentUserId}
            currentUserAvatar={currentUserAvatar} currentUserPseudo={currentUserPseudo} />
        </div>
      </div>
    </div>
  );
};
export default PublicationViewer;
