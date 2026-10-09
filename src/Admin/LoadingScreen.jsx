// src/Admin/LoadingScreen.jsx
import React from 'react';
import './LoadingScreen.css';

import loadingImage from '../assets/Images/yassal(oficiel).jpeg';

const LoadingScreen = () => {
  return (
    <div className="loading-screen">
      <div className="loading-content">
        <img src={loadingImage} alt="YASSAL Officiel" className="loading-logo" />
        <div className="spinner"></div>
        <p>Chargement de l'espace administration...</p>
      </div>
    </div>
  );
};

export default LoadingScreen;
