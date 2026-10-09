// src/components/PostCard.jsx — publication comme un post Facebook (voir l'image de référence) :
//   avatar + nom + « Publié par … · date · 🌐 » + « ⋯ », texte avec « … Voir plus », grande image,
//   barre d'action (lien à gauche, bouton rouge à droite), puis la barre Réagir / Commenter des stories.
// Thème : celui de l'application (sombre + rouge). <PostCard light /> pour la variante claire.
import React, { useState } from 'react';
import './PostCard.css';

const MAX_LINES = 3;
const MAX_CHARS = 150;

// Coupe le texte à 3 lignes / 150 caractères ; renvoie { short, cut }
const clip = (text) => {
  const lines = String(text || '').split('\n').filter((l) => l.trim() !== '');
  let short = lines.slice(0, MAX_LINES).join('\n');
  let cut = lines.length > MAX_LINES;
  if (short.length > MAX_CHARS) { short = short.slice(0, MAX_CHARS).trimEnd(); cut = true; }
  return { short, cut };
};

/**
 * evt        : publication (title, desc, image, pseudo, avatar, date)
 * menu       : nœud affiché à droite de l'en-tête (ex. <EventOwnerMenu/>)
 * extra      : nœud sous l'image (prix, stock, catégories de billets…)
 * barLink    : { label, onClick }   lien bleu à gauche de la barre (ex. « Voir les commandes »)
 * cta        : { label, onClick, disabled, secondary }   bouton à droite de la barre (ex. « Panier », « Publier »)
 * engagement : <EventEngagementBar …/> (mêmes réactions et commentaires que les stories)
 * hiddenNote : texte « masqué pour les clients » (admin)
 */
const PostCard = ({ evt, fallbackAvatar, fallbackName, menu, extra, barLink, cta, fire, comments, hiddenNote, light, engagement, onOpen }) => {
  const [open, setOpen] = useState(false);
  const { short, cut } = clip(evt.desc);
  const showAll = open || !cut;

  return (
    <article className={`post-card${light ? ' light' : ''}`}>
      <header className="post-card-head">
        <img className="post-card-avatar" src={evt.avatar || fallbackAvatar} alt="" />
        <div className="post-card-who">
          <span className="post-card-name">{evt.pseudo || fallbackName}</span>
          <span className="post-card-meta">Publié par VIP · {evt.date || "À l'instant"} · <i className="fas fa-globe-africa" aria-label="Public" /></span>
        </div>
        {menu && <div className="post-card-menu">{menu}</div>}
      </header>

      {hiddenNote && <span className="post-card-hidden">{hiddenNote}</span>}

      <div className="post-card-text" onClick={onOpen} style={onOpen ? { cursor: 'pointer' } : undefined}>
        {evt.title && <span className="post-card-title">{evt.title}</span>}
        {showAll ? evt.desc : short}
        {cut && !open && <>… <button type="button" className="post-card-more" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>Voir plus</button></>}
      </div>

      {evt.image && <img className="post-card-media" src={evt.image} alt={evt.title || ''} loading="lazy" onClick={onOpen} style={onOpen ? { cursor: 'pointer' } : undefined} />}
      {extra && <div className="post-card-extra">{extra}</div>}

      {(barLink || cta) && (
        <div className="post-card-bar">
          {barLink ? <button type="button" className="post-card-barlink" onClick={barLink.onClick}>{barLink.label}</button> : <span />}
          {cta && <button type="button" className={`post-card-cta${cta.secondary ? ' secondary' : ''}`} disabled={cta.disabled} onClick={cta.onClick}>{cta.label}</button>}
        </div>
      )}

      {engagement}
    </article>
  );
};
export default PostCard;
