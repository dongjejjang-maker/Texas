const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
// 🔄 Manual Restart Trigger: 2026-04-27
const mongoose = require('mongoose'); // 🍏 DB 연동용
const Hand = require('pokersolver').Hand;

// 🔒 서버 비정상 종료 방지를 위한 전역 에러 핸들러
process.on('uncaughtException', (err) => {
    console.error('🔥 CRITICAL ERROR (uncaughtException):', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('🌊 UNHANDLED REJECTION:', reason);
});

// 🍏 MongoDB 연결 설정 (Render 환경변수 MONGODB_URI 사용)
const MONGODB_URI = process.env.MONGODB_URI;
let useMongoDB = false;

if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
        .then(() => {
            console.log('✅ MongoDB Atlas Connected!');
            useMongoDB = true;
        })
        .catch(err => console.error('❌ MongoDB Connection Error:', err));
} else {
    console.warn('⚠️ MONGODB_URI not found. Using local users.json.');
}

// 🍏 User 스키마 정의
const userSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    nickname: { type: String, required: true, unique: true },
    chips: { type: Number, default: 0 },
    rebuyCount: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(cors());

// 🍏 [최상단 배치] 서버 생존 확인용 헬스체크 (Hanging 방지용)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// 🔍 접속 및 응답 모니터링 미들웨어 (Stability)
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// --- 0. 최우선 정적 파일 직접 서빙 (Hanging 방지) ---
const DIST_PATH = path.resolve(__dirname, 'client/dist');

// 빌드 결과물이 있는지 초기 체크 (디버깅용)
if (!fs.existsSync(path.join(DIST_PATH, 'index.html'))) {
    console.warn('⚠️ WARNING: client/dist/index.html not found. Did the build fail?');
}

app.use(express.static(DIST_PATH));

// 🔍 빌드 폴더 진단 로그
console.log('--- [STARTUP DIAGNOSIS] ---');
console.log('Current __dirname:', __dirname);
console.log('Target DIST_PATH:', DIST_PATH);
try {
    if (fs.existsSync(DIST_PATH)) {
        const files = fs.readdirSync(DIST_PATH);
        console.log('Files in client/dist:', files.length > 0 ? files.join(', ') : 'EMPTY');
    } else {
        console.warn('❌ [DIAGNOSIS ERROR]: client/dist folder does not exist!');
    }
} catch (e) {
    console.error('❌ [DIAGNOSIS ERROR]: Unable to read client/dist folder', e);
}
console.log('---------------------------');

app.get('/', (req, res) => {
    const indexPath = path.join(DIST_PATH, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Frontend build not found. Please check deployment logs.');
    }
});

// 🔍 가동 확인용 헬스체크 추가
app.get('/api/ping', (req, res) => {
    res.send('pong - ' + new Date().toLocaleTimeString());
});

// --- 파일 기반 영구 저장소 (DB 대체) ---
const DB_FILE = path.join(__dirname, 'users.json');

function loadDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), 'utf8');
        }
        const data = fs.readFileSync(DB_FILE, 'utf8');
        if (!data || data.trim() === "") return [];
        return JSON.parse(data);
    } catch (e) {
        console.error("❌ DB 로드 실패 (파일 손상 가능성):", e.message);
        // 비상 상황: 빈 배열을 반환하기 전에 메모리에 오류 로그를 남기고
        // 절대 saveDB가 호출되지 않도록 방어 로직이 필요할 수 있습니다.
        return []; 
    }
}

function saveDB(users, specificUsers = null) {
    const TMP_FILE = DB_FILE + '.tmp';
    try {
        // 1. 로컬 파일 저장 (Atomic)
        fs.writeFileSync(TMP_FILE, JSON.stringify(users, null, 2), 'utf8');
        fs.renameSync(TMP_FILE, DB_FILE);
    } catch (e) {
        console.error("❌ DB 파일 저장 오류:", e);
    }

    // 2. MongoDB 동기화 (비동기) - 🍏 최적화: 변경된 유저들만 업데이트
    if (useMongoDB) {
        (async () => {
            try {
                const targetUsers = specificUsers || users;
                const bulkOps = targetUsers.map(u => ({
                    updateOne: {
                        filter: { id: u.id },
                        update: { $set: { password: u.password, nickname: u.nickname, chips: u.chips, rebuyCount: u.rebuyCount } },
                        upsert: true
                    }
                }));
                if (bulkOps.length > 0) await User.bulkWrite(bulkOps);
            } catch (err) {
                console.error("❌ MongoDB Sync Error:", err);
            }
        })();
    }
}

let usersDB = []; // 🍏 메모리 캐시
const roomsDB = []; 
let roomIdCounter = 1;

// 🍏 서버 가동 시 DB에서 유저 데이터 로드 (초기화)
if (MONGODB_URI) {
    (async () => {
        try {
            const users = await User.find({});
            if (users.length > 0) {
                usersDB = users.map(u => ({
                    id: u.id,
                    password: u.password,
                    nickname: u.nickname,
                    chips: u.chips,
                    rebuyCount: u.rebuyCount
                }));
                console.log(`✅ Loaded ${usersDB.length} users from MongoDB Atlas.`);
            } else {
                usersDB = loadDB(); // DB가 비었으면 파일에서 로드
                console.log('ℹ️ MongoDB is empty. Migrating from users.json...');
                if (usersDB.length > 0) {
                    saveDB(usersDB); // 🍏 DB로 즉시 마이그레이션 실행
                    console.log(`✅ Successfully migrated ${usersDB.length} users to MongoDB.`);
                }
            }
        } catch (err) {
            console.error('❌ Failed to sync with MongoDB on startup:', err);
            usersDB = loadDB();
        }
    })();
} else {
    usersDB = loadDB();
}

const gameStates = {};

const suits = ['s', 'h', 'd', 'c']; 
const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

