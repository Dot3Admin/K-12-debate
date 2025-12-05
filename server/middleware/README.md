# 미들웨어

이 디렉토리에는 커스텀 Express 미들웨어 파일들이 위치합니다.

## 구조 예시

```javascript
module.exports = (req, res, next) => {
  // 미들웨어 로직
  next();
};
```

## 미들웨어 예시

- `auth.js` - 인증 미들웨어
- `validation.js` - 입력 검증 미들웨어
- `errorHandler.js` - 에러 처리 미들웨어
