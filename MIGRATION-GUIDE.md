# 🚀 LoBo 프로젝트 마이그레이션 가이드

이 가이드는 GitHub 저장소에서 LoBo 프로젝트를 Replit 환경으로 마이그레이션하고 설정하는 방법을 안내합니다.

## 📋 개요

- **원본 저장소**: https://github.com/Joonsoo-C/LoBo_--014
- **기술 스택**: TypeScript, React 18, Express, PostgreSQL, Vite
- **포함 사항**: 모든 소스 코드, 데이터베이스 백업, 의존성
- **소요 시간**: 약 10-15분
- **난이도**: ⭐⭐☆☆☆ (중간)

## ✅ 사전 준비

필요한 항목:
- GitHub 저장소 액세스 (공개 또는 개인 액세스 토큰)
- OpenAI API 키
- Replit 계정

## 📝 단계별 진행 방법

### **1단계: 새 Replit 프로젝트 생성**

1. Replit 홈페이지 (https://replit.com) 접속
2. **"Create Repl"** 버튼 클릭
3. Template: **"Node.js"** 선택
4. Title: `LoBo-01` (또는 원하는 이름)
5. **"Create Repl"** 클릭

### **2단계: GitHub 저장소 클론**

Replit Shell에서 실행:

```bash
# 임시 디렉토리에 클론
git clone https://github.com/Joonsoo-C/LoBo_--014.git /tmp/lobo-source

# 모든 파일 복사 (숨김 파일 포함)
cp -r /tmp/lobo-source/. .

# 임시 디렉토리 정리
rm -rf /tmp/lobo-source
```

**비공개 저장소인 경우:**
```bash
# GitHub Personal Access Token 사용
git clone https://[YOUR_TOKEN]@github.com/Joonsoo-C/LoBo_--014.git /tmp/lobo-source
```

### **3단계: 의존성 설치**

```bash
npm install
```

약 2-3분 소요됩니다. 710개 이상의 패키지가 설치됩니다.

### **4단계: PostgreSQL 데이터베이스 생성**

1. 왼쪽 패널에서 **"Tools"** 클릭
2. **"PostgreSQL"** 아이콘 클릭
3. **"Create a database"** 버튼 클릭
4. 몇 초 기다리면 자동으로 생성됨
5. `DATABASE_URL` 환경 변수 자동 설정 확인

### **5단계: 환경 변수 설정**

왼쪽 패널에서 **Secrets (🔒)** 클릭 후 다음 추가:

#### OPENAI_API_KEY
- Key: `OPENAI_API_KEY`
- Value: `sk-...` (OpenAI API 키)

#### SESSION_SECRET
Shell에서 랜덤 키 생성:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
- Key: `SESSION_SECRET`  
- Value: 위에서 생성된 랜덤 문자열

#### DATABASE_URL
- 4단계에서 자동으로 설정됨
- 확인: Shell에서 `echo $DATABASE_URL` 실행

### **6단계: 데이터베이스 복원**

백업 파일을 사용하여 데이터베이스 복원:

```bash
psql $DATABASE_URL < lobo-backup-2025-10-19.sql
```

예상 출력:
```
SET
SET
SET
...
CREATE TABLE
CREATE TABLE
...
COPY 123
COPY 456
...
```

복원 완료까지 약 30초~1분 소요됩니다.

### **7단계: 개발 워크플로우 설정**

Replit에서 자동으로 감지되지만, 수동 설정도 가능:

1. 왼쪽 패널에서 **"Tools"** > **"Workflows"** 클릭
2. "Add Workflow" 클릭
3. 다음 설정:
   - Name: `LoBo-01`
   - Command: `npm run dev`
   - Port: `5000`
   - Output: `webview`
4. **"Save"** 클릭

### **8단계: 애플리케이션 시작**

Shell에서:
```bash
npm run dev
```

또는 상단의 **"Run"** 버튼 클릭

예상 출력:
```
7:31:25 AM [express] serving on port 5000
[⏱️ TIMEOUT] HTTP 타임아웃 10분으로 설정 (멀티-에이전트 처리용)
LoBo AI messenger now using admin center managed database files
```

서버가 시작되면 Replit Webview에서 애플리케이션이 자동으로 열립니다.

## ✅ 완료 확인 체크리스트

마이그레이션이 성공적으로 완료되었는지 확인:

- [ ] 서버가 포트 5000에서 실행 중
- [ ] Webview에서 로그인 페이지 표시
- [ ] 환경 변수 모두 설정됨 (DATABASE_URL, OPENAI_API_KEY, SESSION_SECRET)
- [ ] 데이터베이스 복원 완료
- [ ] 로그인 가능
- [ ] 에이전트 목록 표시
- [ ] 새 대화 생성 가능
- [ ] AI 응답 정상 작동

## 🎯 마이그레이션 완료 후

### 프로젝트 구조 확인

```bash
ls -la
```

주요 폴더/파일:
- `server/` - Express 백엔드 (TypeScript)
- `client/` - React 프론트엔드 (TypeScript)
- `db/` - Drizzle ORM 스키마
- `package.json` - 통합 의존성 관리
- `vite.config.ts` - Vite 설정
- `lobo-backup-2025-10-19.sql` - 데이터베이스 백업

### 사용 가능한 명령어

```bash
npm run dev          # 개발 모드 (서버 + Vite)
npm run build        # 프로덕션 빌드
npm start            # 프로덕션 서버 실행
npm run db:push      # 데이터베이스 스키마 푸시
npm run db:studio    # Drizzle Studio 실행
```

### 데이터베이스 검증

Shell에서 데이터 확인:
```bash
psql $DATABASE_URL -c "SELECT COUNT(*) FROM users;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM agents;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM conversations;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM messages;"
```

## 🔧 문제 해결

### 서버 시작 실패

**증상**: `npm run dev` 실행 시 오류 발생

**해결 방법**:
```bash
# 1. 환경 변수 확인
echo $DATABASE_URL
echo $OPENAI_API_KEY
echo $SESSION_SECRET

# 2. 누락된 환경 변수 Secrets에서 추가

# 3. node_modules 재설치
rm -rf node_modules package-lock.json
npm install
```

### Vite 파싱 오류

**증상**: `Failed to parse source for import analysis because the content contains invalid JS syntax`

**해결 방법**:
```bash
# client/src에 .js 파일이 있는지 확인
ls -la client/src/*.js

# 있다면 제거 (.tsx만 사용)
rm -f client/src/App.js client/src/index.js

# 서버 재시작
npm run dev
```

### 데이터베이스 연결 실패

**증상**: `Error: connect ECONNREFUSED` 또는 데이터베이스 오류

**해결 방법**:
```bash
# 1. DATABASE_URL 확인
echo $DATABASE_URL

# 2. PostgreSQL 재생성
# Tools > PostgreSQL > 기존 DB 삭제 후 재생성

# 3. 데이터베이스 재복원
psql $DATABASE_URL < lobo-backup-2025-10-19.sql
```

### OpenAI API 오류

**증상**: AI 응답 생성 시 오류

**해결 방법**:
```bash
# 1. API 키 확인
[ ! -z "$OPENAI_API_KEY" ] && echo "설정됨" || echo "미설정"

# 2. Secrets에서 OPENAI_API_KEY 재확인
# 3. API 키 유효성 확인 (OpenAI 대시보드)
```

### 세션 오류

**증상**: 로그인 후 세션 유지 안 됨

**해결 방법**:
```bash
# SESSION_SECRET 재생성
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 출력된 값을 Secrets에 추가/업데이트
```

### 의존성 충돌

**증상**: npm install 실패 또는 모듈 오류

**해결 방법**:
```bash
# 캐시 정리 및 재설치
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### 포트 충돌

**증상**: `EADDRINUSE: address already in use :::5000`

**해결 방법**:
```bash
# 실행 중인 프로세스 종료
pkill -f "tsx server/index.ts"

# 서버 재시작
npm run dev
```

## 📊 데이터베이스 구조

백업 파일(`lobo-backup-2025-10-19.sql`)에 포함된 주요 테이블:

### 사용자 관련
- `users` - 사용자 정보
- `sessions` - 세션 데이터

### 에이전트 관련
- `agents` - AI 에이전트 정보
- `agent_stats` - 에이전트 통계
- `character_speaking_patterns` - 캐릭터 말투 패턴

### 대화 관련
- `conversations` - 대화 세션
- `messages` - 메시지 내역
- `message_reactions` - 메시지 리액션

### 그룹 채팅
- `group_chats` - 그룹 채팅
- `group_chat_members` - 그룹 멤버
- `group_chat_messages` - 그룹 메시지
- `group_chat_agents` - 그룹 에이전트

### 문서 관련
- `documents` - 업로드된 문서

### 조직 관련
- `organizations` - 조직 정보
- `organization_categories` - 조직 카테고리

### 기타
- `response_templates` - 응답 템플릿
- `relationship_tones` - 관계 톤
- `scenario_summaries` - 시나리오 요약

## 📞 지원

문제가 계속되면:
1. Shell에서 `npm run dev` 출력 확인
2. 환경 변수 설정 재확인
3. 데이터베이스 연결 상태 확인
4. GitHub 저장소 이슈 등록

## 🎉 완료!

축하합니다! LoBo 프로젝트가 성공적으로 마이그레이션되었습니다.

이제 다음을 수행할 수 있습니다:
- AI 에이전트와 대화
- 문서 업로드 및 분석
- 그룹 채팅 생성
- 관리자 센터에서 시스템 관리
- 멀티턴 토론 및 Canon Lock 모드 사용

---

**작성일**: 2025-10-20  
**버전**: 2.0  
**원본 저장소**: https://github.com/Joonsoo-C/LoBo_--014  
**백업 파일**: `lobo-backup-2025-10-19.sql` (5.79 MB)