function formatCardForUI(cardStr) {
    const s = cardStr.charAt(1);
    const r = cardStr.charAt(0) === 'T' ? '10' : cardStr.charAt(0);
    if (s === 's') return `♠${r}`;
    if (s === 'h') return `♥${r}`;
    if (s === 'd') return `♦${r}`;
    if (s === 'c') return `♣${r}`;
    return cardStr;
}

function createDeck() {
    const deck = [];
    for (let c of suits) {
        for (let r of ranks) {
            deck.push(`${r}${c}`);
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// --- API Router ---

// --- [수정] 회원가입 API (Async/DB 연동) ---
app.post('/api/signup', async (req, res) => {
    const { id, password, nickname } = req.body;
    try {
        // 메모리 데이터 우선 검사 (빠른 응답)
        if (usersDB.find(u => u.id === id)) return res.status(400).json({ success: false, message: "이미 가입되어 있는 아이디입니다." });
        if (usersDB.find(u => u.nickname === nickname)) return res.status(400).json({ success: false, message: "이미 사용 중인 닉네임입니다." });

        const newUser = { 
            id, 
            password, 
            nickname: nickname || `User${Math.floor(Math.random() * 1000)}`, 
            chips: 0, 
            rebuyCount: 0 
        };
        
        usersDB.push(newUser);
        saveDB(usersDB, [newUser]); // 🍏 전체가 아닌 신규 유저만 DB 전송
        res.json({ success: true, message: "회원가입 완료!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "회원가입 처리 중 오류 발생" });
    }
});

// --- [수정] 로그인 API (Async/DB 연동) ---
app.post('/api/login', async (req, res) => {
    console.log(`[API] LOGIN TRY - ID: ${req.body.id}`);
    const { id, password } = req.body;
    
    try {
        // DB 모드일 경우 최신 데이터를 위해 DB에서 직접 확인
        let user;
        if (useMongoDB) {
            user = await User.findOne({ id, password });
        } else {
            user = usersDB.find(u => u.id === id && u.password === password);
        }

        if (user) {
            console.log(`[API] LOGIN SUCCESS - Nickname: ${user.nickname}`);
            // 메모리 캐시 동기화
            const cacheIdx = usersDB.findIndex(u => u.id === id);
            if (cacheIdx > -1) {
                usersDB[cacheIdx].chips = user.chips;
                usersDB[cacheIdx].rebuyCount = user.rebuyCount;
            }
            res.json({ success: true, user: { id: user.id, nickname: user.nickname, chips: user.chips, rebuyCount: user.rebuyCount } });
        } else {
            console.log(`[API] LOGIN FAILED - ID: ${id}`);
            res.status(401).json({ success: false, message: "아이디 또는 비밀번호가 틀렸습니다." });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: "로그인 중 오류 발생" });
    }
});

app.post('/api/changeNickname', (req, res) => {
    let users = usersDB;
    const { id, currentNickname, newNickname } = req.body;
    if (users.find(u => u.nickname === newNickname)) return res.status(400).json({ success: false, message: "이미 존재하는 닉네임입니다." });

    const userIndex = users.findIndex(u => u.id === id);
    if (userIndex > -1) {
        users[userIndex].nickname = newNickname;
        saveDB(users, [users[userIndex]]); // 🍏 변경된 유저만 업데이트
        res.json({ success: true, nickname: newNickname });
    } else {
        res.status(401).json({ success: false, message: "사용자를 찾을 수 없습니다." });
    }
});

app.post('/api/resetRebuy', (req, res) => {
    let users = usersDB;
    const { id } = req.body;
    const userIndex = users.findIndex(u => u.id === id);
    if (userIndex > -1) {
        users[userIndex].rebuyCount = 0;
        saveDB(users, [users[userIndex]]); // 🍏 변경된 유저만 업데이트
        res.json({ success: true, rebuyCount: 0 });
    } else {
        res.status(401).json({ success: false, message: "사용자를 찾을 수 없습니다." });
    }
});

app.post('/api/rooms', (req, res) => {
    const { title, buyIn, maxPlayers, sb, bb } = req.body;
    // 🍏 8인용 통합 좌표 레이아웃 정합성을 위해 최대 인원을 8명으로 강제 제한
    const cappedMaxPlayers = Math.min(Number(maxPlayers) || 8, 8);
    const newRoom = { 
        id: roomIdCounter++, 
        title, 
        buyIn: Number(buyIn), 
        maxPlayers: cappedMaxPlayers, 
        sb: Number(sb), 
        bb: Number(bb), 
        currentPlayers: 0 
    };
    roomsDB.push(newRoom);
    console.log(`[CREATE_ROOM_DEBUG] Created Room ID: ${newRoom.id}, Title: ${title}`);

    gameStates[newRoom.id] = {
        roomId: newRoom.id,
        players: [], 
        phase: '대기 중',
        pot: 0,
        communityCards: [],
        deck: [],
        turnIndex: 0,
        dealerIndex: 0,
        currentBet: 0,
        isBlockingAction: false,
        isAutoMode: false, // 🍏 서버 사이드 자동 진행 모드
        autoStartDelay: 0,
        settings: {
            autoStartDelay: 5000,
            sb: Number(sb),
            bb: Number(bb)
        }
    };

    res.json({ success: true, room: newRoom });
    io.emit('lobbyUpdate', roomsDB);
});

app.get('/api/rooms', (req, res) => {
    res.json({ success: true, rooms: roomsDB });
});

// Socket.io 로직
io.on('connection', (socket) => {
    function handleLeave(socket) {
        if (!socket.roomId) return;
        const gs = gameStates[socket.roomId];
        if (gs) {
            const p = gs.players.find(x => x.socketId === socket.id);
            if (p) {
                p.isFold = true;
                p.spectator = true;
                p.socketId = null;
            }

            const rid = socket.roomId;
            const realPlayersCount = gs.players.filter(x => x.socketId !== null).length;
            const roomInfo = roomsDB.find(r => r.id === rid);
            if (roomInfo) {
                roomInfo.currentPlayers = realPlayersCount;
                if (realPlayersCount === 0) {
                    socket.roomId = null;
                    io.emit('lobbyUpdate', roomsDB);
                    setTimeout(() => {
                        const checkRoom = roomsDB.find(r => r.id === rid);
                        if (checkRoom && checkRoom.currentPlayers === 0) {
                            let roomIdx = roomsDB.findIndex(r => r.id === rid);
                            if (roomIdx > -1) roomsDB.splice(roomIdx, 1);
                            delete gameStates[rid];
                            io.emit('lobbyUpdate', roomsDB);
                        }
                    }, 1500);
                    return;
                }
                io.emit('lobbyUpdate', roomsDB);
            }

            if (p && gs.phase !== '대기 중' && !gs.phase.includes('종료')) {
                if (gs.players[gs.turnIndex] === p || gs.turnNickname === p.nickname) {
                    p.hasActed = true;
                    progressGameStage(gs, rid);
                } else {
                    const notFolded = gs.players.filter(p => !p.isFold);
                    if (notFolded.length === 0) {
                        gs.phase = '종료 (전원 퇴장)';
                        io.to(`room_${rid}`).emit('updateGameState', getPublicGameState(gs, socket.id));
                        setTimeout(() => resetGame(gs, rid), 5000);
                        return;
                    }
                    if (notFolded.length === 1) {
                        progressGameStage(gs, rid);
                    }
                }
            }

            if (gameStates[rid]) {
                io.to(`room_${rid}`).emit('updateGameState', getPublicGameState(gs, socket.id));
            }
            socket.leave(`room_${rid}`); // 🍏 확실히 소켓 룸에서 탈퇴
        }
        socket.roomId = null;
    }

    socket.on('joinLobby', () => {
        socket.emit('lobbyUpdate', roomsDB);
    });

    socket.on('joinRoom', ({ roomId, nickname }) => {
        const rId = Number(roomId); // 🍏 문자열로 들어오는 roomId를 숫자로 변환 (타입 일치)
        socket.roomId = rId;
        socket.nickname = nickname;
        socket.join(`room_${rId}`);
        const gs = gameStates[rId];
        const roomInfo = roomsDB.find(r => r.id === rId);
        let users = usersDB;
        let userDbInfo = users.find(u => u.nickname === nickname);

        console.log(`[JOIN_ROOM_DEBUG] RoomID: ${rId}, Nickname: ${nickname}`);
        console.log(` - gs exist: ${!!gs}`);
        console.log(` - roomInfo exist: ${!!roomInfo}`);
        console.log(` - userDbInfo exist: ${!!userDbInfo}`);

        if (gs && roomInfo && userDbInfo) {
            let p = gs.players.find(p => p.nickname === nickname);
            if (!p && gs.players.length < roomInfo.maxPlayers) {
                // 🍏 게임이 진행 중인지 확인
                const isGameInProgress = gs.phase !== '대기 중' && !gs.phase.includes('종료');
                
                gs.players.push({
                    socketId: socket.id,
                    nickname: nickname,
                    chips: roomInfo.buyIn,
                    role: '',
                    isFold: isGameInProgress, // 진행 중이면 폴드 상태로 시작
                    betAmount: 0,
                    totalContribution: 0,
                    hasActed: false,
                    privateCards: [],
                    spectator: isGameInProgress, // 진행 중이면 관전 모드
                    waitingForNext: isGameInProgress, // 진행 중이면 다음 판 참여 예약
                    decidingRebuy: false,
                    isRevealed: false,
                    rebuyCount: userDbInfo.rebuyCount
                });
                roomInfo.currentPlayers = gs.players.filter(x => x.socketId !== null).length;
                io.emit('lobbyUpdate', roomsDB);
                if (isGameInProgress) {
                    io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: `${nickname} 님이 입장하셨습니다. (다음 판부터 참여)` });
                } else {
                    io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: `${nickname} 님이 입장하셨습니다.` });
                }
            } else if (p) {
                p.socketId = socket.id;
                if (gs.phase === '대기 중') {
                    p.isFold = false;
                    p.spectator = false;
                }
                const roomInfoCheck = roomsDB.find(r => r.id === roomId);
                if (roomInfoCheck) {
                    roomInfoCheck.currentPlayers = gs.players.filter(x => x.socketId !== null).length;
                }
                io.emit('lobbyUpdate', roomsDB);
            }
            io.to(`room_${roomId}`).emit('updateGameState', getPublicGameState(gs, socket.id));
        } else {
            // 🍏 방 정보를 찾을 수 없는 경우 (서버 재시작 등) 에러 알림 전송
            socket.emit('joinRoomError', { message: '방이 존재하지 않거나 만료되었습니다.' });
        }
    });

    socket.on('leaveRoom', () => {
        handleLeave(socket);
    });

    socket.on('disconnect', () => {
        handleLeave(socket);
    });

    socket.on('chatMessage', ({ roomId, nickname, message }) => {
        io.to(`room_${roomId}`).emit('chatMessage', { sender: nickname, text: message });
    });

    socket.on('startGame', ({ roomId }) => {
        initiateNextHand(roomId);
    });

    // 🍏 [신규] 방 전체 자동 진행 토글
    socket.on('toggleAutoMode', ({ roomId }) => {
        const gs = gameStates[roomId];
        if (!gs) return;

        gs.isAutoMode = !gs.isAutoMode;
        console.log(`[ROOM ${roomId}] AutoMode Toggled: ${gs.isAutoMode}`);

        // 모드가 꺼지면 진행 중이던 자동 시작 타이머 즉시 취소
        if (!gs.isAutoMode && gs.autoStartTimer) {
            clearTimeout(gs.autoStartTimer);
            gs.autoStartTimer = null;
        }

        // 🍏 모드가 켜졌는데 현재 게임이 종료 상태라면 즉시 게임 시작!
        if (gs.isAutoMode && (gs.phase === '대기 중' || gs.phase.includes('종료') || gs.phase.includes('기권승'))) {
            if (gs.autoStartTimer) {
                clearTimeout(gs.autoStartTimer);
                gs.autoStartTimer = null;
            }
            console.log(`[ROOM ${roomId}] Auto Starting Game IMMEDIATELY on Toggle ON.`);
            initiateNextHand(roomId);
        }

        io.to(`room_${roomId}`).emit('updateGameState', getPublicGameState(gs));
    });


    socket.on('playerAction', ({ roomId, nickname, action, amount }) => {
        const gs = gameStates[roomId];
        if (!gs || gs.isBlockingAction) return;

        const player = gs.players[gs.turnIndex];
        if (!player) {
            console.error(`⚠️ [ACTION ERROR] Room ${roomId} has invalid turnIndex: ${gs.turnIndex}`);
            gs.turnIndex = 0; // 강제 복구 시도
            io.to(`room_${roomId}`).emit('updateGameState', getPublicGameState(gs));
            return;
        }
        if (player.nickname !== nickname) return;

        if (action === '폴드') {
            player.isFold = true;
            io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: `[${nickname}] 폴드` });
        }
        else if (action === '콜') {
            let toCall = Math.min(gs.currentBet - player.betAmount, player.chips);
            player.chips -= toCall;
            player.betAmount += toCall;
            player.totalContribution = (player.totalContribution || 0) + toCall;
            gs.pot += toCall;
            if (toCall === 0) {
                io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: `[${nickname}] 체크` });
            } else {
                io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: `[${nickname}] 콜` });
            }
        }
        else if (action === '레이즈' || action === '올인') {
            let raiseAmount = Number(amount);
            if (raiseAmount > player.chips) raiseAmount = player.chips;
            player.chips -= raiseAmount;
            player.betAmount += raiseAmount;
            player.totalContribution = (player.totalContribution || 0) + raiseAmount;
            gs.pot += raiseAmount;
            if (player.betAmount > gs.currentBet) {
                let diff = player.betAmount - gs.currentBet;
                if (diff > gs.lastRaiseDifference) gs.lastRaiseDifference = diff;
                gs.currentBet = player.betAmount;
                gs.players.forEach(p => { if (!p.isFold && p.chips > 0 && p !== player) p.hasActed = false; });
            }
            io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: `[${nickname}] ${action} (${raiseAmount})` });
        }

        // 🍏 [액션 말풍선 트리거] 라벨 결정 로직
        let bubbleLabel = action.toUpperCase();
        if (action === '폴드') bubbleLabel = 'FOLD';
        else if (action === '콜') {
            const hasToCall = (gs.currentBet > (player.betAmount - (amount || 0))); // 이전 상태 기준
            bubbleLabel = (amount === 0) ? 'CHECK' : 'CALL'; 
        } else if (action === '레이즈') {
            gs.streetRaiseCount = (gs.streetRaiseCount || 0) + 1;
            const count = gs.streetRaiseCount;
            if (gs.phase === '프리플랍') {
                if (count === 2) bubbleLabel = 'RAISE';
                else if (count >= 3) bubbleLabel = `${count}-BET`;
                else bubbleLabel = 'RAISE';
            } else {
                if (count === 1) bubbleLabel = 'BET';
                else if (count === 2) bubbleLabel = 'RAISE';
                else if (count >= 3) bubbleLabel = `${count}-BET`;
            }
        } else if (action === '올인') {
            bubbleLabel = 'ALL-IN';
        }

        // 방 전체에 액션 알림 (말풍선용)
        io.to(`room_${roomId}`).emit('playerActionNotification', { 
            nickname, 
            action: action, 
            label: bubbleLabel,
            amount: amount 
        });

        player.hasActed = true;
        progressGameStage(gs, roomId);
    });

    socket.on('revealCards', ({ roomId, nickname }) => {
        const gs = gameStates[roomId];
        if (!gs) return;
        const player = gs.players.find(p => p.nickname === nickname);
        if (player && player.privateCards && player.privateCards.length > 0) {
            player.isRevealed = true;
            io.to(`room_${roomId}`).emit('updateGameState', getPublicGameState(gs));
            io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: `[${nickname}] 님이 카드를 오픈했습니다!` });
        }
    });

    socket.on('spectatorRebuy', ({ roomId, nickname }) => {
        const gs = gameStates[roomId];
        if (!gs) return;
        const player = gs.players.find(p => p.nickname === nickname);
        if (!player || !player.spectator) return;

        let roomInfo = roomsDB.find(r => r.id === roomId);
        player.chips = roomInfo.buyIn;
        player.spectator = true; 
        player.isFold = true; 
        player.waitingForNext = true; // 🍏 다음 판 참여 대기 플래그

        let users = usersDB;
        let uIdx = users.findIndex(u => u.nickname === nickname);
        if (uIdx > -1) {
            users[uIdx].rebuyCount = (users[uIdx].rebuyCount || 0) + 1;
            player.rebuyCount = users[uIdx].rebuyCount;
            saveDB(users, [users[uIdx]]); // 🍏 변경된 유저만 업데이트
        }

        io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: `[${nickname}] 님이 참여를 예약하셨습니다. (다음 판부터 참여)` });
        io.to(`room_${roomId}`).emit('updateGameState', getPublicGameState(gs));
    });

    socket.on('rebuyDecision', ({ roomId, nickname, decision }) => {
        const gs = gameStates[roomId];
        if (!gs) return;
        const player = gs.players.find(p => p.nickname === nickname);
        if (!player || !player.decidingRebuy) return;

        player.decidingRebuy = false;
        if (decision === 'yes') {
            let roomInfo = roomsDB.find(r => r.id === roomId);
            player.chips = roomInfo.buyIn;
            player.spectator = true; 
            player.waitingForNext = true; // 🍏 올인 후 리바이 시 일단 대기 상태로

            let users = usersDB;
            let uIdx = users.findIndex(u => u.nickname === nickname);
            if (uIdx > -1) {
                users[uIdx].rebuyCount = (users[uIdx].rebuyCount || 0) + 1;
                player.rebuyCount = users[uIdx].rebuyCount;
                saveDB(users, [users[uIdx]]); // 🍏 변경된 유저만 업데이트
            }
            io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: `[${nickname}] 님이 다음 판 참여를 예약하셨습니다.` });
        } else {
            player.spectator = true; 
            player.waitingForNext = false;
            io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: `[${nickname}] 님이 리바이를 포기하여 관전 모드로 전환되었습니다.` });
        }

        let stillDeciding = gs.players.some(p => p.decidingRebuy);
        gs.isBlockingAction = stillDeciding;
        io.to(`room_${roomId}`).emit('updateGameState', getPublicGameState(gs));
    });

    // 🍏 [신규] 방 옵션 업데이트 (블라인드, 자동 시작 시간)
    socket.on('updateRoomSettings', ({ roomId, settings }) => {
        const gs = gameStates[roomId];
        if (!gs) return;

        if (settings.autoStartDelay !== undefined) gs.settings.autoStartDelay = Number(settings.autoStartDelay);
        if (settings.sb !== undefined) gs.settings.sb = Number(settings.sb);
        if (settings.bb !== undefined) gs.settings.bb = Number(settings.bb);

        console.log(`[ROOM ${roomId}] Settings Updated:`, gs.settings);
        io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: '⚙️ 방 설정이 업데이트되었습니다.' });
        io.to(`room_${roomId}`).emit('updateGameState', getPublicGameState(gs));
    });
});

