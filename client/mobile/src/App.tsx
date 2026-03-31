import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { DuelPullEngine } from './core/duelPullEngine';
import { createPullHapticController } from './core/haptics';
import { getRhythmJudgeInfo, validateNickname } from './core/gameRules';
import { getSensorApisAvailable, requestSensorPermissions, shouldAskSensorPermission } from './core/sensor';
import {
  useDuelSocket,
  type FameRecord,
  type GamePlayer,
  type JoinRoomResponse,
  type Mode,
  type SetTeamResponse,
  type Team,
  type GetFameRecordsResponse,
} from './hooks/useDuelSocket';

const SERVER_URL = window.location.origin;

type Screen =
  | 'duel_join'
  | 'sensor_permission'
  | 'calibration'
  | 'duel_wait'
  | 'duel_countdown'
  | 'duel_play'
  | 'duel_result'
  | 'hall';

type RhythmJudgeTone = 'good' | 'great' | 'perfect' | 'miss';
type RhythmJudgeLabel = 'GOOD' | 'GREAT' | 'PERFECT' | 'MISS';
type Winner = 'A' | 'B' | 'DRAW' | '';

function App() {
  const [screen, setScreen] = useState<Screen>('duel_join');
  const [mode, setMode] = useState<Mode>('duel');
  const [roomId, setRoomId] = useState<string>('');
  const [nickname, setNickname] = useState<string>('');
  const [joinTeam, setJoinTeam] = useState<'' | Team>('');
  const [error, setError] = useState<string>('');

  const [team, setTeam] = useState<'' | Team>('');
  const [players, setPlayers] = useState<GamePlayer[]>([]);
  const [duelCountdown, setDuelCountdown] = useState<number>(0);
  const [duelTimeLeftMs, setDuelTimeLeftMs] = useState<number>(30000);
  const [duelFever, setDuelFever] = useState<boolean>(false);
  const [duelWinner, setDuelWinner] = useState<Winner>('');
  const [duelReason, setDuelReason] = useState<string>('');

  const [hallHonor, setHallHonor] = useState<FameRecord[]>([]);
  const [hallShame, setHallShame] = useState<FameRecord[]>([]);
  const [rhythmJudge, setRhythmJudge] = useState<RhythmJudgeLabel | ''>('');
  const [rhythmJudgeTone, setRhythmJudgeTone] = useState<RhythmJudgeTone>('good');
  const [judgeFxTick, setJudgeFxTick] = useState<number>(0);
  const [perfectFx, setPerfectFx] = useState<boolean>(false);
  const [perfectFxTick, setPerfectFxTick] = useState<number>(0);
  const [pullCombo, setPullCombo] = useState<number>(0);
  const [comboFxTick, setComboFxTick] = useState<number>(0);
  const [comboRushFx, setComboRushFx] = useState<boolean>(false);

  const [needsPermission, setNeedsPermission] = useState<boolean>(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
  const [sensorSupported, setSensorSupported] = useState<boolean>(true);
  const [calibrated, setCalibrated] = useState<boolean>(false);
  const [baselineBeta, setBaselineBeta] = useState<number>(0);
  const [baselineGamma, setBaselineGamma] = useState<number>(0);
  const [currentBeta, setCurrentBeta] = useState<number>(0);
  const [currentGamma, setCurrentGamma] = useState<number>(0);

  const engineRef = useRef<DuelPullEngine>(new DuelPullEngine());
  const sensorStartedRef = useRef<boolean>(false);
  const emitForceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const judgeClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const perfectFxTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const comboRushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pullComboRef = useRef<number>(0);

  const triggerPullHaptic = useMemo(() => createPullHapticController(), []);

  const updateComboFx = (nextCombo: number) => {
    pullComboRef.current = nextCombo;
    setPullCombo(nextCombo);
    if (nextCombo > 1) setComboFxTick((v) => v + 1);
    if (nextCombo >= 5) {
      setComboRushFx(true);
      if (comboRushTimeoutRef.current) clearTimeout(comboRushTimeoutRef.current);
      comboRushTimeoutRef.current = setTimeout(() => setComboRushFx(false), 260);
    }
  };

  const { ensureSocket, disconnect, socketRef } = useDuelSocket(SERVER_URL, {
    onRoomState: (data, socket) => {
      const nextPlayers = data.players || [];
      setPlayers(nextPlayers);
      const me = nextPlayers.find((p) => p.socketId === socket.id);
      if (me?.team) setTeam(me.team);
    },
    onGameCountdown: (payload) => {
      setDuelCountdown(payload.seconds);
      setScreen('duel_countdown');
    },
    onGameStarted: () => {
      setDuelWinner('');
      setDuelReason('');
      setDuelTimeLeftMs(30000);
      setDuelFever(false);
      updateComboFx(0);
      setScreen('duel_play');
    },
    onGameState: (state) => {
      setDuelTimeLeftMs(state.timeLeftMs ?? 0);
      setDuelFever(!!state.fever);
    },
    onGameOver: (data) => {
      setDuelWinner(data.winner || '');
      setDuelReason(data.reason || '');
      setPlayers(data.players || []);
      setScreen('duel_result');
    },
    onGameReset: () => {
      setDuelWinner('');
      setDuelReason('');
      updateComboFx(0);
      setScreen('duel_wait');
    },
    onRoomClosed: () => {
      setError('방이 종료되었습니다.');
      setScreen('duel_join');
      setMode('duel');
      setJoinTeam('');
      setTeam('');
      setPlayers([]);
      updateComboFx(0);
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) setRoomId(room);
    setMode('duel');
    setScreen('duel_join');
  }, []);

  const onMotion = useCallback((event: DeviceMotionEvent) => {
    engineRef.current.onMotion(event);
  }, []);

  const onOrientation = useCallback((event: DeviceOrientationEvent) => {
    const beta = Number(event.beta) || 0;
    const gamma = Number(event.gamma) || 0;
    engineRef.current.setOrientation(beta, gamma);
    setCurrentBeta(beta);
    setCurrentGamma(gamma);
  }, []);

  useEffect(() => {
    return () => {
      if (emitForceIntervalRef.current) clearInterval(emitForceIntervalRef.current);
      if (judgeClearTimeoutRef.current) clearTimeout(judgeClearTimeoutRef.current);
      if (perfectFxTimeoutRef.current) clearTimeout(perfectFxTimeoutRef.current);
      if (comboRushTimeoutRef.current) clearTimeout(comboRushTimeoutRef.current);
      disconnect();
      if (sensorStartedRef.current) {
        window.removeEventListener('devicemotion', onMotion);
        window.removeEventListener('deviceorientation', onOrientation);
      }
    };
  }, [disconnect, onMotion, onOrientation]);

  const resetSensorState = () => {
    setNeedsPermission(false);
    setPermissionGranted(false);
    setCalibrated(false);
    setBaselineBeta(0);
    setBaselineGamma(0);
    engineRef.current.reset();
    if (judgeClearTimeoutRef.current) clearTimeout(judgeClearTimeoutRef.current);
    if (perfectFxTimeoutRef.current) clearTimeout(perfectFxTimeoutRef.current);
    if (comboRushTimeoutRef.current) clearTimeout(comboRushTimeoutRef.current);
    setRhythmJudge('');
    setJudgeFxTick(0);
    setPerfectFx(false);
    setPerfectFxTick(0);
    setPullCombo(0);
    setComboFxTick(0);
    setComboRushFx(false);
    pullComboRef.current = 0;
  };

  const showRhythmJudge = (timingQuality: number, earlyPull = false) => {
    const { label, tone } = getRhythmJudgeInfo(timingQuality, earlyPull);
    setRhythmJudge(label);
    setRhythmJudgeTone(tone);
    setJudgeFxTick((v) => v + 1);
    if (label === 'MISS') {
      if (judgeClearTimeoutRef.current) clearTimeout(judgeClearTimeoutRef.current);
      judgeClearTimeoutRef.current = setTimeout(() => setRhythmJudge(''), 260);
      return;
    }
    if (label === 'PERFECT') {
      setPerfectFx(true);
      setPerfectFxTick((v) => v + 1);
      if (perfectFxTimeoutRef.current) clearTimeout(perfectFxTimeoutRef.current);
      perfectFxTimeoutRef.current = setTimeout(() => setPerfectFx(false), 260);
    }
    if (judgeClearTimeoutRef.current) clearTimeout(judgeClearTimeoutRef.current);
    judgeClearTimeoutRef.current = setTimeout(() => setRhythmJudge(''), 300);
  };

  const checkSensorSupport = (): boolean => {
    const supported = getSensorApisAvailable();
    setSensorSupported(supported);
    return supported;
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
      const { ok } = await requestSensorPermissions();
      if (ok) {
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

    if (shouldAskSensorPermission()) {
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
      baselineBeta: engineRef.current.getBaseline().beta,
      baselineGamma: engineRef.current.getBaseline().gamma,
    });
  };

  const calibrate = () => {
    if (!permissionGranted) {
      setError('센서 권한을 먼저 허용해주세요.');
      return;
    }
    const { beta, gamma } = engineRef.current.getCurrentOrientation();
    const baselineB = Number(beta.toFixed(2));
    const baselineG = Number(gamma.toFixed(2));
    engineRef.current.setBaseline(baselineB, baselineG);
    setBaselineBeta(baselineB);
    setBaselineGamma(baselineG);
    setCalibrated(true);
    emitReadyIfDuel();
    setError('');
    setScreen('duel_wait');
  };

  useEffect(() => {
    if (emitForceIntervalRef.current) clearInterval(emitForceIntervalRef.current);
    if (!socketRef.current || mode !== 'duel') return;
    if (!['duel_wait', 'duel_countdown', 'duel_play'].includes(screen)) return;

    emitForceIntervalRef.current = setInterval(() => {
      const now = Date.now();
      const output = engineRef.current.getOutputForce(now);
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

    return () => {
      if (emitForceIntervalRef.current) clearInterval(emitForceIntervalRef.current);
    };
  }, [screen, mode, team, duelTimeLeftMs, triggerPullHaptic]);

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
    socket.emit(
      'join_room',
      { roomId: roomId.trim(), name: nickname.trim(), preferredTeam: joinTeam || undefined },
      (res: JoinRoomResponse) => {
        if (res.error) {
          setError(res.error);
          return;
        }
        setError('');
        setTeam(res.team || '');
        beginSensorFlow();
      }
    );
  };

  const fetchHallRecords = () => {
    const socket = ensureSocket();
    socket.emit(
      'get_fame_records',
      { type: 'honor', limit: 24 },
      (res: GetFameRecordsResponse) => {
        setHallHonor(res?.records || []);
        setScreen('hall');
      }
    );
    socket.emit(
      'get_fame_records',
      { type: 'shame', limit: 24 },
      (res: GetFameRecordsResponse) => {
        setHallShame(res?.records || []);
      }
    );
  };

  const leaveDuelSession = () => {
    disconnect();
    setMode('duel');
    setJoinTeam('');
    setTeam('');
    setPlayers([]);
    setDuelWinner('');
    setDuelReason('');
    setScreen('duel_join');
  };

  const changeTeam = (nextTeam: Team) => {
    if (!socketRef.current) return;
    socketRef.current.emit('set_team', { team: nextTeam }, (res: SetTeamResponse) => {
      if (res.error) {
        setError(res.error);
        return;
      }
      setError('');
      setTeam(res.team || nextTeam);
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
          <button className="btn-primary" onClick={joinDuel}>
            참가하기
          </button>
          <button className="btn-secondary" onClick={fetchHallRecords}>
            전당 보기
          </button>
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
          <p>
            현재 기울기 (beta/gamma): {currentBeta.toFixed(1)} / {currentGamma.toFixed(1)}deg
          </p>
          <p>
            기준값 (beta/gamma): {baselineBeta.toFixed(1)} / {baselineGamma.toFixed(1)}deg
          </p>
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
        <p className="subtitle">수평 유지 후 앞뒤로 짧게 당겼다가 원위치 (팀 방향은 자동 반영)</p>
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
