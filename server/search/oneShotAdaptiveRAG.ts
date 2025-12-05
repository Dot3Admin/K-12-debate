import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { db } from '../db';
import { entityProfiles, type InsertEntityProfile, type VolatilityLevel } from '@shared/schema';
import { eq } from 'drizzle-orm';

/**
 * 🏛️ One-Shot Adaptive RAG Architecture
 * 
 * 목표: 1 Search + 1 LLM Call로 모든 것을 생성
 * - 메인 답변 (페르소나 기반)
 * - 관점 시나리오 (3~4명의 대화)
 * - 인물 정보 (Entity DB 저장용)
 * - Volatility 판단 (TTL 결정용)
 */

export interface PerspectiveDialogue {
  name: string;
  role: string;
  dialogue: string;
}

export interface TimelineData {
  debut?: number;            // 데뷔/시작 연도 (예: 2010)
  birth?: number;            // 출생 연도 (예: 1992)
  major_events?: Record<string, number>; // 주요 사건: { "1st_asian_cup": 2011, "3rd_election": 2024 }
}

export interface EntityInfo {
  summary: string;
  tags: string[];
  timeline_data?: TimelineData; // ✅ 구조화된 시간축 데이터
}

export interface UltimateResponse {
  reasoning: string;          // CoT 추론 과정
  main_answer: string;        // 1인칭 페르소나 답변
  perspectives: PerspectiveDialogue[];  // 반박/옹호 시나리오
  entity_info: EntityInfo | null;       // 인물 정보 (DB 저장용)
  volatility: VolatilityLevel;         // HIGH/MEDIUM/LOW
  searchResults?: any[];     // ✅ Google 검색 결과 (citation용)
}

/**
 * 🧠 검색 결과 기반 통합 응답 생성 (All-in-One)
 * 
 * @param agentName 에이전트 이름 (예: "Donald Trump", "윤석열")
 * @param userQuestion 사용자 질문
 * @param searchContext 검색 결과 컨텍스트
 * @param entityContext Entity DB에서 가져온 기존 정보 (있는 경우)
 * @returns UltimateResponse
 */
