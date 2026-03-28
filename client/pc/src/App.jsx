import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SERVER_URL = window.location.origin;
const CHEER_MESSAGES = ['와', '잘한다', '화이팅', '이겨라'];
const CHEER_FACE_SKINS = ['#fde68a', '#fdba74', '#fca5a5', '#fbcfe8', '#c4b5fd', '#93c5fd'];
const CHEER_LAYOUT = [
  { left: '6%', bottom: '8%', size: 56 },
  { left: '16%', bottom: '18%', size: 60 },
  { left: '28%', bottom: '10%', size: 54 },
  { left: '40%', bottom: '20%', size: 58 },
  { left: '48%', bottom: '8%', size: 52 },
  { left: '54%', bottom: '8%', size: 52 },
  { left: '62%', bottom: '20%', size: 58 },
  { left: '74%', bottom: '10%', size: 54 },
  { left: '84%', bottom: '18%', size: 60 },
  { left: '94%', bottom: '8%', size: 56 },
];
const SIDELINE_CHEER_LAYOUT = [
  { id: 'l1', side: 'left', top: '12%', depth: 0, delay: '0s', speed: 1.8 },
  { id: 'l2', side: 'left', top: '34%', depth: 1, delay: '0.3s', speed: 2.2 },
  { id: 'l3', side: 'left', top: '58%', depth: 0, delay: '0.55s', speed: 2.05 },
  { id: 'r1', side: 'right', top: '16%', depth: 1, delay: '0.2s', speed: 1.95 },
  { id: 'r2', side: 'right', top: '40%', depth: 0, delay: '0.45s', speed: 2.25 },
  { id: 'r3', side: 'right', top: '64%', depth: 1, delay: '0.7s', speed: 2.1 },
];

