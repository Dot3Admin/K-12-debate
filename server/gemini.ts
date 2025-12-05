import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import type { AgentHumor } from "@shared/schema";
import { buildHumorTonePrompt, type ContextType } from "./utils/HumorToneController.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export interface GeminiChatMessage {
  role: "user" | "model";
  parts: string;
}

export interface GeminiChatOptions {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
}

export interface GeminiChatResponse {
  text: string;
  sources?: {
    chunks: Array<{ title: string; url: string }>;
    supports: Array<{
      startIndex: number;
      endIndex: number;
      text: string;
      chunkIndices: number[];
    }>;
  };
}

// 안전 설정 (기본값)
const safetySettings = [
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
];

/**
 * 503 과부하 에러 체크
 */
function isOverloadError(error: any): boolean {
  const errorMsg = error.message?.toLowerCase() || '';
  const errorStatus = error.status;
  return (
    errorStatus === 503 || 
    errorMsg.includes('503') || 
    errorMsg.includes('overload') || 
    errorMsg.includes('unavailable')
  );
}

/**
 * Exponential backoff를 사용한 sleep 함수
 */
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Gemini API 에러를 사용자 친화적 메시지로 변환
 */
function normalizeGeminiError(error: any): Error {
  if (error.message?.includes("quota")) {
    return new Error("Gemini API quota exceeded. Please check your usage limits.");
  } else if (error.message?.includes("safety")) {
    return new Error("Content was blocked by Gemini safety filters.");
  } else if (error.message?.includes("API key")) {
    return new Error("Invalid Gemini API key. Please check your GEMINI_API_KEY environment variable.");
  } else {
    return new Error(`Gemini API error: ${error.message || "Unknown error"}`);
  }
}

/**
 * 재시도 로직을 포함한 함수 실행 wrapper
 */
async function executeWithRetries<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries - 1;
      const isRetryable = isOverloadError(error);
      
      if (isRetryable && !isLastAttempt) {
        const waitTime = (2 ** attempt) * 1000; // 1s, 2s, 4s, 8s, 16s
        console.log(`[🔄 RETRY] Gemini overload error (attempt ${attempt + 1}/${maxRetries}). Waiting ${waitTime}ms...`);
        await sleep(waitTime);
        continue;
      }
      
      // 재시도 불가능한 에러거나 마지막 시도 실패
      console.error("[Gemini API Error]", error);
      throw normalizeGeminiError(error);
    }
  }
  
  throw new Error("Max retries exceeded");
}

/**
 * Gemini API를 사용하여 채팅 응답 생성 (재시도 로직 없음 - 내부 함수)
 */
async function _generateGeminiChatResponseInternal(
  systemPrompt: string,
  messages: GeminiChatMessage[],
  options: GeminiChatOptions = {}
): Promise<GeminiChatResponse> {
  const {
    model = "gemini-2.0-flash-lite",
    // 🌡️ 사실 기반 응답을 위한 낮은 temperature 설정
    // 학습된 구체적 정보 인용을 우선시 (창의적 재구성 억제)
    temperature = 0.35,  // 사실 회상 최적화 (0.3~0.4 범위)
    maxOutputTokens = 4096,
    topP = 0.6,          // 결정론적 출력 편향 (인용문 우선)
    topK = 40,
  } = options;

  const geminiModel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature,
      maxOutputTokens,
      topP,
      topK,
    },
    safetySettings,
  });

  // 대화 히스토리 변환
  let history = messages.slice(0, -1).map(msg => ({
    role: msg.role,
    parts: [{ text: msg.parts }],
  }));

  // Gemini API 요구사항: 히스토리는 "user"로 시작해야 함
  // "model"로 시작하는 메시지 제거
  while (history.length > 0 && history[0].role === "model") {
    history = history.slice(1);
  }

  const lastMessage = messages[messages.length - 1];

  // 채팅 세션 시작
  const chat = geminiModel.startChat({
    history,
  });

  // 메시지 전송 및 응답 받기
  const result = await chat.sendMessage(lastMessage.parts);
  const response = result.response;
  
  // 응답 텍스트 가져오기
  const responseText = response.text();
  console.log(`[🤖 GEMINI RESPONSE] Length: ${responseText.length} chars`);
  
  if (responseText.length === 0) {
    console.error(`[❌ EMPTY RESPONSE] Gemini returned empty text!`);
    console.error(`[❌ RESPONSE DEBUG]`, JSON.stringify({
      candidates: (response as any).candidates,
      promptFeedback: (response as any).promptFeedback
    }, null, 2));
  }
  
  return {
    text: responseText,
    sources: undefined  // Google Search 비활성화로 항상 undefined
  };
}

