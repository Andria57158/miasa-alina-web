// src/components/StoryEngagement.jsx
// Réactions + commentaires des stories : MÊME logique et MÊME apparence que la page Musique
// (copié de AdminMusique.jsx, avec story_id à la place de song_id).
// Nécessite les colonnes story_id (voir story_engagement.sql).
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { uploadToCloudinary } from '../cloudinaryClient';
import EmojiPicker from './EmojiPicker';
import { buildVoiceBubbleHtml } from '../utils/voiceBubble';
import { cleanHtml } from '../utils/sanitizeHtml';
import './StoryEngagement.css';

const emptyReactions = () => ({ like: 0, heart: 0, fire: 0, dislike: 0 });

const useReactions = (column, targetId, currentUserId) => {
  const [reactions, setReactions] = useState(emptyReactions());
  const [userReaction, setUserReaction] = useState(null);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setReactions(emptyReactions());
    setUserReaction(null);
    const load = async () => {
      const { data, error } = await supabase
        .from('reactions').select('type, user_id').eq(column, targetId);
      if (error) { console.error('Erreur chargement réactions :', error); return; }
      if (cancelled) return;
      const counts = emptyReactions();
      let mine = null;
      (data || []).forEach(r => {
        if (counts[r.type] !== undefined) counts[r.type] += 1;
        if (r.user_id === currentUserId) mine = r.type;
      });
      setReactions(counts);
      setUserReaction(mine);
    };
    load();
    return () => { cancelled = true; };
  }, [column, targetId, currentUserId]);

  const handleReaction = async (type) => {
    if (busy.current) return;
    busy.current = true;

    const prevReactions = reactions;
    const prevUserReaction = userReaction;
    const isRemoving = prevUserReaction === type;

    // Mise à jour immédiate de l'écran (annulée si Supabase refuse)
    const updated = { ...prevReactions };
    if (isRemoving) {
      updated[type] = Math.max(0, updated[type] - 1);
    } else {
      if (prevUserReaction) updated[prevUserReaction] = Math.max(0, updated[prevUserReaction] - 1);
      updated[type] += 1;
    }
    setReactions(updated);
    setUserReaction(isRemoving ? null : type);

    let error;
    if (isRemoving) {
      ({ error } = await supabase.from('reactions').delete()
        .eq(column, targetId).eq('user_id', currentUserId));
    } else {
      ({ error } = await supabase.from('reactions').upsert(
        { [column]: targetId, user_id: currentUserId, type },
        { onConflict: `user_id,${column}` }
      ));
    }
    if (error) {
      console.error('Erreur réaction :', error);
      setReactions(prevReactions);
      setUserReaction(prevUserReaction);
      alert('Erreur lors de l\'enregistrement de la réaction : ' + error.message);
    }
    busy.current = false;
  };

  return { reactions, userReaction, handleReaction };
};

const emojiStickerHtml = (emoji) =>
  `<span class="emoji-sticker" style="display:inline-block;font-size:64px;line-height:1.15;margin:4px 0;">${emoji}</span>`;

const canModifyComment = (item, currentUserId) =>
  !!currentUserId && item.authorId === currentUserId;

