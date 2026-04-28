import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useParams, useLocation, Navigate } from 'react-router-dom';
import socket from '../../utils/socket';
import { SERVER_URL } from '../../utils/constants';
import PlayingCard from '../../components/game/PlayingCard';
import pokersolver from 'pokersolver';
const { Hand } = pokersolver;

// ─── 유틸리티: 족보명 한글 번역 (서버와 동일한 초정밀 로직) ───
const TRANSLATE_HAND = (handObj) => {
  if (!handObj || !handObj.name) return "";
  let raw = handObj.name;
  let baseLower = raw.toLowerCase();

  let translated = "하이카드";
  if (baseLower.includes("royal flush")) translated = "로티플";
  else if (baseLower.includes("straight flush")) translated = "스티플";
  else if (baseLower.includes("four of a kind")) translated = "포카드";
  else if (baseLower.includes("full house")) translated = "풀하우스";
  else if (baseLower.includes("flush")) translated = "플러쉬";
  else if (baseLower.includes("straight")) translated = "스트레이트";
  else if (baseLower.includes("three of a kind")) translated = "트리플";
  else if (baseLower.includes("two pair")) translated = "투페어";
  else if (baseLower.includes("pair")) translated = "원페어";
  else if (baseLower.includes("high card")) translated = "하이카드";

  if (handObj.descr) {
    let ranksMatch = handObj.descr.match(/\b(A|K|Q|J|10|9|8|7|6|5|4|3|2)\b/g);
    if (ranksMatch && ranksMatch.length > 0) {
      let uniqueRanks = [...new Set(ranksMatch)];
      if (translated === "하이카드") return `(${uniqueRanks[0]}) ${translated}`;
      return `(${uniqueRanks.join(',')}) ${translated}`;
    }
  }
  return translated;
};


const FORMAT_CARD_FOR_SOLVER = (cardStr) => {
  // 클라이언트 카드 형식(♠A) -> pokersolver 형식(As)
  const rank = cardStr.slice(1) === '10' ? 'T' : cardStr.slice(1);
  const suitMap = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
  const suit = suitMap[cardStr.charAt(0)] || 's';
  return `${rank}${suit}`;
};

// ─── 컴포넌트 외부 상수 ───
const CHIP_DENOMS = [
  { value: 100000, bg: '#FFD700', border: '#B8860B', label: '100K' },
  { value: 25000, bg: '#9B59B6', border: '#6C3483', label: '25K' },
  { value: 10000, bg: '#2C3E50', border: '#839192', label: '10K' },
  { value: 5000, bg: '#27AE60', border: '#1A5C36', label: '5K' },
  { value: 1000, bg: '#2980B9', border: '#154360', label: '1K' },
  { value: 500, bg: '#E74C3C', border: '#922B21', label: '500' },
  { value: 100, bg: '#ECF0F1', border: '#95A5A6', label: '100' },
];

const DESKTOP_OFFSETS = [
  { x: 0, y: 231 },     // 0: 6시 (나) - 테두리 중앙
  { x: -265, y: 175 },  // 1: 7시 30분
  { x: -355, y: 0 },    // 2: 9시 - 테두리 중앙
  { x: -265, y: -175 }, // 3: 10시 30분 (11시)
  { x: 0, y: -231 },    // 4: 12시 - 테두리 중앙
  { x: 265, y: -175 },  // 5: 1시 30분
  { x: 355, y: 0 },     // 6: 3시 - 테두리 중앙
  { x: 265, y: 175 },   // 7: 4시 30분 (5시)
];

const MOBILE_OFFSETS = [
  { x: 0, y: 260 },       // 0: 6시 (나) - 240 -> 260
  { x: -177, y: 205 },   // 1: 7시 30분 - 190 -> 205
  { x: -230, y: 0 },     // 2: 9시
  { x: -177, y: -205 },  // 3: 10시 30분
  { x: 0, y: -260 },     // 4: 12시
  { x: 177, y: -205 },   // 5: 1시 30분
  { x: 230, y: 0 },      // 6: 3시
  { x: 177, y: 205 },    // 7: 4시 30분
];

