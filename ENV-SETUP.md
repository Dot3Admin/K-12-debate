# 환경 변수 설정 가이드

새 프로젝트에서 LoBo가 정상 작동하려면 다음 환경 변수들을 설정해야 합니다.

## 🔑 필수 환경 변수

### 1. DATABASE_URL
**자동 생성됨** - PostgreSQL 데이터베이스 생성 시 자동으로 설정됩니다.

```
설정 불필요 (Replit이 자동 생성)
```

### 2. OPENAI_API_KEY
OpenAI GPT-4 API 키가 필요합니다.

#### 설정 방법:
1. Replit 왼쪽 패널에서 **Secrets (🔒)** 클릭
2. "New Secret" 클릭
3. Key: `OPENAI_API_KEY`
4. Value: `sk-...` (OpenAI API 키)

#### OpenAI API 키 발급 방법:
- https://platform.openai.com/api-keys 접속
- "Create new secret key" 클릭
- 키 복사 후 Replit Secrets에 추가

### 3. SESSION_SECRET
세션 암호화를 위한 랜덤 키입니다.

#### 설정 방법:
1. Replit Secrets에서 "New Secret" 클릭
2. Key: `SESSION_SECRET`
3. Value: 아래 명령어로 생성한 랜덤 문자열

```bash
# 터미널에서 실행하여 랜덤 문자열 생성
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 🔄 자동 생성 환경 변수 (설정 불필요)

다음 변수들은 Replit이 자동으로 생성합니다:

- `REPLIT_DOMAINS` - Replit Auth용 도메인
- `REPL_ID` - 프로젝트 고유 ID
- `ISSUER_URL` - OIDC 설정 (기본값: https://replit.com/oidc)
- `NODE_ENV` - 환경 모드 (Replit이 자동 설정)

## ✅ 환경 변수 체크리스트

새 프로젝트 설정 시 확인:

- [ ] PostgreSQL 데이터베이스 생성됨 (DATABASE_URL 자동 생성)
- [ ] OPENAI_API_KEY Secrets에 추가됨
- [ ] SESSION_SECRET Secrets에 추가됨

## 🔍 환경 변수 확인 방법

터미널에서 다음 명령어로 확인:

```bash
# DATABASE_URL 확인 (일부만 표시)
echo ${DATABASE_URL:0:30}...

# OPENAI_API_KEY 존재 확인
[ ! -z "$OPENAI_API_KEY" ] && echo "✅ OPENAI_API_KEY 설정됨" || echo "❌ OPENAI_API_KEY 없음"

# SESSION_SECRET 존재 확인
[ ! -z "$SESSION_SECRET" ] && echo "✅ SESSION_SECRET 설정됨" || echo "❌ SESSION_SECRET 없음"
```

## 🚨 주의사항

1. **API 키 보안**: 절대 코드에 직접 작성하지 마세요. 항상 Replit Secrets 사용
2. **원본 프로젝트와 분리**: 새 프로젝트는 별도의 OPENAI_API_KEY를 사용하는 것을 권장
3. **데이터베이스**: DATABASE_URL은 각 프로젝트마다 고유하며 공유 불가

## 💡 문제 해결

### OpenAI API 오류 발생 시
```bash
# API 키 확인
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" | head -n 20
```

### 세션 오류 발생 시
- SESSION_SECRET이 설정되어 있는지 확인
- 32자 이상의 랜덤 문자열인지 확인

### 데이터베이스 연결 오류 시
- PostgreSQL이 생성되어 있는지 확인
- DATABASE_URL 환경 변수가 존재하는지 확인