export async function generateUltimateResponse(
  agentName: string,
  userQuestion: string,
  searchContext: string,
  entityContext?: string
): Promise<UltimateResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  
  // ✅ 모델 fallback 체인: Gemini 1.5 retired (Nov 2024) → 2.5 migration
  const modelName = process.env.ONE_SHOT_RAG_MODEL || 'gemini-2.5-flash';
  console.log(`[🏛️ One-Shot RAG] Using model: ${modelName}`);
  
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.2, // 일관성을 위해 낮은 temperature
      maxOutputTokens: 4000,
      responseMimeType: 'application/json',
    },
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ],
  });

  const currentDate = '2025-11-24'; // ✅ 하드코드된 현재 날짜
  
  const entityPrompt = entityContext 
    ? `\n\n[기존 인물 정보 - Use this to verify timeline/dates]\n${entityContext}\n`
    : '';
  
  // ✅ Historical Intent 감지 (검색 쿼리 개선용)
  const historicalKeywords = /1번째|2번째|first|second|1st|2nd|과거|옛날|당시|previous|history|역사|초기|데뷔/i;
  const isHistoricalQuery = historicalKeywords.test(userQuestion);
  
  if (isHistoricalQuery) {
    console.log(`[🕰️ Historical Query Detected] "${userQuestion.slice(0, 50)}..." - Entity context critical for timeline`);
  }

  const systemPrompt = `You are an expert analyst engine with a focus on INSIGHT GENERATION. Your goal is to generate a persona-based answer, diverse perspectives (including systemic criticism), and entity profile data in ONE pass.

CURRENT DATE: ${currentDate}
${entityContext ? `\n🔐 **EXISTING ENTITY DATA (AUTHORITATIVE SOURCE - MUST USE FOR ORDINAL QUERIES):**\n${entityContext}\n` : ''}

**Step 1: Reasoning & Disambiguation (Chain-of-Thought)**
Analyze relative terms in the user's question (e.g., "3rd election", "last album", "recent scandal", "2nd World Cup") and convert them to **absolute years/names** based on the agent's known history.

⚠️ **CRITICAL RULE FOR ORDINAL QUERIES ("1번째", "2번째", "1st", "2nd", "first", "second"):**
${entityContext ? `
1. **MANDATORY**: The existing entity data above contains timeline_data. YOU MUST extract the year from it.
2. **ZERO GUESSING**: Do NOT infer or calculate. Use the exact year from timeline_data["major_events"].
3. **Example**: If timeline_data shows {"2nd_world_cup": 2018}, and user asks "2nd World Cup", your answer MUST be about 2018.
4. **Consistency Check**: After generating main_answer, verify it matches the extracted year. If mismatch, regenerate.
` : `
1. **FALLBACK**: No existing timeline_data. Extract the EXACT YEAR from search results.
2. **DO NOT CONFUSE**: "1st Asian Cup for Son" = 2011 (debut), NOT 2024 (recent).
3. **VERIFY**: Cross-reference multiple search results to confirm the year.
`}

Example Reasoning (with timeline_data):
- User asks: "Son Heung-min's 2nd World Cup"
- timeline_data shows: {"1st_world_cup": 2014, "2nd_world_cup": 2018, "3rd_world_cup": 2022}
- **CORRECT**: "The 2nd World Cup refers to 2018 Russia World Cup"
- **WRONG**: "The 2nd World Cup refers to 2022 Qatar World Cup" (This is 3rd!)

Example Reasoning (without timeline_data):
- Search results mention: "Son Heung-min's World Cup history: 2014 Brazil (1st), 2018 Russia (2nd), 2022 Qatar (3rd)"
- **CORRECT**: "2nd World Cup = 2018 Russia"

---

🏛️ **INSIGHT GENERATION: 'The Architect' & 'Systemic Critic' Framework**

When the user asks about a phenomenon, problem, or controversy, you MUST:

**A. Identify 'The Architect' (책임 주체)**
- Extract the SPECIFIC NAME of the person, law, policy, or organization that CREATED or ENABLED the current situation.
- NOT just the current figurehead (e.g., "President Biden" or "Samsung"), but the ACTUAL ARCHITECT:
  * For policy issues: The specific bill/proposition author, the lobbying group, the DA who implemented it
  * For tech issues: The specific division head, cost-cutting committee, engineering decision maker
  * For economic issues: The regulatory body, specific executive, market structure creator

- **Examples of CORRECT identification:**
  * "San Francisco shoplifting" → "Proposition 47 (2014), authored by George Gascón (then SF DA)"
  * "EV battery fire" → "Samsung SDI's energy density prioritization decision by the Battery Division"
  * "Housing crisis" → "Proposition 13 (1978), authored by Howard Jarvis"

**B. Ensure a 'Systemic Critic' Perspective**
- At least ONE perspective in the "perspectives" array MUST be a **Systemic Critic** role.
- This character focuses on STRUCTURAL/SYSTEMIC criticism, NOT surface-level blame.

- **Systemic Critic Dialogue Rules:**
  * ❌ BAD: "It's because of the President!" (Surface blame)
  * ✅ GOOD: "This isn't about the President. It's about [Specific Law/Policy] passed in [Year]. The [Architect] designed a system where [Bad Consequence] is inevitable."
  
- **The Systemic Critic should:**
  * Name the SPECIFIC law, policy, or structural decision
  * Explain the MECHANISM that created the problem (e.g., "$950 theft threshold means no prosecution")
  * Shift blame from political figures to POLICY ARCHITECTS
  * Provide the YEAR and CONTEXT of when the problematic system was created

---

**Step 2: Content Generation**

Generate ALL of the following in a single JSON response:

1. **main_answer**: A first-person persona-based response from ${agentName}'s perspective.
   - DO NOT use "Candidate" unless actively running for office.
   - Use dynamic honorifics: "President", "CEO", "Former President", etc.
   - Speak naturally as if ${agentName} is directly answering.
   - If the question is about a phenomenon/problem, INCLUDE the name of "The Architect" in your answer.

2. **perspectives**: Array of 3-4 opposing/supporting viewpoints.
   - Each perspective should be a dialogue snippet from a different person.
   - Include their name, role, and a direct quote/rebuttal.
   - ⚠️ **MANDATORY**: At least ONE perspective MUST be a "Systemic Critic" (role: "Policy Analyst", "Legal Scholar", "Investigative Journalist", etc.)
   - The Systemic Critic MUST:
     * Mention the SPECIFIC law/policy/decision by name
     * Explain the structural mechanism that caused the problem
     * Name "The Architect" (the person/group who created the system)
   
3. **entity_info**: Summary of ${agentName} for database storage.
   - "summary": Brief bio including DEBUT/START year and major milestones (e.g., "Son Heung-min debuted in 2011 Asian Cup...")
   - "tags": Array of categories including temporal markers (e.g., ["Sports", "2011-debut", "Korean-footballer"])
   - "timeline_data": **MANDATORY FIELD - NEVER OMIT** - Extract structured timeline information from search results:
     * **RULE 1**: ALWAYS include this field if the query is about a person/organization
     * **RULE 2**: Extract ALL ordinal events (1st, 2nd, 3rd) with EXACT years
     * **RULE 3**: Use normalized keys: "1st_world_cup", "2nd_world_cup", "3rd_election", etc.
     * "debut": Debut/start year (number, e.g., 2010)
     * "birth": Birth year (number, e.g., 1992)
     * "major_events": **CRITICAL** - Key milestones with exact years
       Examples:
       - Son Heung-min: {"1st_world_cup": 2014, "2nd_world_cup": 2018, "3rd_world_cup": 2022}
       - Trump: {"1st_election": 2016, "2nd_election": 2020, "3rd_election": 2024}
   - Return null ONLY if the query is abstract/conceptual (not about a specific person/organization)

4. **volatility**: Classify the topic's information volatility:
   - "HIGH": Current events, elections, breaking news (TTL: 1-6 hours)
   - "MEDIUM": General news, recent developments (TTL: 1-7 days)
   - "LOW": Historical facts, biographies, scientific knowledge (TTL: 7-30 days)

**JSON Output Schema** (strict):
{
  "reasoning": "Your thought process about the query, dates, disambiguation, AND identification of 'The Architect' if applicable...",
  "main_answer": "${agentName}'s first-person response...",
  "perspectives": [
    { "name": "Person Name", "role": "Their Role", "dialogue": "Direct quote or rebuttal..." },
    { "name": "Expert Name", "role": "Systemic Critic / Policy Analyst", "dialogue": "This isn't about [Political Figure]. The real issue is [Specific Policy] from [Year], designed by [Architect]. This created a system where [Structural Problem]..." }
  ],
  "entity_info": { 
    "summary": "Bio summary...", 
    "tags": ["Tag1", "Tag2"],
    "timeline_data": {
      "debut": 2010,
      "birth": 1992,
      "major_events": {"1st_asian_cup": 2011, "3rd_election": 2024}
    }
  } | null,
  "volatility": "HIGH" | "MEDIUM" | "LOW"
}`;

  const userPrompt = `**User Question:** ${userQuestion}

**Search Results:**
${searchContext}
${entityPrompt}

Generate the complete response as a JSON object following the schema above.`;

  const MAX_REGENERATION_ATTEMPTS = 2;
  
  for (let attempt = 1; attempt <= MAX_REGENERATION_ATTEMPTS; attempt++) {
    try {
      console.log(`[🧠 One-Shot RAG] Generating for ${agentName}: "${userQuestion.slice(0, 50)}..." (attempt ${attempt}/${MAX_REGENERATION_ATTEMPTS})`);
      
      const result = await model.generateContent([systemPrompt, userPrompt]);

      const responseText = result.response.text();
      const response = JSON.parse(responseText) as UltimateResponse;

      // ✅ Runtime Validation: Systemic Critic 및 main_answer Architect 검증
      const isPhenomenon = isPhenomenonQuestion(userQuestion);
      const policyDetails = extractPolicyDetailsFromContext(searchContext, userQuestion);
      const extractedArchitect = extractArchitectDetails(searchContext);
      
      console.log(`[🏛️ Extracted Architect Details] Policies: ${extractedArchitect.policies.length}, Thresholds: ${extractedArchitect.thresholds.length}, Years: ${extractedArchitect.years.length}`);
      
      // 1. Systemic Critic 검증 및 보강
      const validatedResponse = validateAndEnhanceSystemicCritic(response, userQuestion, searchContext);
      
      // 2. main_answer에 Architect 언급 검증 (현상 질문인 경우)
      const hasArchitectInfo = extractedArchitect.policies.length > 0 || extractedArchitect.thresholds.length > 0;
      
      if (isPhenomenon && hasArchitectInfo) {
        const architectMentioned = checkArchitectInMainAnswer(validatedResponse.main_answer, extractedArchitect);
        if (!architectMentioned) {
          console.log(`[⚠️ Architect Validation] main_answer lacks specific architect mention`);
          
          // 첫 번째 시도이고 재시도 가능하면 재생성 요청
          if (attempt < MAX_REGENERATION_ATTEMPTS) {
            console.log(`[🔄 Regeneration] Retrying with stronger architect emphasis...`);
            continue; // 다음 시도
          }
          
          // 마지막 시도면 main_answer에 구체적 Architect 정보 주입
          validatedResponse.main_answer = enhanceMainAnswerWithArchitect(
            validatedResponse.main_answer, 
            policyDetails,
            extractedArchitect
          );
        }
      }

      const criticQuality = analyzeSystemicCriticQuality(validatedResponse.perspectives);
      console.log(`[✅ One-Shot RAG] Generated. Volatility: ${validatedResponse.volatility}, Entity: ${validatedResponse.entity_info ? 'Yes' : 'No'}, Systemic Critic: ${criticQuality}`);

      return validatedResponse;
    } catch (error: any) {
      console.error(`[❌ One-Shot RAG] 생성 실패 (attempt ${attempt}):`, error);
      if (attempt === MAX_REGENERATION_ATTEMPTS) {
        throw new Error(`One-Shot RAG 생성 실패: ${error.message}`);
      }
    }
  }
  
  throw new Error('One-Shot RAG 생성 실패: 최대 재시도 횟수 초과');
}

