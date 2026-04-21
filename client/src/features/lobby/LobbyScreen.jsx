import React, { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import socket from '../../utils/socket';
import { SERVER_URL } from '../../utils/constants';

const LobbyScreen = ({ userInfo, setUserInfo }) => {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState('한 판 붙자!');
  const [buyIn, setBuyIn] = useState(20000);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [sb, setSb] = useState(100);
  const [bb, setBb] = useState(200);
  const [newNickname, setNewNickname] = useState('');
  const [showProfileModal, setShowProfileModal] = useState(false);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/rooms`)
      .then(res => res.json())
      .then(d => { if (d.success) setRooms(d.rooms); });
    
    socket.emit('joinLobby');
    socket.on('lobbyUpdate', (r) => setRooms(r));
    
    return () => {
      socket.off('lobbyUpdate');
    };
  }, []);

  const createRoom = async () => {
    try {
      const response = await fetch(`${SERVER_URL}/api/rooms`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ title, buyIn, maxPlayers, sb, bb }) 
      });
      const result = await response.json();
      if (result.success) {
        setShowModal(false);
        navigate(`/room/${result.room.id}`, { state: { title } });
      }
    } catch (error) { 
        alert("방 생성 실패"); 
    }
  };

  const handleChangeNickname = async () => {
    const res = await fetch(`${SERVER_URL}/api/changeNickname`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ id: userInfo.id, currentNickname: userInfo.nickname, newNickname }) 
    });
    const data = await res.json();
    if (data.success) { 
        setUserInfo({ ...userInfo, nickname: newNickname }); 
        setShowProfileModal(false); 
    } else {
        alert(data.message);
    }
  };

  const handleResetRebuy = async () => {
    const res = await fetch(`${SERVER_URL}/api/resetRebuy`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ id: userInfo.id }) 
    });
    const data = await res.json();
    if (data.success) { 
        setUserInfo({ ...userInfo, rebuyCount: 0 }); 
        alert('리바인 횟수가 초기화되었습니다.'); 
    }
  };

  if (!userInfo) return <Navigate to="/" replace />;

  return (
    <div className="lobby-container animate-fade-in">
      <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 className="title-text" style={{ margin: 0, fontSize: '1.2rem' }}>L.D.J LOBBY</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'white', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem' }}>{userInfo.nickname} 님</span>
          <span className="badge">전적: {userInfo.rebuyCount} 리바인</span>
          <button className="premium-btn danger-btn" style={{ padding: '5px 10px', fontSize: '0.8rem' }} onClick={() => { localStorage.removeItem('holdem_user'); setUserInfo(null); window.location.href = '/'; }}>로그아웃</button>
          <button className="premium-btn secondary-btn" style={{ padding: '5px 10px', fontSize: '0.8rem' }} onClick={() => setShowProfileModal(true)}>프로필</button>
          <button className="premium-btn primary-btn" style={{ padding: '5px 15px' }} onClick={() => setShowModal(true)}>+ 방 만들기</button>
        </div>
      </div>

      <div style={{ marginTop: '20px' }} className="grid-rooms">
        {rooms.map(room => (
          <div key={room.id} className="room-card glass-panel flex-col-center" style={{ padding: '20px', gap: '10px' }}>
            <h3 style={{ color: '#f39c12', fontSize: '18px', margin: 0 }}>{room.title}</h3>
            <p style={{ margin: 0, color: '#ddd' }}>인원: {room.currentPlayers} / {room.maxPlayers}</p>
            <p style={{ margin: 0, color: '#ddd' }}>SB/BB: {room.sb}/{room.bb} | 바이인: {room.buyIn}</p>
            <button className="premium-btn success-btn" onClick={() => navigate(`/room/${room.id}`, { state: { title: room.title } })}>입장하기</button>
          </div>
        ))}
        {rooms.length === 0 && <p style={{ color: 'white', gridColumn: '1/-1', textAlign: 'center' }}>생성된 방이 없습니다.</p>}
      </div>

      {showModal && (
        <div className="modal-overlay" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div className="modal-content glass-panel animate-fade-in" style={{ transform: 'none', margin: 'auto' }}>
            <h3 className="title-text" style={{ fontSize: '20px', textAlign: 'center' }}>방 설정하기</h3>
            <div className="input-group"><label>방 제목</label><input type="text" className="premium-input" value={title} onChange={e => setTitle(e.target.value)} /></div>
            <div className="input-group"><label>최대 인원 (3~8명)</label>
              <input type="number" className="premium-input" min="3" max="8" step="1" value={maxPlayers} onChange={e => setMaxPlayers(e.target.value)} />
            </div>
            <div className="input-group"><label>바이인 금액 (10,000 단위)</label>
              <input type="number" className="premium-input" min="10000" step="10000" value={buyIn} onChange={e => setBuyIn(e.target.value)} />
            </div>
            <div className="input-group"><label>Small Blind (100 단위)</label>
              <input type="number" className="premium-input" min="100" step="100" value={sb} onChange={e => setSb(Number(e.target.value))} />
            </div>
            <div className="input-group"><label>Big Blind (100 단위)</label>
              <input type="number" className="premium-input" min="200" step="100" value={bb} onChange={e => setBb(Number(e.target.value))} />
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button className="premium-btn primary-btn" style={{ flex: 1 }} onClick={createRoom}>생성 및 입장</button>
              <button className="premium-btn danger-btn" style={{ flex: 1 }} onClick={() => setShowModal(false)}>취소</button>
            </div>
          </div>
        </div>
      )}

      {showProfileModal && (
        <div className="modal-overlay" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div className="modal-content glass-panel animate-fade-in" style={{ textAlign: 'center', margin: 'auto' }}>
            <h3 className="title-text" style={{ fontSize: '20px' }}>프로필 관리</h3>
            <div className="input-group" style={{ textAlign: 'left' }}><label>새 닉네임</label><input type="text" className="premium-input" value={newNickname} onChange={e => setNewNickname(e.target.value)} /></div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '15px', flexDirection: 'column' }}>
              <button className="premium-btn primary-btn" onClick={handleChangeNickname}>닉네임 변경</button>
              <button className="premium-btn warning-btn" onClick={handleResetRebuy}>리바인 횟수 초기화</button>
              <button className="premium-btn secondary-btn" onClick={() => setShowProfileModal(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LobbyScreen;