function progressGameStage(gs, roomId) {
    let activePlayers = gs.players.filter(p => !p.isFold && !p.spectator);

    if (activePlayers.length <= 1) {
        if (activePlayers.length === 1) awardPot(gs, roomId, activePlayers);
        else { gs.phase = '대기 중'; gs.communityCards = []; gs.pot = 0; gs.currentBet = 0; }
        return;
    }

    let activePWithChips = activePlayers.filter(p => p.chips > 0);
    let playersNeedingAction = activePWithChips.filter(p => !p.hasActed || p.betAmount < gs.currentBet);

    if (playersNeedingAction.length === 0) {
        if (activePWithChips.length <= 1) {
        let loopGuard = 0;
        while (gs.communityCards.length < 5 && loopGuard < 10) {
            loopGuard++;
            if (gs.deck.length > 0) gs.deck.pop(); // Burn card
            if (gs.deck.length > 0) {
                gs.communityCards.push(gs.deck.pop());
            } else {
                break;
            }
        }
            doShowdown(gs, roomId, activePlayers);
            return;
        }

        if (gs.phase === '프리플랍') {
            gs.phase = '플랍';
            gs.deck.pop();
            gs.communityCards.push(gs.deck.pop(), gs.deck.pop(), gs.deck.pop());
        } else if (gs.phase === '플랍') {
            gs.phase = '턴';
            gs.deck.pop(); gs.communityCards.push(gs.deck.pop());
        } else if (gs.phase === '턴') {
            gs.phase = '리버';
            gs.deck.pop(); gs.communityCards.push(gs.deck.pop());
        } else if (gs.phase === '리버' || activePlayers.every(p => p.chips === 0 || p.isFold)) {
            let loopGuard = 0;
            while (gs.communityCards.length < 5 && loopGuard < 10) {
                loopGuard++;
                if (gs.deck.length > 1) {
                    gs.deck.pop(); // Burn
                    gs.communityCards.push(gs.deck.pop());
                } else {
                    break;
                }
            }
            doShowdown(gs, roomId, activePlayers);
            return;
        }

        gs.currentBet = 0;
        gs.streetRaiseCount = 0; // 🍏 스트리트 변경 시 레이즈 카운트 초기화
        gs.players.forEach(p => { if (!p.isFold && !p.spectator) { p.betAmount = 0; p.hasActed = false; } });

        let pInGame = gs.players.filter(p => !p.spectator);
        let startIdx = (gs.dealerIndex + 1) % pInGame.length;
        gs.turnIndex = gs.players.findIndex(p => p.nickname === pInGame[startIdx].nickname);
        
        let turnProtection = 0;
        while (gs.turnIndex < 0 || !gs.players[gs.turnIndex] || gs.players[gs.turnIndex].isFold || gs.players[gs.turnIndex].chips === 0) {
            gs.turnIndex = (gs.turnIndex + 1) % gs.players.length;
            turnProtection++;
            if (turnProtection > gs.players.length * 2) {
                console.log("⚠️ [LOOP BREAK] 모든 플레이어가 행동 불능이어서 루프를 강제 종료합니다.");
                doShowdown(gs, roomId, activePlayers);
                return;
            }
        }

    } else {
        let nextIndex = gs.turnIndex;
        let protection = 0;
        let found = false;
        
        do {
            nextIndex = (nextIndex + 1) % gs.players.length;
            protection++;
            if (protection > gs.players.length * 2) break; 
            
            let p = gs.players[nextIndex];
            if (p && !p.isFold && p.chips > 0 && !p.spectator) {
                found = true;
                break;
            }
        } while (protection <= gs.players.length);
        
        if (found) {
            gs.turnIndex = nextIndex;
        } else {
            console.log("⚠️ 다음 차례를 찾을 수 없음 -> 강제 쇼다운 진행");
            doShowdown(gs, roomId); 
            return;
        }
    }

    io.to(`room_${roomId}`).emit('updateGameState', getPublicGameState(gs));
}