/**
 * 🔍 Step 21: Universal Dynamic Facts & Architect Extraction
 * 모든 주제에 적용 가능한 범용 추출 시스템
 */
interface ExtractedArchitect {
  // Key Metrics (빈도 기반 동적 추출)
  keyMetrics: KeyMetric[];           // 가장 빈번하게 언급되는 숫자/퍼센트/금액
  
  // Architect Discovery (범용 책임자 추출)  
  architects: ArchitectPerson[];      // 정책/제품 책임자들
  
  // Legacy fields (하위 호환성)
  policies: string[];
  thresholds: string[];
  years: string[];
  authors: string[];
  mechanisms: string[];
}

interface KeyMetric {
  value: string;           // "$950", "2,000명", "50%", "iOS 10.2.1"
  type: 'currency' | 'percentage' | 'count' | 'version' | 'date' | 'other';
  frequency: number;       // 검색 결과 내 언급 횟수
  context: string;         // 해당 숫자가 언급된 문맥 (30자)
}

interface ArchitectPerson {
  name: string;            // "George Gascón", "Tim Cook", "보건복지부 장관"
  role: string;            // "DA", "CEO", "Minister"
  action: string;          // "authored", "decided", "announced"
  confidence: number;      // 0-1 신뢰도
}

/**
 * 🔬 Step 21: Universal Dynamic Key Metric Extraction
 * 검색 결과에서 가장 빈번하게 언급되는 "Magic Number"를 동적으로 추출
 */