/**
 * 핵심 키워드 추출 (간단한 버전)
 * 한글 명사 패턴, 숫자, 영문 고유명사 추출
 */
function extractKeywords(text: string, maxKeywords: number = 5): string[] {
  if (!text) return [];
  
  // 불용어 (stopwords)
  const stopwords = new Set(['이', '그', '저', '것', '수', '등', '및', '또', '을', '를', '이를', '그를', '저를', 
    '의', '가', '에', '에서', '으로', '와', '과', '도', '만', '뿐', '까지', '부터', '에게', '한테']);
  
  // 1. 한글 2글자 이상 (명사 패턴)
  const koreanWords = text.match(/[가-힣]{2,}/g) || [];
  
  // 2. 영문 대문자로 시작하는 단어 (고유명사)
  const properNouns = text.match(/[A-Z][a-z]+/g) || [];
  
  // 3. 숫자 포함 패턴 (연도, 날짜 등)
  const numbers = text.match(/\d{4}년?|\d{1,2}월|\d{1,2}일/g) || [];
  
  // 모든 키워드 합치기
  const allKeywords = [...koreanWords, ...properNouns, ...numbers]
    .filter(word => !stopwords.has(word) && word.length >= 2)
    .slice(0, maxKeywords);
  
  return allKeywords;
}

/**
 * 하이브리드 쿼리 빌더
 * Primary: agentName + userMessage + 답변 핵심 키워드
 * Fallback: answerContent 일부
 */
function buildHybridQuery(params: {
  agentName: string;
  userMessage: string;
  answerContent: string;
}): { primary: string; fallback: string } {
  const { agentName, userMessage, answerContent } = params;
  
  // 답변에서 핵심 키워드 추출
  const keywords = extractKeywords(answerContent, 3);
  
  // Primary Query: 에이전트명 + 질문 + 핵심 키워드
  const primaryParts = [
    agentName,
    userMessage.slice(0, 100),
    ...keywords
  ].filter(Boolean);
  
  const primary = primaryParts.join(' ').slice(0, 200);
  
  // Fallback Query: 답변 텍스트 일부
  const fallback = `"${answerContent.slice(0, 150)}" 관련 출처`;
  
  console.log(`[🔨 QUERY BUILDER] Primary: "${primary.slice(0, 80)}..."`);
  console.log(`[🔨 QUERY BUILDER] Fallback: "${fallback.slice(0, 80)}..."`);
  
  return { primary, fallback };
}

/**
 * 타임아웃 헬퍼 함수
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

/**
 * 메시지 내용으로 Google Search 수행 (하이브리드 쿼리 전략)
 * ⏱️ 7초 타임아웃 강제 적용
 */
