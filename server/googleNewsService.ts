import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from './db';
import { newsCache as newsCacheTable, newsCacheMeta } from '../shared/schema';
import { eq } from 'drizzle-orm';

// Google News RSS 피드 URL (카테고리별) - 한국어 뉴스
// 참고: https://news.google.com/rss/headlines/section/topic/{TOPIC}?hl=ko&gl=KR&ceid=KR:ko
const NEWS_FEEDS: Record<string, string> = {
  home: 'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko',
  recommended: 'https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=ko&gl=KR&ceid=KR:ko',
  korea: 'https://news.google.com/rss/search?q=South+Korea+politics+society&hl=ko&gl=KR&ceid=KR:ko', // 대한민국 정치/사회
  world: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=ko&gl=KR&ceid=KR:ko',
  business: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ko&gl=KR&ceid=KR:ko',
  technology: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=ko&gl=KR&ceid=KR:ko',
  entertainment: 'https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=ko&gl=KR&ceid=KR:ko',
  sports: 'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=ko&gl=KR&ceid=KR:ko',
  health: 'https://news.google.com/rss/headlines/section/topic/HEALTH?hl=ko&gl=KR&ceid=KR:ko'
};

// 캐시 초기화 완료 플래그
let cacheInitialized = false;
let cacheInitializationPromise: Promise<void> | null = null;

// 섹션 이름 (한글)
export const SECTION_NAMES: Record<string, string> = {
  home: '홈',
  recommended: '추천',
  korea: '대한민국',
  world: '세계',
  business: '비즈니스',
  technology: '과학&기술',
  entertainment: '엔터테인먼트',
  sports: '스포츠',
  health: '건강'
};

export interface NewsItem {
  id: string;
  title: string;
  verdictQuestion: string;  // VERDICT용 질문 형식
  source: string;
  link: string;
  pubDate: string;
  section: string;
}

export interface CachedNews {
  items: NewsItem[];
  lastUpdated: string;
  nextUpdate: string;
}

// 캐시 저장소
const newsCache: Record<string, CachedNews> = {};
let lastFetchTime: number = 0;

// RSS XML 파싱 (간단한 정규식 사용)
function parseRSSXML(xml: string): { title: string; link: string; pubDate: string; source: string }[] {
  const items: { title: string; link: string; pubDate: string; source: string }[] = [];
  
  // <item> 블록 추출
  const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g);
  if (!itemMatches) return items;
  
  for (const itemXml of itemMatches.slice(0, 20)) { // 최대 20개
    const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
    const linkMatch = itemXml.match(/<link>(.*?)<\/link>/);
    const pubDateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/);
    const sourceMatch = itemXml.match(/<source.*?>(.*?)<\/source>/);
    
    const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';
    const link = linkMatch ? linkMatch[1].trim() : '';
    const pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
    const source = sourceMatch ? sourceMatch[1].trim() : '뉴스';
    
    if (title && link) {
      items.push({ title, link, pubDate, source });
    }
  }
  
  return items;
}

// 뉴스 제목을 VERDICT 질문으로 변환 (LLM 사용)
async function transformToVerdictQuestion(title: string): Promise<string> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // API 키 없으면 기본 변환
    return `${title}에 대해 당사자들은 어떤 입장일까요?`;
  }
  
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
    
    const prompt = `뉴스 제목을 VERDICT 토론 서비스에 적합한 질문으로 변환해주세요.
VERDICT는 다양한 관점의 인물들이 토론하는 서비스입니다.

뉴스 제목: "${title}"

규칙:
1. 질문 형식으로 변환 (예: "~에 대해 어떻게 생각하시나요?", "~의 진실은 무엇일까요?")
2. 논쟁점이나 다양한 관점이 있을 수 있는 방향으로 작성
3. 당사자나 관계자의 입장을 물어보는 형식 선호
4. 한국어로 자연스럽게
5. 질문만 출력 (다른 설명 없이)

질문:`;

    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    
    // 질문이 너무 짧거나 이상하면 기본 변환
    if (response.length < 10 || response.length > 150) {
      return `${title}에 대해 당사자들은 어떤 입장일까요?`;
    }
    
    return response;
  } catch (error) {
    console.error('[GoogleNews] LLM 변환 실패:', error);
    return `${title}에 대해 당사자들은 어떤 입장일까요?`;
  }
}

