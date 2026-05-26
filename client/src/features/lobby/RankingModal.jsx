import React, { useState, useEffect } from 'react';
import { SERVER_URL } from '../../utils/constants';

const RankingModal = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState('online'); // 'online' | 'offline'
  const [onlineRanking, setOnlineRanking] = useState([]);
  const [offlineRanking, setOfflineRanking] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchRankings = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${SERVER_URL}/api/rankings`);
        const data = await res.json();
        if (data.success) {
          setOnlineRanking(data.onlineRanking || []);
          setOfflineRanking(data.offlineRanking || []);
        } else {
          setError('랭킹 데이터를 불러오지 못했습니다.');
        }
      } catch (err) {
        console.error('Failed to fetch rankings:', err);
        setError('서버 연결 실패');
      } finally {
        setLoading(false);
      }
    };

    fetchRankings();
  }, []);

  const displayList = activeTab === 'online' ? onlineRanking : offlineRanking;

  // 👑 순위별 크라운/메달 엠블럼 및 텍스트 색상
  const getRankBadge = (rank) => {
    if (rank === 1) {
      return (
        <span style={{ 
          background: 'linear-gradient(135deg, #fef08a, #ca8a04)', 
          color: '#000', 
          fontWeight: 'bold', 
          padding: '2px 8px', 
          borderRadius: '12px',
          boxShadow: '0 0 8px rgba(234, 179, 8, 0.6)'
        }}>
          👑 1위
        </span>
      );
    }
    if (rank === 2) {
      return (
        <span style={{ 
          background: 'linear-gradient(135deg, #e2e8f0, #475569)', 
          color: '#fff', 
          fontWeight: 'bold', 
          padding: '2px 8px', 
          borderRadius: '12px'
        }}>
          🥈 2위
        </span>
      );
    }
    if (rank === 3) {
      return (
        <span style={{ 
          background: 'linear-gradient(135deg, #ffedd5, #ea580c)', 
          color: '#fff', 
          fontWeight: 'bold', 
          padding: '2px 8px', 
          borderRadius: '12px'
        }}>
          🥉 3위
        </span>
      );
    }
    return <span style={{ color: '#94a3b8', paddingLeft: '8px' }}>{rank}위</span>;
  };

  return (
    <div className="modal-overlay" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2500 }} onClick={onClose}>
      <div className="modal-content glass-panel animate-fade-in session-modal" onClick={e => e.stopPropagation()} style={{ margin: 'auto', width: '500px', maxWidth: '95vw', maxHeight: '80vh', overflowY: 'auto', padding: '25px' }}>
        
        {/* 모달 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 className="title-text" style={{ fontSize: '22px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: '#fbbf24' }}>
            🏆 플레이어 랭킹
          </h3>
          <button className="premium-btn danger-btn" style={{ padding: '5px 12px' }} onClick={onClose}>✕</button>
        </div>

        {/* 탭 컨트롤러 */}
        <div style={{ display: 'flex', background: 'rgba(0,0,0,0.4)', borderRadius: '8px', padding: '4px', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.08)' }}>
          <button 
            style={{ 
              flex: 1, 
              padding: '10px 0', 
              border: 'none', 
              borderRadius: '6px', 
              background: activeTab === 'online' ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)' : 'transparent',
              color: '#fff',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onClick={() => setActiveTab('online')}
          >
            온라인 랭킹
          </button>
          <button 
            style={{ 
              flex: 1, 
              padding: '10px 0', 
              border: 'none', 
              borderRadius: '6px', 
              background: activeTab === 'offline' ? 'linear-gradient(135deg, #10b981, #047857)' : 'transparent',
              color: '#fff',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onClick={() => setActiveTab('offline')}
          >
            오프라인 랭킹
          </button>
        </div>

        {/* 로딩 / 에러 / 목록 출력 */}
        {loading ? (
          <div style={{ color: '#94a3b8', textAlign: 'center', padding: '40px 0' }}>랭킹 집계 중...</div>
        ) : error ? (
          <div style={{ color: '#ef4444', textAlign: 'center', padding: '40px 0' }}>{error}</div>
        ) : displayList.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* 테이블 헤더 */}
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 110px 90px', padding: '8px 12px', fontSize: '12px', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <span>순위</span>
              <span>닉네임</span>
              <span style={{ textAlign: 'right' }}>누적 손익</span>
              <span style={{ textAlign: 'right' }}>세션 / 리바인</span>
            </div>

            {/* 랭킹 로우 리스트 */}
            {displayList.map((item, idx) => {
              const rank = idx + 1;
              return (
                <div 
                  key={idx} 
                  style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '80px 1fr 110px 90px', 
                    alignItems: 'center',
                    padding: '12px', 
                    background: rank <= 3 ? 'rgba(255,255,255,0.03)' : 'transparent',
                    border: rank <= 3 ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                >
                  <div>{getRankBadge(rank)}</div>
                  <span style={{ fontWeight: rank <= 3 ? 'bold' : 'normal', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.nickname}
                  </span>
                  <span style={{ 
                    textAlign: 'right', 
                    fontWeight: 'bold', 
                    color: item.totalProfit > 0 ? '#10b981' : item.totalProfit < 0 ? '#ef4444' : '#fff' 
                  }}>
                    {item.totalProfit > 0 ? '+' : ''}{item.totalProfit.toLocaleString()}원
                  </span>
                  <span style={{ textAlign: 'right', color: '#94a3b8', fontSize: '12px' }}>
                    {item.sessionCount}회 / {item.totalRebuys}회
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ color: '#94a3b8', textAlign: 'center', padding: '40px 0', fontSize: '14px' }}>
            정산 완료된 {activeTab === 'online' ? '온라인' : '오프라인'} 세션 기록이 없습니다.
          </div>
        )}

        {/* 닫기 버튼 */}
        <button 
          className="premium-btn secondary-btn" 
          style={{ width: '100%', marginTop: '20px', padding: '10px' }} 
          onClick={onClose}
        >
          닫기
        </button>

      </div>
    </div>
  );
};

export default RankingModal;
