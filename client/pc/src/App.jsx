import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SERVER_URL = window.location.origin;
const CHEER_MESSAGES = ['와', '잘한다', '화이팅', '이겨라'];
const PC_BASE_URL = import.meta.env.BASE_URL;
const MAIN_LOGO_SRC = `${PC_BASE_URL}mainLogo_tug.png`;
const CHEER_FACE_SOURCES = [
  `${PC_BASE_URL}cheerleaders/face-01.png`,
  `${PC_BASE_URL}cheerleaders/face-02.png`,
  `${PC_BASE_URL}cheerleaders/face-03.png`,
  `${PC_BASE_URL}cheerleaders/face-04.png`,
  `${PC_BASE_URL}cheerleaders/face-05.png`,
  `${PC_BASE_URL}cheerleaders/face-06.png`,
  `${PC_BASE_URL}cheerleaders/face-07.png`,
  `${PC_BASE_URL}cheerleaders/face-08.png`,
  `${PC_BASE_URL}cheerleaders/face-09.png`,
  `${PC_BASE_URL}cheerleaders/face-10.png`,
];
const CHEER_LAYOUT = [
  { left: '86px', top: '14%', size: 52 },
  { left: '86px', top: '28%', size: 56 },
  { left: '86px', top: '42%', size: 54 },
  { left: '86px', top: '56%', size: 56 },
  { left: '86px', top: '70%', size: 52 },
  { left: 'calc(100% - 86px)', top: '14%', size: 52 },
  { left: 'calc(100% - 86px)', top: '28%', size: 56 },
  { left: 'calc(100% - 86px)', top: '42%', size: 54 },
  { left: 'calc(100% - 86px)', top: '56%', size: 56 },
  { left: 'calc(100% - 86px)', top: '70%', size: 52 },
];
const SIDELINE_CHEER_LAYOUT = [
  { id: 'l1', side: 'left', top: '14%', depth: 0, delay: '0s', speed: 1.8 },
  { id: 'l2', side: 'left', top: '28%', depth: 1, delay: '0.2s', speed: 2.05 },
  { id: 'l3', side: 'left', top: '42%', depth: 0, delay: '0.38s', speed: 2.2 },
  { id: 'l4', side: 'left', top: '56%', depth: 1, delay: '0.56s', speed: 1.95 },
  { id: 'l5', side: 'left', top: '70%', depth: 0, delay: '0.74s', speed: 2.1 },
  { id: 'r1', side: 'right', top: '14%', depth: 1, delay: '0.1s', speed: 1.9 },
  { id: 'r2', side: 'right', top: '28%', depth: 0, delay: '0.28s', speed: 2.15 },
  { id: 'r3', side: 'right', top: '42%', depth: 1, delay: '0.46s', speed: 2.25 },
  { id: 'r4', side: 'right', top: '56%', depth: 0, delay: '0.64s', speed: 2.0 },
  { id: 'r5', side: 'right', top: '70%', depth: 1, delay: '0.82s', speed: 2.12 },
];

