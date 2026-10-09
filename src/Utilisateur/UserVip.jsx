// src/User/UserVip.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import '../Admin/AdminVip.css';
import './UserVip.css';
import bgImage from '../assets/Images/men_your_brave.jpeg';
import { useAuth } from '../context/AuthContext';
import ProfileSettingsPanel from '../Admin/ProfileSettingsPanel';
import EmojiPicker from '../components/EmojiPicker';
import { uploadToR2, urlToR2, deleteFromR2 } from '../cloudflareClient';
import { canPublishStory, STORY_LIMIT_MSG, isStoryLimitError, invoiceExpired } from '../rules';
import { buildVoiceBubbleHtml } from '../utils/voiceBubble'; // Bulle vocale (capsule rouge)
import { cleanHtml } from '../utils/sanitizeHtml';           // Protection XSS des commentaires
import '../styles/responsive-vip.css';
import '../styles/messagerie-mobile-fix.css';      // ← ajouter
import useVipViewportOffsets from '../hooks/useVipViewportOffsets';   // ← ajouter
import {
  loadStories, saveStories, canSeeStory, subscribeShared,
  blobUrlToPersistentUrl, tierIconClass, tierEmoji,
} from '../utils/vipShared';
import VibeMusicPicker, { VibePlayer } from '../components/VibeMusicPicker';
import EventCommentSection from '../components/EventCommentSection';   // commentaires partagés (Supabase)
import {
  fetchEvents, createEventRow, buyStock, subscribeEvents,
  fetchEngagement, toggleFire, subscribeEngagement,
  isVisibleForClient, hiddenReason, purgeExpiredEvents,
} from '../services/vipEvents';
import { supabase } from '../supabaseClient';
import useFriends from '../hooks/useFriends';
import useDirectMessages from '../hooks/useDirectMessages';   // messagerie réelle (Supabase)
import useProfiles from '../hooks/useProfiles';
import { loadOrderWithItems, listMyOrders, subscribeOrders, STATUS_LABEL, submitTicketOrder, isOrderDone } from '../services/orders';
import PostCard from '../components/PostCard';
import useNotifications from '../hooks/useNotifications';
import NotificationsPanel, { NotificationToast, Badge } from '../components/NotificationsPanel';
import '../styles/responsive-vip.css';                         // responsive (doit rester le dernier import CSS)
import MyShop from '../components/MyShop';
import BuyModal from '../components/BuyModal';
import useCart from '../hooks/useCart';
import { downloadInvoice } from '../services/invoice';
import { saveStory, extractOverlays, listStories, subscribeStories, mapRowToStory, isStoryExpired, purgeExpiredStories } from '../services/stories';
import { startLive, stopLive } from '../services/liveInteractions';
import { isZoomUnavailable } from '../services/zoomLive';
import StoryPhoto from '../components/StoryPhoto';
import { StoryEngagementBar, EventEngagementBar, storyTimeLabel } from '../components/StoryEngagement';
import PublicationViewer from '../components/PublicationViewer';
import { updateStory, deleteStory } from '../services/storyManage';
import LivePanel from '../components/LivePanel';
import LiveStage from '../components/LiveStage';
import { publishInstagramStory, friendlyInstagramError, IG_STEP_LABELS } from '../services/instagramStory';
import { flattenPhotoStory } from '../services/storyFlatten';

const ADMIN_ID = 'ab096262-ff74-4faf-a671-6f4611e454d7';   // même id que romeo.sql

// (Commentaires : voir src/components/EventCommentSection.jsx)