function doShowdown(gs, roomId, activePlayers) {
    gs.phase = '쇼다운';
    const commCards = gs.communityCards;

    let solvedHands = activePlayers.map(p => {
        let allCards = [...commCards, ...p.privateCards];
        try {
            let h = Hand.solve(allCards);
            h.player = p;
            return h;
        } catch(e) {
            return { player: p, name: "오류", descr: "분석 불가" };
        }
    });

    awardPot(gs, roomId, solvedHands);
}

function awardPot(gs, roomId, winnersOrPlayers) {
    const logs = [];
    
    // 🍏 전체 승자 중 진짜 '최고 패'를 가려내기 위한 준비
    let absoluteBestHandStr = "";
    if (winnersOrPlayers && winnersOrPlayers.length > 0 && winnersOrPlayers[0].cards) {
        try {
            const allSolved = winnersOrPlayers.filter(h => h.cards);
            if (allSolved.length > 0) {
                const best = Hand.winners(allSolved)[0];
                absoluteBestHandStr = best.toString(); // 비교용 문자열
            }
        } catch(e) {}
    }
    gs.lastWinners = []; // 🍏 이전 승자 기록 초기화
    
    // 1. 기여자 및 잠재적 승자 정리
    const contributors = gs.players.filter(p => !p.spectator && (p.totalContribution || 0) > 0);
    const nonFoldedSolved = winnersOrPlayers.map(item => {
        if (item.player) return item; 
        return { player: item, name: "기권승" }; 
    }).filter(h => !h.player.isFold);

    // 2. 모든 고유 베팅 레벨(Side Pot 구간) 추출
    const allLevels = [...new Set(contributors.map(p => p.totalContribution))].sort((a, b) => a - b);

    let prevLevel = 0;
    let totalAwarded = 0;

    // 3. 베팅 레벨 구간별로 정산 (Side Pot Loop)
    for (let level of allLevels) {
        const sliceSize = level - prevLevel;
        if (sliceSize <= 0) continue;

        let sidePotSize = 0;
        contributors.forEach(c => {
            const contributionInSlice = Math.min(sliceSize, Math.max(0, c.totalContribution - prevLevel));
            sidePotSize += contributionInSlice;
        });

        if (sidePotSize <= 0) {
            prevLevel = level;
            continue;
        }

        // 이 구간의 칩을 가져갈 자격이 있는 승자 선별 (레벨 충족 + 폴드 안 함)
        const eligible = nonFoldedSolved.filter(h => h.player.totalContribution >= level);

        if (eligible.length > 0) {
            let winners;
            try {
                // 쇼다운 패 분석이 필요한 경우
                if (eligible.every(h => h.cards)) {
                    winners = Hand.winners(eligible);
                } else {
                    // 기권승 상황
                    winners = eligible;
                }
            } catch (e) {
                console.error("Winner determination error:", e);
                winners = [eligible[0]];
            }

            // 칩 분배 계산 (N분의 1 + 홀수 칩)
            const perWinner = Math.floor(sidePotSize / winners.length);
            let remainder = sidePotSize % winners.length;

            // 홀수 칩 우선 순위: 딜러 버튼 좌측(SB 방향)부터 시계 방향
            const dIdx = gs.dealerIndex;
            const sortedWinners = [...winners].sort((a, b) => {
                const idxA = gs.players.indexOf(a.player);
                const idxB = gs.players.indexOf(b.player);
                const relA = (idxA - dIdx + gs.players.length) % gs.players.length;
                const relB = (idxB - dIdx + gs.players.length) % gs.players.length;
                return relA - relB;
            });

            sortedWinners.forEach(w => {
                let won = perWinner;
                if (remainder > 0) {
                    won += 1;
                    remainder--;
                }
                w.player.chips += won;
                totalAwarded += won;

                const handName = translateHand(w);
                const isTrueWinner = (w.toString() === absoluteBestHandStr) || (winnersOrPlayers.length === 1); 
                
                logs.push(`🏆 ${w.player.nickname} (+${won}) [${handName}]${winners.length > 1 ? ' (Split)' : ''}`);
                gs.lastWinners.push({ nickname: w.player.nickname, handName, isTrueWinner });
            });
        } else {
            // 자격 있는 승자가 없는 경우 (매우 드문 폴드 케이스) 기여자에게 환급
            const perContributor = Math.floor(sidePotSize / contributors.length);
            let rem = sidePotSize % contributors.length;
            contributors.forEach(c => {
                let refund = perContributor + (rem > 0 ? 1 : 0);
                if (rem > 0) rem--;
                c.chips += refund;
                totalAwarded += refund;
            });
        }

        prevLevel = level;
    }

    // 4. 상태 업데이트 및 로그 전송
    if (gs.lastWinners && gs.lastWinners.length > 0) {
        const names = [...new Set(gs.lastWinners.map(w => w.nickname))].join(", ");
        const bestHand = gs.lastWinners[0].handName;
        gs.phase = `종료 (승자: ${names}) - [${bestHand}]`;
    } else {
        gs.phase = `종료 (정산 완료)`;
    }

    gs.pot = 0; // 정산 완료

    // 🍏 정산 후 자동 진행 시간 결정 (사용자 설정 참조)
    const baseDelay = gs.settings?.autoStartDelay || 5000;
    // 기권승이 아닌 '승자'가 명시된 상황을 쇼다운(카드 공개)으로 판단
    const isShowdown = gs.phase.includes('승자') && !gs.phase.includes('기권승');
    
    // 쇼다운 시에는 3초의 공개 시간(REVEAL_PAUSE)을 추가로 부여
    const totalDelay = isShowdown ? (baseDelay + 3000) : baseDelay;
    gs.autoStartDelay = totalDelay;

    // 🍏 서버 사이드 자동 진행 체크
    if (gs.isAutoMode) {
        if (gs.autoStartTimer) clearTimeout(gs.autoStartTimer);
        gs.autoStartTimer = setTimeout(() => {
            if (gs.isAutoMode) {
                console.log(`[AUTO] Automatically starting next game in Room ${roomId} (after ${totalDelay}ms, isShowdown: ${isShowdown})`);
                initiateNextHand(roomId);
            }
            gs.autoStartTimer = null;
        }, totalDelay);
    }

    io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: `===== 게임 결과 (사이드팟 정산) =====` });
    logs.forEach(text => io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text }));

    // 🍏 [DB 영구 저장] 메모리 캐시 업데이트 및 DB 동기화 (우승자들만 선별 업데이트)
    const prizeWinners = [];
    usersDB.forEach(u => {
        const winner = gs.lastWinners.find(w => w.nickname === u.nickname);
        if (winner) {
            // 상금 정산 로직에 따라 u.chips는 이미 awardPot에서 업데이트됨
            prizeWinners.push(u);
        }
    });
    saveDB(usersDB, prizeWinners.length > 0 ? prizeWinners : null);
    let losers = gs.players.filter(p => !p.spectator && p.chips <= 0);
    losers.forEach(p => p.decidingRebuy = true);
    if (losers.length > 0) {
        gs.isBlockingAction = true;
        // 🍏 리바이 결정이 필요하면 자동 진행을 해제하여 혼란 방지
        if (gs.isAutoMode) {
            gs.isAutoMode = false;
            if (gs.autoStartTimer) {
                clearTimeout(gs.autoStartTimer);
                gs.autoStartTimer = null;
            }
            io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: '🔔 누군가의 리바인 결정을 기다려야 하므로 자동 진행이 해제되었습니다.' });
        }
    }

    io.to(`room_${roomId}`).emit('updateGameState', getPublicGameState(gs));
}