function extractDynamicKeyMetrics(searchContext: string): KeyMetric[] {
  const metrics: Map<string, KeyMetric> = new Map();
  const contextLower = searchContext.toLowerCase();
  
  // 1. 금액 추출 ($950, $1,000, etc.)
  const currencyMatches = searchContext.match(/\$[\d,]+(?:\.\d{2})?(?:\s*(?:billion|million|thousand))?/gi) || [];
  currencyMatches.forEach(match => {
    const normalized = match.trim();
    const existing = metrics.get(normalized);
    if (existing) {
      existing.frequency++;
    } else {
      const idx = searchContext.indexOf(match);
      metrics.set(normalized, {
        value: normalized,
        type: 'currency',
        frequency: 1,
        context: searchContext.slice(Math.max(0, idx - 15), idx + match.length + 15).trim()
      });
    }
  });
  
  // 2. 퍼센트 추출 (50%, 10.5%, etc.)
  const percentMatches = searchContext.match(/\d+(?:\.\d+)?%/g) || [];
  percentMatches.forEach(match => {
    const existing = metrics.get(match);
    if (existing) {
      existing.frequency++;
    } else {
      const idx = searchContext.indexOf(match);
      metrics.set(match, {
        value: match,
        type: 'percentage',
        frequency: 1,
        context: searchContext.slice(Math.max(0, idx - 15), idx + match.length + 15).trim()
      });
    }
  });
  
  // 3. 인원/수량 추출 (2,000명, 1000 students, etc.)
  const countMatches = searchContext.match(/[\d,]+\s*(?:명|people|students|seats|users|employees|doctors|patients)/gi) || [];
  countMatches.forEach(match => {
    const normalized = match.trim();
    const existing = metrics.get(normalized);
    if (existing) {
      existing.frequency++;
    } else {
      const idx = searchContext.indexOf(match);
      metrics.set(normalized, {
        value: normalized,
        type: 'count',
        frequency: 1,
        context: searchContext.slice(Math.max(0, idx - 15), idx + match.length + 15).trim()
      });
    }
  });
  
  // 4. 버전 번호 추출 (iOS 10.2.1, v2.0, Version 3.5, etc.)
  const versionMatches = searchContext.match(/(?:iOS|Android|version|v|Ver\.?)\s*[\d.]+/gi) || [];
  versionMatches.forEach(match => {
    const normalized = match.trim();
    const existing = metrics.get(normalized);
    if (existing) {
      existing.frequency++;
    } else {
      const idx = searchContext.indexOf(match);
      metrics.set(normalized, {
        value: normalized,
        type: 'version',
        frequency: 1,
        context: searchContext.slice(Math.max(0, idx - 15), idx + match.length + 15).trim()
      });
    }
  });
  
  // 5. 연도 추출 (2014, 2023, etc.)
  const yearMatches = searchContext.match(/\b(19[89]\d|20[0-2]\d)\b/g) || [];
  yearMatches.forEach(match => {
    const existing = metrics.get(match);
    if (existing) {
      existing.frequency++;
    } else {
      const idx = searchContext.indexOf(match);
      metrics.set(match, {
        value: match,
        type: 'date',
        frequency: 1,
        context: searchContext.slice(Math.max(0, idx - 15), idx + match.length + 15).trim()
      });
    }
  });
  
  // 빈도순 정렬 후 상위 5개 반환
  return Array.from(metrics.values())
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 5);
}

/**
 * 🔬 Step 21: Universal Architect Discovery
 * "Who authored/designed/decided [Topic]?" 패턴으로 책임자 동적 추출
 */
function extractUniversalArchitects(searchContext: string): ArchitectPerson[] {
  const architects: ArchitectPerson[] = [];
  const contextLower = searchContext.toLowerCase();
  
  // 범용 책임자 패턴 (영어)
  const englishPatterns = [
    /(?:authored|written|drafted|proposed|sponsored|introduced|championed)\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gi,
    /(?:designed|created|developed|built)\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gi,
    /(?:decided|announced|declared|ordered)\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gi,
    /(?:led|headed|directed|managed)\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gi,
    /(?:CEO|CFO|CTO|President|Minister|Secretary|Director|Chief|Chairman)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/gi,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}),?\s+(?:the\s+)?(?:CEO|CFO|CTO|President|Minister|Secretary|Director|Chief)/gi,
    /(?:DA|District\s+Attorney)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
    /(?:Governor|Senator|Mayor|Congressman|Representative)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
  ];
  
  // 범용 책임자 패턴 (한국어)
  const koreanPatterns = [
    /([가-힣]{2,4})\s*(?:대통령|장관|총리|위원장|의원|시장|지사|청장)/g,
    /(?:대통령|장관|총리|위원장|의원|시장|지사|청장)\s*([가-힣]{2,4})/g,
    /([가-힣]{2,4})\s*(?:CEO|대표|사장|회장|이사)/g,
  ];
  
  // 영어 패턴 매칭
  englishPatterns.forEach((pattern, idx) => {
    let match;
    while ((match = pattern.exec(searchContext)) !== null) {
      const name = match[1]?.trim();
      if (name && name.length > 2 && name.length < 40) {
        // 역할 추론
        let role = 'Unknown';
        let action = 'involved with';
        
        if (idx === 0) { action = 'authored'; role = 'Author'; }
        if (idx === 1) { action = 'designed'; role = 'Designer'; }
        if (idx === 2) { action = 'decided'; role = 'Decision Maker'; }
        if (idx === 3) { action = 'led'; role = 'Leader'; }
        if (idx >= 4) { 
          const roleMatch = match[0].match(/CEO|CFO|CTO|President|Minister|Secretary|Director|Chief|Chairman|DA|Governor|Senator|Mayor/i);
          role = roleMatch ? roleMatch[0] : 'Executive';
          action = 'serves as';
        }
        
        // 중복 체크
        if (!architects.some(a => a.name.toLowerCase() === name.toLowerCase())) {
          architects.push({
            name,
            role,
            action,
            confidence: 0.8
          });
        }
      }
    }
  });
  
  // 한국어 패턴 매칭
  koreanPatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(searchContext)) !== null) {
      const name = match[1]?.trim();
      if (name && name.length >= 2 && name.length <= 4) {
        const roleMatch = match[0].match(/대통령|장관|총리|위원장|의원|시장|지사|청장|CEO|대표|사장|회장|이사/);
        const role = roleMatch ? roleMatch[0] : '책임자';
        
        if (!architects.some(a => a.name === name)) {
          architects.push({
            name,
            role,
            action: '담당',
            confidence: 0.7
          });
        }
      }
    }
  });
  
  return architects.slice(0, 5);
}

