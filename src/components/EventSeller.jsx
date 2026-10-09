// src/components/EventSeller.jsx
// Vendre / publier : « Ajouter » → Scrolle, Vente d'articles, Vente de billets, Album.
// Utilisé par la page User (le client vend aussi). La publication part dans Supabase avec son auteur :
// elle apparaît aussitôt chez l'admin et chez tous les autres membres, et seul l'auteur peut la modifier / supprimer.
import React, { useState } from 'react';
import { uploadToCloudinary } from '../cloudinaryClient';
import { fileToPersistentUrl, tierIconClass } from '../utils/vipShared';
import { createEventRow } from '../services/vipEvents';

const digitsOnly = (v) => String(v ?? '').replace(/\D/g, '');
const groupThousands = (v) => digitsOnly(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const formatPrice = (price) => `${(Number(price) || 0).toLocaleString('fr-FR')} Ar`;

const TICKET_CATEGORIES = [
  { type: 'fanzone', name: 'FANZONE', emoji: '🙌' },
  { type: 'silver',  name: 'SILVER',  emoji: '🥈' },
  { type: 'lite',    name: 'LITE',    emoji: '🎟️' },
  { type: 'gold',    name: 'GOLD',    emoji: '🥇' },
  { type: 'vip',     name: 'VIP',     emoji: '⭐' },
  { type: 'vvip',    name: 'VVIP',    emoji: '👑' },
];
const makeBilletTiers = () => TICKET_CATEGORIES.map((c, i) => ({
  id: Date.now() + i, name: c.name, type: c.type, description: '', price: 0, quantity: 0,
}));

const EventSeller = ({ myId, userPseudo, userPhoto, onCreated }) => {
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [showEventMenu, setShowEventMenu] = useState(false);
  const [selectedEventType, setSelectedEventType] = useState('scrolle');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventDesc, setEventDesc] = useState('');
  const [eventPrice, setEventPrice] = useState('');
  const [eventImage, setEventImage] = useState(null);
  const [eventImageUrl, setEventImageUrl] = useState(null);
  const [eventCategory, setEventCategory] = useState('article');
  const [eventTicketCount, setEventTicketCount] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [ticketTiers, setTicketTiers] = useState(makeBilletTiers);
  const [newTierName, setNewTierName] = useState('');
  const [newTierType, setNewTierType] = useState('standard');
  const [newTierDesc, setNewTierDesc] = useState('');
  const [newTierPrice, setNewTierPrice] = useState('');
  const [newTierQuantity, setNewTierQuantity] = useState('');
  const [editingTierId, setEditingTierId] = useState(null);

  const addTier = () => {
    if (!newTierName.trim() || !newTierPrice || !newTierQuantity) {
      alert('Veuillez remplir tous les champs.');
      return;
    }
    const price = parseFloat(newTierPrice);
    const quantity = parseInt(newTierQuantity);
    if (price <= 0 || quantity <= 0) {
      alert('Le prix et la quantité doivent être positifs.');
      return;
    }
    const newTier = {
      id: editingTierId || Date.now(),
      name: newTierName.trim(),
      type: newTierType,
      description: newTierDesc.trim(),
      price: price,
      quantity: quantity
    };
    if (editingTierId) {
      setTicketTiers(ticketTiers.map(t => t.id === editingTierId ? newTier : t));
      setEditingTierId(null);
    } else {
      setTicketTiers([...ticketTiers, newTier]);
    }
    setNewTierName('');
    setNewTierType('standard');
    setNewTierDesc('');
    setNewTierPrice('');
    setNewTierQuantity('');
  };

  // Billets : modification directe du prix / des places / de la description d'une catégorie
  const updateTier = (id, patch) => setTicketTiers(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
  // Billets : remet une catégorie qu'on avait retirée (toujours rangée dans l'ordre FANZONE → VVIP)
  const addCategory = (cat) => {
    setTicketTiers(prev => {
      if (prev.some(t => t.type === cat.type)) return prev;
      const next = [...prev, { id: Date.now(), name: cat.name, type: cat.type, description: '', price: 0, quantity: 0 }];
      const order = (t) => { const i = TICKET_CATEGORIES.findIndex(c => c.type === t.type); return i === -1 ? 99 : i; };
      return next.sort((a, b) => order(a) - order(b));
    });
  };

  const removeTier = (id) => {
    if (window.confirm('Supprimer ce palier ?')) {
      setTicketTiers(ticketTiers.filter(t => t.id !== id));
      if (editingTierId === id) {
        setEditingTierId(null);
        setNewTierName('');
        setNewTierType('standard');
        setNewTierDesc('');
        setNewTierPrice('');
        setNewTierQuantity('');
      }
    }
  };

  const startEditTier = (tier) => {
    setNewTierName(tier.name);
    setNewTierType(tier.type || 'standard');
    setNewTierDesc(tier.description || '');
    setNewTierPrice(tier.price.toString());
    setNewTierQuantity(tier.quantity.toString());
    setEditingTierId(tier.id);
  };

  const cancelEdit = () => {
    setEditingTierId(null);
    setNewTierName('');
    setNewTierType('standard');
    setNewTierDesc('');
    setNewTierPrice('');
    setNewTierQuantity('');
  };

  const selectEventType = (type) => {
    setSelectedEventType(type);
    setShowEventMenu(false);
    setEventModalOpen(true);
    setEventTitle('');
    setEventDesc('');
    setEventDate('');
    setEventPrice('');
    setEventImage(null);
    setEventImageUrl(null);
    setEventCategory('article');
    setEventTicketCount('');
    setEventTime('');
    if (type === 'billet' || type === 'album') {
      if (type === 'billet') {
        setTicketTiers(makeBilletTiers());
      } else {
        setTicketTiers([
          { id: Date.now(), name: 'Digital', type: 'vip', description: 'Téléchargement MP3', price: 50000, quantity: 10 },
          { id: Date.now()+1, name: 'Physique', type: 'standard', description: 'CD + livret', price: 25000, quantity: 50 }
        ]);
      }
    }
  };

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setEventImage(file);
    try { setEventImageUrl(await fileToPersistentUrl(file)); } // data URL : visible aussi côté User
    catch { setEventImageUrl(URL.createObjectURL(file)); }
  };

  const createEvent = async () => {
    if (!eventTitle.trim()) { alert('Veuillez saisir un titre.'); return; }
    if (!myId) { alert('Session expirée : reconnectez-vous pour publier.'); return; }
    if ((selectedEventType === 'article') && !(parseFloat(eventPrice) > 0)) { alert('Veuillez saisir un prix valide (chiffres uniquement, ex : 150 000).'); return; }
    if (selectedEventType === 'article' && !(parseInt(eventTicketCount, 10) > 0)) { alert('Veuillez saisir la quantité en stock.'); return; }
    if ((selectedEventType === 'billet' || selectedEventType === 'album') && ticketTiers.length === 0) { alert('Ajoutez au moins un palier.'); return; }
    if (selectedEventType === 'billet') {
      if (eventDate && new Date(`${eventDate}T${eventTime || '23:59'}:00`) <= new Date()) { alert("La date et l'heure de l'événement sont déjà passées."); return; }
      const bad = ticketTiers.find(t => !(Number(t.price) > 0) || !(parseInt(t.quantity, 10) > 0));
      if (bad) { alert(`Renseignez le prix et le nombre de places de la catégorie ${bad.name} (ou supprimez-la).`); return; }
    }
    try {
      // Image : envoyée sur Cloudinary (pas de gros base64 dans la base)
      let imageUrl = null;
      if (eventImage) { try { imageUrl = (await uploadToCloudinary(eventImage, 'image')).url; } catch { imageUrl = eventImageUrl; } }
      await createEventRow({
        id: Date.now(),
        type: selectedEventType,
        title: eventTitle,
        desc: eventDesc,
        eventDate: eventDate || null,
        eventTime: eventTime || null,
        // Billet : supprimé à la date/heure indiquée ; sans date, 3 h après la publication
        expiresAt: selectedEventType === 'billet'
          ? (eventDate ? new Date(`${eventDate}T${eventTime || '23:59'}:00`) : new Date(Date.now() + 3 * 3600 * 1000)).toISOString()
          : null,
        price: eventPrice,
        image: imageUrl,
        category: eventCategory,
        stock: selectedEventType === 'article' ? parseInt(eventTicketCount, 10) : null,
        tiers: (selectedEventType === 'billet' || selectedEventType === 'album') ? ticketTiers : [],
        published: true,                  // visible tout de suite pour les autres membres (« Retirer » possible ensuite)
        pseudo: userPseudo,
        avatar: userPhoto,
        authorId: myId,                  // seul l'auteur pourra modifier / supprimer
      });
    } catch (err) {
      alert(`Publication impossible : ${err.message}`);
      return;
    }
    if (onCreated) await onCreated();
    setEventModalOpen(false);
    alert('Publication en ligne : les autres membres la voient maintenant.');
  };

  return (
    <>
              <div className="feed-actions">
                <button className="add-event-btn" onClick={() => setShowEventMenu(!showEventMenu)}>
                  <i className="fas fa-image"></i> Ajouter
                </button>
                {showEventMenu && (
                  <div className="event-type-menu">
                    <button onClick={() => selectEventType('scrolle')}>
                      <i className="fas fa-newspaper"></i> Scrolle
                    </button>
                    <button onClick={() => selectEventType('article')}>
                      <i className="fas fa-tags"></i> Vente d'articles
                    </button>
                    <button onClick={() => selectEventType('billet')}>
                      <i className="fas fa-ticket-alt"></i> Vente de billets
                    </button>
                    <button onClick={() => selectEventType('album')}>
                      <i className="fas fa-compact-disc"></i> Album
                    </button>
                  </div>
                )}
              </div>

      {eventModalOpen && (
        <div className="modal-overlay" onClick={() => setEventModalOpen(false)}>
          <div className="modal-content small" onClick={e => e.stopPropagation()}>
            <h3>
              {selectedEventType === 'scrolle' && 'Nouvelle publication'}
              {selectedEventType === 'article' && 'Vendre un article'}
              {selectedEventType === 'billet' && 'Vendre des billets'}
              {selectedEventType === 'album' && 'Vendre un album'}
            </h3>

            <input
              type="text"
              className="input-text"
              placeholder="Titre"
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
            />

            <textarea
              className="input-text"
              placeholder="Description"
              value={eventDesc}
              onChange={(e) => setEventDesc(e.target.value)}
              rows="3"
            />

            <input
              type="file"
              className="input-text"
              accept="image/*"
              onChange={handleImageChange}
            />
            {eventImageUrl && (
              <div style={{ marginTop: '10px' }}>
                <img src={eventImageUrl} alt="Aperçu" style={{ maxWidth: '100%', maxHeight: '150px', borderRadius: '8px' }} />
              </div>
            )}

            {selectedEventType === 'scrolle' && (
              <input
                type="date"
                className="input-text"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
            )}

            {(selectedEventType === 'article' || selectedEventType === 'album') && (
              <>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input-text"
                  placeholder="Prix en Ariary (ex : 150 000)"
                  value={groupThousands(eventPrice)}
                  onChange={(e) => setEventPrice(digitsOnly(e.target.value))}
                />
                {eventPrice && <small style={{ display: 'block', margin: '-4px 0 10px', color: '#aaa' }}>= {formatPrice(eventPrice)}</small>}
                {selectedEventType === 'article' && (
                  <input
                    type="number"
                    min="1"
                    className="input-text"
                    placeholder="Quantité en stock (l'article disparaît à 0)"
                    value={eventTicketCount}
                    onChange={(e) => setEventTicketCount(e.target.value)}
                  />
                )}
                {selectedEventType === 'article' && (
                  <div className="category-select">
                    <label>Type d'article :</label>
                    <select className="privacy-select" value={eventCategory} onChange={(e) => setEventCategory(e.target.value)}>
                      <option value="article">Article (goodie, merch)</option>
                      <option value="album">Album (musique)</option>
                    </select>
                  </div>
                )}
              </>
            )}

            {(selectedEventType === 'billet' || selectedEventType === 'album') && (
              <>
                {selectedEventType === 'billet' && (
                  <label style={{ display: 'block', fontSize: 13, color: '#aaa' }}>Date et heure de l'événement — la vente est supprimée à ce moment-là. Sans date : supprimée 3 h après la publication.</label>
                )}
                {selectedEventType === 'billet' && (
                  <input
                    type="date"
                    className="input-text"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                  />
                )}
                {selectedEventType === 'billet' && eventDate && (
                  <input
                    type="time"
                    className="input-text"
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                  />
                )}

                {selectedEventType === 'billet' ? (
                  <div className="tiers-management">
                    <h4>Billets à vendre</h4>
                    {ticketTiers.map(tier => (
                      <div key={tier.id} className="tier-row tier-row-billet">
                        <span className={`tier-icon tier-${tier.type}`}><i className={tierIconClass(tier.type)}></i></span>
                        <span className="tier-name">{tier.name}</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="Prix (Ar)"
                          value={tier.price ? groupThousands(tier.price) : ''}
                          onChange={(e) => updateTier(tier.id, { price: parseInt(digitsOnly(e.target.value), 10) || 0 })}
                          className="input-text tier-inline-input"
                        />
                        <input
                          type="number"
                          min="0"
                          placeholder="Places"
                          value={tier.quantity || ''}
                          onChange={(e) => updateTier(tier.id, { quantity: e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0 })}
                          className="input-text tier-inline-input"
                        />
                        <div className="tier-actions">
                          <button onClick={() => removeTier(tier.id)} title="Retirer cette catégorie"><i className="fas fa-trash-alt"></i></button>
                        </div>
                        <input
                          type="text"
                          placeholder="Description (optionnelle)"
                          value={tier.description || ''}
                          onChange={(e) => updateTier(tier.id, { description: e.target.value })}
                          className="input-text tier-desc-input"
                        />
                      </div>
                    ))}
                    {TICKET_CATEGORIES.some(c => !ticketTiers.some(t => t.type === c.type)) && (
                      <div className="tier-chips">
                        <span>Ajouter :</span>
                        {TICKET_CATEGORIES.filter(c => !ticketTiers.some(t => t.type === c.type)).map(c => (
                          <button key={c.type} type="button" className="tier-chip" onClick={() => addCategory(c)}>+ {c.name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                <div className="tiers-management">
                  <h4>Paliers de prix</h4>
                  {ticketTiers.map(tier => (
                    <div key={tier.id} className="tier-row">
                      <span className={`tier-icon tier-${tier.type || 'standard'}`}><i className={tierIconClass(tier.type)}></i></span>
                      <span className="tier-name">{tier.name}</span>
                      {tier.description && <span className="tier-desc-small">{tier.description}</span>}
                      <span className="tier-price">{formatPrice(tier.price)}</span>
                      <span className="tier-quantity"><i className="fas fa-chair"></i> {tier.quantity} {selectedEventType === 'album' ? 'unités' : 'places'}</span>
                      <div className="tier-actions">
                        <button onClick={() => startEditTier(tier)}><i className="fas fa-edit"></i></button>
                        <button onClick={() => removeTier(tier.id)}><i className="fas fa-trash-alt"></i></button>
                      </div>
                    </div>
                  ))}
                  <div className="add-tier-form">
                    <input
                      type="text"
                      placeholder="Nom"
                      value={newTierName}
                      onChange={(e) => setNewTierName(e.target.value)}
                      className="input-text tier-input"
                    />
                    <select
                      className="input-text tier-input"
                      value={newTierType}
                      onChange={(e) => setNewTierType(e.target.value)}
                    >
                      <option value="standard">🎟️ Standard</option>
                      <option value="vip">⭐ VIP</option>
                      <option value="reservation">📅 Réservation</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Description (optionnelle)"
                      value={newTierDesc}
                      onChange={(e) => setNewTierDesc(e.target.value)}
                      className="input-text tier-input"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Prix (Ar)"
                      value={groupThousands(newTierPrice)}
                      onChange={(e) => setNewTierPrice(digitsOnly(e.target.value))}
                      className="input-text tier-input"
                    />
                    <input
                      type="number"
                      placeholder={selectedEventType === 'album' ? 'Unités' : 'Places'}
                      value={newTierQuantity}
                      onChange={(e) => setNewTierQuantity(e.target.value)}
                      className="input-text tier-input"
                    />
                    <button className="btn-primary add-tier-btn" onClick={addTier}>
                      {editingTierId ? 'Mettre à jour' : '+'}
                    </button>
                    {editingTierId && (
                      <button className="btn-secondary add-tier-btn" onClick={cancelEdit}>
                        Annuler
                      </button>
                    )}
                  </div>
                </div>
                )}
              </>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <button className="btn-primary" onClick={createEvent}>Publier</button>
              <button className="btn-secondary" onClick={() => setEventModalOpen(false)}>Annuler</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default EventSeller;
