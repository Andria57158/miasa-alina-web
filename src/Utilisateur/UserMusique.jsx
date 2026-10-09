// src/User/UserMusique.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import '../Admin/AdminMusique.css'; // On réutilise le même CSS
import bgImage from '../assets/Images/men_your_brave.jpeg';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import { uploadToR2 } from '../cloudflareClient';
import { usePlayer } from '../context/PlayerContext';
import ProfileSettingsPanel from '../Admin/ProfileSettingsPanel'; // Même panneau/menu que la page admin
// NB: si ProfileSettingsPanel.jsx attend une prop "usersOnline" (statistique
// admin), elle est simplement absente ici : vérifiez qu'elle est optionnelle
// dans ce composant, sinon passez usersOnline={null}.
import EmojiPicker from '../components/EmojiPicker';
import '../utils/voiceMessage'; // Conservé : lecteur des anciens commentaires vocaux déjà enregistrés
import { buildVoiceBubbleHtml } from '../utils/voiceBubble'; // Nouvelle bulle vocale (capsule rouge)
import { cleanHtml } from '../utils/sanitizeHtml'; // Protection XSS des commentaires
import AnimatedLyrics from '../components/AnimatedLyrics'; // Paroles animées
import { hasLyrics, downloadLyricsPdf } from '../utils/lyricsTools'; // Animation + PDF des paroles
import PlaybackModeButton from '../components/PlaybackModeButton'; // Bouton-icône des modes de lecture

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

// ----------------------------------------------
// BIBLIOTHÈQUE — "télécharger" un morceau ou un album ne quitte plus le
// site (pas de fichier envoyé sur l'ordinateur) : ça l'ajoute simplement
// à cette bibliothèque personnelle, stockée sur cet appareil, pour le
// réécouter facilement depuis le panneau "Bibliothèque".
// ----------------------------------------------
const LIBRARY_SONGS_KEY = 'library_songs';
const LIBRARY_ALBUMS_KEY = 'library_albums';

const getLibrarySongs = () => {
  try { return JSON.parse(localStorage.getItem(LIBRARY_SONGS_KEY)) || []; } catch { return []; }
};
const getLibraryAlbums = () => {
  try { return JSON.parse(localStorage.getItem(LIBRARY_ALBUMS_KEY)) || []; } catch { return []; }
};
const notifyLibraryUpdated = () => window.dispatchEvent(new Event('library-updated'));

// Envoie au Service Worker les URLs (musique + pochette) à mettre en cache
// (Cache API) pour que la bibliothèque fonctionne vraiment hors-ligne.
const cacheMediaForOffline = (urls) => {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    (urls || []).filter(Boolean).forEach((url) => {
      navigator.serviceWorker.controller.postMessage({ type: 'CACHE_MEDIA', url });
    });
  }
};

const uncacheMedia = (urls) => {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    (urls || []).filter(Boolean).forEach((url) => {
      navigator.serviceWorker.controller.postMessage({ type: 'REMOVE_MEDIA', url });
    });
  }
};

const addSongToLibrary = (song) => {
  const list = getLibrarySongs();
  if (!list.some(s => s.id === song.id)) {
    list.unshift({
      id: song.id, title: song.title, artist: song.artist, album: song.album,
      cover: song.cover, duration: song.duration, src: song.src
    });
    localStorage.setItem(LIBRARY_SONGS_KEY, JSON.stringify(list));
  }
  cacheMediaForOffline([song.src, song.cover]);
  notifyLibraryUpdated();
};

const addAlbumToLibrary = (album, allSongs) => {
  const albums = getLibraryAlbums();
  if (!albums.some(a => a.id === album.id)) {
    albums.unshift({ id: album.id, title: album.title, artist: album.artist, cover: album.cover, year: album.year });
    localStorage.setItem(LIBRARY_ALBUMS_KEY, JSON.stringify(albums));
  }
  const songsOfAlbum = (allSongs || []).filter(s => s.album_id === album.id);
  const list = getLibrarySongs();
  songsOfAlbum.forEach(song => {
    if (!list.some(s => s.id === song.id)) {
      list.unshift({
        id: song.id, title: song.title, artist: song.artist, album: song.album,
        cover: song.cover, duration: song.duration, src: song.src
      });
    }
  });
  localStorage.setItem(LIBRARY_SONGS_KEY, JSON.stringify(list));
  cacheMediaForOffline([album.cover, ...songsOfAlbum.flatMap(s => [s.src, s.cover])]);
  notifyLibraryUpdated();
};