function resetGame(gs, roomId) {
    if (!gs) return;
    gs.communityCards = [];
    gs.pot = 0;
    gs.phase = '대기 중';
    gs.players.forEach(p => {
        p.privateCards = []; p.betAmount = 0; p.totalContribution = 0; p.hasActed = false; p.role = ''; p.isFold = false; p.isRevealed = false;
        if (!p.decidingRebuy && p.chips > 0) {
            p.spectator = false;
        }
    });
}

// 🍏 [핵심] 진짜 게임이 시작되는 통합 엔진
function initiateNextHand(roomId) {
    try {
        const gs = gameStates[roomId];
        if (!gs) {
            console.error(`⚠️ [INIT ERROR] Room ${roomId} has no gameState.`);
            return;
        }

        // 만약 종료 상태에서 불렸다면 정리부터
        if (gs.phase.includes('종료') || gs.phase.includes('기권승') || gs.phase === '대기 중') {
            resetGame(gs, roomId);
            if (gs.autoStartTimer) {
                clearTimeout(gs.autoStartTimer);
                gs.autoStartTimer = null;
            }
        }

        if (gs.isBlockingAction) {
            console.log(`[ROOM ${roomId}] Game is blocked (e.g. Rebuy decision).`);
            return;
        }

        gs.phase = '프리플랍';
        gs.pot = 0;
        gs.lastWinners = [];
        gs.communityCards = [];
        gs.deck = createDeck();
        
        // 🍏 방 설정에서 블라인드 값 참조
        const roomInfo = roomsDB.find(r => r.id === roomId);
        if (!roomInfo) {
            console.error(`⚠️ [INIT ERROR] Room ${roomId} info not found.`);
            return;
        }
        const sbAmount = gs.settings?.sb || roomInfo.sb;
        const bbAmount = gs.settings?.bb || roomInfo.bb;
        
        gs.currentBet = bbAmount;
        gs.lastRaiseDifference = gs.currentBet;

        // 접속 끊긴 플레이어 정리
        gs.players = gs.players.filter(p => p.socketId !== null);

        gs.players.forEach(p => {
            if (p.waitingForNext) {
                p.spectator = false;
                p.isFold = true;
                p.waitingForNext = false;
            }
            p.role = ''; p.isFold = false; p.betAmount = 0; p.hasActed = false; p.privateCards = [];
            p.isRevealed = false; p.totalContribution = 0;
        });

        gs.streetRaiseCount = 1; // 🍏 프리플랍은 BB(1-bet)이 포함된 상태로 시작

        let playersInGame = gs.players.filter(p => !p.spectator);
        if (playersInGame.length < 2) {
            console.log(`[ROOM ${roomId}] Not enough active players after cleanup.`);
            if (gs.isAutoMode) {
                gs.isAutoMode = false;
                io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: '🔔 참여 가능한 인원이 부족하여 자동 진행이 해제되었습니다.' });
            } else {
                io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: '인원이 부족하여 게임을 시작할 수 없습니다 (최소 2명).' });
            }
            io.to(`room_${roomId}`).emit('updateGameState', getPublicGameState(gs));
            return;
        }
        gs.dealerIndex = (gs.dealerIndex + 1) % playersInGame.length;

        let dIdx = gs.dealerIndex;
        let sbIdx = (dIdx + 1) % playersInGame.length;
        let bbIdx = (dIdx + 2) % playersInGame.length;

        playersInGame[dIdx].role = 'D';
        playersInGame[sbIdx].role = 'SB';
        playersInGame[bbIdx].role = 'BB';

        const sbActual = Math.min(playersInGame[sbIdx].chips, sbAmount);
        playersInGame[sbIdx].chips -= sbActual;
        playersInGame[sbIdx].betAmount = sbActual;
        playersInGame[sbIdx].totalContribution = sbActual;

        const bbActual = Math.min(playersInGame[bbIdx].chips, bbAmount);
        playersInGame[bbIdx].chips -= bbActual;
        playersInGame[bbIdx].betAmount = bbActual;
        playersInGame[bbIdx].totalContribution = bbActual;

        gs.pot = sbActual + bbActual;

        // 🛡️ UTG 플레이어 찾기 시 인덱스 안전장치 추가
        let utgIdx = (bbIdx + 1) % playersInGame.length;
        const utgNickname = playersInGame[utgIdx].nickname;
        gs.turnIndex = gs.players.findIndex(p => p.nickname === utgNickname);

        if (gs.turnIndex === -1) {
            console.error(`⚠️ [INIT ERROR] Could not find UTG player (${utgNickname}) in players list.`);
            gs.turnIndex = 0; // 안전한 기본값으로 복구
        }

        // 카드 배분 및 전송
        gs.players.forEach(p => {
            if (!p.spectator) {
                p.privateCards = [gs.deck.pop(), gs.deck.pop()];
                io.to(p.socketId).emit('dealPrivateCards', p.privateCards.map(formatCardForUI));
            }
        });

        // 방 전체에 상태 동기화 및 게임 시작 메시지 알림
        io.to(`room_${roomId}`).emit('updateGameState', getPublicGameState(gs));
        io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: `===== 게임 시작 (프리플랍) =====` });
    } catch (err) {
        console.error(`🔥 [CRITICAL INIT ERROR] Room ${roomId}:`, err);
        io.to(`room_${roomId}`).emit('chatMessage', { sender: '시스템', text: '🚫 게임 시작 중 내부 오류가 발생했습니다. 방을 다시 열어주세요.' });
    }
}

