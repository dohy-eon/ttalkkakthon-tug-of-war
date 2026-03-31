import { useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

export type Team = 'A' | 'B';
export type Mode = 'duel' | 'team';

export type GamePlayer = {
  socketId: string;
  name: string;
  team: Team;
  ready: boolean;
  contribution: number;
  maxCombo: number;
  avgAccuracy: number;
};

export type RoomStatePayload = {
  players?: GamePlayer[];
};

export type GameCountdownPayload = { seconds: number };

export type GameStatePayload = {
  timeLeftMs?: number;
  fever?: boolean;
};

export type Winner = 'A' | 'B' | 'DRAW' | '';

export type GameOverPayload = {
  winner?: Winner;
  reason?: string;
  players?: GamePlayer[];
};

export type JoinRoomResponse = {
  error?: string;
  team?: Team;
  name?: string;
  mode?: Mode;
};

export type SetTeamResponse = {
  error?: string;
  ok?: boolean;
  team?: Team;
};

export type FameRecord = {
  id: string;
  displayName: string;
  imageDataUrl: string;
};

export type GetFameRecordsResponse = { records?: FameRecord[] };

export type DuelSocketHandlers = {
  onRoomState: (data: RoomStatePayload, socket: Socket) => void;
  onGameCountdown: (payload: GameCountdownPayload) => void;
  onGameStarted: () => void;
  onGameState: (state: GameStatePayload) => void;
  onGameOver: (data: GameOverPayload) => void;
  onGameReset: () => void;
  onRoomClosed: () => void;
};

export function useDuelSocket(serverUrl: string, handlers: DuelSocketHandlers) {
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef<DuelSocketHandlers>(handlers);
  handlersRef.current = handlers;

  const ensureSocket = useCallback((): Socket => {
    if (socketRef.current) return socketRef.current;
    const socket = io(serverUrl);
    socketRef.current = socket;

    socket.on('room_state', (data: RoomStatePayload) => {
      handlersRef.current.onRoomState(data, socket);
    });
    socket.on('game_countdown', (payload: GameCountdownPayload) => {
      handlersRef.current.onGameCountdown(payload);
    });
    socket.on('game_started', () => {
      handlersRef.current.onGameStarted();
    });
    socket.on('game_state', (state: GameStatePayload) => {
      handlersRef.current.onGameState(state);
    });
    socket.on('game_over', (data: GameOverPayload) => {
      handlersRef.current.onGameOver(data);
    });
    socket.on('game_reset', () => {
      handlersRef.current.onGameReset();
    });
    socket.on('room_closed', () => {
      handlersRef.current.onRoomClosed();
    });

    return socket;
  }, [serverUrl]);

  const disconnect = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, []);

  return { ensureSocket, disconnect, socketRef };
}
