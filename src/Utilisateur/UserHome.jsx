// src/Utilisateur/UserHome.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import '../Admin/AdminMusique.css';
import './UserHomePoster.css'; // style affiche pour "Histoire de l'artiste"
import { useAuth } from '../context/AuthContext';
import ProfileSettingsPanel from '../Admin/ProfileSettingsPanel';
import bgImage from '../assets/Images/men_your_brave.jpeg'; // même fond que les autres pages
import { supabase } from '../supabaseClient';

// Artiste
import artistImage from '../assets/Images/every_day.jpeg';

// Pochette de secours (si un album n'a pas d'image). Les albums eux-mêmes
// viennent de Supabase : ce sont ceux créés/modifiés par l'admin.
import defaultAlbumCover from '../assets/Images/YASSAL.jpeg';

// Sponsors (noms corrigés)
import sponsor1 from '../assets/Images/kay_keny.jpeg';   // renommé en 6k_rio.jpg
import sponsor2 from '../assets/Images/l2g.jpeg';
import sponsor3 from '../assets/Images/gorilla_squad_mdg.jpeg';

const UserHome = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const [userPseudo, setUserPseudo] = useState(localStorage.getItem('userPseudo') || 'Utilisateur');
  const [userPhoto, setUserPhoto] = useState(localStorage.getItem('userPhoto') || 'https://cdn-icons-png.flaticon.com/512/149/149071.png');
  const [menuOpen, setMenuOpen] = useState(false); // menu latéral du header (comme la page musique)
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);

  const [selectedSponsor, setSelectedSponsor] = useState(null);

  // Albums = exactement ceux de la page musique admin (table "albums").
  // L'histoire de l'album est la colonne "description" que l'admin écrit à la
  // création ou dans "Modifier l'album".
  const [albums, setAlbums] = useState([]);
  const [albumsStatus, setAlbumsStatus] = useState('loading'); // loading | ok | error

  useEffect(() => {
    let cancelled = false;
    const loadAlbums = async () => {
      const { data, error } = await supabase
        .from('albums').select('*').order('created_at', { ascending: true });
      if (cancelled) return;
      if (error) { console.error('Erreur chargement albums :', error); setAlbumsStatus('error'); return; }
      setAlbums((data || []).map(a => ({
        id: a.id,
        title: a.title,
        year: a.year || (a.release_date ? String(new Date(a.release_date + 'T00:00:00').getFullYear()) : ''),
        releaseDate: a.release_date ? new Date(a.release_date + 'T00:00:00').toLocaleDateString('fr-FR') : '',
        cover: a.cover_url || defaultAlbumCover,
        trackCount: a.track_count || 0,
        story: a.description || '',
      })));
      setAlbumsStatus('ok');
    };
    loadAlbums();
    // Recharge au retour sur l'onglet : une modification faite par l'admin apparaît sans tout rouvrir
    const onVisible = () => { if (document.visibilityState === 'visible') loadAlbums(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const artist = {
    name: 'ALP',
    story: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`,
    bio: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`,
    sponsors: [
      { 
        name: '6k Rio', 
        logo: sponsor1,
        story: `6k Rio est un label de production musicale qui accompagne les artistes dans la création de leurs univers sonores. Grâce à leur expertise, ALP a pu donner vie à des projets audacieux comme "ENINA" et "YASSAL". Leur engagement pour la qualité et l'innovation fait d'eux un partenaire de confiance.`
      },
      { 
        name: 'CANARD', 
        logo: sponsor2,
        story: `CANARD est une marque de vêtements streetwear inspirée par la culture urbaine. Ils ont habillé ALP pour ses clips et ses concerts, apportant une touche de style et d'authenticité à chaque performance. Leur collection est un mélange de confort et d'originalité.`
      },
      { 
        name: 'Gorilla Squad', 
        logo: sponsor3,
        story: `Gorilla Squad est un collectif de beatmakers et de producteurs basé à Antananarivo. Ils ont collaboré avec ALP sur plusieurs titres, apportant des sonorités modernes et percutantes. Leur créativité sans limite a contribué à façonner le son unique de l'artiste.`
      },
    ],
  };

  return (
    <div className="admin-musique" style={{ backgroundImage: `url(${bgImage})` }}>
      {/* Header identique à celui de la page musique (menu, profil, titre) */}
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
        <div className="welcome-msg"><span className="typing">ESPACE YASSAL</span></div>
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

      {/* Contenu principal */}
      <div className="music-main" style={{ gridTemplateColumns: '1fr', maxWidth: '900px' }}>
        {/* 1. Histoire de l'artiste — style affiche de presse ancienne */}
        <section className="panel-section mobile-active poster-presse" style={{ maxHeight: 'none' }}>
          <h2 className="poster-title">
            <span className="t1">Histoire</span>
            <span className="t2">de l'artiste</span>
          </h2>

          <div className="poster-top">
            <div className="poster-badge"><b>N°1</b><small>le numéro</small></div>
            <div className="poster-director">
              <small>Directeur artistique</small>
              <strong>{artist.name}</strong>
              <small>Espace Yassal</small>
            </div>
            <div className="poster-badge"><b>N°1</b><small>le numéro</small></div>
          </div>

          <div className="poster-mid">
            <div className="poster-side">
              <b>L'artiste</b>
              <span>organe de l'univers</span>
              <span>Yassal</span>
              <span>défend la</span>
              <span>musique de</span>
              <b>{artist.name}</b>
              <b>Le récit</b>
              <span>publie</span>
            </div>

            <figure className="poster-figure">
              <img src={artistImage} alt="Artiste" />
            </figure>

            <div className="poster-side">
              <b>Lire</b>
              <span>tous</span>
              <span>les jours dans</span>
              <b>L'artiste</b>
              <span>nos renseignements</span>
              <span>très complets sur</span>
              <b>Yassal</b>
              <span>publie</span>
            </div>
          </div>

          <h3 className="poster-headline">Mon histoire</h3>
          <div className="poster-byline">par {artist.name}</div>
          <p className="poster-story">{artist.story}</p>

          <div className="poster-collab">
            <h4>Principaux collaborateurs</h4>
            <p>{artist.sponsors.map(s => s.name).join(' · ')}</p>
          </div>

          <div className="poster-bottom">
            <span className="poster-num">1</span>
            <div className="poster-end">Le récit<small>Espace Yassal</small></div>
            <span className="poster-num">1</span>
          </div>
        </section>

        {/* 2. Biographie */}
        <section className="panel-section mobile-active" style={{ maxHeight: 'none' }}>
          <h2 style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <i className="fas fa-user-circle"></i> Biographie
          </h2>
          <p style={{ lineHeight: '1.8', color: '#ddd' }}>{artist.bio}</p>
        </section>

        {/* 3. Histoires des albums */}
        <section className="panel-section mobile-active" style={{ maxHeight: 'none' }}>
          <h2 style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <i className="fas fa-compact-disc"></i> Les albums
          </h2>
          {albumsStatus === 'loading' && <p style={{ color: '#aaa' }}>Chargement des albums…</p>}
          {albumsStatus === 'error' && <p style={{ color: '#ffb3b3' }}>Impossible de charger les albums pour le moment.</p>}
          {albumsStatus === 'ok' && albums.length === 0 && <p style={{ color: '#aaa' }}>Aucun album pour le moment.</p>}
          {albums.map((album) => (
            <div
              key={album.id}
              style={{
                marginBottom: '30px',
                borderBottom: '1px solid #333',
                paddingBottom: '25px',
              }}
            >
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 120px' }}>
                  <img
                    src={album.cover}
                    alt={album.title}
                    style={{ width: '100%', borderRadius: '8px', border: '1px solid #444' }}
                  />
                </div>
                <div style={{ flex: '1', minWidth: '200px' }}>
                  <h3 style={{ color: 'var(--primary)', margin: '0 0 5px 0' }}>
                    {album.title} {album.year && <span style={{ color: '#aaa', fontWeight: 'normal' }}>({album.year})</span>}
                  </h3>
                  <p style={{ color: '#ccc', fontStyle: 'italic', marginTop: '0' }}>
                    {album.trackCount > 0 && `${album.trackCount} titre${album.trackCount > 1 ? 's' : ''}`}
                    {album.trackCount > 0 && album.releaseDate && ' • '}
                    {album.releaseDate && `Sortie le ${album.releaseDate}`}
                  </p>
                  {album.story && (
                    <p style={{ lineHeight: '1.6', color: '#ddd', whiteSpace: 'pre-line' }}>{album.story}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* 4. Remerciements avec sponsors et histoires */}
        <section className="panel-section mobile-active" style={{ maxHeight: 'none' }}>
          <h2 style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <i className="fas fa-handshake"></i> Remerciements
          </h2>
          <p style={{ color: '#ddd', marginBottom: '20px' }}>
            Nous tenons à remercier nos précieux sponsors pour leur soutien. Cliquez sur un logo pour découvrir son histoire.
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '30px',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {artist.sponsors.map((sponsor, idx) => (
              <div key={idx} style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => setSelectedSponsor(sponsor)}>
                <img
                  src={sponsor.logo}
                  alt={sponsor.name}
                  style={{
                    height: '80px',
                    width: 'auto',
                    maxWidth: '150px',
                    objectFit: 'contain',
                    filter: 'brightness(0.8)',
                    transition: 'filter 0.3s',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.filter = 'brightness(1)')}
                  onMouseOut={(e) => (e.currentTarget.style.filter = 'brightness(0.8)')}
                />
                <p style={{ color: '#aaa', marginTop: '8px', fontSize: '14px' }}>
                  {sponsor.name}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Modale pour afficher l'histoire du sponsor */}
      {selectedSponsor && (
        <div className="modal-overlay" onClick={() => setSelectedSponsor(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedSponsor(null)}>&times;</button>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <img
                src={selectedSponsor.logo}
                alt={selectedSponsor.name}
                style={{ height: '100px', width: 'auto', maxWidth: '200px', objectFit: 'contain' }}
              />
              <h3 style={{ color: 'var(--primary)', marginTop: '10px' }}>{selectedSponsor.name}</h3>
            </div>
            <div style={{ lineHeight: '1.8', color: '#ddd', padding: '10px 20px' }}>
              {selectedSponsor.story}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
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

export default UserHome;