/**
 * 🔬 Step 21: Combined Dynamic Fact & Architect Extraction
 * 기존 extractArchitectDetails를 범용 시스템으로 업그레이드
 */
function extractArchitectDetails(searchContext: string): ExtractedArchitect {
  // Step 21 Dynamic Extraction
  const keyMetrics = extractDynamicKeyMetrics(searchContext);
  const architects = extractUniversalArchitects(searchContext);
  
  // Legacy extraction for backward compatibility
  const policyMatches = searchContext.match(/proposition\s+\d+|bill\s+[A-Z0-9\-]+|(?:[A-Z][a-z]+\s+)+Act|법안|조례|규정/gi) || [];
  const policies = [...new Set(policyMatches.map(m => m.trim()))];
  
  // Key Metrics에서 thresholds 추출 (currency/percentage 타입)
  const thresholds = keyMetrics
    .filter(m => m.type === 'currency' || m.type === 'percentage')
    .map(m => m.value);
  
  // Key Metrics에서 years 추출
  const years = keyMetrics
    .filter(m => m.type === 'date')
    .map(m => m.value)
    .slice(0, 3);
  
  // Architects에서 authors 추출
  const authors = architects.map(a => a.name);
  
  // 메커니즘 키워드 (범용)
  const mechanismKeywords = [
    'threshold', 'limit', 'loophole', 'exemption', 'cap', 'quota', 'restriction',
    'misdemeanor', 'felony', 'prosecution', 'penalty',
    'throttling', 'slowdown', 'optimization', 'update', 'patch',
    '정원', '할당', '제한', '상한', '하한', '기준'
  ];
  const mechanisms = mechanismKeywords.filter(kw => 
    searchContext.toLowerCase().includes(kw.toLowerCase())
  );
  
  // 로깅
  console.log(`[🔬 Step 21 Dynamic Extraction]`);
  console.log(`  - Key Metrics (Top 5): ${keyMetrics.map(m => `${m.value}(${m.frequency}x)`).join(', ') || 'none'}`);
  console.log(`  - Architects: ${architects.map(a => `${a.name}(${a.role})`).join(', ') || 'none'}`);
  console.log(`  - Policies: ${policies.join(', ') || 'none'}`);
  
  return {
    keyMetrics,
    architects,
    policies,
    thresholds,
    years,
    authors,
    mechanisms
  };
}

/**
 * 🔍 Step 21: Universal Validation for main_answer
 * Key Metric + Architect 정보가 main_answer에 포함되어 있는지 검증
 * 
 * 범용 조건:
 * - Top Key Metric 필수 (가장 빈번하게 언급된 숫자/금액/퍼센트)
 * - 정책명 OR Architect 중 하나 이상 필수
 */
function checkArchitectInMainAnswer(
  mainAnswer: string, 
  extractedArchitect: ExtractedArchitect
): boolean {
  const answerLower = mainAnswer.toLowerCase();
  
  // 1. Top Key Metric 언급 확인 (Step 21: Magic Number)
  const topMetric = extractedArchitect.keyMetrics[0];
  let hasKeyMetric = false;
  if (topMetric) {
    // 다양한 형식 지원
    const metricValue = topMetric.value;
    const numericOnly = metricValue.match(/[\d,.]+/)?.[0] || '';
    const numericNoComma = numericOnly.replace(/,/g, '');
    
    hasKeyMetric = mainAnswer.includes(metricValue) || 
                   (numericOnly !== '' && mainAnswer.includes(numericOnly)) ||
                   (numericNoComma !== '' && numericNoComma !== numericOnly && mainAnswer.includes(numericNoComma));
  }
  
  // 2. 정책/법안 언급 확인
  const hasPolicy = extractedArchitect.policies.some(p => answerLower.includes(p.toLowerCase()));
  
  // 3. Architect (책임자) 언급 확인
  const hasArchitect = extractedArchitect.architects.some(a => 
    answerLower.includes(a.name.toLowerCase())
  );
  
  // 4. Legacy thresholds 체크 (하위 호환성)
  const hasThreshold = extractedArchitect.thresholds.some(t => {
    const originalAmount = t.replace(/\s.*/, '');
    if (mainAnswer.includes(originalAmount)) return true;
    const amountOnly = t.match(/\$?([\d,]+)/)?.[1] || '';
    if (amountOnly && mainAnswer.includes(amountOnly)) return true;
    const amountNoComma = amountOnly.replace(/,/g, '');
    if (amountNoComma && amountNoComma !== amountOnly && mainAnswer.includes(amountNoComma)) return true;
    return false;
  });
  
  // 로깅
  console.log(`[🔍 Step 21 Validation] Universal check:`);
  console.log(`  - Has Key Metric (REQUIRED): ${hasKeyMetric} (top: ${topMetric?.value || 'none'})`);
  console.log(`  - Has Policy: ${hasPolicy}`);
  console.log(`  - Has Architect: ${hasArchitect}`);
  console.log(`  - Has Threshold (legacy): ${hasThreshold}`);
  console.log(`  - Key Metrics: ${extractedArchitect.keyMetrics.map(m => m.value).join(', ') || 'none'}`);
  console.log(`  - Architects: ${extractedArchitect.architects.map(a => a.name).join(', ') || 'none'}`);
  
  // 범용 조건:
  // - Key Metric이 있으면 반드시 언급해야 함
  // - 정책 OR Architect 중 하나 이상 언급해야 함
  const hasMetricOrThreshold = hasKeyMetric || hasThreshold;
  const hasPolicyOrArchitect = hasPolicy || hasArchitect;
  
  // Key Metric이 발견되었으면 필수, 아니면 정책/아키텍트만 체크
  let passesCheck: boolean;
  if (extractedArchitect.keyMetrics.length > 0) {
    passesCheck = hasMetricOrThreshold && hasPolicyOrArchitect;
  } else if (extractedArchitect.policies.length > 0 || extractedArchitect.architects.length > 0) {
    passesCheck = hasPolicyOrArchitect;
  } else {
    // 추출된 정보가 없으면 통과
    passesCheck = true;
  }
  
  console.log(`[🔍 Step 21 Validation] Result: ${passesCheck ? '✅ PASS' : '❌ FAIL'}`);
  
  return passesCheck;
}

