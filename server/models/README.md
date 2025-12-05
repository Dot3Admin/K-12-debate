# 모델

이 디렉토리에는 데이터베이스 모델 파일들이 위치합니다.

## 구조 예시

```javascript
const pool = require('../config/database');

class User {
  static async findById(id) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
  }
  
  static async create(userData) {
    const { username, email, password } = userData;
    const result = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *',
      [username, email, password]
    );
    return result.rows[0];
  }
}

module.exports = User;
```

## 모델 파일 예시

- `User.js` - 사용자 모델
- `Agent.js` - 에이전트 모델
- `Conversation.js` - 대화 모델
