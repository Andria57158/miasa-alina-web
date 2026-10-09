// src/components/CheckoutForm.jsx — formulaire d'achat envoyé à l'admin.
//   mode 'article' : numéro de l'envoyeur, numéro de transaction, lieu de livraison
//   mode 'billet'  : numéro de l'envoyeur, nom de l'envoyeur
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import './SalesProtocol.css';

const CheckoutForm = ({ mode, total, onSubmit, onCancel, submitLabel = 'Acheter' }) => {
  const [f, setF] = useState({ senderPhone: '', senderName: '', transactionNo: '', deliveryPlace: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // Le membre est déjà inscrit : on propose son numéro de téléphone (modifiable)
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(async ({ data }) => {
      const id = data?.user?.id; if (!id) return;
      const { data: u } = await supabase.from('users').select('telephone').eq('id', id).maybeSingle();
      if (alive && u?.telephone) setF((p) => (p.senderPhone ? p : { ...p, senderPhone: u.telephone }));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    const phone = f.senderPhone.replace(/[\s.-]/g, '');
    if (!/^\+?\d{9,13}$/.test(phone)) return setErr("Numéro de l'envoyeur invalide.");
    if (mode === 'article') {
      if (f.transactionNo.trim().length < 4) return setErr('Numéro de transaction invalide.');
      if (f.deliveryPlace.trim().length < 3) return setErr('Indiquez le lieu de livraison.');
    } else if (f.senderName.trim().length < 2) return setErr("Indiquez le nom de l'envoyeur.");
    setErr(''); setBusy(true);
    try { await onSubmit({ ...f, senderPhone: phone }); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <label className="sp-field">Numéro de l'envoyeur
        <input className="input-text" inputMode="tel" placeholder="034 00 000 00" value={f.senderPhone} onChange={set('senderPhone')} />
      </label>
      {mode === 'article' ? (
        <>
          <label className="sp-field">Numéro de transaction
            <input className="input-text" value={f.transactionNo} onChange={set('transactionNo')} />
          </label>
          <label className="sp-field">Lieu de livraison
            <input className="input-text" value={f.deliveryPlace} onChange={set('deliveryPlace')} />
          </label>
        </>
      ) : (
        <label className="sp-field">Nom de l'envoyeur
          <input className="input-text" value={f.senderName} onChange={set('senderName')} />
        </label>
      )}
      {total != null && <p style={{ marginTop: 12 }}>Total à payer : <strong>{(Number(total) || 0).toLocaleString('fr-FR')} Ar</strong></p>}
      {err && <p className="sp-err" role="alert">{err}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Envoi…' : submitLabel}</button>
        <button className="btn-secondary" disabled={busy} onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
};
export default CheckoutForm;
