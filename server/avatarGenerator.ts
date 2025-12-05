import { GoogleAuth } from "google-auth-library";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import type { InsertCharacterAvatar, AvatarEmotionType } from "@shared/schema";

// Gemini 클라이언트 (이름 번역 및 외모 묘사용)
const geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// 외모 묘사 캐시 (동일 캐릭터 재요청 방지)
const physicalDescriptionCache = new Map<string, string>();

// Vertex AI Imagen 3 클라이언트 설정
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || "";
const GCP_LOCATION = process.env.GCP_LOCATION || "us-central1";
const IMAGEN_MODEL = "imagen-3.0-generate-001";

// 서비스 계정 인증을 위한 GoogleAuth 클라이언트
let googleAuthClient: GoogleAuth | null = null;

function initGoogleAuth(): GoogleAuth {
  if (googleAuthClient) return googleAuthClient;
  
  const serviceAccountKey = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error("GCP_SERVICE_ACCOUNT_KEY environment variable is not set");
  }
  
  try {
    const credentials = JSON.parse(serviceAccountKey);
    
    // 디버그: 자격 증명 확인
    console.log("[🎨 Imagen 3] 자격 증명 파싱 성공:");
    console.log(`  - project_id: ${credentials.project_id}`);
    console.log(`  - client_email: ${credentials.client_email}`);
    console.log(`  - private_key 존재: ${!!credentials.private_key}`);
    console.log(`  - private_key 길이: ${credentials.private_key?.length || 0}`);
    console.log(`  - private_key 시작: ${credentials.private_key?.substring(0, 50)}...`);
    
    googleAuthClient = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    console.log("[🎨 Imagen 3] Google Auth 클라이언트 초기화 완료");
    return googleAuthClient;
  } catch (error) {
    console.error("[🎨 Imagen 3] JSON 파싱 오류:", error);
    throw new Error(`Failed to parse GCP_SERVICE_ACCOUNT_KEY: ${(error as Error).message}`);
  }
}

// OpenAI DALL-E 3 클라이언트 (Imagen 3 폴백용)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ""
});

// 이미지 생성 제공자 타입
type ImageProvider = "imagen" | "dalle";

// 현재 사용할 제공자 (할당량 초과 시 자동 전환)
let currentProvider: ImageProvider = "imagen";

