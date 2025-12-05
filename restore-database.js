#!/usr/bin/env node

/**
 * 데이터베이스 복원 스크립트
 * 백업 파일을 새 프로젝트의 PostgreSQL 데이터베이스로 복원합니다.
 * 
 * 사용법:
 * node restore-database.js <백업파일명>
 * 예: node restore-database.js lobo-backup-2025-01-19.sql
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('❌ 사용법: node restore-database.js <백업파일명>');
  console.error('예: node restore-database.js lobo-backup-2025-01-19.sql');
  process.exit(1);
}

const backupFile = args[0].startsWith('./') ? args[0] : path.join('./database-migration', args[0]);

console.log('🔵 LoBo 데이터베이스 복원 시작...\n');

// 백업 파일 확인
if (!existsSync(backupFile)) {
  console.error(`❌ 백업 파일을 찾을 수 없습니다: ${backupFile}`);
  console.error('\n💡 database-migration 폴더에 백업 파일이 있는지 확인하세요.');
  process.exit(1);
}

console.log('✅ 백업 파일 발견:', backupFile);

// 환경 변수 확인
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('❌ 오류: DATABASE_URL 환경 변수를 찾을 수 없습니다.');
  console.error('\n💡 새 프로젝트에 PostgreSQL 데이터베이스를 먼저 생성하세요:');
  console.error('   1. 왼쪽 Tools 패널 클릭');
  console.error('   2. PostgreSQL 아이콘 클릭');
  console.error('   3. "Create a database" 클릭');
  process.exit(1);
}

console.log('📊 데이터베이스 연결 정보 확인 완료');
console.log('\n⚠️  경고: 이 작업은 기존 데이터를 모두 삭제하고 백업으로 대체합니다.');
console.log('⏳ 복원 진행 중...\n');

try {
  // psql을 사용하여 백업 파일 복원
  const command = `psql "${databaseUrl}" < "${backupFile}"`;
  
  execSync(command, { 
    stdio: 'inherit',
    maxBuffer: 100 * 1024 * 1024 // 100MB 버퍼
  });

  console.log('\n✅ 복원 완료!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦 모든 테이블, 데이터, 관계가 복원되었습니다.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  console.log('\n📋 다음 단계:');
  console.log('1. node verify-database.js 를 실행하여 데이터 검증');
  console.log('2. 환경 변수 설정 (ENV-SETUP.md 참고)');
  console.log('3. npm install 실행');
  console.log('4. npm run dev 로 애플리케이션 시작');
  
} catch (error) {
  console.error('\n❌ 복원 실패:', error.message);
  console.error('\n💡 문제 해결:');
  console.error('   - DATABASE_URL이 올바른지 확인');
  console.error('   - PostgreSQL 데이터베이스가 생성되었는지 확인');
  console.error('   - 백업 파일이 손상되지 않았는지 확인');
  process.exit(1);
}
