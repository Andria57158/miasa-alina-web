// src/Admin/AdminLoadingRedirect.jsx
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import LoadingScreen from './LoadingScreen';
import { useAuth } from '../context/AuthContext';

const AdminLoadingRedirect = () => {
  const navigate = useNavigate();
  const { setLoading } = useAuth();

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
      navigate('/admin/home');
    }, 2000); // 2 secondes de chargement
    return () => clearTimeout(timer);
  }, [navigate, setLoading]);

  return <LoadingScreen />;
};

export default AdminLoadingRedirect;
