# LoBo - University AI Chatbot System

LoBo는 한국 대학교 AI 챗봇 시스템으로, 학생과 교직원에게 지능형 지원을 제공합니다. TypeScript 기반 풀스택 애플리케이션으로 구축되었으며, React 프론트엔드와 Express 백엔드, PostgreSQL 데이터베이스를 통합하여 운영됩니다.

## 프로젝트 구조

```
LoBo-01/
├── server/                 # Express 백엔드 (TypeScript)
│   ├── index.ts           # 서버 진입점
│   ├── routes.ts          # API 라우트
│   ├── auth.ts            # 인증 로직
│   ├── agentOrchestrator.ts  # AI 에이전트 오케스트레이션
│   ├── openai.ts          # OpenAI API 통합
│   ├── admin.ts           # 관리자 기능
│   ├── db.ts              # 데이터베이스 연결
│   └── ...                # 기타 서버 모듈
├── client/                # React 프론트엔드 (TypeScript)
│   └── src/
│       ├── main.tsx       # 애플리케이션 진입점
│       ├── App.tsx        # 루트 컴포넌트
│       ├── components/    # UI 컴포넌트
│       ├── pages/         # 페이지 컴포넌트
│       ├── hooks/         # 커스텀 훅
│       └── lib/           # 유틸리티 함수
├── db/                    # 데이터베이스 스키마
│   └── schema.ts          # Drizzle ORM 스키마
├── lobo-backup-2025-10-19.sql  # 데이터베이스 백업 파일
├── package.json           # 통합 의존성 관리
├── vite.config.ts         # Vite 설정
├── drizzle.config.ts      # Drizzle ORM 설정
└── tsconfig.json          # TypeScript 설정
```

## 기술 스택

### 백엔드
- **Runtime**: Node.js 20 + TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL (Neon serverless)
- **ORM**: Drizzle ORM
- **Authentication**: Replit Auth
- **AI**: OpenAI GPT-4o
- **Session**: express-session (PostgreSQL 저장)

### 프론트엔드
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **UI Library**: Radix UI + Tailwind CSS
- **State Management**: TanStack Query
- **Routing**: Wouter
- **Icons**: Lucide React

### 개발 도구
- **TypeScript**: 정적 타입 검사
- **tsx**: TypeScript 실행 환경
- **Drizzle Kit**: 데이터베이스 마이그레이션
- **ESLint**: 코드 품질 검사

## 설치 및 설정

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경 변수 설정

Replit Secrets에 다음 환경 변수를 추가하세요:

- `DATABASE_URL`: PostgreSQL 연결 문자열
- `OPENAI_API_KEY`: OpenAI API 키
- `SESSION_SECRET`: 세션 암호화 키

### 3. 데이터베이스 설정

#### PostgreSQL 데이터베이스 생성
1. Replit Tools 패널에서 "PostgreSQL" 선택
2. "Create a database" 클릭
3. `DATABASE_URL` 환경 변수 자동 설정 확인

#### 데이터베이스 복원
백업 파일을 사용하여 데이터베이스 복원:

```bash
# PostgreSQL 클라이언트로 복원
psql $DATABASE_URL < lobo-backup-2025-10-19.sql
```

## 실행

### 개발 모드 (권장)

서버와 클라이언트를 동시에 실행:

```bash
npm run dev
```

- **서버**: http://localhost:5000 (Express + API)
- **클라이언트**: http://localhost:5000 (Vite dev server가 프록시로 제공)

### 프로덕션 빌드

```bash
npm run build    # 클라이언트 빌드
npm start        # 서버 실행 (빌드된 정적 파일 제공)
```

## 사용 가능한 명령어

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 모드 실행 (서버 + Vite) |
| `npm run build` | 클라이언트 프로덕션 빌드 |
| `npm start` | 프로덕션 서버 실행 |
| `npm run db:push` | 데이터베이스 스키마 푸시 |
| `npm run db:studio` | Drizzle Studio 실행 |

## 주요 기능

### AI 에이전트 시스템
- 다중 AI 에이전트 관리 및 오케스트레이션
- 카테고리별 에이전트 분류
- @mention을 통한 전문 분야 라우팅
- 캐릭터별 개성과 톤 차별화

### 채팅 인터페이스
- 실시간 메시징 및 대화 히스토리
- 1:1 및 그룹 채팅 지원
- 메시지 리액션 및 알림
- 스트리밍 응답 및 타이핑 효과

### 문서 처리
- AI 기반 문서 요약 및 핵심 포인트 추출
- TXT, DOC, DOCX, PPT, PPTX 지원
- 전문 에이전트 연계 문맥 응답

### 관리자 센터
- 사용자/에이전트/문서 관리
- 시스템 모니터링 대시보드
- QA 로그 및 분석
- 조직 계층 구조 관리

### 다국어 지원
- 한국어, 영어, 일본어 UI
- 지능형 언어 감지
- 에이전트별 다국어 응답

### 고급 기능
- Canon Lock 모드 (신학적 토론용)
- 멀티턴 대화 시스템
- 사용자 프로필 기반 개인화
- 시나리오 기반 턴 관리

## API 엔드포인트

### 인증
- `POST /api/login` - 로그인
- `POST /api/logout` - 로그아웃
- `GET /api/user` - 현재 사용자 정보

### 에이전트
- `GET /api/agents` - 에이전트 목록
- `GET /api/agents/:id` - 특정 에이전트 정보
- `POST /api/agents` - 에이전트 생성 (관리자)

### 대화
- `GET /api/conversations` - 대화 목록
- `POST /api/conversations` - 새 대화 생성
- `POST /api/conversations/:id/messages` - 메시지 전송

### 문서
- `POST /api/documents/upload` - 문서 업로드
- `GET /api/documents` - 문서 목록
- `GET /api/documents/:id` - 문서 상세 정보

### 관리자
- `GET /api/admin/stats` - 시스템 통계
- `GET /api/admin/users` - 사용자 관리
- `POST /api/admin/agents/bulk-upload` - 에이전트 일괄 업로드

## 데이터베이스 구조

주요 테이블:
- **users**: 사용자 정보
- **agents**: AI 에이전트 정보
- **conversations**: 대화 세션
- **messages**: 메시지 내역
- **group_chats**: 그룹 채팅
- **documents**: 업로드된 문서
- **organizations**: 조직 계층 구조
- **scenario_summaries**: 시나리오 요약

## 문제 해결

### 서버가 시작되지 않음
- 환경 변수(DATABASE_URL, OPENAI_API_KEY, SESSION_SECRET) 확인
- PostgreSQL 데이터베이스 생성 여부 확인
- 터미널에서 오류 메시지 확인

### Vite 파싱 오류
- client/src에 .js 파일이 없는지 확인 (.tsx만 사용)
- node_modules 삭제 후 `npm install` 재실행

### 데이터베이스 연결 실패
- DATABASE_URL 형식 확인
- PostgreSQL 서버 실행 상태 확인
- Replit PostgreSQL 도구에서 데이터베이스 재생성

### OpenAI API 오류
- OPENAI_API_KEY가 Secrets에 올바르게 설정되었는지 확인
- API 키 유효성 및 크레딧 잔액 확인

## 라이선스

ISC

## 지원

문제가 발생하면 프로젝트 이슈를 등록하거나 관리자에게 문의하세요.
