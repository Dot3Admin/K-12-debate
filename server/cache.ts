// Simple in-memory cache for frequently accessed data
export class MemoryCache {
  private cache: Map<string, { data: any; expiry: number }> = new Map();
  private defaultTTL = 5 * 60 * 1000; // 5 minutes

  set(key: string, data: any, ttl?: number): void {
    const expiry = Date.now() + (ttl || this.defaultTTL);
    this.cache.set(key, { data, expiry });
  }

  get(key: string): any | null {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  // Clean up expired entries
  cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

export const cache = new MemoryCache();

// Auto cleanup every 10 minutes
setInterval(() => {
  cache.cleanup();
}, 10 * 60 * 1000);

// 🤝 관계 매트릭스 전용 캐시 시스템
class RelationshipMatrixCache {
  private cache: MemoryCache;
  private defaultTTL = 24 * 60 * 60 * 1000; // 24시간

  constructor() {
    this.cache = new MemoryCache();
  }

  // 캐시 키 생성 (채팅방ID + 정렬된 캐릭터명 + 버전)
  private generateCacheKey(groupChatId: number, characterNames: string[], version: string = "v1"): string {
    const sortedNames = characterNames.slice().sort(); // 원본 배열 변경 방지
    const namesHash = sortedNames.join('|');
    return `relationship_matrix:${groupChatId}:${namesHash}:${version}`;
  }

  // 관계 매트릭스 캐시 저장
  set(groupChatId: number, characterNames: string[], matrix: any, version: string = "v1"): void {
    const key = this.generateCacheKey(groupChatId, characterNames, version);
    console.log(`[🎭 관계 인식] 매트릭스 캐시 저장: ${key}`);
    this.cache.set(key, matrix, this.defaultTTL);
  }

  // 관계 매트릭스 캐시 조회
  get(groupChatId: number, characterNames: string[], version: string = "v1"): any | null {
    const key = this.generateCacheKey(groupChatId, characterNames, version);
    const cached = this.cache.get(key);
    
    if (cached) {
      console.log(`[🎭 관계 인식] 캐시 적중: ${key}`);
    } else {
      console.log(`[🎭 관계 인식] 캐시 미스: ${key}`);
    }
    
    return cached;
  }

  // 특정 채팅방의 모든 관계 매트릭스 캐시 무효화
  invalidateGroupChat(groupChatId: number): void {
    const keysToDelete: string[] = [];
    
    // 캐시에서 해당 채팅방 관련 키들 찾기
    for (const key of (this.cache as any).cache.keys()) {
      if (key.startsWith(`relationship_matrix:${groupChatId}:`)) {
        keysToDelete.push(key);
      }
    }
    
    // 찾은 키들 삭제
    keysToDelete.forEach(key => {
      this.cache.delete(key);
      console.log(`[🎭 관계 인식] 캐시 무효화: ${key}`);
    });
    
    console.log(`[🎭 관계 인식] 채팅방 ${groupChatId} 관련 ${keysToDelete.length}개 캐시 무효화 완료`);
  }

  // 특정 캐릭터가 포함된 모든 관계 매트릭스 캐시 무효화
  invalidateCharacter(characterName: string): void {
    const keysToDelete: string[] = [];
    
    // 캐시에서 해당 캐릭터가 포함된 키들 찾기
    for (const key of (this.cache as any).cache.keys()) {
      if (key.includes(`|${characterName}|`) || 
          key.includes(`${characterName}|`) || 
          key.includes(`|${characterName}:`)) {
        keysToDelete.push(key);
      }
    }
    
    // 찾은 키들 삭제
    keysToDelete.forEach(key => {
      this.cache.delete(key);
      console.log(`[🎭 관계 인식] 캐시 무효화: ${key}`);
    });
    
    console.log(`[🎭 관계 인식] 캐릭터 "${characterName}" 관련 ${keysToDelete.length}개 캐시 무효화 완료`);
  }

  // 모든 관계 매트릭스 캐시 무효화
  invalidateAll(): void {
    const keysToDelete: string[] = [];
    
    for (const key of (this.cache as any).cache.keys()) {
      if (key.startsWith('relationship_matrix:')) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key));
    console.log(`[🎭 관계 인식] 모든 관계 매트릭스 캐시 무효화 완료: ${keysToDelete.length}개`);
  }

  // 캐시 통계 조회
  getStats(): { totalKeys: number; matrixKeys: number } {
    const allKeys = Array.from((this.cache as any).cache.keys());
    const matrixKeys = allKeys.filter(key => key.startsWith('relationship_matrix:'));
    
    return {
      totalKeys: allKeys.length,
      matrixKeys: matrixKeys.length
    };
  }
}

// 전역 관계 매트릭스 캐시 인스턴스 - DB 저장으로 대체하여 비활성화
// export const relationshipMatrixCache = new RelationshipMatrixCache();