const createCheerFans = () =>
  CHEER_LAYOUT.map((layout, idx) => ({
    id: `fan-${idx}`,
    faceSrc: CHEER_FACE_SOURCES[idx % CHEER_FACE_SOURCES.length],
    ...layout,
    message: '',
    bubbleKey: 0,
    bubbleMs: 1400,
    visibleUntil: 0,
    nextAt: Date.now() + 400 + Math.floor(Math.random() * 2000),
  }));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function App() {
  const [phase, setPhase] = useState('lobby');
  const [selectedMode, setSelectedMode] = useState('duel');
  const [roomMode, setRoomMode] = useState('duel');
  const [roomId, setRoomId] = useState('');
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
  const [rhythmState, setRhythmState] = useState({
    beatMs: 700,
    hitWindowMs: 220,
    nextBeatAt: 0,
    beatProgress: 0,
    serverNow: 0,
  });
  const [rhythmNow, setRhythmNow] = useState(Date.now());
  const [winner, setWinner] = useState(null);
  const [endReason, setEndReason] = useState('');
  const [roomClosed, setRoomClosed] = useState('');
  const [hallHonor, setHallHonor] = useState([]);
  const [hallShame, setHallShame] = useState([]);
  const [pcFameStatus, setPcFameStatus] = useState('');
  const [pcRecentFame, setPcRecentFame] = useState([]);
  const [honorCameraOpen, setHonorCameraOpen] = useState(false);
  const [shameCameraOpen, setShameCameraOpen] = useState(false);
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
  const honorCameraVideoRef = useRef(null);
  const honorCameraStreamRef = useRef(null);
  const shameCameraVideoRef = useRef(null);
  const shameCameraStreamRef = useRef(null);

  useEffect(() => {
    return () => {
      stopHonorLiveCamera();
      stopShameLiveCamera();
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

  useEffect(() => {
    if (phase !== 'playing') return undefined;
    const ticker = setInterval(() => setRhythmNow(Date.now()), 33);
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
      setRhythmState({
        beatMs: 700,
        hitWindowMs: 220,
        nextBeatAt: Date.now() + 700,
        beatProgress: 0,
        serverNow: Date.now(),
      });
      setRhythmNow(Date.now());
    });

    socket.on('game_state', (state) => {
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
      if (state.rhythm) {
        setRhythmState({
          beatMs: state.rhythm.beatMs ?? 700,
          hitWindowMs: state.rhythm.hitWindowMs ?? 220,
          nextBeatAt: state.rhythm.nextBeatAt ?? 0,
          beatProgress: state.rhythm.beatProgress ?? 0,
          serverNow: state.serverNow ?? Date.now(),
        });
      }
      setRhythmNow(state.serverNow ?? Date.now());
    });

    socket.on('game_over', (data) => {
      stopHonorLiveCamera();
      stopShameLiveCamera();
      setWinner(data.winner);
      setEndReason(data.reason || '');
      setPlayers(data.players || []);
      setPcFameStatus('');
      setPcRecentFame([]);
      setPlayerJudges([]);
      setPhase('result');
    });

    socket.on('game_reset', () => {
      stopHonorLiveCamera();
      stopShameLiveCamera();
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
      setRhythmState({
        beatMs: 700,
        hitWindowMs: 220,
        nextBeatAt: 0,
        beatProgress: 0,
        serverNow: 0,
      });
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
    stopShameLiveCamera();
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      listenersBoundRef.current = false;
    }
    setRoomId('');
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
    setPcFameStatus('');
    setPcRecentFame([]);
    setPhase('lobby');
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

  const stopShameLiveCamera = () => {
    if (shameCameraStreamRef.current) {
      shameCameraStreamRef.current.getTracks().forEach((track) => track.stop());
      shameCameraStreamRef.current = null;
    }
    if (shameCameraVideoRef.current) {
      shameCameraVideoRef.current.srcObject = null;
    }
    setShameCameraOpen(false);
  };

  const waitForVideoMetadata = (video) =>
    new Promise((resolve, reject) => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        resolve();
        return;
      }
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('video_metadata_timeout'));
      }, 3000);
      const onLoadedMetadata = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timeoutId);
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
      };
      video.addEventListener('loadedmetadata', onLoadedMetadata);
    });

  const openLiveCamera = async (type) => {
    const isHonor = type === 'honor';
    const stopSelfCamera = isHonor ? stopHonorLiveCamera : stopShameLiveCamera;
    const stopOtherCamera = isHonor ? stopShameLiveCamera : stopHonorLiveCamera;
    const setCameraOpen = isHonor ? setHonorCameraOpen : setShameCameraOpen;
    const videoRef = isHonor ? honorCameraVideoRef : shameCameraVideoRef;
    const streamRef = isHonor ? honorCameraStreamRef : shameCameraStreamRef;
    const cameraLabel = isHonor ? '명예' : '불명예';

    if (!navigator.mediaDevices?.getUserMedia) {
      setPcFameStatus('이 브라우저는 카메라 촬영을 지원하지 않습니다.');
      return;
    }
    try {
      stopSelfCamera();
      stopOtherCamera();
      setCameraOpen(true);
      // Ensure the preview video is mounted before binding stream.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const video = videoRef.current;
      if (!video) {
        setCameraOpen(false);
        setPcFameStatus('카메라 미리보기를 찾을 수 없습니다.');
        return;
      }
      setPcFameStatus('카메라 연결 중...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await waitForVideoMetadata(video);
      await video.play();
      setPcFameStatus(`${cameraLabel} 카메라 준비 완료!`);
    } catch (error) {
      stopSelfCamera();
      setPcFameStatus('카메라 접근 실패: 권한을 확인해주세요.');
    }
  };

  const captureLivePhoto = (type) => {
    const isHonor = type === 'honor';
    const videoRef = isHonor ? honorCameraVideoRef : shameCameraVideoRef;
    const streamRef = isHonor ? honorCameraStreamRef : shameCameraStreamRef;
    const stopSelfCamera = isHonor ? stopHonorLiveCamera : stopShameLiveCamera;
    const video = videoRef.current;

    if (!video || !streamRef.current) {
      setPcFameStatus('카메라가 활성화되지 않았습니다.');
      return;
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      setPcFameStatus('카메라 영상을 불러오는 중입니다. 잠시 후 다시 시도하세요.');
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
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
    stopSelfCamera();
    submitPcFameRecord(type, imageDataUrl);
  };

  const submitPcFameRecord = (type, imageDataUrl) => {
    if (!imageDataUrl) {
      setPcFameStatus(type === 'honor' ? '명예 사진을 먼저 촬영해주세요.' : '불명예 사진을 먼저 촬영해주세요.');
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
    openLiveCamera(type);
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
          <img className="main-logo main-logo-lobby" src={MAIN_LOGO_SRC} alt="줄?다리기? 로고" />
          <p className="subtitle">모바일 기울기로 조작하는 줄?다리기?</p>
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
  const scoreGap = scoreA - scoreB;
  // 점수 차이를 선형 오프셋으로 매핑해 A팀 우세(+gap)일 때 왼쪽으로 이동시키고,
  // 과도하게 치우치지 않도록 최대 이동 범위를 제한한다.
  const maxOffset = 40;
  const sensitivity = 500;
  const uiOffset = Math.max(
    -maxOffset,
    Math.min(maxOffset, (scoreGap / sensitivity) * maxOffset)
  );
  const rhythmBeatMs = Math.max(250, rhythmState.beatMs || 700);
  const rhythmHitWindowMs = clamp(rhythmState.hitWindowMs || 220, 40, rhythmBeatMs * 0.45);
  const remainingToBeatMs = Math.max(0, (rhythmState.nextBeatAt || 0) - rhythmNow);
  const rhythmProgress = clamp(1 - remainingToBeatMs / rhythmBeatMs, 0, 1);
  const hitZonePercent = clamp((rhythmHitWindowMs / rhythmBeatMs) * 100, 8, 40);

  return (
    <div className="container game">
      <header className="game-header">
        <img className="main-logo main-logo-header" src={MAIN_LOGO_SRC} alt="줄?다리기? 로고" />
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

      {phase === 'playing' && (
        <div className={`rhythm-board ${phase === 'playing' ? 'active' : ''}`}>
          <div className="rhythm-title">RHYTHM TIMING</div>
          <div className="rhythm-track">
            <div className="rhythm-hit-zone" style={{ width: `${hitZonePercent}%` }}>
              HIT
            </div>
            <div className="rhythm-marker" style={{ left: `${rhythmProgress * 100}%` }} />
          </div>
          <div className="rhythm-caption">모바일에서 마커가 끝에 닿을 때 당기면 점수 획득</div>
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
          <div
            className="rope-marker"
            style={{ left: `${50 - uiOffset}%` }}
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
          <div className="cheer-squad" aria-hidden="true">
            {cheerFans.map((fan) => (
              <div
                key={fan.id}
                className="cheer-fan"
                style={{ left: fan.left, top: fan.top, '--fan-size': `${fan.size}px` }}
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
                        <button className="btn-primary btn-small" onClick={() => captureLivePhoto('honor')}>
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
                  <button className="btn-primary btn-small" onClick={() => openPcCapture('shame')}>
                    {shameCameraOpen ? '카메라 다시 열기' : '불명예 실시간 촬영'}
                  </button>
                  {shameCameraOpen && (
                    <div className="pc-live-capture">
                      <video ref={shameCameraVideoRef} autoPlay playsInline muted />
                      <div className="pc-live-capture-actions">
                        <button className="btn-primary btn-small" onClick={() => captureLivePhoto('shame')}>
                          촬영 후 등록
                        </button>
                        <button className="btn-secondary btn-small" onClick={stopShameLiveCamera}>
                          취소
                        </button>
                      </div>
                    </div>
                  )}
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
