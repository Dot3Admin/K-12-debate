# 유틸리티

이 디렉토리에는 유틸리티 함수들이 위치합니다.

## 예시

```javascript
// logger.js
exports.log = (message) => {
  console.log(`[${new Date().toISOString()}] ${message}`);
};

// validator.js
exports.isValidEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};
```

## 유틸리티 파일 예시

- `logger.js` - 로깅 유틸리티
- `validator.js` - 검증 유틸리티
- `helpers.js` - 헬퍼 함수들
