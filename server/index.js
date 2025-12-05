require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(compression());
app.use(morgan('dev'));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'lobo-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api', (req, res) => {
  res.json({
    message: 'LoBo-01 API Server',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      users: '/api/users (준비 중)',
      agents: '/api/agents (준비 중)',
      conversations: '/api/conversations (준비 중)'
    }
  });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'client', 'build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      status: err.status || 500
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(60));
  console.log('🚀 LoBo-01 서버 시작');
  console.log('='.repeat(60));
  console.log(`\n환경: ${process.env.NODE_ENV || 'development'}`);
  console.log(`포트: ${PORT}`);
  console.log(`서버 주소: http://0.0.0.0:${PORT}`);
  console.log('\nAPI 엔드포인트:');
  console.log(`  - Health Check: http://localhost:${PORT}/api/health`);
  console.log(`  - API Info: http://localhost:${PORT}/api`);
  console.log('\n' + '='.repeat(60) + '\n');
});
