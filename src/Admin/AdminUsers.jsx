// src/Admin/AdminUsers.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../utils/supabaseClient';
import './AdminUsers.css';
import bgImage from '../assets/Images/men_your_brave.jpeg';

const AdminUsers = () => {
  const navigate = useNavigate();
  const { logout, profile, user } = useAuth();

  // Infos du header
  const userPseudo = profile?.username || 'KILO';
  const userPhoto = user?.user_metadata?.avatar || 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [usersOnline, setUsersOnline] = useState(24);

  // États métiers
  const [pending, setPending] = useState([]);
  const [validated, setValidated] = useState([]);
  const [banned, setBanned] = useState([]);
  const [resetRequests, setResetRequests] = useState([]);
  const [blacklist, setBlacklist] = useState([]);
  const [tab, setTab] = useState('pending');
  const [notifications, setNotifications] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => setUsersOnline(Math.floor(Math.random() * 36) + 15), 10000);
    return () => clearInterval(interval);
  }, []);

  const pushNotification = (message) => {
    setNotifications((prev) => [
      { id: `${Date.now()}-${Math.random()}`, message, date: new Date().toLocaleTimeString() },
      ...prev,
    ].slice(0, 30));
  };

  // Chargement des données
  const loadAll = useCallback(async () => {
    // En attente
    const { data: pendingData } = await supabase
      .from('users')
      .select('*')
      .eq('status', 'en_attente')
      .order('created_at', { ascending: false });
    setPending(pendingData || []);

    // Validés — la table "users" ne contient jamais l'admin (table "admins" séparée)
    const { data: validData } = await supabase
      .from('users')
      .select('*')
      .eq('status', 'valide')
      .order('username');
    setValidated(validData || []);

    // Bannis
    const { data: bannedData } = await supabase
      .from('users')
      .select('*')
      .eq('status', 'banni')
      .order('username');
    setBanned(bannedData || []);

    // Demandes OTP (table otp_requests)
    const { data: requestsData } = await supabase
      .from('otp_requests')
      .select('*, profiles!user_id(username, email_associated, otp_count)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setResetRequests(requestsData || []);

    // Blacklist
    const { data: blacklistData } = await supabase
      .from('email_blacklist')
      .select('*')
      .order('created_at', { ascending: false });
    setBlacklist(blacklistData || []);

    // Notifications persistées (survivent au rechargement de la page)
    const { data: notifData } = await supabase
      .from('admin_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);
    if (notifData) {
      setNotifications(
        notifData.map((n) => ({
          id: n.id,
          message: n.message,
          date: new Date(n.created_at).toLocaleTimeString(),
        }))
      );
    }
  }, []);

  useEffect(() => {
    loadAll();

    const channel = supabase
      .channel('admin-users')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'users' }, () => loadAll())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, () => loadAll())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'otp_requests' }, () => loadAll())
      // Les messages ("X veut être membre", demande OTP, etc.) sont créés côté
      // base de données par des triggers (voir supabase_schema.sql) et arrivent
      // ici en direct + sont conservés après rechargement de la page.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'admin_notifications' }, (payload) => {
        pushNotification(payload.new.message);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadAll]);

  // Suppression sécurisée d'un compte auth (via Edge Function).
  // ⚠️ supabase.auth.admin.* ne fonctionne JAMAIS depuis le navigateur (il faut la
  // clé service_role, qui ne doit jamais être exposée côté client). On passe donc
  // par l'Edge Function "admin-actions" qui s'exécute côté serveur avec cette clé.
  const deleteAuthUser = async (userId) => {
    const { data, error } = await supabase.functions.invoke('admin-actions', {
      body: { action: 'deleteUser', userId },
    });
    if (error) throw error;
    return data;
  };

  // --- Actions ---
  const handleAccept = async (user) => {
    setBusyId(user.id);
    const { error } = await supabase
      .from('users')
      .update({ status: 'valide' })
      .eq('id', user.id);
    if (!error) {
      pushNotification(`✅ Inscription de ${user.username} acceptée.`);
    }
    setBusyId(null);
    loadAll();
  };

  const handleReject = async (user) => {
    if (!window.confirm(`Refuser et supprimer définitivement le compte de ${user.username} ?`)) return;
    setBusyId(user.id);
    try {
      await deleteAuthUser(user.id);
      pushNotification(`❌ Inscription de ${user.username} refusée et supprimée.`);
    } catch (err) {
      console.error(err);
      pushNotification(`⚠️ Échec de la suppression de ${user.username}.`);
    }
    setBusyId(null);
    loadAll();
  };

  const handleToggleBan = async (user) => {
    const newStatus = user.status === 'banni' ? 'valide' : 'banni';
    if (!window.confirm(`${newStatus === 'banni' ? 'Bannir' : 'Débannir'} ${user.username} ?`)) return;
    setBusyId(user.id);
    await supabase.from('users').update({ status: newStatus }).eq('id', user.id);
    pushNotification(`${newStatus === 'banni' ? '🚫' : '✅'} ${user.username} ${newStatus === 'banni' ? 'banni' : 'débanni'}.`);
    setBusyId(null);
    loadAll();
  };

  const handleAuthorizeReset = async (request) => {
    setBusyId(request.id);
    try {
      const user = request.profiles;
      if (!user) throw new Error('Utilisateur introuvable');
      const newCount = (user.otp_count || 0) + 1;

      if (newCount > 3) {
        await supabase.from('users').update({ status: 'banni' }).eq('id', request.user_id);
        await supabase.from('otp_requests').update({ status: 'rejected' }).eq('id', request.id);
        pushNotification(`🚫 ${user.username} banni : limite de 3 demandes OTP dépassée.`);
      } else {
        await supabase.from('users').update({ otp_count: newCount }).eq('id', request.user_id);
        await supabase.from('otp_requests').update({ status: 'approved' }).eq('id', request.id);
        pushNotification(`📧 OTP envoyé à ${user.username} (tentative ${newCount}/3).`);
      }
    } catch (err) {
      console.error(err);
      pushNotification("❌ Échec de l'autorisation OTP.");
    }
    setBusyId(null);
    loadAll();
  };

  const handleRejectReset = async (request) => {
    if (!window.confirm('Rejeter la demande et supprimer définitivement ce compte ?')) return;
    setBusyId(request.id);
    const user = request.profiles;
    if (user) {
      await deleteAuthUser(user.id);
      await supabase.from('email_blacklist').insert({
        email: user.email_associated,
        reason: 'Demande OTP rejetée'
      });
    }
    await supabase.from('otp_requests').update({ status: 'rejected' }).eq('id', request.id);
    pushNotification(`❌ Demande OTP rejetée, compte ${user?.username || ''} supprimé.`);
    setBusyId(null);
    loadAll();
  };

  const handleLogout = () => {
    if (window.confirm('Voulez-vous vraiment vous déconnecter ?')) {
      logout();
      navigate('/login');
    }
  };

  // Afficher les détails d'un utilisateur (modale)
  // Toutes les infos (nom, téléphone, adresse, etc.) sont maintenant stockées
  // directement dans la table "profiles" — plus besoin d'appel privilégié.
  const showUserDetails = (user) => {
    setSelectedUser({ ...user, metadata: user });
  };

  const closeUserDetails = () => setSelectedUser(null);

  // --- Rendu des onglets ---
  const getStatusBadge = (status) => {
    switch (status) {
      case 'valide': return <span className="badge valid">✅ Validé</span>;
      case 'en_attente': return <span className="badge pending">⏳ En attente</span>;
      case 'banni': return <span className="badge banned">🚫 Banni</span>;
      default: return <span className="badge">{status}</span>;
    }
  };

  const renderPending = () => (
    <div className="panel-content">
      <h2><i className="fas fa-user-clock"></i> Inscriptions en attente</h2>
      {pending.length === 0 && <div className="empty-message">Aucune demande en attente</div>}
      {pending.map((u) => (
        <div className="admin-card" key={u.id}>
          <div className="admin-card-info">
            <strong>{u.username}</strong>
            <span>{u.email_associated}</span>
            <span style={{ fontSize: '12px', color: '#888' }}>
              {u.created_at ? new Date(u.created_at).toLocaleDateString() : ''}
            </span>
            <button className="detail-btn" onClick={() => showUserDetails(u)}>
              <i className="fas fa-eye"></i> Voir détails
            </button>
          </div>
          <div className="admin-card-actions">
            <button className="btn-accept" disabled={busyId === u.id} onClick={() => handleAccept(u)}>
              <i className="fas fa-check"></i>
              <span className="btn-text"> Accepter</span>
            </button>
            <button className="btn-reject" disabled={busyId === u.id} onClick={() => handleReject(u)}>
              <i className="fas fa-times"></i>
              <span className="btn-text"> Refuser</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  const renderValidated = () => (
    <div className="panel-content">
      <h2><i className="fas fa-user-check"></i> Membres validés ({validated.length})</h2>
      {validated.length === 0 && <div className="empty-message">Aucun membre validé</div>}
      {validated.map((u) => (
        <div className="admin-card" key={u.id}>
          <div className="admin-card-info">
            <strong>{u.username}</strong>
            <span>{u.email_associated}</span>
            <span className="otp-badge">OTP {u.otp_count || 0}/3</span>
            <button className="detail-btn" onClick={() => showUserDetails(u)}>
              <i className="fas fa-eye"></i> Voir détails
            </button>
          </div>
          <div className="admin-card-actions">
            <button
              className="btn-reject"
              style={{ background: 'rgba(255, 165, 0, 0.2)', color: '#ffaa00', borderColor: '#ffaa00' }}
              disabled={busyId === u.id}
              onClick={() => handleToggleBan(u)}
            >
              <i className="fas fa-ban"></i>
              <span className="btn-text"> Bannir</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  const renderResetRequests = () => (
    <div className="panel-content">
      <h2><i className="fas fa-key"></i> Mot de passe oublié</h2>
      {resetRequests.length === 0 && <div className="empty-message">Aucune demande</div>}
      {resetRequests.map((r) => (
        <div className="admin-card" key={r.id}>
          <div className="admin-card-info">
            <strong>{r.profiles?.username}</strong>
            <span>{r.profiles?.email_associated}</span>
            <span className="otp-badge">OTP {r.profiles?.otp_count || 0}/3</span>
          </div>
          <div className="admin-card-actions">
            <button className="btn-accept" disabled={busyId === r.id} onClick={() => handleAuthorizeReset(r)}>
              <i className="fas fa-paper-plane"></i>
              <span className="btn-text"> Autoriser</span>
            </button>
            <button className="btn-reject" disabled={busyId === r.id} onClick={() => handleRejectReset(r)}>
              <i className="fas fa-times"></i>
              <span className="btn-text"> Rejeter</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  const renderBanned = () => (
    <div className="panel-content">
      <h2><i className="fas fa-ban"></i> Comptes bannis ({banned.length})</h2>
      {banned.map((u) => (
        <div className="admin-card" key={u.id}>
          <div className="admin-card-info">
            <strong>{u.username}</strong>
            <span>{u.email_associated}</span>
            <button className="detail-btn" onClick={() => showUserDetails(u)}>
              <i className="fas fa-eye"></i> Voir détails
            </button>
          </div>
          <div className="admin-card-actions">
            <button
              className="btn-accept"
              disabled={busyId === u.id}
              onClick={() => handleToggleBan(u)}
            >
              <i className="fas fa-undo"></i>
              <span className="btn-text"> Débannir</span>
            </button>
          </div>
        </div>
      ))}
      <h2 style={{ marginTop: '25px' }}><i className="fas fa-envelope-slash"></i> E-mails bloqués ({blacklist.length})</h2>
      {blacklist.map((b) => (
        <div className="admin-card" key={b.email}>
          <div className="admin-card-info">
            <strong>{b.email}</strong>
            <span>{b.reason || 'Blacklisté'}</span>
          </div>
        </div>
      ))}
    </div>
  );

  const renderNotifications = () => (
    <div className="panel-content">
      <h2><i className="fas fa-bell"></i> Notifications</h2>
      {notifications.length === 0 && <div className="empty-message">Aucune notification</div>}
      {notifications.map((n) => (
        <div className="notification-item" key={n.id}>
          <div className="message">{n.message}</div>
          <div className="date">{n.date}</div>
        </div>
      ))}
    </div>
  );

  // --- Modale de détails utilisateur ---
  const renderUserDetailsModal = () => {
    if (!selectedUser) return null;
    const { metadata } = selectedUser;
    return (
      <div className="modal-overlay" onClick={closeUserDetails}>
        <div className="modal-content user-details-modal" onClick={(e) => e.stopPropagation()}>
          <button className="modal-close" onClick={closeUserDetails}>&times;</button>
          <h3 style={{ color: '#E22134' }}>👤 Détails de {selectedUser.username}</h3>
          <div className="user-details-grid">
            <div><strong>Nom d'utilisateur :</strong> {selectedUser.username}</div>
            <div><strong>E-mail :</strong> {selectedUser.email_associated}</div>
            <div><strong>Statut :</strong> {getStatusBadge(selectedUser.status)}</div>
            <div><strong>Rôle :</strong> {selectedUser.role || 'user'}</div>
            <div><strong>OTP Count :</strong> {selectedUser.otp_count || 0}/3</div>
            <div><strong>Date d'inscription :</strong> {selectedUser.created_at ? new Date(selectedUser.created_at).toLocaleDateString() : 'N/A'}</div>
            {metadata && (
              <>
                <div><strong>Nom :</strong> {metadata.nom || 'N/A'}</div>
                <div><strong>Prénom :</strong> {metadata.prenom || 'N/A'}</div>
                <div><strong>Date de naissance :</strong> {metadata.date_naissance || 'N/A'}</div>
                <div><strong>Sexe :</strong> {metadata.sexe || 'N/A'}</div>
                <div><strong>Pays :</strong> {metadata.pays || 'N/A'}</div>
                <div><strong>Région :</strong> {metadata.region || 'N/A'}</div>
                <div><strong>Adresse :</strong> {metadata.adresse || 'N/A'}</div>
                <div><strong>Code postal :</strong> {metadata.code_postal || 'N/A'}</div>
                <div><strong>Téléphone :</strong> {metadata.telephone || 'N/A'}</div>
              </>
            )}
          </div>
          <div className="modal-actions">
            <button className="btn-primary" onClick={closeUserDetails}>Fermer</button>
          </div>
        </div>
      </div>
    );
  };

  // --- Rendu principal ---
  return (
    <div className="admin-users" style={{ backgroundImage: `url(${bgImage})` }}>
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
        <div className="welcome-msg"><span className="typing">GESTION DES UTILISATEURS</span></div>
        {menuOpen && (
          <div className="side-menu">
            <div className="menu-item" onClick={() => { setProfileSettingsOpen(true); setMenuOpen(false); }}>
              <i className="fas fa-user-circle"></i> Profil
            </div>
            <div className="menu-item" onClick={() => { alert('Sécurité à venir'); setMenuOpen(false); }}>
              <i className="fas fa-shield-alt"></i> Sécurité
            </div>
            <div className="menu-item" onClick={handleLogout}>
              <i className="fas fa-sign-out-alt"></i> Déconnexion
            </div>
          </div>
        )}
      </header>

      <nav className="admin-tabs">
        <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>
          En attente {pending.length > 0 && <span className="tab-badge">{pending.length}</span>}
        </button>
        <button className={tab === 'validated' ? 'active' : ''} onClick={() => setTab('validated')}>
          Validés
        </button>
        <button className={tab === 'reset' ? 'active' : ''} onClick={() => setTab('reset')}>
          Mdp oublié {resetRequests.length > 0 && <span className="tab-badge">{resetRequests.length}</span>}
        </button>
        <button className={tab === 'banned' ? 'active' : ''} onClick={() => setTab('banned')}>Bannis</button>
        <button className={tab === 'notifications' ? 'active' : ''} onClick={() => setTab('notifications')}>
          Notifications {notifications.length > 0 && <span className="tab-badge">{notifications.length}</span>}
        </button>
      </nav>

      <main className="main-content">
        {tab === 'pending' && renderPending()}
        {tab === 'validated' && renderValidated()}
        {tab === 'reset' && renderResetRequests()}
        {tab === 'banned' && renderBanned()}
        {tab === 'notifications' && renderNotifications()}
      </main>

      {/* Modale détails utilisateur */}
      {renderUserDetailsModal()}

      <footer className="admin-footer">
        <div className="footer-nav">
          <button className="foot-icon" onClick={() => navigate('/admin/users')}>
            <i className="fas fa-user-friends"></i>
            <span className="users-badge">{usersOnline}</span>
          </button>
          <button className="foot-icon" onClick={() => navigate('/admin/home')}>
            <i className="fas fa-home"></i>
          </button>
          <button className="foot-icon" onClick={() => navigate('/admin/musique')}>
            <i className="fas fa-headphones"></i>
          </button>
          <button className="foot-icon" onClick={() => navigate('/admin/vip')}>
            <i className="fas fa-crown"></i>
          </button>
        </div>
      </footer>
    </div>
  );
};

export default AdminUsers;
