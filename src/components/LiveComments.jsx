// src/components/LiveComments.jsx
// Commentaires du live : même apparence et mêmes fonctions que les commentaires de la page musique
// (avatar + pseudo, j'aime, répondre, modifier / supprimer ses commentaires, emoji, sticker, image).
import React, { useEffect, useRef, useState } from 'react';
import EmojiPicker from './EmojiPicker';
import { uploadToCloudinary } from '../cloudinaryClient';

const LiveComments = ({ comments, me, isHost, onSend, onLike, onEdit, onDelete }) => {
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);        // { parentId, pseudo }
  const [editing, setEditing] = useState(null);        // { id, parentId, text }
  const [emojiMode, setEmojiMode] = useState(null);    // 'text' | 'sticker' | null
  const [image, setImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const stickToBottom = useRef(true);

  // Défilement automatique vers le dernier commentaire (sauf si on relit plus haut)
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [comments]);

  const submit = () => {
    const ok = onSend({ text, parentId: replyTo?.parentId || null, image });
    if (ok !== false) { setText(''); setImage(null); setReplyTo(null); }
  };

  const pickEmoji = (emoji) => {
    if (emojiMode === 'sticker') onSend({ text: emoji, parentId: replyTo?.parentId || null, sticker: true });
    else setText((t) => t + emoji);
    setEmojiMode(null);
  };

  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try { setImage((await uploadToCloudinary(file, 'image')).url); }
    catch (err) { alert("Échec de l'envoi de l'image : " + err.message); }
    finally { setUploading(false); }
  };

  const renderBody = (c, textClass) => (
    editing?.id === c.id ? (
      <div className="comment-edit-area">
        <textarea className="comment-edit-textarea" rows={2} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
        <div className="comment-edit-actions">
          <button className="comment-edit-save" onClick={() => { onEdit(editing.id, editing.parentId, editing.text); setEditing(null); }}>Enregistrer</button>
          <button className="comment-edit-cancel" onClick={() => setEditing(null)}>Annuler</button>
        </div>
      </div>
    ) : (
      <>
        {c.text && <div className={`${textClass}${c.sticker ? ' comment-sticker' : ''}`}>{c.text}{c.edited && <small className="comment-edited"> (modifié)</small>}</div>}
        {c.image && <img src={c.image} alt="" className="comment-image" />}
      </>
    )
  );

  const ownerActions = (c, parentId, deleteClass) => {
    const own = c.authorId === me.id;
    if ((!own && !isHost) || editing?.id === c.id) return null;
    return (
      <div className="comment-owner-actions">
        {own && !c.sticker && <button className="comment-edit" title="Modifier" onClick={() => setEditing({ id: c.id, parentId, text: c.text })}><i className="fas fa-pen"></i></button>}
        <button className={deleteClass} title="Supprimer" onClick={() => { if (window.confirm('Supprimer ce commentaire ?')) onDelete(c.id, parentId); }}><i className="fas fa-trash-alt"></i></button>
      </div>
    );
  };

  return (
    <div className="comments-section-enhanced live-comments">
      <div
        className="comments-list"
        ref={listRef}
        onScroll={(e) => { const el = e.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
      >
        {comments.length === 0 ? (
          <div className="no-comments">Aucun commentaire. Soyez le premier à écrire !</div>
        ) : comments.map((comment) => (
          <div key={comment.id} className="comment-item-enhanced">
            <div className="comment-header">
              <img src={comment.avatar} alt="avatar" className="comment-avatar" />
              <div className="comment-meta">
                <span className="comment-pseudo">{comment.pseudo}</span>
                <span className="comment-timestamp">{comment.timestamp}</span>
              </div>
              {ownerActions(comment, null, 'comment-delete')}
            </div>
            {renderBody(comment, 'comment-text')}
            <div className="comment-actions">
              <button className={`comment-react ${comment.likes.includes(me.id) ? 'active' : ''}`} onClick={() => onLike(comment.id, null, comment.likes.includes(me.id))}>
                <i className="fas fa-thumbs-up"></i> {comment.likes.length > 0 && comment.likes.length}
              </button>
              <button className="comment-reply" onClick={() => setReplyTo({ parentId: comment.id, pseudo: comment.pseudo })}>
                <i className="fas fa-reply"></i> Répondre
              </button>
            </div>
            {comment.replies.map((reply) => (
              <div key={reply.id} className="reply-item-enhanced">
                <div className="reply-header">
                  <img src={reply.avatar} alt="avatar" className="reply-avatar" />
                  <div className="reply-meta">
                    <span className="reply-pseudo">{reply.pseudo}</span>
                    <span className="reply-timestamp">{reply.timestamp}</span>
                  </div>
                  {ownerActions(reply, comment.id, 'reply-delete')}
                </div>
                {renderBody(reply, 'reply-text')}
                <div className="reply-actions">
                  <button className={`reply-react ${reply.likes.includes(me.id) ? 'active' : ''}`} onClick={() => onLike(reply.id, comment.id, reply.likes.includes(me.id))}>
                    <i className="fas fa-thumbs-up"></i> {reply.likes.length > 0 && reply.likes.length}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="comment-input-area">
        <div className="input-tools">
          <button type="button" className={`tool-btn ${emojiMode === 'text' ? 'active' : ''}`} onClick={() => setEmojiMode(emojiMode === 'text' ? null : 'text')} title="Ajouter un emoji dans le texte"><i className="fas fa-smile-wink"></i></button>
          <button type="button" className={`tool-btn ${emojiMode === 'sticker' ? 'active' : ''}`} onClick={() => setEmojiMode(emojiMode === 'sticker' ? null : 'sticker')} title="Envoyer un emoji seul, en grand"><i className="far fa-sticky-note"></i></button>
          <button type="button" className="tool-btn" onClick={() => fileRef.current?.click()} disabled={uploading} title="Ajouter une image"><i className="fas fa-image"></i></button>
          <input type="file" ref={fileRef} style={{ display: 'none' }} accept="image/*" onChange={pickImage} />
        </div>
        {uploading && <div className="uploading-indicator"><i className="fas fa-spinner fa-spin"></i> Envoi en cours...</div>}
        {image && (
          <div className="temp-image-preview">
            <img src={image} alt="aperçu" />
            <button onClick={() => setImage(null)}><i className="fas fa-times-circle"></i></button>
          </div>
        )}
        <div className="input-wrapper">
          <input
            type="text"
            placeholder={replyTo ? `Répondre à ${replyTo.pseudo}...` : 'Ajouter un commentaire...'}
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          <button className="send-btn" onClick={submit} aria-label="Envoyer"><i className="fas fa-arrow-right"></i></button>
        </div>
        {replyTo && (
          <div className="reply-cancel"><button onClick={() => setReplyTo(null)}>Annuler la réponse</button></div>
        )}
        {emojiMode && <EmojiPicker onSelect={pickEmoji} onClose={() => setEmojiMode(null)} />}
      </div>
    </div>
  );
};

export default LiveComments;