// 특정 섹션의 뉴스 가져오기 (LLM 변환 없이 빠르게)
async function fetchNewsForSection(section: string, skipLLM: boolean = false): Promise<NewsItem[]> {
  const feedUrl = NEWS_FEEDS[section];
  if (!feedUrl) {
    console.error(`[GoogleNews] Unknown section: ${section}`);
    return [];
  }
  
  try {
    console.log(`[GoogleNews] Fetching ${section} from: ${feedUrl}`);
    
    // AbortController로 30초 타임아웃 설정
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error(`[GoogleNews] HTTP error for ${section}: ${response.status}`);
      throw new Error(`HTTP ${response.status}`);
    }
    
    const xml = await response.text();
    console.log(`[GoogleNews] ${section} XML length: ${xml.length}, contains items: ${xml.includes('<item>')}`);
    const rawItems = parseRSSXML(xml);
    console.log(`[GoogleNews] ${section} parsed ${rawItems.length} raw items`);
    
    // 빠른 초기화 모드: LLM 변환 없이 기본 질문 형식 사용
    if (skipLLM) {
      const items = rawItems.slice(0, 15).map((item, idx) => ({
        id: `${section}-${idx}-${Date.now()}`,
        title: item.title,
        verdictQuestion: `${item.title}에 대해 당사자들은 어떤 입장일까요?`,
        source: item.source,
        link: item.link,
        pubDate: item.pubDate,
        section
      }));
      console.log(`[GoogleNews] Fast-fetched ${items.length} items for ${section}`);
      return items;
    }
    
    // LLM으로 질문 변환 (병렬 처리, 최대 15개)
    const items: NewsItem[] = [];
    const batchSize = 5;
    
    for (let i = 0; i < Math.min(rawItems.length, 15); i += batchSize) {
      const batch = rawItems.slice(i, i + batchSize);
      const transformedBatch = await Promise.all(
        batch.map(async (item, idx) => {
          const verdictQuestion = await transformToVerdictQuestion(item.title);
          return {
            id: `${section}-${i + idx}-${Date.now()}`,
            title: item.title,
            verdictQuestion,
            source: item.source,
            link: item.link,
            pubDate: item.pubDate,
            section
          };
        })
      );
      items.push(...transformedBatch);
    }
    
    console.log(`[GoogleNews] Fetched ${items.length} items for ${section}`);
    return items;
  } catch (error) {
    console.error(`[GoogleNews] Failed to fetch ${section}:`, error);
    return [];
  }
}

// 다음 업데이트 시간 계산 (KST 기준 오전 9시 또는 오후 7시)
function getNextUpdateTime(): Date {
  const now = new Date();
  const kstOffset = 9 * 60; // KST = UTC+9
  const utcNow = now.getTime() + (now.getTimezoneOffset() * 60000);
  const kstNow = new Date(utcNow + (kstOffset * 60000));
  
  const kstHour = kstNow.getHours();
  const kstDate = new Date(kstNow);
  
  // 오전 9시와 오후 7시 중 다음 시간 찾기
  if (kstHour < 9) {
    // 오늘 오전 9시
    kstDate.setHours(9, 0, 0, 0);
  } else if (kstHour < 19) {
    // 오늘 오후 7시
    kstDate.setHours(19, 0, 0, 0);
  } else {
    // 내일 오전 9시
    kstDate.setDate(kstDate.getDate() + 1);
    kstDate.setHours(9, 0, 0, 0);
  }
  
  // KST를 UTC로 변환
  return new Date(kstDate.getTime() - (kstOffset * 60000));
}

// 업데이트가 필요한지 확인
function shouldUpdate(): boolean {
  const now = Date.now();
  const nextUpdate = getNextUpdateTime().getTime();
  
  // 캐시가 없거나, 다음 업데이트 시간이 지났거나, 마지막 fetch 후 12시간 이상 경과
  if (Object.keys(newsCache).length === 0) return true;
  if (now >= nextUpdate && lastFetchTime < nextUpdate) return true;
  if (now - lastFetchTime > 12 * 60 * 60 * 1000) return true; // 12시간 failsafe
  
  return false;
}

