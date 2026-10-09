// src/Visiteur/Visiteur.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './Visiteur.css';
import albumImg from '../assets/Images/every_day.jpeg';
import devImg from '../assets/Images/Roméo.jpeg';
import designerImg from '../assets/Images/Mamitiana.jpeg';
import videoSrc from '../assets/Vidéo/arcade.mp4';
import { supabase } from '../supabaseClient';
import { CountUp } from '../utils/CountUp'; // compteur animé partagé avec le tableau de bord admin

// Chiffres réels : membres validés, morceaux et visiteurs, lus dans Supabase.
// La fonction get_public_stats() (voir final.sql, section 11) est lisible par les
// visiteurs non connectés ; en secours on compte directement les morceaux.
const fetchPublicStats = async () => {
  const { data, error } = await supabase.rpc('get_public_stats');
  if (!error && data) {
    return {
      members: Number(data.members) || 0,
      songs: Number(data.songs) || 0,
      visitors: Number(data.visitors) || 0,
    };
  }
  console.warn('get_public_stats indisponible, secours sur la table songs :', error?.message);
  const { count } = await supabase.from('songs').select('id', { count: 'exact', head: true });
  return { members: 0, songs: count || 0, visitors: 0 };
};

// ---------------------------------------------------------------
// VISITEURS — comptés automatiquement, une seule fois chacun.
// Identité : l'e-mail si le visiteur est connecté, sinon un code anonyme propre
// à son appareil. Rien n'est envoyé en clair (empreintes SHA-256) ; la base
// (register_visitor) ignore une clé déjà connue : un visiteur qui revient ne
// fait donc pas monter le chiffre une deuxième fois.
// ---------------------------------------------------------------
const DEVICE_KEY = 'yassal_device_id';

const sha256Hex = async (text) => {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
};

const getDeviceId = () => {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      localStorage.setItem(DEVICE_KEY, id);
      if (localStorage.getItem(DEVICE_KEY) !== id) return null;
    }
    return id;
  } catch {
    return null; // stockage bloqué : on ne compte pas (sinon chaque rechargement ferait +1)
  }
};

const registerVisit = async () => {
  if (!window.crypto || !window.crypto.subtle) return null;
  const deviceId = getDeviceId();
  if (!deviceId) return null;

  const keys = [];
  const { data: { session } } = await supabase.auth.getSession();
  const email = session?.user?.email;
  if (email) keys.push(await sha256Hex('yassal-visitor:' + email.trim().toLowerCase()));
  keys.push(await sha256Hex('yassal-device:' + deviceId));

  const { data, error } = await supabase.rpc('register_visitor', { p_keys: keys });
  if (error) throw error;
  return { total: Number(data.total) || 0, isNew: !!data.is_new };
};

