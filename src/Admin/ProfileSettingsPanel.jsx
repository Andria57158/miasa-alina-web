// src/Admin/ProfileSettingsPanel.jsx
import React, { useState } from 'react';
import './ProfileSettingsPanel.css';
import { supabase } from '../utils/supabaseClient';

const ProfileSettingsPanel = ({
  onClose,
  userPseudo,
  setUserPseudo,
  userPhoto,
  setUserPhoto,
  onLogout // gardé si besoin, mais pas utilisé dans le formulaire seul
}) => {
  const [pseudo, setPseudo] = useState(userPseudo);
  const [storyContact, setStoryContact] = useState('');
  const [address, setAddress] = useState('Antananarivo');
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState('');

  const handleSaveProfile = async () => {
    setSaveError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expirée, reconnecte-toi.');

      const { error } = await supabase
        .from('users')
        .update({ username: pseudo })
        .eq('id', user.id);

      if (error) throw error;

      localStorage.setItem('userPseudo', pseudo);
      setUserPseudo(pseudo);
      alert('Profil mis à jour !');
      onClose();
    } catch (err) {
      setSaveError(err.message || 'Erreur lors de la sauvegarde.');
    }
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    setSaveError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expirée, reconnecte-toi.');

      const ext = file.name.split('.').pop();
      const filePath = `${user.id}-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('users')
        .update({ photo_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      localStorage.setItem('userPhoto', publicUrl);
      setUserPhoto(publicUrl);
    } catch (err) {
      setSaveError(err.message || 'Erreur lors du téléchargement de la photo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="profile-overlay" onClick={onClose}>
      <div className="profile-panel profile-panel-simple" onClick={(e) => e.stopPropagation()}>
        <div className="profile-content-simple">
          <h3><i className="fas fa-user-edit"></i> Paramètres profil</h3>
          <div className="form-group">
            <label>Photo</label>
            <div className="photo-upload">
              <img src={userPhoto} alt="Profile" />
              <input type="file" accept="image/*" onChange={handlePhotoChange} disabled={uploading} />
              {uploading && <span style={{ color: '#aaa', fontSize: '0.85rem' }}> Téléchargement...</span>}
            </div>
          </div>
          {saveError && (
            <div style={{ color: '#ff5555', fontSize: '0.9rem', marginBottom: '10px' }}>{saveError}</div>
          )}
          <div className="form-group">
            <label>Pseudo</label>
            <input type="text" value={pseudo} onChange={(e) => setPseudo(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Story contacts</label>
            <input type="text" value={storyContact} onChange={(e) => setStoryContact(e.target.value)} placeholder="ex: +261 32 00 000 00" />
          </div>
          <div className="form-group">
            <label>Adresse</label>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <button className="save-btn" onClick={handleSaveProfile}>Enregistrer</button>
          <button className="save-btn" onClick={onClose} style={{ marginLeft: '10px', background: '#333' }}>Annuler</button>
        </div>
      </div>
    </div>
  );
};

export default ProfileSettingsPanel;
