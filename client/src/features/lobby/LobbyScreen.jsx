import React, { useState, useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import socket from '../../utils/socket';
import { SERVER_URL } from '../../utils/constants';
import SessionModal from './SessionModal';

const LobbyScreen = ({ userInfo, setUserInfo }) => {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState('한 판 붙자!');
  const [buyIn, setBuyIn] = useState(20000);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [sb, setSb] = useState(300);
  const [bb, setBb] = useState(500);
  const [newNickname, setNewNickname] = useState('');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSessionModal, setShowSessionModal] = useState(false);

  // 🎯 칩 조절 상태
  const [chipInput, setChipInput] = useState('');
  const [isChipEditing, setIsChipEditing] = useState(false);

  useEffect(() => {
    // 🎯 로비 진입 시 최신 사용자 정보(칩, 리바인) 동기화
    if (userInfo?.id) {
      fetch(`${SERVER_URL}/api/users/${userInfo.id}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setUserInfo(prev => ({ ...prev, ...data.user }));
            // 로컬 스토리지도 최신화
            const saved = JSON.parse(localStorage.getItem('holdem_user') || '{}');
            localStorage.setItem('holdem_user', JSON.stringify({ ...saved, ...data.user }));
          }
        });
    }

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
        body: JSON.stringify({ title, buyIn, maxPlayers, sb, bb, creatorId: userInfo?.id }) 
      });
      const result = await response.json();
      if (result.success) {
        setShowModal(false);
        navigate(`/room/${result.room.id}`, { state: { title: result.room.title } });
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

  // 🎯 칩 조절 핸들러
  const handleUpdateChips = async () => {
    const newChips = Number(chipInput);
    if (isNaN(newChips) || newChips < 0) return alert('올바른 금액을 입력해주세요.');
    try {
      const res = await fetch(`${SERVER_URL}/api/updateChips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userInfo.id, chips: newChips })
      });
      const data = await res.json();
      if (data.success) {
        setUserInfo({ ...userInfo, chips: data.chips });
        setIsChipEditing(false);
      } else {
        alert(data.message);
      }
    } catch (e) { alert('칩 변경 실패'); }
  };

  // 🎯 방 입장 가능 여부 판단
  const canEnterRoom = (room) => {
    const userSessionId = userInfo?.currentSessionId || null;
    const roomSessionId = room.sessionId || null;

    // 세션 방인데 내 세션과 다르면 입장 불가
    if (roomSessionId && roomSessionId !== userSessionId) return false;
    // 일반 방인데 내가 세션 참가 중이면 입장 불가
    if (!roomSessionId && userSessionId) return false;
    return true;
  };

  // 🎯 현재 참가 중인 세션 이름 찾기
  const currentSessionName = (() => {
    if (!userInfo?.currentSessionId) return null;
    // 세션 이름은 방 목록에서 추론하거나 별도 API로 가져올 수 있음
    // 간단하게 세션 모달 열 때 로드
    return userInfo.currentSessionId;
  })();

  if (!userInfo) return <Navigate to="/" replace />;

  return (
    <div className="lobby-container animate-fade-in">
      <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 className="title-text" style={{ margin: 0, fontSize: '1.2rem' }}>L.D.J LOBBY</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'white', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.9rem' }}>{userInfo.nickname} 님</span>

          {/* 🎯 세션 상태 배지 */}
          {userInfo.currentSessionId ? (
            <span className="session-active-badge" style={{ fontSize: '0.8rem', padding: '3px 8px', borderRadius: '4px', background: 'rgba(250,204,21,0.2)', color: '#facc15', border: '1px solid #facc15' }}>
              세션 참가 중
            </span>
          ) : null}

          {/* 🎯 칩 표시 및 조절 */}
          <span className="badge" style={{ cursor: !userInfo.currentSessionId ? 'pointer' : 'default' }}
            onClick={() => { if (!userInfo.currentSessionId) { setChipInput(String(userInfo.chips)); setIsChipEditing(true); } }}>
            💰 {Number(userInfo.chips).toLocaleString()}
          </span>

          <span className="badge">전적: {userInfo.rebuyCount} 리바인</span>
          <button className="premium-btn danger-btn" style={{ padding: '5px 10px', fontSize: '0.8rem' }} onClick={() => { localStorage.removeItem('holdem_user'); setUserInfo(null); window.location.href = '/'; }}>로그아웃</button>
          <button className="premium-btn secondary-btn" style={{ padding: '5px 10px', fontSize: '0.8rem' }} onClick={() => setShowProfileModal(true)}>프로필</button>
          <button className="premium-btn secondary-btn" style={{ padding: '5px 10px', fontSize: '0.8rem' }} onClick={() => setShowSessionModal(true)}>세션</button>
          <button className="premium-btn primary-btn" style={{ padding: '5px 15px' }} onClick={() => setShowModal(true)}>+ 방 만들기</button>
        </div>
      </div>

      <div style={{ marginTop: '20px' }} className="grid-rooms">
        {rooms.map(room => {
          const canEnter = canEnterRoom(room);
          return (
            <div key={room.id} className={`room-card glass-panel flex-col-center ${!canEnter ? 'room-card-disabled' : ''}`} style={{ padding: '20px', gap: '10px', opacity: canEnter ? 1 : 0.5 }}>
              <h3 style={{ color: '#f39c12', fontSize: '18px', margin: 0 }}>{room.title}</h3>
              <p style={{ margin: 0, color: '#ddd' }}>인원: {room.currentPlayers} / {room.maxPlayers}</p>
              <p style={{ margin: 0, color: '#ddd' }}>SB/BB: {room.sb}/{room.bb} | 바이인: {room.buyIn}</p>
              {room.sessionId && <span className="session-type-badge online-badge" style={{ fontSize: '11px' }}>세션 방</span>}
              <button 
                className={`premium-btn ${canEnter ? 'success-btn' : 'disabled'}`}
                disabled={!canEnter}
                onClick={() => canEnter && navigate(`/room/${room.id}`, { state: { title: room.title } })}
              >
                {canEnter ? '입장하기' : '입장 불가'}
              </button>
            </div>
          );
        })}
        {rooms.length === 0 && <p style={{ color: 'white', gridColumn: '1/-1', textAlign: 'center' }}>생성된 방이 없습니다.</p>}
      </div>

      {/* 🎯 칩 조절 모달 */}
      {isChipEditing && !userInfo.currentSessionId && (
        <div className="modal-overlay" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => setIsChipEditing(false)}>
          <div className="modal-content glass-panel animate-fade-in" style={{ margin: 'auto', maxWidth: '350px' }} onClick={e => e.stopPropagation()}>
            <h3 className="title-text" style={{ fontSize: '18px', textAlign: 'center' }}>💰 보유 칩 설정</h3>
            <div className="input-group">
              <label>금액 입력</label>
              <input type="number" className="premium-input" min="0" step="1000" value={chipInput} onChange={e => setChipInput(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '15px' }}>
              <button className="premium-btn primary-btn" style={{ flex: 1 }} onClick={handleUpdateChips}>설정</button>
              <button className="premium-btn danger-btn" style={{ flex: 1 }} onClick={() => setIsChipEditing(false)}>취소</button>
            </div>
          </div>
        </div>
      )}

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
            {userInfo.currentSessionId && (
              <p style={{ color: '#facc15', fontSize: '13px', marginTop: '8px' }}>
                ※ 세션 참가 중이므로 세션 방으로 생성됩니다.
              </p>
            )}
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

      {/* 🎯 세션 모달 */}
      {showSessionModal && (
        <SessionModal
          userInfo={userInfo}
          setUserInfo={setUserInfo}
          onClose={() => setShowSessionModal(false)}
        />
      )}
    </div>
  );
};

export default LobbyScreen;
