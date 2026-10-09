// src/components/NotificationsPanel.jsx — liste des notifications réelles + bulle « nouvelle notification » + pastille.
import React, { useEffect } from 'react';
import { storyTimeLabel } from './StoryEngagement';
import './NotificationsPanel.css';

const DEFAULT_AVATAR = 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
// Onglet à ouvrir selon le type de notification
export const tabOf = (n) => ({
  friend_request: 'amis', friend_accepted: 'amis', message: 'messages',
  order_new: 'events', order_accepted: 'events', order_refused: 'events', order_done: 'events', order_delivered: 'events', ticket_ready: 'events', ticket_used: 'events',
}[n.kind] || 'feed');

export const Badge = ({ count }) => (count > 0 ? <span className="notif-badge">{count > 99 ? '99+' : count}</span> : null);

const Item = ({ n, onOpen, onRemove }) => (
  <div className={`notif-item${n.read_at ? '' : ' unread'}`} onClick={() => onOpen(n)} role="button" tabIndex={0}>
    <span className="notif-avatar">
      <img src={n.actor?.photo_url || DEFAULT_AVATAR} alt="" />
      <i className={`fas ${n.icon || 'fa-bell'}`} style={{ background: n.color || '#E22134' }} />
    </span>
    <span className="notif-main">
      <span className="notif-text">{n.body}</span>
      <span className="notif-time">{storyTimeLabel(n.created_at)}</span>
    </span>
    {!n.read_at && <span className="notif-dot" aria-label="Non lue" />}
    <button className="notif-del" aria-label="Supprimer" onClick={(e) => { e.stopPropagation(); onRemove(n.id); }}><i className="fas fa-times" /></button>
  </div>
);

const NotificationsPanel = ({ notif, search = '', onNavigate }) => {
  const q = search.trim().toLowerCase();
  const list = notif.items.filter((n) => !q || n.body.toLowerCase().includes(q));
  const open = (n) => { notif.markRead([n.id]); onNavigate && onNavigate(tabOf(n), n); };
  return (
    <div className="notif-panel">
      {notif.unread > 0 && (
        <button className="btn-secondary notif-readall" onClick={() => notif.markRead()}><i className="fas fa-check-double" /> Tout marquer comme lu ({notif.unread})</button>
      )}
      {list.length === 0
        ? <p className="notif-empty">{notif.items.length === 0 ? 'Aucune notification pour le moment.' : 'Aucun résultat.'}</p>
        : list.map((n) => <Item key={n.id} n={n} onOpen={open} onRemove={notif.remove} />)}
    </div>
  );
};
export default NotificationsPanel;

// Bulle qui apparaît quelques secondes quand une notification arrive en direct (n'importe quel onglet)
export const NotificationToast = ({ notif, onNavigate }) => {
  const n = notif.latest;
  useEffect(() => { if (!n) return undefined; const t = setTimeout(notif.clearLatest, 5000); return () => clearTimeout(t); }, [n]); // eslint-disable-line
  if (!n) return null;
  return (
    <div className="notif-toast" role="status" onClick={() => { notif.markRead([n.id]); notif.clearLatest(); onNavigate && onNavigate(tabOf(n), n); }}>
      <i className={`fas ${n.icon || 'fa-bell'}`} style={{ color: n.color || '#E22134' }} />
      <span>{n.body}</span>
    </div>
  );
};