function translateHand(handObj) {
    if (!handObj || !handObj.name) return "기권승";
    let raw = handObj.name;
    let baseLower = raw.toLowerCase();
    
    let translated = "하이카드";
    // 🍏 명시적 우선순위 부여로 매칭 오류 원천 차단
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
    else translated = raw; 

    // 서버 터미널에 디버그 로그 출력
    if (raw !== "기권승") {
        console.log(`[DEBUG_HAND] Raw: "${raw}", Translated: "${translated}"`);
    }

    if (handObj.descr) {
        let ranksMatch = handObj.descr.match(/\b(A|K|Q|J|10|9|8|7|6|5|4|3|2)\b/g);
        if (ranksMatch && ranksMatch.length > 0) {
            let uniqueRanks = [...new Set(ranksMatch)];
            // 하이카드는 가장 높은 카드 하나만 표시, 그 외는 관련 랭크 모두 표시
            if (translated === "하이카드") return `(${uniqueRanks[0]}) ${translated}`;
            return `(${uniqueRanks.join(',')}) ${translated}`;
        }
    }
    return translated;
}

function getPublicGameState(gs, socketId) {
    if (!gs) return {};
    return {
        roomId: gs.roomId,
        phase: gs.phase,
        pot: gs.pot,
        turnNickname: gs.players[gs.turnIndex]?.nickname || '',
        currentBet: gs.currentBet,
        lastRaiseDifference: gs.lastRaiseDifference,
        isAutoMode: gs.isAutoMode, // 🍏 동기화된 자동 모드 상태 전송
        autoStartDelay: gs.autoStartDelay, // 🍏 동적 대기 시간 전송
        communityCards: gs.communityCards.map(formatCardForUI),
        isBlockingAction: gs.isBlockingAction,
        lastWinners: gs.lastWinners || [], 
        settings: gs.settings || {}, // 🍏 방 설정 정보 포함하여 전송
        players: gs.players.map(p => {
            let curHand = "";
            let pCards = null; 
            const isMe = p.socketId === socketId;

            // '기권승' (Fold-win) 상황은 자동 오픈 대상인 '진짜 쇼다운'에서 제외
            const isRealShowdown = gs.phase === '쇼다운' || (gs.phase.includes('종료') && !gs.phase.includes('기권승'));
            const isManuallyRevealed = p.isRevealed === true;

            // 폴드 여부와 관계없이 본인은 볼 수 있고, 
            // 쇼다운 상황에서는 '폴드하지 않은 사람'만 공개, 
            // 수동 공개한 경우 공개
            if (isMe || (isRealShowdown && !p.isFold) || isManuallyRevealed) {
                if (p.privateCards && p.privateCards.length === 2) {
                    pCards = p.privateCards.map(formatCardForUI);
                }
            }

            // 관전자가 아니고 카드가 2장 있는 경우 족보 분석 (폴드자도 수동 공개 시 분석 결과 노출를 위해 조건 완화)
            if (!p.spectator && p.privateCards && p.privateCards.length === 2) {
                const allCards = [...gs.communityCards, ...p.privateCards];
                // 🍏 커뮤니티 카드가 3장 이상(플랍 이후)이면 라이브러리 분석 최우선 적용
                if (gs.communityCards.length >= 3) {
                    try { 
                        let solved = Hand.solve(allCards);
                        if (solved) curHand = translateHand(solved); 
                    } catch (e) {
                        console.error("Hand solve error in state update:", e);
                    }
                } 
                
                // 🍏 분석 결과가 없거나(프리플랍 등) 아직 족보가 안 나왔을 때만 포켓 페어(원페어) 체크
                if (!curHand && p.privateCards[0][0] === p.privateCards[1][0]) {
                    curHand = `(${p.privateCards[0].charAt(0) === 'T' ? '10' : p.privateCards[0].charAt(0)}) 원페어`;
                }

                // 본인이 아니면서, (진짜 쇼다운 상황이 아니거나 폴드한 경우)이고, 수동 공개도 안 한 경우 족보 가림
                if (!isMe && (!isRealShowdown || p.isFold) && !isManuallyRevealed) {
                    curHand = "";
                }
            }
            return {
                nickname: p.nickname, chips: p.chips, role: p.role, isFold: p.isFold,
                betAmount: p.betAmount, totalContribution: p.totalContribution,
                spectator: p.spectator, decidingRebuy: p.decidingRebuy,
                rebuyCount: p.rebuyCount,
                isRevealed: p.isRevealed, 
                waitingForNext: p.waitingForNext, // 🍏 대기 상태 전송
                currentHandName: curHand,
                privateCards: pCards
            };
        })
    };
}

app.use((req, res) => {
    const indexPath = path.join(DIST_PATH, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('SPA fallback: Frontend build not found.');
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => { 
    console.log(`정통 홀덤 서버 완벽 가동 중! (Port: ${PORT}) 🚀`); 
});