// ---------- COMPOSANT PRINCIPAL ----------
const UserVip = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();

  // États généraux
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [userPseudo, setUserPseudo] = useState(localStorage.getItem('userPseudo') || 'KILO');
  const [userPhoto, setUserPhoto] = useState(localStorage.getItem('userPhoto') || 'https://cdn-icons-png.flaticon.com/512/149/149071.png');
  const [usersOnline, setUsersOnline] = useState(24);
  const [activeTab, setActiveTab] = useState('feed');
  const [selectedConvId, setSelectedConvId] = useState(null);
  const [convMenuOpen, setConvMenuOpen] = useState(null);
  const [globalSearch, setGlobalSearch] = useState('');

  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [commentTargetEvent, setCommentTargetEvent] = useState(null);

  const [cartModalOpen, setCartModalOpen] = useState(false);
  const [cartTargetEvent, setCartTargetEvent] = useState(null);
  const [cartQuantity, setCartQuantity] = useState(1);
  const [cartSelectedTier, setCartSelectedTier] = useState(null);

  const [purchasedTickets, setPurchasedTickets] = useState(() => {
    const saved = localStorage.getItem('purchasedTickets');
    return saved ? JSON.parse(saved) : [];
  });
  const [eventsModalOpen, setEventsModalOpen] = useState(false);

  const [messageText, setMessageText] = useState('');
  // Vendeur : toutes les commandes (temps réel) + fenêtre « Commandes / Billets validés » d'un événement
  const [allOrders, setAllOrders] = useState([]);
  const [ordersView, setOrdersView] = useState('valides');   // onglet Événements : 'valides' | 'commandes'
  const [ordersModal, setOrdersModal] = useState(null);   // { evt, mode: 'commandes' | 'valides' }
  const [myView, setMyView] = useState('billets');          // onglet Événements côté client : 'billets' | 'panier'
  const msgInputRef = useRef(null);
  const isInsertingEmoji = useRef(false);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingBlob, setRecordingBlob] = useState(null);
  const [recordingUrl, setRecordingUrl] = useState(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isRecordingPreview, setIsRecordingPreview] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const audioStreamRef = useRef(null);

  // Stories partagées avec la page User (une story privée n'est visible que par son auteur)
  const [allStories, setStories] = useState(loadStories);
  const stories = allStories.filter(s => (s.remote ? !(s.type === 'live' && s.liveStatus === 'ended') : canSeeStory(s, userPseudo)) && !isStoryExpired(s));
  const [currentViewIndex, setCurrentViewIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerPanel, setViewerPanel] = useState(null); // null | 'reactions' | 'comments'
  const [storyMenuOpen, setStoryMenuOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [editStory, setEditStory] = useState(null);    // { id, title, desc, privacy } pendant la modification
  useEffect(() => { setViewerPanel(null); setEditStory(null); setStoryMenuOpen(false); setDescOpen(false); }, [currentViewIndex, viewerOpen]);
  const [isHostLive, setIsHostLive] = useState(false);

  const [creationMode, setCreationMode] = useState('');
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [musicPageOpen, setMusicPageOpen] = useState(false);
  const [liveConfigOpen, setLiveConfigOpen] = useState(false);
  const [textModalOpen, setTextModalOpen] = useState(false);
  const [emojiModalOpen, setEmojiModalOpen] = useState(false);
  const [reactionTargetMsgId, setReactionTargetMsgId] = useState(null);
  const [contextMenuMsgId, setContextMenuMsgId] = useState(null);
  const [isEmojiPickerForMessage, setIsEmojiPickerForMessage] = useState(false);

  const audioRefs = useRef({});

  const [currentMediaUrl, setCurrentMediaUrl] = useState(null);
  const [storyTitle, setStoryTitle] = useState('');
  const [storyDesc, setStoryDesc] = useState('');
  const [storyPrivacy, setStoryPrivacy] = useState('public');
  const [vibeStart, setVibeStart] = useState(0);
  const [vibeLength, setVibeLength] = useState(40);   // durée du passage choisi (≤ 40 s)
  const [vibeMusic, setVibeMusic] = useState(null);   // morceau choisi dans la page Musique
  const vibeAudioRef = useRef(null);                  // musique jouée pendant l'enregistrement
  const [livePrivacy, setLivePrivacy] = useState('public');

  const [reactions, setReactions] = useState({});
  const [replyingTo, setReplyingTo] = useState(null);
  const [forwardMsg, setForwardMsg] = useState(null);
  const [hiddenMsgs, setHiddenMsgs] = useState({});
  const [currentMediaType, setCurrentMediaType] = useState('photo');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraRecording, setCameraRecording] = useState(false);
  const [hostStream, setHostStream] = useState(null);
  const attachInputRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const recordingTimeRef = useRef(0);

  const setSelectedConv = (conv) => {
    setSelectedConvId(conv ? conv.id : null);
    setReplyingTo(null);
    setContextMenuMsgId(null);
    setMessageText('');
  };

  // Historique des messages par ami : { [idAmi]: { messages: [...], lastMsg: '' } }
  // (les messages viennent maintenant de Supabase : voir useDirectMessages plus bas)

  // Événements (posts)
  // Publications partagées avec la page User
  const [events, setEvents] = useState([]);                       // publications : Supabase (stock, date…)
  const [engagement, setEngagement] = useState({ fire: {}, mine: {}, comments: {} });   // 🔥 + nb de commentaires

  const [myId, setMyId] = useState(null);
  const [liveSession, setLiveSession] = useState(null);
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => { if (alive) setMyId(data?.user?.id || null); });
    return () => { alive = false; };
  }, []);

  // Étape 1 : profil (pseudo + photo) lu dans la base et mis à jour en temps réel
  const { profileOf } = useProfiles(myId ? [myId] : []);
  const myProfile = myId ? profileOf(myId) : null;
  useEffect(() => {
    if (myProfile?.pseudo && myProfile.pseudo !== 'Membre') setUserPseudo(myProfile.pseudo);
    if (myProfile?.avatar_url) setUserPhoto(myProfile.avatar_url);
  }, [myProfile?.pseudo, myProfile?.avatar_url]);

  // Étape 2 : amis réels (pending / accepted)
  const { members: friends, request: requestFriend, accept: acceptFriend, remove: removeRelationFor } = useFriends(myId);
  const dm = useDirectMessages(myId, (id) => (friends.find(f => f.id === id) || {}).name || 'Contact');
  const threads = dm.threads;   // { [idAmi]: { messages, lastMsg } }
  const renderFriendAction = (friend) => {
    switch (friend.status) {
      case 'friend':   return <button className="add-friend-btn" style={{ background: '#555' }} onClick={() => removeFriend(friend.id)}>Retirer</button>;
      case 'sent':     return <button className="add-friend-btn" style={{ background: '#777' }} onClick={() => removeFriend(friend.id)}>Demande envoyée · Annuler</button>;
      case 'received': return (<>
          <button className="add-friend-btn" onClick={() => addFriend(friend.id)}>Accepter</button>
          <button className="add-friend-btn" style={{ background: '#555' }} onClick={() => removeFriend(friend.id)}>Refuser</button>
        </>);
      default:         return <button className="add-friend-btn" onClick={() => addFriend(friend.id)}>Ajouter</button>;
    }
  };

  // Étape 6 : statut + facture PDF sous chaque billet acheté
  const renderTicketExtras = (ticket) => !ticket.orderId ? null : (
    <>
      <span style={{ color: isOrderDone(ticket) ? '#00C851' : '#ffbb33' }}>{STATUS_LABEL[ticket.status || 'en_attente']}</span>
      {invoiceExpired({ status: ticket.status, delivered_at: ticket.deliveredAt })
        ? <span style={{ color: '#888', fontSize: 12 }}>Facture expirée</span>
        : <button className="add-friend-btn" onClick={async () => {
            try {
              const order = await loadOrderWithItems(ticket.orderId);
              if (invoiceExpired(order)) { alert('Facture expirée : elle n\'est disponible que 24 h après la livraison.'); return; }
              await downloadInvoice(order);
            } catch (e) { alert(`Facture indisponible : ${e.message}`); }
          }}>Facture PDF</button>}
    </>
  );

  // Notifications réelles (Supabase, temps réel) — voir sql/4_notifications.sql
  const notif = useNotifications(myId);
  const goFromNotif = (tab) => { setActiveTab(tab); setSelectedConv(null); };

  // Vendeur : commandes qui contiennent cet événement (les lignes sont filtrées sur l'événement)
  const ordersOfEvent = (eventId) => allOrders
    .map(o => ({ ...o, items: (o.items || []).filter(i => String(i.event_id) === String(eventId)) }))
    .filter(o => o.items.length > 0);

  // Messages : seulement les personnes ajoutées (relation « accepted »)
  const DEFAULT_AVATAR = 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
  const conversations = friends
    .filter(f => f.status === 'friend')
    .map(f => {
      const t = threads[f.id] || { messages: [], lastMsg: '' };
      return { id: f.id, name: f.name, avatar: f.avatar || DEFAULT_AVATAR, messages: t.messages, lastMsg: t.lastMsg };
    });
  // La conversation ouverte est toujours lue depuis la liste ; si l'ami est retiré, elle disparaît
  const selectedConv = conversations.find(c => c.id === selectedConvId) || null;
  // Ouvrir une conversation = marquer ses messages reçus comme lus
  useEffect(() => { if (selectedConvId) dm.markRead(selectedConvId); }, [selectedConvId, selectedConv ? selectedConv.messages.length : 0]);

  // Filtrer les conversations, amis, notifications selon la recherche globale
  const filteredConversations = conversations.filter(conv =>
    conv.name.toLowerCase().includes(globalSearch.toLowerCase()) ||
    conv.lastMsg.toLowerCase().includes(globalSearch.toLowerCase())
  );

  const filteredFriends = friends.filter(f =>
    f.name.toLowerCase().includes(globalSearch.toLowerCase())
  );


  // Client : on masque les articles en rupture de stock et les billets dont la date est passée
  const clientEvents = events.filter(isVisibleForClient);
  const filteredEvents = clientEvents.filter(e =>
    (e.title || '').toLowerCase().includes(globalSearch.toLowerCase()) ||
    (e.desc || '').toLowerCase().includes(globalSearch.toLowerCase())
  );

  // ---- Fonctions de gestion des amis ----
  const addFriend = (id) => {
    const m = friends.find((f) => f.id === id);
    if (!m) return;
    if (m.status === 'received') acceptFriend(m);
    else if (m.status === 'none') requestFriend(id);
  };
  const removeFriend = (id) => {
    const m = friends.find((f) => f.id === id);
    if (m) removeRelationFor(m);       // retirer un ami, annuler ma demande ou refuser une demande reçue
  };

  // ---- Panier / achat de billets (protocole de vente) ----
  const cart = useCart(myId);
  const openCart = (evt) => { setCartTargetEvent(evt); setCartModalOpen(true); };
  const addToCart = (evt, qty) => { cart.add(evt, qty); setMyView('panier'); };    // article → Panier (on peut en ajouter d'autres)
  const sendTicketRequest = async ({ evt, tier, qty }, form) => {
    await submitTicketOrder({ eventId: evt.id, tierId: tier.id, quantity: qty }, form);   // → « Billets à valider » côté admin
    setCartModalOpen(false); setMyView('billets'); setActiveTab('events');
    alert('Demande envoyée à l\'administrateur. Votre billet apparaîtra ici dès qu\'il sera validé.');
  };


  const formatPrice = (price) => `${(Number(price) || 0).toLocaleString('fr-FR')} Ar`;

  const toggleFireOn = async (evt) => {
    if (!myId) return alert('Connectez-vous pour réagir.');
    try { await toggleFire(evt.id, myId, !!engagement.mine[evt.id]); await reloadEngagement(); }
    catch (e) { alert('Action impossible : ' + e.message); }
  };
  const openComments = (evt) => { setCommentTargetEvent(evt); setCommentModalOpen(true); };   // ouvre la publication (même rendu que les stories)
  const reactionButtons = (evt) => (
    <>
      <button className="event-action-btn" onClick={() => toggleFireOn(evt)} title="J'aime">
        <i className="fas fa-fire" style={engagement.mine[evt.id] ? { color: '#E22134' } : undefined}></i> <span className="count">{engagement.fire[evt.id] || 0}</span>
      </button>
      <button className="event-action-btn" onClick={() => openComments(evt)} title="Commentaires">
        <i className="fas fa-comment"></i> <span className="count">{engagement.comments[evt.id] || 0}</span>
      </button>
    </>
  );

  // ---- Fonctions pour les stories ----
  const showCreationMenu = () => {
    setCreationMode('');
    document.getElementById('creationMenuModal').style.display = 'flex';
  };

  const hideModals = () => {
    if (document.getElementById('creationMenuModal'))
      document.getElementById('creationMenuModal').style.display = 'none';
    setSourceMenuOpen(false);
    setCameraOpen(false);
    setEditorOpen(false);
    setMusicPageOpen(false);
    setLiveConfigOpen(false);
    setTextModalOpen(false);
    setEmojiModalOpen(false);
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
  };

  // Règle : 1 story (image / vidéo / vibe) toutes les 48 h — le live n'est pas concerné
  const guardStory = async (next) => {
    const r = await canPublishStory(supabase, myId);
    if (!r.ok) {
      hideModals();
      alert(`${STORY_LIMIT_MSG}\nProchaine story possible le ${r.nextAt.toLocaleString('fr-FR')}.`);
      return;
    }
    next();
  };

  const chooseSource = (mode) => {
    setCreationMode(mode);
    hideModals();
    setSourceMenuOpen(true);
  };

  const triggerFileInput = () => { document.getElementById('fileInputVIP').click(); };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCurrentMediaUrl(URL.createObjectURL(file));
    setCurrentMediaType(file.type.startsWith('video/') ? 'video' : 'photo');
    setSourceMenuOpen(false);
    e.target.value = '';
    openEditor();
  };

  const openCamera = async (len) => {
    setSourceMenuOpen(false);
    setCameraOpen(true);
    setCameraReady(false);
    setVibeDurationLeft(typeof len === 'number' ? len : 40);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: creationMode !== 'vibe' });
      mediaStreamRef.current = stream;
      setCameraReady(true); // un effet branche le flux sur la <video> une fois affichée
    } catch (err) {
      alert("Erreur d'accès à la caméra");
      setCameraOpen(false);
    }
  };

  const captureMedia = () => {
    const video = videoRef.current;
    if (!video) return;
    if (creationMode === 'photo') {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      setCurrentMediaUrl(canvas.toDataURL('image/jpeg'));
      setCurrentMediaType('photo');
      closeCamera();
      openEditor();
    } else if (creationMode === 'video' || creationMode === 'vibe') {
      if (!isRecordingRef.current) startRecording2();
      else stopRecording2();
    }
  };

  const startRecording2 = () => {
    if (!mediaStreamRef.current) return;
    isRecordingRef.current = true;
    setCameraRecording(true);
    recordedChunksRef.current = [];
    const mediaRecorder = new MediaRecorder(mediaStreamRef.current);
    mediaRecorderRef2.current = mediaRecorder;
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: mediaRecorder.mimeType || 'video/webm' });
      setCurrentMediaUrl(URL.createObjectURL(blob));
      setCurrentMediaType('video');
      closeCamera();
      openEditor();
    };
    mediaRecorder.start();
    if (creationMode === 'vibe') {
      // la musique démarre au début du passage choisi, en même temps que la vidéo
      const music = vibeAudioRef.current;
      if (music) { music.currentTime = vibeStart; music.play().catch(() => {}); }
      let remaining = vibeLength; setVibeDurationLeft(vibeLength);
      vibeTimerRef.current = setInterval(() => {
        remaining -= 1;
        setVibeDurationLeft(remaining);
        if (remaining <= 0) stopRecording2();
      }, 1000);
    }
  };

  const stopRecording2 = () => {
    if (vibeAudioRef.current) vibeAudioRef.current.pause();
    if (vibeTimerRef.current) { clearInterval(vibeTimerRef.current); vibeTimerRef.current = null; }
    const rec = mediaRecorderRef2.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    isRecordingRef.current = false;
    setCameraRecording(false);
  };

  const closeCamera = () => {
    if (vibeAudioRef.current) { vibeAudioRef.current.pause(); vibeAudioRef.current = null; }
    if (vibeTimerRef.current) { clearInterval(vibeTimerRef.current); vibeTimerRef.current = null; }
    const rec = mediaRecorderRef2.current;
    if (rec) {
      rec.onstop = null; // annuler ≠ ouvrir l'éditeur
      if (rec.state !== 'inactive') rec.stop();
    }
    isRecordingRef.current = false;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    setCameraRecording(false);
    setCameraReady(false);
    setCameraOpen(false);
  };

  const openEditor = () => setEditorOpen(true);

  const closeEditor = () => {
    setVibeMusic(null);
    setEditorOpen(false);
    setCurrentMediaUrl(null);
    setStoryTitle('');
    setStoryDesc('');
    setStoryPrivacy('public');
  };

  const startVibeFlow = () => {
    setCreationMode('vibe');
    hideModals();
    setMusicPageOpen(true);
  };

  const confirmVibeMusic = ({ song, start, length }) => {
    setVibeMusic(song); setVibeStart(start); setVibeLength(length);
    // musique préchargée, calée sur le début du passage : prête pour l'enregistrement
    const a = new Audio(song.src);
    a.preload = 'auto';
    a.addEventListener('loadedmetadata', () => { a.currentTime = start; });
    vibeAudioRef.current = a;
    setMusicPageOpen(false);
    openCamera(length);
  };

  const startLiveFlow = () => {
    setCreationMode('live');
    hideModals();
    setLiveConfigOpen(true);
  };

  const launchLive = async () => {
    // Vrai live : réunion Zoom créée côté serveur + story « live » enregistrée (zoom_session_id)
    let remote = null;
    if (myId) {
      try { remote = await startLive({ userId: myId, title: 'Live en cours', privacy: livePrivacy }); }
      catch (err) { if (!isZoomUnavailable(err)) alert(`Live Zoom impossible : ${err.message}`); }
    }
    const newStory = remote
      ? { ...mapRowToStory({ ...remote.story, author: { username: userPseudo, photo_url: userPhoto } }, ADMIN_ID), desc: 'En direct maintenant' }
      : { id: Date.now(), type: 'live', user: userPseudo, title: 'Live en cours', privacy: livePrivacy,
          desc: 'En direct maintenant', previewHtml: '', role: 'admin', avatar: userPhoto, createdAt: Date.now() };
    const idx = stories.length;
    setLiveSession(remote ? remote.session : null);
    setStories(prev => [...prev, newStory]);
    setLiveConfigOpen(false);
    setCurrentViewIndex(idx);
    setIsHostLive(true);
    setViewerOpen(true);
    if (!remote) {            // secours : Zoom non configuré → caméra locale
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setHostStream(stream);
      } catch (err) { alert("Impossible d'accéder à la caméra pour le direct."); }
    }
  };

  const addTextToPreview = () => {
    const text = document.getElementById('vipTextInput').value;
    if (!text) return;
    const div = document.createElement('div');
    div.className = 'draggable-element';
    div.style.left = '50px';
    div.style.top = '50px';
    div.style.color = document.getElementById('textColor').value;
    div.style.backgroundColor = document.getElementById('textBg').value;
    div.style.fontFamily = document.getElementById('textFont').value;
    div.style.fontSize = '24px';
    div.style.padding = '5px';
    const span = document.createElement('span');
    span.innerText = text;
    div.appendChild(span);
    if (previewContainerRef.current) previewContainerRef.current.appendChild(div);
    makeInteractive(div);
    setTextModalOpen(false);
  };

  const addEmojiToPreview = (emoji) => {
    const div = document.createElement('div');
    div.className = 'draggable-element';
    div.style.left = '50px';
    div.style.top = '100px';
    div.style.fontSize = '50px';
    div.style.width = '60px';
    div.style.height = '60px';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';
    const span = document.createElement('span');
    span.innerText = emoji;
    div.appendChild(span);
    if (previewContainerRef.current) previewContainerRef.current.appendChild(div);
    makeInteractive(div);
    setEmojiModalOpen(false);
  };

  const makeInteractive = (el) => {
    let dragState = { isDragging: false, startX: 0, startY: 0, initLeft: 0, initTop: 0 };
    const onMouseDown = (e) => {
      if (e.target.classList.contains('resize-handle') || e.target.classList.contains('rotate-handle') || e.target.classList.contains('delete-btn')) return;
      dragState.isDragging = true;
      dragState.startX = e.clientX;
      dragState.startY = e.clientY;
      dragState.initLeft = el.offsetLeft;
      dragState.initTop = el.offsetTop;
    };
    const onMouseMove = (e) => {
      if (!dragState.isDragging) return;
      el.style.left = (dragState.initLeft + e.clientX - dragState.startX) + 'px';
      el.style.top = (dragState.initTop + e.clientY - dragState.startY) + 'px';
    };
    const onMouseUp = () => { dragState.isDragging = false; };
    el.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    const del = document.createElement('div');
    del.className = 'delete-btn';
    del.innerHTML = 'X';
    del.onclick = () => el.remove();
    const resize = document.createElement('div');
    resize.className = 'resize-handle';
    const rotate = document.createElement('div');
    rotate.className = 'rotate-handle';
    el.appendChild(del);
    el.appendChild(resize);
    el.appendChild(rotate);
    let isResizing = false;
    let startResX, initW, initH, initFontSize;
    resize.addEventListener('mousedown', (e) => {
      isResizing = true;
      e.stopPropagation();
      startResX = e.clientX;
      initW = el.offsetWidth;
      initH = el.offsetHeight;
      initFontSize = parseFloat(window.getComputedStyle(el).fontSize);
    });
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const diff = e.clientX - startResX;
      const scale = (initW + diff) / initW;
      el.style.width = (initW + diff) + 'px';
      el.style.height = (initH * scale) + 'px';
      el.style.fontSize = (initFontSize * scale) + 'px';
    });
    document.addEventListener('mouseup', () => { isResizing = false; });
    let isRotating = false;
    let currentRot = 0;
    rotate.addEventListener('mousedown', (e) => {
      isRotating = true;
      e.stopPropagation();
    });
    document.addEventListener('mousemove', (e) => {
      if (!isRotating) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
      currentRot = angle + 90;
      el.style.transform = `rotate(${currentRot}deg)`;
    });
    document.addEventListener('mouseup', () => { isRotating = false; });
  };

  const publishStory = async () => {
    document.querySelectorAll('.delete-btn, .resize-handle, .rotate-handle').forEach(btn => btn.style.display = 'none');
    const previewEl = previewContainerRef.current;
    const kind = currentMediaType;                                  // 'photo' | 'video'
    const storyType = creationMode === 'vibe' ? 'vibe' : kind;
    const music = (creationMode === 'vibe' && vibeMusic)
      ? { songId: vibeMusic.id, title: vibeMusic.title, artist: vibeMusic.artist, cover: vibeMusic.cover,
          src: vibeMusic.src, start: vibeStart, length: vibeLength }
      : null;
    const overlays = kind === 'photo' ? extractOverlays(previewEl) : [];   // textes + émojis

    // Admin : fichier à envoyer à Instagram (jamais pour une story non publique, ni pour un vibe)
    let igFile = null;
    const igKind = (kind === 'photo' || kind === 'video') && storyType !== 'vibe' && storyPrivacy === 'public' ? kind : null;
    if (igKind) {
      try { igFile = igKind === 'photo' ? await flattenPhotoStory(previewEl) : await (await fetch(currentMediaUrl)).blob(); }
      catch (err) { console.warn('Préparation Instagram impossible', err); }
    }

    // 1) fichier brut (blob:/data:) → Cloudflare R2 → URL web publique
    let publicUrl = null;
    try { if (currentMediaUrl) publicUrl = await urlToR2(currentMediaUrl, 'stories'); }
    catch (err) { console.warn('Cloudflare R2 indisponible', err); }

    // 2) URL publique + personnalisation → table `stories`
    let saved = null;
    let storyLimited = false;
    if (publicUrl && myId) {
      try {
        saved = await saveStory({ userId: myId, type: storyType, mediaUrl: publicUrl, title: storyTitle || 'Sans titre',
          description: storyDesc, privacy: storyPrivacy, overlays, music });
      } catch (err) {
        console.warn('Enregistrement de la story impossible', err);
        if (isStoryLimitError(err)) { storyLimited = true; deleteFromR2(publicUrl); }   // règle 1 story / 48 h (trigger SQL)
      }
    }

    if (storyLimited) { alert(STORY_LIMIT_MSG); closeEditor(); return; }

    if (saved) {
      const mapped = mapRowToStory({ ...saved, author: { username: userPseudo, photo_url: userPhoto } }, ADMIN_ID);
      setStories(prev => (prev.some(s => s.id === saved.id) ? prev : [...prev, mapped]));
    } else {
      // Secours (hors ligne / Cloudinary non configuré) : ancien comportement local
      let previewHtml = previewEl?.innerHTML || '';
      let url = currentMediaUrl;
      try {
        if (url && url.startsWith('blob:')) {
          const persistent = await blobUrlToPersistentUrl(url, kind);
          if (kind === 'photo') previewHtml = previewHtml.split(url).join(persistent);
          url = persistent;
        }
      } catch (err) { console.warn('Conversion du média impossible', err); }
      if (kind !== 'photo') previewHtml = '';
      setStories(prev => [...prev, {
        id: Date.now(), type: storyType, url: kind === 'photo' ? null : url, title: storyTitle || 'Sans titre',
        desc: storyDesc, privacy: storyPrivacy, user: userPseudo, role: 'admin', avatar: userPhoto,
        createdAt: Date.now(), previewHtml, music
      }]);
      alert("Story enregistrée localement seulement (Cloudflare R2 ou la base ne répond pas).");
    }
    closeEditor();
    if (saved) alert("Story publiée !");

    if (igFile) {
      publishInstagramStory({ kind: igKind, file: igFile, onStep: (s) => console.info(IG_STEP_LABELS[s]) })
        .then(() => alert(IG_STEP_LABELS.done))
        .catch((err) => alert(friendlyInstagramError(err)));
    }
  };

  const openViewer = (index, isHost = false) => {
    if (index < 0 || index >= stories.length) return;
    setCurrentViewIndex(index);
    setIsHostLive(isHost);
    setViewerOpen(true);
  };

  const closeViewer = () => {
    setViewerOpen(false);
    if (hostStream) {
      hostStream.getTracks().forEach(t => t.stop());
      setHostStream(null);
    }
  };

  const navigateStory = (dir) => {
    const newIndex = currentViewIndex + dir;
    if (newIndex >= 0 && newIndex < stories.length) openViewer(newIndex, false);
  };

  const togglePlayPause = () => {
    const vid = document.getElementById('viewerVideo');
    if (vid) {
      if (vid.paused) {
        vid.play();
        document.getElementById('viewerPlayPause').innerHTML = '<i class="fas fa-pause"></i>';
      } else {
        vid.pause();
        document.getElementById('viewerPlayPause').innerHTML = '<i class="fas fa-play"></i>';
      }
    } else {
      alert("Lecture/Pause de la musique du Vibe");
    }
  };

  const endLive = () => {
    const cur = stories[currentViewIndex];
    if (cur && cur.remote) {
      // Règle : un live terminé est supprimé immédiatement (plus de story « terminée » qui traîne)
      stopLive({ id: cur.id, zoom_session_id: cur.zoomSessionId }).catch(() => {})
        .finally(() => supabase.from('stories').delete().eq('id', cur.id)
          .then(({ error }) => { if (error) console.warn('Suppression du live impossible', error); }));
      setStories(prev => prev.filter(st => st.id !== cur.id));
    } else {
      const liveId = cur && cur.id;
      setStories(prev => prev.map(st => st.id === liveId ? { ...st, title: st.title + " (Terminé)" } : st));
    }
    setLiveSession(null);
    closeViewer();
  };

  // Story publiée = carte verticale : média en fond, avatar rond en haut à gauche, nom en bas à gauche
  const renderStories = () => {
    return stories.map((story, idx) => {
      // Média de fond : photo (avec ses textes/émojis), vidéo (1re image), sinon un fond coloré + icône
      const localImg = story.previewHtml ? (/<img[^>]+src="([^"]+)"/i.exec(story.previewHtml) || [])[1] : null;
      let bg;
      if (story.type === 'photo' && story.url) bg = <StoryPhoto url={story.url} overlays={story.overlays || []} />;
      else if (story.type === 'photo' && localImg) bg = <img src={localImg} alt="" />;
      else if (story.type === 'video' && story.url) bg = <video src={`${story.url}#t=0.1`} muted playsInline preload="metadata" />;
      else bg = (
        <div className={`story-card-fallback ${story.type}`}>
          <i className={`fas ${story.type === 'live' ? 'fa-broadcast-tower' : story.type === 'vibe' ? 'fa-music' : story.type === 'video' ? 'fa-video' : 'fa-image'}`}></i>
        </div>
      );
      return (
        <div key={story.id} className="story-card" onClick={() => openViewer(idx)} role="button" tabIndex={0} title={story.title}>
          <div className="story-card-bg">{bg}</div>
          {story.type === 'live' && <span className="story-card-live">EN DIRECT</span>}
          <img className="story-card-avatar" src={story.avatar || DEFAULT_AVATAR} alt="" />
          <span className="story-card-name">{story.user || story.title}</span>
        </div>
      );
    });
  };

  // ---- Fonctions pour les conversations ----
  const deleteConversation = (convId) => {
    dm.clear(convId);   // masque l'historique chez moi, l'ami reste dans la liste
    if (selectedConv && selectedConv.id === convId) {
      setSelectedConv(null);
    }
    setConvMenuOpen(null);
  };

  const muteConversation = (convId) => {
    alert(`Conversation ${convId} masquée (fonctionnalité à implémenter)`);
    setConvMenuOpen(null);
  };

  const markAsRead = (convId) => {
    alert(`Conversation ${convId} marquée comme lue (fonctionnalité à implémenter)`);
    setConvMenuOpen(null);
  };

  // ---- Fonctions pour les messages (conversations) ----
  const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const newMsgId = () => `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const previewOf = (msg) => {
    if (msg.text && msg.text.trim()) return msg.text;
    if (msg.attachment) {
      if (msg.attachment.type === 'audio') return '🎤 Message vocal';
      if (msg.attachment.type === 'image') return '📷 Photo';
      return '📎 Fichier';
    }
    return '';
  };

  // Envoie réellement le message (Supabase) : le destinataire le reçoit en temps réel
  const pushMessage = async (convId, msg) => {
    try {
      await dm.send(convId, {
        text: msg.text || '', attachment: msg.attachment || null,
        replyTo: msg.replyTo || null, forwarded: !!msg.forwarded,
      });
      return true;
    } catch (err) {
      alert('Message non envoyé : ' + (err.message || err));
      return false;
    }
  };

  const buildReplyRef = () => (replyingTo ? { sender_id: replyingTo.sender === 'me' ? myId : replyingTo.sender, text: replyingTo.text } : null);

  // Envoi d'un message texte (bouton + touche Entrée)
  const sendTextMessage = () => {
    if (!selectedConv) return;
    const text = messageText.trim();
    if (!text) return;
    pushMessage(selectedConv.id, {
      id: newMsgId(), sender: 'me', text, time: nowTime(), attachment: null, replyTo: buildReplyRef()
    });
    setMessageText('');
    setReplyingTo(null);
  };

  // Envoi d'un fichier / image / audio choisi depuis le dossier
  const handleAttachFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !selectedConv) return;
    const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'file';
    let url;
    try {
      // Le fichier doit être hébergé pour que le destinataire puisse le voir (un blob: n'existe que chez moi)
      url = (await uploadToR2(file, type === 'audio' ? 'voice' : 'chat')).url;
    } catch (err) {
      alert("Échec de l'envoi du fichier : " + (err.message || err));
      return;
    }
    const ok = await pushMessage(selectedConv.id, {
      text: messageText.trim(),
      attachment: { type, url, name: file.name },
      replyTo: buildReplyRef()
    });
    if (ok) { setMessageText(''); setReplyingTo(null); }
  };

  const toggleReaction = (msgId, emoji) => {
    setReactions(prev => {
      const current = prev[msgId] || {};
      const count = current[emoji] || 0;
      if (count > 0) {
        const newCurrent = { ...current };
        if (newCurrent[emoji] === 1) delete newCurrent[emoji];
        else newCurrent[emoji] = count - 1;
        if (Object.keys(newCurrent).length === 0) {
          const newReactions = { ...prev };
          delete newReactions[msgId];
          return newReactions;
        }
        return { ...prev, [msgId]: newCurrent };
      }
      return { ...prev, [msgId]: { ...current, [emoji]: count + 1 } };
    });
  };

  const openReactionPicker = (msgId) => {
    setReactionTargetMsgId(msgId);
    setIsEmojiPickerForMessage(false);
    setEmojiModalOpen(true);
  };

  const handleReactionEmojiSelect = (emoji) => {
    if (reactionTargetMsgId) {
      toggleReaction(reactionTargetMsgId, emoji);
      setReactionTargetMsgId(null);
      setEmojiModalOpen(false);
    }
  };

  const openEmojiPickerForMessage = () => {
    setIsEmojiPickerForMessage(true);
    setEmojiModalOpen(true);
  };

  const insertEmojiIntoMessage = (emoji) => {
    if (isInsertingEmoji.current) return;
    isInsertingEmoji.current = true;
    const input = msgInputRef.current;
    const start = input && input.selectionStart != null ? input.selectionStart : messageText.length;
    const end = input && input.selectionEnd != null ? input.selectionEnd : messageText.length;
    setMessageText(messageText.substring(0, start) + emoji + messageText.substring(end));
    setTimeout(() => {
      if (input) {
        input.selectionStart = input.selectionEnd = start + emoji.length;
        input.focus();
      }
    }, 10);
    setEmojiModalOpen(false);
    setIsEmojiPickerForMessage(false);
    setTimeout(() => { isInsertingEmoji.current = false; }, 150);
  };

  // ---- Enregistrement vocal pour les messages ----
  const clearRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      recordingTimeRef.current = 0;
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setRecordingBlob(blob);
        setRecordingUrl(URL.createObjectURL(blob));
        setRecordingDuration(recordingTimeRef.current);
        setIsRecording(false);
        setIsRecordingPreview(true);
        setRecordingTime(0);
        clearRecordingTimer();
        if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach(track => track.stop());
          audioStreamRef.current = null;
        }
      };
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        recordingTimeRef.current += 1;
        setRecordingTime(recordingTimeRef.current);
        if (recordingTimeRef.current >= 60) stopRecording(); // limite 60 s
      }, 1000);
    } catch (err) {
      alert("Impossible d'accéder au microphone. Vérifiez les permissions.");
    }
  };

  const stopRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop();
    } else {
      setIsRecording(false);
      setRecordingTime(0);
      clearRecordingTimer();
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
        audioStreamRef.current = null;
      }
    }
  };

  const sendAudioMessage = async () => {
    if (!recordingBlob || !selectedConv) return;
    let url;
    try {
      const file = new File([recordingBlob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
      url = (await uploadToR2(file, 'voice')).url;
    } catch (err) {
      alert("Échec de l'envoi du message vocal : " + err.message);
      return;
    }
    pushMessage(selectedConv.id, {
      id: newMsgId(), sender: 'me', text: '', time: nowTime(),
      attachment: { type: 'audio', url, duration: recordingDuration },
      replyTo: buildReplyRef()
    });
    setReplyingTo(null);
    setIsRecordingPreview(false);
    setRecordingBlob(null);
    setRecordingUrl(null);
    setRecordingDuration(0);
  };

  const cancelRecordingPreview = () => {
    setIsRecordingPreview(false);
    setRecordingBlob(null);
    setRecordingUrl(null);
    setRecordingDuration(0);
  };

  const handleContextMenu = (msgId) => {
    setContextMenuMsgId(contextMenuMsgId === msgId ? null : msgId);
  };

  // Suppression immuable (l'ancienne version modifiait l'état directement)
  const handleDelete = async (msgId, convId) => {
    setContextMenuMsgId(null);
    const t = threads[convId];
    const m = t && t.messages.find(x => x.id === msgId);
    if (m && m.sender !== 'me') { handleHide(msgId); return; }   // message reçu : on le masque seulement chez moi
    try { await dm.remove(msgId); }
    catch (err) { alert('Suppression impossible : ' + (err.message || err)); }
  };

  const handleHide = (msgId) => {
    setHiddenMsgs(prev => ({ ...prev, [msgId]: true }));
    setContextMenuMsgId(null);
  };

  const handleDownload = (msg) => {
    if (msg.attachment && msg.attachment.url) {
      const a = document.createElement('a');
      a.href = msg.attachment.url;
      a.download = msg.attachment.name || 'fichier';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setContextMenuMsgId(null);
  };

  const startReply = (msg) => {
    setReplyingTo({ id: msg.id, sender: msg.sender, text: previewOf(msg) });
    setContextMenuMsgId(null);
    if (msgInputRef.current) msgInputRef.current.focus();
  };

  const forwardTo = (convId) => {
    if (!forwardMsg) return;
    pushMessage(convId, {
      id: newMsgId(), sender: 'me', text: forwardMsg.text || '', time: nowTime(),
      attachment: forwardMsg.attachment || null, forwarded: true, replyTo: null
    });
    setForwardMsg(null);
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ---- Rendu des conversations ----
  const renderConversation = (conv) => {
    const query = globalSearch.toLowerCase().trim();
    const visibleMessages = conv.messages.filter(msg => {
      if (hiddenMsgs[msg.id]) return false;
      if (!query) return true;
      return (msg.text || '').toLowerCase().includes(query) || (msg.time || '').toLowerCase().includes(query);
    });

    return (
      <div className="conversation-view">
        <div className="conv-view-header">
          <button className="back-btn" onClick={() => setSelectedConv(null)} aria-label="Retour">
            <i className="fas fa-arrow-left"></i>
          </button>
          <h3>
            <img src={conv.avatar} alt={conv.name} className="conv-avatar" /> {conv.name}
          </h3>
          <div className="conv-actions">
            <button className="conv-action-btn" title="Appel vocal" onClick={() => alert(`Appel vocal vers ${conv.name} (bientôt disponible)`)}>
              <i className="fas fa-phone"></i>
            </button>
            <button className="conv-action-btn" title="Appel vidéo" onClick={() => alert(`Appel vidéo vers ${conv.name} (bientôt disponible)`)}>
              <i className="fas fa-video"></i>
            </button>
            <button className="conv-action-btn" title="Profil" onClick={() => alert(`Profil de ${conv.name} (bientôt disponible)`)}>
              <i className="fas fa-user"></i>
            </button>
          </div>
        </div>

        <div className="messages-container" ref={messagesContainerRef}>
          {visibleMessages.length > 0 ? (
            visibleMessages.map(msg => {
              const msgId = msg.id;
              const msgReactions = reactions[msgId] || {};
              const reactionKeys = Object.keys(msgReactions);
              const showContextMenu = contextMenuMsgId === msgId;
              const att = msg.attachment;
              const isMine = msg.sender === 'me';

              return (
                <div key={msgId} className={`message-wrapper ${isMine ? 'sent' : 'received'}`}>
                  <div className={`message-bubble ${att && att.type === 'audio' ? 'has-voice' : ''}`}>
                    {msg.forwarded && <div className="forwarded-label"><i className="fas fa-share"></i> Transféré</div>}
                    {msg.replyTo && (
                      <div className="reply-quote">
                        <span className="reply-quote-name">{msg.replyTo.sender === 'me' ? 'Vous' : msg.replyTo.sender}</span>
                        <span className="reply-quote-text">{msg.replyTo.text}</span>
                      </div>
                    )}
                    {msg.text && <span className="msg-text">{msg.text}</span>}
                    {att && att.type === 'image' && (
                      <div className="msg-attachment">
                        <img src={att.url} alt="pièce jointe" className="attachment-thumb" />
                        {att.name && <span>{att.name}</span>}
                      </div>
                    )}
                    {att && att.type === 'file' && (
                      <div className="msg-attachment">
                        <i className="fas fa-file"></i>
                        <span>{att.name || att.url}</span>
                      </div>
                    )}
                    {att && att.type === 'audio' && (
                      <div className="voice-msg" dangerouslySetInnerHTML={{ __html: cleanHtml(buildVoiceBubbleHtml(att.url, att.duration)) }}></div>
                    )}
                    <div className="message-actions">
                      <button className="action-btn" title="Répondre" onClick={() => startReply(msg)}><i className="fas fa-reply"></i></button>
                      <button className="action-btn" title="Transférer" onClick={() => setForwardMsg(msg)}><i className="fas fa-share"></i></button>
                      <button className="action-btn" title="Plus" onClick={() => handleContextMenu(msgId)}>
                        <i className="fas fa-ellipsis-h"></i>
                      </button>
                    </div>
                  </div>
                  <div className="message-footer">
                    <span className="msg-time">{msg.time}</span>
                    <div className="reaction-emojis">
                      {reactionKeys.map(emoji => (
                        <button key={emoji} className="reaction-emoji-btn active" onClick={() => toggleReaction(msgId, emoji)}>
                          {emoji}
                          {msgReactions[emoji] > 1 && <span className="reaction-count">{msgReactions[emoji]}</span>}
                        </button>
                      ))}
                      <button className="reaction-add-btn" onClick={() => openReactionPicker(msgId)} title="Ajouter une réaction">
                        <i className="fas fa-plus-circle"></i>
                      </button>
                    </div>
                  </div>
                  {showContextMenu && (
                    <div className="context-menu" onClick={e => e.stopPropagation()}>
                      {isMine && (
                        <button className="context-menu-item danger" onClick={() => handleDelete(msgId, conv.id)}>
                          <i className="fas fa-trash-alt"></i> Supprimer
                        </button>
                      )}
                      <button className="context-menu-item" onClick={() => handleHide(msgId)}>
                        <i className="fas fa-eye-slash"></i> Cacher
                      </button>
                      {att && att.url && (
                        <button className="context-menu-item" onClick={() => handleDownload(msg)}>
                          <i className="fas fa-download"></i> Télécharger
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="no-messages">{query ? 'Aucun message trouvé' : 'Aucun message pour le moment'}</div>
          )}
        </div>

        {replyingTo && (
          <div className="reply-bar">
            <div className="reply-bar-content">
              <span className="reply-bar-name">Répondre à {replyingTo.sender === 'me' ? 'vous-même' : replyingTo.sender}</span>
              <span className="reply-bar-text">{replyingTo.text}</span>
            </div>
            <button className="reply-bar-close" onClick={() => setReplyingTo(null)} title="Annuler"><i className="fas fa-times"></i></button>
          </div>
        )}

        <div className="message-input-area">
          {isRecording ? (
            <div className="recording-bar">
              <div className="recording-wave">
                {[...Array(12)].map((_, i) => (
                  <div key={i} className="wave-bar" style={{ animationDelay: `${i * 0.08}s` }}></div>
                ))}
              </div>
              <span className="recording-time">{formatDuration(recordingTime)}</span>
              <button className="recording-stop-btn" onClick={stopRecording}>
                <i className="fas fa-stop"></i>
              </button>
            </div>
          ) : isRecordingPreview ? (
            <div className="recording-preview">
              <div className="voice-msg" style={{ flex: 1, minWidth: 0 }}
                dangerouslySetInnerHTML={{ __html: cleanHtml(buildVoiceBubbleHtml(recordingUrl || '', recordingDuration)) }}></div>
              <button className="recording-send-btn" onClick={sendAudioMessage}>
                <i className="fas fa-paper-plane"></i>
              </button>
              <button className="recording-cancel-btn" onClick={cancelRecordingPreview}>
                <i className="fas fa-times"></i>
              </button>
            </div>
          ) : (
            <>
              <button className="input-action-btn" title="Enregistrement vocal" onClick={startRecording}>
                <i className="fas fa-microphone"></i>
              </button>
              <button className="input-action-btn" title="Joindre un fichier" onClick={() => attachInputRef.current && attachInputRef.current.click()}>
                <i className="fas fa-folder-open"></i>
              </button>
              <input type="file" ref={attachInputRef} style={{ display: 'none' }} onChange={handleAttachFile} />
              <button className="input-action-btn" title="Ajouter un emoji" onClick={openEmojiPickerForMessage}>
                <i className="fas fa-smile"></i>
              </button>
              <input
                ref={msgInputRef}
                type="text"
                placeholder="Écrire un message..."
                className="msg-input"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); } }}
              />
              <button className="send-msg-btn" title="Envoyer" onClick={sendTextMessage}><i className="fas fa-paper-plane"></i></button>
            </>
          )}
        </div>
      </div>
    );
  };

  // ---- Effets secondaires ----
  useEffect(() => {
    try { localStorage.setItem('purchasedTickets', JSON.stringify(purchasedTickets)); } catch (e) { /* ignore */ }
  }, [purchasedTickets]);
  // Commandes en direct (une seule écoute) : nouvelle commande, ou QR scanné => « Livré et Payé »
  useEffect(() => {
    const sync = () => listMyOrders().then((rows) => {
      setAllOrders(rows);                                   // vendeur : boutons « Commandes / Billets validés »
      setPurchasedTickets((prev) => prev.map((t) => {      // statut de mes propres billets
        const o = t.orderId && rows.find((r) => r.id === t.orderId);
        return o && (o.status !== t.status || o.delivered_at !== t.deliveredAt) ? { ...t, status: o.status, deliveredAt: o.delivered_at } : t;
      }));
    }).catch(() => {});
    sync();
    return subscribeOrders(sync);
  }, []);

  // Synchronisation avec la page User (même localStorage, + autres onglets)
  useEffect(() => { saveStories(allStories.filter(s => !s.remote)); }, [allStories]);
  useEffect(() => subscribeShared({ onEvents: () => {}, onStories: setStories }), []);
  // Publications, stock, réactions et commentaires : lus dans Supabase, mis à jour en temps réel pour tout le monde
  const reloadEvents = async () => {
    try { setEvents(await fetchEvents()); } catch (e) { console.warn('Publications indisponibles', e); }
  };
  const reloadEngagement = async () => {
    try { setEngagement(await fetchEngagement(myId)); } catch (e) { console.warn('Réactions indisponibles', e); }
  };
  useEffect(() => { reloadEvents(); return subscribeEvents(reloadEvents); }, []);
  // Ventes de billets expirées : supprimées (à l'ouverture, puis chaque minute)
  useEffect(() => {
    const tick = async () => { try { await purgeExpiredEvents(); } catch (e) { /* pas bloquant */ } reloadEvents(); };
    tick();
    const timer = setInterval(tick, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { reloadEngagement(); return subscribeEngagement(reloadEngagement); }, [myId]);
  // Stories enregistrées en base (Cloudinary) : chargées et mises à jour en temps réel pour tout le monde
  useEffect(() => {
    if (!myId) return undefined;
    let alive = true;
    const load = () => listStories().then((rows) => {
      if (!alive) return;
      const mapped = rows.map((r) => mapRowToStory(r, ADMIN_ID));
      setStories(prev => [...prev.filter(s => !s.remote), ...mapped]);
    }).catch(() => {});
    load();
    const unsub = subscribeStories(load);
    return () => { alive = false; unsub(); };
  }, [myId]);

  // Stories : visibles 48 h puis effacées (liste à l'écran + base de données)
  useEffect(() => {
    const sweep = () => {
      setStories(prev => (prev.some(isStoryExpired) ? prev.filter(st => !isStoryExpired(st)) : prev));
      purgeExpiredStories().catch(() => {});
    };
    sweep();
    const t = setInterval(sweep, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // Branche le flux caméra sur la <video> une fois la modale affichée
  useEffect(() => {
    if (cameraOpen && cameraReady && videoRef.current && mediaStreamRef.current) {
      videoRef.current.srcObject = mediaStreamRef.current;
    }
  }, [cameraOpen, cameraReady]);

  // Flux du direct (hôte)
  useEffect(() => {
    if (viewerOpen && isHostLive && hostStream && videoRef.current) {
      videoRef.current.srcObject = hostStream;
    }
  }, [viewerOpen, isHostLive, hostStream]);

  // Défilement automatique vers le dernier message
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selectedConvId, selectedConv ? selectedConv.messages.length : 0]);

  // Ferme le menu contextuel d'un message au clic ailleurs
  useEffect(() => {
    if (!contextMenuMsgId) return;
    const close = () => setContextMenuMsgId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenuMsgId]);

  // Nettoyage à la fermeture de la page
  useEffect(() => () => {
    Object.values(audioRefs.current).forEach(a => a && a.pause());
    clearInterval(recordingTimerRef.current);
    clearInterval(vibeTimerRef.current);
    if (vibeAudioRef.current) vibeAudioRef.current.pause();
    [audioStreamRef.current, mediaStreamRef.current].forEach(st => st && st.getTracks().forEach(t => t.stop()));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setUsersOnline(Math.floor(Math.random() * 36) + 15), 10000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => { logout(); navigate('/login'); };

  // Références pour la caméra, etc.
  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const mediaRecorderRef2 = useRef(null);
  const recordedChunksRef = useRef([]);
  const isRecordingRef = useRef(false);
  const vibeTimerRef = useRef(null);
  const [vibeDurationLeft, setVibeDurationLeft] = useState(40);
  const previewContainerRef = useRef(null);

  // ---- RENDU PRINCIPAL ----
  const viewStory = stories[currentViewIndex];
  // Seul l'auteur peut modifier / supprimer sa story (image, vidéo, vibe ou live)
  const isMine = !!(viewStory && (viewStory.remote ? viewStory.userId === myId : viewStory.user === userPseudo));

  const saveStoryEdit = async () => {
    if (!editStory) return;
    const title = (editStory.title || '').trim() || 'Sans titre';
    const cur = stories.find(s => s.id === editStory.id);
    try {
      if (cur && cur.remote) await updateStory(cur.id, { title, description: editStory.desc, privacy: editStory.privacy });
      setStories(prev => prev.map(st => st.id === editStory.id ? { ...st, title, desc: editStory.desc, privacy: editStory.privacy } : st));
      setEditStory(null);
    } catch (err) { alert('Modification impossible : ' + (err.message || err)); }
  };

  const removeStory = async () => {
    const cur = stories[currentViewIndex];
    if (!cur) return;
    if (!window.confirm(cur.type === 'live' ? 'Terminer et supprimer ce live ?' : 'Supprimer cette story définitivement ?')) return;
    try {
      if (cur.remote) {
        if (cur.type === 'live') await stopLive({ id: cur.id, zoom_session_id: cur.zoomSessionId }).catch(() => {});
        await deleteStory(cur.id);
      }
      setStories(prev => prev.filter(st => st.id !== cur.id));
      setLiveSession(null);
      closeViewer();
    } catch (err) { alert('Suppression impossible : ' + (err.message || err)); }
  };
  const canEngage = !!(viewStory && viewStory.remote && myId); // réactions/commentaires : stories enregistrées en base

  return (
    <div className="admin-vip" style={{ backgroundImage: `url(${bgImage})` }}>
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
        {menuOpen && (
          <div className="side-menu">
            <div className="menu-item" onClick={() => { setProfileSettingsOpen(true); setMenuOpen(false); }}>
              <i className="fas fa-user-circle"></i> Profil
            </div>
            <div className="menu-item" onClick={() => alert('Fonctionnalité Sécurité à venir')}>
              <i className="fas fa-shield-alt"></i> Sécurité
            </div>
            <div className="menu-item" onClick={handleLogout}>
              <i className="fas fa-sign-out-alt"></i> Déconnexion
            </div>
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

      {/* ===== BARRE DE NAVIGATION MOBILE (HAUT) ===== */}
      <div className="mobile-top-nav">
        <div className="search-bar-mobile">
          <input
            type="text"
            placeholder="Rechercher..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
          />
          <button className="search-btn"><i className="fas fa-search"></i></button>
        </div>
        <div className="mobile-nav-buttons">
          <button
            className={`mobile-nav-btn ${activeTab === 'feed' ? 'active' : ''}`}
            onClick={() => { setActiveTab('feed'); setSelectedConv(null); }}
          >
            <i className="fas fa-home"></i>
            <span>Feed</span>
          </button>
          <button
            className={`mobile-nav-btn ${activeTab === 'amis' ? 'active' : ''}`}
            onClick={() => { setActiveTab('amis'); setSelectedConv(null); }}
          >
            <i className="fas fa-users"></i>
            <span>Amis</span>
          </button>
          <button
            className={`mobile-nav-btn ${activeTab === 'messages' ? 'active' : ''}`}
            onClick={() => { setActiveTab('messages'); setSelectedConv(null); }}
          >
            <i className="fas fa-comment-dots"></i>
            <span>Messages</span>
          </button>
          <button
            className={`mobile-nav-btn ${activeTab === 'notifications' ? 'active' : ''}`}
            onClick={() => { setActiveTab('notifications'); setSelectedConv(null); }}
          >
            <i className="fas fa-bell"></i>
            <Badge count={notif.unread} />
            <span>Notifs</span>
          </button>
          <button
            className={`mobile-nav-btn ${activeTab === 'events' ? 'active' : ''}`}
            onClick={() => { setActiveTab('events'); setSelectedConv(null); }}
          >
            <i className="fas fa-ticket-alt"></i>
            <span>Events</span>
          </button>
        </div>
      </div>

      <main className="vip-layout">
        {/* ===== PANEL CENTRAL ===== */}
        <div className={`vip-center-panel ${activeTab === 'messages' ? 'panel-messages' : ''}`}>
          {/* ===== BARRE DE TÂCHES ===== */}
          <div className="task-bar">
            <button className={`task-btn ${activeTab === 'feed' ? 'active' : ''}`} onClick={() => { setActiveTab('feed'); setSelectedConv(null); }}>
              <i className="fas fa-home"></i>
            </button>
            <button className={`task-btn ${activeTab === 'amis' ? 'active' : ''}`} onClick={() => { setActiveTab('amis'); setSelectedConv(null); }}>
              <i className="fas fa-users"></i>
            </button>
            <button className={`task-btn ${activeTab === 'messages' ? 'active' : ''}`} onClick={() => { setActiveTab('messages'); setSelectedConv(null); }}>
              <i className="fas fa-comment-dots"></i>
            </button>
            <button className={`task-btn ${activeTab === 'notifications' ? 'active' : ''}`} onClick={() => { setActiveTab('notifications'); setSelectedConv(null); }}>
              <i className="fas fa-bell"></i><Badge count={notif.unread} />
            </button>
            <button className={`task-btn ${activeTab === 'events' ? 'active' : ''}`} onClick={() => { setActiveTab('events'); setSelectedConv(null); }}>
              <i className="fas fa-ticket-alt"></i>
            </button>
          </div>

          {/* ===== CONTENU DES ONGLETS ===== */}
          {activeTab === 'feed' && (
            <>
              <div className="feed-header">
                <h3><i className="fas fa-fire"></i> Feed VIP</h3>
                <div className="search-bar-container">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Rechercher dans le Feed..."
                    value={globalSearch}
                    onChange={(e) => setGlobalSearch(e.target.value)}
                  />
                  <button className="search-btn"><i className="fas fa-search"></i></button>
                </div>
              </div>

              <div className="stories-container">
                <div className="story-card story-card-create" onClick={showCreationMenu} role="button" tabIndex={0}>
                  <div className="story-card-create-img"><img src={userPhoto} alt="" /></div>
                  <div className="story-card-create-bar">
                    <span className="story-card-plus"><i className="fas fa-plus"></i></span>
                    <span className="story-card-create-label">Créer une story</span>
                  </div>
                </div>
                {renderStories()}
              </div>

              <div className="events-container">
                {filteredEvents.length === 0 && (
                  <p style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
                    {clientEvents.length === 0 ? "Aucune publication pour le moment." : 'Aucun résultat.'}
                  </p>
                )}
                {filteredEvents.map(evt => {
                  const hasTiers = evt.tiers && evt.tiers.length > 0;
                  const soldOut = hasTiers && evt.tiers.every(t => (Number(t.quantity) || 0) <= 0);
                  const isTicket = evt.type === 'billet';
                  return (
                    <PostCard
                      key={evt.id}
                      evt={evt}
                      fallbackAvatar={userPhoto}
                      fallbackName={userPseudo}
                      fire={{ count: engagement.fire[evt.id] || 0, mine: !!engagement.mine[evt.id], onClick: () => toggleFireOn(evt) }}
                      comments={{ count: engagement.comments[evt.id] || 0, onClick: () => openComments(evt) }}
                      onOpen={() => openComments(evt)}
                      engagement={<EventEngagementBar eventId={evt.id} currentUserId={myId} currentUserAvatar={userPhoto} currentUserPseudo={userPseudo} />}
                      barLink={evt.price && !hasTiers ? { label: formatPrice(parseFloat(evt.price)), onClick: () => {} } : undefined}
                      cta={evt.type !== 'scrolle' ? { label: soldOut ? 'Épuisé' : isTicket ? <><i className="fas fa-ticket-alt" /> Billet</> : <><i className="fas fa-shopping-cart" /> Panier</>, disabled: soldOut, onClick: () => openCart(evt) } : undefined}
                      extra={(evt.type === 'article' || evt.type === 'billet' || evt.type === 'album') ? (
                        <>
                          {evt.type === 'article' && evt.stock !== null && evt.stock !== undefined && (
                            <div style={{ color: evt.stock > 0 ? '#2e7d32' : '#E22134' }}><i className="fas fa-box"></i> {evt.stock > 0 ? `${evt.stock} article(s) disponible(s)` : 'Rupture de stock'}</div>
                          )}
                          {isTicket && <div><i className="fas fa-calendar-alt"></i> {evt.date} · {(evt.tiers || []).reduce((n, t) => n + (Number(t.quantity) || 0), 0)} place(s) restante(s)</div>}
                          {hasTiers && (
                            <div className="tiers-list">
                              {evt.tiers.map(tier => (
                                <div key={tier.id} className="sp-row" style={{ padding: '4px 0' }}>
                                  <span><i className={tierIconClass(tier.type)}></i> {tier.name}</span>
                                  <span>{formatPrice(tier.price)} · {tier.quantity} restant(s)</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      ) : undefined}
                    />
                  );
                })}
              </div>
            </>
          )}

          {activeTab === 'amis' && (
            <div className="friends-list-mobile">
              <div className="feed-header">
                <h3><i className="fas fa-users"></i> Amis</h3>
                <div className="search-bar-container">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Rechercher un ami..."
                    value={globalSearch}
                    onChange={(e) => setGlobalSearch(e.target.value)}
                  />
                  <button className="search-btn"><i className="fas fa-search"></i></button>
                </div>
              </div>
              <div className="friends-list">
                {filteredFriends.map(friend => (
                  <div key={friend.id} className="friend-item">
                    <img src={friend.avatar || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'} alt="avatar" />
                    <span>{friend.name}</span>
                    {renderFriendAction(friend)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'messages' && (
            <>
            <div className={`messages-layout ${selectedConv ? 'show-conversation' : ''}`}>
              <div className="messages-contacts">
                <div className="contacts-header">
                  <h4><i className="fas fa-user-friends"></i> Contacts</h4>
                  <input
                    type="text"
                    className="search-contacts"
                    placeholder="Rechercher un contact..."
                    value={globalSearch}
                    onChange={(e) => setGlobalSearch(e.target.value)}
                  />
                </div>
                <div className="contacts-list">
                  {conversations.length === 0 && (
                    <div className="contacts-empty">
                      <i className="fas fa-user-plus"></i>
                      <p>Aucun ami pour le moment.<br />Ajoutez des amis pour pouvoir discuter avec eux.</p>
                      <button className="btn-primary" onClick={() => { setActiveTab('amis'); setSelectedConv(null); }}>Voir les membres</button>
                    </div>
                  )}
                  {conversations.length > 0 && filteredConversations.length === 0 && (
                    <div className="contacts-empty"><p>Aucun contact trouvé.</p></div>
                  )}
                  {filteredConversations.map(conv => (
                    <div
                      key={conv.id}
                      className={`contact-item ${selectedConv && selectedConv.id === conv.id ? 'active' : ''}`}
                      onClick={() => setSelectedConv(conv)}
                    >
                      <img src={conv.avatar} alt={conv.name} />
                      <div className="contact-info">
                        <span className="contact-name">{conv.name}</span>
                        <span className="contact-last-msg">{conv.lastMsg}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="messages-conversation">
                {selectedConv ? (
                  renderConversation(selectedConv)
                ) : (
                  <div className="no-conversation-selected">
                    <i className="fas fa-comments"></i>
                    <p>Sélectionnez un contact<br />pour commencer à discuter</p>
                  </div>
                )}
              </div>
            </div>

            {/* Personnes ajoutées (amis acceptés) : accès rapide aux conversations */}
            {conversations.length > 0 && (
              <div className="friends-strip" role="tablist" aria-label="Personnes ajoutées">
                {conversations.map(conv => (
                  <button
                    key={conv.id}
                    type="button"
                    role="tab"
                    aria-selected={!!selectedConv && selectedConv.id === conv.id}
                    className={`friends-strip-item ${selectedConv && selectedConv.id === conv.id ? 'active' : ''}`}
                    onClick={() => setSelectedConv(conv)}
                    title={conv.name}
                  >
                    <img src={conv.avatar} alt="" />
                    <span>{conv.name}</span>
                  </button>
                ))}
              </div>
            )}
            </>
          )}

          {activeTab === 'notifications' && (
            <div className="notifications-list-mobile">
              <div className="feed-header">
                <h3><i className="fas fa-bell"></i> Notifications</h3>
                <div className="search-bar-container">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Rechercher une notification..."
                    value={globalSearch}
                    onChange={(e) => setGlobalSearch(e.target.value)}
                  />
                  <button className="search-btn"><i className="fas fa-search"></i></button>
                </div>
              </div>
              <NotificationsPanel notif={notif} search={globalSearch} onNavigate={goFromNotif} />
            </div>
          )}

          {activeTab === 'events' && (
            <MyShop cart={cart} view={myView} setView={setMyView} clientName={userPseudo} onGoFeed={() => setActiveTab('feed')} />
          )}
        </div>
        {/* ===== FIN PANEL CENTRAL ===== */}
      </main>

      <NotificationToast notif={notif} onNavigate={goFromNotif} />

      {/* ===== MODALES ===== */}

      {/* MODAL CRÉATION */}
      <div className="modal-overlay" id="creationMenuModal" style={{ display: 'none' }} onClick={hideModals}>
        <div className="modal-content creation-grid" onClick={e => e.stopPropagation()}>
          <div className="creation-card" onClick={() => guardStory(() => chooseSource('photo'))}><i className="fas fa-camera creation-icon"></i><br />Image</div>
          <div className="creation-card" onClick={() => guardStory(() => chooseSource('video'))}><i className="fas fa-video creation-icon"></i><br />Vidéo</div>
          <div className="creation-card" onClick={() => guardStory(startVibeFlow)}><i className="fas fa-music creation-icon"></i><br />Vibe</div>
          <div className="creation-card" onClick={startLiveFlow}><i className="fas fa-broadcast-tower creation-icon" style={{ color: 'red' }}></i><br />En Direct</div>
        </div>
      </div>

      {sourceMenuOpen && (
        <div className="modal-overlay" onClick={() => setSourceMenuOpen(false)}>
          <div className="modal-content creation-grid" onClick={e => e.stopPropagation()}>
            <div className="creation-card" onClick={triggerFileInput}><i className="fas fa-folder-open creation-icon"></i><br />Importer (Dossier)</div>
            <div className="creation-card" onClick={openCamera}><i className="fas fa-camera creation-icon"></i><br />Appareil Photo / Caméra</div>
          </div>
        </div>
      )}
      <input type="file" id="fileInputVIP" accept="image/*,video/*" style={{ display: 'none' }} onChange={handleFileUpload} />

      {cameraOpen && (
        <div className="modal-overlay" onClick={closeCamera}>
          <div className="modal-content camera-container" onClick={e => e.stopPropagation()}>
            <div className="camera-preview">
              <video ref={videoRef} autoPlay playsInline muted className="camera-video"></video>
              {creationMode === 'vibe' && <div className="recording-timer">{vibeDurationLeft}</div>}
              {creationMode === 'vibe' && vibeMusic && (
                <div style={{ position: 'absolute', left: 10, bottom: 10, maxWidth: '80%', padding: '4px 10px', borderRadius: 14, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  🎵 {vibeMusic.title} — {vibeMusic.artist}
                </div>
              )}
            </div>
            <div className="camera-actions">
              <button className="btn-primary" onClick={captureMedia}>
                {cameraRecording ? "Arrêter l'enregistrement" : creationMode === 'photo' ? 'Prendre Photo' : creationMode === 'video' ? 'Enregistrer Vidéo' : 'Démarrer Vibe'}
              </button>
              <button className="btn-secondary" onClick={closeCamera}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {editorOpen && (
        <div className="modal-overlay" onClick={closeEditor}>
          <div className="editor-container" onClick={e => e.stopPropagation()}>
            <div className="editor-header">
              <h2>Éditeur Story</h2>
              <button className="btn-primary" onClick={closeEditor}>Annuler</button>
            </div>
            <div className="editor-body">
              <div className="editor-tools">
                <div className="tool-section">
                  <h3>Outils Créatifs</h3>
                  <button className="tool-btn" onClick={() => setTextModalOpen(true)}><i className="fas fa-font"></i> Ajouter Texte</button>
                  <button className="tool-btn" onClick={() => setEmojiModalOpen(true)}><i className="fas fa-smile"></i> Ajouter Emoji</button>
                </div>
                <div className="tool-section">
                  <h3>Publication</h3>
                  <input type="text" className="input-text" placeholder="Titre" value={storyTitle} onChange={e => setStoryTitle(e.target.value)} />
                  <textarea className="input-text" placeholder="Description" value={storyDesc} onChange={e => setStoryDesc(e.target.value)}></textarea>
                  <select className="privacy-select" value={storyPrivacy} onChange={e => setStoryPrivacy(e.target.value)}>
                    <option value="public">Public</option>
                    <option value="friends">Amis uniquement</option>
                    <option value="private">Privé</option>
                  </select>
                  <button className="btn-primary" style={{ width: '100%' }} onClick={publishStory}>Publier</button>
                </div>
              </div>
              <div className="editor-preview">
                <div className="preview-container" ref={previewContainerRef}
                  style={currentMediaType === 'photo' ? { width: 'auto', height: 'auto', aspectRatio: 'auto', maxWidth: '100%', display: 'inline-block', lineHeight: 0 } : undefined}>
                  {currentMediaUrl && (
                    currentMediaType === 'photo' ? (
                      <img src={currentMediaUrl} alt="preview" style={{ display: 'block', width: 'auto', height: 'auto', maxWidth: 'min(340px, 100%)', maxHeight: '70vh', objectFit: 'contain' }} />
                    ) : (
                      creationMode === 'vibe' && vibeMusic ? (
                      <VibePlayer url={currentMediaUrl} className="" style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        music={{ src: vibeMusic.src, start: vibeStart, length: vibeLength }} />
                    ) : (
                      <video src={currentMediaUrl} style={{ width: '100%', height: '100%', objectFit: 'contain' }} loop autoPlay />
                    )
                    )
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {textModalOpen && (
        <div className="modal-overlay" onClick={() => setTextModalOpen(false)}>
          <div className="modal-content small" onClick={e => e.stopPropagation()}>
            <input type="text" id="vipTextInput" className="input-text" placeholder="Votre texte" />
            <div className="text-controls" style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              <input type="color" id="textColor" defaultValue="#ffffff" />
              <input type="color" id="textBg" defaultValue="#000000" />
              <select id="textFont" className="input-text">
                <option value="Arial">Arial</option>
                <option value="Times New Roman">Times</option>
                <option value="Courier New">Courier</option>
              </select>
            </div>
            <button className="btn-primary" onClick={addTextToPreview}>Ajouter</button>
          </div>
        </div>
      )}

      {emojiModalOpen && (
        <div className="modal-overlay" onClick={() => setEmojiModalOpen(false)}>
          <div className="modal-content emoji-grid" onClick={e => e.stopPropagation()}>
            <h3>Choisissez un emoji</h3>
            <EmojiPicker
              onSelect={(emoji) => {
                if (isEmojiPickerForMessage) {
                  insertEmojiIntoMessage(emoji);
                } else if (reactionTargetMsgId) {
                  handleReactionEmojiSelect(emoji);
                } else {
                  addEmojiToPreview(emoji); // emoji ajouté à la story
                }
              }}
              onClose={() => {
                setReactionTargetMsgId(null);
                setIsEmojiPickerForMessage(false);
                setEmojiModalOpen(false);
              }}
            />
          </div>
        </div>
      )}

      {/* ===== PUBLICATION OUVERTE (même rendu qu'une story : image, Réagir / Commenter, + Panier / Billet) ===== */}
      {commentModalOpen && commentTargetEvent && (
        <PublicationViewer
          evt={events.find(e => e.id === commentTargetEvent.id) || commentTargetEvent}
          onClose={() => setCommentModalOpen(false)}
          onBuy={(evt) => openCart(evt)}
          currentUserId={myId} currentUserAvatar={userPhoto} currentUserPseudo={userPseudo}
          fallbackAvatar={userPhoto} fallbackName={userPseudo} />
      )}

      {/* ===== MODAL ACHAT : article → panier ; billet → formulaire envoyé à l'admin ===== */}
      {cartModalOpen && cartTargetEvent && (
        <BuyModal evt={cartTargetEvent} onClose={() => setCartModalOpen(false)} onAddToCart={addToCart} onSubmitTicket={sendTicketRequest} />
      )}


      {/* ===== MODAL VENDEUR : COMMANDES / BILLETS VALIDÉS D'UN ÉVÉNEMENT ===== */}
      {ordersModal && (() => {
        const all = ordersOfEvent(ordersModal.evt.id);
        const list = ordersModal.mode === 'valides' ? all.filter(o => isOrderDone(o)) : all;
        const isValid = ordersModal.mode === 'valides';
        return (
          <div className="modal-overlay" onClick={() => setOrdersModal(null)}>
            <div className="modal-content small" onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setOrdersModal(null)}>&times;</button>
              <h3>
                <i className={`fas ${isValid ? 'fa-check-circle' : 'fa-shopping-bag'}`}></i>{' '}
                {isValid ? 'Billets validés' : 'Commandes'} — {ordersModal.evt.title}
              </h3>
              {list.length === 0 ? (
                <p style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
                  {isValid ? 'Aucun billet validé pour le moment.' : 'Aucune commande pour le moment.'}
                </p>
              ) : (
                <div className="purchased-tickets-list">
                  {list.map(o => (
                    <div key={o.id} className="purchased-ticket-item">
                      <div className="ticket-header">
                        <span className="ticket-event">n°{String(o.invoice_no).padStart(6, '0')}</span>
                        <span className="ticket-date">{o.created_at ? new Date(o.created_at).toLocaleDateString() : ''}</span>
                      </div>
                      <div className="ticket-details">
                        {o.items.map((i, k) => <span key={k}>{i.tier_name} ×{i.quantity}</span>)}
                        <span>Total : {o.items.reduce((t, i) => t + Number(i.unit_price || 0) * Number(i.quantity || 0), 0).toLocaleString()} Ar</span>
                        <span style={{ color: isOrderDone(o) ? '#00C851' : '#ffbb33' }}>{STATUS_LABEL[o.status] || o.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ===== MODAL ÉVÉNEMENTS (billets achetés) ===== */}
      {eventsModalOpen && (
        <div className="modal-overlay" onClick={() => setEventsModalOpen(false)}>
          <div className="modal-content small" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEventsModalOpen(false)}>&times;</button>
            <h3><i className="fas fa-ticket-alt"></i> Mes billets achetés</h3>
            {purchasedTickets.length === 0 ? (
              <p style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
                Vous n'avez encore acheté aucun billet.
              </p>
            ) : (
              <div className="purchased-tickets-list">
                {purchasedTickets.map(ticket => (
                  <div key={ticket.id} className="purchased-ticket-item">
                    <div className="ticket-header">
                      <span className="ticket-event">{ticket.eventTitle}</span>
                      <span className="ticket-date">{ticket.purchaseDate}</span>
                    </div>
                    <div className="ticket-details">
                      <span>Palier : {ticket.tierName}</span>
                      <span>Quantité : {ticket.quantity}</span>
                      <span>Total : {ticket.totalPrice.toLocaleString()} Ar</span>
                        {renderTicketExtras(ticket)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== MODAL TRANSFERT DE MESSAGE ===== */}
      {forwardMsg && (
        <div className="modal-overlay" onClick={() => setForwardMsg(null)}>
          <div className="modal-content small" onClick={e => e.stopPropagation()}>
            <h3><i className="fas fa-share"></i> Transférer à…</h3>
            <div className="forward-list">
              {conversations.map(c => (
                <div key={c.id} className="contact-item" onClick={() => forwardTo(c.id)}>
                  <img src={c.avatar} alt={c.name} />
                  <div className="contact-info"><span className="contact-name">{c.name}</span></div>
                </div>
              ))}
            </div>
            <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => setForwardMsg(null)}>Annuler</button>
          </div>
        </div>
      )}

      {musicPageOpen && (
        <VibeMusicPicker onCancel={() => setMusicPageOpen(false)} onConfirm={confirmVibeMusic} />
      )}

      {liveConfigOpen && (
        <div className="modal-overlay" onClick={() => setLiveConfigOpen(false)}>
          <div className="modal-content small" onClick={e => e.stopPropagation()}>
            <h3>Configurer En Direct</h3>
            <select className="privacy-select" value={livePrivacy} onChange={e => setLivePrivacy(e.target.value)}>
              <option value="public">Public</option>
              <option value="friends">Amis</option>
            </select>
            <button className="btn-primary" onClick={launchLive}>Commencer le Direct</button>
          </div>
        </div>
      )}

      {viewerOpen && stories[currentViewIndex] && (
        <div className="modal-overlay story-viewer" onClick={closeViewer}>
          <div className="viewer-container viewer-post" onClick={e => e.stopPropagation()}>
            <div className="vp-header">
              <img className="vp-avatar" alt="avatar"
                src={viewStory.user === userPseudo ? userPhoto : (viewStory.avatar || 'https://randomuser.me/api/portraits/men/1.jpg')} />
              <div className="vp-who">
                <span className="vp-name">{viewStory.user}</span>
                <span className="vp-meta">
                  {storyTimeLabel(viewStory.createdAt || viewStory.created_at)} · <i className={`fas ${viewStory.privacy === 'private' ? 'fa-lock' : viewStory.privacy === 'friends' ? 'fa-user-friends' : 'fa-globe-africa'}`}></i>
                </span>
              </div>
              {!isMine && <button className="v-follow">Suivre</button>}
              {isMine && (
                <div className="vp-menu-wrap">
                  <button className="vp-icon-btn" title="Options" onClick={() => setStoryMenuOpen(!storyMenuOpen)}><i className="fas fa-ellipsis-h"></i></button>
                  {storyMenuOpen && (
                    <div className="vp-menu">
                      <button onClick={() => { setStoryMenuOpen(false); setEditStory({ id: viewStory.id, title: viewStory.title || '', desc: viewStory.desc || '', privacy: viewStory.privacy || 'public' }); }}>
                        <i className="fas fa-pen"></i> Modifier
                      </button>
                      <button className="danger" onClick={() => { setStoryMenuOpen(false); removeStory(); }}>
                        <i className="fas fa-trash-alt"></i> Supprimer
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button className="vp-icon-btn" title="Fermer" onClick={closeViewer}><i className="fas fa-times"></i></button>
            </div>

            <div className="vp-body">
              <div className="vp-text">
                {viewStory.title && <div className="vp-title">{viewStory.title}</div>}
                {viewStory.desc && (
                  <div className={`vp-desc ${descOpen ? 'open' : ''}`}>
                    {viewStory.desc}
                  </div>
                )}
                {viewStory.desc && viewStory.desc.length > 120 && (
                  <button className="vp-more-link" onClick={() => setDescOpen(!descOpen)}>{descOpen ? 'Voir moins' : 'Voir plus'}</button>
                )}
                {viewStory.music && (
                  <div className="vp-music">🎵 {viewStory.music.title} — {viewStory.music.artist}</div>
                )}
              </div>

              <div className="vp-media">
                {(viewStory.type === 'video' || viewStory.type === 'vibe') && (
                  <button className="play-pause-btn vp-playpause" id="viewerPlayPause" onClick={togglePlayPause}><i className="fas fa-pause"></i></button>
                )}
                {viewStory.type === 'photo' && (
                  viewStory.remote
                    ? <StoryPhoto fit="natural" maxWidth="100%" maxHeight="75vh" url={viewStory.url} overlays={viewStory.overlays} />
                    : <div dangerouslySetInnerHTML={{ __html: viewStory.previewHtml }} />
                )}
                {(viewStory.type === 'video' || viewStory.type === 'vibe') && (
                  viewStory.type === 'vibe' && viewStory.music ? (
                    <VibePlayer key={viewStory.id} id="viewerVideo" url={viewStory.url} music={viewStory.music} />
                  ) : (
                    <video src={viewStory.url} className="story-media" id="viewerVideo" autoPlay loop />
                  )
                )}
                {viewStory.type === 'live' && (
                  <LiveStage story={viewStory} me={{ id: myId, pseudo: userPseudo, avatar: userPhoto }}
                    isHost={!!(isHostLive || viewStory.userId === myId)} hostStream={hostStream}
                    onEnd={() => { if (window.confirm('Terminer ce live ?')) endLive(); }}>
                    <LivePanel story={viewStory} me={{ id: myId, pseudo: userPseudo }}
                      isHost={isHostLive} hostSession={liveSession} hostStream={hostStream} onZoomEnded={closeViewer} />
                  </LiveStage>
                )}
              </div>

              {viewStory.type === 'live' ? null : canEngage ? (
                <StoryEngagementBar storyId={viewStory.id} currentUserId={myId}
                  currentUserAvatar={userPhoto} currentUserPseudo={userPseudo} />
              ) : (
                <div className="vp-local-note">Les réactions et commentaires sont disponibles une fois la story enregistrée.</div>
              )}
            </div>

            {editStory && (
              <div className="viewer-edit-modal" onClick={e => e.stopPropagation()}>
                <div className="viewer-edit-box">
                  <h3>Modifier la publication</h3>
                  <input type="text" className="input-text" placeholder="Titre" value={editStory.title}
                    onChange={e => setEditStory({ ...editStory, title: e.target.value })} />
                  <textarea className="input-text" placeholder="Description" value={editStory.desc}
                    onChange={e => setEditStory({ ...editStory, desc: e.target.value })}></textarea>
                  <select className="privacy-select" value={editStory.privacy}
                    onChange={e => setEditStory({ ...editStory, privacy: e.target.value })}>
                    <option value="public">Public</option>
                    <option value="friends">Amis uniquement</option>
                    <option value="private">Privé</option>
                  </select>
                  <div className="viewer-edit-actions">
                    <button className="btn-primary" onClick={saveStoryEdit}>Enregistrer</button>
                    <button className="btn-cancel" onClick={() => setEditStory(null)}>Annuler</button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="viewer-nav-arrows vp-nav" onClick={e => e.stopPropagation()}>
            <button className="nav-arrow" onClick={() => navigateStory(-1)}><i className="fas fa-chevron-up"></i></button>
            <button className="nav-arrow" onClick={() => navigateStory(1)}><i className="fas fa-chevron-down"></i></button>
          </div>
        </div>
      )}

      {/* ===== FOOTER ===== */}
      <footer className="admin-footer">
        <div className="footer-nav" style={{ maxWidth: '300px', gap: '10vw' }}>
          <button
            className={`foot-icon ${location.pathname === '/user/musique' ? 'active' : ''}`}
            onClick={() => navigate('/user/musique')}
          >
            <i className="fas fa-headphones"></i>
          </button>
          <button
            className={`foot-icon ${location.pathname === '/user/home' ? 'active' : ''}`}
            onClick={() => navigate('/user/home')}
          >
            <i className="fas fa-home"></i>
          </button>
          <button
            className={`foot-icon ${location.pathname === '/user/vip' ? 'active' : ''}`}
            onClick={() => navigate('/user/vip')}
          >
            <i className="fas fa-crown"></i>
          </button>
        </div>
      </footer>

    </div>
  );
};

export default UserVip;
