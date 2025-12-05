# 공유 타입 정의

클라이언트와 서버 모두에서 사용하는 TypeScript 타입 정의입니다.

## 사용 예시

```javascript
// types/User.js
module.exports = {
  UserRole: {
    ADMIN: 'admin',
    USER: 'user',
    GUEST: 'guest'
  }
};
```

## 타입 파일 예시

- `User.js` - 사용자 타입
- `Agent.js` - 에이전트 타입
- `Conversation.js` - 대화 타입
- `Message.js` - 메시지 타입