export async function searchMessageSources(params: {
  agentName: string;
  userMessage: string;
  answerContent: string;
}): Promise<{
  success: boolean;
  sources: Array<{ title: string; url: string; snippet?: string }>;
  error?: string;
}> {
  const SEARCH_TIMEOUT = 7000; // 7초 타임아웃
  
  try {
    const geminiModel = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-lite",
      tools: [{
        google_search: {}
      }] as any,
    });

    // 하이브리드 쿼리 생성
    const queries = buildHybridQuery(params);
    
    // Primary Query 시도 (7초 타임아웃)
    console.log(`[🔍 PRIMARY SEARCH] Agent: ${params.agentName}, Query: "${queries.primary.slice(0, 50)}..."`);
    const startTime = Date.now();
    
    let result;
    try {
      result = await withTimeout(
        geminiModel.generateContent({
          contents: [{
            role: "user",
            parts: [{ text: queries.primary }]
          }]
        }),
        SEARCH_TIMEOUT
      );
    } catch (timeoutError) {
      console.log(`[⏱️ SEARCH TIMEOUT] Primary query timed out after ${SEARCH_TIMEOUT}ms - returning empty sources`);
      return { success: true, sources: [] };
    }

    let response = result.response;
    let groundingMetadata = (response as any).candidates?.[0]?.groundingMetadata;

    // Primary Query에서 출처를 못 찾으면 Fallback 시도 (남은 시간만큼만 시도)
    if (!groundingMetadata || !groundingMetadata.groundingChunks || groundingMetadata.groundingChunks.length === 0) {
      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(1000, SEARCH_TIMEOUT - elapsed); // 최소 1초 보장
      
      console.log(`[⚠️ PRIMARY FAILED] No sources found, trying fallback query (timeout: ${remainingTime}ms)...`);
      
      try {
        result = await withTimeout(
          geminiModel.generateContent({
            contents: [{
              role: "user",
              parts: [{ text: queries.fallback }]
            }]
          }),
          remainingTime
        );
      } catch (timeoutError) {
        console.log(`[⏱️ SEARCH TIMEOUT] Fallback query timed out - returning empty sources`);
        return { success: true, sources: [] };
      }

      response = result.response;
      groundingMetadata = (response as any).candidates?.[0]?.groundingMetadata;
    }

    const totalTime = Date.now() - startTime;
    console.log(`[⏱️ SEARCH TIME] ${totalTime}ms`);

    if (!groundingMetadata || !groundingMetadata.groundingChunks) {
      console.log(`[🔍 SEARCH] Both queries failed → 0개 출처 발견`);
      return { success: true, sources: [] };
    }

    const sources = groundingMetadata.groundingChunks.map((chunk: any) => ({
      title: chunk.web?.title || "출처",
      url: chunk.web?.uri || "",
      snippet: chunk.web?.snippet || ""
    })).filter((s: any) => s.url);

    console.log(`[✅ SEARCH] Found ${sources.length}개 출처 in ${totalTime}ms`);
    
    return { success: true, sources };
  } catch (error: any) {
    console.error("[❌ SEARCH ERROR]", error);
    return { 
      success: false, 
      sources: [], 
      error: error?.message || "Search failed" 
    };
  }
}

/**
 * Gemini API를 사용하여 채팅 응답 생성 (재시도 로직 포함)
 */
export async function generateGeminiChatResponse(
  systemPrompt: string,
  messages: GeminiChatMessage[],
  options: GeminiChatOptions = {}
): Promise<GeminiChatResponse> {
  return executeWithRetries(() => 
    _generateGeminiChatResponseInternal(systemPrompt, messages, options)
  );
}

/**
 * Gemini API를 사용하여 에이전트 응답 생성 (OpenAI generateChatResponse와 유사한 인터페이스)
 */