function buildCheerFaceDataUri(index) {
  const skin = CHEER_FACE_SKINS[index % CHEER_FACE_SKINS.length];
  const shirt = index % 2 === 0 ? '#60a5fa' : '#f87171';
  const blush = index % 2 === 0 ? '#93c5fd' : '#fca5a5';
  const eyeOffset = 17 + (index % 3);
  const mouthCurve = index % 2 === 0 ? 'Q30 44 39 36' : 'Q30 46 39 36';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60">
      <rect x="0" y="0" width="60" height="60" rx="30" fill="${shirt}" />
      <circle cx="30" cy="25" r="16" fill="${skin}" />
      <circle cx="${30 - eyeOffset * 0.42}" cy="24" r="2.4" fill="#0f172a" />
      <circle cx="${30 + eyeOffset * 0.42}" cy="24" r="2.4" fill="#0f172a" />
      <path d="M21 37 ${mouthCurve}" stroke="#0f172a" stroke-width="2.6" fill="none" stroke-linecap="round" />
      <circle cx="20" cy="31" r="2.6" fill="${blush}" opacity="0.82" />
      <circle cx="40" cy="31" r="2.6" fill="${blush}" opacity="0.82" />
    </svg>
  `;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const createCheerFans = () =>
  CHEER_LAYOUT.map((layout, idx) => ({
    id: `fan-${idx}`,
    faceSrc: buildCheerFaceDataUri(idx),
    ...layout,
    message: '',
    bubbleKey: 0,
    bubbleMs: 1400,
    visibleUntil: 0,
    nextAt: Date.now() + 400 + Math.floor(Math.random() * 2000),
  }));

function App() {
  const [phase, setPhase] = useState('lobby');
  const [selectedMode, setSelectedMode] = useState('duel');
  const [roomMode, setRoomMode] = useState('duel');
  const [roomId, setRoomId] = useState('');
  const [position, setPosition] = useState(0);
  const [teamACount, setTeamACount] = useState(0);
  const [teamBCount, setTeamBCount] = useState(0);
  const [playerCount, setPlayerCount] = useState(0);
  const [players, setPlayers] = useState([]);
  const [countdown, setCountdown] = useState(null);
  const [timeLeftMs, setTimeLeftMs] = useState(30000);
  const [fever, setFever] = useState(false);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [comboA, setComboA] = useState(0);
  const [comboB, setComboB] = useState(0);
  const [maxComboA, setMaxComboA] = useState(0);
  const [maxComboB, setMaxComboB] = useState(0);
  const [gainA, setGainA] = useState(0);
  const [gainB, setGainB] = useState(0);
  const [playerJudges, setPlayerJudges] = useState([]);
  const [winner, setWinner] = useState(null);
  const [endReason, setEndReason] = useState('');
  const [roomClosed, setRoomClosed] = useState('');
  const [ranking, setRanking] = useState([]);
  const [rankingScope, setRankingScope] = useState('all');
  const [rankingNameQuery, setRankingNameQuery] = useState('');
  const [rankingScoreMin, setRankingScoreMin] = useState('');
  const [rankingScoreMax, setRankingScoreMax] = useState('');
  const [hallHonor, setHallHonor] = useState([]);
  const [hallShame, setHallShame] = useState([]);
  const [pcShameConsent, setPcShameConsent] = useState(false);
  const [pcFameStatus, setPcFameStatus] = useState('');
  const [pcRecentFame, setPcRecentFame] = useState([]);
  const [honorCameraOpen, setHonorCameraOpen] = useState(false);
  const [cheerFans, setCheerFans] = useState(createCheerFans);
  const [soloLive, setSoloLive] = useState({
    active: false,
    nickname: '-',
    score: 0,
    combo: 0,
    maxCombo: 0,
    accuracy: 0,
    grade: '-',
    fever: false,
    timeLeftMs: 0,
    updatedAt: 0,
  });
  const socketRef = useRef(null);
  const listenersBoundRef = useRef(false);
  const shameCaptureInputRef = useRef(null);
  const honorCameraVideoRef = useRef(null);
  const honorCameraStreamRef = useRef(null);

  useEffect(() => {
    return () => {
      stopHonorLiveCamera();
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    if (phase !== 'playing') {
      setCheerFans(createCheerFans());
      return undefined;
    }

    const ticker = setInterval(() => {
      const now = Date.now();
      setCheerFans((prev) =>
        prev.map((fan) => {
          if (fan.message && now >= fan.visibleUntil) {
            return { ...fan, message: '' };
          }
          if (!fan.message && now >= fan.nextAt) {
            const bubbleMs = 1200 + Math.floor(Math.random() * 1400);
            return {
              ...fan,
              message: CHEER_MESSAGES[Math.floor(Math.random() * CHEER_MESSAGES.length)],
              bubbleKey: fan.bubbleKey + 1,
              bubbleMs,
              visibleUntil: now + bubbleMs,
              nextAt: now + bubbleMs + 700 + Math.floor(Math.random() * 2500),
            };
          }
          return fan;
        })
      );
    }, 220);

    return () => clearInterval(ticker);
  }, [phase]);

  const bindSocketListeners = (socket) => {
    if (listenersBoundRef.current) return;

    socket.on('room_state', (data) => {
      setRoomMode(data.mode || 'duel');
      setPlayerCount(data.playerCount);
      setTeamACount(data.teamACount);
      setTeamBCount(data.teamBCount);
      setPlayers(data.players || []);
      setPhase((prev) => (data.started && prev !== 'playing' ? 'playing' : prev));
    });

    socket.on('game_countdown', ({ seconds }) => {
      setCountdown(seconds);
      setPhase('countdown');
    });

    socket.on('game_started', () => {
      setPhase('playing');
      setWinner(null);
      setEndReason('');
      setCountdown(null);
      setTimeLeftMs(30000);
      setFever(false);
      setScoreA(0);
      setScoreB(0);
      setComboA(0);
      setComboB(0);
      setMaxComboA(0);
      setMaxComboB(0);
      setGainA(0);
      setGainB(0);
      setPlayerJudges([]);
    });

    socket.on('game_state', (state) => {
      setPosition(state.position);
      setTeamACount(state.teamACount);
      setTeamBCount(state.teamBCount);
      setTimeLeftMs(state.timeLeftMs ?? 0);
      setFever(!!state.fever);
      setScoreA(state.scoreA ?? 0);
      setScoreB(state.scoreB ?? 0);
      setComboA(state.comboA ?? 0);
      setComboB(state.comboB ?? 0);
      setMaxComboA(state.maxComboA ?? 0);
      setMaxComboB(state.maxComboB ?? 0);
      setGainA(state.gainA ?? 0);
      setGainB(state.gainB ?? 0);
      setPlayerJudges(state.playerJudges || []);
    });

    socket.on('game_over', (data) => {
      stopHonorLiveCamera();
      setWinner(data.winner);
      setEndReason(data.reason || '');
      setPlayers(data.players || []);
      setPcShameConsent(false);
      setPcFameStatus('');
      setPcRecentFame([]);
      setPlayerJudges([]);
      setPhase('result');
    });

    socket.on('game_reset', () => {
      stopHonorLiveCamera();
      setPosition(0);
      setWinner(null);
      setEndReason('');
      setCountdown(null);
      setTimeLeftMs(30000);
      setFever(false);
      setScoreA(0);
      setScoreB(0);
      setComboA(0);
      setComboB(0);
      setMaxComboA(0);
      setMaxComboB(0);
      setGainA(0);
      setGainB(0);
      setPlayerJudges([]);
      setPcShameConsent(false);
      setPcFameStatus('');
      setPcRecentFame([]);
      setPhase('waiting');
    });

    socket.on('room_closed', ({ reason }) => {
      setRoomClosed(reason || 'host_disconnected');
      setPhase('closed');
    });

    socket.on('solo_live_state', (state) => {
      setSoloLive({
        active: !!state?.active,
        nickname: state?.nickname || '-',
        score: state?.score ?? 0,
        combo: state?.combo ?? 0,
        maxCombo: state?.maxCombo ?? 0,
        accuracy: state?.accuracy ?? 0,
        grade: state?.grade || '-',
        fever: !!state?.fever,
        timeLeftMs: state?.timeLeftMs ?? 0,
        updatedAt: state?.updatedAt ?? 0,
      });
    });

    listenersBoundRef.current = true;
  };

  const ensureSocket = () => {
    if (!socketRef.current) {
      socketRef.current = io(SERVER_URL);
      bindSocketListeners(socketRef.current);
    }
    return socketRef.current;
  };

  const createRoom = () => {
    if (selectedMode === 'solo') {
      ensureSocket();
      setPhase('solo_guide');
      return;
    }
    const socket = ensureSocket();
    socket.emit('create_room', { mode: selectedMode }, (data) => {
      setRoomId(data.roomId);
      setRoomMode(data.mode || selectedMode);
      setPhase('waiting');
    });
  };

  const startGame = () => {
    socketRef.current?.emit('start_game');
  };

  const resetGame = () => {
    stopHonorLiveCamera();
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      listenersBoundRef.current = false;
    }
    setRoomId('');
    setPosition(0);
    setWinner(null);
    setEndReason('');
    setCountdown(null);
    setTimeLeftMs(30000);
    setFever(false);
    setScoreA(0);
    setScoreB(0);
    setComboA(0);
    setComboB(0);
    setMaxComboA(0);
    setMaxComboB(0);
    setGainA(0);
    setGainB(0);
    setPlayerCount(0);
    setTeamACount(0);
    setTeamBCount(0);
    setPlayers([]);
    setPlayerJudges([]);
    setPcShameConsent(false);
    setPcFameStatus('');
    setPcRecentFame([]);
    setPhase('lobby');
  };

  const fetchRanking = (overrides = {}) => {
    const scope = overrides.scope ?? rankingScope;
    const nicknameQuery = overrides.nicknameQuery ?? rankingNameQuery;
    const scoreMin = overrides.scoreMin ?? rankingScoreMin;
    const scoreMax = overrides.scoreMax ?? rankingScoreMax;
    const socket = ensureSocket();

    socket.emit(
      'get_solo_ranking',
      { scope, nicknameQuery, scoreMin, scoreMax },
      (res) => {
        setRanking(res?.top || []);
        setRankingScope(res?.scope || scope);
        setPhase('ranking');
      }
    );
  };

  const fetchHallRecords = () => {
    const socket = ensureSocket();
    socket.emit('get_fame_records', { type: 'honor', limit: 24 }, (res) => {
      setHallHonor(res?.records || []);
      setPhase('hall');
    });
    socket.emit('get_fame_records', { type: 'shame', limit: 24 }, (res) => {
      setHallShame(res?.records || []);
    });
  };

  const readImageAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      if (!file) {
        reject('촬영된 이미지가 없습니다.');
        return;
      }
      if (!file.type.startsWith('image/')) {
        reject('이미지 파일만 업로드할 수 있습니다.');
        return;
      }
      if (file.size > 1_000_000) {
        reject('이미지 용량은 1MB 이하를 권장합니다.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject('이미지 처리 중 오류가 발생했습니다.');
      reader.readAsDataURL(file);
    });

  const stopHonorLiveCamera = () => {
    if (honorCameraStreamRef.current) {
      honorCameraStreamRef.current.getTracks().forEach((track) => track.stop());
      honorCameraStreamRef.current = null;
    }
    if (honorCameraVideoRef.current) {
      honorCameraVideoRef.current.srcObject = null;
    }
    setHonorCameraOpen(false);
  };

  const openHonorLiveCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPcFameStatus('이 브라우저는 카메라 촬영을 지원하지 않습니다.');
      return;
    }
    try {
      stopHonorLiveCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      honorCameraStreamRef.current = stream;
      if (honorCameraVideoRef.current) {
        honorCameraVideoRef.current.srcObject = stream;
        await honorCameraVideoRef.current.play();
      }
      setPcFameStatus('');
      setHonorCameraOpen(true);
    } catch (error) {
      setPcFameStatus('카메라 권한을 허용한 뒤 다시 시도해주세요.');
    }
  };

  const captureHonorLivePhoto = () => {
    const video = honorCameraVideoRef.current;
    if (!video || !honorCameraStreamRef.current) {
      setPcFameStatus('카메라를 먼저 실행해주세요.');
      return;
    }
    if (!video.videoWidth || !video.videoHeight) {
      setPcFameStatus('카메라 준비 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setPcFameStatus('촬영 중 오류가 발생했습니다.');
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    stopHonorLiveCamera();
    submitPcFameRecord('honor', imageDataUrl);
  };

  const submitPcFameRecord = (type, imageDataUrl) => {
    if (!imageDataUrl) {
      setPcFameStatus(type === 'honor' ? '명예 사진을 먼저 선택해주세요.' : '불명예 사진을 먼저 선택해주세요.');
      return;
    }
    if (type === 'shame' && !pcShameConsent) {
      setPcFameStatus('불명예 등록은 동의가 필요합니다.');
      return;
    }

    const winnerTeam = winner === 'DRAW' ? '' : winner;
    const loserTeam = winner === 'A' ? 'B' : winner === 'B' ? 'A' : '';
    const displayName = type === 'honor' ? `TEAM ${winnerTeam}` : `TEAM ${loserTeam}`;
    ensureSocket().emit(
      'submit_fame_record',
      {
        type,
        mode: roomMode,
        displayName,
        imageDataUrl,
      },
      (res) => {
        if (res?.error) {
          setPcFameStatus(res.error);
          return;
        }
        const created = {
          id: res.recordId || `${Date.now()}`,
          type,
          mode: roomMode,
          displayName,
          imageDataUrl,
          createdAt: Date.now(),
        };
        setPcRecentFame((prev) => [created, ...prev].slice(0, 8));
        if (type === 'honor') setHallHonor((prev) => [created, ...prev].slice(0, 24));
        else setHallShame((prev) => [created, ...prev].slice(0, 24));
        setPcFameStatus(type === 'honor' ? '명예의 전당 등록 완료!' : '불명예의 전당 등록 완료!');
      }
    );
  };

  const openPcCapture = (type) => {
    if (type === 'honor') {
      openHonorLiveCamera();
      return;
    }
    if (type === 'shame' && !pcShameConsent) {
      setPcFameStatus('불명예 등록은 동의가 필요합니다.');
      return;
    }
    const inputRef = shameCaptureInputRef;
    if (!inputRef.current) return;
    inputRef.current.value = '';
    inputRef.current.click();
  };

  const handlePcCaptureChange = async (type, file, inputRef) => {
    try {
      const imageDataUrl = await readImageAsDataUrl(file);
      setPcFameStatus('');
      submitPcFameRecord(type, imageDataUrl);
    } catch (error) {
      setPcFameStatus(String(error));
    } finally {
      if (inputRef?.current) inputRef.current.value = '';
    }
  };

  const readyCount = players.filter((p) => p.ready).length;
  const canStart =
    phase === 'waiting' &&
    readyCount === playerCount &&
    (roomMode === 'duel'
      ? playerCount >= 2
      : playerCount >= 4 && teamACount >= 2 && teamBCount >= 2);

  if (phase === 'lobby') {
    return (
      <div className="container lobby">
        <div className="logo-area">
          <h1 className="title">TILT TUG</h1>
          <p className="subtitle">모바일 기울기로 조작하는 줄다리기</p>
        </div>
        <div className="mode-selector">
          <button
            className={`btn-chip ${selectedMode === 'solo' ? 'active' : ''}`}
            onClick={() => setSelectedMode('solo')}
          >
            1인
          </button>
          <button
            className={`btn-chip ${selectedMode === 'duel' ? 'active' : ''}`}
            onClick={() => setSelectedMode('duel')}
          >
            2인
          </button>
          <button
            className={`btn-chip ${selectedMode === 'team' ? 'active' : ''}`}
            onClick={() => setSelectedMode('team')}
          >
            팀전
          </button>
        </div>
        <div className="lobby-actions">
          <button className="btn-primary" onClick={createRoom}>
            {selectedMode === 'solo' ? '1인 모드 안내 열기' : '방 만들기'}
          </button>
          <button className="btn-secondary" onClick={() => fetchRanking()}>
            랭킹 보기
          </button>
          <button className="btn-secondary" onClick={fetchHallRecords}>
            전당 보기
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'solo_guide') {
    const soloUrl = `${window.location.origin}/mobile?mode=solo`;
    const soloQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(soloUrl)}`;

    return (
      <div className="container lobby">
        <div className="logo-area">
          <h1 className="title-small">1인 모드 안내</h1>
          <p className="subtitle">모바일은 참가/준비 전용이며, 1인은 전용 링크로 진입합니다.</p>
        </div>
        <div className="join-guide">
          <p>모바일에서 아래 주소로 접속하세요</p>
          <div className="url-box">{soloUrl}</div>
          <div className="qr-wrap">
            <img src={soloQrUrl} alt="solo mode qr" />
          </div>
          <div className="lobby-actions">
            <button className="btn-primary btn-small" onClick={() => window.open(soloUrl, '_blank')}>
              링크 열기
            </button>
            <button className="btn-secondary btn-small" onClick={() => setPhase('lobby')}>
              뒤로
            </button>
          </div>
        </div>
        <div className={`solo-live-panel ${soloLive.fever ? 'fever' : ''}`}>
          <div className="solo-live-head">
            <span>1인 모드 실시간 점수</span>
            <span className={soloLive.active ? 'live-on' : 'live-off'}>
              {soloLive.active ? 'LIVE' : 'IDLE'}
            </span>
          </div>
          <div className="solo-live-main">
            <div className="solo-live-score">{soloLive.score}</div>
            <div className="solo-live-meta">
              <p>플레이어: {soloLive.nickname}</p>
              <p>콤보: {soloLive.combo} (최고 {soloLive.maxCombo})</p>
              <p>정확도: {Number(soloLive.accuracy || 0).toFixed(1)}%</p>
              <p>판정: {soloLive.grade}</p>
              <p>남은 시간: {Math.ceil((soloLive.timeLeftMs || 0) / 1000)}s</p>
            </div>
          </div>
          <p className="hint">
            마지막 업데이트: {soloLive.updatedAt ? new Date(soloLive.updatedAt).toLocaleTimeString() : '-'}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'ranking') {
    return (
      <div className="container lobby">
        <div className="logo-area">
          <h1 className="title-small">1인 모드 랭킹</h1>
          <p className="subtitle">전체/일간 필터와 검색을 지원합니다</p>
        </div>

        <div className="ranking-panel">
          <div className="ranking-filter-row">
            <button
              className={`btn-chip ${rankingScope === 'all' ? 'active' : ''}`}
              onClick={() => {
                setRankingScope('all');
                fetchRanking({ scope: 'all' });
              }}
            >
              전체
            </button>
            <button
              className={`btn-chip ${rankingScope === 'daily' ? 'active' : ''}`}
              onClick={() => {
                setRankingScope('daily');
                fetchRanking({ scope: 'daily' });
              }}
            >
              일간
            </button>
          </div>

          <div className="ranking-filter-row">
            <input
              className="ranking-input"
              type="text"
              placeholder="닉네임 검색"
              value={rankingNameQuery}
              onChange={(e) => setRankingNameQuery(e.target.value)}
            />
          </div>

          <div className="ranking-filter-row">
            <input
              className="ranking-input"
              type="number"
              min="0"
              placeholder="최소 점수"
              value={rankingScoreMin}
              onChange={(e) => setRankingScoreMin(e.target.value)}
            />
            <input
              className="ranking-input"
              type="number"
              min="0"
              placeholder="최대 점수"
              value={rankingScoreMax}
              onChange={(e) => setRankingScoreMax(e.target.value)}
            />
          </div>

          <div className="ranking-filter-row">
            <button className="btn-primary btn-small" onClick={() => fetchRanking()}>
              검색 적용
            </button>
            <button className="btn-secondary btn-small" onClick={() => setPhase('lobby')}>
              메인으로
            </button>
          </div>

          <div className="ranking-list">
            {ranking.length === 0 && <p className="hint">기록이 없습니다</p>}
            {ranking.map((entry) => (
              <div key={`${entry.rank}_${entry.createdAt}`} className="ranking-item">
                <span>{entry.rank}. {entry.nickname}</span>
                <span>{entry.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'hall') {
    return (
      <div className="container lobby">
        <div className="logo-area">
          <h1 className="title-small">명예/불명예 전당</h1>
          <p className="subtitle">최근 등록된 경기 사진 기록</p>
        </div>
        <div className="hall-layout">
          <section className="hall-panel honor">
            <h3>명예의 전당</h3>
            <div className="hall-grid">
              {hallHonor.length === 0 && <p className="hint">기록이 없습니다</p>}
              {hallHonor.map((item) => (
                <article key={item.id} className="hall-card">
                  <img src={item.imageDataUrl} alt={`${item.displayName} honor`} />
                  <div className="hall-meta">
                    <strong>{item.displayName}</strong>
                    <span>{item.mode === 'team' ? '팀전' : '2인'}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="hall-panel shame">
            <h3>불명예의 전당</h3>
            <div className="hall-grid">
              {hallShame.length === 0 && <p className="hint">기록이 없습니다</p>}
              {hallShame.map((item) => (
                <article key={item.id} className="hall-card">
                  <img src={item.imageDataUrl} alt={`${item.displayName} shame`} />
                  <div className="hall-meta">
                    <strong>{item.displayName}</strong>
                    <span>{item.mode === 'team' ? '팀전' : '2인'}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
        <button className="btn-secondary" onClick={() => setPhase('lobby')}>
          메인으로
        </button>
      </div>
    );
  }

  const mobileUrl = `${window.location.origin}/mobile?room=${roomId}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(mobileUrl)}`;
  const timeLeftSec = Math.ceil(timeLeftMs / 1000);

  return (
    <div className="container game">
      <header className="game-header">
        <h1 className="title-small">TILT TUG</h1>
        <div className="room-badge">
          ROOM <span className="room-code">{roomId}</span>
        </div>
      </header>

      <div className="player-info">
        <div className="team-info team-a">
          <span className="team-label">TEAM A</span>
          <span className="team-count">{teamACount}명</span>
        </div>
        <div className="player-total">{playerCount}명 접속</div>
        <div className="team-info team-b">
          <span className="team-label">TEAM B</span>
          <span className="team-count">{teamBCount}명</span>
        </div>
      </div>

      {(phase === 'waiting' || phase === 'countdown' || phase === 'playing') && (
        <div className="status-bar">
          <span>모드: {roomMode === 'team' ? '팀전' : '2인'}</span>
          <span>준비 완료: {readyCount}/{playerCount}</span>
          <span className={fever ? 'fever-on' : ''}>
            남은 시간: {timeLeftSec}s {fever ? ' - FEVER!' : ''}
          </span>
          {countdown && <span>시작까지 {countdown}</span>}
        </div>
      )}

      {(phase === 'countdown' || phase === 'playing' || phase === 'result') && (
        <div className={`scoreboard ${fever ? 'fever' : ''}`}>
          <div className="score-team a">
            <div className="score-top">
              <span>TEAM A</span>
              {gainA > 0 && <span className="gain">+{gainA}</span>}
            </div>
            <div className="score-value">{scoreA}</div>
            <div className="combo-row">
              <span>콤보 {comboA}</span>
              <span>최고 {maxComboA}</span>
            </div>
          </div>
          <div className="score-vs">VS</div>
          <div className="score-team b">
            <div className="score-top">
              <span>TEAM B</span>
              {gainB > 0 && <span className="gain">+{gainB}</span>}
            </div>
            <div className="score-value">{scoreB}</div>
            <div className="combo-row">
              <span>콤보 {comboB}</span>
              <span>최고 {maxComboB}</span>
            </div>
          </div>
        </div>
      )}

      {playerJudges.length > 0 && (
        <div className="judge-board">
          {playerJudges.map((entry) => (
            <span key={`${entry.socketId}_${entry.at}`} className={`judge-badge ${entry.tone || 'good'}`}>
              {entry.team} - {entry.name}: {entry.judge}
            </span>
          ))}
        </div>
      )}

      {phase === 'waiting' && (
        <div className="join-guide">
          <p>모바일로 아래 주소에 접속하세요</p>
          <div className="url-box">{mobileUrl}</div>
          <div className="qr-wrap">
            <img src={qrUrl} alt="room qr" />
          </div>
          <p className="or-text">또는 방 코드 입력: <strong>{roomId}</strong></p>
          {canStart && (
            <button className="btn-primary" onClick={startGame}>
              게임 시작!
            </button>
          )}
          {!canStart && (
            <p className="hint">
              {roomMode === 'team'
                ? '팀전은 각 팀 2명 이상(총 4명 이상) + 전원 준비완료 시 시작됩니다'
                : '2인 모드는 2명 + 전원 준비완료 시 시작됩니다'}
            </p>
          )}
          <div className="ready-list">
            {players.map((p) => (
              <div key={p.socketId} className={`ready-item ${p.ready ? 'ok' : ''}`}>
                <span>{p.name} (Team {p.team})</span>
                <span>{p.ready ? '준비완료' : '준비중'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === 'countdown' && (
        <div className="join-guide">
          <p className="countdown-text">게임 시작 {countdown}</p>
        </div>
      )}

      <div className="arena">
        <div className="end-zone left">
          <span>A 승리</span>
        </div>

        <div className="track">
          <div className="track-bg">
            <div className="zone-a" />
            <div className="zone-center" />
            <div className="zone-b" />
          </div>
          {phase === 'playing' && (
            <div className="cheer-squad" aria-hidden="true">
              {cheerFans.map((fan) => (
                <div
                  key={fan.id}
                  className="cheer-fan"
                  style={{ left: fan.left, bottom: fan.bottom, '--fan-size': `${fan.size}px` }}
                >
                  {fan.message && (
                    <div
                      key={fan.bubbleKey}
                      className="cheer-bubble"
                      style={{ animationDuration: `${fan.bubbleMs}ms` }}
                    >
                      {fan.message}
                    </div>
                  )}
                  <img className="cheer-face" src={fan.faceSrc} alt="" />
                </div>
              ))}
            </div>
          )}
          <div
            className="rope-marker"
            style={{ left: `${50 + position * 0.5}%` }}
          >
            <div className="flag" />
            <div className="rope-line" />
          </div>
          <div className="danger-zone left" />
          <div className="danger-zone right" />
        </div>

        <div className="end-zone right">
          <span>B 승리</span>
        </div>
        {phase === 'playing' && (
          <div className="sideline-cheer-layer" aria-hidden="true">
            {SIDELINE_CHEER_LAYOUT.map((fan) => (
              <div
                key={fan.id}
                className={`sideline-cheer ${fan.side}`}
                style={{
                  top: fan.top,
                  '--sideline-delay': fan.delay,
                  '--sideline-speed': `${fan.speed}s`,
                  '--sideline-depth': fan.depth,
                }}
              >
                <span className="sideline-hand left" />
                <span className="sideline-hand right" />
              </div>
            ))}
          </div>
        )}
      </div>

      {phase === 'result' && (
        <div className="result-overlay">
          <div className="result-card">
            <h2 className="winner-text">
              {winner === 'DRAW' ? '무승부!' : `TEAM ${winner} 승리!`}
            </h2>
            <p className="hint">종료 사유: {endReason || 'normal'}</p>
            <p className="hint">최종 점수 A:{scoreA} / B:{scoreB}</p>
            <p className="hint">최고 콤보 A:{maxComboA} / B:{maxComboB}</p>
            {winner !== 'DRAW' && (
              <div className="pc-fame-wrap">
                <div className="pc-fame-col honor">
                  <p>명예의 전당 (승리팀)</p>
                  <button className="btn-primary btn-small" onClick={() => openPcCapture('honor')}>
                    {honorCameraOpen ? '카메라 다시 열기' : '명예 실시간 촬영'}
                  </button>
                  {honorCameraOpen && (
                    <div className="pc-live-capture">
                      <video ref={honorCameraVideoRef} autoPlay playsInline muted />
                      <div className="pc-live-capture-actions">
                        <button className="btn-primary btn-small" onClick={captureHonorLivePhoto}>
                          촬영 후 등록
                        </button>
                        <button className="btn-secondary btn-small" onClick={stopHonorLiveCamera}>
                          취소
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="pc-fame-col shame">
                  <p>불명예의 전당 (패배팀)</p>
                  <input
                    ref={shameCaptureInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={(e) => handlePcCaptureChange('shame', e.target.files?.[0], shameCaptureInputRef)}
                  />
                  <label className="pc-consent-row">
                    <input
                      type="checkbox"
                      checked={pcShameConsent}
                      onChange={(e) => setPcShameConsent(e.target.checked)}
                    />
                    <span>불명예 등록 동의</span>
                  </label>
                  <button className="btn-primary btn-small" onClick={() => openPcCapture('shame')}>
                    불명예 촬영 등록
                  </button>
                </div>
              </div>
            )}
            {pcFameStatus && <p className="hint">{pcFameStatus}</p>}
            {pcRecentFame.length > 0 && (
              <div className="pc-fame-recent">
                {pcRecentFame.map((item) => (
                  <article key={item.id} className="pc-fame-recent-card">
                    <img src={item.imageDataUrl} alt={`${item.displayName} recent`} />
                    <span>{item.type === 'honor' ? '명예' : '불명예'} - {item.displayName}</span>
                  </article>
                ))}
              </div>
            )}
            <div className="ready-list">
              {players.map((p) => (
                <div key={p.socketId} className="ready-item ok">
                  <span>{p.name}</span>
                  <span>기여도 {p.contribution}</span>
                </div>
              ))}
            </div>
            <button className="btn-primary" onClick={resetGame}>
              다시 하기
            </button>
          </div>
        </div>
      )}

      {phase === 'closed' && (
        <div className="result-overlay">
          <div className="result-card">
            <h2 className="winner-text">방이 종료되었습니다</h2>
            <p className="hint">{roomClosed}</p>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              새로고침
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
