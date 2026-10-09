// src/App.jsx
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { PlayerProvider } from './context/PlayerContext';
import ProtectedRoute from './components/ProtectedRoute';

// Pages visiteur
import Visiteur from './Visiteur/Visiteur';
import Login from './Visiteur/Login';

// Pages admin
import AdminLoadingRedirect from './Admin/AdminLoadingRedirect';
import AdminHome from './Admin/AdminHome';
import AdminMusique from './Admin/AdminMusique';
import AdminUsers from './Admin/AdminUsers';
import AdminVip from './Admin/AdminVip';

// Pages utilisateur
import UserHome from './Utilisateur/UserHome';
import UserMusique from './Utilisateur/UserMusique';
import UserVip from './Utilisateur/UserVip';

// Raccourcis : un espace = un rôle
const Admin = ({ children }) => <ProtectedRoute allow="admin">{children}</ProtectedRoute>;
const User = ({ children }) => <ProtectedRoute allow="user">{children}</ProtectedRoute>;

function App() {
  return (
    <AuthProvider>
      {/* PlayerProvider est monté une seule fois, au-dessus de <Routes> :
          la musique continue de jouer quand on change de page. */}
      <PlayerProvider>
        <BrowserRouter>
          <Routes>
            {/* ---------- Routes visiteur ---------- */}
            <Route path="/" element={<Visiteur />} />
            <Route path="/visiteur" element={<Visiteur />} />
            <Route path="/login" element={<Login />} />

            {/* ---------- Routes Admin (rôle admin uniquement) ---------- */}
            <Route path="/admin/loading" element={<AdminLoadingRedirect />} />
            <Route path="/admin/home" element={<Admin><AdminHome /></Admin>} />
            <Route path="/admin/musique" element={<Admin><AdminMusique /></Admin>} />
            <Route path="/admin/users" element={<Admin><AdminUsers /></Admin>} />
            <Route path="/admin/vip" element={<Admin><AdminVip /></Admin>} />

            {/* ---------- Routes Utilisateur (rôle user uniquement) ---------- */}
            <Route path="/user" element={<Navigate to="/user/home" replace />} />
            <Route path="/user/home" element={<User><UserHome /></User>} />
            <Route path="/user/musique" element={<User><UserMusique /></User>} />
            <Route path="/user/vip" element={<User><UserVip /></User>} />

            {/* Toute autre URL */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
      </PlayerProvider>
    </AuthProvider>
  );
}

export default App;
