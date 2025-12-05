# 컨트롤러

이 디렉토리에는 비즈니스 로직을 처리하는 컨트롤러 파일들이 위치합니다.

## 구조 예시

```javascript
const pool = require('../config/database');

exports.getAll = async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM table_name');
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
};
```

## 컨트롤러 파일 예시

- `userController.js` - 사용자 관련 로직
- `agentController.js` - 에이전트 관련 로직
- `conversationController.js` - 대화 관련 로직
