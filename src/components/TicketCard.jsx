// src/components/TicketCard.jsx — billet d'un utilisateur.
//   VVIP / VIP / Gold : carte en couleur (nom, type, photo, QR).  Lite / Silver / Fan Zone : seulement le QR code.
import React from 'react';
import qrcode from 'qrcode-generator';
import { ticketTheme } from '../services/tickets';
import { downloadTicket } from '../services/invoice';
import './SalesProtocol.css';

export const QrSvg = ({ text, size = 180 }) => {
  const qr = qrcode(0, 'M'); qr.addData(String(text)); qr.make();
  const n = qr.getModuleCount();
  const rects = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) rects.push(<rect key={`${r}-${c}`} x={c} y={r} width="1.02" height="1.02" />);
  return <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" fill="#000" role="img" aria-label="QR code">{rects}</svg>;
};

const TicketCard = ({ ticket, showDownload = true }) => {
  const th = ticketTheme(ticket.tier_name);
  const used = ticket.status === 'used';
  const dl = async () => { try { await downloadTicket(ticket); } catch (e) { alert(`Téléchargement impossible : ${e.message}`); } };
  return (
    <div>
      {th.colored ? (
        <div className="ticket" style={{ background: `linear-gradient(135deg, ${th.from}, ${th.to})`, color: th.text, opacity: used ? 0.55 : 1 }}>
          <div className="t-label">{th.label}</div>
          <div className="t-event">{ticket.event_title}</div>
          {ticket.holder_image && <img className="t-photo" src={ticket.holder_image} alt="" />}
          <div className="t-name">{ticket.holder_name}</div>
          <div className="t-qr"><QrSvg text={ticket.id} /></div>
          {used && <div className="t-used">Déjà utilisé</div>}
        </div>
      ) : (
        <div className="ticket qr-only" style={{ opacity: used ? 0.55 : 1 }}>
          <QrSvg text={ticket.id} size={220} />
          {used && <div className="t-used" style={{ color: '#333' }}>Déjà utilisé</div>}
        </div>
      )}
      {showDownload && <button className="btn-secondary" style={{ marginBottom: 14 }} onClick={dl}><i className="fas fa-image" /> Télécharger (JPG)</button>}
    </div>
  );
};
export default TicketCard;
