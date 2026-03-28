import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const SERVER_URL = window.location.origin;

function App() {
  const [phase, setPhase] = useState('lobby');
  const [roomId, setRoomId] = useState('');
  const [position, setPosition] = useState(0);
  const [forceA, setForceA] = useState(0);
  const [forceB, setForceB] = useState(0);
  const [teamACount, setTeamACount] = useState(0);
  const [teamBCount, setTeamBCount] = useState(0);
  const [playerCount, setPlayerCount] = useState(0);
  const [winner, setWinner] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  const createRoom = () => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.emit('create_room', (data) => {
      setRoomId(data.roomId);
      setPhase('waiting');
    });

    socket.on('player_joined', (data) => {
      setPlayerCount(data.playerCount);
      setTeamACount(data.teamACount);
      setTeamBCount(data.teamBCount);
    });

    socket.on('game_started', () => {
      setPhase('playing');
      setWinner(null);
    });

    socket.on('game_state', (state) => {
      setPosition(state.position);
      setForceA(state.forceA);
      setForceB(state.forceB);
      setTeamACount(state.teamACount);
      setTeamBCount(state.teamBCount);
    });

    socket.on('game_over', (data) => {
      setWinner(data.winner);
      setPhase('result');
    });

    socket.on('game_reset', () => {
      setPosition(0);
      setForceA(0);
      setForceB(0);
      setWinner(null);
      setPhase('waiting');
    });
  };

  const startGame = () => {
    socketRef.current?.emit('start_game');
  };

  const resetGame = () => {
    socketRef.current?.emit('reset_game');
  };

  if (phase === 'lobby') {
    return (
      <div className="container lobby">
        <div className="logo-area">
          <h1 className="title">TILT TUG</h1>
          <p className="subtitle">모바일 기울기로 조작하는 줄다리기</p>
        </div>
        <button className="btn-primary" onClick={createRoom}>
          방 만들기
        </button>
      </div>
    );
  }

  const mobileUrl = `${window.location.origin}/mobile?room=${roomId}`;

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

      {phase === 'waiting' && (
        <div className="join-guide">
          <p>모바일로 아래 주소에 접속하세요</p>
          <div className="url-box">{mobileUrl}</div>
          <p className="or-text">또는 방 코드 입력: <strong>{roomId}</strong></p>
          {playerCount >= 2 && (
            <button className="btn-primary" onClick={startGame}>
              게임 시작!
            </button>
          )}
          {playerCount < 2 && (
            <p className="hint">최소 2명이 접속해야 시작할 수 있습니다</p>
          )}
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
      </div>

      <div className="force-bars">
        <div className="force-bar-group">
          <span className="force-label">A</span>
          <div className="force-bar">
            <div
              className="force-fill a"
              style={{ width: `${Math.abs(forceA) * 100}%` }}
            />
          </div>
        </div>
        <div className="force-bar-group">
          <span className="force-label">B</span>
          <div className="force-bar">
            <div
              className="force-fill b"
              style={{ width: `${Math.abs(forceB) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {phase === 'result' && (
        <div className="result-overlay">
          <div className="result-card">
            <h2 className="winner-text">
              🏆 TEAM {winner} 승리!
            </h2>
            <button className="btn-primary" onClick={resetGame}>
              다시 하기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