// 캐릭터 이름 정규화 (직함/괄호/접미사 제거하여 핵심 이름만 추출)
export function normalizeCharacterName(name: string): string {
  // 괄호 및 괄호 안 내용 제거
  let normalized = name.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, '').trim();
  
  // 1단계: 복합 직함 구문 먼저 제거 (순서 중요: 긴 것부터)
  const multiWordPhrases = [
    '전 대통령', '현 대통령', '대통령 후보', '전직 대통령',
    '국민의힘 대표', '더불어민주당 대표', '민주당 대표',
    '전 총리', '전 장관', '전 의원', '전 검찰총장',
    'Former President', 'Vice President', 'Prime Minister'
  ];
  
  for (const phrase of multiWordPhrases) {
    normalized = normalized.replace(new RegExp(phrase, 'gi'), '').trim();
  }
  
  // 2단계: 단일 직함 토큰 제거
  const koreanTitles = [
    '대통령', '대통령실', '여사', '의장', '국회의장', '대표', '총리', '장관',
    '위원장', '비서실장', '수석', '차관', '검사', '판사', '변호사', '교수', '박사',
    '의원', '시장', '도지사', '군수', '구청장', '회장', '사장', '이사장', '원장',
    '대사', '총장', '청장', '처장', '실장', '팀장', '부장', '과장', '계장',
    '더불어민주당', '국민의힘', '민주당', '한나라당', '새누리당', '자유한국당',
    '관계자', '측근', '참모', '보좌관', '전'
  ];
  
  const englishTitles = [
    'President', 'Former', 'Vice', 'Prime', 'Minister',
    'Senator', 'Congressman', 'Governor', 'Mayor', 'CEO', 'Chairman',
    'Dr', 'Prof', 'Mr', 'Mrs', 'Ms', 'Sir', 'Lady'
  ];
  
  const tokens = normalized.split(/\s+/);
  const filteredTokens = tokens.filter(token => {
    const cleanToken = token.replace(/[.,]/g, '');
    return !koreanTitles.includes(cleanToken) && 
           !englishTitles.some(t => t.toLowerCase() === cleanToken.toLowerCase());
  });
  
  normalized = filteredTokens.join(' ').trim();
  
  // 여러 공백을 하나로
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  // 빈 결과면 원래 이름에서 첫 번째 의미있는 부분 추출
  if (!normalized) {
    normalized = name.split(/[\s\(\[]/)[0].trim();
  }
  
  console.log(`[🎭 이름 정규화] "${name}" → "${normalized}"`);
  return normalized;
}

// 16가지 감정 순서 (4x4 그리드 배치)
const EMOTION_ORDER: AvatarEmotionType[] = [
  "neutral",      // Row 0, Col 0 - 기본
  "happy",        // Row 0, Col 1 - 기쁨
  "sad",          // Row 0, Col 2 - 슬픔
  "angry",        // Row 0, Col 3 - 화남
  "determined",   // Row 1, Col 0 - 단호
  "worried",      // Row 1, Col 1 - 고민
  "thinking",     // Row 1, Col 2 - 생각중
  "questioning",  // Row 1, Col 3 - 물음
  "listening",    // Row 2, Col 0 - 경청
  "surprised",    // Row 2, Col 1 - 놀람
  "shocked",      // Row 2, Col 2 - 충격
  "embarrassed",  // Row 2, Col 3 - 부끄러움
  "flustered",    // Row 3, Col 0 - 당황
  "confident",    // Row 3, Col 1 - 자신감
  "arrogant",     // Row 3, Col 2 - 거만
  "tired"         // Row 3, Col 3 - 피곤
];

const AVATAR_SIZE = 128; // 최종 아바타 크기

// 플랫 벡터 일러스트 스타일 (풍자 캐리커쳐)
const VECTOR_ILLUSTRATION_STYLE = `Flat vector illustration style, minimalist design, thick clean black outlines, satirical caricature style, bold solid colors, minimal shading, simple but expressive cartoon face, exaggerated distinctive features for instant recognition, clean geometric shapes.`;

// 한글 이름을 영어로 번역 (유명인/공인 인식용)
async function translateNameToEnglish(koreanName: string): Promise<string> {
  // 이미 영어인 경우 그대로 반환
  if (/^[a-zA-Z\s\-\.]+$/.test(koreanName.trim())) {
    return koreanName;
  }

  try {
    const response = await geminiClient.models.generateContent({
      model: "gemini-2.0-flash-lite",
      contents: `Translate this Korean name to English. If it's a famous person, politician, celebrity, or public figure, provide their commonly known English name. Only respond with the English name, nothing else.

Korean name: ${koreanName}

English name:`,
    });

    const englishName = response.text?.trim();
    if (englishName && englishName.length > 0) {
      console.log(`[🎨 이름 번역] ${koreanName} → ${englishName}`);
      return englishName;
    }
  } catch (error) {
    console.error(`[🎨 이름 번역] 실패:`, error);
  }

  // 번역 실패 시 원본 반환
  return koreanName;
}

// 레고 미니피규어 특징 구조화된 데이터
interface LegoCharacterFeatures {
  genderAge: string;        // 성별/연령대: "a middle-aged male figure"
  facialFeatures: string;   // 얼굴 특징: "black rectangular framed glasses"
  defaultExpression: string; // 기본 표정: "a confident printed smile"
  hairColor: string;        // 머리 색상: "dark brown"
  hairStyle: string;        // 머리 스타일: "neat, short side-parted hair"
  outfit: string;           // 의상: "a dark charcoal suit printed over a light blue shirt with a dark navy tie"
}

// 인물의 레고 스타일 특징 묘사 생성 (이름 절대 사용 금지) - 구조화된 JSON 형식
async function generatePhysicalDescription(personName: string): Promise<string> {
  // 정규화된 이름으로 캐시 키 생성
  const normalizedName = normalizeCharacterName(personName);
  const cacheKey = normalizedName.toLowerCase().trim();
  
  // 캐시에 있으면 재사용
  if (physicalDescriptionCache.has(cacheKey)) {
    console.log(`[🧱 레고 분석] ${personName} 캐시 사용`);
    return physicalDescriptionCache.get(cacheKey)!;
  }
  
  try {
    console.log(`[🧱 레고 분석] ${personName} 특징 분석 중...`);
    
    const response = await geminiClient.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `You are an expert at creating LEGO minifigure character descriptions.

Given this person's name, analyze their distinctive features for a classic LEGO minifigure WITHOUT EVER using their name.

Person: ${personName}

Respond in JSON format with these exact fields:
{
  "genderAge": "gender and age description (e.g., 'a middle-aged male figure', 'a young female figure', 'an elderly male figure')",
  "facialFeatures": "distinctive facial features for LEGO printed face (e.g., 'black rectangular framed glasses', 'thick blonde eyebrows', 'a distinct printed mustache')",
  "defaultExpression": "default expression style (e.g., 'a slight, confident printed smile', 'a neutral stern mouth line', 'a gentle printed smile')",
  "hairColor": "hair color for LEGO hair piece (e.g., 'dark brown', 'bright blonde', 'silver grey')",
  "hairStyle": "hair style description (e.g., 'neat, short side-parted hair', 'voluminous swept-back hair with volume', 'a chin-length bob cut')",
  "outfit": "outfit description for LEGO torso print (e.g., 'a dark charcoal suit printed over a light blue shirt with a dark navy tie', 'a tailored blue jacket printed over a white top')"
}

RULES:
- NEVER mention the person's name anywhere
- Focus on what makes them INSTANTLY recognizable as a LEGO minifigure
- Be specific about colors (dark brown, bright blonde, navy blue, etc.)
- Think like a LEGO designer creating an official minifigure
- Use "printed" for face/torso details (LEGO style)

Respond ONLY with valid JSON, no other text:`,
    });

    const responseText = response.text?.trim();
    if (responseText) {
      // JSON 파싱 시도
      try {
        // JSON 블록 추출 (```json ... ``` 형식 처리)
        let jsonStr = responseText;
        const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          jsonStr = jsonMatch[1].trim();
        }
        
        const features: LegoCharacterFeatures = JSON.parse(jsonStr);
        
        // 구조화된 데이터를 새 템플릿 형식의 문자열로 변환
        const structuredDescription = JSON.stringify(features);
        
        console.log(`[🧱 레고 분석] ${personName} 완료:`, features);
        // 캐시에 저장
        physicalDescriptionCache.set(cacheKey, structuredDescription);
        return structuredDescription;
      } catch (parseError) {
        console.log(`[🧱 레고 분석] JSON 파싱 실패, 원본 텍스트 사용`);
        // JSON 파싱 실패 시 기존 방식의 텍스트 묘사로 폴백
        if (responseText.length > 30) {
          physicalDescriptionCache.set(cacheKey, responseText);
          return responseText;
        }
      }
    }
  } catch (error) {
    console.error(`[🧱 레고 분석] ${personName} 실패:`, error);
  }

  // 실패 시 기본 묘사 반환 (캐시하지 않음)
  const fallbackFeatures: LegoCharacterFeatures = {
    genderAge: "a professional figure",
    facialFeatures: "simple printed features",
    defaultExpression: "a neutral printed expression",
    hairColor: "dark brown",
    hairStyle: "neat short hair",
    outfit: "a dark suit printed over a white shirt with a tie"
  };
  return JSON.stringify(fallbackFeatures);
}

// 16가지 감정별 표정 설명 (상세하고 과장된)
const EMOTION_DESCRIPTIONS: Record<AvatarEmotionType, { en: string; ko: string }> = {
  neutral: { 
    en: "calm neutral expression with relaxed features, composed and professional demeanor",
    ko: "기본"
  },
  happy: { 
    en: "extremely wide bright smile showing oversized prominent teeth and gums, eyes narrowed and crinkled with joy, radiating pure happiness",
    ko: "기쁨"
  },
  sad: { 
    en: "deeply downturned mouth, droopy eyelids, tear-filled glistening eyes, melancholic expression with furrowed brow",
    ko: "슬픔"
  },
  angry: { 
    en: "furiously furrowed brows, flared nostrils, gritted teeth showing, veins visible on forehead, intense rage",
    ko: "화남"
  },
  determined: { 
    en: "firmly set jaw, steely focused gaze, slightly narrowed eyes, resolute unwavering expression",
    ko: "단호"
  },
  worried: { 
    en: "raised eyebrows in concern, biting lower lip, anxious troubled expression with wrinkled forehead",
    ko: "고민"
  },
  thinking: { 
    en: "hand on chin, looking upward, furrowed brow in concentration, contemplative thoughtful pose",
    ko: "생각중"
  },
  questioning: { 
    en: "one eyebrow raised high, head tilted, puzzled curious expression, slight smirk of doubt",
    ko: "물음"
  },
  listening: { 
    en: "head slightly tilted, attentive alert eyes, focused engaged expression, leaning forward slightly",
    ko: "경청"
  },
  surprised: { 
    en: "extremely wide open eyes, raised eyebrows high, open mouth in O shape, astonished look",
    ko: "놀람"
  },
  shocked: { 
    en: "jaw dropped dramatically, eyes bulging out, hands near face, absolute stunned disbelief",
    ko: "충격"
  },
  embarrassed: { 
    en: "blushing red cheeks, avoiding eye contact looking down, sheepish shy smile, hand near face",
    ko: "부끄러움"
  },
  flustered: { 
    en: "wide panicked eyes, sweating drops, confused scattered expression, awkward forced smile",
    ko: "당황"
  },
  confident: { 
    en: "chin up proudly, knowing smirk, relaxed assured posture, self-assured gleaming eyes",
    ko: "자신감"
  },
  arrogant: { 
    en: "nose turned up snobbishly, condescending sneer, half-closed dismissive eyes, superior attitude",
    ko: "거만"
  },
  tired: { 
    en: "heavy droopy eyelids, dark circles under eyes, yawning or slack jaw, exhausted drained look",
    ko: "피곤"
  }
};

