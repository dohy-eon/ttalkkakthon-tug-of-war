# TILT TUG

모바일 기울기로 조작하는 실시간 웹 기반 줄다리기 게임

## 시작하기

### 1. 의존성 설치

```bash
npm run install:all
```

### 2. 클라이언트 빌드

```bash
npm run build
```

### 3. 서버 실행

```bash
npm start
```

서버가 `http://localhost:3000` 에서 시작됩니다.

## 접속 방법

| 역할 | URL | 설명 |
|------|-----|------|
| PC (호스트) | `http://localhost:3000/pc` | 방 생성 + 게임 화면 |
| 모바일 (플레이어) | `http://localhost:3000/mobile` | 방 참가 + 기울기 조작 |

## 게임 방법

1. **PC**에서 "방 만들기" 클릭
2. 화면에 표시된 4자리 방 코드 확인
3. **모바일**에서 방 코드 입력 후 참가
4. 최소 2명 접속 시 호스트가 "게임 시작" 클릭
5. 모바일을 기울여 줄다리기!
   - Team A: 왼쪽으로 기울이기
   - Team B: 오른쪽으로 기울이기

## 프로젝트 구조

```
/server          Node.js + Socket.io 게임 서버
/client
  /pc            React 기반 PC 게임 화면
  /mobile        React 기반 모바일 컨트롤러
```

## 기술 스택

- **서버**: Node.js, Express, Socket.io
- **클라이언트**: React, Vite, Socket.io-client
- **입력**: DeviceOrientation API (gamma)