export async function generateGeminiResponse(
  userMessage: string,
  agentName: string,
  agentDescription: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  speechStyle: string,
  personality: string,
  additionalPrompt: string,
  model: string = "gemini-2.0-flash",
  maxTokens: number = 4096
): Promise<{ message: string; usedDocuments?: any[]; sources?: { chunks: Array<{ title: string; url: string }>; supports: Array<{ startIndex: number; endIndex: number; text: string; chunkIndices: number[] }> } }> {
  // 🎯 additionalPrompt가 비어있으면 간단한 템플릿 사용
  // 아니면 additionalPrompt를 전체 시스템 프롬프트로 사용 (Non-Negotiable Tone Rules 포함)
  let systemPrompt: string;
  
  if (additionalPrompt && additionalPrompt.trim().length > 0) {
    // ✅ enhancedProfessionalPrompt가 전달된 경우 - 완전한 프롬프트 사용
    // (Non-Negotiable Tone Rules, Canon, Style, Relation 모두 포함)
    systemPrompt = additionalPrompt;
    console.log(`[🎯 Gemini Prompt] ${agentName}: 완전한 프롬프트 사용 (${additionalPrompt.length}자)`);
    console.log(`[🎯 Gemini Prompt Preview] ${systemPrompt.slice(0, 500)}...`);
  } else {
    // ❌ 폴백: 간단한 템플릿 사용 (레거시)
    systemPrompt = `You are ${agentName}. ${agentDescription}

Speech Style: ${speechStyle}
Personality: ${personality}`;
    console.log(`[⚠️ Gemini Prompt] ${agentName}: 폴백 템플릿 사용 (additionalPrompt 없음)`);
  }

  // 대화 히스토리를 Gemini 형식으로 변환
  const geminiMessages: GeminiChatMessage[] = conversationHistory.map(msg => ({
    role: msg.role === "user" ? "user" : "model",
    parts: msg.content
  }));

  // 현재 사용자 메시지 추가
  geminiMessages.push({
    role: "user",
    parts: userMessage
  });

  // Gemini API 호출
  // 🎯 temperature/topP/topK는 기본값(0.5/0.75/20) 사용 - compliance-driven persona용
  const response = await generateGeminiChatResponse(
    systemPrompt,
    geminiMessages,
    {
      model,
      maxOutputTokens: maxTokens,
      // temperature 1.0 제거 - 기본값 0.5 사용
    }
  );

  // 🧹 리듬태그 제거 (사용자에게 보이지 않도록) - OpenAI와 동일
  const { removeRhythmTags } = await import('./openai');
  const cleanedMessage = removeRhythmTags(response.text);

  return {
    message: cleanedMessage,
    usedDocuments: [],
    sources: response.sources
  };
}

/**
 * Gemini API를 사용하여 스트리밍 응답 생성 (재시도 로직 포함)
 */
export async function* generateGeminiChatResponseStream(
  systemPrompt: string,
  messages: GeminiChatMessage[],
  options: GeminiChatOptions = {}
): AsyncGenerator<string, void, unknown> {
  const {
    model = "gemini-2.0-flash-lite",
    // 🌡️ 사실 기반 응답을 위한 낮은 temperature 설정
    // 학습된 구체적 정보 인용을 우선시 (창의적 재구성 억제)
    temperature = 0.35,  // 사실 회상 최적화 (0.3~0.4 범위)
    maxOutputTokens = 4096,
    topP = 0.6,          // 결정론적 출력 편향 (인용문 우선)
    topK = 40,
  } = options;

  // 스트림 생성 부분에만 재시도 로직 적용 (chunk yield 전)
  const streamResult = await executeWithRetries(async () => {
    const geminiModel = genAI.getGenerativeModel({
      model,
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature,
        maxOutputTokens,
        topP,
        topK,
      },
      safetySettings,
    });

    // 🔄 대화 컨텍스트를 contents 배열로 변환 (generateContentStream 형식)
    const contents: any[] = [];
    
    // 히스토리 메시지 추가
    for (const msg of messages.slice(0, -1)) {
      contents.push({
        role: msg.role,
        parts: [{ text: msg.parts }]
      });
    }
    
    // 마지막 메시지 추가
    const lastMessage = messages[messages.length - 1];
    contents.push({
      role: lastMessage.role,
      parts: [{ text: lastMessage.parts }]
    });

    // Gemini API 요구사항: contents는 "user"로 시작해야 함
    while (contents.length > 0 && contents[0].role === "model") {
      contents.shift();
    }

    // ✅ generateContentStream 사용 (chat.sendMessageStream 대신)
    return await geminiModel.generateContentStream({ contents });
  });
  
  // 스트림이 성공적으로 생성되면 chunk들을 yield (재시도 없음)
  for await (const chunk of streamResult.stream) {
    const text = chunk.text();
    if (text) {
      yield text;
    }
  }
}

