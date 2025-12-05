#!/usr/bin/env node

/**
 * 🎭 관계 매트릭스 시스템 테스트 스크립트
 * 예수-제자 관계를 포함한 테스트 실행
 */

import { relationshipMatrixCache } from './server/cache.js';
import { generateRelationshipMatrix } from './server/relationshipMatrix.js';

// 테스트 캐릭터 리스트 (12제자 그룹과 동일)
const testCharacters = [
  "예수 그리스도",
  "피터 (사도 베드로)", 
  "요한",
  "야고보",
  "안드레",
  "마태",
  "토마스",
  "바돌로매",
  "빌립",
  "야고보 (알패오의 아들)",
  "시몬 (열심당원)",
  "유다 이스카리옷"
];

async function testRelationshipMatrix() {
  console.log("🎭 관계 매트릭스 시스템 테스트 시작");
  console.log("=".repeat(50));
  
  try {
    // 1. 관계 매트릭스 생성 테스트
    console.log("\n1️⃣ 관계 매트릭스 생성 테스트");
    console.log("테스트 캐릭터:", testCharacters.slice(0, 5).join(", "), "...");
    
    const startTime = Date.now();
    const matrix = await generateRelationshipMatrix(testCharacters);
    const generationTime = Date.now() - startTime;
    
    console.log(`✅ 매트릭스 생성 완료 (소요시간: ${generationTime}ms)`);
    console.log(`📊 관계 수: ${matrix.relationships.length}개`);
    
    // 예수-제자 관계 확인
    const jesusRelationships = matrix.relationships.filter(
      rel => rel.character1 === "예수 그리스도" || rel.character2 === "예수 그리스도"
    );
    
    console.log(`👑 예수 관련 관계: ${jesusRelationships.length}개`);
    
    if (jesusRelationships.length > 0) {
      console.log("📝 예수-제자 관계 샘플:");
      jesusRelationships.slice(0, 3).forEach(rel => {
        console.log(`   - ${rel.character1} ↔ ${rel.character2}: ${rel.relationship} (${rel.context})`);
      });
    }
    
    // 2. 캐시 시스템 테스트
    console.log("\n2️⃣ 캐시 시스템 테스트");
    
    const groupChatId = 168; // 12제자 그룹
    const cacheKey = relationshipMatrixCache.getCacheKey(groupChatId, testCharacters);
    console.log(`🔑 캐시 키: ${cacheKey}`);
    
    // 캐시에 저장
    relationshipMatrixCache.set(groupChatId, testCharacters, matrix);
    console.log("💾 캐시 저장 완료");
    
    // 캐시에서 조회
    const cached = relationshipMatrixCache.get(groupChatId, testCharacters);
    if (cached) {
      console.log("✅ 캐시 조회 성공");
      console.log(`📊 캐시된 관계 수: ${cached.relationships.length}개`);
    } else {
      console.log("❌ 캐시 조회 실패");
    }
    
    // 3. 무효화 테스트
    console.log("\n3️⃣ 캐시 무효화 테스트");
    
    console.log("🗑️ '피터 (사도 베드로)' 캐릭터 무효화 실행");
    relationshipMatrixCache.invalidateCharacter("피터 (사도 베드로)");
    
    const afterInvalidate = relationshipMatrixCache.get(groupChatId, testCharacters);
    if (!afterInvalidate) {
      console.log("✅ 캐시 무효화 성공 - 캐시가 삭제됨");
    } else {
      console.log("❌ 캐시 무효화 실패 - 캐시가 여전히 존재");
    }
    
    // 4. 성능 테스트
    console.log("\n4️⃣ 성능 테스트");
    
    const iterations = 3;
    const times = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      await generateRelationshipMatrix(testCharacters.slice(0, 6)); // 6명으로 축소
      const time = Date.now() - start;
      times.push(time);
      console.log(`   테스트 ${i + 1}: ${time}ms`);
    }
    
    const avgTime = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    console.log(`📊 평균 생성 시간: ${avgTime}ms`);
    
    if (avgTime < 5000) {
      console.log("✅ 성능 양호 (5초 미만)");
    } else {
      console.log("⚠️ 성능 주의 (5초 이상)");
    }
    
    console.log("\n" + "=".repeat(50));
    console.log("🎉 관계 매트릭스 시스템 테스트 완료!");
    
  } catch (error) {
    console.error("❌ 테스트 실패:", error);
    console.error("스택 트레이스:", error.stack);
  }
}

// 스크립트 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  testRelationshipMatrix();
}