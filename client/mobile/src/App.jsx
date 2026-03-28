import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SERVER_URL = window.location.origin;
const DECAY = 0.82;
const PULL_SCALE = 0.4;
const HORIZONTAL_GRAVITY_Z_MIN = 4.8;
const HORIZONTAL_GRAVITY_Z_MAX = 9.8;
const PULL_TRIGGER_THRESHOLD = 0.45;
const PULL_BEAT_MS = 450;
const PULL_BEAT_TOLERANCE_MS = 280;
const PULL_FIRST_HIT_QUALITY = 0.8;
const PULL_PULSE_MS = 300;
const HAPTIC_COOLDOWN_MS = 70;
const BAD_WORDS = ['씨발', '병신', '개새', 'fuck', 'shit', 'bitch'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getRhythmJudgeInfo(timingQuality, earlyPull = false) {
  if (earlyPull) return { label: 'MISS', tone: 'miss' };
  if (timingQuality >= 0.88) return { label: 'PERFECT', tone: 'perfect' };
  if (timingQuality >= 0.66) return { label: 'GREAT', tone: 'great' };
  return { label: 'GOOD', tone: 'good' };
}

function validateNickname(raw) {
  const nickname = String(raw || '').trim();
  if (!nickname) return '닉네임을 입력해주세요.';
  if (nickname.length < 2 || nickname.length > 10) return '닉네임은 2~10자여야 합니다.';
  if (BAD_WORDS.some((word) => nickname.toLowerCase().includes(word))) {
    return '사용할 수 없는 닉네임입니다.';
  }
  return '';
}

function App() {
  const [screen, setScreen] = useState('duel_join');
  const [mode, setMode] = useState('duel');
  const [roomId, setRoomId] = useState('');
  const [nickname, setNickname] = useState('');
  const [joinTeam, setJoinTeam] = useState('');
  const [error, setError] = useState('');

  const [team, setTeam] = useState('');
  const [players, setPlayers] = useState([]);
  const [duelCountdown, setDuelCountdown] = useState(0);
  const [duelTimeLeftMs, setDuelTimeLeftMs] = useState(30000);
  const [duelFever, setDuelFever] = useState(false);
  const [duelWinner, setDuelWinner] = useState('');
  const [duelReason, setDuelReason] = useState('');

  const [hallHonor, setHallHonor] = useState([]);
  const [hallShame, setHallShame] = useState([]);
  const [rhythmJudge, setRhythmJudge] = useState('');
  const [rhythmJudgeTone, setRhythmJudgeTone] = useState('good');
  const [judgeFxTick, setJudgeFxTick] = useState(0);
  const [perfectFx, setPerfectFx] = useState(false);
  const [perfectFxTick, setPerfectFxTick] = useState(0);
  const [pullCombo, setPullCombo] = useState(0);
  const [comboFxTick, setComboFxTick] = useState(0);
  const [comboRushFx, setComboRushFx] = useState(false);

  const [needsPermission, setNeedsPermission] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [sensorSupported, setSensorSupported] = useState(true);
  const [calibrated, setCalibrated] = useState(false);
  const [baselineBeta, setBaselineBeta] = useState(0);
  const [baselineGamma, setBaselineGamma] = useState(0);
  const [currentBeta, setCurrentBeta] = useState(0);
  const [currentGamma, setCurrentGamma] = useState(0);

  const socketRef = useRef(null);
  const sensorStartedRef = useRef(false);
  const pullForceRef = useRef(0);
  const horizontalConfidenceRef = useRef(0);
  const currentBetaRef = useRef(0);
  const currentGammaRef = useRef(0);
  const baselineBetaRef = useRef(0);
  const baselineGammaRef = useRef(0);
  const emitForceIntervalRef = useRef(null);
  const lastPullBeatAtRef = useRef(0);
  const pullPulseUntilRef = useRef(0);
  const pullOverThresholdRef = useRef(false);
  const lastPullAxisRef = useRef(0);
  const lastHapticAtRef = useRef(0);
  const judgeClearTimeoutRef = useRef(null);
  const perfectFxTimeoutRef = useRef(null);
  const comboRushTimeoutRef = useRef(null);
  const pullComboRef = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) setRoomId(room);
    setMode('duel');
    setScreen('duel_join');
  }, []);

  useEffect(() => {
    return () => {
      clearInterval(emitForceIntervalRef.current);
      clearTimeout(judgeClearTimeoutRef.current);
      clearTimeout(perfectFxTimeoutRef.current);
      clearTimeout(comboRushTimeoutRef.current);
      if (socketRef.current) socketRef.current.disconnect();
      if (sensorStartedRef.current) {
        window.removeEventListener('devicemotion', onMotion);
        window.removeEventListener('deviceorientation', onOrientation);
      }
    };
  }, []);

  const onMotion = (event) => {
    const linear = event.acceleration;
    const gravity = event.accelerationIncludingGravity;
    if (!gravity || gravity.z === null) return;

    const gravityZ = Math.abs(gravity.z);
    const horizontalConfidence = clamp(
      (gravityZ - HORIZONTAL_GRAVITY_Z_MIN) / (HORIZONTAL_GRAVITY_Z_MAX - HORIZONTAL_GRAVITY_Z_MIN),
      0,
      1
    );
    horizontalConfidenceRef.current = horizontalConfidence;

    // linear acceleration 이 없는 기기에서는 includingGravity 를 fallback 으로 사용한다.
    const pullAxis = Number(linear?.y ?? gravity?.y ?? 0);
    const pullDelta = Math.abs(pullAxis - lastPullAxisRef.current);
    lastPullAxisRef.current = pullAxis;
    const axisBoost = linear?.y == null ? 0.75 : 1;
    const rawPull = clamp(pullDelta * PULL_SCALE * axisBoost * (0.8 + horizontalConfidence * 0.2), 0, 1);
    const smoothed = pullForceRef.current * DECAY + rawPull * (1 - DECAY);
    pullForceRef.current = clamp(smoothed, 0, 1);
  };

  const onOrientation = (event) => {
    const beta = Number(event.beta) || 0;
    const gamma = Number(event.gamma) || 0;
    currentBetaRef.current = beta;
    currentGammaRef.current = gamma;
    setCurrentBeta(beta);
    setCurrentGamma(gamma);
  };

  const ensureSocket = () => {
    if (socketRef.current) return socketRef.current;
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on('room_state', (data) => {
      const nextPlayers = data.players || [];
      setPlayers(nextPlayers);
      const me = nextPlayers.find((p) => p.socketId === socket.id);
      if (me?.team) setTeam(me.team);
    });

    socket.on('game_countdown', ({ seconds }) => {
      setDuelCountdown(seconds);
      setScreen('duel_countdown');
    });

    socket.on('game_started', () => {
      setDuelWinner('');
      setDuelReason('');
      setDuelTimeLeftMs(30000);
      setDuelFever(false);
      updateComboFx(0);
      setScreen('duel_play');
    });

    socket.on('game_state', (state) => {
      setDuelTimeLeftMs(state.timeLeftMs ?? 0);
      setDuelFever(!!state.fever);
    });

    socket.on('game_over', (data) => {
      setDuelWinner(data.winner || '');
      setDuelReason(data.reason || '');
      setPlayers(data.players || []);
      setScreen('duel_result');
    });

    socket.on('game_reset', () => {
      setDuelWinner('');
      setDuelReason('');
      updateComboFx(0);
      setScreen('duel_wait');
    });

    socket.on('room_closed', () => {
      setError('방이 종료되었습니다.');
      setScreen('duel_join');
      setMode('duel');
      setJoinTeam('');
      setTeam('');
      setPlayers([]);
      updateComboFx(0);
    });

    return socket;
  };

  const resetSensorState = () => {
    setNeedsPermission(false);
    setPermissionGranted(false);
    setCalibrated(false);
    setBaselineBeta(0);
    setBaselineGamma(0);
    baselineBetaRef.current = 0;
    baselineGammaRef.current = 0;
    pullForceRef.current = 0;
    lastPullAxisRef.current = 0;
    horizontalConfidenceRef.current = 0;
    lastPullBeatAtRef.current = 0;
    pullPulseUntilRef.current = 0;
    pullOverThresholdRef.current = false;
    lastHapticAtRef.current = 0;
    clearTimeout(judgeClearTimeoutRef.current);
    clearTimeout(perfectFxTimeoutRef.current);
    clearTimeout(comboRushTimeoutRef.current);
    setRhythmJudge('');
    setJudgeFxTick(0);
    setPerfectFx(false);
    setPerfectFxTick(0);
    setPullCombo(0);
    setComboFxTick(0);
    setComboRushFx(false);
    pullComboRef.current = 0;
  };

  const updateComboFx = (nextCombo) => {
    pullComboRef.current = nextCombo;
    setPullCombo(nextCombo);
    if (nextCombo > 1) setComboFxTick((v) => v + 1);
    if (nextCombo >= 5) {
      setComboRushFx(true);
      clearTimeout(comboRushTimeoutRef.current);
      comboRushTimeoutRef.current = setTimeout(() => setComboRushFx(false), 260);
    }
  };

  const triggerPullHaptic = ({ timingQuality = 0, fever = false, strong = false } = {}) => {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    // Trigger haptics only on GREAT+ rhythm hits.
    if (!strong && timingQuality < 0.66) return;
    const now = Date.now();
    if (now - lastHapticAtRef.current < HAPTIC_COOLDOWN_MS) return;
    lastHapticAtRef.current = now;

    if (strong || timingQuality > 0.85) {
      navigator.vibrate(fever ? [22, 16, 28] : [16, 12, 22]);
      return;
    }
    if (timingQuality >= 0.66) {
      navigator.vibrate(fever ? [18, 10, 18] : [12, 8, 12]);
      return;
    }
  };

  const showRhythmJudge = (timingQuality, earlyPull = false) => {
    const { label, tone } = getRhythmJudgeInfo(timingQuality, earlyPull);
    setRhythmJudge(label);
    setRhythmJudgeTone(tone);
    setJudgeFxTick((v) => v + 1);
    if (label === 'MISS') {
      clearTimeout(judgeClearTimeoutRef.current);
      judgeClearTimeoutRef.current = setTimeout(() => setRhythmJudge(''), 260);
      return;
    }
    if (label === 'PERFECT') {
      setPerfectFx(true);
      setPerfectFxTick((v) => v + 1);
      clearTimeout(perfectFxTimeoutRef.current);
      perfectFxTimeoutRef.current = setTimeout(() => setPerfectFx(false), 260);
    }
    clearTimeout(judgeClearTimeoutRef.current);
    judgeClearTimeoutRef.current = setTimeout(() => setRhythmJudge(''), 300);
  };

  const checkSensorSupport = () => {
    const hasMotion = typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
    const hasOrientation = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
    const supported = hasMotion && hasOrientation;
    setSensorSupported(supported);
    return supported;
  };

  const shouldAskPermission = () => {
    const motionNeedsAsk =
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function';
    const orientationNeedsAsk =
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function';
    return motionNeedsAsk || orientationNeedsAsk;
  };

  const startSensors = () => {
    if (sensorStartedRef.current) return;
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientation', onOrientation);
    sensorStartedRef.current = true;
    setPermissionGranted(true);
    setNeedsPermission(false);
  };

  const requestSensorPermission = async () => {
    if (!checkSensorSupport()) {
      setError('지원되지 않는 브라우저/기기입니다.');
      return;
    }

    try {
      const askMotion =
        typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function'
          ? DeviceMotionEvent.requestPermission()
          : Promise.resolve('granted');
      const askOrientation =
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
          ? DeviceOrientationEvent.requestPermission()
          : Promise.resolve('granted');

      const [motion, orientation] = await Promise.all([askMotion, askOrientation]);
      if (motion === 'granted' && orientation === 'granted') {
        startSensors();
      } else {
        setError('센서 권한이 거부되었습니다.');
      }
    } catch {
      setError('센서 접근 실패. 다시 시도해주세요.');
    }
  };

  const beginSensorFlow = () => {
    setMode('duel');
    resetSensorState();
    if (!checkSensorSupport()) {
      setError('지원되지 않는 브라우저/기기입니다.');
      return;
    }

    if (shouldAskPermission()) {
      setNeedsPermission(true);
      setScreen('sensor_permission');
    } else {
      startSensors();
      setScreen('calibration');
    }
  };

  const emitReadyIfDuel = () => {
    socketRef.current?.emit('set_ready', {
      sensorGranted: true,
      calibrated: true,
      baselineBeta: baselineBetaRef.current,
      baselineGamma: baselineGammaRef.current,
    });
  };

  const calibrate = () => {
    if (!permissionGranted) {
      setError('센서 권한을 먼저 허용해주세요.');
      return;
    }
    const baselineB = Number(currentBetaRef.current.toFixed(2));
    const baselineG = Number(currentGammaRef.current.toFixed(2));
    baselineBetaRef.current = baselineB;
    baselineGammaRef.current = baselineG;
    setBaselineBeta(baselineB);
    setBaselineGamma(baselineG);
    setCalibrated(true);
    emitReadyIfDuel();
    setError('');
    setScreen('duel_wait');
  };

  const getTiltError = () => {
    const betaDiff = Math.abs(currentBetaRef.current - baselineBetaRef.current);
    const gammaDiff = Math.abs(currentGammaRef.current - baselineGammaRef.current);
    return Math.hypot(betaDiff, gammaDiff);
  };

  const getAccuracy = () => {
    const tiltError = getTiltError();
    const horizontalConfidence = horizontalConfidenceRef.current;
    const tiltScore = clamp(1 - tiltError / 36, 0, 1);
    return tiltScore * (0.62 + horizontalConfidence * 0.38);
  };

  const getOutputForce = () => {
    const now = Date.now();
    const accuracy = getAccuracy();
    const tiltError = getTiltError();
    if (tiltError > 75) {
      return {
        value: 0,
        accuracy: 0,
        acceptedPull: false,
        earlyPull: false,
        invalidPull: false,
        timingQuality: 0,
      };
    }

    const pullLevel = pullForceRef.current;
    const overThreshold = pullLevel >= PULL_TRIGGER_THRESHOLD;
    const risingEdge = overThreshold && !pullOverThresholdRef.current;
    let acceptedPull = false;
    let earlyPull = false;
    let invalidPull = false;
    let timingQuality = 0;

    if (risingEdge) {
      const lastBeat = lastPullBeatAtRef.current;
      const interval = lastBeat > 0 ? now - lastBeat : PULL_BEAT_MS;
      const minCooldown = 150;

      if (lastBeat > 0 && interval < minCooldown) {
        earlyPull = true;
        invalidPull = true;
        pullPulseUntilRef.current = 0;
      } else {
        const offset = Math.abs(interval - PULL_BEAT_MS);
        if (lastBeat === 0 || offset <= PULL_BEAT_TOLERANCE_MS) {
          acceptedPull = true;
          timingQuality =
            lastBeat === 0
              ? PULL_FIRST_HIT_QUALITY
              : clamp(1 - offset / PULL_BEAT_TOLERANCE_MS, 0.5, 1);
          lastPullBeatAtRef.current = now;
          pullPulseUntilRef.current = now + PULL_PULSE_MS;
        } else {
          // 박자를 크게 놓치면 MISS 처리하되, 다음 입력부터는 다시 리듬에 진입할 수 있게 리셋합니다.
          earlyPull = true;
          invalidPull = true;
          pullPulseUntilRef.current = 0;
          lastPullBeatAtRef.current = now;
        }
      }
    }
    pullOverThresholdRef.current = overThreshold;

    const isPulseWindow = now <= pullPulseUntilRef.current;
    const value = isPulseWindow ? clamp(pullLevel * accuracy, 0, 1) : 0;
    return { value, accuracy, acceptedPull, earlyPull, invalidPull, timingQuality };
  };

  useEffect(() => {
    clearInterval(emitForceIntervalRef.current);
    if (!socketRef.current || mode !== 'duel') return;
    if (!['duel_wait', 'duel_countdown', 'duel_play'].includes(screen)) return;

    emitForceIntervalRef.current = setInterval(() => {
      const output = getOutputForce();
      const directional = team === 'A' ? -output.value : output.value;
      const judgeInfo = output.acceptedPull
        ? getRhythmJudgeInfo(output.timingQuality, false)
        : output.invalidPull
          ? getRhythmJudgeInfo(0, true)
          : null;
      socketRef.current?.emit('force', {
        value: directional,
        accuracy: output.accuracy,
        judge: judgeInfo?.label,
        judgeTone: judgeInfo?.tone,
        judgeAt: judgeInfo ? Date.now() : undefined,
      });
      if (output.acceptedPull) {
        updateComboFx(pullComboRef.current + 1);
        showRhythmJudge(output.timingQuality, false);
        triggerPullHaptic({
          timingQuality: output.timingQuality,
          fever: duelTimeLeftMs <= 5000,
        });
      } else if (output.invalidPull) {
        updateComboFx(0);
        showRhythmJudge(0, true);
      }
    }, 50);

    return () => clearInterval(emitForceIntervalRef.current);
  }, [screen, mode, team, duelTimeLeftMs]);

  const joinDuel = () => {
    const nickError = validateNickname(nickname);
    if (nickError) {
      setError(nickError);
      return;
    }
    if (!roomId.trim()) {
      setError('방 코드를 입력해주세요.');
      return;
    }

    const socket = ensureSocket();
    socket.emit('join_room', { roomId: roomId.trim(), name: nickname.trim(), preferredTeam: joinTeam || undefined }, (res) => {
      if (res?.error) {
        setError(res.error);
        return;
      }
      setError('');
      setTeam(res.team);
      beginSensorFlow();
    });
  };

  const fetchHallRecords = () => {
    const socket = ensureSocket();
    socket.emit('get_fame_records', { type: 'honor', limit: 24 }, (res) => {
      setHallHonor(res?.records || []);
      setScreen('hall');
    });
    socket.emit('get_fame_records', { type: 'shame', limit: 24 }, (res) => {
      setHallShame(res?.records || []);
    });
  };

  const leaveDuelSession = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setMode('duel');
    setJoinTeam('');
    setTeam('');
    setPlayers([]);
    setDuelWinner('');
    setDuelReason('');
    setScreen('duel_join');
  };

  const changeTeam = (nextTeam) => {
    if (!socketRef.current) return;
    socketRef.current.emit('set_team', { team: nextTeam }, (res) => {
      if (res?.error) {
        setError(res.error);
        return;
      }
      setError('');
      setTeam(res?.team || nextTeam);
    });
  };

  const getTiltStatus = () => {
    const betaDiff = Math.abs(currentBeta - baselineBeta);
    const gammaDiff = Math.abs(currentGamma - baselineGamma);
    const diff = Math.hypot(betaDiff, gammaDiff);
    if (diff <= 10) return '정상';
    if (diff <= 20) return '약간 기울어짐';
    return '조정 필요';
  };

  if (screen === 'duel_join') {
    return (
      <div className="container">
        <h2 className="title small">참가하기</h2>
        <div className="form">
          <input
            className="input"
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="방 코드 (4자리)"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />
          <input
            className="input"
            type="text"
            maxLength={10}
            placeholder="닉네임 (2~10자)"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <>
            <p className="subtitle">팀 선택</p>
            <div className="inline-row">
              <button
                className={`btn-chip ${joinTeam === '' ? 'active' : ''}`}
                onClick={() => setJoinTeam('')}
              >
                자동
              </button>
              <button
                className={`btn-chip ${joinTeam === 'A' ? 'active' : ''}`}
                onClick={() => setJoinTeam('A')}
              >
                TEAM A
              </button>
              <button
                className={`btn-chip ${joinTeam === 'B' ? 'active' : ''}`}
                onClick={() => setJoinTeam('B')}
              >
                TEAM B
              </button>
            </div>
          </>
          {error && <p className="error">{error}</p>}
          <button className="btn-primary" onClick={joinDuel}>참가하기</button>
          <button className="btn-secondary" onClick={fetchHallRecords}>전당 보기</button>
          <p className="subtitle">모드 선택은 PC에서 진행됩니다.</p>
        </div>
      </div>
    );
  }

  if (screen === 'sensor_permission') {
    return (
      <div className="container">
        <h2 className="title small">센서 권한 필요</h2>
        <p className="subtitle">
          {sensorSupported ? '모션/자이로 권한을 허용해주세요.' : '지원되지 않는 브라우저/기기입니다.'}
        </p>
        <div className="form">
          {sensorSupported && (
            <button
              className="btn-primary"
              onClick={() => {
                requestSensorPermission().then(() => {
                  if (permissionGranted || sensorStartedRef.current) setScreen('calibration');
                });
              }}
            >
              센서 허용
            </button>
          )}
          <button className="btn-secondary" onClick={() => setScreen('duel_join')}>
            이전 화면
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  if (screen === 'calibration') {
    return (
      <div className="container">
        <h2 className="title small">캘리브레이션</h2>
        <p className="subtitle">기기를 수평으로 들고 기준을 설정하세요.</p>
        <div className="card">
          <p>현재 기울기 (beta/gamma): {currentBeta.toFixed(1)} / {currentGamma.toFixed(1)}deg</p>
          <p>기준값 (beta/gamma): {baselineBeta.toFixed(1)} / {baselineGamma.toFixed(1)}deg</p>
          <p>상태: {getTiltStatus()}</p>
        </div>
        <div className="form">
          <button className="btn-primary" onClick={calibrate}>
            기준 설정
          </button>
          <button className="btn-secondary" onClick={calibrate}>
            재설정
          </button>
        </div>
        {calibrated && <p className="success">캘리브레이션 완료</p>}
      </div>
    );
  }

  if (screen === 'duel_wait') {
    const ready = players.filter((p) => p.ready).length;
    return (
      <div className="container">
        <div className={`team-badge ${team === 'A' ? 'a' : 'b'}`}>TEAM {team}</div>
        <h2 className="title small">대기 중</h2>
        <p className="subtitle">방장이 게임을 시작하면 자동으로 시작됩니다.</p>
        <p className="subtitle">
          준비 완료 {ready}/{players.length}
        </p>
        <div className="form">
          <p className="subtitle">팀 변경</p>
          <div className="inline-row">
            <button
              className={`btn-chip ${team === 'A' ? 'active' : ''}`}
              onClick={() => changeTeam('A')}
              disabled={team === 'A'}
            >
              TEAM A
            </button>
            <button
              className={`btn-chip ${team === 'B' ? 'active' : ''}`}
              onClick={() => changeTeam('B')}
              disabled={team === 'B'}
            >
              TEAM B
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    );
  }

  if (screen === 'duel_countdown') {
    return (
      <div className="container">
        <h2 className="title small">게임 시작</h2>
        <p className="count">{duelCountdown}</p>
      </div>
    );
  }

  if (screen === 'duel_play') {
    const teamColor = team === 'A' ? 'var(--team-a)' : 'var(--team-b)';
    return (
      <div className="container play" style={{ borderTop: `4px solid ${teamColor}` }}>
        {perfectFx && <div key={perfectFxTick} className="perfect-fx-overlay" />}
        {comboRushFx && <div className="combo-rush-overlay" />}
        <div className={`team-badge ${team === 'A' ? 'a' : 'b'}`}>TEAM {team}</div>
        {!!rhythmJudge && (
          <div key={judgeFxTick} className={`judge-pop ${rhythmJudgeTone}`}>
            {rhythmJudge}
          </div>
        )}
        {pullCombo >= 2 && (
          <div key={comboFxTick} className={`combo-pop ${pullCombo >= 10 ? 'hot' : ''}`}>
            {pullCombo} COMBO
          </div>
        )}
        <div className="stats-row">
          <span>남은 시간: {Math.ceil(duelTimeLeftMs / 1000)}s</span>
          <span className={duelFever ? 'fever' : ''}>{duelFever ? 'FEVER!' : 'NORMAL'}</span>
        </div>
        <p className="subtitle">
          수평 유지 후 앞뒤로 짧게 당겼다가 원위치 (팀 방향은 자동 반영)
        </p>
        <p className="subtitle">리듬: 약 0.5초 간격으로 당기면 가장 유리합니다.</p>
      </div>
    );
  }

  if (screen === 'duel_result') {
    const isDraw = duelWinner === 'DRAW';
    return (
      <div className="container">
        <h2 className="result">{isDraw ? '무승부' : `TEAM ${duelWinner} 승리!`}</h2>
        <p className="subtitle">종료 사유: {duelReason || 'normal'}</p>
        <div className="card list">
          <p className="subtitle">플레이어 기여도</p>
          {players.map((p) => (
            <div key={p.socketId} className="list-item">
              <span>
                {p.name} (Team {p.team})
              </span>
              <span>기여도 {p.contribution}</span>
            </div>
          ))}
        </div>
        <div className="form">
          <button className="btn-primary" onClick={leaveDuelSession}>
            메인으로
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'hall') {
    return (
      <div className="container">
        <h2 className="title small">명예/불명예 전당</h2>
        <div className="card hall-card-wrap">
          <p className="subtitle">명예의 전당</p>
          <div className="hall-grid-mobile">
            {hallHonor.length === 0 && <p className="subtitle">기록이 없습니다.</p>}
            {hallHonor.map((item) => (
              <article key={item.id} className="hall-item-mobile">
                <img src={item.imageDataUrl} alt={`${item.displayName} honor`} />
                <span>{item.displayName}</span>
              </article>
            ))}
          </div>
        </div>
        <div className="card hall-card-wrap">
          <p className="subtitle">불명예의 전당</p>
          <div className="hall-grid-mobile">
            {hallShame.length === 0 && <p className="subtitle">기록이 없습니다.</p>}
            {hallShame.map((item) => (
              <article key={item.id} className="hall-item-mobile">
                <img src={item.imageDataUrl} alt={`${item.displayName} shame`} />
                <span>{item.displayName}</span>
              </article>
            ))}
          </div>
        </div>
        <div className="form">
          <button className="btn-primary" onClick={fetchHallRecords}>
            새로고침
          </button>
          <button className="btn-secondary" onClick={() => setScreen('duel_join')}>
            메인으로
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default App;
