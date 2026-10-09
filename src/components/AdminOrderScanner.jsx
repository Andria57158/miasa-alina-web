// src/components/AdminOrderScanner.jsx
// Page Admin « Commandes » : Commandes (articles) · Billets à valider · Invités · Scanner QR.
//   npm install html5-qrcode
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  listAllOrders, subscribeOrders, scanCode, isOrderId, decideOrder, deliverManually,
  STATUS_LABEL, STATUS_COLOR, hasInvoice, isOrderDone, loadOrderWithItems,
} from '../services/orders';
import { listAllTickets, subscribeTickets } from '../services/tickets';
import { downloadInvoice } from '../services/invoice';
import useProfiles from '../hooks/useProfiles';
import './SalesProtocol.css';

const no = (o) => String(o.invoice_no).padStart(6, '0');
const fmt = (n) => `${(Number(n) || 0).toLocaleString('fr-FR')} Ar`;
const lines = (o) => (o.items || []).map((i) => `${i.event_title} (${i.tier_name}) ×${i.quantity}`).join(', ');

const AdminOrderScanner = () => {
  const [tab, setTab] = useState('commandes');
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);     // { ok, text }
  const [busyId, setBusyId] = useState(null);
  const [guestQuery, setGuestQuery] = useState('');
  const [stepA, setStepA] = useState('avalider');   // commandes : avalider | alivrer | terminees | refusees
  const [stepB, setStepB] = useState('avalider');   // billets   : avalider | acceptes | refuses
  const scannerRef = useRef(null);
  const busy = useRef(false);

  const refresh = useCallback(() => {
    listAllOrders().then(setOrders).catch(() => {});
    listAllTickets().then(setTickets).catch(() => {});
  }, []);
  useEffect(() => { refresh(); const a = subscribeOrders(refresh); const b = subscribeTickets(refresh); return () => { a(); b(); }; }, [refresh]);

  const { profileOf } = useProfiles(useMemo(() => [...new Set(orders.map((o) => o.user_id).filter(Boolean))], [orders]));

  const articles = orders.filter((o) => o.kind !== 'billet');
  const ticketOrders = orders.filter((o) => o.kind === 'billet');
  const pendingArticles = articles.filter((o) => o.status === 'en_attente');
  const pendingTickets = ticketOrders.filter((o) => o.status === 'en_attente');
  const guests = tickets.filter((t) => t.status === 'valid');       // un billet scanné sort de la liste
  const present = tickets.length - guests.length;

  const stepOf = (o) => (o.status === 'en_attente' ? 'avalider' : o.status === 'acceptee' ? 'alivrer' : o.status === 'refusee' ? 'refusees' : 'terminees');
  const shownArticles = articles.filter((o) => stepOf(o) === stepA);
  const shownTickets = ticketOrders.filter((o) => (stepB === 'avalider' ? o.status === 'en_attente' : stepB === 'acceptes' ? ['acceptee'].includes(o.status) : o.status === 'refusee'));
  const toDeliver = articles.filter((o) => o.status === 'acceptee').length;
  const Chips = ({ value, set, items }) => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
      {items.map(([id, label, n]) => (
        <button key={id} className={value === id ? 'btn-primary' : 'btn-secondary'} style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => set(id)}>{label} ({n})</button>
      ))}
    </div>
  );

  // ---- Accepter / refuser ----
  const decide = async (o, accept) => {
    if (!accept && !window.confirm(`Refuser la demande n°${no(o)} ?`)) return;
    setBusyId(o.id);
    try {
      await decideOrder(o.id, accept);
      setResult({ ok: true, text: accept ? `Demande n°${no(o)} acceptée${o.kind === 'billet' ? ' — invité(s) ajouté(s)' : ' — facture envoyée au client'}.` : `Demande n°${no(o)} refusée.` });
      refresh();
    } catch (e) { setResult({ ok: false, text: e.message }); }
    finally { setBusyId(null); }
  };

  const markDelivered = async (o) => {
    if (!window.confirm(`Confirmer que la commande n°${no(o)} a bien été livrée ?`)) return;
    setBusyId(o.id);
    try { await deliverManually(o.id); setResult({ ok: true, text: `Commande n°${no(o)} : Livré.` }); refresh(); }
    catch (e) { setResult({ ok: false, text: e.message }); }
    finally { setBusyId(null); }
  };

  const invoice = async (o, format) => {
    try { await downloadInvoice(await loadOrderWithItems(o.id), { format }); } catch (e) { alert(`Facture indisponible : ${e.message}`); }
  };

  // ---- Scanner ----
  const stop = useCallback(async () => {
    const s = scannerRef.current; scannerRef.current = null;
    if (s) { try { await s.stop(); } catch { /* déjà arrêté */ } try { s.clear(); } catch { /* ignore */ } }
    setScanning(false);
  }, []);

  const onDecoded = useCallback(async (text) => {
    if (busy.current || !isOrderId(text)) return;       // un seul scan à la fois, ignore les QR étrangers
    busy.current = true;
    try {
      const r = await scanCode(text);
      if (r.kind === 'ticket') {
        setResult(r.already_done
          ? { ok: false, text: `Billet déjà utilisé : ${r.holder || 'invité'} (${r.tier})` }
          : { ok: true, text: `Bienvenue ${r.holder || ''} — ${r.tier} · ${r.event}. Retiré de la liste des invités.` });
      } else {
        const n = String(r.invoice_no).padStart(6, '0');
        setResult(r.already_done
          ? { ok: false, text: `Facture n°${n} déjà ${r.status === 'livre' ? 'livrée' : 'validée'}.` }
          : { ok: true, text: `Facture n°${n} : Validé.` });
      }
      refresh();
    } catch (e) { setResult({ ok: false, text: e.message }); }
    finally { setTimeout(() => { busy.current = false; }, 2500); }
  }, [refresh]);

  const start = async () => {
    setResult(null); setScanning(true);
    try {
      const s = new Html5Qrcode('order-qr-reader');
      scannerRef.current = s;
      await s.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, onDecoded, () => {});
    } catch { setResult({ ok: false, text: 'Caméra inaccessible. Autorisez-la dans le navigateur.' }); await stop(); }
  };
  useEffect(() => () => { stop(); }, [stop]);
  useEffect(() => { if (tab !== 'scan') stop(); }, [tab, stop]);   // le lecteur s'arrête quand on quitte l'onglet

  const who = (o) => { const p = profileOf(o.user_id); return p?.pseudo && p.pseudo !== 'Membre' ? p.pseudo : 'Client'; };

  const Tab = ({ id, icon, label, n }) => (
    <button className={tab === id ? 'btn-primary' : 'btn-secondary'} style={{ flex: '1 1 auto' }} onClick={() => setTab(id)}>
      <i className={`fas ${icon}`} /> {label}{n ? ` (${n})` : ''}
    </button>
  );

  return (
    <div className="order-scanner">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Tab id="commandes" icon="fa-shopping-bag" label="Commandes" n={pendingArticles.length + toDeliver} />
        <Tab id="billets" icon="fa-ticket-alt" label="Billets à valider" n={pendingTickets.length} />
        <Tab id="invites" icon="fa-users" label="Invités" n={guests.length} />
        <Tab id="scan" icon="fa-qrcode" label="Scanner" />
      </div>

      {result && <p role="status" style={{ color: result.ok ? '#00C851' : '#ff7043', fontWeight: 600 }}>{result.ok ? '✔ ' : '⚠ '}{result.text}</p>}

      {/* ===== COMMANDES (articles) ===== */}
      {tab === 'commandes' && <Chips value={stepA} set={setStepA} items={[
        ['avalider', 'À valider', pendingArticles.length], ['alivrer', 'À livrer', toDeliver],
        ['terminees', 'Validées / livrées', articles.filter((o) => stepOf(o) === 'terminees').length], ['refusees', 'Refusées', articles.filter((o) => o.status === 'refusee').length]]} />}
      {tab === 'commandes' && (shownArticles.length === 0 ? <p className="sp-muted">Rien dans cette liste.</p> : shownArticles.map((o) => (
        <div key={o.id} className="sp-card">
          {isOrderDone(o) && <span className="sp-stamp">{o.status === 'livre' ? 'LIVRÉ' : 'VALIDÉ'}</span>}
          <div className="sp-row"><strong>n°{no(o)} — {who(o)}</strong><span className="sp-muted">{new Date(o.created_at).toLocaleString('fr-FR')}</span></div>
          <div>{lines(o)}</div>
          <div className="sp-muted">
            Envoyeur : {o.sender_phone} · Transaction : {o.transaction_no}<br />
            <i className="fas fa-map-marker-alt" /> {o.delivery_place}
          </div>
          <div className="sp-row" style={{ marginTop: 6 }}>
            <span>{fmt(o.total)}</span>
            <span className="sp-badge" style={{ color: STATUS_COLOR[o.status] }}>{STATUS_LABEL[o.status] || o.status}</span>
          </div>
          <div className="sp-actions">
            {o.status === 'en_attente' && (<>
              <button className="btn-primary" disabled={busyId === o.id} onClick={() => decide(o, true)}>Valider la commande</button>
              <button className="btn-secondary" disabled={busyId === o.id} onClick={() => decide(o, false)}>Refuser</button>
            </>)}
            {o.status === 'acceptee' && (
              <button className="btn-primary" disabled={busyId === o.id} onClick={() => markDelivered(o)}>
                <i className="fas fa-check" /> Livré (sans facture)
              </button>
            )}
            {hasInvoice(o) && (<>
              <button className="btn-secondary" onClick={() => invoice(o, 'pdf')}><i className="fas fa-file-pdf" /> PDF</button>
              <button className="btn-secondary" onClick={() => invoice(o, 'jpg')}><i className="fas fa-file-image" /> JPG</button>
            </>)}
          </div>
        </div>
      )))}

      {/* ===== BILLETS À VALIDER ===== */}
      {tab === 'billets' && <Chips value={stepB} set={setStepB} items={[
        ['avalider', 'À valider', pendingTickets.length], ['acceptes', 'Acceptés', ticketOrders.filter((o) => o.status === 'acceptee').length],
        ['refuses', 'Refusés', ticketOrders.filter((o) => o.status === 'refusee').length]]} />}
      {tab === 'billets' && (shownTickets.length === 0 ? <p className="sp-muted">Rien dans cette liste.</p> : shownTickets.map((o) => (
        <div key={o.id} className="sp-card">
          <div className="sp-row"><strong>n°{no(o)} — {o.sender_name || who(o)}</strong><span className="sp-muted">{new Date(o.created_at).toLocaleString('fr-FR')}</span></div>
          <div>{lines(o)}</div>
          <div className="sp-muted">Numéro de l'envoyeur : {o.sender_phone} · Nom : {o.sender_name}</div>
          <div className="sp-row" style={{ marginTop: 6 }}>
            <span>{fmt(o.total)}</span>
            <span className="sp-badge" style={{ color: STATUS_COLOR[o.status] }}>{STATUS_LABEL[o.status] || o.status}</span>
          </div>
          {o.status === 'en_attente' && (
            <div className="sp-actions">
              <button className="btn-primary" disabled={busyId === o.id} onClick={() => decide(o, true)}>Accepter</button>
              <button className="btn-secondary" disabled={busyId === o.id} onClick={() => decide(o, false)}>Refuser</button>
            </div>
          )}
        </div>
      )))}

      {/* ===== LISTE DES INVITÉS ===== */}
      {tab === 'invites' && (
        <>
          <p className="sp-muted">{guests.length} invité(s) attendu(s) · {present} déjà présent(s)</p>
          <input className="input-text" placeholder="Rechercher un invité…" value={guestQuery} onChange={(e) => setGuestQuery(e.target.value)} style={{ marginBottom: 10, width: '100%', boxSizing: 'border-box' }} />
          {guests.filter((t) => `${t.holder_name} ${t.event_title} ${t.tier_name}`.toLowerCase().includes(guestQuery.toLowerCase())).map((t) => (
            <div key={t.id} className="sp-card sp-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {t.holder_image && <img src={t.holder_image} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />}
                <span><strong>{t.holder_name}</strong><div className="sp-muted">{t.event_title}</div></span>
              </span>
              <span className="sp-badge">{t.tier_name}</span>
            </div>
          ))}
          {guests.length === 0 && <p className="sp-muted">La liste est vide.</p>}
        </>
      )}

      {/* ===== SCANNER ===== */}
      {tab === 'scan' && (
        <>
          <p className="sp-muted">Scannez la facture (livraison) ou le billet (entrée).</p>
          <button className="btn-primary" onClick={scanning ? stop : start}>{scanning ? 'Arrêter le scan' : 'Scanner un QR code'}</button>
          <div id="order-qr-reader" style={{ width: '100%', maxWidth: 360, margin: '12px auto' }} />
        </>
      )}
    </div>
  );
};
export default AdminOrderScanner;