const removeSongFromLibrary = (songId) => {
  const existing = getLibrarySongs();
  const removed = existing.find(s => s.id === songId);
  const list = existing.filter(s => s.id !== songId);
  localStorage.setItem(LIBRARY_SONGS_KEY, JSON.stringify(list));
  if (removed) uncacheMedia([removed.src, removed.cover]);
  notifyLibraryUpdated();
};
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
  const [pendingVoice, setPendingVoice] = useState(null); // { url, html } — vocal enregistré, pas encore envoyé
  const [isPaused, setIsPaused] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const micStreamRef = useRef(null);
  const micAudioCtxRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const micLevelRafRef = useRef(null);
  const [micLevel, setMicLevel] = useState(0);

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

  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordedSecondsRef = useRef(0); // durée figée au moment de l'arrêt (affichée dans la bulle)
  const recordingIntervalRef = useRef(null);

  // Arrête le vu-mètre Web Audio API et libère l'AudioContext du micro
  const stopMicMeter = () => {
    if (micLevelRafRef.current) cancelAnimationFrame(micLevelRafRef.current);
    micLevelRafRef.current = null;
    if (micAudioCtxRef.current) {
      micAudioCtxRef.current.close().catch(() => {});
      micAudioCtxRef.current = null;
    }
    micAnalyserRef.current = null;
    setMicLevel(0);
  };

  // Branche le flux du micro dans la Web Audio API (AnalyserNode) pour
  // afficher un vu-mètre en direct pendant l'enregistrement (entrée vocale).
  const startMicMeter = (stream) => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    micAudioCtxRef.current = ctx;
    micAnalyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setMicLevel(Math.min(1, avg / 100));
      micLevelRafRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      stopMicMeter();
      if (micStreamRef.current) micStreamRef.current.getTracks().forEach(track => track.stop());
    };
  }, []);

  const finishRecording = () => {
    setIsRecording(false);
    setIsPaused(false);
    clearInterval(recordingIntervalRef.current);
    setRecordingSeconds(0);
    stopMicMeter();
  };

  // Annule l'enregistrement en cours SANS envoyer le message vocal
  const cancelVoiceRecord = () => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.onstop = () => {
      audioChunksRef.current = [];
      if (micStreamRef.current) micStreamRef.current.getTracks().forEach(track => track.stop());
    };
    mediaRecorderRef.current.stop();
    finishRecording();
  };

  // Bouton pause / reprise (celui qui manquait) — s'appuie sur
  // MediaRecorder.pause()/resume(), pendant que la Web Audio API continue
  // d'afficher le vu-mètre du micro.
  const togglePauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.pause();
      setIsPaused(true);
      clearInterval(recordingIntervalRef.current);
    } else if (recorder.state === 'paused') {
      recorder.resume();
      setIsPaused(false);
      recordingIntervalRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    }
  };

  const hasVoice = isRecording || isPaused || !!pendingVoice;
  const hasText = !!(((replyTo ? replyTo.replyText : newCommentText) || '').trim()) || !!tempImage;

  const handleVoiceRecord = async () => {
    if (isRecording) {
      recordedSecondsRef.current = recordingSeconds;
      mediaRecorderRef.current.stop();
      finishRecording();
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;
        // L'API MediaStream Recording (MediaRecorder) choisit le meilleur
        // format pris en charge par le navigateur (webm/opus sur Chrome &
        // Firefox, mp4/aac sur Safari...) au lieu d'imposer 'audio/webm'.
        const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
        const supportedMimeType = mimeCandidates.find(
          (type) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)
        ) || '';
        mediaRecorderRef.current = supportedMimeType
          ? new MediaRecorder(stream, { mimeType: supportedMimeType })
          : new MediaRecorder(stream);
        const usedMimeType = mediaRecorderRef.current.mimeType || supportedMimeType || 'audio/webm';

        mediaRecorderRef.current.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        mediaRecorderRef.current.onstop = async () => {
          const chunks = audioChunksRef.current;
          audioChunksRef.current = [];
          stream.getTracks().forEach(track => track.stop());
          if (chunks.length === 0) return; // enregistrement annulé, rien à envoyer
          const audioBlob = new Blob(chunks, { type: usedMimeType });
          setUploadingMedia(true);
          try {
            const ext = usedMimeType.includes('mp4') ? 'm4a' : usedMimeType.includes('ogg') ? 'ogg' : 'webm';
            const audioFile = new File([audioBlob], `voice_${Date.now()}.${ext}`, { type: usedMimeType });
            const uploaded = await uploadToR2(audioFile, 'voice');
            // Sortie vocale : lecteur personnalisé (Web Audio API, vu-mètre +
            // pause/lecture) au lieu du <audio> natif brut.
            // Le vocal n'est plus collé (en HTML brut) dans le champ texte :
            // il est gardé à part et affiché en aperçu dans la zone de saisie.
            setPendingVoice({ url: uploaded.url, html: buildVoiceBubbleHtml(uploaded.url, recordedSecondsRef.current) });
          } catch (err) {
            alert("Échec de l'envoi du message vocal : " + err.message);
          } finally {
            setUploadingMedia(false);
          }
        };
        audioChunksRef.current = [];
        mediaRecorderRef.current.start();
        startMicMeter(stream);
        setIsRecording(true);
        setIsPaused(false);
        setRecordingSeconds(0);
        recordingIntervalRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
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
        {(isRecording || isPaused) && (
          <div className="voice-recording-bar">
            <button type="button" className="tool-btn voice-cancel-btn" onClick={cancelVoiceRecord} title="Annuler">
              <i className="fas fa-trash-alt"></i>
            </button>
            <div className="voice-recording-level" aria-hidden="true">
              <span style={{ transform: `scaleY(${0.25 + micLevel * 0.9})` }}></span>
              <span style={{ transform: `scaleY(${0.25 + micLevel * 0.6})` }}></span>
              <span style={{ transform: `scaleY(${0.25 + micLevel * 1})` }}></span>
              <span style={{ transform: `scaleY(${0.25 + micLevel * 0.5})` }}></span>
            </div>
            <span className="recording-timer" style={{ fontSize: 12, color: '#ff4d4d' }}>
              {isPaused ? 'Pause' : '●'} {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
            </span>
            <button type="button" className="tool-btn voice-pause-btn" onClick={togglePauseRecording} title={isPaused ? 'Reprendre' : 'Mettre en pause'}>
              <i className={`fas fa-${isPaused ? 'play' : 'pause'}`}></i>
            </button>
            <button type="button" className="tool-btn voice-stop-btn" onClick={handleVoiceRecord} title="Terminer et envoyer">
              <i className="fas fa-check-circle"></i>
            </button>
          </div>
        )}
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
        {/* Pendant un vocal, le champ texte est désactivé : un commentaire est soit écrit, soit vocal. */}
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
            className={`tool-btn input-mic-btn ${isRecording && !isPaused ? 'recording-active' : ''}`}
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
  const [pendingVoice, setPendingVoice] = useState(null); // { url, html } — vocal enregistré, pas encore envoyé
  const [isPaused, setIsPaused] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const micStreamRef = useRef(null);
  const micAudioCtxRef = useRef(null);
  const micAnalyserRef = useRef(null);
  const micLevelRafRef = useRef(null);
  const [micLevel, setMicLevel] = useState(0);

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

  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordedSecondsRef = useRef(0); // durée figée au moment de l'arrêt (affichée dans la bulle)
  const recordingIntervalRef = useRef(null);

  // Arrête le vu-mètre Web Audio API et libère l'AudioContext du micro
  const stopMicMeter = () => {
    if (micLevelRafRef.current) cancelAnimationFrame(micLevelRafRef.current);
    micLevelRafRef.current = null;
    if (micAudioCtxRef.current) {
      micAudioCtxRef.current.close().catch(() => {});
      micAudioCtxRef.current = null;
    }
    micAnalyserRef.current = null;
    setMicLevel(0);
  };

  // Branche le flux du micro dans la Web Audio API (AnalyserNode) pour
  // afficher un vu-mètre en direct pendant l'enregistrement (entrée vocale).
  const startMicMeter = (stream) => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    micAudioCtxRef.current = ctx;
    micAnalyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setMicLevel(Math.min(1, avg / 100));
      micLevelRafRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      stopMicMeter();
      if (micStreamRef.current) micStreamRef.current.getTracks().forEach(track => track.stop());
    };
  }, []);

  const finishRecording = () => {
    setIsRecording(false);
    setIsPaused(false);
    clearInterval(recordingIntervalRef.current);
    setRecordingSeconds(0);
    stopMicMeter();
  };

  // Annule l'enregistrement en cours SANS envoyer le message vocal
  const cancelVoiceRecord = () => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.onstop = () => {
      audioChunksRef.current = [];
      if (micStreamRef.current) micStreamRef.current.getTracks().forEach(track => track.stop());
    };
    mediaRecorderRef.current.stop();
    finishRecording();
  };

  // Bouton pause / reprise (celui qui manquait) — s'appuie sur
  // MediaRecorder.pause()/resume(), pendant que la Web Audio API continue
  // d'afficher le vu-mètre du micro.
  const togglePauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.pause();
      setIsPaused(true);
      clearInterval(recordingIntervalRef.current);
    } else if (recorder.state === 'paused') {
      recorder.resume();
      setIsPaused(false);
      recordingIntervalRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    }
  };

  const hasVoice = isRecording || isPaused || !!pendingVoice;
  const hasText = !!(((replyTo ? replyTo.replyText : newCommentText) || '').trim()) || !!tempImage;

  const handleVoiceRecord = async () => {
    if (isRecording) {
      recordedSecondsRef.current = recordingSeconds;
      mediaRecorderRef.current.stop();
      finishRecording();
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;
        // L'API MediaStream Recording (MediaRecorder) choisit le meilleur
        // format pris en charge par le navigateur (webm/opus sur Chrome &
        // Firefox, mp4/aac sur Safari...) au lieu d'imposer 'audio/webm'.
        const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
        const supportedMimeType = mimeCandidates.find(
          (type) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)
        ) || '';
        mediaRecorderRef.current = supportedMimeType
          ? new MediaRecorder(stream, { mimeType: supportedMimeType })
          : new MediaRecorder(stream);
        const usedMimeType = mediaRecorderRef.current.mimeType || supportedMimeType || 'audio/webm';

        mediaRecorderRef.current.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        mediaRecorderRef.current.onstop = async () => {
          const chunks = audioChunksRef.current;
          audioChunksRef.current = [];
          stream.getTracks().forEach(track => track.stop());
          if (chunks.length === 0) return; // enregistrement annulé, rien à envoyer
          const audioBlob = new Blob(chunks, { type: usedMimeType });
          setUploadingMedia(true);
          try {
            const ext = usedMimeType.includes('mp4') ? 'm4a' : usedMimeType.includes('ogg') ? 'ogg' : 'webm';
            const audioFile = new File([audioBlob], `voice_${Date.now()}.${ext}`, { type: usedMimeType });
            const uploaded = await uploadToR2(audioFile, 'voice');
            // Sortie vocale : lecteur personnalisé (Web Audio API, vu-mètre +
            // pause/lecture) au lieu du <audio> natif brut.
            // Le vocal n'est plus collé (en HTML brut) dans le champ texte :
            // il est gardé à part et affiché en aperçu dans la zone de saisie.
            setPendingVoice({ url: uploaded.url, html: buildVoiceBubbleHtml(uploaded.url, recordedSecondsRef.current) });
          } catch (err) {
            alert("Échec de l'envoi du message vocal : " + err.message);
          } finally {
            setUploadingMedia(false);
          }
        };
        audioChunksRef.current = [];
        mediaRecorderRef.current.start();
        startMicMeter(stream);
        setIsRecording(true);
        setIsPaused(false);
        setRecordingSeconds(0);
        recordingIntervalRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
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
        {(isRecording || isPaused) && (
          <div className="voice-recording-bar">
            <button type="button" className="tool-btn voice-cancel-btn" onClick={cancelVoiceRecord} title="Annuler">
              <i className="fas fa-trash-alt"></i>
            </button>
            <div className="voice-recording-level" aria-hidden="true">
              <span style={{ transform: `scaleY(${0.25 + micLevel * 0.9})` }}></span>
              <span style={{ transform: `scaleY(${0.25 + micLevel * 0.6})` }}></span>
              <span style={{ transform: `scaleY(${0.25 + micLevel * 1})` }}></span>
              <span style={{ transform: `scaleY(${0.25 + micLevel * 0.5})` }}></span>
            </div>
            <span className="recording-timer" style={{ fontSize: 12, color: '#ff4d4d' }}>
              {isPaused ? 'Pause' : '●'} {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
            </span>
            <button type="button" className="tool-btn voice-pause-btn" onClick={togglePauseRecording} title={isPaused ? 'Reprendre' : 'Mettre en pause'}>
              <i className={`fas fa-${isPaused ? 'play' : 'pause'}`}></i>
            </button>
            <button type="button" className="tool-btn voice-stop-btn" onClick={handleVoiceRecord} title="Terminer et envoyer">
              <i className="fas fa-check-circle"></i>
            </button>
          </div>
        )}
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
        {/* Pendant un vocal, le champ texte est désactivé : un commentaire est soit écrit, soit vocal. */}
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
            className={`tool-btn input-mic-btn ${isRecording && !isPaused ? 'recording-active' : ''}`}
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
  const [downloadMessage, setDownloadMessage] = useState('');
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

  // "Télécharger" l'album ajoute l'album ET tous ses morceaux à la
  // bibliothèque du site — rien ne quitte le site.
  // Si des morceaux ont des paroles, un seul PDF est téléchargé : page de
  // garde avec la pochette de l'album, puis les paroles de chaque titre.
  const downloadAlbum = async () => {
    addAlbumToLibrary(album, allSongs);
    const withLyrics = allSongs.filter(sg => album.songs.includes(sg.id)).filter(hasLyrics);
    if (withLyrics.length === 0) {
      setDownloadMessage('Album ajouté à votre bibliothèque !');
      setTimeout(() => setDownloadMessage(''), 2000);
      return;
    }
    setDownloadMessage('Préparation du PDF des paroles…');
    try {
      await downloadLyricsPdf({
        songs: withLyrics,
        album: { title: album.title, artist: album.artist, year: album.year, cover: album.cover },
      });
      setDownloadMessage('Album ajouté à votre bibliothèque + PDF des paroles téléchargé !');
    } catch (e) {
      console.error(e);
      setDownloadMessage('Album ajouté à votre bibliothèque (PDF des paroles indisponible).');
    }
    setTimeout(() => setDownloadMessage(''), 3000);
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
          <button className="modal-action-btn" onClick={downloadAlbum}>
            <i className="fas fa-download"></i>
          </button>
        </div>

        {downloadMessage && <div className="share-message">{downloadMessage}</div>}

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

  const downloadSong = async () => {
    // "Télécharger" ajoute le morceau à la bibliothèque du site (le fichier
    // audio reste sur le site) ET télécharge un PDF des paroles avec la
    // pochette de l'album, si le morceau a des paroles.
    addSongToLibrary(song);
    if (onDownload) onDownload(); // compté une seule fois par utilisateur (voir useSongStats)
    if (!hasLyrics(song)) {
      setDownloadMessage('Ajouté à votre bibliothèque !');
      setTimeout(() => setDownloadMessage(''), 2000);
      return;
    }
    setDownloadMessage('Préparation du PDF des paroles…');
    try {
      await downloadLyricsPdf({ songs: [song], album: { title: song.album, artist: song.artist, cover: song.cover } });
      setDownloadMessage('Ajouté à votre bibliothèque + PDF des paroles téléchargé !');
    } catch (e) {
      console.error(e);
      setDownloadMessage('Ajouté à votre bibliothèque (PDF des paroles indisponible).');
    }
    setTimeout(() => setDownloadMessage(''), 3000);
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

// Paroles écrites -> animées. Ancien fichier (txt/pdf/wps) -> affichage d'avant.
const LyricsViewer = ({ song, currentTime, duration, isPlaying, onSeek }) => (
  hasLyrics(song)
    ? <AnimatedLyrics song={song} currentTime={currentTime} duration={duration} isPlaying={isPlaying} onSeek={onSeek} />
    : <LegacyLyricsViewer song={song} />
);

// ========== COMPOSANT PRINCIPAL : UserMusique ==========
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

const UserMusique = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth(); // On suppose que le contexte fournit logout pour l'utilisateur
  const carouselRef = useRef(null);

  // Lecteur audio global (persiste même en changeant de page — voir PlayerContext.jsx)
  const {
    currentSong, isPlaying, currentTime, duration, playbackMode, setPlaybackMode,
    playSong: playSongGlobal, togglePlayPause, playNext, playPrevious,
    skipForward, skipBackward, seekTo
  } = usePlayer();

  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [userPseudo, setUserPseudo] = useState(localStorage.getItem('userPseudo') || 'Utilisateur');
  const [userPhoto, setUserPhoto] = useState(localStorage.getItem('userPhoto') || 'https://cdn-icons-png.flaticon.com/512/149/149071.png');
  // Header identique à celui de la page admin (même menu, même panneau profil)
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('albums');
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedSongForModal, setSelectedSongForModal] = useState(null);
  const [albumModalOpen, setAlbumModalOpen] = useState(false);
  const [selectedAlbumModal, setSelectedAlbumModal] = useState(null);

  // Bibliothèque personnelle (morceaux/albums "téléchargés" sur ce site)
  const [librarySongs, setLibrarySongs] = useState(() => getLibrarySongs());
  useEffect(() => {
    const refreshLibrary = () => setLibrarySongs(getLibrarySongs());
    window.addEventListener('library-updated', refreshLibrary);
    window.addEventListener('storage', refreshLibrary);
    return () => {
      window.removeEventListener('library-updated', refreshLibrary);
      window.removeEventListener('storage', refreshLibrary);
    };
  }, []);
  const handleRemoveFromLibrary = (e, songId) => {
    e.stopPropagation();
    removeSongFromLibrary(songId);
  };

  // ===== DONNÉES SUPABASE (lecture seule, alimentées par l'admin) =====
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

    if (!albumsErr && albumsRows && albumsRows.length > 0) {
      const mappedAlbums = albumsRows.map(a => ({
        id: a.id,
        title: a.title,
        artist: a.artist || 'ALP',
        year: a.year || '',
        cover: a.cover_url || defaultAlbumCover,
        description: a.description || '',
        songs: (songsRows || []).filter(s => s.album_id === a.id).map(s => s.id)
      }));
      setAlbums(mappedAlbums);

      if (!songsErr && songsRows) {
        const mappedSongs = songsRows.map(s => {
          const parentAlbum = albumsRows.find(a => a.id === s.album_id);
          return {
            id: s.id,
            title: s.title,
            artist: s.artist || 'ALP',
            album: parentAlbum ? parentAlbum.title : '',
            album_id: s.album_id,
            cover: parentAlbum?.cover_url || defaultAlbumCover,
            duration: s.duration || 0,
            src: s.audio_url || '',
            lyrics: s.lyrics_text || '', // paroles ÉCRITES (songs.lyrics_text). Anciens morceaux : repli sur le fichier lyrics_file_url. `description` = histoire du morceau.
            lyrics_file_url: s.lyrics_file_url,
            lyrics_file_name: s.lyrics_file_name,
            lyrics_file_type: s.lyrics_file_type,
            description: s.description || '',
            plays: s.plays || 0,
            likes: s.likes || 0
          };
        });
        setSongsList(mappedSongs);
      }
    }
  };

  useEffect(() => { fetchAlbumsAndSongs(); }, []);

  // Indicateur hors-ligne : le "central" (Supabase) n'est pas accessible
  // sans connexion, mais la bibliothèque personnelle (mise en cache via le
  // Service Worker) reste jouable.
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const goOnline = () => { setIsOffline(false); fetchAlbumsAndSongs(); };
    const goOffline = () => setIsOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

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

  // Joue un morceau en donnant au lecteur global la liste actuellement
  // affichée (album filtré, recherche...) pour que "suivant"/"précédent"
  // naviguent dedans.
  const playSong = (song) => {
    playSongGlobal(song, getFilteredSongs());
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
  const handleProgressClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    seekTo(pct * duration);
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
  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="admin-musique" style={{ backgroundImage: `url(${bgImage})` }}>
      {/* Header identique à celui de la page admin */}
      <header className="admin-header">
        <div className="header-left">
          <div className="menu-trigger" onClick={() => setMenuOpen(!menuOpen)}>
            <i className={`fas fa-${menuOpen ? 'times' : 'bars'}`}></i>
          </div>
          <div className="profile-header" onClick={() => setProfileSettingsOpen(!profileSettingsOpen)}>
            <img src={userPhoto} alt="User" />
            <span>{userPseudo}</span>
          </div>
        </div>
        <div className="welcome-msg"><span className="typing">ESPACE MUSIQUE YASSAL</span></div>
        {menuOpen && (
          <div className="side-menu">
            <div className="menu-item" onClick={() => { setProfileSettingsOpen(true); setMenuOpen(false); }}><i className="fas fa-user-circle"></i> Profil</div>
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

      {isOffline && (
        <div className="offline-banner">
          <i className="fas fa-wifi"></i> Hors ligne — le catalogue en direct n'est pas accessible, seule votre bibliothèque téléchargée fonctionne.
        </div>
      )}

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
              <button className="control-btn" onClick={playPrevious}><i className="fas fa-step-backward"></i></button>
              <button className="control-btn" onClick={skipBackward}><i className="fas fa-undo"></i></button>
              <button className="control-btn play-btn-large" onClick={togglePlayPause}><i className={`fas fa-${isPlaying ? 'pause' : 'play'}`}></i></button>
              <button className="control-btn" onClick={skipForward}><i className="fas fa-redo"></i></button>
              <button className="control-btn" onClick={playNext}><i className="fas fa-step-forward"></i></button>
            </div>
            <div className="playback-mode-control">
              <PlaybackModeButton mode={playbackMode} onChange={setPlaybackMode} />
            </div>
          </div>
          <div className="library-separator"></div>
          <div className="library">
            <h3><i className="fas fa-download"></i> Musiques téléchargées {librarySongs.length > 0 && `(${librarySongs.length})`}</h3>
            <div className="library-list">
              {librarySongs.length === 0 ? (
                <div className="empty-library">
                  <i className="fas fa-cloud-download-alt"></i>
                  <p>Aucune musique téléchargée<br/>Téléchargez un morceau ou un album</p>
                </div>
              ) : (
                librarySongs.map(song => (
                  <div
                    key={song.id}
                    className={`library-item ${currentSong?.id === song.id ? 'active' : ''}`}
                    onClick={() => playSong(song)}
                  >
                    <img src={song.cover} alt="" onError={(e) => e.target.src = defaultAlbumCover} />
                    <div className="library-item-info">
                      <div className="library-item-title">{song.title}</div>
                      <div className="library-item-artist">{song.artist}</div>
                    </div>
                    <button className="library-item-remove" onClick={(e) => handleRemoveFromLibrary(e, song.id)} title="Retirer de la bibliothèque">
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                ))
              )}
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
          <div className="section-header">
            <h2 className="section-title"><i className="fas fa-compact-disc"></i> Albums</h2>
            {/* Pas de bouton "Créer un album" pour l'utilisateur normal */}
          </div>
          <div className="albums-carousel">
            <i className="fas fa-chevron-left nav-arrow" onClick={() => scrollCarousel('left')}></i>
            <div className="albums-horizontal" ref={carouselRef}>
              {displayedAlbums.map(album => (
                <div key={album.id} className={`album-card-horizontal ${selectedAlbum === album.id ? 'active' : ''}`} onClick={() => handleAlbumClick(album)}>
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
              {/* Pas de bouton "Ajouter un morceau" pour l'utilisateur normal */}
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
                onSeek={seekTo}
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

      {/* ====== FOOTER AVEC 3 BOUTONS ====== */}
      <footer className="admin-footer">
        <div className="footer-nav" style={{ maxWidth: '300px', gap: '10vw' }}>
          <button className={`foot-icon ${location.pathname === '/user/musique' ? 'active' : ''}`} onClick={() => navigate('/user/musique')}>
            <i className="fas fa-headphones"></i>
          </button>
          <button className={`foot-icon ${location.pathname === '/user/home' ? 'active' : ''}`} onClick={() => navigate('/user/home')}>
            <i className="fas fa-home"></i>
          </button>
          <button className={`foot-icon ${location.pathname === '/user/vip' ? 'active' : ''}`} onClick={() => navigate('/user/vip')}>
            <i className="fas fa-crown"></i>
          </button>
        </div>
      </footer>
    </div>
  );
};

export default UserMusique;
