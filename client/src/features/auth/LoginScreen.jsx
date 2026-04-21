import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SERVER_URL } from '../../utils/constants';

const LoginScreen = ({ setUserInfo }) => {
  const navigate = useNavigate();
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    if (isLoading) return;
    const endpoint = isLoginMode ? '/api/login' : '/api/signup';
    const bodyData = isLoginMode ? { id, password } : { id, password, nickname };
    try {
      setIsLoading(true);
      console.log(`[LOGIN ACTION] 요청 시작: ${endpoint} (ID: ${id})`);
      const response = await fetch(`${SERVER_URL}${endpoint}`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(bodyData) 
      });
      
      if (!response.ok) {
        throw new Error(`서버 응답 오류 (상태코드: ${response.status})`);
      }

      const result = await response.json();
      console.log(`[LOGIN RESULT] 결과 수신: ${result.success}`);

      if (result.success) {
        if (isLoginMode) { 
          setUserInfo(result.user); 
          navigate('/lobby'); 
        } else { 
          alert("가입 완료! 로그인해주세요."); 
          setIsLoginMode(true); 
        }
      } else alert(result.message);
    } catch (error) { 
      console.error("[LOGIN ERROR]", error);
      alert(`로그인 실패: ${error.message}\n서버가 가동 중인지 확인해주세요.`); 
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="center-container glass-panel animate-fade-in" style={{ width: '90%', maxWidth: '400px', padding: '40px' }}>
      <h1 className="title-text">{isLoginMode ? 'L.D.J TEXAS HOLDEM' : '회원가입'}</h1>
      <input className="premium-input" type="text" placeholder="아이디" value={id} onChange={e => setId(e.target.value)} />
      <input className="premium-input" type="password" placeholder="비밀번호" value={password} onChange={e => setPassword(e.target.value)} />
      {!isLoginMode && <input className="premium-input" type="text" placeholder="닉네임" value={nickname} onChange={e => setNickname(e.target.value)} />}

      <button 
        className={`premium-btn primary-btn ${isLoading ? 'loading' : ''}`} 
        style={{ width: '100%', marginTop: '10px' }} 
        onClick={handleSubmit}
        disabled={isLoading}
      >
        {isLoading ? '통신 중...' : (isLoginMode ? '로그인' : '가입하기')}
      </button>
      <p style={{ cursor: 'pointer', color: '#a0aec0', marginTop: '15px' }} onClick={() => setIsLoginMode(!isLoginMode)}>
        {isLoginMode ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
      </p>
    </div>
  );
};

export default LoginScreen;