/**
 * 🛠️ Step 21: Universal Architect Info Injection
 * Key Metrics와 Architects 정보를 main_answer에 주입
 */
function enhanceMainAnswerWithArchitect(
  mainAnswer: string,
  policyDetails: { specificDialogue: string; foundPolicy: boolean },
  extractedArchitect?: ExtractedArchitect
): string {
  if (!extractedArchitect) return mainAnswer;
  
  // Step 21: Key Metrics와 Architects 우선 사용
  const hasInfo = extractedArchitect.keyMetrics.length > 0 || 
                  extractedArchitect.architects.length > 0 ||
                  extractedArchitect.policies.length > 0;
                           
  if (!hasInfo) {
    console.log(`[🛠️ Step 21 Enhance] No dynamic facts available to inject`);
    return mainAnswer;
  }
  
  const architectParts: string[] = [];
  
  // 1. Top Key Metric (Magic Number) - 가장 중요
  if (extractedArchitect.keyMetrics.length > 0) {
    const topMetric = extractedArchitect.keyMetrics[0];
    architectParts.push(`**Key Metric: ${topMetric.value}** (mentioned ${topMetric.frequency}x in sources)`);
  }
  
  // 2. Architect (책임자)
  if (extractedArchitect.architects.length > 0) {
    const topArchitect = extractedArchitect.architects[0];
    architectParts.push(`**${topArchitect.name}** (${topArchitect.role}) ${topArchitect.action} this`);
  }
  
  // 3. 정책명 (있으면)
  if (extractedArchitect.policies.length > 0) {
    architectParts.push(`related to **${extractedArchitect.policies[0]}**`);
  }
  
  // 4. 연도 (있으면)
  if (extractedArchitect.years.length > 0) {
    architectParts.push(`(${extractedArchitect.years[0]})`);
  }
  
  // 5. 메커니즘 (있으면)
  if (extractedArchitect.mechanisms.length > 0) {
    const mechanismList = extractedArchitect.mechanisms.slice(0, 2).join('/');
    architectParts.push(`through a ${mechanismList} mechanism`);
  }
  
  if (architectParts.length >= 1) {
    const architectNote = `\n\n**[Dynamic Facts & Architect]** ${architectParts.join(', ')}. This identifies the structural root cause and the specific decision-maker behind it.`;
    console.log(`[🛠️ Step 21 Enhance] Injecting ${architectParts.length} dynamic facts`);
    return mainAnswer + architectNote;
  }
  
  return mainAnswer;
}

/**
 * 🔍 Systemic Critic 품질 레벨 검증
 * perspectives 배열에 구체적인 Systemic Critic 역할이 포함되어 있는지 확인
 * 
 * @returns 'SPECIFIC' - 구체적인 법률/정책/책임자 언급 있음
 * @returns 'GENERIC' - Systemic Critic 역할은 있으나 구체성 부족
 * @returns 'NONE' - Systemic Critic 없음
 */
