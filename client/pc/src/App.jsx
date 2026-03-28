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
  const [players, setPlayers] = useState([]);
  const [countdown, setCountdown] = useState(null);
  const [timeLeftMs, setTimeLeftMs] = useState(30000);
  const [fever, setFever] = useState(false);
  const [winner, setWinner] = useState(null);
  const [endReason, setEndReason] = useState('');
  const [roomClosed, setRoomClosed] = useState('');
  const [ranking, setRanking] = useState([]);
  const [rankingScope, setRankingScope] = useState('all');
  const [rankingNameQuery, setRankingNameQuery] = useState('');
  const [rankingScoreMin, setRankingScoreMin] = useState('');
  const [rankingScoreMax, setRankingScoreMax] = useState('');
  const socketRef = useRef(null);
  const listenersBoundRef = useRef(false);

  useEffect(() => {
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  const bindSocketListeners = (socket) => {
    if (listenersBoundRef.current) return;

    socket.on('room_state', (data) => {
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
    });

    socket.on('game_state', (state) => {
      setPosition(state.position);
      setForceA(state.forceA);
      setForceB(state.forceB);
      setTeamACount(state.teamACount);
      setTeamBCount(state.teamBCount);
      setTimeLeftMs(state.timeLeftMs ?? 0);
      setFever(!!state.fever);
    });

    socket.on('game_over', (data) => {
      setWinner(data.winner);
      setEndReason(data.reason || '');
      setPlayers(data.players || []);
      setPhase('result');
    });

    socket.on('game_reset', () => {
      setPosition(0);
      setForceA(0);
      setForceB(0);
      setWinner(null);
      setEndReason('');
      setCountdown(null);
      setTimeLeftMs(30000);
      setFever(false);
      setPhase('waiting');
    });

    socket.on('room_closed', ({ reason }) => {
      setRoomClosed(reason || 'host_disconnected');
      setPhase('closed');
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
    const socket = ensureSocket();
    socket.emit('create_room', (data) => {
      setRoomId(data.roomId);
      setPhase('waiting');
    });
  };

  const startGame = () => {
    socketRef.current?.emit('start_game');
  };

  const resetGame = () => {
    socketRef.current?.emit('reset_game');
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

  const readyCount = players.filter((p) => p.ready).length;
  const canStart = playerCount >= 2 && readyCount === playerCount && phase === 'waiting';

  if (phase === 'lobby') {
    return (
      <div className="container lobby">
        <div className="logo-area">
          <h1 className="title">TILT TUG</h1>
          <p className="subtitle">모바일 기울기로 조작하는 줄다리기</p>
        </div>
        <div className="lobby-actions">
          <button className="btn-primary" onClick={createRoom}>
            방 만들기
          </button>
          <button className="btn-secondary" onClick={() => fetchRanking()}>
            랭킹 보기
          </button>
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
          <span>준비 완료: {readyCount}/{playerCount}</span>
          <span className={fever ? 'fever-on' : ''}>
            남은 시간: {timeLeftSec}s {fever ? ' - FEVER!' : ''}
          </span>
          {countdown && <span>시작까지 {countdown}</span>}
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
            <p className="hint">최소 2명이 접속해야 시작할 수 있습니다</p>
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
              {winner === 'DRAW' ? '무승부!' : `TEAM ${winner} 승리!`}
            </h2>
            <p className="hint">종료 사유: {endReason || 'normal'}</p>
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
