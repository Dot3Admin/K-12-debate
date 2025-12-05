# API 라우트

이 디렉토리에는 Express 라우트 파일들이 위치합니다.

## 구조 예시

```javascript
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  // 라우트 핸들러
});

module.exports = router;
```

## 라우트 파일 예시

- `users.js` - 사용자 관련 API
- `agents.js` - 에이전트 관련 API
- `conversations.js` - 대화 관련 API
- `groups.js` - 그룹 채팅 관련 API