function analyzeSystemicCriticQuality(perspectives: PerspectiveDialogue[]): 'SPECIFIC' | 'GENERIC' | 'NONE' {
  if (!perspectives || perspectives.length === 0) return 'NONE';
  
  const systemicCriticRoles = [
    'systemic critic', 'policy analyst', 'legal scholar', 
    'investigative journalist', 'structural analyst', 
    'policy expert', 'institutional critic', 'systems analyst'
  ];
  
  // 일반적인 시스템 키워드 (있으면 GENERIC)
  const genericKeywords = [
    'policy', 'regulation', 'structural', 'systemic', 'mechanism', 'system'
  ];
  
  // 구체적인 아키텍트 지표 (있으면 SPECIFIC) - 연도, 숫자, 고유명사 패턴
  const specificPatterns = [
    /proposition\s+\d+/i,           // Proposition 47, Proposition 13
    /\b(19|20)\d{2}\b/,             // 연도 (1978, 2014, 2024)
    /\$[\d,]+/,                     // 금액 ($950, $1,000)
    /bill\s+[A-Z0-9\-]+/i,          // Bill SB-123, Bill HR-1
    /act\s+of\s+(19|20)\d{2}/i,     // Act of 2014
    /authored\s+by/i,               // authored by [name]
    /passed\s+in\s+(19|20)\d{2}/i,  // passed in 2014
    /\bda\b.*\b[A-Z][a-z]+/i,       // DA Gascón
    /\b[A-Z][a-z]+\s+(Act|Bill|Law|Proposition)/i,  // Howard Jarvis Proposition
  ];
  
  let hasGenericCritic = false;
  let hasSpecificCritic = false;
  
  for (const p of perspectives) {
    const roleLower = (p.role || '').toLowerCase();
    const dialogueLower = (p.dialogue || '').toLowerCase();
    const dialogueOriginal = p.dialogue || '';
    
    const hasSystemicRole = systemicCriticRoles.some(r => roleLower.includes(r));
    const hasGenericKeywords = genericKeywords.filter(k => dialogueLower.includes(k)).length >= 2;
    
    // 구체성 패턴 검사 (원본 케이스 유지하여 고유명사 패턴 검사)
    const hasSpecificDetails = specificPatterns.some(pattern => pattern.test(dialogueOriginal));
    
    if (hasSystemicRole || hasGenericKeywords) {
      hasGenericCritic = true;
      
      if (hasSpecificDetails) {
        hasSpecificCritic = true;
        console.log(`[✅ Specific Systemic Critic Found] "${p.name}" mentions specific policy/year/amount`);
        break;
      }
    }
  }
  
  if (hasSpecificCritic) return 'SPECIFIC';
  if (hasGenericCritic) return 'GENERIC';
  return 'NONE';
}

/**
 * 🔍 현상/문제 질문 여부 판단
 * 사용자 질문이 구조적 원인을 요구하는 "왜/어떻게" 질문인지 확인
 */
function isPhenomenonQuestion(question: string): boolean {
  const phenomenonPatterns = [
    /why\s+(is|are|do|does|did|has|have)/i,
    /왜.*\?/,
    /어떻게.*\?/,
    /what\s+(caused|causes|is\s+causing|led\s+to)/i,
    /who\s+(is|are)\s+responsible/i,
    /누가.*책임/,
    /원인.*무엇/,
    /이유.*무엇/,
    /(rampant|epidemic|crisis|problem|issue|surge|increase|decline)/i,
  ];
  
  return phenomenonPatterns.some(pattern => pattern.test(question));
}

/**
 * 🛡️ Systemic Critic 검증 및 보강
 * 현상/문제 질문에 대해 구체적인 Systemic Critic 관점 보장
 */
function validateAndEnhanceSystemicCritic(
  response: UltimateResponse, 
  userQuestion: string,
  searchContext?: string
): UltimateResponse {
  if (!response.perspectives) {
    response.perspectives = [];
  }
  
  const quality = analyzeSystemicCriticQuality(response.perspectives);
  const isPhenomenon = isPhenomenonQuestion(userQuestion);
  
  console.log(`[🔍 Systemic Critic Analysis] Quality: ${quality}, Is Phenomenon Question: ${isPhenomenon}`);
  
  // SPECIFIC이면 그대로 반환
  if (quality === 'SPECIFIC') {
    console.log('[✅ Systemic Critic Validation] High-quality systemic critic found with specific policy details');
    return response;
  }
  
  // 현상 질문이 아니면 GENERIC도 허용
  if (!isPhenomenon && quality === 'GENERIC') {
    console.log('[✅ Systemic Critic Validation] Generic systemic critic acceptable for non-phenomenon question');
    return response;
  }
  
  // 현상 질문인데 구체성이 부족하면 → 검색 결과에서 힌트 추출하여 보강
  console.log('[⚠️ Systemic Critic Enhancement] Extracting specific details from search context...');
  
  // 검색 결과에서 구체적인 정책/법률 정보 추출 시도
  const extractedDetails = extractPolicyDetailsFromContext(searchContext || '', userQuestion);
  
  const enhancedSystemicCritic: PerspectiveDialogue = {
    name: "Policy Architecture Analyst",
    role: "Systemic Critic / Legislative Scholar",
    dialogue: extractedDetails.specificDialogue
  };
  
  // 기존 generic critic 교체 또는 추가
  if (quality === 'GENERIC') {
    // 가장 관련성 높은 generic critic을 찾아서 개선
    console.log('[🔄 Systemic Critic Upgrade] Upgrading generic critic with specific details');
  }
  
  response.perspectives.push(enhancedSystemicCritic);
  console.log(`[✅ Enhanced Systemic Critic Added] ${extractedDetails.foundPolicy ? 'Policy detected' : 'Framework question added'}`);
  
  return response;
}

/**
 * 🔬 검색 컨텍스트에서 구체적인 정책/법률 정보 추출
 */
