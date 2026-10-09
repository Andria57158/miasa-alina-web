// src/Visiteur/Login.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';   // ✅ CORRIGÉ (avant : '../utils/supabaseClient')
import { uploadToR2 } from '../cloudflareClient';
import './Login.css';

const Login = () => {
  const navigate = useNavigate();
  const { adminLogin, setLoading } = useAuth(); // gardés pour compatibilité, mais non utilisés

  // --- Connexion ---
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // --- Mot de passe oublié ---
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMsg, setForgotMsg] = useState({ type: '', text: '' });
  const [forgotLoading, setForgotLoading] = useState(false);

  // --- Inscription ---
  const [showRegister, setShowRegister] = useState(false);
  const [registerData, setRegisterData] = useState({
    username: '',
    nom: '',
    prenom: '',
    dateNaissance: '',
    age: '',
    sexe: 'M',
    photo: null,
    pays: 'MG',
    region: '',
    ville: '',
    adresse: '',
    codePostal: '',
    telephone: '+261',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [step, setStep] = useState(1); // étape courante de l'inscription (1 à 3)
  const TOTAL_STEPS = 3;
  const [photoPreview, setPhotoPreview] = useState('');

  // Aperçu de la photo choisie
  useEffect(() => {
    if (!registerData.photo) {
      setPhotoPreview('');
      return;
    }
    const objectUrl = URL.createObjectURL(registerData.photo);
    setPhotoPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [registerData.photo]);
  const stepTitles = ['Identité', 'Localisation', 'Contact'];

  // Liste des pays
  const paysList = [
    { code: 'MG', nom: 'Madagascar', indicatif: '+261' },
    { code: 'FR', nom: 'France', indicatif: '+33' },
    { code: 'BE', nom: 'Belgique', indicatif: '+32' },
    { code: 'CH', nom: 'Suisse', indicatif: '+41' },
    { code: 'CA', nom: 'Canada', indicatif: '+1' },
    { code: 'US', nom: 'États-Unis', indicatif: '+1' },
    { code: 'UK', nom: 'Royaume-Uni', indicatif: '+44' },
    { code: 'DE', nom: 'Allemagne', indicatif: '+49' },
    { code: 'IT', nom: 'Italie', indicatif: '+39' },
    { code: 'ES', nom: 'Espagne', indicatif: '+34' },
  ];

  // Liste des régions de Madagascar
  const regionsMadagascar = [
    'Analamanga',
    'Vakinankaratra',
    'Itasy',
    'Bongolava',
    'Sofia',
    'Boeny',
    'Betsiboka',
    'Melaky',
    'Diana',
    'Sava',
    'Alaotra-Mangoro',
    'Atsinanana',
    'Analanjirofo',
    'Vatovavy',
    'Fitovinany',
    'Atsimo-Atsinanana',
    'Ihorombe',
    'Menabe',
    "Amoron'i Mania",
    'Haute Matsiatra',
    'Atsimo-Andrefana',
    'Androy',
    'Anosy',
  ];

  useEffect(() => {
    if (!showRegister) {
      document.getElementById('username')?.focus();
    }
  }, [showRegister]);

  // --- Gestion des champs inscription ---
  const handleDateChange = (e) => {
    const date = e.target.value;
    setRegisterData(prev => ({ ...prev, dateNaissance: date }));
    if (date) {
      const birthDate = new Date(date);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      setRegisterData(prev => ({ ...prev, age: age >= 0 ? age : '' }));
    } else {
      setRegisterData(prev => ({ ...prev, age: '' }));
    }
  };

  const handlePaysChange = (e) => {
    const code = e.target.value;
    const pays = paysList.find(p => p.code === code);
    const indicatif = pays ? pays.indicatif : '';
    setRegisterData(prev => ({
      ...prev,
      pays: code,
      telephone: indicatif,
      region: ''   // ← on vide la région quand on change de pays
    }));
  };

  const handleRegisterChange = (e) => {
    const { name, value, files } = e.target;
    if (name === 'photo') {
      setRegisterData(prev => ({ ...prev, photo: files[0] || null }));
    } else {
      setRegisterData(prev => ({ ...prev, [name]: value }));
    }
  };

  // --- Validation par étape ---
  const validateStep = (s) => {
    const d = registerData;
    if (s === 1) {
      if (!d.username || !d.nom || !d.prenom || !d.dateNaissance || d.age === '' || !d.sexe) {
        return 'Veuillez remplir tous les champs de cette étape.';
      }
      if (!d.photo) return 'Veuillez ajouter une photo d\'identité.';
    }
    if (s === 2) {
      if (!d.pays || !d.region || !d.ville || !d.codePostal || !d.adresse) {
        return 'Veuillez remplir tous les champs de cette étape.';
      }
    }
    return '';
  };

  const goNext = () => {
    const msg = validateStep(step);
    if (msg) {
      setRegisterError(msg);
      return;
    }
    setRegisterError('');
    setStep(prev => Math.min(prev + 1, TOTAL_STEPS));
  };

  const goPrev = () => {
    setRegisterError('');
    setStep(prev => Math.max(prev - 1, 1));
  };

  // --- Inscription avec Supabase ---
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();

    // Étapes 1 et 2 : "Suivant" (ou Entrée) passe à l'étape suivante, sans envoyer
    if (step < TOTAL_STEPS) {
      goNext();
      return;
    }

    setRegisterError('');
    setRegisterSuccess(false);
    console.log('🔵 [R1] handleRegisterSubmit démarré');

    const {
      username, nom, prenom, dateNaissance, age, sexe, photo,
      pays, region, ville, adresse, codePostal, telephone, email,
      password, confirmPassword
    } = registerData;

    // Validations
    if (!username || !nom || !prenom || !dateNaissance || !age || !sexe || !photo || !pays || !region || !ville || !adresse || !codePostal || !telephone || !email || !password) {
      setRegisterError('Tous les champs sont obligatoires (y compris la photo et le mot de passe).');
      console.log('🔴 [R] Arrêt : champ obligatoire manquant', registerData);
      return;
    }
    if (!email.includes('@')) {
      setRegisterError('Email invalide.');
      console.log('🔴 [R] Arrêt : email invalide');
      return;
    }
    if (password.length < 6) {
      setRegisterError('Le mot de passe doit contenir au moins 6 caractères.');
      console.log('🔴 [R] Arrêt : mot de passe trop court');
      return;
    }
    if (password !== confirmPassword) {
      setRegisterError('Les mots de passe ne correspondent pas.');
      console.log('🔴 [R] Arrêt : mots de passe différents');
      return;
    }
    const phoneDigits = telephone.replace(/\D/g, '');
    if (phoneDigits.length < 6) {
      setRegisterError('Numéro de téléphone invalide (trop court).');
      console.log('🔴 [R] Arrêt : téléphone trop court', telephone);
      return;
    }

    console.log('🔵 [R2] Validations OK, vérification du username...');

    // 1. Vérifier si le nom d'utilisateur est déjà pris
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('username')
      .ilike('username', username)
      .maybeSingle();

    console.log('🔵 [R2b] Résultat vérification username :', { existingUser, checkError });

    if (checkError) {
      setRegisterError('Erreur de vérification du nom d\'utilisateur.');
      console.log('🔴 [R] Arrêt : erreur checkError', checkError);
      return;
    }
    if (existingUser) {
      setRegisterError('Ce nom d\'utilisateur est déjà utilisé.');
      console.log('🔴 [R] Arrêt : username déjà pris');
      return;
    }

    console.log('🔵 [R3] Upload de la photo...');

    // 2. Upload de la photo sur Cloudflare R2
    let photoUrl = '';
    try {
      const uploaded = await uploadToR2(photo, 'avatars');
      photoUrl = uploaded.url;
    } catch (uploadError) {
      setRegisterError('Erreur lors du téléchargement de la photo : ' + uploadError.message);
      console.log('🔴 [R] Arrêt : uploadError R2', uploadError);
      return;
    }
    console.log('🔵 [R3c] photoUrl =', photoUrl);

    // 3. Créer l'utilisateur dans Supabase Auth
    console.log('🔵 [R4] Appel signUp avec email =', email);
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    console.log('🔵 [R4b] Résultat signUp :', { authData, signUpError });

    if (signUpError) {
      setRegisterError(signUpError.message);
      console.log('🔴 [R] Arrêt : signUpError', signUpError);
      return;
    }

    if (!authData.user) {
      console.log('🔴🔴 [R] PROBLÈME : signUp a réussi sans erreur MAIS authData.user est vide/null !', authData);
      setRegisterError('Compte créé mais session non initialisée (vérifie la confirmation email).');
      return;
    }

    console.log('🔵 [R5] authData.user.id =', authData.user.id, '→ insertion dans users...');

    // 4. Insérer dans la table `users`
    const { error: insertError } = await supabase
      .from('users')
      .insert([
        {
          id: authData.user.id,
          username,
          email_associated: email,
          nom,
          prenom,
          date_naissance: dateNaissance,
          age: parseInt(age, 10),
          sexe,
          pays,
          region,
          ville,
          adresse,
          code_postal: codePostal,
          telephone,
          photo_url: photoUrl,
          status: 'en_attente',
          role: 'user',
        }
      ]);

    console.log('🔵 [R5b] Résultat insert users :', { insertError });

    if (insertError) {
      setRegisterError(insertError.message);
      console.log('🔴🔴 [R] Arrêt : insertError (LA VRAIE CAUSE EST ICI SI TU LA VOIS)', insertError);
      return;
    }

    console.log('🟢 [R6] Insert users réussi ! Envoi notification admin...');

    // 5. Notifier les admins de la nouvelle demande d'inscription
    const { error: notifError } = await supabase.from('admin_notifications').insert({
      message: `Le ${username} veut être membre`,
    });

    console.log('🟢 [R6b] Résultat notification :', { notifError });

    console.log('🟢 [R7] Inscription terminée avec succès.');
    setRegisterSuccess(true);
    setRegisterError('');

    setTimeout(() => {
      setShowRegister(false);
      setRegisterData({
        username: '',
        nom: '',
        prenom: '',
        dateNaissance: '',
        age: '',
        sexe: 'M',
        photo: null,
        pays: 'MG',
        region: '',
        ville: '',
        adresse: '',
        codePostal: '',
        telephone: '+261',
        email: '',
        password: '',
        confirmPassword: ''
      });
      setRegisterSuccess(false);
      setStep(1);
      alert('✅ Inscription enregistrée ! En attente de validation par l\'administrateur.');
    }, 2000);
  };

  // --- Connexion avec Supabase (sans vérification en dur) ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    console.log('🔵 [1] handleSubmit démarré, username =', username);

    if (!username || !password) {
      setError('Veuillez remplir tous les champs');
      console.log('🔴 Arrêt : champs vides');
      return;
    }

    try {
      // 1. Récupérer l'email associé au nom d'utilisateur (recherche insensible à la casse)
      console.log('🔵 [2] Recherche du username dans la table users...');
      const { data: userData, error: lookupError } = await supabase
        .from('users')
        .select('email_associated, status, role')
        .ilike('username', username)   // ← insensible à la casse
        .maybeSingle();

      console.log('🔵 [2b] Résultat recherche :', { userData, lookupError });

      if (lookupError || !userData) {
        setError('Nom d\'utilisateur inconnu');
        console.log('🔴 Arrêt : utilisateur introuvable', lookupError);
        return;
      }

      // 2. Connexion avec Supabase Auth
      console.log('🔵 [3] Tentative signInWithPassword avec email =', userData.email_associated);
      const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
        email: userData.email_associated,
        password,
      });

      console.log('🔵 [3b] Résultat signInWithPassword :', { authData, signInError });

      if (signInError) {
        setError('Mot de passe incorrect');
        console.log('🔴 Arrêt : signInWithPassword a échoué', signInError);
        return;
      }

      // 3. Vérifier le statut
      console.log('🔵 [4] status =', userData.status, '| role =', userData.role);
      if (userData.status === 'en_attente') {
        setError('Votre compte est en attente de validation par un administrateur.');
        console.log('🔴 Arrêt : status en_attente');
        await supabase.auth.signOut();
        return;
      }
      if (userData.status === 'banni') {
        setError('Votre compte a été banni. Contactez l\'administrateur.');
        console.log('🔴 Arrêt : status banni');
        await supabase.auth.signOut();
        return;
      }

      // 4. Stocker les infos dans localStorage
      localStorage.setItem('userPseudo', username);
      const { data: profile } = await supabase
        .from('users')
        .select('photo_url')
        .eq('id', authData.user.id)
        .single();
      localStorage.setItem('userPhoto', profile?.photo_url || 'https://cdn-icons-png.flaticon.com/512/149/149071.png');

      // 5. Redirection selon le rôle
      console.log('🟢 [5] Tout est bon, redirection avec role =', userData.role);
      if (userData.role === 'admin') {
        adminLogin(username, password); // synchronise isAdmin dans AuthContext
        console.log('🟢 [6] navigate vers /admin/home');
        navigate('/admin/home');
      } else {
        console.log('🟢 [6] navigate vers /user/home');
        navigate('/user/home');
      }

    } catch (err) {
      setError('Erreur inattendue. Veuillez réessayer.');
      console.log('🔴🔴 EXCEPTION ATTRAPÉE :', err);
    }
  };

  // --- Mot de passe oublié : envoie une demande à l'admin (fonction SQL request_password_reset) ---
  const closeForgot = () => {
    setShowForgot(false);
    setForgotEmail('');
    setForgotMsg({ type: '', text: '' });
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setForgotMsg({ type: '', text: '' });

    const email = forgotEmail.trim();
    if (!email || !email.includes('@')) {
      setForgotMsg({ type: 'error', text: 'Entrez une adresse email valide.' });
      return;
    }

    setForgotLoading(true);
    const { data: result, error: rpcError } = await supabase.rpc('request_password_reset', { p_email: email });
    setForgotLoading(false);

    if (rpcError) {
      console.error('request_password_reset :', rpcError);
      setForgotMsg({ type: 'error', text: 'Erreur : ' + rpcError.message });
      return;
    }

    const messages = {
      ok: { type: 'success', text: "✅ Demande envoyée à l'administrateur. Vous recevrez un email avec un lien dès qu'elle sera validée." },
      invalid: { type: 'error', text: 'Entrez une adresse email valide.' },
      not_found: { type: 'error', text: "Cet email n'est pas enregistré." },
      not_allowed: { type: 'error', text: "Ce compte ne peut pas demander de réinitialisation (en attente ou banni)." },
      already_pending: { type: 'error', text: "Une demande est déjà en attente de validation par l'administrateur." },
    };
    setForgotMsg(messages[result] || { type: 'error', text: 'Réponse inattendue. Réessayez.' });
  };

  // --- Rendu ---
  return (
    <div className="login-container">
      <div className="login-box">
        <h1>YASSAL · Accès Privé</h1>

        {showForgot ? (
          // Formulaire "mot de passe oublié"
          <>
            <form onSubmit={handleForgotPassword}>
              <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '14px', textAlign: 'center' }}>
                Entrez l'email de votre compte. L'administrateur validera votre demande, puis un lien de
                réinitialisation vous sera envoyé par email.
              </p>
              <div className="input-group">
                <input
                  type="email"
                  placeholder="Votre email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              {forgotMsg.text && (
                <div className={forgotMsg.type === 'success' ? 'success-message' : 'error-message'}>
                  {forgotMsg.text}
                </div>
              )}
              <button type="submit" className="login-btn" disabled={forgotLoading}>
                {forgotLoading ? 'ENVOI…' : 'ENVOYER LA DEMANDE'}
              </button>
            </form>
            <div className="separator"><span>RETOUR</span></div>
            <button className="register-btn" onClick={closeForgot}>
              ← Retour à la connexion
            </button>
          </>
        ) : !showRegister ? (
          // Formulaire de connexion
          <>
            <form onSubmit={handleSubmit}>
              <div className="input-group">
                <input
                  type="text"
                  id="username"
                  placeholder="Nom d'utilisateur"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
              <div className="input-group password-group">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  placeholder="Mot de passe"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="toggle-password"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
              {error && <div className="error-message">{error}</div>}
              <button type="submit" className="login-btn">SE CONNECTER</button>
            </form>
            <div className="separator"><span>OU</span></div>
            <button className="register-btn" onClick={() => setShowRegister(true)}>
              CRÉER UN COMPTE
            </button>
            <div className="footer-links">
              <Link to="/visiteur">← Retour à l'accueil</Link>
              <a href="#forgot" onClick={(e) => { e.preventDefault(); setShowForgot(true); }}>Mot de passe oublié ?</a>
            </div>
          </>
        ) : (
          // Formulaire d'inscription
          <>
            <form onSubmit={handleRegisterSubmit} className="register-form">
              {/* Indicateur d'étapes */}
              <div className="steps-indicator">
                {stepTitles.map((title, i) => (
                  <div
                    key={title}
                    className={`step-item ${step === i + 1 ? 'active' : ''} ${step > i + 1 ? 'done' : ''}`}
                  >
                    <span className="step-dot">{step > i + 1 ? '✓' : i + 1}</span>
                    <span className="step-title">{title}</span>
                  </div>
                ))}
              </div>

              {/* Étape 1 : Identité */}
              {step === 1 && (
              <fieldset>
                <legend>Identité et compte</legend>
                <div className="input-group file-group">
                  <label htmlFor="photoIdentite" className="file-label">
                    <span className="file-label-text">📷 Photo d'identité</span>
                    <input
                      type="file"
                      id="photoIdentite"
                      name="photo"
                      accept="image/*"
                      onChange={handleRegisterChange}
                    />
                  </label>
                  {photoPreview && (
                    <div className="photo-preview">
                      <img src={photoPreview} alt="Aperçu de la photo" />
                    </div>
                  )}
                  {registerData.photo && (
                    <div className="file-name">
                      Fichier sélectionné : {registerData.photo.name}
                    </div>
                  )}
                </div>
                <div className="input-group">
                  <input
                    type="text"
                    name="username"
                    placeholder="Nom d'utilisateur (unique)"
                    value={registerData.username}
                    onChange={handleRegisterChange}
                    required
                  />
                </div>
                <div className="form-row">
                  <div className="input-group">
                    <input
                      type="text"
                      name="nom"
                      placeholder="Nom"
                      value={registerData.nom}
                      onChange={handleRegisterChange}
                      required
                    />
                  </div>
                  <div className="input-group">
                    <input
                      type="text"
                      name="prenom"
                      placeholder="Prénom"
                      value={registerData.prenom}
                      onChange={handleRegisterChange}
                      required
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="input-group">
                    <input
                      type="date"
                      name="dateNaissance"
                      placeholder="Date de naissance"
                      value={registerData.dateNaissance}
                      onChange={handleDateChange}
                      required
                    />
                  </div>
                  <div className="input-group">
                    <input
                      type="number"
                      name="age"
                      placeholder="Âge"
                      value={registerData.age}
                      readOnly
                      style={{ backgroundColor: '#1a1a1a', color: '#aaa' }}
                    />
                  </div>
                  <div className="input-group">
                    <select
                      name="sexe"
                      value={registerData.sexe}
                      onChange={handleRegisterChange}
                      required
                    >
                      <option value="M">Masculin</option>
                      <option value="F">Féminin</option>
                      <option value="Autre">Autre</option>
                    </select>
                  </div>
                </div>
              </fieldset>
              )}

              {/* Étape 2 : Localisation */}
              {step === 2 && (
              <fieldset>
                <legend>Localisation</legend>
                <div className="form-row">
                  <div className="input-group">
                    <select
                      name="pays"
                      value={registerData.pays}
                      onChange={handlePaysChange}
                      required
                    >
                      {paysList.map(p => (
                        <option key={p.code} value={p.code}>
                          {p.nom} ({p.indicatif})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    {registerData.pays === 'MG' ? (
                      <select
                        name="region"
                        value={registerData.region}
                        onChange={handleRegisterChange}
                        required
                      >
                        <option value="">-- Sélectionnez une région --</option>
                        {regionsMadagascar.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        name="region"
                        placeholder="Région / État / Province"
                        value={registerData.region}
                        onChange={handleRegisterChange}
                        required
                      />
                    )}
                  </div>
                </div>
                <div className="form-row">
                  <div className="input-group">
                    <input
                      type="text"
                      name="ville"
                      placeholder="Ville"
                      value={registerData.ville}
                      onChange={handleRegisterChange}
                      required
                    />
                  </div>
                  <div className="input-group">
                    <input
                      type="text"
                      name="codePostal"
                      placeholder="Code postal"
                      value={registerData.codePostal}
                      onChange={handleRegisterChange}
                      required
                    />
                  </div>
                </div>
                <div className="input-group">
                  <input
                    type="text"
                    name="adresse"
                    placeholder="Adresse"
                    value={registerData.adresse}
                    onChange={handleRegisterChange}
                    required
                  />
                </div>
              </fieldset>
              )}

              {/* Étape 3 : Contact et sécurité */}
              {step === 3 && (
              <fieldset>
                <legend>Contact et sécurité</legend>
                <div className="form-row">
                  <div className="input-group">
                    <input
                      type="tel"
                      name="telephone"
                      placeholder="Téléphone (indicatif inclus)"
                      value={registerData.telephone}
                      onChange={handleRegisterChange}
                      required
                    />
                  </div>
                  <div className="input-group">
                    <input
                      type="email"
                      name="email"
                      placeholder="Email (identifiant du compte)"
                      value={registerData.email}
                      onChange={handleRegisterChange}
                      required
                    />
                  </div>
                </div>
                <div className="input-group password-group">
                  <input
                    type={showRegisterPassword ? 'text' : 'password'}
                    name="password"
                    placeholder="Mot de passe (au moins 6 caractères)"
                    value={registerData.password}
                    onChange={handleRegisterChange}
                    required
                    minLength="6"
                  />
                  <button
                    type="button"
                    className="toggle-password"
                    onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                  >
                    <i className={`fas ${showRegisterPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </button>
                </div>
                <div className="input-group password-group">
                  <input
                    type={showRegisterPassword ? 'text' : 'password'}
                    name="confirmPassword"
                    placeholder="Confirmer le mot de passe"
                    value={registerData.confirmPassword}
                    onChange={handleRegisterChange}
                    required
                    minLength="6"
                  />
                  <button
                    type="button"
                    className="toggle-password"
                    onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                  >
                    <i className={`fas ${showRegisterPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </button>
                </div>
              </fieldset>
              )}

              {registerError && <div className="error-message">{registerError}</div>}
              {registerSuccess && <div className="success-message">✅ Inscription enregistrée ! En attente de validation.</div>}

              <div className="step-buttons">
                {step > 1 && (
                  <button type="button" className="register-btn step-prev" onClick={goPrev}>
                    ← PRÉCÉDENT
                  </button>
                )}
                {step < TOTAL_STEPS ? (
                  <button key="next" type="submit" className="login-btn">SUIVANT →</button>
                ) : (
                  <button key="submit" type="submit" className="login-btn">S'INSCRIRE</button>
                )}
              </div>
            </form>

            <div className="separator"><span>RETOUR</span></div>
            <button className="register-btn" onClick={() => { setShowRegister(false); setStep(1); setRegisterError(''); }}>
              ← Retour à la connexion
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default Login;