export interface CharacterConfig {
  characterId: string;
  characterName: string;
  rowIndex: number;
}

export interface SpriteSheetGenerationRequest {
  agentId?: number;
  groupChatId?: number;
  characters: CharacterConfig[];
  customPromptStyle?: string;
}

export interface SpriteSheetGenerationResult {
  success: boolean;
  spriteSheetUrl?: string;
  avatars?: Array<{
    characterId: string;
    characterName: string;
    emotions: Record<AvatarEmotionType, string>;
  }>;
  error?: string;
}

// Vertex AI Imagen 3 API 호출 함수
async function generateImageWithImagen3(prompt: string): Promise<Buffer | null> {
  try {
    const auth = initGoogleAuth();
    console.log("[🎨 Imagen 3] 클라이언트 가져오는 중...");
    const client = await auth.getClient();
    console.log("[🎨 Imagen 3] 클라이언트 타입:", client.constructor.name);
    
    // JWT 클라이언트에서 명시적으로 액세스 토큰 가져오기
    console.log("[🎨 Imagen 3] 액세스 토큰 가져오는 중...");
    const accessToken = await client.getAccessToken();
    const token = typeof accessToken === 'string' ? accessToken : accessToken?.token;
    
    console.log("[🎨 Imagen 3] 액세스 토큰 존재:", !!token);
    console.log("[🎨 Imagen 3] 액세스 토큰 시작:", token?.substring(0, 30) + "...");
    
    if (!token) {
      console.error("[🎨 Imagen 3] 액세스 토큰을 가져올 수 없습니다");
      return null;
    }
    
    const endpoint = `https://${GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/${IMAGEN_MODEL}:predict`;
    
    console.log(`[🎨 Imagen 3] API 호출 시작: ${GCP_LOCATION}/${IMAGEN_MODEL}`);
    console.log(`[🎨 Imagen 3] Endpoint: ${endpoint}`);
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: "1:1",
        },
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[🎨 Imagen 3] API 오류 (${response.status}):`, errorText);
      
      if (response.status === 429 || errorText.includes("RESOURCE_EXHAUSTED")) {
        console.log("[🎨 Imagen 3] 할당량 초과 - DALL-E로 폴백");
        currentProvider = "dalle";
      }
      return null;
    }
    
    const data = await response.json();
    const predictions = data.predictions;
    if (!predictions || predictions.length === 0) {
      console.error("[🎨 Imagen 3] 응답에 이미지 없음");
      return null;
    }
    
    const base64Image = predictions[0].bytesBase64Encoded;
    if (!base64Image) {
      console.error("[🎨 Imagen 3] base64 이미지 데이터 없음");
      return null;
    }
    
    console.log("[🎨 Imagen 3] 이미지 생성 완료");
    return Buffer.from(base64Image, "base64");
    
  } catch (error) {
    console.error("[🎨 Imagen 3] 오류:", error);
    return null;
  }
}

// 레고 표정 설명 (printed 스타일) - 감정별로 다른 표현
const LEGO_EXPRESSION_DESCRIPTIONS: Record<AvatarEmotionType, string> = {
  neutral: "a calm, neutral printed expression",
  happy: "a wide, joyful printed smile with curved happy eyes",
  sad: "a downturned printed mouth with droopy sad eyes",
  angry: "furrowed printed eyebrows with a stern frowning mouth",
  determined: "a firm, resolute printed expression with focused eyes",
  worried: "raised printed eyebrows with a concerned mouth line",
  thinking: "a thoughtful printed expression, eyes looking upward",
  questioning: "one raised printed eyebrow with a curious expression",
  listening: "an attentive printed expression with alert eyes",
  surprised: "wide open printed eyes with an O-shaped mouth",
  shocked: "extremely wide printed eyes with dropped jaw",
  embarrassed: "printed blush marks on cheeks with a shy smile",
  flustered: "printed sweat drops with a nervous expression",
  confident: "a self-assured printed smirk with proud eyes",
  arrogant: "a condescending printed sneer with half-closed eyes",
  tired: "droopy printed eyelids with a yawning mouth"
};

// 단일 감정 프롬프트 생성 (캐릭터 1명, 감정 1개) - 새 구조화된 템플릿
// 외모 묘사 기반 프롬프트 생성 (이름 대신 특징 사용)
function buildSingleEmotionPromptWithDescription(physicalDescription: string, emotion: AvatarEmotionType, customStyle?: string): string {
  // 레고 스타일 표정 설명
  const expressionDesc = LEGO_EXPRESSION_DESCRIPTIONS[emotion];
  
  // JSON 형식인지 확인하고 파싱
  let features: LegoCharacterFeatures;
  try {
    features = JSON.parse(physicalDescription);
  } catch {
    // JSON이 아닌 경우 기존 텍스트 묘사 방식으로 폴백
    return buildLegacyPrompt(physicalDescription, emotion);
  }
  
  // 새 구조화된 템플릿 사용
  return `A clean, studio photograph of a standard LEGO minifigure representing ${features.genderAge}.

The visual style must be strictly identical to the classic minifigure appearance.

**Key Features:**
* **Head:** Standard yellow cylindrical LEGO head.
* **Face:** Simple printed face featuring standard black dot eyes and ${features.facialFeatures}. The expression is ${expressionDesc}.
* **Hair:** A standard LEGO hair piece in ${features.hairColor} color, styled as ${features.hairStyle}.
* **Torso & Legs:** Standard LEGO torso and legs wearing ${features.outfit}.

**Environment:** Plain, smooth plastic texture. Neutral, simple studio background with even lighting, like an ID photo.`;
}

// 기존 텍스트 묘사 방식 폴백 함수
function buildLegacyPrompt(physicalDescription: string, emotion: AvatarEmotionType): string {
  const emotionDesc = EMOTION_DESCRIPTIONS[emotion].en;
  
  return `A clean, studio photograph of a standard LEGO minifigure.

The visual style must be strictly identical to the classic minifigure appearance.

**Character:** ${physicalDescription}

**Key Features:**
* **Head:** Standard yellow cylindrical LEGO head.
* **Face:** Simple printed face featuring standard black dot eyes. The expression is ${emotionDesc}.
* **Hair:** A standard LEGO hair piece matching the character description.
* **Torso & Legs:** Standard LEGO torso and legs matching the character outfit.

**Environment:** Plain, smooth plastic texture. Neutral, simple studio background with even lighting, like an ID photo.`;
}

// 이름 기반 프롬프트 생성 (폴백용) - 새 구조화된 템플릿
function buildSingleEmotionPrompt(characterName: string, emotion: AvatarEmotionType, customStyle?: string): string {
  const expressionDesc = LEGO_EXPRESSION_DESCRIPTIONS[emotion];
  
  return `A clean, studio photograph of a standard LEGO minifigure representing a professional figure.

The visual style must be strictly identical to the classic minifigure appearance.

**Key Features:**
* **Head:** Standard yellow cylindrical LEGO head.
* **Face:** Simple printed face featuring standard black dot eyes. The expression is ${expressionDesc}.
* **Hair:** A standard LEGO hair piece in dark brown color, styled as neat short hair.
* **Torso & Legs:** Standard LEGO torso and legs wearing a dark suit printed over a white shirt with a tie.

**Environment:** Plain, smooth plastic texture. Neutral, simple studio background with even lighting, like an ID photo.`;
}

// 핵심 감정 4개 (비용 최적화용 - 다른 감정은 neutral 재사용)
const CORE_EMOTIONS: AvatarEmotionType[] = ["neutral", "happy", "angry", "thinking"];

// 우선순위 감정 12개 (중요도 순) - 레고 스타일용
const PRIORITY_EMOTIONS: AvatarEmotionType[] = [
  "neutral", "happy", "angry", "thinking", 
  "sad", "surprised", "confident", "worried",
  "listening", "questioning", "determined", "embarrassed"
];

// 4x4 그리드 16감정 프롬프트 생성 (캐릭터 1명) - 외모 묘사 기반 (이름 없음)
function build4x4GridPromptWithDescription(physicalDescription: string, customStyle?: string): string {
  const style = customStyle || VECTOR_ILLUSTRATION_STYLE;

  return `CHARACTER EXPRESSION REFERENCE SHEET - 4x4 TILED GRID LAYOUT

⚠️ CRITICAL: This is a TILED GRID IMAGE, NOT a single portrait!
Create exactly 16 SEPARATE small character icons arranged in a 4×4 uniform grid.

GRID STRUCTURE (4 columns × 4 rows = 16 tiles):
┌─────────┬─────────┬─────────┬─────────┐
│ Neutral │  Happy  │   Sad   │  Angry  │
├─────────┼─────────┼─────────┼─────────┤
│Determined│ Worried │Thinking │Questioning│
├─────────┼─────────┼─────────┼─────────┤
│Listening│Surprised│ Shocked │Embarrassed│
├─────────┼─────────┼─────────┼─────────┤
│Flustered│Confident│ Arrogant│  Tired  │
└─────────┴─────────┴─────────┴─────────┘

CHARACTER APPEARANCE (same in ALL 16 tiles):
${physicalDescription}

MANDATORY REQUIREMENTS:
1. EXACTLY 16 separate small squares/tiles in a 4×4 grid
2. Each tile shows ONE complete head+shoulders portrait
3. Each tile has PLAIN WHITE or LIGHT GRAY background
4. The SAME character appears in every tile (identical hair, face shape, clothing)
5. ONLY the facial expression changes between tiles
6. Tiles should be clearly separated (like a contact sheet or sprite sheet)
7. NO text, NO labels, NO borders between tiles

DO NOT:
- Create a single large portrait
- Show a full body shot
- Merge the tiles into one image
- Add any decorative elements

ART STYLE: ${style}

This is like creating a video game character emotion sprite sheet or emoji sticker pack - 16 small separate icons of the same person with different expressions, arranged in a grid.`;
}

// DALL-E 3로 4x4 그리드 생성 (외모 묘사 기반)
async function generate4x4GridWithDalle(physicalDescription: string, characterName: string, customStyle?: string): Promise<Buffer | null> {
  const prompt = build4x4GridPromptWithDescription(physicalDescription, customStyle);
  
  try {
    console.log(`[🎨 DALL-E] ${characterName} 16감정 4x4 그리드 생성 중...`);
    
    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      quality: "hd",
      response_format: "b64_json"
    });

    if (response.data?.[0]?.b64_json) {
      console.log(`[🎨 DALL-E] ${characterName} 16감정 그리드 생성 완료`);
      return Buffer.from(response.data[0].b64_json, "base64");
    }
    return null;
  } catch (error) {
    console.error(`[🎨 DALL-E] ${characterName} 그리드 생성 실패:`, error);
    return null;
  }
}

// Imagen 3로 4x4 그리드 생성 (외모 묘사 기반)
async function generate4x4GridWithImagen3(physicalDescription: string, characterName: string, customStyle?: string): Promise<Buffer | null> {
  const prompt = build4x4GridPromptWithDescription(physicalDescription, customStyle);
  
  console.log(`[🎨 Imagen 3] ${characterName} 16감정 4x4 그리드 생성 중...`);
  const result = await generateImageWithImagen3(prompt);
  
  if (result) {
    console.log(`[🎨 Imagen 3] ${characterName} 16감정 그리드 생성 완료`);
  }
  
  return result;
}

// 이미지가 실제 4x4 그리드인지 검증 (단일 초상화가 아닌지 확인)
// 강화된 검증: 에지 감지 + 셀 간 유사도 분석 + 그리드라인 검출
async function validateGridImage(imageBuffer: Buffer): Promise<{ isGrid: boolean; confidence: number; reason: string }> {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;
    const cellWidth = Math.floor(width / 4);
    const cellHeight = Math.floor(height / 4);
    
    // 1. 각 셀의 중앙 영역 샘플링 (16개 셀)
    const cellSamples: Buffer[] = [];
    const cellCentroids: { r: number; g: number; b: number }[] = [];
    
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        // 셀 중앙의 작은 영역 추출
        const sampleBuffer = await sharp(imageBuffer)
          .extract({
            left: col * cellWidth + Math.floor(cellWidth * 0.25),
            top: row * cellHeight + Math.floor(cellHeight * 0.25),
            width: Math.floor(cellWidth * 0.5),
            height: Math.floor(cellHeight * 0.5)
          })
          .resize(16, 16) // 16x16 샘플링
          .raw()
          .toBuffer();
        
        cellSamples.push(sampleBuffer);
        
        // 평균 색상 계산
        let rSum = 0, gSum = 0, bSum = 0;
        for (let i = 0; i < sampleBuffer.length; i += 3) {
          rSum += sampleBuffer[i];
          gSum += sampleBuffer[i + 1];
          bSum += sampleBuffer[i + 2];
        }
        const pixelCount = sampleBuffer.length / 3;
        cellCentroids.push({
          r: rSum / pixelCount,
          g: gSum / pixelCount,
          b: bSum / pixelCount
        });
      }
    }
    
    // 2. 그리드라인 검출 - 셀 경계 부근의 픽셀 밝기 변화 분석
    // 그리드라면 셀 경계에서 급격한 색상 변화가 있음
    let gridlineScore = 0;
    
    // 수직 그리드라인 검출 (3개 위치)
    for (let lineIdx = 1; lineIdx <= 3; lineIdx++) {
      const x = lineIdx * cellWidth;
      const lineBuffer = await sharp(imageBuffer)
        .extract({ left: Math.max(0, x - 2), top: 0, width: 4, height: height })
        .greyscale()
        .raw()
        .toBuffer();
      
      // 라인을 따라 픽셀 밝기의 표준편차 계산
      let sum = 0, sqSum = 0;
      for (let i = 0; i < lineBuffer.length; i++) {
        sum += lineBuffer[i];
        sqSum += lineBuffer[i] * lineBuffer[i];
      }
      const mean = sum / lineBuffer.length;
      const variance = (sqSum / lineBuffer.length) - (mean * mean);
      const stdDev = Math.sqrt(Math.max(0, variance));
      
      // 그리드라인이 있으면 표준편차가 높음 (밝은 배경과 그리드라인의 대비)
      if (stdDev > 30) gridlineScore++;
    }
    
    // 수평 그리드라인 검출 (3개 위치)
    for (let lineIdx = 1; lineIdx <= 3; lineIdx++) {
      const y = lineIdx * cellHeight;
      const lineBuffer = await sharp(imageBuffer)
        .extract({ left: 0, top: Math.max(0, y - 2), width: width, height: 4 })
        .greyscale()
        .raw()
        .toBuffer();
      
      let sum = 0, sqSum = 0;
      for (let i = 0; i < lineBuffer.length; i++) {
        sum += lineBuffer[i];
        sqSum += lineBuffer[i] * lineBuffer[i];
      }
      const mean = sum / lineBuffer.length;
      const variance = (sqSum / lineBuffer.length) - (mean * mean);
      const stdDev = Math.sqrt(Math.max(0, variance));
      
      if (stdDev > 30) gridlineScore++;
    }
    
    // 3. 셀 간 유사도 분석 - 그리드라면 모든 셀이 "얼굴"이므로 비슷한 구조를 가짐
    // 단일 초상화라면 상단 셀(머리)과 하단 셀(몸)이 매우 다름
    let crossCellSimilarity = 0;
    let comparisonCount = 0;
    
    // 대각선 셀 비교 (0,0 vs 3,3), (0,3 vs 3,0), etc.
    const diagonalPairs = [[0, 15], [3, 12], [5, 10], [6, 9]];
    for (const [a, b] of diagonalPairs) {
      const diff = Math.abs(cellCentroids[a].r - cellCentroids[b].r) +
                   Math.abs(cellCentroids[a].g - cellCentroids[b].g) +
                   Math.abs(cellCentroids[a].b - cellCentroids[b].b);
      if (diff < 100) crossCellSimilarity++;
      comparisonCount++;
    }
    
    // 4. 수직 연속성 분석 - 단일 초상화는 수직으로 연속적인 구조
    // 그리드는 각 행이 독립적
    let verticalContinuity = 0;
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 3; row++) {
        const idx1 = row * 4 + col;
        const idx2 = (row + 1) * 4 + col;
        const diff = Math.abs(cellCentroids[idx1].r - cellCentroids[idx2].r) +
                     Math.abs(cellCentroids[idx1].g - cellCentroids[idx2].g) +
                     Math.abs(cellCentroids[idx1].b - cellCentroids[idx2].b);
        if (diff < 50) verticalContinuity++;
      }
    }
    
    // 5. 배경 밝기 분석 - 그리드의 각 셀은 밝은 배경을 가져야 함
    let brightCellCount = 0;
    for (const centroid of cellCentroids) {
      const brightness = (centroid.r + centroid.g + centroid.b) / 3;
      if (brightness > 180) brightCellCount++;
    }
    
    // 종합 판정
    // - 그리드라인 점수: 6개 중 몇 개 감지 (높을수록 그리드)
    // - 대각선 유사도: 4개 중 몇 개 유사 (높을수록 그리드)
    // - 수직 연속성: 12개 중 몇 개 연속 (높을수록 단일 초상화)
    // - 밝은 셀: 16개 중 몇 개 (높을수록 그리드)
    
    const gridScore = (gridlineScore * 10) + (crossCellSimilarity * 15) + (brightCellCount * 3);
    const portraitScore = verticalContinuity * 8;
    
    const isLikelyGrid = gridScore > portraitScore + 20;
    const confidence = isLikelyGrid ? 
      Math.min(100, 50 + (gridScore - portraitScore) / 2) :
      Math.max(0, 50 - (portraitScore - gridScore) / 2);
    
    const details = `그리드라인=${gridlineScore}/6, 대각선유사=${crossCellSimilarity}/4, 수직연속=${verticalContinuity}/12, 밝은셀=${brightCellCount}/16`;
    console.log(`[🔍 그리드 검증] ${details}, 점수: 그리드${gridScore} vs 초상화${portraitScore}`);
    
    if (isLikelyGrid) {
      return { isGrid: true, confidence, reason: `그리드 확인 - ${details}` };
    } else {
      return { isGrid: false, confidence: 100 - confidence, reason: `단일 초상화 의심 - ${details}` };
    }
  } catch (error) {
    console.error("[🔍 그리드 검증] 오류:", error);
    return { isGrid: true, confidence: 50, reason: "검증 실패 - 기본 통과" };
  }
}

// 4x4 그리드 이미지를 16개 감정으로 슬라이싱
async function slice4x4GridToEmotions(
  imageBuffer: Buffer,
  uploadsDir: string,
  characterId: string
): Promise<Record<AvatarEmotionType, string>> {
  const emotions: Record<AvatarEmotionType, string> = {
    neutral: "", happy: "", sad: "", angry: "",
    determined: "", worried: "", thinking: "", questioning: "",
    listening: "", surprised: "", shocked: "", embarrassed: "",
    flustered: "", confident: "", arrogant: "", tired: ""
  };

  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;
  const cellWidth = Math.floor(width / 4);
  const cellHeight = Math.floor(height / 4);

  for (let i = 0; i < EMOTION_ORDER.length; i++) {
    const emotion = EMOTION_ORDER[i];
    const row = Math.floor(i / 4);
    const col = i % 4;
    
    try {
      const slicedBuffer = await sharp(imageBuffer)
        .extract({
          left: col * cellWidth,
          top: row * cellHeight,
          width: cellWidth,
          height: cellHeight
        })
        .resize(AVATAR_SIZE, AVATAR_SIZE)
        .png()
        .toBuffer();

      const filename = `${characterId}_${emotion}.png`;
      const filePath = path.join(uploadsDir, filename);
      await fs.promises.writeFile(filePath, slicedBuffer);
      
      emotions[emotion] = `/uploads/avatars/${path.basename(uploadsDir)}/${filename}`;
      console.log(`[🎨] ${characterId} ${emotion} 슬라이싱 완료`);
    } catch (err) {
      console.error(`[🎨] ${characterId} ${emotion} 슬라이싱 실패:`, err);
    }
  }

  return emotions;
}

// DALL-E 3로 단일 감정 이미지 생성
async function generateSingleEmotionWithDalle(characterName: string, emotion: AvatarEmotionType, customStyle?: string): Promise<Buffer | null> {
  const prompt = buildSingleEmotionPrompt(characterName, emotion, customStyle);
  
  try {
    console.log(`[🎨 DALL-E] ${characterName} ${emotion} 생성 중...`);
    
    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1024x1024",
      quality: "hd",
      response_format: "b64_json"
    });

    if (response.data?.[0]?.b64_json) {
      console.log(`[🎨 DALL-E] ${characterName} ${emotion} 생성 완료`);
      return Buffer.from(response.data[0].b64_json, "base64");
    }
    return null;
  } catch (error) {
    console.error(`[🎨 DALL-E] ${characterName} ${emotion} 생성 실패:`, error);
    return null;
  }
}

// Imagen 3로 단일 감정 이미지 생성
async function generateSingleEmotionWithImagen3(characterName: string, emotion: AvatarEmotionType, customStyle?: string): Promise<Buffer | null> {
  const prompt = buildSingleEmotionPrompt(characterName, emotion, customStyle);
  
  console.log(`[🎨 Imagen 3] ${characterName} ${emotion} 생성 중...`);
  const result = await generateImageWithImagen3(prompt);
  
  if (result) {
    console.log(`[🎨 Imagen 3] ${characterName} ${emotion} 생성 완료`);
  }
  
  return result;
}


// 캐릭터 1명의 16감정 아바타 생성 (개별 초상화 방식 - 인물 인식률 향상)
async function generateAllEmotionsForCharacter(
  characterName: string,
  characterId: string,
  customStyle: string | undefined,
  uploadsDir: string,
  provider: ImageProvider = "imagen"
): Promise<Record<AvatarEmotionType, string>> {
  // 빈 결과 템플릿
  const emptyResult: Record<AvatarEmotionType, string> = {
    neutral: "", happy: "", sad: "", angry: "",
    determined: "", worried: "", thinking: "", questioning: "",
    listening: "", surprised: "", shocked: "", embarrassed: "",
    flustered: "", confident: "", arrogant: "", tired: ""
  };
  
  console.log(`[🎨] ${characterName} 개별 초상화 방식으로 감정 아바타 생성 시작`);
  
  // 1단계: Gemini로 상세 외모 묘사 생성 (모든 감정에 동일하게 사용)
  console.log(`[🎨] ${characterName} 외모 묘사 생성 중...`);
  const physicalDescription = await generatePhysicalDescription(characterName);
  console.log(`[📝 외모 묘사] (${physicalDescription.length}자):\n${physicalDescription}`);
  
  const results: Record<AvatarEmotionType, string> = { ...emptyResult };
  
  // 생성할 감정 목록 - 우선순위 8개 생성 (비용과 품질의 균형)
  const emotionsToGenerate = PRIORITY_EMOTIONS; // neutral, happy, angry, thinking, sad, surprised, confident, worried
  
  for (const emotion of emotionsToGenerate) {
    console.log(`[🎨] ${characterName} ${emotion} 생성 중...`);
    
    // 외모 묘사 기반 프롬프트 생성 (이름 대신 상세 특징 사용)
    const prompt = buildSingleEmotionPromptWithDescription(physicalDescription, emotion, customStyle);
    console.log(`[📝 프롬프트] (${prompt.length}자):\n${prompt}`);
    
    let imageBuffer: Buffer | null = null;
    
    // Imagen 3 시도
    if (provider === "imagen") {
      imageBuffer = await generateImageWithImagen3(prompt);
      
      if (!imageBuffer) {
        console.log(`[🎨] ${characterName} ${emotion} - Imagen 3 실패, DALL-E 폴백`);
        // DALL-E 3 폴백
        try {
          const response = await openai.images.generate({
            model: "dall-e-3",
            prompt: prompt,
            n: 1,
            size: "1024x1024",
            quality: "standard",
            response_format: "b64_json"
          });
          
          if (response.data?.[0]?.b64_json) {
            imageBuffer = Buffer.from(response.data[0].b64_json, "base64");
            console.log(`[🎨 DALL-E] ${characterName} ${emotion} 생성 완료`);
          }
        } catch (dalleError) {
          console.error(`[🎨 DALL-E] ${characterName} ${emotion} 실패:`, dalleError);
        }
      }
    } else {
      // DALL-E 직접 사용
      try {
        const response = await openai.images.generate({
          model: "dall-e-3",
          prompt: prompt,
          n: 1,
          size: "1024x1024",
          quality: "standard",
          response_format: "b64_json"
        });
        
        if (response.data?.[0]?.b64_json) {
          imageBuffer = Buffer.from(response.data[0].b64_json, "base64");
        }
      } catch (dalleError) {
        console.error(`[🎨 DALL-E] ${characterName} ${emotion} 실패:`, dalleError);
      }
    }
    
    if (imageBuffer) {
      // 이미지를 128x128로 리사이즈 후 저장
      const resizedBuffer = await sharp(imageBuffer)
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "center" })
        .png()
        .toBuffer();
      
      const filename = `${characterId}_${emotion}.png`;
      const filePath = path.join(uploadsDir, filename);
      await fs.promises.writeFile(filePath, resizedBuffer);
      
      const urlPath = `/uploads/avatars/${path.basename(uploadsDir)}/${filename}`;
      results[emotion] = urlPath;
      console.log(`[✅] ${characterName} ${emotion} 저장 완료: ${filename}`);
    } else {
      console.error(`[❌] ${characterName} ${emotion} 생성 실패`);
    }
    
    // API 속도 제한 방지 (1초 대기)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // 3단계: 생성되지 않은 감정은 neutral 이미지 재사용
  const neutralUrl = results.neutral;
  if (neutralUrl) {
    for (const emotion of EMOTION_ORDER) {
      if (!results[emotion]) {
        results[emotion] = neutralUrl;
        console.log(`[♻️] ${characterName} ${emotion} → neutral 재사용`);
      }
    }
  }
  
  // 최소 1개 이상 생성 성공 확인
  const successCount = Object.values(results).filter(url => url !== "").length;
  console.log(`[🎨] ${characterName} 아바타 생성 완료: ${successCount}/16 감정`);
  
  return results;
}

// 메인 아바타 생성 함수
export async function generateSpriteSheet(
  request: SpriteSheetGenerationRequest
): Promise<SpriteSheetGenerationResult> {
  const { agentId, groupChatId, characters, customPromptStyle } = request;
  const idPrefix = groupChatId ? `gc_${groupChatId}` : `agent_${agentId}`;
  
  // 캐릭터가 4명을 초과하면 상위 4명만 처리 (비용 최적화)
  const MAX_CHARACTERS = 4;
  const limitedCharacters = characters.slice(0, MAX_CHARACTERS);
  
  if (limitedCharacters.length === 0) {
    return {
      success: false,
      error: "No characters provided"
    };
  }
  
  if (characters.length > MAX_CHARACTERS) {
    console.log(`[🎭 아바타 생성] ${characters.length}명 중 상위 ${MAX_CHARACTERS}명만 처리: ${limitedCharacters.map(c => c.characterName).join(", ")}`);
  }

  const uploadsDir = path.join(process.cwd(), "uploads", "avatars", idPrefix);
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  console.log(`[🎭 아바타 생성] ${limitedCharacters.length}명 캐릭터 16감정 아바타 생성 시작 (${idPrefix})`);

  const allAvatars: Array<{
    characterId: string;
    characterName: string;
    emotions: Record<AvatarEmotionType, string>;
  }> = [];

  for (const character of limitedCharacters) {
    // 1단계: 이름 정규화 후 기존 아바타 검색
    const normalizedName = normalizeCharacterName(character.characterName);
    const existingGlobalAvatar = await storage.findAvatarByNormalizedName(normalizedName);
    
    // 기존 아바타가 있고, 이미지가 있으면 재사용
    if (existingGlobalAvatar && existingGlobalAvatar.neutralImageUrl) {
      console.log(`[🎨 재사용] ${character.characterName} → 기존 아바타 발견 (ID: ${existingGlobalAvatar.id}, 원본: ${existingGlobalAvatar.characterName})`);
      
      // 현재 groupChatId에 이미 있는지 확인
      let currentAvatar;
      if (groupChatId) {
        currentAvatar = await storage.getCharacterAvatarByGroupChat(groupChatId, character.characterId);
      } else if (agentId) {
        currentAvatar = await storage.getCharacterAvatar(agentId, character.characterId);
      }
      
      // 현재 채팅에 아바타가 없으면 기존 아바타 정보로 새 레코드 생성
      if (!currentAvatar) {
        const reuseData: InsertCharacterAvatar = {
          agentId: agentId || null,
          groupChatId: groupChatId || null,
          characterId: character.characterId,
          characterName: character.characterName,
          spriteSheetUrl: existingGlobalAvatar.spriteSheetUrl,
          neutralImageUrl: existingGlobalAvatar.neutralImageUrl,
          happyImageUrl: existingGlobalAvatar.happyImageUrl,
          sadImageUrl: existingGlobalAvatar.sadImageUrl,
          angryImageUrl: existingGlobalAvatar.angryImageUrl,
          determinedImageUrl: existingGlobalAvatar.determinedImageUrl,
          worriedImageUrl: existingGlobalAvatar.worriedImageUrl,
          thinkingImageUrl: existingGlobalAvatar.thinkingImageUrl,
          questioningImageUrl: existingGlobalAvatar.questioningImageUrl,
          listeningImageUrl: existingGlobalAvatar.listeningImageUrl,
          surprisedImageUrl: existingGlobalAvatar.surprisedImageUrl,
          shockedImageUrl: existingGlobalAvatar.shockedImageUrl,
          embarrassedImageUrl: existingGlobalAvatar.embarrassedImageUrl,
          flusteredImageUrl: existingGlobalAvatar.flusteredImageUrl,
          confidentImageUrl: existingGlobalAvatar.confidentImageUrl,
          arrogantImageUrl: existingGlobalAvatar.arrogantImageUrl,
          tiredImageUrl: existingGlobalAvatar.tiredImageUrl,
          rowIndex: character.rowIndex,
          promptUsed: `reused from avatar ID ${existingGlobalAvatar.id}`,
        };
        await storage.createCharacterAvatar(reuseData);
        console.log(`[🎨 재사용] ${character.characterName} 새 그룹챗에 연결 완료`);
      }
      
      // 감정 URL 추출하여 반환
      const reusedEmotions: Record<AvatarEmotionType, string> = {
        neutral: existingGlobalAvatar.neutralImageUrl || "",
        happy: existingGlobalAvatar.happyImageUrl || "",
        sad: existingGlobalAvatar.sadImageUrl || "",
        angry: existingGlobalAvatar.angryImageUrl || "",
        determined: existingGlobalAvatar.determinedImageUrl || "",
        worried: existingGlobalAvatar.worriedImageUrl || "",
        thinking: existingGlobalAvatar.thinkingImageUrl || "",
        questioning: existingGlobalAvatar.questioningImageUrl || "",
        listening: existingGlobalAvatar.listeningImageUrl || "",
        surprised: existingGlobalAvatar.surprisedImageUrl || "",
        shocked: existingGlobalAvatar.shockedImageUrl || "",
        embarrassed: existingGlobalAvatar.embarrassedImageUrl || "",
        flustered: existingGlobalAvatar.flusteredImageUrl || "",
        confident: existingGlobalAvatar.confidentImageUrl || "",
        arrogant: existingGlobalAvatar.arrogantImageUrl || "",
        tired: existingGlobalAvatar.tiredImageUrl || ""
      };
      
      allAvatars.push({
        characterId: character.characterId,
        characterName: character.characterName,
        emotions: reusedEmotions
      });
      continue; // 다음 캐릭터로
    }
    
    // 2단계: 기존 아바타가 없으면 새로 생성
    console.log(`[🎨] ${character.characterName} 16감정 개별 생성 시작...`);
    
    const emotions = await generateAllEmotionsForCharacter(
      character.characterName,
      character.characterId,
      customPromptStyle,
      uploadsDir,
      currentProvider
    );
    
    const hasAnyEmotion = Object.values(emotions).some(url => url !== "");
    
    if (hasAnyEmotion) {
      // DB 저장
      let existingAvatar;
      if (groupChatId) {
        existingAvatar = await storage.getCharacterAvatarByGroupChat(groupChatId, character.characterId);
      } else if (agentId) {
        existingAvatar = await storage.getCharacterAvatar(agentId, character.characterId);
      }
      
      const avatarData: InsertCharacterAvatar = {
        agentId: agentId || null,
        groupChatId: groupChatId || null,
        characterId: character.characterId,
        characterName: character.characterName,
        spriteSheetUrl: `/uploads/avatars/${idPrefix}/${character.characterId}_spritesheet.png`,
        neutralImageUrl: emotions.neutral || null,
        happyImageUrl: emotions.happy || null,
        sadImageUrl: emotions.sad || null,
        angryImageUrl: emotions.angry || null,
        determinedImageUrl: emotions.determined || null,
        worriedImageUrl: emotions.worried || null,
        thinkingImageUrl: emotions.thinking || null,
        questioningImageUrl: emotions.questioning || null,
        listeningImageUrl: emotions.listening || null,
        surprisedImageUrl: emotions.surprised || null,
        shockedImageUrl: emotions.shocked || null,
        embarrassedImageUrl: emotions.embarrassed || null,
        flusteredImageUrl: emotions.flustered || null,
        confidentImageUrl: emotions.confident || null,
        arrogantImageUrl: emotions.arrogant || null,
        tiredImageUrl: emotions.tired || null,
        rowIndex: character.rowIndex,
        promptUsed: `16-emotion individual (${currentProvider}): ${customPromptStyle || 'photorealistic'}`,
      };

      if (existingAvatar) {
        await storage.updateCharacterAvatar(existingAvatar.id, avatarData);
      } else {
        await storage.createCharacterAvatar(avatarData);
      }

      allAvatars.push({
        characterId: character.characterId,
        characterName: character.characterName,
        emotions
      });
      
      console.log(`[🎨] ${character.characterName} 16감정 아바타 저장 완료`);
    } else {
      console.warn(`[🎨] ${character.characterName} 모든 감정 생성 실패`);
    }
  }

  console.log(`[🎭 아바타 생성] 완료 - ${allAvatars.length}/${limitedCharacters.length}명 캐릭터 아바타 저장됨`);

  return {
    success: allAvatars.length > 0,
    avatars: allAvatars,
    error: allAvatars.length === 0 ? "Avatar generation failed for all characters" : undefined
  };
}

// 단일 캐릭터 아바타 생성 (API 라우트용)
export async function generateSingleCharacterAvatar(
  agentId: number | null,
  groupChatId: number | null,
  characterId: string,
  characterName: string,
  customPromptStyle?: string
): Promise<SpriteSheetGenerationResult> {
  try {
    const result = await generateSpriteSheet({
      agentId: agentId || undefined,
      groupChatId: groupChatId || undefined,
      characters: [{
        characterId,
        characterName,
        rowIndex: 0
      }],
      customPromptStyle
    });
    
    return result;
  } catch (error) {
    console.error(`[🎭 단일 아바타] ${characterName} 생성 실패:`, error);
    return {
      success: false,
      error: `Single character avatar generation failed: ${(error as Error).message}`
    };
  }
}

// 그룹채팅용 캐릭터 아바타 일괄 생성
export async function generateAvatarsForGroupChat(
  groupChatId: number,
  characterNames: string[],
  customPromptStyle?: string
): Promise<SpriteSheetGenerationResult> {
  const characters: CharacterConfig[] = characterNames.map((name, index) => ({
    characterId: name.toLowerCase().replace(/[^a-z0-9가-힣]/g, '_'),
    characterName: name,
    rowIndex: index
  }));
  
  return generateSpriteSheet({
    groupChatId,
    characters,
    customPromptStyle
  });
}

// 감정 URL 매핑 헬퍼 함수
export function getEmotionImageUrl(
  avatar: { 
    neutralImageUrl?: string | null;
    happyImageUrl?: string | null;
    sadImageUrl?: string | null;
    angryImageUrl?: string | null;
    determinedImageUrl?: string | null;
    worriedImageUrl?: string | null;
    thinkingImageUrl?: string | null;
    questioningImageUrl?: string | null;
    listeningImageUrl?: string | null;
    surprisedImageUrl?: string | null;
    shockedImageUrl?: string | null;
    embarrassedImageUrl?: string | null;
    flusteredImageUrl?: string | null;
    confidentImageUrl?: string | null;
    arrogantImageUrl?: string | null;
    tiredImageUrl?: string | null;
  },
  emotion: AvatarEmotionType
): string | null {
  const urlMap: Record<AvatarEmotionType, string | null | undefined> = {
    neutral: avatar.neutralImageUrl,
    happy: avatar.happyImageUrl,
    sad: avatar.sadImageUrl,
    angry: avatar.angryImageUrl,
    determined: avatar.determinedImageUrl,
    worried: avatar.worriedImageUrl,
    thinking: avatar.thinkingImageUrl,
    questioning: avatar.questioningImageUrl,
    listening: avatar.listeningImageUrl,
    surprised: avatar.surprisedImageUrl,
    shocked: avatar.shockedImageUrl,
    embarrassed: avatar.embarrassedImageUrl,
    flustered: avatar.flusteredImageUrl,
    confident: avatar.confidentImageUrl,
    arrogant: avatar.arrogantImageUrl,
    tired: avatar.tiredImageUrl
  };
  
  return urlMap[emotion] || null;
}

// DB에서 캐릭터 아바타 조회 (agentId 기준) - 16감정 포맷으로 반환
export async function getCharacterAvatarsByAgent(agentId: number): Promise<Array<{
  characterId: string;
  characterName: string;
  avatars: Record<AvatarEmotionType, string | null>;
}>> {
  const avatars = await storage.getCharacterAvatars(agentId);
  
  return avatars.map(avatar => ({
    characterId: avatar.characterId,
    characterName: avatar.characterName,
    avatars: {
      neutral: avatar.neutralImageUrl || null,
      happy: avatar.happyImageUrl || null,
      sad: avatar.sadImageUrl || null,
      angry: avatar.angryImageUrl || null,
      determined: avatar.determinedImageUrl || null,
      worried: avatar.worriedImageUrl || null,
      thinking: avatar.thinkingImageUrl || null,
      questioning: avatar.questioningImageUrl || null,
      listening: avatar.listeningImageUrl || null,
      surprised: avatar.surprisedImageUrl || null,
      shocked: avatar.shockedImageUrl || null,
      embarrassed: avatar.embarrassedImageUrl || null,
      flustered: avatar.flusteredImageUrl || null,
      confident: avatar.confidentImageUrl || null,
      arrogant: avatar.arrogantImageUrl || null,
      tired: avatar.tiredImageUrl || null
    }
  }));
}

// DB에서 캐릭터 아바타 조회 (groupChatId 기준) - 16감정 포맷으로 반환
export async function getCharacterAvatarsByGroupChat(groupChatId: number): Promise<Array<{
  characterId: string;
  characterName: string;
  avatars: Record<AvatarEmotionType, string | null>;
}>> {
  const avatars = await storage.getCharacterAvatarsByGroupChat(groupChatId);
  
  return avatars.map(avatar => ({
    characterId: avatar.characterId,
    characterName: avatar.characterName,
    avatars: {
      neutral: avatar.neutralImageUrl || null,
      happy: avatar.happyImageUrl || null,
      sad: avatar.sadImageUrl || null,
      angry: avatar.angryImageUrl || null,
      determined: avatar.determinedImageUrl || null,
      worried: avatar.worriedImageUrl || null,
      thinking: avatar.thinkingImageUrl || null,
      questioning: avatar.questioningImageUrl || null,
      listening: avatar.listeningImageUrl || null,
      surprised: avatar.surprisedImageUrl || null,
      shocked: avatar.shockedImageUrl || null,
      embarrassed: avatar.embarrassedImageUrl || null,
      flustered: avatar.flusteredImageUrl || null,
      confident: avatar.confidentImageUrl || null,
      arrogant: avatar.arrogantImageUrl || null,
      tired: avatar.tiredImageUrl || null
    }
  }));
}

// 특정 캐릭터의 특정 감정 아바타 URL 조회
export async function getCharacterAvatarUrl(
  agentId: number, 
  characterId: string, 
  emotion: AvatarEmotionType
): Promise<string | null> {
  const avatar = await storage.getCharacterAvatar(agentId, characterId);
  if (!avatar) return null;
  
  return getEmotionImageUrl(avatar, emotion);
}
