// src/Admin/AdminMusique.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './AdminMusique.css';
import bgImage from '../assets/Images/men_your_brave.jpeg';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import { uploadToR2 } from '../cloudflareClient';
import ProfileSettingsPanel from './ProfileSettingsPanel';
import EmojiPicker from '../components/EmojiPicker';
import { buildVoiceBubbleHtml } from '../utils/voiceBubble'; // Bulle vocale (capsule rouge)
import { cleanHtml } from '../utils/sanitizeHtml'; // Protection XSS des commentaires
import AnimatedLyrics from '../components/AnimatedLyrics'; // Paroles animées
import { hasLyrics } from '../utils/lyricsTools';
import '../styles/responsive-vip.css';
import '../styles/messagerie-mobile-fix.css';      // ← ajouter
import useVipViewportOffsets from '../hooks/useVipViewportOffsets';   // ← ajouter

// Pochette générique utilisée uniquement en secours (image manquante,
// bibliothèque Supabase pas encore remplie). Tout le reste (pochettes,
// musiques, paroles) vit désormais uniquement dans Supabase Storage.
import defaultAlbumCover from '../assets/Images/YASSAL.jpeg';

// ----------------------------------------------
// Bibliothèque vide par défaut : les albums et morceaux ne viennent
// plus que de Supabase (voir fetchAlbumsAndSongs plus bas). Ils
// apparaissent ici automatiquement dès qu'un admin les ajoute.
// ----------------------------------------------
const albumsData = [];
const allSongsArray = [];

// ========== CONTENU DE L'HISTOIRE D'UN MORCEAU ==========
const SongStoryContent = ({ song }) => {
  return (
    <>
      <p><strong>{song.title}</strong> – {song.artist}</p>
      <p>Ce morceau est tiré de l'album "{song.album}". Voici l'histoire complète :</p>
      <p>{song.description || song.histoire || "Histoire non renseignée pour ce morceau."}</p>
      <div className="song-stats-icons">
        <p><i className="far fa-calendar"></i> Année : 2024</p>
        <p><i className="fas fa-headphones"></i> Écoutes : {song.plays || 0}</p>
        <p><i className="fas fa-heart"></i> Likes : {song.likes || 0}</p>
      </div>
    </>
  );
};

// ---------------------------------------------------------------
// RÈGLE MÉTIER — commentaires et réponses
// Seule la personne qui a envoyé un commentaire (ou une réponse) peut le
// modifier ou le supprimer. Le contrôle est fait à 3 niveaux :
//  1. l'interface n'affiche les boutons qu'à l'auteur (canModifyComment) ;
//  2. les requêtes Supabase filtrent aussi sur author_id ;
//  3. la base (RLS, voir comments_securite.sql) compare author_id à auth.uid().
// ---------------------------------------------------------------
const getOrCreateUserId = () => {
  let id = localStorage.getItem('userId');
  if (!id || id === 'currentUser') {
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('userId', id);
  }
  return id;
};

// Identité réelle de l'utilisateur, fournie par Supabase Auth (session
// existante, sinon connexion anonyme persistante). C'est cet identifiant
// (auth.uid()) que la base vérifie avant d'autoriser une modification ou une
// suppression de commentaire : impossible de se faire passer pour un autre.
const resolveAuthUserId = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) return session.user.id;
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    return data.user.id;
  } catch (e) {
    console.warn("Identité Supabase indisponible (connexion anonyme non activée ?) :", e.message || e);
    return null;
  }
};

// ---------------------------------------------------------------
// RÉACTIONS — enregistrées dans Supabase (table "reactions")
// Une seule réaction par utilisateur et par morceau / album :
//  - cliquer une réaction quand on n'en a pas  -> elle est ajoutée
//  - cliquer la même réaction                  -> elle est retirée
//  - cliquer une autre réaction                -> on bascule dessus
// column = 'song_id' ou 'album_id'.
// ---------------------------------------------------------------
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

// ---------------------------------------------------------------
// ÉCOUTES & TÉLÉCHARGEMENTS — enregistrés dans Supabase
// Règle : chaque utilisateur compte UNE SEULE fois par morceau.
//  - 1re écoute (ou 1er téléchargement) d'un morceau -> le compteur monte de 1
//  - les fois suivantes, le compteur ne bouge plus (l'action, elle, reste possible)
// Tables : song_listens et song_downloads, clé primaire (song_id, user_id) :
// la base elle-même refuse un doublon. Les totaux viennent de la vue song_stats.
// ---------------------------------------------------------------
const useSongStats = (currentUserId, ready) => {
  const [stats, setStats] = useState({}); // { songId: { listens, downloads } }
  const mine = useRef({ song_listens: new Set(), song_downloads: new Set() });

  const toStat = (r) => ({ listens: Number(r.listens) || 0, downloads: Number(r.downloads) || 0 });

  useEffect(() => {
    if (!ready || !currentUserId) return;
    let cancelled = false;
    const load = async () => {
      const [all, l, d] = await Promise.all([
        supabase.from('song_stats').select('song_id, listens, downloads'),
        supabase.from('song_listens').select('song_id').eq('user_id', currentUserId),
        supabase.from('song_downloads').select('song_id').eq('user_id', currentUserId)
      ]);
      if (cancelled) return;
      if (all.error) console.error('Erreur chargement statistiques :', all.error);
      else {
        const m = {};
        (all.data || []).forEach(r => { m[r.song_id] = toStat(r); });
        setStats(m);
      }
      mine.current = {
        song_listens: new Set((l.data || []).map(r => r.song_id)),
        song_downloads: new Set((d.data || []).map(r => r.song_id))
      };
    };
    load();
    return () => { cancelled = true; };
  }, [currentUserId, ready]);

  const record = async (table, songId) => {
    if (!ready || !currentUserId || !songId) return;
    if (mine.current[table].has(songId)) return; // déjà compté pour cet utilisateur
    mine.current[table].add(songId);
    const { error } = await supabase.from(table).upsert(
      { song_id: songId, user_id: currentUserId },
      { onConflict: 'song_id,user_id', ignoreDuplicates: true }
    );
    if (error) {
      mine.current[table].delete(songId);
      console.error('Erreur enregistrement (' + table + ') :', error);
      return;
    }
    const { data } = await supabase.from('song_stats')
      .select('song_id, listens, downloads').eq('song_id', songId).maybeSingle();
    if (data) setStats(prev => ({ ...prev, [songId]: toStat(data) }));
  };

  return {
    stats,
    recordListen: (songId) => record('song_listens', songId),
    recordDownload: (songId) => record('song_downloads', songId)
  };
};

// Emoji envoyé SEUL, affiché en grand comme une image (autocollant)
const emojiStickerHtml = (emoji) =>
  `<span class="emoji-sticker" style="display:inline-block;font-size:64px;line-height:1.15;margin:4px 0;">${emoji}</span>`;

const canModifyComment = (item, currentUserId) =>
  !!currentUserId && item.authorId === currentUserId;