/**
 * Gemini API를 사용하여 임베딩 생성
 */
export async function generateGeminiEmbedding(text: string): Promise<number[]> {
  try {
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    
    const result = await model.embedContent(text);
    const embedding = result.embedding;
    
    return embedding.values;
  } catch (error: any) {
    console.error("[Gemini Embedding Error]", error);
    throw new Error(`Gemini embedding error: ${error.message || "Unknown error"}`);
  }
}

/**
 * Gemini 클라이언트 확인 (API 키 유효성 검증)
 */
export async function validateGeminiApiKey(): Promise<boolean> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[Gemini] API key not found in environment variables");
      return false;
    }

    // 간단한 테스트 요청으로 API 키 유효성 확인
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
    const result = await model.generateContent("Hello");
    const response = result.response;
    
    return !!response.text();
  } catch (error: any) {
    console.error("[Gemini] API key validation failed:", error.message);
    return false;
  }
}

/**
 * Gemini를 사용한 구조화된 응답 생성 (JSON 출력)
 */
export async function generateGeminiStructuredResponse<T>(
  systemPrompt: string,
  userPrompt: string,
  options: GeminiChatOptions = {}
): Promise<T> {
  const {
    model = "gemini-2.0-flash-lite",
    temperature = 0.1,
    maxOutputTokens = 2048,
  } = options;

  try {
    const geminiModel = genAI.getGenerativeModel({
      model,
      systemInstruction: systemPrompt + "\n\nYou must respond with valid JSON only. Do not include any other text.",
      generationConfig: {
        temperature,
        maxOutputTokens,
        responseMimeType: "application/json",
      },
      safetySettings,
    });

    const result = await geminiModel.generateContent(userPrompt);
    const response = result.response;
    const text = response.text();

    // JSON 파싱
    const parsedData = JSON.parse(text);
    return parsedData as T;
  } catch (error: any) {
    console.error("[Gemini Structured Response Error]", error);
    throw new Error(`Gemini structured response error: ${error.message || "Unknown error"}`);
  }
}

/**
 * 🎯 Knowledge Router - 검색 전략 판단
 * 3단 폭포수(Waterfall) 시스템의 첫 단계: 질문을 분석하여 검색 전략 결정
 * @returns "internal" | "rag" | "web"
 */
export async function determineSearchStrategy(
  userQuery: string,
  agentName: string,
  agentDescription: string
): Promise<"internal" | "rag" | "web"> {
  const systemPrompt = `You are a search strategy analyzer. Your job is to determine the best information retrieval strategy for answering user questions.`;

  const userPrompt = `Analyze this query and determine the best strategy:

**User Query:** "${userQuery}"

**Agent Context:** 
- Name: ${agentName}
- Description: ${agentDescription}

**Strategy Options:**
1. "internal": LLM의 기본 지식으로 답변 가능한 경우 (검색 불필요)
   - 일반적인 인사, 철학적 질문, 상식적 질문
   - 해당 인물에 대한 널리 알려진 기본 정보
   Examples: "안녕하세요", "당신은 누구인가요?", "당신의 직업은?"

2. "rag": 특정 과거 사건, 발언, 문서화된 정보가 필요한 경우
   - 과거 논란, 스캔들, 사건에 대한 질문 (이미 보도된 것)
   - 구체적인 발언, 경력, 이력
   Examples: "명품백 수수 사건은?", "과거 발언에 대해", "경력 이력"

3. "web": **오직 실시간/최신 정보**가 필요한 경우만
   - 지난 24시간 이내 뉴스
   - "오늘", "방금", "최신" 같은 실시간 표현
   Examples: "오늘 무슨 일이?", "방금 나온 뉴스는?", "현재 상황은?"

**우선순위 (중요!):**
1. 대부분의 질문 → "internal" (LLM이 이미 알고 있음)
2. 특정 사건/문서 필요 → "rag" (DB 검색)
3. 실시간 정보만 → "web" (최후의 수단, 비용 높음)

**핵심 규칙:**
- 논란, 스캔들, 과거 사건 → "rag" (이미 보도되어 DB에 있을 가능성 높음)
- "오늘", "방금", "최신", "현재" 같은 실시간 키워드 → "web"
- 확실하지 않으면 → "internal" 우선 (LLM이 실패하면 자동으로 rag로 fallback)

Output JSON format:
{
  "strategy": "internal" | "rag" | "web",
  "reason": "brief explanation in Korean"
}`;

  try {
    const result = await generateGeminiStructuredResponse<{
      strategy: "internal" | "rag" | "web";
      reason: string;
    }>(systemPrompt, userPrompt, {
      model: "gemini-2.0-flash-lite",
      temperature: 0.1,
    });

    console.log(`[🎯 Knowledge Router] ${agentName}: ${userQuery.slice(0, 50)}... → Strategy: ${result.strategy} (${result.reason})`);
    
    return result.strategy;
  } catch (error: any) {
    console.error("[Knowledge Router Error]", error);
    // Fallback: 에러 시 RAG 전략 사용 (안전한 기본값)
    console.log(`[🎯 Knowledge Router] Error occurred, defaulting to "rag" strategy`);
    return "rag";
  }
}

