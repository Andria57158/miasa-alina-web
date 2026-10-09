// src/components/ProtectedRoute.jsx
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * allow = 'admin' | 'user'
 * - non connecté / banni / en attente -> /login
 * - mauvais espace -> renvoyé vers SON propre espace
 */
export default function ProtectedRoute({ children, allow }) {
  const { session, role, ready } = useAuth();

  if (!ready) return null; // tu peux mettre un loader ici

  if (!session || !role) return <Navigate to="/login" replace />;

  if (allow && role !== allow) {
    return <Navigate to={role === 'admin' ? '/admin/home' : '/user/home'} replace />;
  }

  return children;
}