// 모든 섹션 뉴스 가져오기 (캐싱 포함)
export async function getAllNews(forceRefresh: boolean = false, fastMode: boolean = false): Promise<Record<string, CachedNews>> {
  // 강제 새로고침이 아니고 캐시 초기화 완료됐고 업데이트가 필요없으면 캐시 반환
  if (!forceRefresh && cacheInitialized && !shouldUpdate() && Object.keys(newsCache).length > 0) {
    console.log('[GoogleNews] Returning cached news');
    return newsCache;
  }
  
  console.log(`[GoogleNews] Fetching all sections... (fastMode: ${fastMode})`);
  lastFetchTime = Date.now();
  
  const sections = Object.keys(NEWS_FEEDS);
  const nextUpdate = getNextUpdateTime();
  
  // 섹션별로 순차 처리 (API 부하 방지)
  for (const section of sections) {
    try {
      // fastMode: LLM 변환 스킵하여 빠르게 캐싱
      const items = await fetchNewsForSection(section, fastMode);
      newsCache[section] = {
        items,
        lastUpdated: new Date().toISOString(),
        nextUpdate: nextUpdate.toISOString()
      };
      
      // 각 섹션 간 300ms 대기 (rate limiting - fast mode에서는 더 빠르게)
      await new Promise(resolve => setTimeout(resolve, fastMode ? 300 : 500));
    } catch (error) {
      console.error(`[GoogleNews] Error fetching ${section}:`, error);
    }
  }
  
  cacheInitialized = true;
  console.log('[GoogleNews] All sections fetched');
  return newsCache;
}

// 캐시 초기화 상태 확인
export function isCacheReady(): boolean {
  return cacheInitialized;
}

// 캐시 초기화가 완료될 때까지 대기
export async function waitForCacheReady(timeoutMs: number = 60000): Promise<boolean> {
  if (cacheInitialized) return true;
  
  if (cacheInitializationPromise) {
    try {
      await Promise.race([
        cacheInitializationPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Cache init timeout')), timeoutMs))
      ]);
      return cacheInitialized;
    } catch (error) {
      console.error('[GoogleNews] Wait for cache timeout:', error);
      return false;
    }
  }
  
  return false;
}

// 특정 섹션 뉴스만 가져오기
export async function getNewsBySection(section: string): Promise<CachedNews | null> {
  // 캐시에 있으면 반환
  if (newsCache[section] && !shouldUpdate()) {
    return newsCache[section];
  }
  
  // 없으면 해당 섹션만 가져오기
  const items = await fetchNewsForSection(section);
  const nextUpdate = getNextUpdateTime();
  
  newsCache[section] = {
    items,
    lastUpdated: new Date().toISOString(),
    nextUpdate: nextUpdate.toISOString()
  };
  
  return newsCache[section];
}

// 캐시 상태 확인
export function getCacheStatus(): { 
  sections: string[]; 
  lastUpdated: string | null; 
  nextUpdate: string;
  itemCount: number;
} {
  const sections = Object.keys(newsCache);
  const lastUpdated = sections.length > 0 
    ? newsCache[sections[0]]?.lastUpdated 
    : null;
  
  let itemCount = 0;
  for (const section of sections) {
    itemCount += newsCache[section]?.items?.length || 0;
  }
  
  return {
    sections,
    lastUpdated,
    nextUpdate: getNextUpdateTime().toISOString(),
    itemCount
  };
}

// ============================================================================
// DB 저장/로드 함수 - 하이브리드 아키텍처 (DB 영구 저장 + 메모리 캐시)
// ============================================================================

// DB에서 뉴스 캐시 로드 (테이블이 없으면 gracefully fail)
async function loadNewsFromDB(): Promise<boolean> {
  try {
    console.log('[GoogleNews] Loading news cache from DB...');
    const startTime = Date.now();
    
    // 메타 정보 조회 - 데이터가 있는지 확인
    let metaRows;
    let newsRows;
    
    try {
      metaRows = await db.select().from(newsCacheMeta);
    } catch (tableError: any) {
      // 테이블이 없으면 (relation does not exist) 정상적으로 false 반환
      if (tableError?.message?.includes('does not exist') || tableError?.code === '42P01') {
        console.log('[GoogleNews] news_cache_meta table not found, skipping DB load');
        return false;
      }
      throw tableError;
    }
    
    if (metaRows.length === 0) {
      console.log('[GoogleNews] No cache data in DB');
      return false;
    }
    
    try {
      newsRows = await db.select().from(newsCacheTable);
    } catch (tableError: any) {
      if (tableError?.message?.includes('does not exist') || tableError?.code === '42P01') {
        console.log('[GoogleNews] news_cache table not found, skipping DB load');
        return false;
      }
      throw tableError;
    }
    
    if (newsRows.length === 0) {
      console.log('[GoogleNews] No news items in DB');
      return false;
    }
    
    // 메모리 캐시에 로드
    const nextUpdate = getNextUpdateTime();
    for (const meta of metaRows) {
      const sectionItems = newsRows
        .filter(row => row.section === meta.section)
        .map(row => ({
          id: row.newsId,
          title: row.title,
          verdictQuestion: row.verdictQuestion,
          source: row.source || '뉴스',
          link: row.link,
          pubDate: row.pubDate || '',
          section: row.section
        }));
      
      if (sectionItems.length > 0) {
        newsCache[meta.section] = {
          items: sectionItems,
          lastUpdated: meta.lastUpdated.toISOString(),
          nextUpdate: nextUpdate.toISOString()
        };
      }
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`[GoogleNews] Loaded ${newsRows.length} items from DB in ${elapsed}ms`);
    return Object.keys(newsCache).length > 0;
  } catch (error) {
    console.error('[GoogleNews] Failed to load from DB:', error);
    return false;
  }
}