const Visiteur = () => {
  const navigate = useNavigate();
  const [showMore, setShowMore] = useState(false);
  const [stats, setStats] = useState({ members: 0, songs: 0, visitors: 0 });

  useEffect(() => {
    let off = false;
    fetchPublicStats().then(r => {
      if (!off) setStats(prev => ({ ...r, visitors: Math.max(prev.visitors, r.visitors) }));
    });
    return () => { off = true; };
  }, []);

  // ----- Compteur de visiteurs : automatique, une seule fois par visiteur -----
  useEffect(() => {
    let off = false;
    registerVisit()
      .then(r => {
        if (r && !off) setStats(prev => ({ ...prev, visitors: Math.max(prev.visitors, r.total) }));
      })
      .catch(e => console.warn('Comptage du visiteur impossible :', e.message || e));
    return () => { off = true; };
  }, []);
  const videoRef = useRef(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handleReadMore = () => setShowMore(!showMore);
  const goToLogin = () => navigate('/login');

  const playVideo = () => videoRef.current?.play();
  const pauseVideo = () => videoRef.current?.pause();
  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(videoRef.current.muted);
    }
  };
  const toggleFullScreen = () => {
    if (!document.fullscreenElement) videoRef.current?.requestFullscreen();
    else document.exitFullscreen();
  };

  return (
    <div className="visitor-page">
      <header className="visitor-header">
        <div className="logo">YASSAL</div>
        <div className="welcome-msg">
          <span className="typing">Bienvenue dans l'univers de YASSAL...</span>
        </div>
      </header>

      <main className="hero-section">
        <div className="bio-container">
          {/* Statistiques */}
          <div className="stats-container">
            <div className="stat-box">
              <div className="stat-number"><CountUp value={stats.members} /></div>
              <div className="stat-label">Membres</div>
            </div>
            <div className="stat-box">
              <div className="stat-number"><CountUp value={stats.songs} /></div>
              <div className="stat-label">Chansons</div>
            </div>
            <div className="stat-box">
              <div className="stat-number"><CountUp value={stats.visitors} /></div>
              <div className="stat-label">Visiteurs</div>
            </div>
          </div>

          {/* Biographie de l'artiste */}
          <div className="bio-content">
            <img src={albumImg} alt="Album YASSAL" className="album-img" />
            <div className="text-area">
              <h1>Biographie de l'Artiste</h1>
              <p className="bio-text">
                A.L.P est un rappeur malgache contemporain originaire du quartier d'Ambohimanarina (6ème arrondissement d'Antananarivo). Il s'est imposé sur la scène du rap gasy par son style qualifié de "rap identitaire", à la fois transgressif et progressiste.
                {showMore && (
                  <span className="more-text">
                    <br /><br />
                    <strong>Parcours et Affiliations</strong><br />
                    Collectifs : Il est membre du collectif 6K.RIO ainsi que de la Team Requin.<br />
                    Visibilité : Il a marqué les esprits par sa participation au Cyphaka "RPBLK", une initiative du label Kolotsaina Mainty sur Facebook visant à promouvoir la culture hip-hop locale.<br /><br />
                    <strong>Discographie Notable</strong><br />
                    Série "Zanabahaoka" : Une suite de morceaux qui a contribué à sa notoriété initiale.<br />
                    Enina (2023) : Son premier album studio officiel.<br />
                    YASSAL (2025) : Son projet le plus récent, présenté comme une trilogie explorant "l'ombre du succès". La première partie est sortie en mars 2025.<br /><br />
                    Son pseudonyme est parfois associé à l'appellation "A.L.P Tsy Ofisialy" sur les réseaux sociaux, et il collabore régulièrement avec d'autres figures comme Malgash (a.k.a Zakai).
                  </span>
                )}
              </p>
              <button onClick={handleReadMore} className="read-btn">
                {showMore ? 'Voir moins' : 'Voir plus'}
              </button>
            </div>
          </div>

          <hr className="divider" />

          {/* Équipe */}
          <div className="team-section">
            <h2 className="team-title">L'Équipe Créative</h2>
            <div className="team-container">
              <div className="team-member">
                <img src={devImg} alt="Développeur" className="member-image" />
                <div className="member-role">DÉVELOPPEUR WEB</div>
                <div className="member-name">ANDRIANAMBININTSOA Rova Manitra Roméo</div>
                <div className="member-divider"></div>
                <p className="member-bio">
                  Développeur web full-stack passionné par la création d'expériences numériques innovantes. 
                  Spécialisé dans le développement front-end et back-end, il a conçu et développé cette plateforme 
                  pour offrir une expérience utilisateur optimale aux fans de YASSAL.
                </p>
              </div>

              <div className="team-member">
                <img src={designerImg} alt="Designer" className="member-image" />
                <div className="member-role">DESIGNER GRAPHIQUE</div>
                <div className="member-name">Mamitiana</div>
                <div className="member-divider"></div>
                <p className="member-bio">
                  Designer graphique talentueux spécialisé dans l'identité visuelle et l'expérience utilisateur. 
                  Il a créé l'interface moderne et épurée de cette plateforme, en harmonie avec l'univers artistique 
                  de YASSAL. Son approche créative a permis de traduire l'essence musicale en design visuel.
                </p>
              </div>
            </div>
          </div>

          {/* Section Vidéo */}
          <div className="video-section">
            <h2 className="video-title">Biographie du site</h2>
            <div className="video-content">
              <div className="video-container">
                <video ref={videoRef} className="bio-video" controls>
                  <source src={videoSrc} type="video/mp4" />
                  Votre navigateur ne supporte pas la lecture de vidéos.
                </video>
              </div>
              <div className="video-description">
                <h3>YASSAL — Une nouvelle ère, un sanctuaire</h3>
                <p>
                  Bienvenue sur YASSAL, bien plus qu'un simple site web. Ce lieu numérique est né d'une conviction profonde : chaque musique porte en elle une vérité cachée, une nature que seul un regard attentif peut dévoiler. L'artiste A.L.P, porté par cette idée, a souhaité créer un espace où l'œuvre n'est pas seulement écoutée, mais protégée, comprise et transmise.
                </p>
                <p>
                  Ici, nous ne diffusons pas passivement des morceaux. Nous offrons un sanctuaire où le travail, la pensée et l'âme qui animent chaque titre trouvent leur juste place. YASSAL est une forteresse qui préserve l'essence du métier : celle de révéler, sans compromis, ce qui se tapit derrière les notes et les mots.
                </p>
                <p>
                  Notre mission : vous inviter à chasser ces trésors invisibles. Chaque morceau, chaque album (ENINA, YASSAL P1, YASSAL PII) est une porte ouverte sur une intimité sonore. En parcourant ces pages, vous ne vous contentez pas de consommer de la musique ; vous apprenez à voir ce qu'elle dissimule, à en extraire la matière première qui fait vibrer l'âme humaine.
                </p>
                <p>
                  Pourquoi ce site ? Parce que l'art mérite d'être gardé, non dilué. Parce que la vérité d'une œuvre ne se livre qu'à ceux qui prennent le temps de l'approcher avec respect. Parce qu'A.L.P croit que changer notre regard sur la musique, c'est aussi changer notre regard sur nous-mêmes.
                </p>
                <p>
                  Que vous soyez un familier du rap gasy ou un nouveau venu, YASSAL vous tend un miroir. Entrez, écoutez, et laissez-vous guider vers ce que vous n'aviez jamais perçu.
                </p>
                <p>
                  Bienvenue dans la nouvelle ère. Ici, chaque chanson est un secret à découvrir, et chaque écoute, une conquête.
                </p>
                <div className="video-controls">
                  <button className="video-btn" onClick={playVideo}>
                    <i className="fas fa-play"></i> Lire
                  </button>
                  <button className="video-btn" onClick={pauseVideo}>
                    <i className="fas fa-pause"></i> Pause
                  </button>
                  <button className="video-btn" onClick={toggleMute}>
                    <i className={`fas ${isMuted ? 'fa-volume-mute' : 'fa-volume-up'}`}></i> Son
                  </button>
                  <button className="video-btn" onClick={toggleFullScreen}>
                    <i className={`fas ${isFullscreen ? 'fa-compress' : 'fa-expand'}`}></i> Plein écran
                  </button>
                </div>
              </div>
            </div>
          </div>

          <button className="access-btn" onClick={goToLogin}>
            ACCÉDER AU SITE
          </button>
        </div>
      </main>
    </div>
  );
};

export default Visiteur;