function GameRoom({ userInfo, setUserInfo }) {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const location = useLocation();
  const roomTitle = location.state?.title || '홀덤 방';

  // 🍏 모바일 여부 감지
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const seatOffsets = isMobile ? MOBILE_OFFSETS : DESKTOP_OFFSETS;

  const [gameState, setGameState] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  
  // 🍏 배경음(BGM) 및 효과음(SFX) 볼륨 이원화 관리 (안전한 초기화 로직 추가)
  const [bgmVolume, setBgmVolume] = useState(() => {
    const saved = localStorage.getItem('poker_bgm_volume');
    const val = saved ? Number(saved) : 0.3;
    return isNaN(val) ? 0.3 : Math.max(0, Math.min(1, val));
  });
  const [sfxVolume, setSfxVolume] = useState(() => {
    const saved = localStorage.getItem('poker_sfx_volume');
    const val = saved ? Number(saved) : 0.5;
    return isNaN(val) ? 0.5 : Math.max(0, Math.min(1, val));
  });
  
  const bgmRef = useRef(new Audio());
  const sfxRef = useRef({}); // 효과음 객체 캐시용
  const containerRef = useRef(null); // 🍏 테이블 컨테이너 참조 추가
  
  useEffect(() => {
    localStorage.setItem('poker_bgm_volume', bgmVolume.toString());
    if (bgmRef.current) {
      bgmRef.current.volume = bgmVolume;
      
      // 🍏 BGM이 끝나면 다음 곡을 서버에 요청하는 로직
      bgmRef.current.onended = () => {
        // 중복 요청 방지를 위해 현재 방의 첫 번째 플레이어(방장 역할)만 요청
        const firstActivePlayer = gameStateRef.current?.players?.find(p => p.socketId !== null);
        if (firstActivePlayer?.nickname === userInfo?.nickname) {
          console.log("BGM Ended. Requesting next song...");
          socket.emit('requestNextBGM', { roomId: Number(roomId) });
        }
      };
    }
  }, [bgmVolume, roomId, userInfo?.nickname]);

  useEffect(() => {
    localStorage.setItem('poker_sfx_volume', sfxVolume.toString());
  }, [sfxVolume]);

  // 🍏 iOS Safari 등에서 TTS 기능을 활성화(Unlock)하기 위한 빈 소리 재생 로직
  const unlockTTS = () => {
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    console.log('TTS Unlocked for iOS');
    // 한 번만 실행되도록 이벤트 리스너 제거용으로도 사용 가능
  };

  useEffect(() => {
    // 사용자가 방에 들어왔을 때 첫 클릭 시 TTS 잠금 해제
    window.addEventListener('click', unlockTTS, { once: true });
    return () => window.removeEventListener('click', unlockTTS);
  }, []);

  const volumeRef = useRef(0.5); // 하위 호환용 (필요시 제거 가능)

  const gameStateRef = useRef(null); // 🍏 리스너 내 최신 상태 참조용
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  const [tempSettings, setTempSettings] = useState({ autoStartDelay: 5000, sb: 500, bb: 1000 }); // 🍏 UI 반응성용 로컬 상태
  const [countdown, setCountdown] = useState(null); // 🍏 시각적 카운트다운 유지
  const [chatLogs, setChatLogs] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [myCards, setMyCards] = useState([]);
  const [localHandName, setLocalHandName] = useState('');
  const [actionBubbles, setActionBubbles] = useState([]); // 🍏 액션 말풍선 상태

  // 레이즈 모달 상태
  const [showRaisePanel, setShowRaisePanel] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState(0);

  // 관전 모드 리바인 버튼 표시 여부
  const [showRebuyBtn, setShowRebuyBtn] = useState(false);
  const enteredSpectatorRef = useRef(false);
  const popupLockRef = useRef(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [hasNewMessage, setHasNewMessage] = useState(false);

  // 베팅 칩 이동 애니메이션
  const [betAnimChips, setBetAnimChips] = useState([]);
  const prevBetAmountsRef = useRef({});

  // 쇼다운 진입 직전 커뮤니티카드 수 기록
  const preShowdownCardCountRef = useRef(0);
  const prevPhaseRef = useRef('');
  const lastProcessedMsgRef = useRef({ text: '', time: 0 });
  const revealedIndicesRef = useRef(new Set());
  const revealedPhaseRecordRef = useRef({}); // 🍏 각 카드가 처음 공개된 단계를 기록
  const autoStartIntervalRef = useRef(null); // 🍏 자동 시작 타이머 레프
  const chatEndRef = useRef(null);
  const showChatModalRef = useRef(false); // 🍏 의존성 방지용 Ref

  useEffect(() => {
    showChatModalRef.current = showChatModal;
    // 🍏 채팅창이 열릴 때 즉시 최하단으로 스크롤
    if (showChatModal) {
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 100);
    }
  }, [showChatModal]);

  // 🍏 [효과음 재생 함수]
  const playSFX = useCallback((filename) => {
    const sound = new Audio(`/sound/${filename}`);
    sound.volume = sfxVolume;
    sound.play().catch(e => console.log("SFX Play Error:", e));
  }, [sfxVolume]);

  const playChipSound = useCallback((count = 1) => {
    // 🍏 기존 오실레이터 대신 실제 칩 사운드 파일 랜덤 재생
    const randIdx = Math.floor(Math.random() * 3) + 1;
    const sound = new Audio(`/sound/chip_sound${randIdx}.mp3`);
    sound.volume = sfxVolume;
    sound.play().catch(() => {});
  }, [sfxVolume]);

  // 🍏 [BGM 동기화 및 재생]
  useEffect(() => {
    const bgmFile = gameState?.bgmFile;
    if (bgmFile && bgmRef.current) {
      const currentSrc = bgmRef.current.src;
      const targetSrc = `${window.location.origin}/sound/bgm/${bgmFile}`;
      
      // 파일이 바뀌었을 때만 새로 재생
      if (!currentSrc.includes(encodeURI(bgmFile))) {
        bgmRef.current.pause();
        bgmRef.current.src = targetSrc;
        bgmRef.current.loop = true;
        bgmRef.current.volume = bgmVolume;
        bgmRef.current.play().catch(e => console.log("BGM Play Error:", e));
      }
    }
  }, [gameState?.bgmFile, bgmVolume]);

  // 🍏 [개편] TTS 대신 준비된 MP3 액션 사운드 재생
  const playActionSound = (action) => {
    try {
      const actionKey = action.toLowerCase();
      // 지원하는 액션 파일 리스트
      const supportedActions = ['call', 'fold', 'check', 'raise', 'allin', 'bet'];
      
      if (supportedActions.includes(actionKey)) {
        const audio = new Audio(`/sound/action/${actionKey}.mp3`);
        audio.volume = sfxVolume;
        audio.play().catch(e => console.warn('Action sound play failed:', e));
      }
    } catch (e) {
      console.error('Action sound error:', e);
    }
  };

  const handlePlayerActionNotification = ({ nickname, action, label, amount }) => {
    // 🍏 기존 TTS 대신 신규 액션 사운드 재생 호출
    playActionSound(action);

    // 액션 말풍선 표시 로직
    setPlayerActions(prev => ({
      ...prev,
      [nickname]: { label, amount, timestamp: Date.now() }
    }));
    
    setTimeout(() => {
      setPlayerActions(prev => {
        const next = { ...prev };
        delete next[nickname];
        return next;
      });
    }, 2500);
  };

  // 🍏 [페이즈/카드 변화에 따른 효과음 트리거]
  const prevPhase = useRef('');
  const prevCardCount = useRef(0);
  useEffect(() => {
    if (!gameState) return;

    // 1. 셔플 사운드 (프리플랍 시작 시)
    if (gameState.phase === '프리플랍' && prevPhase.current !== '프리플랍') {
      playSFX('shuffle_card.mp3');
    }

    // 2. 카드 딜링 사운드 (커뮤니티 카드 추가 시)
    const currentCount = gameState.communityCards?.length || 0;
    if (currentCount > prevCardCount.current) {
      if (currentCount === 3 && prevCardCount.current === 0) {
        // 플랍 (3장 연속)
        playSFX('card_dealing.mp3');
        setTimeout(() => playSFX('card_dealing.mp3'), 200);
        setTimeout(() => playSFX('card_dealing.mp3'), 400);
      } else {
        // 턴, 리버 (1장)
        playSFX('card_dealing.mp3');
      }
    }

    prevPhase.current = gameState.phase;
    prevCardCount.current = currentCount;
  }, [gameState?.phase, gameState?.communityCards?.length, playSFX]);

  const playTTS = (text) => {
    try {
      if (!window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.volume = sfxVolume;
      const voices = window.speechSynthesis.getVoices();
      u.voice = voices.find(v => v.name.includes('Google') && v.lang.includes('en')) || voices.find(v => v.lang.includes('en')) || null;
      window.speechSynthesis.speak(u);
    } catch (e) { }
  };

  const isMyTurn = gameState?.turnNickname === userInfo?.nickname && gameState?.phase !== '대기 중' && !gameState?.phase?.includes('종료') && !gameState?.isBlockingAction;
  const myInfo = gameState?.players?.find(p => p.nickname === userInfo?.nickname);
  const amIDecidingRebuy = myInfo?.decidingRebuy;

  useEffect(() => {
    const isSpectator = !!myInfo?.spectator;
    // 🍏 [수정] 관전자이면서 동시에 보유 칩이 0일 때만 리바인 버튼 표시
    if (isSpectator && !enteredSpectatorRef.current && (myInfo?.chips === 0)) {
      enteredSpectatorRef.current = true;
      setShowRebuyBtn(true);
    } else if (!isSpectator || (myInfo?.chips > 0)) {
      enteredSpectatorRef.current = false;
      setShowRebuyBtn(false);
    }
  }, [myInfo?.spectator, myInfo?.chips]);

  useEffect(() => {
    const phase = gameState?.phase || '';
    const isEndPhase = phase.includes('쇼다운') || phase.includes('종료');
    const wasEndPhase = prevPhaseRef.current.includes('쇼다운') || prevPhaseRef.current.includes('종료');
    const enteringEndPhase = isEndPhase && !wasEndPhase;

    if (enteringEndPhase) {
      const prevPhase = prevPhaseRef.current;
      if (prevPhase.includes('프리플랍') || prevPhase === '대기 중' || prevPhase === '') {
        preShowdownCardCountRef.current = 0;
      } else if (prevPhase.includes('플랍')) {
        preShowdownCardCountRef.current = 3;
      } else if (prevPhase.includes('턴')) {
        preShowdownCardCountRef.current = 4;
      } else if (prevPhase.includes('리버')) {
        preShowdownCardCountRef.current = 5;
      } else {
        preShowdownCardCountRef.current = gameState?.communityCards?.length || 0;
      }
    }

    if (phase === '프리플랍' || phase === '대기 중') {
      revealedIndicesRef.current.clear();
      revealedPhaseRecordRef.current = {}; // 🍏 판이 새로 시작되면 기록 초기화
    }
    prevPhaseRef.current = phase;
  }, [gameState?.phase]);

  // 🍏 동기화된 자동 진행 (Auto Proceed) 시각적 연출 로직
  useEffect(() => {
    const phase = gameState?.phase || '';
    const isAutoMode = gameState?.isAutoMode || false;
    const isFinished = phase === '대기 중' || phase.includes('종료') || phase.includes('기권승');

    if (isFinished && isAutoMode) {
      // 서버와 별개로 클라이언트에서도 시각적인 카운트다운 표시
      if (autoStartIntervalRef.current) return;

      // 서버에서 설정된 지연 시간(ms)을 초 단위로 변환 (기본값 5초)
      let count = Math.floor((gameState?.autoStartDelay || 5000) / 1000);
      setCountdown(count);

      autoStartIntervalRef.current = setInterval(() => {
        count -= 1;
        if (count >= 0) setCountdown(count);
        if (count <= 0) {
          clearInterval(autoStartIntervalRef.current);
          autoStartIntervalRef.current = null;
          setCountdown(null);
        }
      }, 1000);
    } else {
      if (autoStartIntervalRef.current) {
        clearInterval(autoStartIntervalRef.current);
        autoStartIntervalRef.current = null;
      }
      setCountdown(null);
    }

    return () => {
      if (autoStartIntervalRef.current) clearInterval(autoStartIntervalRef.current);
    };
  }, [gameState?.phase, gameState?.isAutoMode]);

  useEffect(() => {
    if (amIDecidingRebuy) popupLockRef.current = false;
  }, [amIDecidingRebuy]);

  useEffect(() => {
    socket.emit('joinRoom', { roomId: Number(roomId), nickname: userInfo?.nickname });

    const handleUpdateGameState = (newState) => {
      setGameState(newState);
      setIsJoined(true); // 🍏 입장에 성공했음을 표시
      // 🍏 설정창이 닫혀있을 때는 서버 데이터로 로컬 설정 초기화 (동기화)
      if (!showSettings && newState.settings) {
        setTempSettings(newState.settings);
      }
      const me = newState.players.find(p => p.nickname === userInfo.nickname);
      if (me && (me.rebuyCount !== userInfo.rebuyCount || me.chips !== userInfo.chips)) {
        setUserInfo(prev => ({ ...prev, rebuyCount: me.rebuyCount, chips: me.chips }));
      }
      if (newState.turnNickname !== userInfo?.nickname) {
        setShowRaisePanel(false);
      }
    };

    const handleChatMessage = (data) => {
      setChatLogs(prev => [...prev.slice(-49), data]);
      if (!showChatModalRef.current) setHasNewMessage(true);

      if (data.sender === '시스템') {
        const now = Date.now();
        if (lastProcessedMsgRef.current.text === data.text && (now - lastProcessedMsgRef.current.time) < 500) {
          return;
        }
        lastProcessedMsgRef.current = { text: data.text, time: now };

        if (data.text.includes('폴드')) { playTTS('Fold'); playChipSound(); }
        else if (data.text.includes('콜')) { playTTS('Call'); playChipSound(); }
        else if (data.text.includes('레이즈')) { playTTS('Raise'); playChipSound(); }
        else if (data.text.includes('올인')) { playTTS('All In'); playChipSound(); }
        else if (data.text.includes('체크')) { playTTS('Check'); }
      }
    };

    const handleDealPrivateCards = (cards) => setMyCards(cards);

    socket.on('playerActionNotification', ({ nickname, action, label, amount }) => {
      // 🍏 칩 효과음 재생 (콜, 레이즈 시 랜덤하게 1~3 중 하나)
      if (action === '콜' || action === '레이즈' || action === '올인') {
        const randIdx = Math.floor(Math.random() * 3) + 1;
        playSFX(`chip_sound${randIdx}.mp3`);
      }

      const gs = gameStateRef.current; // 🍏 클로저 방지를 위해 Ref 사용
      if (!gs || !gs.players) return;

      // 액션 플레이어 위치 찾기
      const pIdx = gs.players.findIndex(p => p.nickname === nickname);
      const myIdxLocal = gs.players.findIndex(p => p.nickname === userInfo?.nickname);

      let relIdx = 0;
      if (pIdx > -1 && myIdxLocal > -1) {
        relIdx = (pIdx - myIdxLocal + gs.players.length) % gs.players.length;
      } else if (pIdx > -1) {
        relIdx = pIdx;
      }

      const offset = seatOffsets[Math.min(relIdx, (seatOffsets?.length || 1) - 1)];
      const id = Date.now() + Math.random();

      const newBubble = {
        id,
        nickname,
        label,
        action,
        x: offset.x,
        y: offset.y
      };

      setActionBubbles(prev => [...prev, newBubble]);
      setTimeout(() => {
        setActionBubbles(prev => prev.filter(b => b.id !== id));
      }, 2000);
    });

    const handleJoinRoomError = (data) => {
      alert(data.message || '방에 입장할 수 없습니다.');
      navigate('/lobby', { replace: true });
    };

    socket.on('updateGameState', handleUpdateGameState);
    socket.on('chatMessage', handleChatMessage);
    socket.on('dealPrivateCards', handleDealPrivateCards);
    socket.on('joinRoomError', handleJoinRoomError);

    return () => {
      socket.emit('leaveRoom');
      socket.off('updateGameState', handleUpdateGameState);
      socket.off('chatMessage', handleChatMessage);
      socket.off('dealPrivateCards', handleDealPrivateCards);
      socket.off('joinRoomError', handleJoinRoomError);

      // 🍏 방을 나갈 때 BGM 즉시 중단 및 리소스 해제
      if (bgmRef.current) {
        bgmRef.current.pause();
        bgmRef.current.src = '';
      }
    };
  }, [roomId, userInfo?.nickname]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatLogs]);

  // 🍏 본인 전용 실시간 족보 계산 로직 (서버 데이터 보완용)
  useEffect(() => {
    if (!myCards || myCards.length !== 2) {
      setLocalHandName('');
      return;
    }

    const commCards = gameState?.communityCards || [];
    try {
      if (commCards.length >= 3) {
        const solverMyCards = myCards.map(FORMAT_CARD_FOR_SOLVER);
        const solverCommCards = commCards.map(FORMAT_CARD_FOR_SOLVER);
        const allCards = [...solverMyCards, ...solverCommCards];

        if (allCards.length >= 5) {
          const solved = Hand.solve(allCards);
          if (solved) setLocalHandName(TRANSLATE_HAND(solved));
        }
      } else {
        // 프리플랍 등 보드 카드 부족 시 포켓 페어 체크
        const r0 = myCards[0].slice(1);
        const r1 = myCards[1].slice(1);
        const cleanR0 = r0 === '10' ? '10' : r0;
        const cleanR1 = r1 === '10' ? '10' : r1;

        if (r0 === r1) {
          setLocalHandName(`(${cleanR0}) 원페어`);
        } else {
          const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
          const topRank = ranks.indexOf(cleanR0) > ranks.indexOf(cleanR1) ? cleanR0 : cleanR1;
          setLocalHandName(`(${topRank}) 하이카드`);
        }
      }
    } catch (e) {
      setLocalHandName('');
    }
  }, [myCards, gameState?.communityCards]);



  const [isJoined, setIsJoined] = useState(false);

  useEffect(() => {
    if (!gameState && !isJoined) {
      const timer = setTimeout(() => {
        console.log("⏱️ GameState timeout - attempting re-join");
        socket.emit('joinRoom', { roomId: Number(roomId), nickname: userInfo?.nickname });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [gameState, isJoined, roomId, userInfo]);

  const sendChat = (e) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socket.emit('chatMessage', { roomId: Number(roomId), nickname: userInfo?.nickname, message: chatInput });
    setChatInput('');
  };

  const handleAction = (action, val) => {
    if (!isMyTurn) return;
    let amt = val || 0;
    if (action === '레이즈' || action === '올인') {
      if (amt === 0 && action === '레이즈') return;
    }
    socket.emit('playerAction', { roomId: Number(roomId), nickname: userInfo?.nickname, action: action, amount: amt });
  };

  const handleRebuy = (decision) => {
    if (decision === 'yes') setShowRebuyBtn(false);
    socket.emit('rebuyDecision', { roomId: Number(roomId), nickname: userInfo?.nickname, decision });
  };

  // 🍏 팟 칩들의 시각적 위치 랜덤화 (메모이제이션으로 깜빡임 방지)
  const chipPositions = useMemo(() => {
    return Array.from({ length: 100 }, () => ({
      dx: Math.random() * 80 - 40,
      dy: Math.random() * 80 - 40,
      rot: Math.random() * 360
    }));
  }, []);

  const potChips = useMemo(() => {
    if (!gameState) return [];
    const pot = gameState.pot || 0;
    if (pot === 0) return [];
    const chips = [];
    let remaining = pot;
    for (const d of CHIP_DENOMS) {
      while (remaining >= d.value && chips.length < 30) {
        chips.push(d);
        remaining -= d.value;
      }
    }
    return chips;
  }, [gameState?.pot]);

  useEffect(() => {
    if (!gameState?.players) return;
    const newAnims = [];
    gameState.players.forEach(player => {
      const prev = prevBetAmountsRef.current[player.nickname] || 0;
      const curr = player.betAmount || 0;
      if (curr > prev && curr > 0 && !player.isFold) {
        const myIdxLocal = gameState.players.findIndex(p => p.nickname === userInfo?.nickname);
        const pIdx = gameState.players.findIndex(p => p.nickname === player.nickname);
        const relIdx = myIdxLocal > -1 ? (pIdx - myIdxLocal + gameState.players.length) % gameState.players.length : 0;
        const offset = (seatOffsets && seatOffsets.length > 0) ? seatOffsets[Math.min(relIdx, seatOffsets.length - 1)] : { x: 0, y: 0 };
        const addedAmt = curr - prev;
        const denom = CHIP_DENOMS.find(d => addedAmt >= d.value) || CHIP_DENOMS[CHIP_DENOMS.length - 1];
        const id = `${player.nickname}-${Date.now()}-${Math.random()}`;
        newAnims.push({ id, fromX: offset.x, fromY: offset.y, bg: denom.bg, border: denom.border });
      }
      prevBetAmountsRef.current[player.nickname] = curr;
    });
    if (newAnims.length > 0) {
      setBetAnimChips(prev => [...prev, ...newAnims]);
      setTimeout(() => {
        setBetAnimChips(prev => prev.filter(c => !newAnims.some(n => n.id === c.id)));
      }, 900);
    }
  }, [(gameState?.players || []).map(p => p.betAmount).join(','), userInfo?.nickname, gameState?.players]);

  const minRaise = gameState?.currentBet === 0 ? 100 : ((gameState?.currentBet || 0) + 100) - (myInfo?.betAmount || 0);
  const callAmount = (gameState?.currentBet || 0) - (myInfo?.betAmount || 0);
  const isAllInCall = (myInfo?.chips || 0) <= callAmount;
  const callText = callAmount === 0 ? '체크' : isAllInCall ? `올인 (${myInfo?.chips})` : `콜 (${callAmount})`;

  const handleKeyDown = (e) => {
    // 🍏 1. 채팅창 관련 단축키 (차례나 커서 활성화 여부와 무관하게 최우선 처리)
    if (showChatModal && e.key === 'Escape') {
      e.preventDefault();
      setShowChatModal(false);
      return;
    }

    if (!showChatModal && !showRaisePanel && e.key === 'Enter') {
      e.preventDefault();
      setShowChatModal(true);
      setHasNewMessage(false);
      return;
    }

    // 🍏 2. 게임 액션 단축키 (커서 활성화 시 중단, 내 차례일 때만 작동)
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    if (!isMyTurn) return;

    if (showRaisePanel) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setRaiseAmount(prev => Math.min(myInfo?.chips || 0, prev + 500));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setRaiseAmount(prev => Math.max(Math.min(minRaise, myInfo?.chips || 0), prev - 500));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleAction(raiseAmount === myInfo?.chips ? '올인' : '레이즈', raiseAmount);
        setShowRaisePanel(false);
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        setShowRaisePanel(false);
      }
    } else {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleAction('폴드');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleAction('콜');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (!isAllInCall) {
          setRaiseAmount(Math.min(minRaise, myInfo?.chips || 0));
          setShowRaisePanel(true);
        }
      }
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMyTurn, showRaisePanel, showChatModal, raiseAmount, minRaise, myInfo?.chips, isAllInCall]);

  // ⚙️ 방 설정 변경 요청
  const updateSettings = (newSettings) => {
    const updated = { ...tempSettings, ...newSettings };
    setTempSettings(updated);
    socket.emit('updateRoomSettings', { roomId, settings: updated });
  };

  if (!userInfo) return <Navigate to="/" replace />;
  if (!gameState) return <div className="center-container">방 정보를 불러오는 중...</div>;

  let isGameOver = false;
  let myIdx = -1;
  let winnerNicknames = [];
  let winnerTransforms = [];
  let sortedPlayers = [];
  let sweepCoords = [];

  try {
    isGameOver = gameState?.phase?.includes('🏆') || gameState?.phase?.includes('종료') || false;
    myIdx = gameState?.players?.findIndex(p => p.nickname === userInfo?.nickname) ?? -1;
    // 👑 진짜 최고 패를 가진 승자에게만 왕관을 씌움
    winnerNicknames = (gameState?.lastWinners || []).filter(w => w.isTrueWinner).map(w => w.nickname);

    // 🍏 [신규] 8인용 통합 좌표계를 sweepCoords에 자동 동기화
    sweepCoords = seatOffsets.map(o => ({ wx: `${o.x}px`, wy: `${o.y}px` }));

    winnerTransforms = winnerNicknames.map(wNick => {
      const wIdx = gameState?.players?.findIndex(p => p.nickname === wNick) ?? -1;
      if (wIdx < 0 || myIdx < 0) return sweepCoords[0];
      const relIdx = (wIdx - myIdx + gameState.players.length) % gameState.players.length;
      return sweepCoords[relIdx] || sweepCoords[0];
    });

    const localStore = localStorage.getItem('holdem_user');
    let localNick = '';
    if (localStore) {
      try {
        const parsed = JSON.parse(localStore);
        localNick = parsed.nickname?.trim() || '';
      } catch (e) {
        localNick = String(localStore).trim();
      }
    }
    const currentLocalNickname = userInfo?.nickname?.trim() || localNick;
    const myIndex = gameState?.players?.findIndex(p => p.nickname?.trim() === currentLocalNickname) ?? -1;

    if (myIndex > -1 && gameState?.players) {
      for (let i = 0; i < gameState.players.length; i++) {
        sortedPlayers.push(gameState.players[(myIndex + i) % gameState.players.length]);
      }
    } else {
      sortedPlayers.push(...(gameState?.players || []));
    }
  } catch (err) {
    console.error("Critical Render Error in GameRoom:", err);
  }

  return (
    <div className="game-layout-wrapper">
      <div className={`game-header glass-panel ${isMobile ? 'mobile-compact-header' : ''}`} style={{
        marginBottom: isMobile ? '0' : '15px',
        padding: isMobile ? '2px 10px' : '10px 15px',
        marginTop: isMobile ? '12px' : '0' /* 🍏 여백을 더 극단적으로 줄임 */
      }}>
        <div className="header-top-row" style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="back-btn" onClick={() => { socket.emit('leaveRoom'); navigate('/lobby'); }} style={{ fontSize: isMobile ? '12px' : '14px' }}>← 나가기</div>

          <div className="header-right-controls" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button className="settings-gear-btn" onClick={() => setShowSettings(true)} title="방 설정" style={{ fontSize: isMobile ? '16px' : '18px', background: 'none', border: 'none', cursor: 'pointer', padding: isMobile ? '2px' : '5px' }}>
              ⚙️
            </button>

            {(gameState.phase === '대기 중' || gameState.phase.includes('종료') || gameState.phase.includes('기권승')) ? (
              <div
                className={`header-menu auto-toggle-btn ${gameState.isAutoMode ? 'auto-on' : 'auto-off'}`}
                onClick={() => socket.emit('toggleAutoMode', { roomId: Number(roomId) })}
                style={{ position: 'relative', minWidth: isMobile ? '90px' : '120px', padding: isMobile ? '4px 8px' : '8px 15px' }}
              >
                <div className="btn-main-text" style={{ fontSize: isMobile ? '10px' : '14px', display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <span>{gameState.isAutoMode ? '⏹️ 자동 중' : '▶️ 자동 시작'}</span>
                  {gameState.isAutoMode && countdown !== null && <span className="btn-countdown-inline">({countdown}s)</span>}
                </div>
              </div>
            ) : (
              <div className="header-menu disabled" style={{ opacity: 0.5, cursor: 'not-allowed', background: '#475569', minWidth: isMobile ? '90px' : '120px', padding: isMobile ? '4px 8px' : '8px 15px' }}>
                <span style={{ fontSize: isMobile ? '10px' : '14px' }}>🚀 진행 중</span>
              </div>
            )}
          </div>
        </div>

        <div className="header-title-row" style={{
          marginTop: '0',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isMobile ? 'flex-start' : 'center' /* PC 환경 중앙 정렬 복구 */
        }}>
          <div className="header-title" style={{ fontSize: isMobile ? '0.7rem' : '1rem', color: 'rgba(255,255,255,0.6)' }}>
            {roomTitle} ({gameState.players.length}/8)
          </div>
        </div>
      </div>

      <div className="game-main-area">


        <div className="mini-chat-container" onClick={() => { setShowChatModal(true); setHasNewMessage(false); }}>
          {chatLogs.slice(isMobile ? -2 : -3).length > 0 ? chatLogs.slice(isMobile ? -2 : -3).map((log, i) => (
            <div key={i} className={`mini-chat-line ${log.sender === '시스템' ? 'sys' : ''}`}>
              {log.sender === '시스템' ? log.text : `${log.sender}: ${log.text}`}
            </div>
          )) : <div className="mini-chat-line">대화가 없습니다.</div>}
        </div>

        <div className="table-area">
          <div
            ref={containerRef}
            className="poker-table-border"
            style={{
              position: 'absolute',
              top: isMobile ? '37%' : '44%', // 🃏 모바일 테이블을 아래로 약 7%(버튼 높이) 이동
              left: isMobile ? '44%' : '48%',
              transform: 'translate(-50%, -50%)',
              width: isMobile ? '460px' : '710px',
              height: isMobile ? '550px' : '462px', // 🃏 모바일 높이 다시 40px 확대 (510px -> 550px)
              borderRadius: isMobile ? '180px' : '231px',
              backgroundColor: 'rgba(0,0,0,0.2)',
              border: '6px solid rgba(255,255,255,0.15)',
              boxShadow: 'inset 0 0 50px rgba(0,0,0,0.5)',
              pointerEvents: 'none',
              zIndex: 0,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center'
            }}
          >
            <div className="pill-table" style={{ pointerEvents: 'auto', position: 'relative' }}>
              <div className="table-center-info">
                <div className="table-text" style={{ fontSize: '18px', fontWeight: '800', color: '#fff', textShadow: '0 2px 4px rgba(0,0,0,0.5)', letterSpacing: '-0.5px' }}>
                  {gameState?.lastAction || gameState?.phase}
                </div>
                <div className="pot-display" style={{ marginTop: '5px', fontSize: '24px', fontWeight: 'bold', color: '#facc15', textShadow: '0 2px 4px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>

                  <div className="pot-chips-container relative-pot-chips" style={{ position: 'relative', width: '40px', height: '40px', left: '0', top: '0', transform: 'none', zIndex: 1 }}>
                    {potChips.map((chip, i) => {
                      const pos = chipPositions[i] || { dx: 0, dy: 0, rot: 0 };
                      const sweepStyle = isGameOver && winnerTransforms.length > 0 ? {
                        animation: winnerTransforms.map((wt, wi) => `winnerSweep 0.9s ${wi * 0.05}s forwards cubic-bezier(0.8,-0.6,0.2,1.5)`).join(', '),
                        '--wx': winnerTransforms[0]?.wx, '--wy': winnerTransforms[0]?.wy,
                      } : { animation: `dropChip 0.3s ease-out ${i * 0.04}s both` };
                      return (
                        <div key={`pot-${i}-${gameState?.pot}`} className="chip" style={{ '--dx': `${pos.dx / 4}px`, '--dy': `${pos.dy / 4}px`, '--rot': `${pos.rot}deg`, '--wx': winnerTransforms[0]?.wx || '0px', '--wy': winnerTransforms[0]?.wy || '0px', width: '18px', height: '18px', backgroundColor: chip.bg, borderColor: chip.border, ...sweepStyle }} />
                      );
                    })}
                  </div>

                  POT: <span>{gameState?.pot || 0}</span>
                </div>

                <div className="community-cards" style={{ display: 'flex', gap: '12px', zIndex: 10, position: 'relative', marginTop: '15px', transform: isMobile ? 'scale(1.15)' : 'scale(1.4)', transformOrigin: 'center', width: 'max-content', justifyContent: 'center', margin: '15px auto 0' }}>
                  {gameState?.communityCards?.map((card, idx) => {
                    const phase = gameState.phase || '';
                    const isEndPhase = phase.includes('쇼다운') || phase.includes('종료');
                    const preCount = preShowdownCardCountRef.current;
                    const isNewlyRevealed = isEndPhase && idx >= preCount;
                    let fDelay = '0s';
                    let innerClassName = 'flip-card-inner';
                    let animationOverride = {};
                    const isAlreadyRevealed = revealedIndicesRef.current.has(idx);
                    const firstSeenInPhase = revealedPhaseRecordRef.current[idx];

                    if (isNewlyRevealed) {
                      innerClassName += ' showdown-flip';
                      revealedIndicesRef.current.add(idx);
                      revealedPhaseRecordRef.current[idx] = phase;
                      if (idx <= 2) fDelay = '0s';
                      else if (idx === 3) fDelay = '1s';
                      else if (idx === 4) fDelay = preCount <= 3 ? '2.5s' : '1.5s';
                    } else if (isAlreadyRevealed && firstSeenInPhase !== phase || isEndPhase && !isNewlyRevealed) {
                      animationOverride = { animation: 'none !important', transition: 'none !important', transform: 'rotateY(180deg)' };
                    } else {
                      innerClassName += ' normal-reveal-anim';
                      revealedIndicesRef.current.add(idx);
                      revealedPhaseRecordRef.current[idx] = phase;
                      if (idx < 3) fDelay = `${idx * 0.3}s`;
                      else fDelay = '0s';
                    }

                    return (
                      <div key={`c-${idx}-${card}`} className="flip-card-container reveal" style={{ '--idx': idx, '--f-delay': fDelay }}>
                        <div className={innerClassName} style={animationOverride}>
                          <div className="flip-card-back"></div>
                          <div className="flip-card-front" style={{ padding: 0, overflow: 'hidden', border: 'none' }}>
                            <PlayingCard card={card} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

              </div>
            </div>

            {betAnimChips.map(c => (
              <div key={c.id} className="bet-anim-chip" style={{ '--from-x': `${c.fromX}px`, '--from-y': `${c.fromY}px`, background: c.bg, border: `3px dashed ${c.border}` }} />
            ))}

            {/* 🍏 기존 중앙 pot-chips-container 제거됨 (위 pot-display 내부로 이동) */}

            {sortedPlayers.map((player, idx) => {
              // 🍏 [신규] 8인용 통합 좌표 레이아웃 엔진 적용
              const offset = seatOffsets[Math.min(idx, seatOffsets.length - 1)] || seatOffsets[0];

              const isMe = (player.nickname === userInfo?.nickname);
              const isActiveTurn = (gameState.turnNickname === player.nickname && !gameState.phase.includes('종료') && !gameState.isBlockingAction);

              // 각 좌석 인덱스별로 카드가 아바타를 가리지 않도록 좌/우 배치 분기
              let cardContainerStyle = {
                position: 'absolute',
                top: '50%',
                bottom: 'auto',
                right: 'auto',
                left: 'auto',
                transform: 'translateY(-50%)'
              };

              if (idx === 0) { // 6시 (나) - 우측 배치 및 70% 축소
                cardContainerStyle = {
                  left: '85%',
                  top: '50%',
                  bottom: 'auto',
                  right: 'auto',
                  transform: 'translateY(-50%) scale(0.7)',
                  transformOrigin: 'left center',
                  alignItems: 'flex-start'
                };
              } else if (idx === 1 || idx === 2 || idx === 3) {
                // 7시, 9시, 11시 플레이어 -> 아바타 오른쪽에 패 표시 (충분한 간격 확보)
                cardContainerStyle = { ...cardContainerStyle, left: '85%', alignItems: 'flex-start' };
              } else {
                // 12시, 1시, 3시, 5시 플레이어 -> 아바타 왼쪽에 패 표시 (충분한 간격 확보)
                cardContainerStyle = { ...cardContainerStyle, right: '85%', alignItems: 'flex-end' };
              }

              return (
                <div
                  className={`player-seat ${player.isFold ? 'folded' : ''}`}
                  key={player.nickname}
                  style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }}
                >
                  {player.betAmount > 0 && <div className="bet-chip-bubble">🪙 {player.betAmount}</div>}
                  <div className={`avatar-circle ${isActiveTurn ? 'active-turn' : ''} ${player.spectator ? 'spectator' : ''}`}>
                    {isGameOver && winnerNicknames.includes(player.nickname) && (
                      <div className="winner-crown-badge">👑</div>
                    )}
                    {player.role && <div className="role-badge">{player.role}</div>}
                    <div className="avatar-img">👤</div>
                  </div>
                  <div className="player-info-tag">
                    <span className="p-name">{player.nickname}</span>
                    <div className="p-chips-row">
                      <span className="p-chips">{player.chips}</span>
                      <span className="p-rebuy">(R:{player.rebuyCount || 0})</span>
                    </div>
                  </div>

                  {/* 본인이거나 폴드하지 않았거나 쇼다운인 경우 카드 영역 표시 */}
                  {((isMe || !player.isFold) || gameState.phase === '쇼다운' || gameState.phase.includes('종료')) && !player.spectator && gameState.phase !== '대기 중' && (
                    <div
                      className={`player-cards ${player.isFold ? 'folded-cards' : ''} ${isMe ? 'is-local-player' : ''}`}
                      style={isMe ? { opacity: player.isFold ? 0.6 : 1 } : cardContainerStyle}
                    >
                      {/* 내 패 공개 버튼 */}
                      {isMe && !player.isRevealed && (gameState.phase === '쇼다운' || gameState.phase.includes('종료')) && (
                        <button className="reveal-btn animate-fade-in" onClick={() => socket.emit('revealCards', { roomId: Number(gameState.roomId || roomId), nickname: player.nickname })}>🔓 OPEN</button>
                      )}

                      {/* 카드 렌더링 (내 카드 우선) */}
                      {isMe && myCards && myCards.length > 0 ? (
                        <>
                          <div className="my-hand-container">
                            <div className="my-cards-row">
                              <PlayingCard card={myCards[0]} className="mine" />
                              <PlayingCard card={myCards[1]} className="mine" />
                            </div>
                            {/* 내 전용 실시간 족보 (카드 아래 위치) */}
                            <div className="local-hand-rank-box animate-fade-in">
                              {localHandName || player.currentHandName || '분석 중...'}
                            </div>
                          </div>
                        </>
                      ) : (player.privateCards && player.privateCards.length > 0) ? (
                        <div className="my-hand-container">
                          <div className="my-cards-row">
                            <PlayingCard card={player.privateCards[0]} className="mine" />
                            <PlayingCard card={player.privateCards[1]} className="mine" />
                          </div>
                          {/* 상대방 공개 족보 (카드 아래 위치) */}
                          {player.currentHandName && (
                            <div className="local-hand-rank-box animate-fade-in others">
                              {player.currentHandName}
                            </div>
                          )}
                        </div>
                      ) : !player.isFold ? (
                        <div className="card-back-group">
                          <div className="card-back hidden-card" style={{ '--idx': 0 }}></div>
                          <div className="card-back hidden-card" style={{ '--idx': 1 }}></div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
            {/* 🍏 액션 말풍선 렌더링 섹션 */}
            {actionBubbles.map(b => (
              <div
                key={b.id}
                className={`action-bubble ${b.action === '올인' ? 'bubble-allin' : ''} action-${b.label.toLowerCase().replace('-bet', 'bet')}`}
                style={{
                  left: `calc(50% + ${b.x}px)`,
                  top: `calc(50% + ${b.y}px)`,
                  '--tx': `${-b.x * 0.4}px`,
                  '--ty': `${-b.y * 0.4}px`
                }}
              >
                {b.label}
              </div>
            ))}
          </div>
        </div>

      </div> {/* game-main-area END */}

      <div className={`bottom-action-bar ${isMobile ? 'mobile-two-row-bar' : ''}`}>
        {/* 🍏 리바인/참여대기 버튼: 왼쪽 하단(폴드 버튼 상단)으로 재배치 */}
        {(showRebuyBtn || myInfo?.waitingForNext) && (
          <div className="function-row" style={{
            display: 'flex',
            gap: '6px',
            marginBottom: '6px',
            justifyContent: isMobile ? 'flex-start' : 'center',
            paddingLeft: isMobile ? '15px' : '0'
          }}>
            {showRebuyBtn && !myInfo?.waitingForNext && (
              <button className="premium-btn primary-btn active-pulse rebuy-btn-compact" onClick={() => { setShowRebuyBtn(false); socket.emit('spectatorRebuy', { roomId: Number(roomId), nickname: userInfo.nickname }); }}>리바인</button>
            )}
            {myInfo?.waitingForNext && (
              <button className="action-btn disabled waiting-btn-compact" disabled>중간 참여 대기</button>
            )}
          </div>
        )}

        {/* 🍏 하단층: 폴드, 콜, 레이즈 고정 배치 */}
        <div className="action-row" style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button className={`action-btn fold ${!isMyTurn ? 'disabled' : ''}`} disabled={!isMyTurn} onClick={() => handleAction('폴드')}>폴드</button>
          <button className={`action-btn call ${!isMyTurn ? 'disabled' : ''}`} disabled={!isMyTurn} onClick={() => handleAction('콜')}>{callText}</button>
          <button className={`action-btn raise ${(!isMyTurn || isAllInCall) ? 'disabled' : ''}`} disabled={!isMyTurn || isAllInCall} onClick={() => { setRaiseAmount(Math.min(minRaise, myInfo?.chips || 0)); setShowRaisePanel(true); }}>레이즈</button>
        </div>
      </div>

      {(gameState.isBlockingAction || amIDecidingRebuy) && (
        <div className="blocking-overlay">
          {amIDecidingRebuy ? (
            <div className={`rebuy-box glass-panel ${gameState?.phase?.includes('종료') ? 'delayed-popup' : ''}`}>
              <h3>칩이 모두 소진되었습니다!</h3>
              <p>다시 칩을 구매(리바인)하여 계속하시겠습니까?</p>
              <button className="premium-btn success-btn" onClick={(e) => { if (popupLockRef.current) return; popupLockRef.current = true; e.currentTarget.disabled = true; e.currentTarget.innerText = "처리 중..."; handleRebuy('yes'); }}>예 (리바인)</button>
              <button className="premium-btn secondary-btn" onClick={(e) => { if (popupLockRef.current) return; popupLockRef.current = true; e.currentTarget.disabled = true; e.currentTarget.innerText = "처리 중..."; handleRebuy('no'); }} style={{ marginLeft: '10px' }}>관전 모드 전환</button>
            </div>
          ) : (
            <div className={`rebuy-box glass-panel ${gameState?.phase?.includes('종료') ? 'delayed-popup' : ''}`}>
              <p>잠시만 기다려주세요, 누군가 리바인 여부를 결정 중입니다...</p>
            </div>
          )}
        </div>
      )}

      {showRaisePanel && (
        <div className="raise-panel-modal">
          <div className="raise-box glass-panel" style={{ width: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h4 style={{ margin: '0' }}>레이즈 금액 설정</h4>
            <div className="raise-amount-display" style={{ margin: '15px 0', fontSize: '24px', color: '#facc15', fontWeight: 'bold' }}>{raiseAmount}</div>
            <div style={{ display: 'flex', width: '100%', justifyContent: 'space-around', alignItems: 'center', height: '180px' }}>
              <div style={{ display: 'flex', height: '100%', alignItems: 'center' }}>
                <input type="range" className="raise-slider" style={{ WebkitAppearance: 'slider-vertical', writingMode: 'bt-lr', height: '150px', cursor: 'grab' }} min={Math.min(minRaise, myInfo?.chips || 0)} max={myInfo?.chips || 1000} step="100" value={raiseAmount} onChange={(e) => setRaiseAmount(Number(e.target.value))} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[1000, 500, 100].map(amt => (
                  <div key={amt} style={{ display: 'flex', gap: '6px' }}>
                    <button className="premium-btn danger-btn" style={{ padding: '8px 12px', fontSize: '13px', flex: 1 }} onClick={() => setRaiseAmount(prev => Math.max(Math.min(minRaise, myInfo?.chips || 0), prev - amt))}>-{amt}</button>
                    <button className="premium-btn" style={{ padding: '8px 12px', fontSize: '13px', flex: 1 }} onClick={() => setRaiseAmount(prev => Math.min(myInfo?.chips || 0, prev + amt))}>+{amt}</button>
                  </div>
                ))}
                <button className="premium-btn" style={{ padding: '8px 12px', fontSize: '13px', backgroundColor: '#eab308', color: '#000', fontWeight: 'bold', textShadow: 'none', marginTop: '4px' }} onClick={() => setRaiseAmount(myInfo?.chips || 0)}>최대 (올인)</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', width: '100%', justifyContent: 'center' }}>
              <button className="premium-btn danger-btn" onClick={() => setShowRaisePanel(false)}>취소</button>
              <button className={`premium-btn ${raiseAmount === myInfo?.chips ? '' : 'primary-btn active-pulse'}`} style={raiseAmount === myInfo?.chips ? { backgroundColor: '#ef4444', color: '#fff', fontWeight: 'bold', animation: 'pulse 1.5s infinite' } : {}} onClick={() => { handleAction(raiseAmount === myInfo?.chips ? '올인' : '레이즈', raiseAmount); setShowRaisePanel(false); }}>{raiseAmount === myInfo?.chips ? '올인 확정' : '레이즈 확정'}</button>
            </div>
          </div>
        </div>
      )}

      {showChatModal && (
        <div className="chat-modal-overlay" onClick={() => setShowChatModal(false)}>
          <div className="chat-modal-content glass-panel animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="chat-modal-header"><div className="chat-modal-title">💬 실시간 채팅</div><button className="premium-btn danger-btn" style={{ padding: '5px 12px' }} onClick={() => setShowChatModal(false)}>닫기</button></div>
            <div className="chat-log-box" style={{ flex: 1, padding: '15px' }}>
              {chatLogs.map((log, idx) => (
                <div key={idx} className={`chat-line ${log.sender === '시스템' ? 'sys' : ''}`}>
                  {log.sender === '시스템' ? <span>{log.text}</span> : <span><b>{log.sender}:</b> {log.text}</span>}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={sendChat} className="chat-input-form" style={{ padding: '15px' }}>
              <input type="text" className="premium-input chat-input" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="메시지 입력..." autoFocus />
              <button type="submit" className="premium-btn primary-btn chat-send-btn">전송</button>
            </form>
          </div>
        </div>
      )}

      {/* ⚙️ 방 설정 모달 */}
      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-modal glass-panel animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <h3>⚙️ 방 옵션 설정</h3>
              <button className="premium-btn danger-btn" onClick={() => setShowSettings(false)}>×</button>
            </div>

            <div className="settings-body">
              <section className="settings-section">
                <label>🎵 배경음(BGM) 볼륨 ({Math.round(bgmVolume * 100)}%)</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={bgmVolume}
                  onChange={(e) => setBgmVolume(Number(e.target.value))}
                />
              </section>

              <section className="settings-section">
                <label>🔊 효과음(SFX) 볼륨 ({Math.round(sfxVolume * 100)}%)</label>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={sfxVolume}
                  onChange={(e) => setSfxVolume(Number(e.target.value))}
                />
              </section>

              <div className="settings-divider" />

              <section className="settings-section">
                <label>⏱️ 자동 시작 대기 시간 ({(tempSettings.autoStartDelay || 5000) / 1000}초)</label>
                <input
                  type="range" min="3000" max="15000" step="1000"
                  value={tempSettings.autoStartDelay}
                  onChange={(e) => updateSettings({ autoStartDelay: Number(e.target.value) })}
                />
                <small style={{ color: '#94a3b8', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                  * 쇼다운 시 카드 공개를 위해 3초가 추가로 대기됩니다.
                </small>
              </section>

              <div className="settings-divider" />

              <section className="settings-section">
                <label>💰 블라인드 설정 (SB / BB)</label>
                <div className="blind-inputs-row">
                  <input
                    type="number" className="premium-input" placeholder="SB"
                    value={tempSettings.sb}
                    onChange={(e) => updateSettings({ sb: Number(e.target.value) })}
                  />
                  <span style={{ color: '#94a3b8' }}>/</span>
                  <input
                    type="number" className="premium-input" placeholder="BB"
                    value={tempSettings.bb}
                    onChange={(e) => updateSettings({ bb: Number(e.target.value) })}
                  />
                </div>
              </section>
            </div>

            <div className="settings-footer">
              <button className="premium-btn primary-btn" style={{ width: '100%' }} onClick={() => setShowSettings(false)}>
                설정 완료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GameRoom;
