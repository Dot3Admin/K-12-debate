#!/usr/bin/env node

/**
 * 데이터베이스 검증 스크립트
 * 복원된 데이터베이스의 무결성을 확인합니다.
 */

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

console.log('🔍 데이터베이스 검증 시작...\n');

async function verifyDatabase() {
  try {
    console.log('📊 테이블 목록 확인 중...\n');
    
    // 모든 테이블 목록 조회
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    
    console.log(`✅ 총 ${tables.length}개의 테이블 발견:\n`);
    
    // 각 테이블의 레코드 수 확인
    for (const table of tables) {
      const tableName = table.table_name;
      
      try {
        const result = await sql`
          SELECT COUNT(*) as count 
          FROM ${sql(tableName)};
        `;
        
        const count = result[0].count;
        const icon = count > 0 ? '📁' : '📂';
        console.log(`${icon} ${tableName.padEnd(30)} ${count.toString().padStart(6)} rows`);
        
      } catch (err) {
        console.log(`⚠️  ${tableName.padEnd(30)} (접근 불가)`);
      }
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // 주요 테이블 상세 검증
    console.log('\n📋 주요 테이블 상세 검증:\n');
    
    const mainTables = [
      'users',
      'agents', 
      'conversations',
      'messages',
      'documents',
      'organizations'
    ];
    
    for (const tableName of mainTables) {
      try {
        const exists = tables.find(t => t.table_name === tableName);
        
        if (exists) {
          const result = await sql`
            SELECT COUNT(*) as count 
            FROM ${sql(tableName)};
          `;
          console.log(`✅ ${tableName}: ${result[0].count} 레코드`);
        } else {
          console.log(`⚠️  ${tableName}: 테이블 없음`);
        }
      } catch (err) {
        console.log(`❌ ${tableName}: 오류 - ${err.message}`);
      }
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ 데이터베이스 검증 완료!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
  } catch (error) {
    console.error('\n❌ 검증 실패:', error.message);
    process.exit(1);
  }
}

verifyDatabase();
