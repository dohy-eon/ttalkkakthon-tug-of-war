import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SERVER_URL = window.location.origin;
const DECAY = 0.9;
const PULL_SCALE = 0.22;
const HORIZONTAL_GRAVITY_Z_MIN = 5.6;
const HORIZONTAL_GRAVITY_Z_MAX = 9.8;
const PULL_TRIGGER_THRESHOLD = 0.36;
const PULL_BEAT_MS = 500;
const PULL_BEAT_TOLERANCE_MS = 180;
const PULL_PULSE_MS = 240;
const HAPTIC_COOLDOWN_MS = 70;
const BAD_WORDS = ['씨발', '병신', '개새', 'fuck', 'shit', 'bitch'];
const SOLO_DURATION_MS = 30000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  const [error, setError] = useState('');

  const [team, setTeam] = useState('');
  const [players, setPlayers] = useState([]);
  const [duelCountdown, setDuelCountdown] = useState(0);
  const [duelTimeLeftMs, setDuelTimeLeftMs] = useState(30000);
  const [duelFever, setDuelFever] = useState(false);
  const [duelWinner, setDuelWinner] = useState('');
  const [duelReason, setDuelReason] = useState('');

  const [ranking, setRanking] = useState([]);
  const [rankResult, setRankResult] = useState(null);
  const [dailyRankResult, setDailyRankResult] = useState(null);
  const [rankingScope, setRankingScope] = useState('all');
  const [rankingNameQuery, setRankingNameQuery] = useState('');
  const [rankingScoreMin, setRankingScoreMin] = useState('');
  const [rankingScoreMax, setRankingScoreMax] = useState('');
  const [soloCountdown, setSoloCountdown] = useState(3);
  const [soloTimeLeftMs, setSoloTimeLeftMs] = useState(SOLO_DURATION_MS);
  const [soloScore, setSoloScore] = useState(0);
  const [soloCombo, setSoloCombo] = useState(0);
  const [soloMaxCombo, setSoloMaxCombo] = useState(0);
  const [soloAccuracy, setSoloAccuracy] = useState(0);
  const [soloFeverScore, setSoloFeverScore] = useState(0);
  const [soloGrade, setSoloGrade] = useState('');
  const [rhythmJudge, setRhythmJudge] = useState('');
  const [rhythmJudgeTone, setRhythmJudgeTone] = useState('good');
  const [judgeFxTick, setJudgeFxTick] = useState(0);
  const [perfectFx, setPerfectFx] = useState(false);
  const [perfectFxTick, setPerfectFxTick] = useState(0);

  const [needsPermission, setNeedsPermission] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [sensorSupported, setSensorSupported] = useState(true);
  const [calibrated, setCalibrated] = useState(false);
  const [baselineBeta, setBaselineBeta] = useState(0);
  const [baselineGamma, setBaselineGamma] = useState(0);
  const [currentBeta, setCurrentBeta] = useState(0);
  const [currentGamma, setCurrentGamma] = useState(0);
  const [force, setForce] = useState(0);

  const socketRef = useRef(null);
  const sensorStartedRef = useRef(false);
  const pullForceRef = useRef(0);
  const horizontalConfidenceRef = useRef(0);
  const currentBetaRef = useRef(0);
  const currentGammaRef = useRef(0);
  const baselineBetaRef = useRef(0);
  const baselineGammaRef = useRef(0);
  const emitForceIntervalRef = useRef(null);
  const soloLoopRef = useRef(null);
  const soloEndAtRef = useRef(0);
  const soloSessionIdRef = useRef('');
  const lastSoloLiveEmitAtRef = useRef(0);
  const lastPullBeatAtRef = useRef(0);
  const pullPulseUntilRef = useRef(0);
  const pullOverThresholdRef = useRef(false);
  const lastHapticAtRef = useRef(0);
  const judgeClearTimeoutRef = useRef(null);
  const perfectFxTimeoutRef = useRef(null);
  const soloStatsRef = useRef({
    score: 0,
    combo: 0,
    maxCombo: 0,
    feverScore: 0,
    accuracySum: 0,
    accuracyCount: 0,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    const entryMode = params.get('mode');
    if (room) setRoomId(room);
    if (entryMode === 'solo') {
      setMode('solo');
      setScreen('solo_join');
    } else {
      setMode('duel');
      setScreen('duel_join');
    }
  }, []);

  useEffect(() => {
    return () => {
      clearInterval(emitForceIntervalRef.current);
      clearInterval(soloLoopRef.current);
      clearTimeout(judgeClearTimeoutRef.current);
      clearTimeout(perfectFxTimeoutRef.current);
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

    // 수평 자세에서 앞뒤 당기기 축은 y축 가속으로 본다.
    const pullAxis = Math.abs(Number(linear?.y) || 0);
    const rawPull = clamp(pullAxis * PULL_SCALE * (0.35 + horizontalConfidence * 0.65), 0, 1);
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
      setPlayers(data.players || []);
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
      setScreen('duel_wait');
    });

    socket.on('room_closed', () => {
      setError('방이 종료되었습니다.');
      setScreen('duel_join');
      setMode('duel');
      setTeam('');
      setPlayers([]);
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
    setForce(0);
    pullForceRef.current = 0;
    horizontalConfidenceRef.current = 0;
    lastPullBeatAtRef.current = 0;
    pullPulseUntilRef.current = 0;
    pullOverThresholdRef.current = false;
    lastHapticAtRef.current = 0;
    clearTimeout(judgeClearTimeoutRef.current);
    clearTimeout(perfectFxTimeoutRef.current);
    setRhythmJudge('');
    setJudgeFxTick(0);
    setPerfectFx(false);
    setPerfectFxTick(0);
  };

  const triggerPullHaptic = ({ timingQuality = 0, fever = false, strong = false } = {}) => {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const now = Date.now();
    if (now - lastHapticAtRef.current < HAPTIC_COOLDOWN_MS) return;
    lastHapticAtRef.current = now;

    if (strong || timingQuality > 0.85) {
      navigator.vibrate(fever ? [22, 16, 28] : [16, 12, 22]);
      return;
    }
    if (timingQuality > 0.55) {
      navigator.vibrate(fever ? [18, 10, 18] : [12, 8, 12]);
      return;
    }
    navigator.vibrate(fever ? 14 : 10);
  };

  const showRhythmJudge = (timingQuality, earlyPull = false) => {
    if (earlyPull) {
      setRhythmJudge('MISS');
      setRhythmJudgeTone('miss');
      setJudgeFxTick((v) => v + 1);
      clearTimeout(judgeClearTimeoutRef.current);
      judgeClearTimeoutRef.current = setTimeout(() => setRhythmJudge(''), 260);
      return;
    }

    let label = 'GOOD';
    let tone = 'good';
    if (timingQuality >= 0.82) {
      label = 'PERFECT';
      tone = 'perfect';
    } else if (timingQuality >= 0.58) {
      label = 'GREAT';
      tone = 'great';
    }
    setRhythmJudge(label);
    setRhythmJudgeTone(tone);
    setJudgeFxTick((v) => v + 1);
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

  const beginSensorFlow = (targetMode) => {
    setMode(targetMode);
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
    if (mode !== 'duel') return;
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

    if (mode === 'duel') {
      setScreen('duel_wait');
    } else {
      setSoloCountdown(3);
      setScreen('solo_countdown');
    }
  };

  const getTiltError = () => {
    const betaDiff = Math.abs(currentBetaRef.current - baselineBetaRef.current);
    const gammaDiff = Math.abs(currentGammaRef.current - baselineGammaRef.current);
    return Math.hypot(betaDiff, gammaDiff);
  };

  const getAccuracy = () => {
    const tiltError = getTiltError();
    const horizontalConfidence = horizontalConfidenceRef.current;
    const tiltScore = clamp(1 - tiltError / 40, 0, 1);
    // Weaken horizontal strictness so off-horizontal posture is less punitive.
    return tiltScore * (0.7 + horizontalConfidence * 0.3);
  };

  const getOutputForce = () => {
    const now = Date.now();
    const accuracy = getAccuracy();
    const tiltError = getTiltError();
    if (tiltError > 55) return { value: 0, accuracy: 0, acceptedPull: false, earlyPull: false, timingQuality: 0 };

    const pullLevel = pullForceRef.current;
    const overThreshold = pullLevel >= PULL_TRIGGER_THRESHOLD;
    let acceptedPull = false;
    let earlyPull = false;
    let timingQuality = 0;

    if (overThreshold && !pullOverThresholdRef.current) {
      const lastBeat = lastPullBeatAtRef.current;
      const interval = lastBeat > 0 ? now - lastBeat : PULL_BEAT_MS;
      const minAllowed = PULL_BEAT_MS - PULL_BEAT_TOLERANCE_MS;

      if (interval >= minAllowed) {
        acceptedPull = true;
        const offset = Math.abs(interval - PULL_BEAT_MS);
        timingQuality = lastBeat > 0 ? clamp(1 - offset / PULL_BEAT_TOLERANCE_MS, 0, 1) : 0.75;
        lastPullBeatAtRef.current = now;
        pullPulseUntilRef.current = now + PULL_PULSE_MS;
      } else {
        earlyPull = true;
      }
    }
    pullOverThresholdRef.current = overThreshold;

    const isPulseWindow = now <= pullPulseUntilRef.current;
    const value = isPulseWindow ? clamp(pullLevel * accuracy, 0, 1) : 0;
    return { value, accuracy, acceptedPull, earlyPull, timingQuality };
  };

  useEffect(() => {
    clearInterval(emitForceIntervalRef.current);
    if (!socketRef.current || mode !== 'duel') return;
    if (!['duel_wait', 'duel_countdown', 'duel_play'].includes(screen)) return;

    emitForceIntervalRef.current = setInterval(() => {
      const output = getOutputForce();
      const directional = team === 'A' ? -output.value : output.value;
      setForce(directional);
      socketRef.current?.emit('force', { value: directional, accuracy: output.accuracy });
      if (output.acceptedPull) {
        showRhythmJudge(output.timingQuality, false);
        triggerPullHaptic({
          timingQuality: output.timingQuality,
          fever: duelTimeLeftMs <= 5000,
        });
      } else if (output.earlyPull) {
        showRhythmJudge(0, true);
      }
    }, 50);

    return () => clearInterval(emitForceIntervalRef.current);
  }, [screen, mode, team, duelTimeLeftMs]);

  useEffect(() => {
    if (screen !== 'solo_countdown') return;
    if (soloCountdown <= 0) {
      setScreen('solo_play');
      soloEndAtRef.current = Date.now() + SOLO_DURATION_MS;
      soloSessionIdRef.current = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      lastSoloLiveEmitAtRef.current = 0;
      soloStatsRef.current = {
        score: 0,
        combo: 0,
        maxCombo: 0,
        feverScore: 0,
        accuracySum: 0,
        accuracyCount: 0,
      };
      lastPullBeatAtRef.current = 0;
      pullPulseUntilRef.current = 0;
      pullOverThresholdRef.current = false;
      setSoloTimeLeftMs(SOLO_DURATION_MS);
      setSoloScore(0);
      setSoloCombo(0);
      setSoloMaxCombo(0);
      setSoloAccuracy(0);
      setSoloFeverScore(0);
      setSoloGrade('');
      const socket = ensureSocket();
      socket.emit('solo_live_start', {
        sessionId: soloSessionIdRef.current,
        nickname: nickname.trim(),
      });
      return;
    }

    const timer = setTimeout(() => setSoloCountdown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [screen, soloCountdown]);

  const endSoloGame = async () => {
    clearInterval(soloLoopRef.current);
    const stats = soloStatsRef.current;
    const avgAccuracy = stats.accuracyCount > 0 ? (stats.accuracySum / stats.accuracyCount) * 100 : 0;
    setSoloAccuracy(Number(avgAccuracy.toFixed(1)));
    const socket = ensureSocket();
    socket.emit('solo_live_end', {
      sessionId: soloSessionIdRef.current,
      score: stats.score,
      maxCombo: stats.maxCombo,
      accuracy: Number(avgAccuracy.toFixed(1)),
    });

    try {
      socket.emit(
        'submit_solo_result',
        {
          nickname: nickname.trim(),
          score: stats.score,
          maxCombo: stats.maxCombo,
          accuracy: Number(avgAccuracy.toFixed(1)),
          feverScore: stats.feverScore,
        },
        (res) => {
          if (res?.rank) setRankResult(res.rank);
          if (res?.dailyRank) setDailyRankResult(res.dailyRank);
        }
      );
    } catch {
      // no-op
    }

    setScreen('solo_result');
  };

  useEffect(() => {
    clearInterval(soloLoopRef.current);
    if (screen !== 'solo_play') return;

    soloLoopRef.current = setInterval(() => {
      const now = Date.now();
      const left = Math.max(0, soloEndAtRef.current - now);
      setSoloTimeLeftMs(left);

      const { value, accuracy, acceptedPull, earlyPull, timingQuality } = getOutputForce();
      setForce(value);
      const stats = soloStatsRef.current;
      stats.accuracySum += accuracy;
      stats.accuracyCount += 1;

      if (left <= 0) {
        endSoloGame();
        return;
      }

      const nowMs = Date.now();
      if (nowMs - lastSoloLiveEmitAtRef.current >= 120) {
        lastSoloLiveEmitAtRef.current = nowMs;
        const avgAccuracyLive = stats.accuracyCount > 0 ? (stats.accuracySum / stats.accuracyCount) * 100 : 0;
        ensureSocket().emit('solo_live_update', {
          sessionId: soloSessionIdRef.current,
          score: stats.score,
          combo: stats.combo,
          maxCombo: stats.maxCombo,
          accuracy: Number(avgAccuracyLive.toFixed(1)),
          grade: soloGrade || '-',
          fever: left <= 5000,
          timeLeftMs: left,
        });
      }

      if (earlyPull) {
        stats.combo = 0;
        setSoloCombo(0);
        setSoloGrade('INVALID');
        showRhythmJudge(0, true);
        return;
      }

      if (!acceptedPull) return;

      const magnitude = Math.abs(value);
      if (accuracy < 0.25 || magnitude < 0.25) {
        stats.combo = 0;
        setSoloCombo(0);
        setSoloGrade('WEAK');
        return;
      }

      let baseScore = 45;
      let grade = 'WEAK';
      if (accuracy > 0.85 && magnitude > 0.6) {
        grade = 'PERFECT';
        baseScore = 140;
      } else if (accuracy > 0.65 && magnitude > 0.45) {
        grade = 'GOOD';
        baseScore = 90;
      }

      stats.combo += 1;
      stats.maxCombo = Math.max(stats.maxCombo, stats.combo);
      const fever = left <= 5000;
      const comboMultiplier = 1 + Math.min(stats.combo, 20) * 0.05;
      const rhythmMultiplier = 0.7 + timingQuality * 0.3;
      const feverMultiplier = fever ? 1.5 : 1;
      const gained = Math.round(baseScore * accuracy * comboMultiplier * rhythmMultiplier * feverMultiplier);
      stats.score += gained;
      if (fever) stats.feverScore += gained;

      showRhythmJudge(timingQuality, false);
      triggerPullHaptic({
        timingQuality,
        fever,
        strong: grade === 'PERFECT',
      });

      setSoloScore(stats.score);
      setSoloCombo(stats.combo);
      setSoloMaxCombo(stats.maxCombo);
      setSoloFeverScore(stats.feverScore);
      setSoloGrade(grade);
    }, 50);

    return () => clearInterval(soloLoopRef.current);
  }, [screen]);

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
    socket.emit('join_room', { roomId: roomId.trim(), name: nickname.trim() }, (res) => {
      if (res?.error) {
        setError(res.error);
        return;
      }
      setError('');
      setTeam(res.team);
      beginSensorFlow('duel');
    });
  };

  const startSolo = () => {
    const nickError = validateNickname(nickname);
    if (nickError) {
      setError(nickError);
      return;
    }
    setError('');
    beginSensorFlow('solo');
  };

  const fetchRanking = (overrides = {}) => {
    const scope = overrides.scope ?? rankingScope;
    const nicknameQuery = overrides.nicknameQuery ?? rankingNameQuery;
    const scoreMin = overrides.scoreMin ?? rankingScoreMin;
    const scoreMax = overrides.scoreMax ?? rankingScoreMax;
    const socket = ensureSocket();
    socket.emit(
      'get_solo_ranking',
      {
        scope,
        nicknameQuery,
        scoreMin,
        scoreMax,
      },
      (res) => {
      setRanking(res?.top || []);
        setRankingScope(res?.scope || scope);
      setScreen('ranking');
      }
    );
  };

  const leaveDuelSession = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setMode('duel');
    setTeam('');
    setPlayers([]);
    setDuelWinner('');
    setDuelReason('');
    setScreen('duel_join');
  };

  const getTiltStatus = () => {
    const betaDiff = Math.abs(currentBeta - baselineBeta);
    const gammaDiff = Math.abs(currentGamma - baselineGamma);
    const diff = Math.hypot(betaDiff, gammaDiff);
    if (diff <= 10) return '정상';
    if (diff <= 20) return '약간 기울어짐';
    return '조정 필요';
  };

  if (screen === 'duel_join' || screen === 'solo_join') {
    return (
      <div className="container">
        <h2 className="title small">{screen === 'duel_join' ? '참가하기' : '1인 모드 시작'}</h2>
        <div className="form">
          {screen === 'duel_join' && (
            <input
              className="input"
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="방 코드 (4자리)"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
          )}
          <input
            className="input"
            type="text"
            maxLength={10}
            placeholder="닉네임 (2~10자)"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          {error && <p className="error">{error}</p>}
          <button className="btn-primary" onClick={screen === 'duel_join' ? joinDuel : startSolo}>
            {screen === 'duel_join' ? '참가하기' : '시작하기'}
          </button>
          <button className="btn-secondary" onClick={fetchRanking}>랭킹 보기</button>
          <p className="subtitle">모드 선택은 PC에서 진행됩니다.</p>
          {screen === 'solo_join' && <p className="subtitle">1인 모드는 PC 링크/QR로 진입할 수 있습니다.</p>}
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
          <button className="btn-secondary" onClick={() => setScreen(mode === 'duel' ? 'duel_join' : 'solo_join')}>
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
        <div className={`team-badge ${team === 'A' ? 'a' : 'b'}`}>TEAM {team}</div>
        {!!rhythmJudge && (
          <div key={judgeFxTick} className={`judge-pop ${rhythmJudgeTone}`}>
            {rhythmJudge}
          </div>
        )}
        <div className="stats-row">
          <span>남은 시간: {Math.ceil(duelTimeLeftMs / 1000)}s</span>
          <span className={duelFever ? 'fever' : ''}>{duelFever ? 'FEVER!' : 'NORMAL'}</span>
        </div>
        <div className="force-gauge">
          <div className="force-center" />
          <div className="force-indicator" style={{ left: `${50 + force * 45}%` }} />
        </div>
        <p className="subtitle">
          수평 유지 후 앞뒤로 짧게 당겼다가 원위치 (팀 방향은 자동 반영)
        </p>
        <p className="subtitle">리듬: 약 0.5초 간격으로 당기면 가장 유리합니다.</p>
      </div>
    );
  }

  if (screen === 'duel_result') {
    const isWin = duelWinner === team;
    return (
      <div className="container">
        <h2 className={`result ${isWin ? 'win' : 'lose'}`}>
          {duelWinner === 'DRAW' ? '무승부' : isWin ? '승리!' : '패배'}
        </h2>
        <p className="subtitle">종료 사유: {duelReason || 'normal'}</p>
        <div className="card list">
          {players.map((p) => (
            <div key={p.socketId} className="list-item">
              <span>{p.name}</span>
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

  if (screen === 'solo_countdown') {
    return (
      <div className="container">
        <h2 className="title small">1인 모드 시작</h2>
        <p className="count">{soloCountdown}</p>
      </div>
    );
  }

  if (screen === 'solo_play') {
    const fever = soloTimeLeftMs <= 5000;
    return (
      <div className="container play">
        {perfectFx && <div key={perfectFxTick} className="perfect-fx-overlay" />}
        <h2 className="title small">1인 모드</h2>
        {!!rhythmJudge && (
          <div key={judgeFxTick} className={`judge-pop ${rhythmJudgeTone}`}>
            {rhythmJudge}
          </div>
        )}
        <div className="stats-row">
          <span>시간 {Math.ceil(soloTimeLeftMs / 1000)}s</span>
          <span className={fever ? 'fever' : ''}>{fever ? 'FEVER!' : 'NORMAL'}</span>
        </div>
        <div className="card">
          <p>점수: {soloScore}</p>
          <p>콤보: {soloCombo}</p>
          <p>판정: {soloGrade || '-'}</p>
          <p>팁: 0.5초 리듬으로 당기기</p>
        </div>
        <div className="force-gauge">
          <div className="force-center" />
          <div className="force-indicator" style={{ left: `${50 + force * 45}%` }} />
        </div>
      </div>
    );
  }

  if (screen === 'solo_result') {
    return (
      <div className="container">
        <h2 className="title small">1인 모드 결과</h2>
        <div className="card">
          <p>최종 점수: {soloScore}</p>
          <p>최고 콤보: {soloMaxCombo}</p>
          <p>평균 정확도: {soloAccuracy}%</p>
          <p>피버 점수: {soloFeverScore}</p>
          {rankResult && <p>이번 기록 순위: {rankResult}위</p>}
          {dailyRankResult && <p>오늘 순위: {dailyRankResult}위</p>}
        </div>
        <div className="form">
          <button
            className="btn-primary"
            onClick={() => {
              setSoloCountdown(3);
              setScreen('solo_countdown');
            }}
          >
            다시하기
          </button>
          <button className="btn-secondary" onClick={fetchRanking}>
            랭킹 보기
          </button>
          <button className="btn-secondary" onClick={() => setScreen('duel_join')}>
            메인으로
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h2 className="title small">랭킹</h2>
      <div className="form">
        <div className="inline-row">
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
        <input
          className="input"
          type="text"
          placeholder="닉네임 검색"
          value={rankingNameQuery}
          onChange={(e) => setRankingNameQuery(e.target.value)}
        />
        <div className="inline-row">
          <input
            className="input"
            type="number"
            min="0"
            placeholder="최소 점수"
            value={rankingScoreMin}
            onChange={(e) => setRankingScoreMin(e.target.value)}
          />
          <input
            className="input"
            type="number"
            min="0"
            placeholder="최대 점수"
            value={rankingScoreMax}
            onChange={(e) => setRankingScoreMax(e.target.value)}
          />
        </div>
        <button className="btn-primary" onClick={() => fetchRanking()}>
          검색 적용
        </button>
      </div>
      <div className="card list">
        {ranking.length === 0 && <p>기록이 없습니다.</p>}
        {ranking.map((entry) => (
          <div key={`${entry.rank}_${entry.createdAt}`} className="list-item">
            <span>
              {entry.rank}. {entry.nickname}
            </span>
            <span>{entry.score}</span>
          </div>
        ))}
      </div>
      <button className="btn-secondary" onClick={() => setScreen('duel_join')}>
        메인으로
      </button>
    </div>
  );
}

export default App;
