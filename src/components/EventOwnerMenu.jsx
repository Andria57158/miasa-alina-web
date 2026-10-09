// src/components/EventOwnerMenu.jsx
// Menu « ⋯ » d'une publication : Modifier / Supprimer. N'apparaît QUE pour l'auteur de la publication.
// Utilisé par la page Admin ET la page User (même règle partout).
import React, { useState, useEffect } from 'react';
import { isOwner, updateEventRow, deleteEventRow } from '../services/vipEvents';
import './EventOwnerMenu.css';

const EventOwnerMenu = ({ evt, myId, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  if (!isOwner(evt, myId)) return null;   // pas l'auteur → aucun bouton

  const hasTiers = Array.isArray(evt.tiers) && evt.tiers.length > 0;

  const startEdit = () => {
    setF({
      title: evt.title || '',
      desc: evt.desc || '',
      price: evt.price ?? '',
      stock: evt.stock ?? '',
      eventDate: evt.eventDate || '',
      tiers: (evt.tiers || []).map(t => ({ ...t })),
    });
    setEditing(true);
    setOpen(false);
  };
  const setTier = (id, patch) => setF(p => ({ ...p, tiers: p.tiers.map(t => (t.id === id ? { ...t, ...patch } : t)) }));

  const save = async () => {
    if (!f.title.trim()) return alert('Le titre est obligatoire.');
    const patch = { title: f.title.trim(), desc: f.desc };
    if (evt.type === 'article') {
      if (!(Number(f.price) > 0)) return alert('Veuillez saisir un prix valide.');
      patch.price = Number(f.price);
      patch.stock = f.stock === '' ? null : Math.max(0, parseInt(f.stock, 10) || 0);
    } else if (hasTiers) {
      patch.tiers = f.tiers.map(t => ({ ...t, price: Number(t.price) || 0, quantity: Math.max(0, parseInt(t.quantity, 10) || 0) }));
    }
    if (evt.type === 'billet') {
      patch.eventDate = f.eventDate || null;
      patch.expiresAt = f.eventDate ? new Date(`${f.eventDate}T23:59:59`).toISOString() : evt.expiresAt;
    }
    setBusy(true);
    try { await updateEventRow(evt.id, myId, patch); setEditing(false); onChanged && onChanged(); }
    catch (e) { alert('Modification impossible : ' + e.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setOpen(false);
    if (!window.confirm(`Supprimer définitivement « ${evt.title} » ?`)) return;
    try { await deleteEventRow(evt.id, myId); onChanged && onChanged(); }
    catch (e) { alert('Suppression impossible : ' + e.message); }
  };

  return (
    <>
      <div className="event-owner-menu" onClick={(e) => e.stopPropagation()}>
        <button className="event-post-more-btn" onClick={() => setOpen(o => !o)} title="Options"><i className="fas fa-ellipsis-h"></i></button>
        {open && (
          <div className="event-owner-dropdown">
            <button onClick={startEdit}><i className="fas fa-pen"></i> Modifier</button>
            <button className="danger" onClick={remove}><i className="fas fa-trash-alt"></i> Supprimer</button>
          </div>
        )}
      </div>

      {editing && f && (
        <div className="modal-overlay" onClick={() => setEditing(false)}>
          <div className="modal-content small" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEditing(false)}>&times;</button>
            <h3><i className="fas fa-pen"></i> Modifier la publication</h3>
            <input className="input-text" placeholder="Titre" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            <textarea className="input-text" rows="3" placeholder="Description" value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} />
            {evt.type === 'article' && (
              <>
                <input className="input-text" type="number" min="0" placeholder="Prix (Ar)" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
                <input className="input-text" type="number" min="0" placeholder="Nombre d'articles en stock" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} />
              </>
            )}
            {evt.type === 'billet' && (
              <input className="input-text" type="date" value={f.eventDate} onChange={(e) => setF({ ...f, eventDate: e.target.value })} />
            )}
            {evt.type !== 'article' && hasTiers && (
              <div className="tiers-management">
                <h4>{evt.type === 'album' ? 'Paliers' : 'Catégories de billets'}</h4>
                {f.tiers.map(t => (
                  <div key={t.id} className="tier-row tier-row-billet">
                    <span className="tier-name">{t.name}</span>
                    <input className="input-text tier-inline-input" type="number" min="0" placeholder="Prix (Ar)" value={t.price} onChange={(e) => setTier(t.id, { price: e.target.value })} />
                    <input className="input-text tier-inline-input" type="number" min="0" placeholder={evt.type === 'album' ? 'Unités' : 'Places'} value={t.quantity} onChange={(e) => setTier(t.id, { quantity: e.target.value })} />
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
              <button className="btn-secondary" onClick={() => setEditing(false)}>Annuler</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default EventOwnerMenu;
