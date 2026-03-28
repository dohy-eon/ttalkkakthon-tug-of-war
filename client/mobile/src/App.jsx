import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SERVER_URL = window.location.origin;
const DECAY = 0.92;
const ACCEL_SCALE = 0.12;

function App() {
  const [phase, setPhase] = useState('join');
  const [roomId, setRoomId] = useState('');
  const [team, setTeam] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [force, setForce] = useState(0);
  const [gameStarted, setGameStarted] = useState(false);
  const [winner, setWinner] = useState(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const socketRef = useRef(null);
  const forceRef = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) setRoomId(room);
  }, []);

  const joinRoom = useCallback(() => {
    if (!roomId.trim()) {
      setError('방 코드를 입력해주세요');
      return;
    }

    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join_room', { roomId: roomId.trim(), name: name.trim() || undefined }, (data) => {
        if (data.error) {
          setError(data.error);
          socket.disconnect();
          return;
        }
        setTeam(data.team);
        setPhase('waiting');

        if (
          typeof DeviceMotionEvent !== 'undefined' &&
          typeof DeviceMotionEvent.requestPermission === 'function'
        ) {
          setNeedsPermission(true);
        } else {
          startSensor();
        }
      });
    });

    socket.on('game_started', () => {
      setGameStarted(true);
      setWinner(null);
    });

    socket.on('game_over', (data) => {
      setWinner(data.winner);
      setGameStarted(false);
    });

    socket.on('game_reset', () => {
      setWinner(null);
      setGameStarted(false);
      setForce(0);
      forceRef.current = 0;
    });
  }, [roomId, name]);

  const startSensor = () => {
    window.addEventListener('devicemotion', (e) => {
      const accel = e.accelerationIncludingGravity;
      if (!accel || accel.x === null) return;

      const raw = accel.x * ACCEL_SCALE;
      const smoothed = forceRef.current * DECAY + raw * (1 - DECAY);
      const clamped = Math.max(-1, Math.min(1, smoothed));
      forceRef.current = clamped;
      setForce(clamped);
    });
    setNeedsPermission(false);
  };

  const requestPermission = async () => {
    try {
      const result = await DeviceMotionEvent.requestPermission();
      if (result === 'granted') {
        startSensor();
      } else {
        setError('센서 권한이 거부되었습니다');
      }
    } catch {
      setError('센서 접근 실패');
    }
  };

  useEffect(() => {
    if (!socketRef.current || phase !== 'waiting') return;

    const interval = setInterval(() => {
      socketRef.current?.emit('force', { value: forceRef.current });
    }, 50);

    return () => clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  if (phase === 'join') {
    return (
      <div className="container join-screen">
        <h1 className="title">TILT TUG</h1>
        <p className="subtitle">폰을 흔들어 줄다리기!</p>

        <div className="form">
          <input
            className="input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            placeholder="방 코드 (4자리)"
            value={roomId}
            onChange={(e) => {
              setRoomId(e.target.value);
              setError('');
            }}
            autoFocus
          />
          <input
            className="input"
            type="text"
            placeholder="닉네임 (선택)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {error && <p className="error">{error}</p>}
          <button className="btn-primary" onClick={joinRoom}>
            참가하기
          </button>
        </div>
      </div>
    );
  }

  const teamColor = team === 'A' ? 'var(--team-a)' : 'var(--team-b)';
  const isMyWin = winner === team;

  return (
    <div className="container play-screen" style={{ borderTop: `4px solid ${teamColor}` }}>
      <div className="team-badge" style={{ background: teamColor }}>
        TEAM {team}
      </div>

      {needsPermission && (
        <div className="permission-area">
          <p>모션 센서를 활성화해주세요</p>
          <button className="btn-primary" onClick={requestPermission}>
            센서 허용
          </button>
        </div>
      )}

      {!gameStarted && !winner && !needsPermission && (
        <div className="status-message">
          <div className="pulse-dot" />
          <p>게임 시작 대기 중...</p>
        </div>
      )}

      {gameStarted && (
        <div className="tilt-area">
          <p className="tilt-instruction">📱 폰을 좌우로 흔드세요!</p>
          <div className="force-display">
            <div className="force-gauge">
              <div className="force-center-mark" />
              <div
                className={`force-indicator ${team === 'A' ? 'a' : 'b'}`}
                style={{
                  transform: `translateX(${force * (Math.min(window.innerWidth * 0.85, 320) / 2 - 18)}px)`,
                }}
              />
            </div>
            <p className="force-value">{Math.abs(force * 100).toFixed(0)}%</p>
          </div>
          <p className="tilt-hint">
            {team === 'A' ? '⬅️ 왼쪽' : '오른쪽 ➡️'}으로 흔들면 힘이 커져요
          </p>
        </div>
      )}

      {winner && (
        <div className="result-area">
          <h2 className={isMyWin ? 'win' : 'lose'}>
            {isMyWin ? '🏆 승리!' : '😢 패배...'}
          </h2>
          <p>TEAM {winner} 승리</p>
        </div>
      )}
    </div>
  );
}

export default App;