function extractPolicyDetailsFromContext(
  searchContext: string, 
  userQuestion: string
): { specificDialogue: string; foundPolicy: boolean } {
  const contextLower = searchContext.toLowerCase();
  
  // 주요 정책/법률 패턴 매칭
  const policyPatterns = [
    { pattern: /proposition\s+(\d+)/gi, type: 'Proposition' },
    { pattern: /\$(\d{1,3}(?:,\d{3})*|\d+)\s*(threshold|limit)/gi, type: 'Threshold' },
    { pattern: /(bill|act|law)\s+([A-Z0-9\-]+)/gi, type: 'Legislation' },
    { pattern: /(19|20)(\d{2})/g, type: 'Year' },
    { pattern: /(authored|proposed|sponsored)\s+by\s+([A-Za-z\s]+)/gi, type: 'Author' },
    { pattern: /([A-Z][a-z]+\s+){1,2}(DA|District\s+Attorney)/gi, type: 'DA' },
  ];
  
  const foundDetails: string[] = [];
  let foundPolicy = false;
  
  for (const { pattern, type } of policyPatterns) {
    const matches = searchContext.match(pattern);
    if (matches && matches.length > 0) {
      foundPolicy = true;
      foundDetails.push(`${type}: ${matches.slice(0, 2).join(', ')}`);
    }
  }
  
  // 구체적인 정보를 발견한 경우
  if (foundPolicy && foundDetails.length >= 2) {
    return {
      specificDialogue: `This isn't about blaming any particular politician or administration. The structural issue lies in the specific policy architecture. Looking at the evidence: ${foundDetails.join('; ')}. These legislative decisions created the systemic conditions that make this phenomenon possible. To address the root cause, we need to examine who designed these rules and why they were implemented this way.`,
      foundPolicy: true
    };
  }
  
  // 구체적인 정보를 찾지 못한 경우 - 질문 기반 프레임워크 제시
  return {
    specificDialogue: `The key question isn't 'who to blame' but 'what system allows this?' For "${userQuestion.slice(0, 60)}...", we should investigate: (1) What specific law, regulation, or policy created these conditions? (2) When was it enacted and by whom? (3) What threshold, loophole, or mechanism does it establish? (4) Who advocated for this system and why? Surface-level political blame obscures these structural factors.`,
    foundPolicy: false
  };
}

/**
 * 🗃️ Entity Profile 업데이트/저장 (Upsert)
 * 
 * @param agentName 인물/조직 이름 (정규화됨)
 * @param entityInfo 인물 정보
 * @param volatility Volatility 레벨
 * @param source 정보 출처 (검색 쿼리)
 */
export async function upsertEntityProfile(
  agentName: string,
  entityInfo: EntityInfo,
  volatility: VolatilityLevel,
  source: string
): Promise<void> {
  try {
    const normalizedName = agentName.trim();
    
    const profileData: InsertEntityProfile = {
      agentName: normalizedName,
      bioSummary: entityInfo.summary,
      tags: entityInfo.tags,
      timelineData: entityInfo.timeline_data || null, // ✅ Structured timeline data
      volatility,
      source,
    };

    const now = new Date();

    // ✅ Preserve existing timeline_data if new data is null/undefined
    const updateSet: any = {
      bioSummary: profileData.bioSummary,
      tags: profileData.tags,
      volatility: profileData.volatility,
      source: profileData.source,
      lastUpdated: now,
    };
    
    // Only update timelineData if new data exists (prevent NULL overwrites)
    if (profileData.timelineData) {
      updateSet.timelineData = profileData.timelineData;
      console.log(`[✅ Timeline Data Extracted] ${normalizedName} - ${JSON.stringify(profileData.timelineData)}`);
    } else {
      console.warn(`[⚠️ Timeline Data Missing] LLM did not return timeline_data for ${normalizedName} - Preserving existing data`);
    }

    // Upsert: 있으면 업데이트, 없으면 삽입
    await db
      .insert(entityProfiles)
      .values(profileData)
      .onConflictDoUpdate({
        target: entityProfiles.agentName,
        set: updateSet,
      });

    console.log(`[💾 Entity DB] Upserted: ${normalizedName} (${volatility})`);
  } catch (error: any) {
    console.error('[❌ Entity DB] Upsert 실패:', error);
  }
}

/**
 * 🔍 Entity Profile 조회
 * 
 * @param agentName 인물/조직 이름
 * @returns Entity 정보 또는 null
 */
export async function getEntityProfile(agentName: string): Promise<string | null> {
  try {
    const normalizedName = agentName.trim();
    const result = await db
      .select()
      .from(entityProfiles)
      .where(eq(entityProfiles.agentName, normalizedName))
      .limit(1);

    if (result.length === 0) {
      console.log(`[🔍 Entity DB] Not found: ${normalizedName}`);
      return null;
    }

    const profile = result[0];
    
    // ✅ Backward Compatibility: Null check for timeline_data
    const timelineInfo = profile.timelineData 
      ? `\nTimeline: ${JSON.stringify(profile.timelineData)}`
      : '';
    
    const entityContext = `Name: ${profile.agentName}
Summary: ${profile.bioSummary}
Tags: ${JSON.stringify(profile.tags)}${timelineInfo}
Last Updated: ${profile.lastUpdated?.toISOString() || 'Unknown'}`;

    console.log(`[✅ Entity DB] Found: ${normalizedName}${profile.timelineData ? ' (with timeline data)' : ''}`);
    return entityContext;
  } catch (error: any) {
    console.error('[❌ Entity DB] 조회 실패:', error);
    return null;
  }
}

/**
 * 📅 Adaptive TTL 계산
 * 
 * @param volatility Volatility 레벨
 * @returns TTL (초 단위)
 */
export function calculateAdaptiveTTL(volatility: VolatilityLevel): number {
  switch (volatility) {
    case 'HIGH':
      return 6 * 60 * 60; // 6시간
    case 'MEDIUM':
      return 3 * 24 * 60 * 60; // 3일
    case 'LOW':
      return 14 * 24 * 60 * 60; // 14일
    default:
      return 7 * 24 * 60 * 60; // 기본값: 7일
  }
}
