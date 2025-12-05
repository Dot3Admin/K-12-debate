#!/usr/bin/env node

/**
 * 데이터베이스 전체 백업 스크립트
 * 현재 프로젝트의 PostgreSQL 데이터베이스를 완전히 백업합니다.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const backupDir = './database-migration';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
const backupFile = path.join(backupDir, `lobo-backup-${timestamp}.sql`);

console.log('🔵 LoBo 데이터베이스 백업 시작...\n');

// 백업 디렉토리 생성
if (!existsSync(backupDir)) {
  mkdirSync(backupDir, { recursive: true });
  console.log('✅ 백업 디렉토리 생성됨:', backupDir);
}

// 환경 변수 확인
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('❌ 오류: DATABASE_URL 환경 변수를 찾을 수 없습니다.');
  process.exit(1);
}

console.log('📊 데이터베이스 연결 정보 확인 완료');
console.log('📁 백업 파일:', backupFile);
console.log('\n⏳ 백업 진행 중... (데이터 크기에 따라 시간이 걸릴 수 있습니다)\n');

try {
  // pg_dump를 사용하여 전체 데이터베이스 백업
  // --no-owner: 소유권 정보 제외 (Neon 제한사항)
  // --no-acl: 권한 정보 제외 (Neon 제한사항)
  // --clean: 복원 전 기존 객체 삭제
  // --if-exists: 존재하는 경우에만 삭제
  const command = `pg_dump "${databaseUrl}" --no-owner --no-acl --clean --if-exists > "${backupFile}"`;
  
  execSync(command, { 
    stdio: 'inherit',
    maxBuffer: 100 * 1024 * 1024 // 100MB 버퍼
  });

  console.log('\n✅ 백업 완료!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📦 백업 파일: ${backupFile}`);
  
  // 파일 크기 확인
  const { statSync } = await import('fs');
  const stats = statSync(backupFile);
  const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`📊 파일 크기: ${sizeInMB} MB`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  console.log('\n📋 다음 단계:');
  console.log('1. 이 백업 파일을 다운로드하세요');
  console.log('2. 새 Replit 프로젝트를 생성하세요');
  console.log('3. 새 프로젝트에 이 파일을 업로드하세요');
  console.log('4. restore-database.js 스크립트를 실행하세요');
  
} catch (error) {
  console.error('\n❌ 백업 실패:', error.message);
  process.exit(1);
}
