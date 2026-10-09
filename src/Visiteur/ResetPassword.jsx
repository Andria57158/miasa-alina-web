// src/Visiteur/ResetPassword.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import './Login.css';

const ResetPassword = () => {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState('');

  useEffect(() => {
    let active = true;

    // Supabase lit le lien (#access_token=...&type=recovery) et ouvre une session temporaire.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && active) {
        setReady(true);
        setChecking(false);
      }
    });

    // Au cas où l'évènement est passé avant que ce composant soit monté
    supabase.auth.getSession().then(({ data }) => {
      if (active && data?.session) setReady(true);
    });

    // Récupère le nom d'utilisateur du compte concerné pour l'afficher
    const loadUsername = async (userId) => {
      const { data } = await supabase.from('users').select('username').eq('id', userId).maybeSingle();
      if (active && data?.username) setUsername(data.username);
    };
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) loadUsername(data.user.id);
    });

    // Si rien après 3 s : lien invalide ou expiré
    const timer = setTimeout(() => active && setChecking(false), 3000);

    return () => {
      active = false;
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg('');
    if (pwd.length < 6) return setMsg('Le mot de passe doit contenir au moins 6 caractères.');
    if (pwd !== confirm) return setMsg('Les mots de passe ne correspondent pas.');

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setSaving(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    await supabase.auth.signOut();
    setDone(true);
    setTimeout(() => navigate('/login'), 2000);
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>YASSAL · Nouveau mot de passe</h1>

        {done ? (
          <div className="success-message">
            ✅ Mot de passe modifié. Redirection vers la connexion…
          </div>
        ) : checking && !ready ? (
          <p style={{ textAlign: 'center', color: '#aaa' }}>Vérification du lien…</p>
        ) : !ready ? (
          <>
            <div className="error-message">
              Lien invalide ou expiré. Refaites une demande depuis la page de connexion.
            </div>
            <button className="register-btn" onClick={() => navigate('/login')}>
              ← Retour à la connexion
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            {username && (
              <p style={{ textAlign: 'center', color: '#ccc', marginBottom: '14px' }}>
                Votre nom d'utilisateur : <strong>{username}</strong>
              </p>
            )}
            <div className="input-group password-group">
              <input
                type={showPwd ? 'text' : 'password'}
                placeholder="Nouveau mot de passe (6 caractères min.)"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                minLength="6"
                autoFocus
                required
              />
              <button type="button" className="toggle-password" onClick={() => setShowPwd(!showPwd)}>
                <i className={`fas ${showPwd ? 'fa-eye-slash' : 'fa-eye'}`}></i>
              </button>
            </div>
            <div className="input-group password-group">
              <input
                type={showPwd ? 'text' : 'password'}
                placeholder="Confirmer le mot de passe"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength="6"
                required
              />
            </div>
            {msg && <div className="error-message">{msg}</div>}
            <button type="submit" className="login-btn" disabled={saving}>
              {saving ? 'ENREGISTREMENT…' : 'VALIDER'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