/**
 * 🚫 자연스러운 거절 메시지 생성
 * 캐릭터의 말투와 페르소나를 유지하면서 전문 영역 외 질문을 거절
 */
export async function generateNaturalRefusal(
  agentName: string,
  agentDescription: string,
  agentKnowledgeDomain: string,
  userQuestion: string,
  userLanguage: string = 'ko'
): Promise<string> {
  const systemPrompt = `당신은 캐릭터 "${agentName}"의 자연스러운 거절 메시지를 생성하는 AI입니다.

캐릭터 정보:
- 이름: ${agentName}
- 설명: ${agentDescription}
- 전문 영역: ${agentKnowledgeDomain}

사용자 질문: "${userQuestion}"

**작업:** 이 질문은 캐릭터의 전문 영역("${agentKnowledgeDomain}") 밖입니다. 캐릭터의 말투와 성격을 유지하면서 자연스럽게 거절하는 메시지를 생성하세요.

**거절 메시지 가이드라인:**
1. 캐릭터의 말투, 성격, 어조를 유지
2. 전문 영역이 아니라는 점을 자연스럽게 전달
3. 너무 형식적이지 않고, 캐릭터답게 표현
4. 1-2문장으로 간결하게
5. 언어: ${userLanguage === 'ko' ? '한국어' : 'English'}

**좋은 예시:**
- "그 부분은 제가 잘 모르는 영역이라서요. 저는 ${agentKnowledgeDomain}에 대해서만 제대로 이야기할 수 있어요."
- "죄송하지만 그건 제 전문 분야가 아니네요. 저는 ${agentKnowledgeDomain} 쪽으로 더 잘 답변드릴 수 있습니다."

**나쁜 예시:**
- "I cannot answer that question." (너무 formal)
- "죄송합니다. 답변드릴 수 없습니다." (캐릭터 말투 없음)

거절 메시지만 출력하세요 (다른 설명 없이):`;

  try {
    const result = await model.generateContent(systemPrompt);
    const refusalMessage = result.response?.text()?.trim() || '';
    
    console.log(`[🚫 자연스러운 거절] ${agentName}: "${refusalMessage}"`);
    return refusalMessage;
  } catch (error) {
    console.error(`[❌ Refusal Generation Error]`, error);
    // Fallback: 기본 거절 메시지
    return userLanguage === 'ko'
      ? `죄송하지만 그 부분은 제 전문 분야가 아니라서 정확히 말씀드리기 어렵네요. 저는 ${agentKnowledgeDomain}에 대해서만 이야기할 수 있습니다.`
      : `I'm sorry, but that's not my area of expertise. I can only discuss ${agentKnowledgeDomain}.`;
  }
}
