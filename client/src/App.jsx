import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';

// 컴포넌트 임포트
import LoginScreen from './features/auth/LoginScreen';
import LobbyScreen from './features/lobby/LobbyScreen';
import GameRoom from './features/poker-game/GameRoom';

function App() {
  const [userInfo, setUserInfo] = useState(() => {
    try {
      const saved = localStorage.getItem('holdem_user');
      return saved ? JSON.parse(saved) : null;
    } catch { 
      return null; 
    }
  });

  useEffect(() => {
    if (userInfo) {
      localStorage.setItem('holdem_user', JSON.stringify(userInfo));
    } else {
      localStorage.removeItem('holdem_user');
    }
  }, [userInfo]);

  return (
    <div className="app-wrapper">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LoginScreen setUserInfo={setUserInfo} />} />
          <Route path="/lobby" element={<LobbyScreen userInfo={userInfo} setUserInfo={setUserInfo} />} />
          <Route path="/room/:roomId" element={<GameRoom userInfo={userInfo} setUserInfo={setUserInfo} />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;