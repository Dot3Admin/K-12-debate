# 공유 모듈

클라이언트와 서버 간에 공유되는 코드입니다.

## 구조

```
shared/
├── types/      # 타입 정의
├── schemas/    # 검증 스키마
└── utils/      # 공유 유틸리티 (필요시)
```

## 목적

- 코드 중복 방지
- 일관된 타입 및 검증 로직
- 클라이언트-서버 간 계약 명시

## 사용 방법

### 서버에서 사용

```javascript
const UserSchema = require('../shared/schemas/userSchema');
```

### 클라이언트에서 사용

```javascript
import UserSchema from '../shared/schemas/userSchema';
```
