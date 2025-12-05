# 공유 스키마

클라이언트와 서버 모두에서 사용하는 검증 스키마 및 데이터 구조입니다.

## 사용 예시

```javascript
// schemas/userSchema.js
module.exports = {
  username: {
    type: 'string',
    minLength: 3,
    maxLength: 20,
    required: true
  },
  email: {
    type: 'string',
    format: 'email',
    required: true
  },
  password: {
    type: 'string',
    minLength: 8,
    required: true
  }
};
```

## 스키마 파일 예시

- `userSchema.js` - 사용자 검증 스키마
- `agentSchema.js` - 에이전트 검증 스키마
- `messageSchema.js` - 메시지 검증 스키마