// DB에 뉴스 캐시 저장 (테이블이 없으면 skip)
async function saveNewsToDB(): Promise<void> {
  try {
    console.log('[GoogleNews] Saving news cache to DB...');
    const startTime = Date.now();
    
    const sections = Object.keys(newsCache);
    if (sections.length === 0) {
      console.log('[GoogleNews] No cache to save');
      return;
    }
    
    // 기존 데이터 삭제 후 새로 삽입 (간단한 전략)
    try {
      await db.delete(newsCacheTable);
      await db.delete(newsCacheMeta);
    } catch (tableError: any) {
      // 테이블이 없으면 저장 skip (프로덕션에서 마이그레이션 전)
      if (tableError?.message?.includes('does not exist') || tableError?.code === '42P01') {
        console.log('[GoogleNews] DB tables not found, skipping save (using memory-only mode)');
        return;
      }
      throw tableError;
    }
    
    // 뉴스 아이템 삽입
    const allItems: { 
      section: string; 
      newsId: string; 
      title: string; 
      verdictQuestion: string; 
      source: string | null; 
      link: string; 
      pubDate: string | null; 
    }[] = [];
    
    for (const section of sections) {
      const cached = newsCache[section];
      if (!cached) continue;
      
      for (const item of cached.items) {
        allItems.push({
          section: item.section,
          newsId: item.id,
          title: item.title,
          verdictQuestion: item.verdictQuestion,
          source: item.source,
          link: item.link,
          pubDate: item.pubDate
        });
      }
      
      // 메타 정보 저장
      await db.insert(newsCacheMeta).values({
        section,
        lastUpdated: new Date(cached.lastUpdated),
        nextUpdate: new Date(cached.nextUpdate),
        itemCount: cached.items.length
      });
    }
    
    // 뉴스 아이템 일괄 삽입
    if (allItems.length > 0) {
      await db.insert(newsCacheTable).values(allItems);
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`[GoogleNews] Saved ${allItems.length} items to DB in ${elapsed}ms`);
  } catch (error) {
    console.error('[GoogleNews] Failed to save to DB:', error);
  }
}

// 서버 시작 시 초기화 (하이브리드: DB 우선 → RSS 폴백)
export async function initializeNewsCache(): Promise<void> {
  if (cacheInitializationPromise) {
    console.log('[GoogleNews] Cache initialization already in progress, waiting...');
    return cacheInitializationPromise;
  }
  
  console.log('[GoogleNews] Initializing news cache (hybrid mode)...');
  
  cacheInitializationPromise = (async () => {
    try {
      // 1단계: DB에서 로드 시도 (즉시 사용 가능)
      const loadedFromDB = await loadNewsFromDB();
      
      if (loadedFromDB) {
        cacheInitialized = true;
        lastFetchTime = Date.now();
        console.log('[GoogleNews] News cache loaded from DB (instant ready)');
        
        // 백그라운드에서 RSS 갱신 필요 여부 확인
        if (shouldUpdate()) {
          console.log('[GoogleNews] Scheduling background RSS refresh...');
          // 비동기로 RSS 갱신 (사용자 대기 없음)
          setTimeout(async () => {
            try {
              await getAllNews(true, true);
              await saveNewsToDB();
              console.log('[GoogleNews] Background refresh completed');
            } catch (error) {
              console.error('[GoogleNews] Background refresh failed:', error);
            }
          }, 1000);
        }
      } else {
        // 2단계: DB에 데이터 없으면 RSS에서 가져오기
        console.log('[GoogleNews] No DB cache, fetching from RSS (fast mode)...');
        await getAllNews(true, true);
        cacheInitialized = true;
        
        // DB에 저장
        await saveNewsToDB();
        console.log('[GoogleNews] News cache initialized from RSS and saved to DB');
      }
    } catch (error) {
      console.error('[GoogleNews] Cache initialization failed:', error);
      throw error;
    }
  })();
  
  return cacheInitializationPromise;
}