// ========== SECTION COMMENTAIRES POUR LES MORCEAUX (identique) ==========
const CommentSection = ({ songId, currentUserId, currentUserAvatar, currentUserPseudo }) => {
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
      .from('comments').select('*').eq('song_id', songId).order('created_at', { ascending: true });
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

  useEffect(() => { fetchComments(); }, [songId, currentUserId]);

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
        song_id: songId,
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
      const uploaded = await uploadToR2(file, 'chat');
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
            const uploaded = await uploadToR2(audioFile, 'voice');
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

// ========== SECTION COMMENTAIRES POUR LES ALBUMS (identique) ==========
const AlbumCommentSection = ({ albumId, currentUserId, currentUserAvatar, currentUserPseudo }) => {
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
      .from('comments').select('*').eq('album_id', albumId).order('created_at', { ascending: true });
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

  useEffect(() => { fetchComments(); }, [albumId, currentUserId]);

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
        album_id: albumId,
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
      const uploaded = await uploadToR2(file, 'chat');
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
            const uploaded = await uploadToR2(audioFile, 'voice');
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

// ========== MODAL ALBUM (avec compteurs) ==========
const AlbumModal = ({ album, onClose, onPlaySong, allSongs, currentUserId, currentUserAvatar, currentUserPseudo }) => {
  const [activePanel, setActivePanel] = useState('story');
  const { reactions, userReaction, handleReaction } = useReactions('album_id', album.id, currentUserId);
  const [shareMessage, setShareMessage] = useState('');
  const [commentsCount, setCommentsCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const updateCommentsCount = async () => {
      const { count } = await supabase
        .from('comments').select('id', { count: 'exact', head: true }).eq('album_id', album.id);
      if (!cancelled) setCommentsCount(count || 0);
    };
    updateCommentsCount();
    return () => { cancelled = true; };
  }, [album.id]);

  const totalReactions = reactions.like + reactions.heart + reactions.fire + reactions.dislike;

  const shareAlbum = () => {
    navigator.clipboard.writeText(`${window.location.origin}/user/musique?album=${album.id}`);
    setShareMessage('Lien de l\'album copié !');
    setTimeout(() => setShareMessage(''), 2000);
  };

  const albumSongs = allSongs.filter(song => album.songs.includes(song.id));
  const albumLongStory = `
    ${album.description}\n\n
    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
    Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
    Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
    Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
    \n\n
    Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam,
    eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.
    Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores
    eos qui ratione voluptatem sequi nesciunt.
  `;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content album-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        <div className="modal-story-header">
          <img src={album.cover} alt={album.title} className="modal-story-cover" />
          <div className="modal-story-info">
            <h3>{album.title}</h3>
            <div className="artist">{album.artist}</div>
            <div className="details">
              <span><i className="far fa-calendar"></i> {album.year}</span>
              <span><i className="fas fa-music"></i> {album.songs.length} titres</span>
            </div>
          </div>
        </div>

        {activePanel === 'story' && (
          <div className="modal-story-text">
            <p>{albumLongStory}</p>
            <div className="album-stats-icons">
              <p><i className="far fa-calendar"></i> Année de sortie : {album.year}</p>
              <p><i className="fas fa-user"></i> Artiste : {album.artist}</p>
              <p><i className="fas fa-music"></i> Nombre de titres : {album.songs.length}</p>
            </div>
            <p><strong>Liste des morceaux :</strong></p>
            <ul className="album-songs-list">
              {albumSongs.map(song => (
                <li key={song.id} className="album-song-item">
                  <span 
                    className="album-song-title"
                    onClick={() => {
                      onPlaySong(song);
                      onClose();
                    }}
                  >
                    {song.title}
                  </span>
                  <span className="album-song-duration">({Math.floor(song.duration/60)}:{String(song.duration%60).padStart(2,'0')})</span>
                  <button 
                    className="album-play-btn"
                    onClick={() => {
                      onPlaySong(song);
                      onClose();
                    }}
                  >
                    <i className="fas fa-play"></i> Écouter
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="modal-action-buttons">
          <button
            className={`modal-action-btn ${activePanel === 'reactions' ? 'active' : ''}`}
            onClick={() => setActivePanel(activePanel === 'reactions' ? 'story' : 'reactions')}
          >
            <i className="fas fa-fire"></i> {totalReactions > 0 && totalReactions}
          </button>
          <button
            className={`modal-action-btn ${activePanel === 'comments' ? 'active' : ''}`}
            onClick={() => setActivePanel(activePanel === 'comments' ? 'story' : 'comments')}
          >
            <i className="fas fa-comment-dots"></i> {commentsCount > 0 && commentsCount}
          </button>
          <button className="modal-action-btn" onClick={shareAlbum}>
            <i className="fas fa-share-alt"></i> Partager
          </button>
        </div>

        {activePanel === 'reactions' && (
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
        )}

        {activePanel === 'comments' && (
          <AlbumCommentSection albumId={album.id} currentUserId={currentUserId} currentUserAvatar={currentUserAvatar} currentUserPseudo={currentUserPseudo} />
        )}

        {shareMessage && <div className="share-message">{shareMessage}</div>}
      </div>
    </div>
  );
};

// ========== MODAL POUR MORCEAU (AVEC COMPTEURS) ==========
const SongStoryModal = ({ song, onClose, currentUserId, currentUserAvatar, currentUserPseudo, downloadsCount = 0, onDownload }) => {
  const [activePanel, setActivePanel] = useState('story');
  const { reactions, userReaction, handleReaction } = useReactions('song_id', song.id, currentUserId);
  const [downloadMessage, setDownloadMessage] = useState('');

  const [commentsCount, setCommentsCount] = useState(0);

  const totalReactions = reactions.like + reactions.heart + reactions.fire + reactions.dislike;

  useEffect(() => {
    let cancelled = false;
    const updateCommentsCount = async () => {
      const { count } = await supabase
        .from('comments').select('id', { count: 'exact', head: true }).eq('song_id', song.id);
      if (!cancelled) setCommentsCount(count || 0);
    };
    updateCommentsCount();
    return () => { cancelled = true; };
  }, [song.id, activePanel]);

  const downloadSong = () => {
    const link = document.createElement('a');
    link.href = song.src;
    link.download = `${song.title} - ${song.artist}.mp3`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setDownloadMessage('Téléchargement lancé !');
    setTimeout(() => setDownloadMessage(''), 2000);
    if (onDownload) onDownload(); // compté une seule fois par utilisateur (voir useSongStats)
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>&times;</button>
        <div className="modal-story-header">
          <img src={song.cover} alt={song.title} className="modal-story-cover" />
          <div className="modal-story-info">
            <h3>{song.title}</h3>
            <div className="artist">{song.artist}</div>
            <div className="details">
              <span><i className="far fa-calendar"></i> 2024</span>
              <span><i className="far fa-clock"></i> {Math.floor(song.duration/60)}:{String(song.duration%60).padStart(2,'0')}</span>
            </div>
          </div>
        </div>
        {activePanel !== 'comments' && (
          <div className="modal-story-text">
            <SongStoryContent song={song} />
          </div>
        )}
        <div className="modal-action-buttons">
          <button
            className={`modal-action-btn ${activePanel === 'reactions' ? 'active' : ''}`}
            onClick={() => setActivePanel(activePanel === 'reactions' ? 'story' : 'reactions')}
          >
            <i className="fas fa-fire"></i> {totalReactions > 0 && totalReactions}
          </button>
          <button
            className={`modal-action-btn ${activePanel === 'comments' ? 'active' : ''}`}
            onClick={() => setActivePanel(activePanel === 'comments' ? 'story' : 'comments')}
          >
            <i className="fas fa-comment-dots"></i> {commentsCount > 0 && commentsCount}
          </button>
          <button className="modal-action-btn" onClick={downloadSong}>
            <i className="fas fa-download"></i> {downloadsCount > 0 && downloadsCount}
          </button>
        </div>

        {activePanel === 'reactions' && (
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
        )}
        {activePanel === 'comments' && (
          <CommentSection
            songId={song.id}
            currentUserId={currentUserId}
            currentUserAvatar={currentUserAvatar}
            currentUserPseudo={currentUserPseudo}
          />
        )}
        {downloadMessage && <div className="share-message">{downloadMessage}</div>}
      </div>
    </div>
  );
};

// ========== COMPOSANT PRINCIPAL : AdminMusique ==========
// ===============================================================
// OUTILS ADMIN — envoi de fichiers vers Supabase Storage + formulaires
// Les droits d'écriture sont contrôlés par la base (RLS) : seul le compte
// admin connecté avec Supabase Auth peut ajouter / modifier / supprimer
// albums, morceaux et fichiers (voir final.sql).
// ===============================================================
const BUCKETS = { cover: 'album-covers', audio: 'audio-files', lyrics: 'lyrics-files' };
const NOT_ADMIN_MSG = "Action refusée : connectez-vous avec le compte administrateur.";

const safeFileName = (name) =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');

// Formats acceptés (identiques aux types autorisés sur les buckets, voir final.sql section 12)
const FORMATS = {
  cover:  { exts: ['jpg', 'jpeg', 'png', 'webp', 'gif'], accept: 'image/*',            label: 'image (jpg, png, webp, gif)' },
  audio:  { exts: ['mp3', 'mpga', 'm4a'],                accept: '.mp3,.mpga,.m4a',      label: 'mp3, mpga ou m4a' },
  lyrics: { exts: ['txt', 'pdf', 'wps'],                 accept: '.txt,.pdf,.wps',       label: 'txt, pdf ou wps' },
};
const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp3: 'audio/mpeg', mpga: 'audio/mpeg', m4a: 'audio/mp4',
  txt: 'text/plain', pdf: 'application/pdf', wps: 'application/vnd.ms-works',
};
const fileExt = (file) => ((file?.name || '').split('.').pop() || '').toLowerCase();
const checkFormat = (file, kind) => {
  if (!file) return '';
  return FORMATS[kind].exts.includes(fileExt(file))
    ? ''
    : `Format refusé (${file.name}). Formats acceptés : ${FORMATS[kind].label}.`;
};

// Stockage des pochettes / audios / paroles : Cloudflare R2 via le Worker (réservé à l'admin)
const R2_WORKER_URL = import.meta.env.VITE_CLOUDFLARE_WORKER_URL;
const R2_PUBLIC_URL = (import.meta.env.VITE_R2_PUBLIC_URL || '').replace(/\/$/, '');   // ex. https://media.mondomaine.com
const R2_KIND = { 'album-covers': 'covers', 'audio-files': 'audio', 'lyrics-files': 'lyrics' };

const uploadToBucket = async (bucket, file) => {
  const name = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${safeFileName(file.name)}`;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Session expirée : reconnectez-vous.');
  const res = await fetch(`${R2_WORKER_URL}/upload/${R2_KIND[bucket]}/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': MIME_BY_EXT[fileExt(file)] || file.type },
    body: file,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Envoi refusé (${res.status})`);
  return out.url;
};

// Supprime un fichier à partir de son URL (R2, ou ancienne URL Supabase pendant la migration), sans bloquer si ça échoue
const removeFromBucket = async (bucket, url) => {
  if (!url) return;
  try {
    if (R2_PUBLIC_URL && url.startsWith(R2_PUBLIC_URL)) {
      const name = url.split('/').pop().split('?')[0];
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${R2_WORKER_URL}/delete/${R2_KIND[bucket]}/${name}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${session.access_token}` },
      });
      return;
    }
    const marker = `/object/public/${bucket}/`;
    const i = url.indexOf(marker);
    if (i === -1) return;
    const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
    await supabase.storage.from(bucket).remove([path]);
  } catch (e) {
    console.warn('Suppression du fichier impossible :', e);
  }
};

