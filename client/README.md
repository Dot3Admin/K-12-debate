# LoBo-01 클라이언트

React 기반 프론트엔드 애플리케이션입니다.

## 설치

```bash
npm install
```

## 실행

```bash
npm start
```

개발 서버가 [http://localhost:3000](http://localhost:3000)에서 실행됩니다.

## 빌드

```bash
npm run build
```

프로덕션용 빌드가 `build` 폴더에 생성됩니다.

## 구조

```
client/
├── public/          # 정적 파일
├── src/
│   ├── components/  # React 컴포넌트 (생성 예정)
│   ├── pages/       # 페이지 컴포넌트 (생성 예정)
│   ├── services/    # API 서비스 (생성 예정)
│   ├── utils/       # 유틸리티 함수 (생성 예정)
│   ├── App.js       # 메인 앱 컴포넌트
│   └── index.js     # 진입점
└── package.json     # 의존성
```

## 기술 스택

- React 18
- React Router 6
- Axios (API 통신)
- React Scripts (CRA)
