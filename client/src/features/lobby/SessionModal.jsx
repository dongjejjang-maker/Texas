import React, { useState, useEffect } from 'react';
import { SERVER_URL } from '../../utils/constants';

// ─── 화면 상태: list / create / detail ───
const SessionModal = ({ userInfo, setUserInfo, onClose }) => {
  const [view, setView] = useState('list'); // 'list' | 'create' | 'detail'
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [createType, setCreateType] = useState('online');
  const [sessionName, setSessionName] = useState('');
  const [sessionBuyIn, setSessionBuyIn] = useState(20000);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState(null);
  const [settlement, setSettlement] = useState(null);
  const [newParticipantName, setNewParticipantName] = useState('');
  const [loading, setLoading] = useState(false);

  // 세션 목록 로드
  const fetchSessions = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/api/sessions`);
      const data = await res.json();
      if (data.success) setSessions(data.sessions);
    } catch (e) { console.error('세션 목록 로드 실패:', e); }
  };

  useEffect(() => { fetchSessions(); }, []);

  // 세션 상세 로드
  const fetchSessionDetail = async (id) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/sessions/${id}`);
      const data = await res.json();
      if (data.success) {
        setSelectedSession(data.session);
        setSettlement(data.session.settlement);
      }
    } catch (e) { console.error('세션 상세 로드 실패:', e); }
  };

  // 세션 생성
  const handleCreate = async () => {
    if (!sessionName.trim()) return alert('세션명을 입력해주세요.');
    if (!sessionBuyIn || sessionBuyIn < 1000) return alert('바이인 금액을 확인해주세요.');
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sessionName, type: createType, buyIn: sessionBuyIn })
      });
      const data = await res.json();
      if (data.success) {
        setSessionName('');
        setSessionBuyIn(20000);
        setView('list');
        fetchSessions();
      }
    } catch (e) { alert('세션 생성 실패'); }
    setLoading(false);
  };

  // 온라인 세션 참가
  const handleJoin = async () => {
    if (!selectedSession) return;
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/sessions/${selectedSession.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userInfo.id, nickname: userInfo.nickname })
      });
      const data = await res.json();
      if (data.success) {
        setUserInfo(data.user);
        fetchSessionDetail(selectedSession.id);
        alert('세션에 참가했습니다!');
      } else {
        alert(data.message);
      }
    } catch (e) { alert('세션 참가 실패'); }
    setLoading(false);
  };

  // 세션 종료
  const handleEnd = async () => {
    if (!window.confirm('정말 종료하시겠습니까?')) return;
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/sessions/${selectedSession.id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        setUserInfo(prev => ({ ...prev, currentSessionId: null }));
        fetchSessionDetail(selectedSession.id);
        fetchSessions();
        alert('세션이 종료되었습니다.');
      }
    } catch (e) { alert('세션 종료 실패'); }
    setLoading(false);
  };

  // 세션 삭제
  const handleDelete = async () => {
    if (!window.confirm('정말 이 세션을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/sessions/${selectedSession.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setView('list');
        setSelectedSession(null);
        fetchSessions();
        alert('세션이 삭제되었습니다.');
      }
    } catch (e) { alert('세션 삭제 실패'); }
    setLoading(false);
  };

  // 정산
  const handleSettle = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/sessions/${selectedSession.id}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        setSettlement(data.settlement);
        fetchSessionDetail(selectedSession.id);
      }
    } catch (e) { alert('정산 실패'); }
    setLoading(false);
  };

  // 오프라인 세션 수정 저장
  const handleSaveEdit = async () => {
    if (!editData) return;
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/sessions/${selectedSession.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData)
      });
      const data = await res.json();
      if (data.success) {
        setIsEditing(false);
        setEditData(null);
        fetchSessionDetail(selectedSession.id);
        fetchSessions();
      }
    } catch (e) { alert('수정 저장 실패'); }
    setLoading(false);
  };

  // 오프라인 세션에 참가자 추가
  const handleAddParticipant = () => {
    if (!newParticipantName.trim()) return;
    const newP = {
      nickname: newParticipantName.trim(),
      linkedUserId: null,
      rebuyCount: 0,
      chips: editData?.buyIn || selectedSession.buyIn,
      joinedAt: new Date().toISOString()
    };
    setEditData(prev => ({
      ...prev,
      participants: [...(prev.participants || []), newP]
    }));
    setNewParticipantName('');
  };

  // 수정 모드 진입
  const enterEditMode = () => {
    setEditData({
      name: selectedSession.name,
      buyIn: selectedSession.buyIn,
      participants: [...selectedSession.participants]
    });
    setIsEditing(true);
  };

  // ─── 렌더링 ───

  // 목록 화면
  const renderList = () => (
    <div className="session-list-view">
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <button className="premium-btn primary-btn" style={{ flex: 1 }} onClick={() => { setCreateType('online'); setView('create'); }}>
          온라인 세션 생성
        </button>
        <button className="premium-btn secondary-btn" style={{ flex: 1 }} onClick={() => { setCreateType('offline'); setView('create'); }}>
          오프라인 세션 생성
        </button>
      </div>

      <div className="session-list">
        {sessions.length === 0 && <p style={{ color: '#888', textAlign: 'center' }}>생성된 세션이 없습니다.</p>}
        {sessions.map(s => (
          <div
            key={s.id}
            className="session-card glass-panel"
            onClick={() => { setSelectedSession(s); fetchSessionDetail(s.id); setView('detail'); setSettlement(s.settlement); setIsEditing(false); setEditData(null); }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 'bold', fontSize: '16px', color: '#fff' }}>{s.name}</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <span className={`session-type-badge ${s.type === 'online' ? 'online-badge' : 'offline-badge'}`}>
                  {s.type === 'online' ? '온라인' : '오프라인'}
                </span>
                <span className={`session-status-badge ${s.status === 'active' ? 'active-badge' : 'ended-badge'}`}>
                  {s.status === 'active' ? '진행 중' : '종료됨'}
                </span>
              </div>
            </div>
            <div style={{ color: '#aaa', fontSize: '13px', marginTop: '6px' }}>
              바이인: {Number(s.buyIn).toLocaleString()} | 참가자: {s.participants?.length || 0}명
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // 생성 화면
  const renderCreate = () => (
    <div className="session-create-view">
      <h4 style={{ color: '#fff', margin: '0 0 15px 0' }}>
        {createType === 'online' ? '온라인' : '오프라인'} 세션 생성
      </h4>
      <div className="input-group">
        <label>세션명</label>
        <input type="text" className="premium-input" value={sessionName} onChange={e => setSessionName(e.target.value)} placeholder="예: 금요일 정기전" />
      </div>
      <div className="input-group">
        <label>바이인 금액</label>
        <input type="number" className="premium-input" min="1000" step="1000" value={sessionBuyIn} onChange={e => setSessionBuyIn(Number(e.target.value))} />
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
        <button className="premium-btn primary-btn" style={{ flex: 1 }} onClick={handleCreate} disabled={loading}>
          {loading ? '생성 중...' : '생성'}
        </button>
        <button className="premium-btn danger-btn" style={{ flex: 1 }} onClick={() => setView('list')}>취소</button>
      </div>
    </div>
  );

  // 상세 화면
  const renderDetail = () => {
    if (!selectedSession) return null;
    const s = selectedSession;
    const isOnline = s.type === 'online';
    const isActive = s.status === 'active';
    const amIParticipant = isOnline && s.participants?.some(p => p.linkedUserId === userInfo?.id);

    const displayParticipants = isEditing && editData ? editData.participants : s.participants;

    return (
      <div className="session-detail-view">
        {/* 헤더 */}
        <div style={{ marginBottom: '15px' }}>
          {isEditing ? (
            <>
              <div className="input-group" style={{ marginBottom: '8px' }}>
                <label style={{ fontSize: '12px' }}>세션명</label>
                <input type="text" className="premium-input" value={editData.name} onChange={e => setEditData(prev => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="input-group">
                <label style={{ fontSize: '12px' }}>바이인 금액</label>
                <input type="number" className="premium-input" value={editData.buyIn} onChange={e => setEditData(prev => ({ ...prev, buyIn: Number(e.target.value) }))} />
              </div>
            </>
          ) : (
            <>
              <h4 style={{ color: '#fff', margin: '0 0 4px 0', fontSize: '18px' }}>{s.name}</h4>
              <span style={{ color: '#facc15', fontSize: '14px' }}>바이인: {Number(s.buyIn).toLocaleString()}</span>
              <span className={`session-type-badge ${isOnline ? 'online-badge' : 'offline-badge'}`} style={{ marginLeft: '10px' }}>
                {isOnline ? '온라인' : '오프라인'}
              </span>
              <span className={`session-status-badge ${isActive ? 'active-badge' : 'ended-badge'}`} style={{ marginLeft: '6px' }}>
                {isActive ? '진행 중' : '종료됨'}
              </span>
            </>
          )}
        </div>

        {/* 참가자 테이블 */}
        <div className="session-participants-table">
          <div className="session-table-header">
            <span>이름</span>
            <span>리바인</span>
            <span>보유칩</span>
          </div>
          {displayParticipants?.map((p, idx) => (
            <div key={idx} className="session-table-row">
              {isEditing ? (
                <>
                  <input type="text" className="premium-input session-edit-input" value={p.nickname} onChange={e => {
                    const newP = [...editData.participants];
                    newP[idx] = { ...newP[idx], nickname: e.target.value };
                    setEditData(prev => ({ ...prev, participants: newP }));
                  }} />
                  <input type="number" className="premium-input session-edit-input" value={p.rebuyCount} onChange={e => {
                    const newP = [...editData.participants];
                    newP[idx] = { ...newP[idx], rebuyCount: Number(e.target.value) };
                    setEditData(prev => ({ ...prev, participants: newP }));
                  }} />
                  <input type="number" className="premium-input session-edit-input" value={p.chips} onChange={e => {
                    const newP = [...editData.participants];
                    newP[idx] = { ...newP[idx], chips: Number(e.target.value) };
                    setEditData(prev => ({ ...prev, participants: newP }));
                  }} />
                  <button className="premium-btn danger-btn" style={{ padding: '2px 8px', fontSize: '12px' }} onClick={() => {
                    const newP = [...editData.participants];
                    newP.splice(idx, 1);
                    setEditData(prev => ({ ...prev, participants: newP }));
                  }}>✕</button>
                </>
              ) : (
                <>
                  <span>{p.nickname}</span>
                  <span>{p.rebuyCount}</span>
                  <span>{Number(p.chips).toLocaleString()}</span>
                </>
              )}
            </div>
          ))}
        </div>

        {/* 오프라인: 인원 추가 (수정 모드) */}
        {isEditing && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <input type="text" className="premium-input" style={{ flex: 1 }} value={newParticipantName} onChange={e => setNewParticipantName(e.target.value)} placeholder="참가자 이름" />
            <button className="premium-btn primary-btn" style={{ padding: '6px 14px' }} onClick={handleAddParticipant}>+ 추가</button>
          </div>
        )}

        {/* 정산 결과 */}
        {settlement && (
          <div className="settlement-section" style={{ marginTop: '15px' }}>
            <h5 style={{ color: '#facc15', margin: '0 0 8px 0' }}>📊 정산 결과</h5>
            <div className="settlement-table">
              <div className="settlement-header">
                <span>이름</span>
                <span>총 투입</span>
                <span>최종칩</span>
                <span>손익</span>
              </div>
              {settlement.map((r, idx) => (
                <div key={idx} className="settlement-row">
                  <span>{r.nickname}</span>
                  <span>{Number(r.totalInvested).toLocaleString()}</span>
                  <span>{Number(r.finalChips).toLocaleString()}</span>
                  <span className={r.profit >= 0 ? 'profit-positive' : 'profit-negative'}>
                    {r.profit >= 0 ? '+' : ''}{Number(r.profit).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 버튼 영역 */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '15px', flexWrap: 'wrap' }}>
          {/* 온라인: 참가 버튼 */}
          {isOnline && isActive && !amIParticipant && !userInfo?.currentSessionId && (
            <button className="premium-btn success-btn" onClick={handleJoin} disabled={loading}>
              {loading ? '처리 중...' : '참가'}
            </button>
          )}

          {/* 정산 버튼 */}
          <button className="premium-btn primary-btn" onClick={handleSettle} disabled={loading}>
            {loading ? '계산 중...' : '정산'}
          </button>

          {/* 오프라인 or 종료된 세션: 수정/저장 토글 */}
          {(s.type === 'offline' || s.status === 'ended') && (
            isEditing ? (
              <button className="premium-btn success-btn" onClick={handleSaveEdit} disabled={loading}>
                {loading ? '저장 중...' : '저장'}
              </button>
            ) : (
              <button className="premium-btn secondary-btn" onClick={enterEditMode}>수정</button>
            )
          )}

          {/* 온라인 & 활성: 종료 버튼 */}
          {isOnline && isActive && (
            <button className="premium-btn danger-btn" onClick={handleEnd} disabled={loading}>세션 종료</button>
          )}

          {/* 수정 모드: 삭제 버튼 */}
          {isEditing && (
            <button className="premium-btn danger-btn" onClick={handleDelete} disabled={loading}>삭제</button>
          )}

          <button className="premium-btn secondary-btn" onClick={() => { setView('list'); setIsEditing(false); setEditData(null); setSettlement(null); }}>
            목록으로
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={onClose}>
      <div className="modal-content glass-panel animate-fade-in session-modal" onClick={e => e.stopPropagation()} style={{ margin: 'auto', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 className="title-text" style={{ fontSize: '20px', margin: 0 }}>세션 관리</h3>
          <button className="premium-btn danger-btn" style={{ padding: '5px 12px' }} onClick={onClose}>✕</button>
        </div>

        {view === 'list' && renderList()}
        {view === 'create' && renderCreate()}
        {view === 'detail' && renderDetail()}
      </div>
    </div>
  );
};

export default SessionModal;
