// src/context/AuthContext.jsx
import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null); // { id, role }

  // 1) Session Supabase
  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data?.session ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      isMounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  // 2) Rôle lu dans la table users (source de vérité)
  useEffect(() => {
    if (loading) return;
    if (!session) {
      setProfile(null);
      return;
    }
    let active = true;
    supabase
      .from('users')
      .select('role, status')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const blocked = !data || data.status === 'banni' || data.status === 'en_attente';
        setProfile({ id: session.user.id, role: blocked ? null : data.role });
      });
    return () => { active = false; };
  }, [session, loading]);

  // "ready" = session ET rôle chargés (évite les redirections trop tôt)
  const ready = !loading && (!session || profile?.id === session.user.id);
  const role = session ? (profile?.role ?? null) : null;
  const isAdmin = role === 'admin';

  const logout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    localStorage.removeItem('isAdmin');
    localStorage.removeItem('userPseudo');
    localStorage.removeItem('userPhoto');
  };

  // Gardés uniquement pour compatibilité avec Login.jsx / AdminHome.jsx
  const adminLogin = () => true;
  const adminLogout = logout;

  return (
    <AuthContext.Provider
      value={{
        session,
        role,
        isAdmin,
        ready,
        loading,
        setLoading,
        isLoggedIn: !!role,
        adminLogin,
        adminLogout,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