// ========== SECTION COMMENTAIRES (identique à la page musique, pour les stories) ==========
const CommentSection = ({ storyId, currentUserId, currentUserAvatar, currentUserPseudo, column = 'story_id' }) => {
  const [comments, setComments] = useState([]);
  const [newCommentText, setNewCommentText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiMode, setEmojiMode] = useState('text'); // 'text' = emoji dans le texte | 'sticker' = emoji envoyé seul comme image
  const [tempImage, setTempImage] = useState(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const fileInputRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const recordedSecondsRef = useRef(0);
  const recordStartRef = useRef(0); // début de l'enregistrement (pour la durée affichée)
  const [pendingVoice, setPendingVoice] = useState(null); // { url, html } — vocal enregistré, pas encore envoyé
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const mapComment = (c, likeCounts, userLikedSet) => ({
    id: c.id,
    authorId: c.author_id,
    pseudo: c.pseudo,
    avatar: c.avatar_url,
    text: c.text,
    timestamp: new Date(c.created_at).toLocaleTimeString(),
    likes: likeCounts[c.id] || 0,
    userLiked: userLikedSet.has(c.id)
  });

  const fetchComments = async () => {
    const { data: rows, error } = await supabase
      .from('comments').select('*').eq(column, storyId).order('created_at', { ascending: true });
    if (error) { console.error('Erreur chargement commentaires :', error); return; }

    const ids = (rows || []).map(r => r.id);
    let likeRows = [];
    if (ids.length > 0) {
      const { data } = await supabase.from('comment_likes').select('comment_id, user_id').in('comment_id', ids);
      likeRows = data || [];
    }
    const likeCounts = {};
    const userLikedSet = new Set();
    likeRows.forEach(r => {
      likeCounts[r.comment_id] = (likeCounts[r.comment_id] || 0) + 1;
      if (r.user_id === currentUserId) userLikedSet.add(r.comment_id);
    });

    const top = (rows || [])
      .filter(c => !c.parent_id)
      .map(c => ({
        ...mapComment(c, likeCounts, userLikedSet),
        replies: (rows || []).filter(r => r.parent_id === c.id).map(r => mapComment(r, likeCounts, userLikedSet))
      }))
      .reverse();

    setComments(top);
  };

  useEffect(() => { fetchComments(); }, [storyId, currentUserId]);

  const handleLike = async (id, isReply = false, parentId = null) => {
    let nowLiked = false;
    setComments(prev => {
      const update = (item) => {
        if (item.id === id) {
          nowLiked = !item.userLiked;
          return { ...item, likes: item.userLiked ? item.likes - 1 : item.likes + 1, userLiked: !item.userLiked };
        }
        return item;
      };
      if (isReply) return prev.map(c => c.id === parentId ? { ...c, replies: c.replies.map(update) } : c);
      return prev.map(update);
    });

    try {
      if (nowLiked) {
        await supabase.from('comment_likes').insert({ comment_id: id, user_id: currentUserId });
      } else {
        await supabase.from('comment_likes').delete().eq('comment_id', id).eq('user_id', currentUserId);
      }
    } catch (err) {
      console.error('Erreur like :', err);
    }
  };

  const deleteComment = async (id, isReply = false, parentId = null) => {
    if (!window.confirm('Supprimer ce commentaire ?')) return;
    const { data, error } = await supabase.from('comments').delete()
      .eq('id', id).eq('author_id', currentUserId).select('id');
    if (error) { alert('Erreur lors de la suppression : ' + error.message); return; }
    if (!data || data.length === 0) { alert('Vous ne pouvez supprimer que vos propres commentaires.'); return; }
    if (!isReply) setComments(prev => prev.filter(c => c.id !== id));
    else setComments(prev => prev.map(c => c.id === parentId ? { ...c, replies: c.replies.filter(r => r.id !== id) } : c));
  };

  // Édition : seul l'auteur peut modifier son propre commentaire (comme pour
  // la suppression). Le texte brut (avec le HTML d'un sticker/vocal éventuel)
  // reste modifiable tel quel.
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const startEdit = (item) => { setEditingId(item.id); setEditText(item.text); };
  const cancelEdit = () => { setEditingId(null); setEditText(''); };
  const saveEdit = async (id, isReply = false, parentId = null) => {
    if (!editText.trim()) return;
    const { data, error } = await supabase.from('comments').update({ text: editText })
      .eq('id', id).eq('author_id', currentUserId).select('id');
    if (error) { alert('Erreur lors de la modification : ' + error.message); return; }
    if (!data || data.length === 0) { alert('Vous ne pouvez modifier que vos propres commentaires.'); return; }
    if (!isReply) setComments(prev => prev.map(c => c.id === id ? { ...c, text: editText } : c));
    else setComments(prev => prev.map(c => c.id === parentId ? { ...c, replies: c.replies.map(r => r.id === id ? { ...r, text: editText } : r) } : c));
    setEditingId(null);
    setEditText('');
  };

  // Un commentaire est SOIT écrit (texte + éventuellement une image), SOIT un message
  // vocal, SOIT un emoji envoyé seul comme une image (paramètre stickerText).
  const addCommentOrReply = async (stickerText) => {
    const sticker = typeof stickerText === 'string' ? stickerText : null;
    let text;
    if (sticker) {
      text = sticker;                       // emoji seul : on n'y mélange rien
    } else if (pendingVoice) {
      text = pendingVoice.html;             // vocal : jamais mélangé avec du texte
    } else {
      text = replyTo ? replyTo.replyText : newCommentText;
      if (tempImage) {
        text += (text ? ' ' : '') + `<img src="${tempImage}" alt="sticker" style="max-width:100px;max-height:100px;border-radius:8px;margin:5px 0;" />`;
      }
    }
    if (!text.trim()) return;

    const { data: inserted, error } = await supabase
      .from('comments')
      .insert({
        [column]: storyId,
        parent_id: replyTo ? replyTo.parentId : null,
        author_id: currentUserId,
        pseudo: currentUserPseudo,
        avatar_url: currentUserAvatar,
        text
      })
      .select()
      .single();

    if (error) { alert("Erreur lors de l'envoi du commentaire : " + error.message); return; }

    const newItem = {
      id: inserted.id,
      authorId: currentUserId,
      pseudo: currentUserPseudo,
      avatar: currentUserAvatar,
      text,
      timestamp: new Date(inserted.created_at).toLocaleTimeString(),
      replies: [],
      likes: 0,
      userLiked: false
    };

    if (replyTo) {
      setComments(prev => prev.map(c => c.id === replyTo.parentId ? { ...c, replies: [...c.replies, newItem] } : c));
      if (!sticker) setReplyTo(null);       // un emoji seul ne vide pas la réponse en cours d'écriture
    } else {
      setComments(prev => [newItem, ...prev]);
      if (!sticker) setNewCommentText('');  // idem pour le texte en cours
    }
    if (!sticker) {
      setTempImage(null);
      setPendingVoice(null);
    }
  };
  const openEmojiPicker = (mode) => {
    if (emojiPickerOpen && emojiMode === mode) { setEmojiPickerOpen(false); return; }
    setEmojiMode(mode);
    setEmojiPickerOpen(true);
  };
  const handleEmoji = (emoji) => {
    setEmojiPickerOpen(false);
    if (emojiMode === 'sticker') {          // bouton 2 : envoyé tout de suite, seul, en grand
      addCommentOrReply(emojiStickerHtml(emoji));
      return;
    }
    if (replyTo) setReplyTo({ ...replyTo, replyText: (replyTo.replyText || '') + emoji });   // bouton 1 : dans le texte
    else setNewCommentText(prev => prev + emoji);
  };
  const handleSticker = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingMedia(true);
    try {
      const uploaded = await uploadToCloudinary(file, 'image');
      setTempImage(uploaded.url);
    } catch (err) {
      alert("Échec de l'envoi de l'image : " + err.message);
    } finally {
      setUploadingMedia(false);
    }
  };

  const hasVoice = isRecording || !!pendingVoice;
  const hasText = !!(((replyTo ? replyTo.replyText : newCommentText) || '').trim()) || !!tempImage;

  const handleVoiceRecord = async () => {
    if (isRecording) {
      recordedSecondsRef.current = (Date.now() - recordStartRef.current) / 1000;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorderRef.current = new MediaRecorder(stream);
        mediaRecorderRef.current.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        mediaRecorderRef.current.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          audioChunksRef.current = [];
          stream.getTracks().forEach(track => track.stop());
          setUploadingMedia(true);
          try {
            const audioFile = new File([audioBlob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
            const uploaded = await uploadToCloudinary(audioFile, 'video');
            // Le vocal est gardé à part et affiché en aperçu dans la zone de saisie.
            setPendingVoice({ url: uploaded.url, html: buildVoiceBubbleHtml(uploaded.url, recordedSecondsRef.current) });
          } catch (err) {
            alert("Échec de l'envoi du message vocal : " + err.message);
          } finally {
            setUploadingMedia(false);
          }
        };
        audioChunksRef.current = [];
        mediaRecorderRef.current.start();
        recordStartRef.current = Date.now();
        setIsRecording(true);
      } catch (err) {
        alert("Impossible d'accéder au micro : " + err.message);
      }
    }
  };

  return (
    <div className="comments-section-enhanced">
      <div className="comments-list">
        {comments.length === 0 ? (
          <div className="no-comments" style={{ textAlign: 'center', color: '#aaa', padding: '20px' }}>
            <i className="fas fa-comment-slash" style={{ fontSize: '30px', display: 'block', marginBottom: '10px' }}></i>
            Aucun commentaire pour l'instant. Soyez le premier à commenter !
          </div>
        ) : (
          comments.map(comment => (
            <div key={comment.id} className="comment-item-enhanced">
              <div className="comment-header">
                <img src={comment.avatar} alt="avatar" className="comment-avatar" />
                <div className="comment-meta">
                  <span className="comment-pseudo">{comment.pseudo}</span>
                  <span className="comment-timestamp">{comment.timestamp}</span>
                </div>
                {canModifyComment(comment, currentUserId) && editingId !== comment.id && (
                  <div className="comment-owner-actions">
                    <button className="comment-edit" onClick={() => startEdit(comment)} title="Modifier"><i className="fas fa-pen"></i></button>
                    <button className="comment-delete" onClick={() => deleteComment(comment.id)} title="Supprimer"><i className="fas fa-trash-alt"></i></button>
                  </div>
                )}
              </div>
              {editingId === comment.id ? (
                <div className="comment-edit-area">
                  <textarea className="comment-edit-textarea" rows={3} value={editText} onChange={(e) => setEditText(e.target.value)} />
                  <div className="comment-edit-actions">
                    <button className="comment-edit-save" onClick={() => saveEdit(comment.id)}>Enregistrer</button>
                    <button className="comment-edit-cancel" onClick={cancelEdit}>Annuler</button>
                  </div>
                </div>
              ) : (
                <div className="comment-text" dangerouslySetInnerHTML={{ __html: cleanHtml(comment.text) }}></div>
              )}
              <div className="comment-actions">
                <button className={`comment-react ${comment.userLiked ? 'active' : ''}`} onClick={() => handleLike(comment.id)}>
                  <i className="fas fa-thumbs-up"></i> {comment.likes !== 0 && comment.likes}
                </button>
                <button className="comment-reply" onClick={() => setReplyTo({ parentId: comment.id, replyText: '' })}>
                  <i className="fas fa-reply"></i> Répondre
                </button>
              </div>
              {comment.replies.map(reply => (
                <div key={reply.id} className="reply-item-enhanced">
                  <div className="reply-header">
                    <img src={reply.avatar} alt="avatar" className="reply-avatar" />
                    <div className="reply-meta">
                      <span className="reply-pseudo">{reply.pseudo}</span>
                      <span className="reply-timestamp">{reply.timestamp}</span>
                    </div>
                    {canModifyComment(reply, currentUserId) && editingId !== reply.id && (
                      <div className="comment-owner-actions">
                        <button className="comment-edit" onClick={() => startEdit(reply)} title="Modifier"><i className="fas fa-pen"></i></button>
                        <button className="reply-delete" onClick={() => deleteComment(reply.id, true, comment.id)}><i className="fas fa-trash-alt"></i></button>
                      </div>
                    )}
                  </div>
                  {editingId === reply.id ? (
                    <div className="comment-edit-area">
                      <textarea className="comment-edit-textarea" rows={2} value={editText} onChange={(e) => setEditText(e.target.value)} />
                      <div className="comment-edit-actions">
                        <button className="comment-edit-save" onClick={() => saveEdit(reply.id, true, comment.id)}>Enregistrer</button>
                        <button className="comment-edit-cancel" onClick={cancelEdit}>Annuler</button>
                      </div>
                    </div>
                  ) : (
                    <div className="reply-text" dangerouslySetInnerHTML={{ __html: cleanHtml(reply.text) }}></div>
                  )}
                  <div className="reply-actions">
                    <button className={`reply-react ${reply.userLiked ? 'active' : ''}`} onClick={() => handleLike(reply.id, true, comment.id)}>
                      <i className="fas fa-thumbs-up"></i> {reply.likes !== 0 && reply.likes}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="comment-input-area">
        <div className="input-tools">
          <button type="button" className={`tool-btn ${emojiPickerOpen && emojiMode === 'text' ? 'active' : ''}`} onClick={() => openEmojiPicker('text')} disabled={hasVoice} title="Ajouter un emoji dans le texte">
            <i className="fas fa-smile-wink"></i>
          </button>
          <button type="button" className={`tool-btn ${emojiPickerOpen && emojiMode === 'sticker' ? 'active' : ''}`} onClick={() => openEmojiPicker('sticker')} disabled={hasVoice} title="Envoyer un emoji seul, comme une image">
            <i className="far fa-sticky-note"></i>
          </button>
          <button type="button" className="tool-btn" onClick={() => fileInputRef.current.click()} disabled={uploadingMedia || hasVoice} title="Ajouter une image"><i className="fas fa-image"></i></button>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleSticker} />
        </div>
        {uploadingMedia && <div className="uploading-indicator" style={{ fontSize: 12, color: '#aaa', padding: '4px 0' }}><i className="fas fa-spinner fa-spin"></i> Envoi en cours...</div>}
        {tempImage && (
          <div className="temp-image-preview">
            <img src={tempImage} alt="sticker preview" />
            <button onClick={() => setTempImage(null)}><i className="fas fa-times-circle"></i></button>
          </div>
        )}
        {/* Aperçu du message vocal en attente : il s'affiche ici, à l'endroit où
            l'on ajoute un commentaire, et part avec le texte (ou seul) à l'envoi. */}
        {pendingVoice && (
          <div className="pending-voice-preview" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <div style={{ flex: 1, minWidth: 0 }} dangerouslySetInnerHTML={{ __html: cleanHtml(pendingVoice.html) }}></div>
            <button type="button" className="tool-btn" onClick={() => setPendingVoice(null)} title="Retirer le message vocal">
              <i className="fas fa-times-circle"></i>
            </button>
          </div>
        )}
        <div className="input-wrapper">
          <input
            type="text"
            placeholder={hasVoice ? "Message vocal prêt : envoyez-le, ou supprimez-le pour écrire" : (replyTo ? "Écrire une réponse..." : "Ajouter un commentaire...")}
            value={replyTo ? replyTo.replyText : newCommentText}
            disabled={hasVoice}
            onChange={(e) => replyTo ? setReplyTo({ ...replyTo, replyText: e.target.value }) : setNewCommentText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && addCommentOrReply()}
          />
          {/* Bouton message vocal : dans la zone d'écriture. Un commentaire est soit écrit, soit vocal. */}
          <button
            type="button"
            className={`tool-btn input-mic-btn ${isRecording ? 'recording-active' : ''}`}
            style={{ flexShrink: 0 }}
            onClick={handleVoiceRecord}
            disabled={uploadingMedia || (hasText && !isRecording)}
            title={isRecording ? 'Terminer l\'enregistrement' : (hasText ? 'Effacez le texte pour envoyer un vocal' : 'Message vocal')}
          >
            <i className={`fas fa-${isRecording ? 'stop' : 'microphone'}`}></i>
          </button>
          <button className="send-btn" onClick={() => addCommentOrReply()}><i className="fas fa-arrow-right"></i></button>
        </div>
        {emojiPickerOpen && <EmojiPicker onSelect={handleEmoji} onClose={() => setEmojiPickerOpen(false)} />}
      </div>
      {replyTo && (
        <div className="reply-cancel">
          <button onClick={() => setReplyTo(null)}>Annuler la réponse</button>
        </div>
      )}
    </div>
  );
};

// Panneau de réactions : mêmes boutons que la page Musique (👍 ❤️ 🔥 👎 avec compteurs)
export const StoryReactionsPanel = ({ storyId, currentUserId }) => {
  const { reactions, userReaction, handleReaction } = useReactions('story_id', storyId, currentUserId);
  return (
    <div className="reactions-panel">
      <button className={`reaction like ${userReaction === 'like' ? 'active' : ''}`} onClick={() => handleReaction('like')}>
        <i className="fas fa-thumbs-up"></i> {reactions.like !== 0 && reactions.like}
      </button>
      <button className={`reaction heart ${userReaction === 'heart' ? 'active' : ''}`} onClick={() => handleReaction('heart')}>
        <i className="fas fa-heart"></i> {reactions.heart !== 0 && reactions.heart}
      </button>
      <button className={`reaction fire ${userReaction === 'fire' ? 'active' : ''}`} onClick={() => handleReaction('fire')}>
        <i className="fas fa-fire"></i> {reactions.fire !== 0 && reactions.fire}
      </button>
      <button className={`reaction dislike ${userReaction === 'dislike' ? 'active' : ''}`} onClick={() => handleReaction('dislike')}>
        <i className="fas fa-thumbs-down"></i> {reactions.dislike !== 0 && reactions.dislike}
      </button>
    </div>
  );
};

export const StoryCommentSection = CommentSection;

// "il y a 5 min", "il y a 3 h", "13 juil." ... (timestamp en ms ou date ISO)
export const storyTimeLabel = (v) => {
  const t = typeof v === 'number' ? v : Date.parse(v);
  if (!t || Number.isNaN(t)) return "À l'instant";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "À l'instant";
  if (m < 60) return `il y a ${m} min`;
  if (m < 1440) return `il y a ${Math.floor(m / 60)} h`;
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

const REACTION_ICONS = [
  { type: 'like', icon: 'fa-thumbs-up', color: '#1877f2' },
  { type: 'heart', icon: 'fa-heart', color: '#e4405f' },
  { type: 'fire', icon: 'fa-fire', color: '#ff9500' },
  { type: 'dislike', icon: 'fa-thumbs-down', color: '#6c757d' },
];

// Bas de la publication (comme Facebook) : résumé des réactions + nb de commentaires,
// puis boutons Réagir / Commenter. Les réactions et commentaires sont ceux de la page Musique.
export const StoryEngagementBar = ({ storyId, currentUserId, currentUserAvatar, currentUserPseudo, column = 'story_id' }) => {
  const { reactions, userReaction, handleReaction } = useReactions(column, storyId, currentUserId);
  const [panel, setPanel] = useState(null); // null | 'reactions' | 'comments'
  const [commentCount, setCommentCount] = useState(0);

  useEffect(() => { setPanel(null); }, [storyId]);
  useEffect(() => {
    let cancelled = false;
    supabase.from('comments').select('id', { count: 'exact', head: true }).eq(column, storyId)
      .then(({ count }) => { if (!cancelled) setCommentCount(count || 0); });
    return () => { cancelled = true; };
  }, [storyId, panel]);

  const total = Object.values(reactions).reduce((a, b) => a + b, 0);
  const shown = REACTION_ICONS.filter(r => reactions[r.type] > 0);

  return (
    <div className="story-engage vp-engage">
      <div className="vp-summary">
        <span className="vp-summary-reacts">
          {shown.map(r => <i key={r.type} className={`fas ${r.icon}`} style={{ color: r.color }}></i>)}
          {total > 0 && <b>{total}</b>}
        </span>
        <span className="vp-summary-comments" onClick={() => setPanel(panel === 'comments' ? null : 'comments')}>
          {commentCount > 0 && `${commentCount} commentaire${commentCount > 1 ? 's' : ''}`}
        </span>
      </div>
      <div className="vp-actions">
        <button className={`vp-action ${panel === 'reactions' || userReaction ? 'active' : ''}`}
          onClick={() => setPanel(panel === 'reactions' ? null : 'reactions')}>
          <i className="fas fa-thumbs-up"></i> Réagir
        </button>
        <button className={`vp-action ${panel === 'comments' ? 'active' : ''}`}
          onClick={() => setPanel(panel === 'comments' ? null : 'comments')}>
          <i className="far fa-comment"></i> Commenter
        </button>
      </div>
      {panel === 'reactions' && (
        <div className="reactions-panel">
          {REACTION_ICONS.map(r => (
            <button key={r.type} className={`reaction ${r.type} ${userReaction === r.type ? 'active' : ''}`} onClick={() => handleReaction(r.type)}>
              <i className={`fas ${r.icon}`}></i> {reactions[r.type] !== 0 && reactions[r.type]}
            </button>
          ))}
        </div>
      )}
      {panel === 'comments' && (
        <CommentSection storyId={storyId} column={column} currentUserId={currentUserId}
          currentUserAvatar={currentUserAvatar} currentUserPseudo={currentUserPseudo} />
      )}
    </div>
  );
};

// Publications (articles / billets / albums) : EXACTEMENT la même barre que les stories,
// mais rattachée à comments.event_id / reactions.event_id (voir sql/publication_engagement.sql).
export const EventEngagementBar = ({ eventId, ...rest }) => (
  <StoryEngagementBar {...rest} storyId={String(eventId)} column="event_id" />
);