const readAudioDuration = (file) => new Promise((resolve) => {
  try {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Math.round(a.duration) || 0); };
    a.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    a.src = url;
  } catch { resolve(0); }
});

// Garde albums.track_count synchronisé avec le nombre réel de morceaux
const syncTrackCount = async (albumId) => {
  if (!albumId) return;
  const { count } = await supabase.from('songs').select('id', { count: 'exact', head: true }).eq('album_id', albumId);
  await supabase.from('albums').update({ track_count: count || 0 }).eq('id', albumId);
};

const adminUi = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 },
  box: { background: '#0b0b0b', border: '1px solid #333', borderRadius: 12, padding: 20, width: '100%', maxWidth: 520, maxHeight: '92vh', overflowY: 'auto', color: '#fff', boxShadow: '0 0 40px rgba(255,0,0,0.2)', boxSizing: 'border-box' },
  title: { color: '#ff0000', margin: '0 0 6px', fontSize: 18, letterSpacing: 1, textTransform: 'uppercase' },
  label: { display: 'block', fontSize: 12, color: '#aaa', margin: '14px 0 5px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', background: '#111', border: '1px solid #333', borderRadius: 6, color: '#fff', fontSize: 14, outline: 'none', fontFamily: 'inherit' },
  row: { display: 'flex', gap: 10 },
  actions: { display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end', flexWrap: 'wrap' },
  btn: { padding: '10px 18px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 13, textTransform: 'uppercase' },
  btnMain: { background: '#ff0000', color: '#000', border: '2px solid #ff0000' },
  btnGhost: { background: 'transparent', color: '#ccc', border: '2px solid #444' },
  error: { color: '#ff4d4d', background: 'rgba(255,0,0,0.1)', borderRadius: 6, padding: '8px 10px', fontSize: 13, marginTop: 14 },
  hint: { color: '#777', fontSize: 11, marginTop: 4 },
  iconBtn: { width: 30, height: 30, borderRadius: '50%', border: '1px solid #555', background: 'rgba(0,0,0,0.75)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 },
  cardTools: { position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6, zIndex: 5 },
  rowTools: { display: 'flex', gap: 6, marginLeft: 8, flexShrink: 0 },
};

// ---------- Formulaire : MODIFIER un album ----------
const AlbumFormModal = ({ album, onClose, onSaved }) => {
  const [title, setTitle] = useState(album?.title || '');
  const [description, setDescription] = useState(album?.description || '');
  const [releaseDate, setReleaseDate] = useState(album?.release_date || '');
  const [coverFile, setCoverFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (busy) return;
    if (!title.trim()) { setError("Le nom de l'album est obligatoire."); return; }
    const fe = checkFormat(coverFile, 'cover');
    if (fe) { setError(fe); return; }
    setBusy(true); setError('');
    let newCoverUrl = null;
    let dbOk = false;
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        release_date: releaseDate || null,
        year: releaseDate ? String(new Date(releaseDate).getFullYear()) : (album.year || null),
      };
      if (coverFile) { newCoverUrl = await uploadToBucket(BUCKETS.cover, coverFile); payload.cover_url = newCoverUrl; }
      const res = await supabase.from('albums').update(payload).eq('id', album.id).select('id');
      if (res.error) throw res.error;
      if (!res.data || res.data.length === 0) throw new Error(NOT_ADMIN_MSG);
      dbOk = true;
      if (newCoverUrl && album.cover_url) removeFromBucket(BUCKETS.cover, album.cover_url);
      await onSaved();
      onClose();
    } catch (e) {
      if (newCoverUrl && !dbOk) removeFromBucket(BUCKETS.cover, newCoverUrl);
      setError(e.message || "Erreur lors de l'enregistrement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={adminUi.overlay} onClick={onClose}>
      <div style={adminUi.box} onClick={(e) => e.stopPropagation()}>
        <h3 style={adminUi.title}>Modifier l'album</h3>

        <label style={adminUi.label}>Image de l'album (laisser vide pour garder l'actuelle)</label>
        <input style={adminUi.input} type="file" accept={FORMATS.cover.accept} onChange={(e) => setCoverFile(e.target.files[0] || null)} />

        <label style={adminUi.label}>Nom de l'album *</label>
        <input style={adminUi.input} value={title} onChange={(e) => setTitle(e.target.value)} />

        <label style={adminUi.label}>Histoire de l'album</label>
        <textarea style={{ ...adminUi.input, minHeight: 90, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />

        <label style={adminUi.label}>Date de sortie</label>
        <input style={{ ...adminUi.input, colorScheme: 'dark' }} type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />

        <div style={adminUi.hint}>Nombre de morceaux : {album.songs.length} (pour en ajouter ou en retirer, utilisez les boutons des morceaux).</div>

        {error && <div style={adminUi.error}>{error}</div>}
        <div style={adminUi.actions}>
          <button style={{ ...adminUi.btn, ...adminUi.btnGhost }} onClick={onClose} disabled={busy}>Annuler</button>
          <button style={{ ...adminUi.btn, ...adminUi.btnMain, opacity: busy ? 0.6 : 1 }} onClick={save} disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------- Assistant : CRÉER un album avec tous ses morceaux ----------
// Étape 1 : image, nom, histoire, nombre de titres, date de sortie.
// Étapes suivantes : un écran par morceau (nom + audio, histoire, paroles).
// Dernière étape : récapitulatif puis publication. Tout est publié d'un bloc :
// en cas d'erreur, l'album et les fichiers envoyés sont retirés (rien à moitié publié).
const emptyTrack = () => ({ title: '', artist: 'ALP', story: '', audio: null, lyrics: '' });

const AlbumWizardModal = ({ onClose, onSaved }) => {
  const [step, setStep] = useState(0);          // 0 = album | 1..n = morceaux | n+1 = récap
  const [cover, setCover] = useState(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [title, setTitle] = useState('');
  const [story, setStory] = useState('');
  const [count, setCount] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [tracks, setTracks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const n = tracks.length;

  useEffect(() => {
    if (!cover) { setCoverPreview(''); return; }
    const url = URL.createObjectURL(cover);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);

  const setTrack = (i, patch) => setTracks(prev => prev.map((t, k) => (k === i ? { ...t, ...patch } : t)));

  const validateAlbum = () => {
    if (!cover) return "L'image de l'album est obligatoire.";
    const fe = checkFormat(cover, 'cover'); if (fe) return fe;
    if (!title.trim()) return "Le nom de l'album est obligatoire.";
    const c = parseInt(count, 10);
    if (!c || c < 1 || c > 40) return 'Le nombre de titres doit être entre 1 et 40.';
    if (!releaseDate) return 'La date de sortie est obligatoire.';
    return '';
  };
  const validateTrack = (i) => {
    const t = tracks[i];
    if (!t.title.trim()) return 'Le nom du morceau est obligatoire.';
    if (!t.audio) return 'Le fichier audio est obligatoire.';
    return checkFormat(t.audio, 'audio');
  };

  const next = () => {
    const err = step === 0 ? validateAlbum() : validateTrack(step - 1);
    if (err) { setError(err); return; }
    setError('');
    if (step === 0) {
      const c = parseInt(count, 10);
      setTracks(prev => Array.from({ length: c }, (_, i) => prev[i] || emptyTrack()));
    }
    setStep(step + 1);
  };
  const back = () => { setError(''); setStep(step - 1); };

  const publish = async () => {
    if (busy) return;
    setBusy(true); setError('');
    const uploaded = [];
    let albumId = null;
    try {
      setProgress("Envoi de l'image de l'album…");
      const coverUrl = await uploadToBucket(BUCKETS.cover, cover);
      uploaded.push([BUCKETS.cover, coverUrl]);

      const { data: alb, error: e1 } = await supabase.from('albums').insert({
        title: title.trim(),
        artist: 'ALP',
        year: String(new Date(releaseDate).getFullYear()),
        release_date: releaseDate,
        description: story.trim() || null,
        cover_url: coverUrl,
        track_count: n,
      }).select('id');
      if (e1) throw e1;
      if (!alb || alb.length === 0) throw new Error(NOT_ADMIN_MSG);
      albumId = alb[0].id;

      for (let i = 0; i < n; i++) {
        const t = tracks[i];
        setProgress(`Morceau ${i + 1}/${n} : envoi de « ${t.title.trim()} »…`);
        const duration = await readAudioDuration(t.audio);
        const audioUrl = await uploadToBucket(BUCKETS.audio, t.audio);
        uploaded.push([BUCKETS.audio, audioUrl]);
        // La pochette du morceau est celle de l'album (album_id → albums.cover_url)
        const { data: sg, error: e2 } = await supabase.from('songs').insert({
          album_id: albumId,
          title: t.title.trim(),
          artist: t.artist.trim() || 'ALP',
          description: t.story.trim() || null,
          audio_url: audioUrl,
          duration,
          lyrics_text: t.lyrics.trim() || null, // paroles écrites (animées + PDF)
          position: i + 1,
        }).select('id');
        if (e2) throw e2;
        if (!sg || sg.length === 0) throw new Error(NOT_ADMIN_MSG);
      }

      await onSaved();
      onClose();
    } catch (e) {
      if (albumId) await supabase.from('albums').delete().eq('id', albumId); // supprime aussi ses morceaux (cascade)
      await Promise.all(uploaded.map(([b, u]) => removeFromBucket(b, u)));
      setError((e.message || 'Erreur pendant la publication.') + " — rien n'a été publié.");
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const totalSteps = n ? n + 2 : 2;
  const coverThumb = coverPreview && (
    <img src={coverPreview} alt="Pochette" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 8, border: '1px solid #444' }} />
  );

  return (
    <div style={adminUi.overlay} onClick={() => { if (!busy) onClose(); }}>
      <div style={adminUi.box} onClick={(e) => e.stopPropagation()}>
        <h3 style={adminUi.title}>Créer un album</h3>
        <div style={adminUi.hint}>
          {step === 0 ? `Étape 1 sur ${totalSteps} — L'album` : step <= n ? `Étape ${step + 1} sur ${totalSteps} — Morceau ${step} sur ${n}` : `Étape ${totalSteps} sur ${totalSteps} — Récapitulatif`}
        </div>

        {/* ===== ÉTAPE 1 : L'ALBUM ===== */}
        {step === 0 && (
          <>
            <label style={adminUi.label}>Image de l'album * ({FORMATS.cover.label})</label>
            <input style={adminUi.input} type="file" accept={FORMATS.cover.accept} onChange={(e) => setCover(e.target.files[0] || null)} />
            {coverPreview && <img src={coverPreview} alt="Aperçu" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 10, marginTop: 10, border: '1px solid #444' }} />}

            <label style={adminUi.label}>Nom de l'album *</label>
            <input style={adminUi.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex : YASSAL P1" />

            <label style={adminUi.label}>Histoire de l'album</label>
            <textarea style={{ ...adminUi.input, minHeight: 90, resize: 'vertical' }} value={story} onChange={(e) => setStory(e.target.value)} />

            <div style={adminUi.row}>
              <div style={{ flex: 1 }}>
                <label style={adminUi.label}>Nombre de titres *</label>
                <input style={adminUi.input} type="number" min="1" max="40" value={count} onChange={(e) => setCount(e.target.value)} placeholder="Ex : 5" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={adminUi.label}>Date de sortie *</label>
                <input style={{ ...adminUi.input, colorScheme: 'dark' }} type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
              </div>
            </div>
          </>
        )}

        {/* ===== ÉTAPES 2..n+1 : UN MORCEAU PAR ÉCRAN ===== */}
        {step >= 1 && step <= n && (() => {
          const i = step - 1; const t = tracks[i];
          return (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                {coverThumb}
                <div style={{ fontSize: 13, color: '#ccc' }}>
                  <strong style={{ color: '#fff' }}>{title}</strong><br />
                  Ce morceau aura la même image que l'album.
                </div>
              </div>

              <label style={adminUi.label}>Nom du morceau *</label>
              <input style={adminUi.input} value={t.title} onChange={(e) => setTrack(i, { title: e.target.value })} />

              <label style={adminUi.label}>Fichier audio * ({FORMATS.audio.label})</label>
              <input style={adminUi.input} type="file" accept={FORMATS.audio.accept} onChange={(e) => setTrack(i, { audio: e.target.files[0] || null })} />
              {t.audio && <div style={adminUi.hint}>Sélectionné : {t.audio.name}</div>}

              <label style={adminUi.label}>Artiste(s)</label>
              <input style={adminUi.input} value={t.artist} onChange={(e) => setTrack(i, { artist: e.target.value })} placeholder="ALP ft ..." />

              <label style={adminUi.label}>Histoire du morceau</label>
              <textarea style={{ ...adminUi.input, minHeight: 80, resize: 'vertical' }} value={t.story} onChange={(e) => setTrack(i, { story: e.target.value })} />

              <label style={adminUi.label}>Paroles (lyrics) — à écrire ici</label>
              <textarea
                style={{ ...adminUi.input, minHeight: 170, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                value={t.lyrics}
                onChange={(e) => setTrack(i, { lyrics: e.target.value })}
                placeholder={"[Couplet 1]\nÉcrivez ou collez les paroles, une ligne par vers…\n\n[Refrain]\n…"}
              />
              <div style={adminUi.hint}>
                Les paroles défilent en animation pendant l'écoute et sont téléchargeables en PDF avec la pochette.
                Titres de section : [Refrain]. Synchro exacte (facultatif) : [01:23.50] au début d'une ligne.
              </div>
            </>
          );
        })()}

        {/* ===== DERNIÈRE ÉTAPE : RÉCAPITULATIF ===== */}
        {step === n + 1 && n > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
              {coverThumb}
              <div>
                <div style={{ fontWeight: 'bold' }}>{title}</div>
                <div style={adminUi.hint}>Sortie : {new Date(releaseDate + 'T00:00:00').toLocaleDateString('fr-FR')} • {n} titre(s)</div>
              </div>
            </div>
            <ol style={{ margin: '14px 0 0', paddingLeft: 20, fontSize: 13, color: '#ddd', lineHeight: 1.7 }}>
              {tracks.map((t, i) => (
                <li key={i}>
                  {t.title} <span style={{ color: '#777' }}>— {t.audio?.name}{t.lyrics.trim() ? ' • paroles écrites' : ' • sans paroles'}</span>
                </li>
              ))}
            </ol>
            <div style={adminUi.hint}>En publiant, l'album apparaît avec tous ses morceaux pour tout le monde.</div>
          </>
        )}

        {progress && <div style={{ ...adminUi.hint, color: '#ffb3b3', marginTop: 12 }}>{progress}</div>}
        {error && <div style={adminUi.error}>{error}</div>}

        <div style={adminUi.actions}>
          <button style={{ ...adminUi.btn, ...adminUi.btnGhost }} onClick={onClose} disabled={busy}>Annuler</button>
          {step > 0 && <button style={{ ...adminUi.btn, ...adminUi.btnGhost }} onClick={back} disabled={busy}>← Retour</button>}
          {step <= n && n >= 0 && !(step === n + 1) && (
            <button style={{ ...adminUi.btn, ...adminUi.btnMain }} onClick={next} disabled={busy}>
              {step === n && n > 0 ? 'Récapitulatif →' : 'Suivant →'}
            </button>
          )}
          {step === n + 1 && n > 0 && (
            <button style={{ ...adminUi.btn, ...adminUi.btnMain, opacity: busy ? 0.6 : 1 }} onClick={publish} disabled={busy}>
              {busy ? 'Publication…' : "Publier l'album"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------- Formulaire : ajouter / modifier un morceau ----------
const SongFormModal = ({ song, albums, songs, defaultAlbumId, onClose, onSaved }) => {
  const editing = !!song;
  const [albumId, setAlbumId] = useState(song?.album_id || defaultAlbumId || albums[0]?.id || '');
  const [title, setTitle] = useState(song?.title || '');
  const [artist, setArtist] = useState(song?.artist || 'ALP');
  const [description, setDescription] = useState(song?.description || '');
  const [audioFile, setAudioFile] = useState(null);
  const [lyricsText, setLyricsText] = useState(song?.lyrics || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (busy) return;
    if (!albumId) { setError("Choisissez d'abord un album (créez-en un si besoin)."); return; }
    if (!title.trim()) { setError('Le titre du morceau est obligatoire.'); return; }
    if (!editing && !audioFile) { setError('Le fichier audio est obligatoire.'); return; }
    const fe = checkFormat(audioFile, 'audio');
    if (fe) { setError(fe); return; }
    setBusy(true); setError('');
    const uploaded = [];
    let dbOk = false;
    try {
      const payload = {
        album_id: albumId,
        title: title.trim(),
        artist: artist.trim() || 'ALP',
        description: description.trim() || null,
        lyrics_text: lyricsText.trim() || null, // paroles écrites
      };
      // Les paroles écrites remplacent l'éventuel ancien fichier de paroles
      if (editing && song.lyrics_file_url) {
        payload.lyrics_file_url = null; payload.lyrics_file_name = null; payload.lyrics_file_type = null;
      }
      if (audioFile) {
        payload.duration = await readAudioDuration(audioFile);
        payload.audio_url = await uploadToBucket(BUCKETS.audio, audioFile);
        uploaded.push([BUCKETS.audio, payload.audio_url]);
      }
      if (!editing) payload.position = songs.filter(x => x.album_id === albumId).length + 1;

      const res = editing
        ? await supabase.from('songs').update(payload).eq('id', song.id).select('id')
        : await supabase.from('songs').insert(payload).select('id');
      if (res.error) throw res.error;
      if (!res.data || res.data.length === 0) throw new Error(NOT_ADMIN_MSG);
      dbOk = true;

      if (editing) {
        if (audioFile && song.src) removeFromBucket(BUCKETS.audio, song.src);
        if (song.lyrics_file_url) removeFromBucket(BUCKETS.lyrics, song.lyrics_file_url); // ancien fichier remplacé par le texte
      }
      await syncTrackCount(albumId);
      if (editing && song.album_id && song.album_id !== albumId) await syncTrackCount(song.album_id);
      await onSaved();
      onClose();
    } catch (e) {
      if (!dbOk) uploaded.forEach(([b, u]) => removeFromBucket(b, u));
      setError(e.message || "Erreur lors de l'enregistrement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={adminUi.overlay} onClick={onClose}>
      <div style={adminUi.box} onClick={(e) => e.stopPropagation()}>
        <h3 style={adminUi.title}>{editing ? 'Modifier le morceau' : 'Ajouter un morceau'}</h3>

        <label style={adminUi.label}>Album *</label>
        <select style={adminUi.input} value={albumId} onChange={(e) => setAlbumId(e.target.value)}>
          {albums.length === 0 && <option value="">— Aucun album : créez-en un d'abord —</option>}
          {albums.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
        </select>

        <label style={adminUi.label}>Titre *</label>
        <input style={adminUi.input} value={title} onChange={(e) => setTitle(e.target.value)} />

        <label style={adminUi.label}>Artiste(s)</label>
        <input style={adminUi.input} value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="ALP ft ..." />

        <label style={adminUi.label}>Histoire du morceau</label>
        <textarea style={{ ...adminUi.input, minHeight: 90, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />

        <label style={adminUi.label}>Fichier audio ({FORMATS.audio.label}) {editing ? "— laisser vide pour garder l'actuel" : '*'}</label>
        <input style={adminUi.input} type="file" accept={FORMATS.audio.accept} onChange={(e) => setAudioFile(e.target.files[0] || null)} />
        {audioFile && <div style={adminUi.hint}>Sélectionné : {audioFile.name} (la durée est détectée automatiquement)</div>}

        <label style={adminUi.label}>Paroles (lyrics) — à écrire ici, optionnel</label>
        <textarea
          style={{ ...adminUi.input, minHeight: 170, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
          value={lyricsText}
          onChange={(e) => setLyricsText(e.target.value)}
          placeholder={"[Couplet 1]\nÉcrivez ou collez les paroles, une ligne par vers…\n\n[Refrain]\n…"}
        />
        <div style={adminUi.hint}>
          Animées pendant l'écoute, téléchargeables en PDF avec la pochette. Synchro exacte (facultatif) : [01:23.50] au début d'une ligne.
        </div>
        {editing && song.lyrics_file_name && !lyricsText.trim() && (
          <div style={adminUi.hint}>Ancien fichier : {song.lyrics_file_name} — collez ses paroles ici pour les animer (l'ancien fichier sera remplacé).</div>
        )}

        {error && <div style={adminUi.error}>{error}</div>}
        <div style={adminUi.actions}>
          <button style={{ ...adminUi.btn, ...adminUi.btnGhost }} onClick={onClose} disabled={busy}>Annuler</button>
          <button style={{ ...adminUi.btn, ...adminUi.btnMain, opacity: busy ? 0.6 : 1 }} onClick={save} disabled={busy}>
            {busy ? 'Envoi en cours…' : (editing ? 'Enregistrer' : 'Ajouter')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Affichage automatique des paroles dans le panneau "Paroles" :
//  - .txt  → le contenu est lu et affiché directement (plus besoin de télécharger)
//  - .pdf  → affiché directement dans le panneau
//  - autre (.wps…) → non affichable par le navigateur : lien de téléchargement
//  - aucun fichier → texte de secours (song.lyrics) s'il existe
// Le contenu change automatiquement quand la chanson change.
// ---------------------------------------------------------------------------
const LegacyLyricsViewer = ({ song }) => {
  const url = song?.lyrics_file_url || '';
  const type = (song?.lyrics_file_type || url.split('?')[0].split('.').pop() || '').toLowerCase();
  const [text, setText] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | ok | error

  useEffect(() => {
    setText('');
    if (!url || type !== 'txt') { setStatus('idle'); return undefined; }
    let cancelled = false;
    setStatus('loading');
    fetch(url)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(buf => {
        let t;
        try { t = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
        catch (e) { t = new TextDecoder('windows-1252').decode(buf); }
        if (!cancelled) { setText(t.replace(/^\uFEFF/, '')); setStatus('ok'); }
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [url, type]);

  const downloadLink = url && (
    <p style={{ marginTop: 14 }}>
      <a href={url} target="_blank" rel="noopener noreferrer" className="lyrics-file-link">
        <i className="fas fa-file-download"></i> Télécharger les paroles ({type.toUpperCase()})
      </a>
    </p>
  );

  if (!url) {
    return <div className="lyrics-text">{song?.lyrics || 'Paroles non disponibles.'}</div>;
  }
  if (type === 'txt') {
    return (
      <div className="lyrics-text" style={{ whiteSpace: 'pre-wrap' }}>
        {status === 'loading' && 'Chargement des paroles…'}
        {status === 'ok' && (text.trim() || 'Paroles non disponibles.')}
        {status === 'error' && 'Impossible d\u2019afficher les paroles ici.'}
        {downloadLink}
      </div>
    );
  }
  if (type === 'pdf') {
    return (
      <div className="lyrics-text">
        <iframe
          key={url}
          src={url}
          title={'Paroles - ' + (song?.title || '')}
          style={{ width: '100%', height: '65vh', border: 0, borderRadius: 8, background: '#fff' }}
        />
        {downloadLink}
      </div>
    );
  }
  return (
    <div className="lyrics-text">
      {song?.lyrics || 'Ce format de paroles ne peut pas être affiché directement.'}
      {downloadLink}
    </div>
  );
};

// Paroles écrites -> animées. Ancien fichier (txt/pdf/wps) -> affichage d'avant.
const LyricsViewer = ({ song, currentTime, duration, isPlaying, onSeek }) => (
  hasLyrics(song)
    ? <AnimatedLyrics song={song} currentTime={currentTime} duration={duration} isPlaying={isPlaying} onSeek={onSeek} />
    : <LegacyLyricsViewer song={song} />
);

const AdminMusique = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { adminLogout } = useAuth();
  const audioRef = useRef(new Audio());
  const carouselRef = useRef(null);

  // États de la page
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackMode, setPlaybackMode] = useState('repeat-all');
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [userPseudo, setUserPseudo] = useState(localStorage.getItem('userPseudo') || 'KILO');
  const [userPhoto, setUserPhoto] = useState(localStorage.getItem('userPhoto') || 'https://cdn-icons-png.flaticon.com/512/149/149071.png');
  const [activeTab, setActiveTab] = useState('albums');
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [usersOnline, setUsersOnline] = useState(24);
  const [albumForm, setAlbumForm] = useState(null);   // { album } (modification)
  const [albumWizard, setAlbumWizard] = useState(false); // assistant de création d'album
  const [songForm, setSongForm] = useState(null);     // { song } (song null = ajout)
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedSongForModal, setSelectedSongForModal] = useState(null);
  const [albumModalOpen, setAlbumModalOpen] = useState(false);
  const [selectedAlbumModal, setSelectedAlbumModal] = useState(null);

  // ===== DONNÉES SUPABASE (lecture + écriture admin) =====
  const [albums, setAlbums] = useState(albumsData);
  const [songsListRaw, setSongsList] = useState(allSongsArray);

  const [currentUserId, setCurrentUserId] = useState(getOrCreateUserId);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    let off = false;
    resolveAuthUserId().then(id => {
      if (off) return;
      if (id) setCurrentUserId(id);
      setAuthReady(true);
    });
    return () => { off = true; };
  }, []);

  // Écoutes / téléchargements (1 par utilisateur et par morceau) depuis Supabase
  const { stats, recordListen, recordDownload } = useSongStats(currentUserId, authReady);
  const songsList = useMemo(() => songsListRaw.map(s => ({
    ...s,
    plays: stats[s.id]?.listens || 0,
    downloads: stats[s.id]?.downloads || 0
  })), [songsListRaw, stats]);

  // Un morceau qui démarre = 1 écoute pour cet utilisateur (une seule fois par morceau)
  useEffect(() => {
    if (currentSong?.id && isPlaying) recordListen(currentSong.id);
  }, [currentSong?.id, isPlaying, authReady, currentUserId]);

  const fetchAlbumsAndSongs = async () => {
    const { data: albumsRows, error: albumsErr } = await supabase
      .from('albums').select('*').order('created_at', { ascending: true });
    const { data: songsRows, error: songsErr } = await supabase
      .from('songs').select('*').order('album_id', { ascending: true }).order('position', { ascending: true });

    if (albumsErr) console.error('Erreur chargement albums :', albumsErr);
    if (songsErr) console.error('Erreur chargement morceaux :', songsErr);
    if (albumsErr || songsErr) return;

    const mappedAlbums = (albumsRows || []).map(a => ({
      id: a.id,
      title: a.title,
      artist: a.artist || 'ALP',
      year: a.release_date ? new Date(a.release_date + 'T00:00:00').toLocaleDateString('fr-FR') : (a.year || ''),
      release_date: a.release_date || null,
      cover: a.cover_url || defaultAlbumCover,
      cover_url: a.cover_url || null,
      description: a.description || '',
      songs: (songsRows || []).filter(s => s.album_id === a.id).map(s => s.id)
    }));
    setAlbums(mappedAlbums);

    const mappedSongs = (songsRows || []).map(s => {
      const parentAlbum = (albumsRows || []).find(a => a.id === s.album_id);
      return {
        id: s.id,
        title: s.title,
        artist: s.artist || 'ALP',
        album: parentAlbum ? parentAlbum.title : '',
        album_id: s.album_id,
        cover: parentAlbum?.cover_url || defaultAlbumCover,
        duration: s.duration || 0,
        src: s.audio_url || '',
        lyrics: s.lyrics_text || '', // paroles ÉCRITES (colonne songs.lyrics_text). Anciens morceaux : repli sur le fichier lyrics_file_url. `description` = histoire du morceau.
        lyrics_file_url: s.lyrics_file_url,
        lyrics_file_name: s.lyrics_file_name,
        lyrics_file_type: s.lyrics_file_type,
        description: s.description || '',
        plays: s.plays || 0,
        likes: s.likes || 0
      };
    });
    setSongsList(mappedSongs);
  };

  useEffect(() => { fetchAlbumsAndSongs(); }, []);

  // Pastille « utilisateurs » du pied de page (comme dans la version admin)
  useEffect(() => {
    const interval = setInterval(() => setUsersOnline(Math.floor(Math.random() * 36) + 15), 10000);
    return () => clearInterval(interval);
  }, []);

  // ===== ACTIONS ADMIN : suppression (les droits sont vérifiés par la base) =====
  const deleteAlbum = async (album) => {
    const albumSongs = songsListRaw.filter(x => x.album_id === album.id);
    const msg = `Supprimer l'album « ${album.title} »` +
      (albumSongs.length ? ` et ses ${albumSongs.length} morceau(x), avec leurs commentaires et réactions` : '') +
      ' ? Cette action est définitive.';
    if (!window.confirm(msg)) return;
    const { data, error } = await supabase.from('albums').delete().eq('id', album.id).select('id');
    if (error) { alert('Erreur lors de la suppression : ' + error.message); return; }
    if (!data || data.length === 0) { alert(NOT_ADMIN_MSG); return; }
    removeFromBucket(BUCKETS.cover, album.cover_url);
    albumSongs.forEach(x => { removeFromBucket(BUCKETS.audio, x.src); removeFromBucket(BUCKETS.lyrics, x.lyrics_file_url); });
    if (currentSong && albumSongs.some(x => x.id === currentSong.id)) {
      audioRef.current.pause(); setCurrentSong(null); setIsPlaying(false);
    }
    if (selectedAlbum === album.id) setSelectedAlbum(null);
    await fetchAlbumsAndSongs();
  };

  const deleteSong = async (song) => {
    if (!window.confirm(`Supprimer le morceau « ${song.title} » avec ses commentaires et réactions ? Cette action est définitive.`)) return;
    const { data, error } = await supabase.from('songs').delete().eq('id', song.id).select('id');
    if (error) { alert('Erreur lors de la suppression : ' + error.message); return; }
    if (!data || data.length === 0) { alert(NOT_ADMIN_MSG); return; }
    removeFromBucket(BUCKETS.audio, song.src);
    removeFromBucket(BUCKETS.lyrics, song.lyrics_file_url);
    if (currentSong?.id === song.id) { audioRef.current.pause(); setCurrentSong(null); setIsPlaying(false); }
    await syncTrackCount(song.album_id);
    await fetchAlbumsAndSongs();
  };

  // Réinitialisation automatique des compteurs (identique)
  const [resetDone, setResetDone] = useState(() => {
    return localStorage.getItem('resetDone') === 'true';
  });

  useEffect(() => {
    if (!resetDone) {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('comments_') ||
          key.startsWith('reactions_') ||
          key.startsWith('downloads_') ||
          key.startsWith('album_comments_') ||
          key.startsWith('album_reactions_') ||
          key.startsWith('album_userReaction_') ||
          key.startsWith('userReaction_') ||
          key.startsWith('commentLikes_') ||
          key.startsWith('albumCommentLikes_')
        )) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      localStorage.setItem('resetDone', 'true');
      setResetDone(true);
    }
  }, [resetDone]);

  // Gestion du lecteur audio (identique)
  useEffect(() => {
    const audio = audioRef.current;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => setDuration(audio.duration);
    const onEnd = () => playNextSong();
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
    };
  }, [playbackMode, currentSong]);

  useEffect(() => {
    const mode = localStorage.getItem('playbackMode');
    if (mode) setPlaybackMode(mode);
  }, []);

  const playSong = (song) => {
    if (currentSong?.id === song.id) {
      togglePlayPause();
    } else {
      audioRef.current.src = song.src;
      audioRef.current.play().catch(e => console.log("Erreur lecture audio:", e));
      setCurrentSong(song);
      setIsPlaying(true);
    }
  };
  const togglePlayPause = () => {
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
    setIsPlaying(!isPlaying);
  };
  const getFilteredSongs = () => {
    let songs = songsList;
    if (selectedAlbum !== null) {
      const album = albums.find(a => a.id === selectedAlbum);
      if (album) songs = songs.filter(s => album.songs.includes(s.id));
    } else {
      if (filterType === 'popular') songs = [...songs].sort((a,b) => (b.plays||0) - (a.plays||0));
      else if (filterType === 'favorites') songs = [...songs].sort((a,b) => (b.likes||0) - (a.likes||0));
    }
    return songs;
  };
  const displayedSongs = getFilteredSongs();
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const displayedAlbums = albums.filter(a =>
    !normalizedQuery ||
    a.title.toLowerCase().includes(normalizedQuery) ||
    (a.artist || '').toLowerCase().includes(normalizedQuery)
  );
  const searchFilteredSongs = displayedSongs.filter(s =>
    !normalizedQuery ||
    s.title.toLowerCase().includes(normalizedQuery) ||
    (s.artist || '').toLowerCase().includes(normalizedQuery) ||
    (s.album || '').toLowerCase().includes(normalizedQuery)
  );
  const playNextSong = () => {
    if (!currentSong) return;
    const list = getFilteredSongs();
    const idx = list.findIndex(s => s.id === currentSong.id);
    if (idx === -1) return;
    let nextIdx;
    if (playbackMode === 'repeat-one') nextIdx = idx;
    else if (playbackMode === 'shuffle') nextIdx = Math.floor(Math.random() * list.length);
    else nextIdx = (idx + 1) % list.length;
    if (list[nextIdx]) playSong(list[nextIdx]);
  };
  const playPreviousSong = () => {
    if (!currentSong) return;
    const list = getFilteredSongs();
    const idx = list.findIndex(s => s.id === currentSong.id);
    if (idx === -1) return;
    const prevIdx = (idx - 1 + list.length) % list.length;
    if (list[prevIdx]) playSong(list[prevIdx]);
  };
  const skipForward = () => { audioRef.current.currentTime = Math.min(audioRef.current.duration, audioRef.current.currentTime+30); };
  const skipBackward = () => { audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime-10); };
  const handleProgressClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = pct * duration;
  };
  const formatTime = (t) => {
    if (isNaN(t)) return "0:00";
    const m = Math.floor(t/60);
    const s = Math.floor(t%60);
    return `${m}:${s.toString().padStart(2,'0')}`;
  };
  const scrollCarousel = (dir) => {
    if (carouselRef.current) carouselRef.current.scrollBy({ left: dir === 'left' ? -300 : 300, behavior: 'smooth' });
  };
  const handleAlbumClick = (album) => {
    setSelectedAlbumModal(album);
    setAlbumModalOpen(true);
  };
  const handleFilterClick = (type) => {
    setSelectedAlbum(null);
    setFilterType(type);
  };
  const handleLogout = async () => {
    try { await adminLogout(); } catch (e) { console.warn(e); }
    try { await supabase.auth.signOut(); } catch (e) { console.warn(e); }
    navigate('/login');
  };

  return (
    <div className="admin-musique" style={{ backgroundImage: `url(${bgImage})` }}>
      {/* ====== EN-TÊTE ADMIN ====== */}
      <header className="admin-header">
        <div className="header-left">
          <div className="menu-trigger" onClick={() => setMenuOpen(!menuOpen)}>
            <i className={`fas fa-${menuOpen ? 'times' : 'bars'}`}></i>
          </div>
          <div className="profile-header" onClick={() => setProfileSettingsOpen(!profileSettingsOpen)}>
            <img src={userPhoto} alt="Admin" />
            <span>{userPseudo}</span>
          </div>
        </div>
        <div className="welcome-msg"><span className="typing">ESPACE MUSIQUE YASSAL</span></div>
        {menuOpen && (
          <div className="side-menu">
            <div className="menu-item" onClick={() => { setProfileSettingsOpen(true); setMenuOpen(false); }}><i className="fas fa-user-circle"></i> Profil</div>
            <div className="menu-item" onClick={() => { alert('Sécurité à venir'); setMenuOpen(false); }}><i className="fas fa-shield-alt"></i> Sécurité</div>
            <div className="menu-item" onClick={handleLogout}><i className="fas fa-sign-out-alt"></i> Déconnexion</div>
          </div>
        )}
        {profileSettingsOpen && (
          <ProfileSettingsPanel
            onClose={() => setProfileSettingsOpen(false)}
            userPseudo={userPseudo}
            setUserPseudo={setUserPseudo}
            userPhoto={userPhoto}
            setUserPhoto={setUserPhoto}
            usersOnline={usersOnline}
            onLogout={() => { handleLogout(); setProfileSettingsOpen(false); }}
          />
        )}
      </header>

      {/* ====== ONGLETS MOBILES ====== */}
      <div id="mobile-tabs-container" className="mobile-tabs" style={{ display: 'flex' }}>
        <button className={`mobile-tab-btn ${activeTab === 'player' ? 'active' : ''}`} onClick={() => setActiveTab('player')}>
          <i className="fas fa-play"></i> Lecteur
        </button>
        <button className={`mobile-tab-btn ${activeTab === 'albums' ? 'active' : ''}`} onClick={() => setActiveTab('albums')}>
          <i className="fas fa-compact-disc"></i> Albums
        </button>
        <button className={`mobile-tab-btn ${activeTab === 'lyrics' ? 'active' : ''}`} onClick={() => setActiveTab('lyrics')}>
          <i className="fas fa-file-alt"></i> Paroles
        </button>
      </div>

      <div className="music-main">
        {/* ===== PANEL LECTEUR ===== */}
        <section className={`panel-section player-section ${activeTab === 'player' ? 'mobile-active' : ''}`}>
          <div className="brand-title"><img src={userPhoto} alt="logo" style={{width:'30px',height:'30px',borderRadius:'50%'}} /> YASSAL</div>
          <div className="player-header-vertical">
            <div className="album-cover-large"><img src={currentSong?.cover || defaultAlbumCover} alt="cover" /></div>
            <div className="song-details">
              <h2>{currentSong?.title || "Aucune musique"}</h2>
              <p style={{color:'var(--white)',fontSize:'14px',margin:'5px 0'}}>{currentSong?.artist || "Sélectionnez une chanson"}</p>
              <p style={{color:'var(--gray)',fontSize:'12px',margin:'0'}}>{currentSong?.album || "Single"}</p>
            </div>
          </div>
          <div className="player-controls">
            <div className="progress-container">
              <span className="time-display">{formatTime(currentTime)}</span>
              <div className="progress-bar" onClick={handleProgressClick}><div className="progress" style={{ width: `${(currentTime/duration)*100||0}%` }}></div></div>
              <span className="time-display">{formatTime(duration)}</span>
            </div>
            <div className="control-buttons">
              <button className="control-btn" onClick={playPreviousSong}><i className="fas fa-step-backward"></i></button>
              <button className="control-btn" onClick={skipBackward}><i className="fas fa-undo"></i></button>
              <button className="control-btn play-btn-large" onClick={togglePlayPause}><i className={`fas fa-${isPlaying ? 'pause' : 'play'}`}></i></button>
              <button className="control-btn" onClick={skipForward}><i className="fas fa-redo"></i></button>
              <button className="control-btn" onClick={playNextSong}><i className="fas fa-step-forward"></i></button>
            </div>
            <div className="playback-mode-control">
              <select value={playbackMode} onChange={(e) => { setPlaybackMode(e.target.value); localStorage.setItem('playbackMode', e.target.value); }} className="playback-mode-select">
                <option value="repeat-all">Répéter tout</option>
                <option value="repeat-one">Répéter un</option>
                <option value="shuffle">Aléatoire</option>
              </select>
            </div>
          </div>
          <div className="library-separator"></div>
          <div className="library">
            <h3><i className="fas fa-download"></i> Musiques téléchargées</h3>
            <div className="library-list">
              <div className="empty-library">
                <i className="fas fa-cloud-download-alt"></i>
                <p>Aucune musique téléchargée<br/>Importez vos fichiers audio</p>
              </div>
            </div>
          </div>
        </section>

        {/* ===== PANEL ALBUMS ===== */}
        <section className={`panel-section albums-section ${activeTab === 'albums' ? 'mobile-active' : ''}`}>
          <div className="search-container">
            <i className="fas fa-search"></i>
            <input
              type="text"
              placeholder="Rechercher un titre, un album..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <i
                className="fas fa-times-circle search-clear"
                style={{ cursor: 'pointer', opacity: 0.7 }}
                onClick={() => setSearchQuery('')}
              ></i>
            )}
          </div>
          {normalizedQuery && displayedAlbums.length === 0 && (
            <div className="no-songs" style={{ padding: '10px 0' }}>Aucun album ne correspond à "{searchQuery}".</div>
          )}
          <button
            onClick={() => setAlbumWizard(true)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', margin: '12px 0', padding: '12px 16px', background: 'rgba(255,0,0,0.12)', color: '#fff', border: '2px solid #ff0000', borderRadius: 8, fontWeight: 'bold', fontSize: 14, letterSpacing: 1, textTransform: 'uppercase', cursor: 'pointer' }}
          >
            <i className="fas fa-plus-circle"></i> Créer un album
          </button>
          <div className="section-header">
            <h2 className="section-title"><i className="fas fa-compact-disc"></i> Albums</h2>
          </div>
          <div className="albums-carousel">
            <i className="fas fa-chevron-left nav-arrow" onClick={() => scrollCarousel('left')}></i>
            <div className="albums-horizontal" ref={carouselRef}>
              {displayedAlbums.map(album => (
                <div key={album.id} className={`album-card-horizontal ${selectedAlbum === album.id ? 'active' : ''}`} style={{ position: 'relative' }} onClick={() => handleAlbumClick(album)}>
                  <div style={adminUi.cardTools}>
                    <button title="Modifier l'album" style={adminUi.iconBtn} onClick={(e) => { e.stopPropagation(); setAlbumForm({ album }); }}><i className="fas fa-pen"></i></button>
                    <button title="Supprimer l'album" style={{ ...adminUi.iconBtn, color: '#ff4d4d' }} onClick={(e) => { e.stopPropagation(); deleteAlbum(album); }}><i className="fas fa-trash"></i></button>
                  </div>
                  <div className="album-cover-container"><img src={album.cover} alt={album.title} onError={(e) => e.target.src = defaultAlbumCover} /></div>
                  <div className="album-info">
                    <div className="album-title">{album.title}</div>
                    <div className="album-artist">{album.artist}</div>
                    <div className="album-description">{album.description}</div>
                    <div className="album-meta">
                      <span><i className="far fa-calendar"></i> {album.year}</span>
                      <span><i className="fas fa-music"></i> {album.songs.length} titres</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <i className="fas fa-chevron-right nav-arrow" onClick={() => scrollCarousel('right')}></i>
          </div>
          {selectedAlbum === null && (
            <div className="filter-tabs">
              <button className={`filter-btn ${filterType === 'all' ? 'active' : ''}`} onClick={() => handleFilterClick('all')}>Tous</button>
              <button className={`filter-btn ${filterType === 'popular' ? 'active' : ''}`} onClick={() => handleFilterClick('popular')}>Populaires</button>
              <button className={`filter-btn ${filterType === 'favorites' ? 'active' : ''}`} onClick={() => handleFilterClick('favorites')}>Favoris</button>
            </div>
          )}
          {selectedAlbum !== null && (
            <div className="album-filter-info">
              <span>Morceaux de l'album : <strong>{albums.find(a => a.id === selectedAlbum)?.title}</strong></span>
              <button className="clear-album-btn" onClick={() => setSelectedAlbum(null)}>Voir tous les morceaux</button>
            </div>
          )}

          {/* ===== LISTE DES MORCEAUX ===== */}
          <div className="songs-list-full">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3 style={{ margin: 0 }}>
                <i className="fas fa-music"></i> {selectedAlbum ? "Morceaux de l'album" : (filterType === 'popular' ? "Morceaux populaires" : filterType === 'favorites' ? "Morceaux favoris" : "Tous les morceaux")}
              </h3>
              <button onClick={() => setSongForm({ song: null })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'transparent', color: '#fff', border: '1px solid #ff0000', borderRadius: 6, fontWeight: 'bold', fontSize: 12, textTransform: 'uppercase', cursor: 'pointer' }}><i className="fas fa-plus"></i> Ajouter un morceau</button>
            </div>
            <div className="songs-container-full">
              {searchFilteredSongs.map(song => (
                <div key={song.id} className={`song-item-full ${currentSong?.id === song.id ? 'active' : ''}`}>
                  <div className="song-cover" onClick={() => playSong(song)}><img src={song.cover} alt="cover" /></div>
                  <div className="song-details-full" onClick={() => playSong(song)}>
                    <div className="song-title-full">{song.title}</div>
                    <div className="song-artist-full">{song.artist} • {song.album}</div>
                  </div>
                  <div className="song-stats">
                    <span><i className="fas fa-play-circle"></i> {song.plays || 0}</span>
                    <span><i className="fas fa-heart"></i> {song.likes || 0}</span>
                  </div>
                  <div className="song-duration-full">{formatTime(song.duration)}</div>
                  <button className="story-btn" onClick={(e) => { e.stopPropagation(); setSelectedSongForModal(song); setModalOpen(true); }}>
                    <i className="fas fa-book-open"></i>
                  </button>
                  <div style={adminUi.rowTools}>
                    <button title="Modifier le morceau" style={adminUi.iconBtn} onClick={(e) => { e.stopPropagation(); setSongForm({ song }); }}><i className="fas fa-pen"></i></button>
                    <button title="Supprimer le morceau" style={{ ...adminUi.iconBtn, color: '#ff4d4d' }} onClick={(e) => { e.stopPropagation(); deleteSong(song); }}><i className="fas fa-trash"></i></button>
                  </div>
                </div>
              ))}
              {searchFilteredSongs.length === 0 && <div className="no-songs">Aucun morceau trouvé.</div>}
            </div>
          </div>
        </section>

        {/* ===== PANEL PAROLES ===== */}
        <section className={`panel-section lyrics-section ${activeTab === 'lyrics' ? 'mobile-active' : ''}`}>
          <div className="lyrics-header"><h2><i className="fas fa-file-alt"></i> Paroles</h2></div>
          <div className="lyrics-content">
            {currentSong ? (
              <LyricsViewer
                song={songsList.find(x => x.id === currentSong.id) || currentSong}
                currentTime={currentTime}
                duration={duration}
                isPlaying={isPlaying}
                onSeek={(t) => { audioRef.current.currentTime = t; }}
              />
            ) : (
              <div className="no-lyrics"><i className="fas fa-music"></i><p>Sélectionnez une chanson<br/>pour afficher les paroles</p></div>
            )}
          </div>
        </section>
      </div>

      {/* MODALES */}
      {modalOpen && selectedSongForModal && (
        <SongStoryModal song={songsList.find(s => s.id === selectedSongForModal.id) || selectedSongForModal} onClose={() => setModalOpen(false)} currentUserId={currentUserId} currentUserAvatar={userPhoto} currentUserPseudo={userPseudo} downloadsCount={stats[selectedSongForModal.id]?.downloads || 0} onDownload={() => recordDownload(selectedSongForModal.id)} />
      )}
      {albumModalOpen && selectedAlbumModal && (
        <AlbumModal 
          album={selectedAlbumModal} 
          onClose={() => setAlbumModalOpen(false)} 
          onPlaySong={playSong} 
          allSongs={songsList}
          currentUserId={currentUserId}
          currentUserAvatar={userPhoto}
          currentUserPseudo={userPseudo}
        />
      )}

      {albumWizard && (
        <AlbumWizardModal onClose={() => setAlbumWizard(false)} onSaved={fetchAlbumsAndSongs} />
      )}
      {albumForm && (
        <AlbumFormModal album={albumForm.album} onClose={() => setAlbumForm(null)} onSaved={fetchAlbumsAndSongs} />
      )}
      {songForm && (
        <SongFormModal
          song={songForm.song}
          albums={albums}
          songs={songsListRaw}
          defaultAlbumId={selectedAlbum}
          onClose={() => setSongForm(null)}
          onSaved={fetchAlbumsAndSongs}
        />
      )}

      {/* ====== FOOTER ADMIN ====== */}
      <footer className="admin-footer">
        <div className="footer-nav">
          <button className={`foot-icon ${location.pathname === '/admin/users' ? 'active' : ''}`} onClick={() => navigate('/admin/users')}>
            <i className="fas fa-user-friends"></i>
            <span className="users-badge">{usersOnline}</span>
          </button>
          <button className={`foot-icon ${location.pathname === '/admin/home' ? 'active' : ''}`} onClick={() => navigate('/admin/home')}>
            <i className="fas fa-home"></i>
          </button>
          <button className={`foot-icon ${location.pathname === '/admin/musique' ? 'active' : ''}`} onClick={() => navigate('/admin/musique')}>
            <i className="fas fa-headphones"></i>
          </button>
          <button className={`foot-icon ${location.pathname === '/admin/vip' ? 'active' : ''}`} onClick={() => navigate('/admin/vip')}>
            <i className="fas fa-crown"></i>
          </button>
        </div>
      </footer>
    </div>
  );
};

export default AdminMusique;
