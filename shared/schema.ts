import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  serial,
  integer,
  boolean,
  numeric,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(3072)';
  },
  toDriver(value: number[]): string {
    return JSON.stringify(value);
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
  },
});

// 관계 타입 상수 정의
export const RELATIONSHIP_TYPES = [
  "assistant",
  "mentor",
  "tutor",
  "collaborator",
  "companion",
  "inspirer",
  "debater",
  "interviewer",
  "pm",
  "expert",
  "native_speaker"
] as const;

export type RelationshipType = typeof RELATIONSHIP_TYPES[number];

// 역할 포지션 타입 (대화 스타일)
export const ROLE_POSITIONS = [
  "종합자",     // 균형잡힌 톤, 종합 정리
  "동의형",     // 직선적 동의, 가끔 열정적
  "논쟁형",     // 논쟁적, 자주 질문/반박
  "감성형",     // 시적 표현, 감정적 공감
  "분석형"      // 데이터/팩트 중심, 짧고 간결
] as const;

export type RolePosition = typeof ROLE_POSITIONS[number];

// 캐릭터 아키타입 (캐릭터 본성)
export const CHARACTER_ARCHETYPES = [
  "friendly",    // 친근하고 따뜻한 성격 (해리 포터, 나연)
  "logical",     // 논리적이고 분석적 (헤르미온느, 앨런 튜링)
  "stern",       // 엄격하고 직설적 (스네이프, 소크라테스)
  "heroic",      // 영웅적이고 용감한 (이순신, 잔 다르크)
  "wise",        // 현명하고 사려깊은 (공자, 세종대왕)
  "playful",     // 유쾌하고 장난스러운 (셰익스피어, 모차르트)
  "mysterious"   // 신비롭고 심오한 (다빈치, 융)
] as const;

export type CharacterArchetype = typeof CHARACTER_ARCHETYPES[number];

// Debater 모드 스타일 (관계 톤이 debater일 때 캐릭터별 표현 방식)
export const DEBATER_STYLES = [
  "curious_questions",   // 호기심 많은 질문형 (friendly 캐릭터에 적합)
  "evidence_based",      // 증거 중심 반론 (logical 캐릭터에 적합)
  "direct_critique",     // 직접적 비판 (stern 캐릭터에 적합)
  "strategic_challenge", // 전략적 도전 (heroic 캐릭터에 적합)
  "socratic_method",     // 소크라테스식 문답 (wise 캐릭터에 적합)
  "witty_banter",        // 재치있는 농담 (playful 캐릭터에 적합)
  "philosophical_probe"  // 철학적 탐구 (mysterious 캐릭터에 적합)
] as const;

export type DebaterStyle = typeof DEBATER_STYLES[number];

// 🎭 멀티모달 감정 표현 아바타 - 16가지 감정 타입
export const AVATAR_EMOTION_TYPES = [
  "neutral",      // 기본 (중립)
  "happy",        // 기쁨
  "sad",          // 슬픔
  "angry",        // 화남
  "determined",   // 단호
  "worried",      // 고민
  "thinking",     // 생각중
  "questioning",  // 물음 (?)
  "listening",    // 경청
  "surprised",    // 놀람
  "shocked",      // 충격
  "embarrassed",  // 부끄러움
  "flustered",    // 당황
  "confident",    // 자신감
  "arrogant",     // 거만
  "tired"         // 피곤
] as const;

export type AvatarEmotionType = typeof AVATAR_EMOTION_TYPES[number];

// 감정 한글-영어 매핑
export const EMOTION_KO_EN_MAP: Record<string, AvatarEmotionType> = {
  "기본": "neutral",
  "중립": "neutral",
  "기쁨": "happy",
  "행복": "happy",
  "슬픔": "sad",
  "우울": "sad",
  "화남": "angry",
  "분노": "angry",
  "단호": "determined",
  "결연": "determined",
  "고민": "worried",
  "걱정": "worried",
  "생각중": "thinking",
  "사색": "thinking",
  "물음": "questioning",
  "의문": "questioning",
  "경청": "listening",
  "귀기울임": "listening",
  "놀람": "surprised",
  "놀라움": "surprised",
  "충격": "shocked",
  "경악": "shocked",
  "부끄러움": "embarrassed",
  "수줍음": "embarrassed",
  "당황": "flustered",
  "혼란": "flustered",
  "자신감": "confident",
  "확신": "confident",
  "거만": "arrogant",
  "오만": "arrogant",
  "피곤": "tired",
  "지침": "tired"
};

// 연령 단계 (LifeStage) 상수 정의
export const LIFE_STAGES = [
  "EC",   // 아동 전기 (Early Childhood) 7-9세
  "LC",   // 아동 후기 (Late Childhood) 10-12세
  "EA",   // 초기 청소년기 (Early Adolescence) 13-15세
  "AD",   // 청소년기 (Adolescence) 16-18세
  "YA1",  // 청년 전기 (Emerging Adulthood) 19-25세
  "YA2",  // 청년 후기 (Early Adulthood) 26-35세
  "MA1",  // 중년 전기 (Midlife Transition) 36-50세
  "MA2",  // 중년 후기 (Mature Adulthood) 51-65세
  "FS"    // 원숙기 (Fulfillment Stage) 66세 이상
] as const;

export type LifeStage = typeof LIFE_STAGES[number];

// 언어 설정 상수 정의
export const LANGUAGE_OPTIONS = [
  "question_language", // 질문 언어 (기본값)
  "native_language",   // 모국어
  "korean",           // 한국어
  "english",          // 영어  
  "chinese",          // 중국어 (표준중국어)
  "spanish",          // 스페인어
  "hindi",            // 힌디어
  "arabic",           // 아랍어
  "portuguese",       // 포르투갈어
  "bengali",          // 벵골어
  "russian",          // 러시아어
  "japanese",         // 일본어
  "french",           // 프랑스어
  "german"            // 독일어
] as const;

export type LanguageOption = typeof LANGUAGE_OPTIONS[number];

// 언어 라벨 매핑 (legacy - use i18n instead)
export const LANGUAGE_LABELS: Record<LanguageOption, string> = {
  question_language: "Question language",
  native_language: "Native language",
  korean: "한국어",
  english: "English",
  chinese: "中文",
  spanish: "Español", 
  hindi: "हिन्दी",
  arabic: "العربية",
  portuguese: "Português",
  bengali: "বাংলা",
  russian: "Русский",
  japanese: "日本語",
  french: "Français",
  german: "Deutsch"
};

// 그룹 채팅방 공개 범위 상수 정의
export const VISIBILITY_OPTIONS = [
  "public",    // 공개 - LoBo 서비스 내 모든 사용자에게 공개
  "private",   // 비공개 - 초대된 사용자만 접근 가능
  "embed"      // 웹 임베드 - 지정된 웹 페이지에서 접근 가능
] as const;

export type VisibilityOption = typeof VISIBILITY_OPTIONS[number];

// CallNAsk 설정 타입 정의
export type CallNAskConfig = {
  maxAgents: number;               // 최대 에이전트 수 (기본값: 5)
  allowedCategories?: string[];    // 허용된 에이전트 카테고리 (선택사항)
  rateLimitSettings?: {            // Rate limiting 설정 (선택사항)
    messagesPerMinute?: number;
    messagesPerDay?: number;
  };
};

// CallNAsk 설정 Zod 스키마
export const callnaskConfigSchema = z.object({
  maxAgents: z.number().min(1).max(10).default(5),
  allowedCategories: z.array(z.string()).optional(),
  rateLimitSettings: z.object({
    messagesPerMinute: z.number().optional(),
    messagesPerDay: z.number().optional(),
  }).optional(),
});

// 🤝 관계 매트릭스 타입 정의 (챗봇 간 관계)
export type RelationshipEdge = {
  from: string;     // 발화자 (챗봇 이름)
  to: string;       // 청자 (챗봇 이름)
  relation: string; // 관계 설명 (예: "스승과 제자", "동료 제자")
  tone: string;     // 말투/호칭 규칙 (예: "항상 존댓말, 존칭 '주님'")
};

export type RelationshipMatrix = RelationshipEdge[];

// 관계 매트릭스 Zod 스키마
export const relationshipEdgeSchema = z.object({
  from: z.string().min(1, "발화자는 필수입니다"),
  to: z.string().min(1, "청자는 필수입니다"),
  relation: z.string().min(1, "관계 설명은 필수입니다"),
  tone: z.string().min(1, "말투 규칙은 필수입니다"),
});

export const relationshipMatrixSchema = z.array(relationshipEdgeSchema);

// 🎯 시나리오 요약 구조 - 턴 단위 대화 컨텍스트 관리
export type CharacterState = {
  name: string;                    // 캐릭터 이름
  style: string;                   // 말투/스타일 (예: "차분하고 비유적인 어투")
  currentRelations: Record<string, string>; // 다른 캐릭터들과의 관계 변화 (예: {"베드로": "신뢰+강화"})
  emotionalState?: string;         // 현재 감정 상태 (예: "믿음 강조")
};

export type ScenarioSummary = {
  storySummary: string;            // 스토리 요약 (사건 전개, 주요 결론)
  characterStates: CharacterState[]; // 각 캐릭터 상태 및 관계 변화
  turnCount: number;               // 현재 턴 수
  lastUpdatedAt: Date;             // 마지막 업데이트 시간
};

// 시나리오 요약 Zod 스키마
export const characterStateSchema = z.object({
  name: z.string(),
  style: z.string(),
  currentRelations: z.record(z.string()),
  emotionalState: z.string().optional(),
});

export const scenarioSummarySchema = z.object({
  storySummary: z.string(),
  characterStates: z.array(characterStateSchema),
  turnCount: z.number(),
  lastUpdatedAt: z.date(),
});

// 시나리오 요약 저장 테이블
export const scenarioSummaries = pgTable("scenario_summaries", {
  id: serial("id").primaryKey(),
  groupChatId: integer("group_chat_id").references(() => groupChats.id).notNull(),
  storySummary: text("story_summary").notNull(), // 스토리 요약
  characterStates: jsonb("character_states").notNull(), // 캐릭터 상태들 (JSON)
  turnCount: integer("turn_count").default(0), // 턴 수
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  // 기존 필드들 (호환성 유지)
  id: varchar("id").primaryKey().notNull(),
  username: varchar("username").unique().notNull(), // 학번/교번
  password: varchar("password").notNull(), // 해시된 비밀번호
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  userType: varchar("user_type").notNull().default("student"), // "student" or "faculty"
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  
  // 1. 기본 정보 (추가)
  name: varchar("name", { length: 50 }), // 사용자 이름
  passwordHash: text("password_hash"), // 암호화된 비밀번호 (별도 필드)
  lastLoginAt: timestamp("last_login_at"), // 마지막 로그인 시각
  preferredLanguage: varchar("preferred_language", { length: 10 }).default("ko"), // 선호 언어 (ko, en, jp)
  
  // 2. 카테고리 및 소속 정보
  upperCategory: varchar("upper_category"), // 상위 카테고리 (예: 단과대학, 본부)
  lowerCategory: varchar("lower_category"), // 하위 카테고리 (예: 학과, 부서)
  detailCategory: varchar("detail_category"), // 세부 카테고리
  groups: jsonb("groups").default(JSON.stringify([])), // 추가 소속 그룹
  
  // 사용 중인 에이전트 목록
  usingAgents: jsonb("using_agents").default(JSON.stringify([])), // 사용자가 현재 사용 중인 에이전트 ID 목록
  
  // 카테고리 운영자 권한
  managedCategories: jsonb("managed_categories").default(JSON.stringify([])), // 카테고리 운영자가 관리하는 카테고리명 목록
  
  // 에이전트/QA/문서 관리자 권한
  managedAgents: jsonb("managed_agents").default(JSON.stringify([])), // 에이전트/QA/문서 관리자가 관리하는 에이전트명 목록
  
  // 복수 소속 정보 (조직별 정보)
  organizationAffiliations: jsonb("organization_affiliations").default(JSON.stringify([])), // 복수 조직 소속 정보
  
  // 복수 에이전트 권한 정보
  agentPermissions: jsonb("agent_permissions").default(JSON.stringify([])), // 에이전트별 권한 정보
  
  // 사용자 메모
  userMemo: text("user_memo"),
  
  // 개인 프로필 정보 (AI 응답 개인화용)
  nickname: varchar("nickname", { length: 50 }), // 호칭 (예: 대표님, 홍교수)
  age: integer("age"), // 연령 (설명 수준 조정용)
  gender: varchar("gender", { length: 20 }), // 성별 (AI 응답 개인화용)
  country: varchar("country", { length: 100 }), // 국가 (역사·인물 평가, 가치관 반영)
  religion: varchar("religion", { length: 100 }), // 종교 (세계관 반영)
  occupation: varchar("occupation", { length: 200 }), // 직업/하는일/역할 (맥락 적합성)
  lifeStage: varchar("life_stage", { length: 10 }), // 연령 단계 (EC, LC, EA, AD, YA1, YA2, MA1, MA2, FS)
  
  // AI 응답 톤 개인화를 위한 성향 정보
  personalityTraits: jsonb("personality_traits").default(JSON.stringify([])), // 성향 (예: ["introvert", "analytical", "creative"])
  learningStyle: varchar("learning_style", { length: 50 }), // 학습 스타일 (예: "visual", "auditory", "kinesthetic")
  
  // 3. 역할 및 권한 정보
  role: varchar("role").notNull().default("user"), // 시스템 내 역할 (System Role)
  position: varchar("position"), // 조직 내 직책/역할 (Organization Role/Position)
  permissions: jsonb("permissions"), // 커스텀 권한 세트
  
  // 4. 계정 상태 정보
  status: varchar("status").notNull().default("active"), // 계정 상태
  lockedReason: text("locked_reason"), // 계정 잠금 사유
  deactivatedAt: timestamp("deactivated_at"), // 비활성화된 시각
  
  // 5. 활동 및 인증 정보
  loginFailCount: integer("login_fail_count").default(0), // 연속 로그인 실패 횟수
  lastLoginIP: varchar("last_login_ip"), // 마지막 로그인 IP 주소
  authProvider: varchar("auth_provider").default("email"), // 인증 수단
  termsAcceptedAt: timestamp("terms_accepted_at"), // 이용약관 동의 일시
});

// 조직 구조 테이블
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: varchar("type").notNull(), // "university", "graduate_school", "college", "department"
  parentId: integer("parent_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// 추천된 캐릭터 저장 테이블 (100개 제한, FIFO)
export const recommendedCharacters = pgTable("recommended_characters", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  topic: varchar("topic", { length: 100 }).notNull(), // 추천 요청 주제
  characterData: jsonb("character_data").notNull(), // 캐릭터 정보 (name, description, personality 등)
  characterHash: varchar("character_hash", { length: 64 }).notNull(), // 중복 방지용 해시
  agentId: integer("agent_id").references(() => agents.id), // 생성된 에이전트 ID (생성 시 저장)
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_recommended_characters_user_created").on(table.userId, table.createdAt),
  uniqueIndex("idx_recommended_characters_user_hash_unique").on(table.userId, table.characterHash)
]);

// 추천된 캐릭터 관련 타입들
export type RecommendedCharacter = typeof recommendedCharacters.$inferSelect;
export type InsertRecommendedCharacter = typeof recommendedCharacters.$inferInsert;
export const insertRecommendedCharacterSchema = createInsertSchema(recommendedCharacters);

export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  
  // 1. 기본 정보 (Basic Info)
  name: varchar("name", { length: 20 }).notNull(),
  description: varchar("description", { length: 200 }).notNull(),
  creatorId: varchar("creator_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  
  // 2. 카테고리 및 상태 정보
  category: text("category").notNull().default("범용"), // 에이전트 카테고리 (필수)
  upperCategory: varchar("upper_category").default("전체"), // 상위 카테고리 (예: 단과대학)
  lowerCategory: varchar("lower_category").default("전체"), // 하위 카테고리 (예: 학과)
  detailCategory: varchar("detail_category").default("전체"), // 세부 카테고리
  status: varchar("status").default("active"), // "active", "inactive", "pending"
  
  // 3. 모델 및 응답 설정
  llmModel: varchar("llm_model").notNull().default("gpt-4o"), // 사용 모델
  chatbotType: varchar("chatbot_type").notNull().default("general-llm"), // "strict-doc", "doc-fallback-llm", "general-llm", "llm-with-web-search"
  maxInputLength: integer("max_input_length").default(2048), // 최대 입력 길이
  maxResponseLength: integer("max_response_length").default(1024), // 최대 응답 길이
  
  // 웹 검색 관련 설정
  webSearchEnabled: boolean("web_search_enabled").default(false), // 웹 검색 사용 여부
  searchEngine: varchar("search_engine").default("bing"), // 검색 엔진 종류
  bingApiKey: text("bing_api_key"), // Bing 검색 API 키
  
  // 4. 역할 및 페르소나 설정
  personaNickname: varchar("persona_nickname"), // 닉네임
  speechStyle: text("speech_style").default("공손하고 친절한 말투로 대화합니다"), // 말투 스타일
  speakingStyleIntensity: numeric("speaking_style_intensity", { precision: 3, scale: 2 }).default("0.50"), // 말투 강도 (0.0~1.0, 1.0=완전 유지)
  reactionIntensity: integer("reaction_intensity").default(5), // 리액션 강도 (0~10, 0=절제됨, 10=매우 풍부함)
  context: varchar("context").default("general"), // 사용 맥락 (church/education/business/healthcare/general/entertainment)
  personality: text("personality").default("친절하고 도움이 되는 성격"), // 성격특성
  knowledgeDomain: text("knowledge_domain"), // 🧠 지식 영역 (예: "투자, 경제학, 주식시장", "조선 시대 군사 전략, 해전, 리더십")
  additionalPrompt: text("additional_prompt"), // 추가 프롬프트
  extraPrompt: text("extra_prompt"), // 추가 프롬프트 영역
  
  // 🎭 대화 스타일 및 관계 설정 (확률적 변주 시스템용)
  rolePosition: varchar("role_position").default("분석형"), // 대화 역할: 종합자/동의형/논쟁형/감성형/분석형
  defaultUserRelationship: varchar("default_user_relationship").default("친구"), // 사용자와의 기본 관계
  
  // 🎭 캐릭터 본성 및 톤 스타일 (관계 기반 톤 시스템용)
  characterArchetype: varchar("character_archetype").default("friendly"), // 캐릭터 유형: friendly/logical/stern/heroic/wise/playful/mysterious
  debaterStyle: varchar("debater_style").default("curious_questions"), // debater 관계 톤일 때 표현 스타일
  
  // 언어 설정
  responseLanguage: varchar("response_language").default("ko"), // 에이전트 기본 응답 언어 (ko, en, ja, zh, vi 등)
  
  // 파일 업로드 설정 추가
  documentType: varchar("document_type").default("manual"), // 문서 유형 (manual, faq, policy, etc.)
  maxFileSize: varchar("max_file_size").default("50mb"), // 최대 파일 크기
  
  // 5. 문서 연결 및 업로드
  uploadFormats: jsonb("upload_formats").default(JSON.stringify(["PDF", "DOCX", "TXT"])), // 업로드 가능한 포맷
  uploadMethod: varchar("upload_method").default("dragdrop"), // "dragdrop", "onedrive"
  maxFileCount: integer("max_file_count").default(100), // 최대 문서 수
  maxFileSizeMB: integer("max_file_size_mb").default(100), // 최대 파일 크기(MB)
  documentManagerIds: jsonb("document_manager_ids").default(JSON.stringify([])), // 문서 업로드/연결 권한자 목록
  
  // 6. 권한 및 접근 설정
  visibility: varchar("visibility").default("private"), // "private", "public", "custom", "group", "organization"
  allowedGroups: jsonb("allowed_groups").default(JSON.stringify([])), // 접근 가능한 사용자 그룹
  agentManagerIds: jsonb("agent_manager_ids").default(JSON.stringify([])), // 에이전트 관리자 목록
  agentEditorIds: jsonb("agent_editor_ids").default(JSON.stringify([])), // 에이전트 편집 가능 사용자 목록
  
  // 기존 UI 관련 필드들 (호환성 유지)
  icon: text("icon").notNull(),
  backgroundColor: text("background_color").notNull(),
  isCustomIcon: boolean("is_custom_icon").default(false),
  
  // 에이전트 유형 정보
  type: varchar("type").notNull().default("기능형"), // 에이전트 유형 (학교, 교수, 학생, 그룹, 기능형)
  
  // 기존 레거시 필드들 (호환성 유지)
  managerId: varchar("manager_id").references(() => users.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  isActive: boolean("is_active").default(true),
  
  // 🎯 Canon-Style 분리 아키텍처
  canonProfileId: integer("canon_profile_id").references(() => canonProfiles.id), // Canon 프로필 참조
  toneProfileId: integer("tone_profile_id").references(() => toneProfiles.id), // Tone 프로필 참조
});

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  agentId: integer("agent_id").references(() => agents.id).notNull(),
  type: varchar("type").notNull().default("general"), // "general" or "management"
  relationshipType: varchar("relationship_type").default("친구"), // 사용자와 에이전트 간의 관계
  unreadCount: integer("unread_count").default(0),
  lastReadAt: timestamp("last_read_at"),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  isHidden: boolean("is_hidden").default(false), // 사용자가 채팅방에서 나갔는지 여부
  createdAt: timestamp("created_at").defaultNow(),
});

// LLM 제공자 옵션 상수 정의
export const LLM_PROVIDER_OPTIONS = [
  "openai",
  "gemini"
] as const;

export type LlmProviderOption = typeof LLM_PROVIDER_OPTIONS[number];

// GPT 모델 옵션 상수 정의
export const GPT_MODEL_OPTIONS = [
  "gpt-4o",           // 최신, 가장 강력, 정확성 최고
  "gpt-4o-mini",      // 빠르고 저렴, 균형잡힌 성능
  "gpt-4-turbo",      // 이전 세대 터보
  "gpt-4",            // 이전 세대 표준
  "gpt-3.5-turbo",    // 레거시, 가장 저렴
  "o1-preview",       // 추론 특화 (느림, 강력)
  "o1-mini"           // 추론 특화 경량
] as const;

export type GptModelOption = typeof GPT_MODEL_OPTIONS[number];

// Gemini 모델 옵션 상수 정의
export const GEMINI_MODEL_OPTIONS = [
  "gemini-2.0-flash-lite",   // 가장 빠르고 저렴 (과부하 방지 권장)
  "gemini-2.5-flash",        // 최신 안정 모델
  "gemini-2.5-pro",          // 최신 고급 추론 모델
  "gemini-2.0-flash-exp",    // 실험 모델
  "gemini-1.5-flash",        // 빠르고 효율적
  "gemini-1.5-pro",          // 복잡한 추론 작업
  "gemini-1.0-pro"           // 레거시 안정 버전
] as const;

export type GeminiModelOption = typeof GEMINI_MODEL_OPTIONS[number];

// 그룹 채팅방 테이블
export const groupChats = pgTable("group_chats", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 100 }), // 선택사항으로 변경
  createdBy: varchar("created_by").references(() => users.id).notNull(),
  isResponseBlocked: boolean("is_response_blocked").default(false), // 챗봇 응답 중 다른 사용자 입력 차단
  currentRespondingAgent: integer("current_responding_agent"), // 현재 응답 중인 에이전트 ID
  responseStartedAt: timestamp("response_started_at"), // 응답 시간
  languageLevel: integer("language_level"), // 챗봇 언어 레벨 (null=미적용, 1-6단계)
  provider: varchar("provider", { length: 20 }).default("openai"), // LLM 제공자 (openai, gemini)
  model: varchar("model", { length: 50 }).default("gpt-4o-mini"), // 모델 선택 (provider에 따라 다름)
  temperature: numeric("temperature", { precision: 3, scale: 2 }).default("1.00"), // Temperature 설정 (0.00 ~ 2.00)
  metaPrompt: text("meta_prompt"), // 대화방별 메타 프롬프트 (시스템 프롬프트)
  customUnifiedPrompt: text("custom_unified_prompt"), // 커스텀 통합 시스템 프롬프트
  customScenarioPrompt: text("custom_scenario_prompt"), // 커스텀 전체 시나리오 프롬프트
  customMatrixPrompt: text("custom_matrix_prompt"), // 커스텀 관계 매트릭스 프롬프트
  relationshipMatrix: jsonb("relationship_matrix"), // 챗봇 간 관계 매트릭스 (OpenAI 생성)
  matrixGeneratedAt: timestamp("matrix_generated_at"), // 관계 매트릭스 생성 시간
  assistantId: text("assistant_id"), // OpenAI Assistant ID (채팅방별 전용)
  threadId: text("thread_id"), // OpenAI Thread ID (채팅방별 대화 컨텍스트)
  visibility: varchar("visibility", { length: 20 }).default("private"), // 공개 범위: 'public', 'private'
  embedEnabled: boolean("embed_enabled").default(false), // 웹 임베드 활성화 여부
  sharingMode: varchar("sharing_mode", { length: 20 }).default("shared"), // 공유 모드: 'shared' (실제 방 공유), 'template' (설정만 공유)
  embedCode: varchar("embed_code", { length: 100 }), // 웹 임베드용 고유 코드 (UUID)
  allowedDomains: jsonb("allowed_domains"), // 임베드 허용 도메인 목록 (배열)
  callnaskEnabled: boolean("callnask_enabled").default(false), // CallNAsk 모드 활성화 여부 (로그인 없이 캐릭터 호출 가능)
  callnaskConfig: jsonb("callnask_config"), // CallNAsk 설정 (maxAgents, allowedCategories, rateLimitSettings)
  isCallnaskTemplate: boolean("is_callnask_template").default(false), // CallNAsk 템플릿 여부 (true=복사 가능한 원본)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_group_chats_embed_code_unique").on(table.embedCode),
]);

// 그룹 채팅 참가자 테이블 (사용자)
export const groupChatMembers = pgTable("group_chat_members", {
  id: serial("id").primaryKey(),
  groupChatId: integer("group_chat_id").references(() => groupChats.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  joinedAt: timestamp("joined_at").defaultNow(),
  lastReadAt: timestamp("last_read_at"),
  unreadCount: integer("unread_count").default(0),
  firstViewedAt: timestamp("first_viewed_at"), // 사용자가 처음 채팅방을 연 시간 (null이면 NEW 뱃지 표시)
});

// 그룹 채팅 참가자 테이블 (챗봇)
export const groupChatAgents = pgTable("group_chat_agents", {
  id: serial("id").primaryKey(),
  groupChatId: integer("group_chat_id").references(() => groupChats.id).notNull(),
  agentId: integer("agent_id").references(() => agents.id).notNull(),
  addedAt: timestamp("added_at").defaultNow(),
});

// 그룹 채팅 내 사용자별 에이전트 설정 테이블 (관계, 언어)
export const groupChatUserAgentSettings = pgTable("group_chat_user_agent_settings", {
  id: serial("id").primaryKey(),
  groupChatId: integer("group_chat_id").references(() => groupChats.id).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  agentId: integer("agent_id").references(() => agents.id).notNull(),
  relationshipType: varchar("relationship_type").default("친구"), // 사용자와 에이전트 간의 관계
  languagePreference: varchar("language_preference").default("question_language"), // 에이전트 응답 언어 설정
  debateIntensity: numeric("debate_intensity", { precision: 3, scale: 2 }).default("0.50"), // 토론 강도 (0.0~1.0, 기본값 0.5 = 50%)
  customIntensity: boolean("custom_intensity").default(false), // 사용자가 직접 조정한 값인지 여부 (true: 사용자 설정, false: 에이전트 기본값 사용)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 관계 타입별 톤 패턴 테이블 (240가지 조합)
export const relationshipTones = pgTable("relationship_tones", {
  id: serial("id").primaryKey(),
  relationshipType: varchar("relationship_type", { length: 50 }).notNull(), // assistant, mentor, tutor, etc.
  toneName: varchar("tone_name", { length: 100 }).notNull(), // 간결형, 격려형, 공감형 등
  basePrompt: text("base_prompt").notNull(), // 기본 프롬프트 템플릿
  toneInstructions: text("tone_instructions").notNull(), // 톤별 세부 지침
  exampleResponse: text("example_response"), // 예시 응답 (선택)
  dialogueGoal: text("dialogue_goal"), // 대화 목적 (예: "감정 공유와 지지 표현")
  thinkingPattern: text("thinking_pattern"), // 사고 패턴 (예: "느낌 → 공감 → 공유 → 연결 질문")
  promptTemplate: text("prompt_template").array(), // 응답 구조 템플릿 배열
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_relationship_tone").on(table.relationshipType, table.toneName),
]);

// 🎭 Tone Application Audit Log (프롬프트 변화 추적)
export const toneApplicationLogs = pgTable("tone_application_logs", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").references(() => agents.id, { onDelete: 'cascade' }).notNull(), // 에이전트 ID
  agentName: varchar("agent_name", { length: 100 }).notNull(), // 에이전트 이름
  relationshipType: varchar("relationship_type", { length: 50 }).notNull(), // 관계 타입
  characterArchetype: varchar("character_archetype", { length: 50 }), // 캐릭터 아키타입
  debateIntensity: numeric("debate_intensity", { precision: 3, scale: 2 }), // 톤 강도 (0.0~1.0)
  beforePrompt: text("before_prompt").notNull(), // 톤 적용 전 프롬프트
  afterPrompt: text("after_prompt").notNull(), // 톤 적용 후 프롬프트 (최종)
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }), // 관련 사용자 (선택)
  groupChatId: integer("group_chat_id").references(() => groupChats.id, { onDelete: 'cascade' }), // 관련 그룹 채팅 (선택)
  messageId: integer("message_id"), // 관련 메시지 ID (선택)
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_tone_logs_agent").on(table.agentId, table.createdAt),
  index("idx_tone_logs_relationship").on(table.relationshipType, table.createdAt),
]);

// 🎭 캐릭터별 말하는 방식 패턴 (자동 생성)
export const characterSpeakingPatterns = pgTable("character_speaking_patterns", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").references(() => agents.id).notNull(),
  characterName: varchar("character_name", { length: 100 }).notNull(),
  realExamples: text("real_examples").array(), // 실제 대사 패턴 ["그건...", "론이 말했듯이"]
  prohibitedPhrases: text("prohibited_phrases").array(), // 금지 표현 ["흥미로운", "일반적으로"]
  toneExamples: text("tone_examples").array(), // 🆕 대화형 말투 패턴 3-5개 ["그건... 고래처럼 말이에요.", "저는 우영우, 거꾸로 해도 우영우예요."]
  fewShotBad: text("few_shot_bad"), // 나쁜 예시
  fewShotGood: text("few_shot_good"), // 좋은 예시
  
  // 🆕 문장 구조 변형 시스템
  structuralPatterns: jsonb("structural_patterns"), // 문장 구조 규칙 { sentenceType, punctuationStyle, wordOrder, etc. }
  weightedPhrases: jsonb("weighted_phrases"), // 가중치 포함 표현들 [{ phrase: "아주", weight: 0.8, category: "강조" }]
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("idx_character_pattern_agent").on(table.agentId),
]);

// 🔄 표현 사용 이력 (순환 선택용)
export const phraseUsageHistory = pgTable("phrase_usage_history", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  conversationId: integer("conversation_id").references(() => conversations.id, { onDelete: 'cascade' }),
  groupChatId: integer("group_chat_id").references(() => groupChats.id, { onDelete: 'cascade' }),
  usedPhrases: text("used_phrases").array().notNull(), // 최근 5개 턴에서 사용한 표현들
  lastUpdatedAt: timestamp("last_updated_at").defaultNow(),
}, (table) => [
  index("idx_phrase_history_agent_conv").on(table.agentId, table.conversationId),
  index("idx_phrase_history_agent_group").on(table.agentId, table.groupChatId),
]);

// 토론 주제 테이블
export const debateTopics = pgTable("debate_topics", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description").notNull(),
  category: varchar("category").notNull(),
  gradeLevel: varchar("grade_level").notNull(),
  subject: varchar("subject").notNull(),
  expertAgentIds: jsonb("expert_agent_ids").default(JSON.stringify([])),
  moderatorAgentId: integer("moderator_agent_id"),
  estimatedDuration: integer("estimated_duration").default(30),
  isActive: boolean("is_active").default(true),
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 🎭 캐릭터 아바타 테이블 - 멀티모달 감정 표현 아바타 시스템
export const characterAvatars = pgTable("character_avatars", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").references(() => agents.id, { onDelete: 'cascade' }),
  groupChatId: integer("group_chat_id").references(() => groupChats.id, { onDelete: 'cascade' }), // CallNAsk 용 그룹채팅 ID
  characterId: varchar("character_id", { length: 50 }).notNull(), // 캐릭터 식별자 (예: yoon, lee, trump, kim)
  characterName: varchar("character_name", { length: 100 }).notNull(), // 캐릭터 표시 이름 (예: 윤석열, 이재명)
  spriteSheetUrl: varchar("sprite_sheet_url", { length: 500 }), // 원본 4x4 스프라이트 시트 URL (16감정)
  // 16가지 감정 이미지 URL (4x4 그리드 슬라이싱)
  neutralImageUrl: varchar("neutral_image_url", { length: 500 }),     // 기본/중립
  happyImageUrl: varchar("happy_image_url", { length: 500 }),         // 기쁨
  sadImageUrl: varchar("sad_image_url", { length: 500 }),             // 슬픔
  angryImageUrl: varchar("angry_image_url", { length: 500 }),         // 화남
  determinedImageUrl: varchar("determined_image_url", { length: 500 }), // 단호
  worriedImageUrl: varchar("worried_image_url", { length: 500 }),     // 고민
  thinkingImageUrl: varchar("thinking_image_url", { length: 500 }),   // 생각중
  questioningImageUrl: varchar("questioning_image_url", { length: 500 }), // 물음
  listeningImageUrl: varchar("listening_image_url", { length: 500 }), // 경청
  surprisedImageUrl: varchar("surprised_image_url", { length: 500 }), // 놀람
  shockedImageUrl: varchar("shocked_image_url", { length: 500 }),     // 충격
  embarrassedImageUrl: varchar("embarrassed_image_url", { length: 500 }), // 부끄러움
  flusteredImageUrl: varchar("flustered_image_url", { length: 500 }), // 당황
  confidentImageUrl: varchar("confident_image_url", { length: 500 }), // 자신감
  arrogantImageUrl: varchar("arrogant_image_url", { length: 500 }),   // 거만
  tiredImageUrl: varchar("tired_image_url", { length: 500 }),         // 피곤
  rowIndex: integer("row_index").default(0), // 스프라이트 시트에서의 행 인덱스 (0-3)
  promptUsed: text("prompt_used"), // 이미지 생성에 사용된 프롬프트
  generatedAt: timestamp("generated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_character_avatars_agent").on(table.agentId),
  index("idx_character_avatars_group_chat").on(table.groupChatId),
  uniqueIndex("idx_character_avatars_agent_char").on(table.agentId, table.characterId),
  uniqueIndex("idx_character_avatars_group_char").on(table.groupChatId, table.characterId),
]);

// 그룹 채팅 메시지 테이블
export const groupChatMessages = pgTable("group_chat_messages", {
  id: serial("id").primaryKey(),
  groupChatId: integer("group_chat_id").references(() => groupChats.id).notNull(),
  content: text("content").notNull(),
  senderId: varchar("sender_id"), // 사용자 ID 또는 null (챗봇인 경우)
  senderName: varchar("sender_name"), // Step 48: 사용자 이름 (게스트 채팅용)
  agentId: integer("agent_id"), // 챗봇 ID 또는 null (사용자인 경우)
  agentName: varchar("agent_name"), // Step 48: 에이전트 이름 (앵커 등 가상 화자용)
  senderType: varchar("sender_type").default("user"), // 'user', 'agent', 'system'
  targetAgentIds: jsonb("target_agent_ids").default("[]"), // 특정 챗봇들을 대상으로 한 메시지인 경우
  replyOrder: integer("reply_order"), // 여러 챗봇이 순서대로 답할 때의 순서
  userTurnId: varchar("user_turn_id"), // 사용자 질문 턴 ID (중복 방지용)
  isContinuation: boolean("is_continuation").default(false), // 연속 메시지 여부 (긴 메시지 분할 시)
  splitType: varchar("split_type", { length: 20 }).default("paragraph"), // 분할 타입: 'paragraph' (단락), 'length' (길이), 'topic' (주제)
  sources: jsonb("sources"), // Google Search 출처 [{title: string, url: string}]
  emotion: varchar("emotion", { length: 20 }).default("neutral"), // 🎭 감정 태그: happy, angry, sad, neutral
  suggestionChips: jsonb("suggestion_chips"), // 🎭 Step 46: 추천 화자 칩 [{name, title, action, desc}]
  createdAt: timestamp("created_at").defaultNow(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => conversations.id).notNull(),
  content: text("content").notNull(),
  isFromUser: boolean("is_from_user").notNull(),
  templateUsed: varchar("template_used"), // 사용된 템플릿 ID
  isGreeting: boolean("is_greeting").default(false), // 인사 메시지 여부
  isSynthesized: boolean("is_synthesized").default(false), // 종합 의견 여부
  responseQuality: varchar("response_quality"), // low, medium, high
  similarityScore: numeric("similarity_score"), // 유사도 점수
  isContinuation: boolean("is_continuation").default(false), // 연속 메시지 여부 (긴 메시지 분할 시)
  sources: jsonb("sources"), // Google Search 출처 [{title: string, url: string}]
  createdAt: timestamp("created_at").defaultNow(),
});

// 응답 템플릿 테이블
export const responseTemplates = pgTable("response_templates", {
  id: serial("id").primaryKey(),
  category: varchar("category").notNull(), // greeting, transition, closing
  template: text("template").notNull(),
  agentType: varchar("agent_type"), // formal, friendly, expert
  language: varchar("language").default("ko"),
  usageCount: integer("usage_count").default(0),
  lastUsed: timestamp("last_used"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// 대화별 템플릿 사용 이력
export const conversationTemplateHistory = pgTable("conversation_template_history", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => conversations.id).notNull(),
  templateId: integer("template_id").references(() => responseTemplates.id).notNull(),
  messageId: integer("message_id").references(() => messages.id).notNull(),
  usedAt: timestamp("used_at").defaultNow(),
});

// 면책 조항 표시 이력
export const disclaimerHistory = pgTable("disclaimer_history", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => conversations.id).notNull(),
  disclaimerType: varchar("disclaimer_type").notNull(), // api_missing, permission_notice, privacy_notice
  shownAt: timestamp("shown_at").defaultNow(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").references(() => agents.id).notNull(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  content: text("content"), // Extracted text content
  uploadedBy: varchar("uploaded_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  // Document metadata fields
  type: varchar("type"), // Document type/category
  description: text("description"), // Document description
  status: varchar("status").default("active"), // Document status
  connectedAgents: jsonb("connected_agents").default(JSON.stringify([])), // Connected agents list
  isVisibleToUsers: boolean("is_visible_to_users").default(true), // 일반 사용자에게 보이는지 여부
  isUsedForTraining: boolean("is_used_for_training").default(true), // 에이전트 학습에 사용할지 여부
  visionAnalysis: jsonb("vision_analysis"), // Vision API analysis metadata (user-driven)
  // Expected shape: {
  //   diagramCount: number,             // Number of detected diagrams/charts
  //   recommendVision: boolean,         // Whether Vision API is recommended (for backward compatibility)
  //   recommendationLevel: string,      // 불필요/선택적/추천/적극 추천 (unnecessary/optional/recommended/highly_recommended)
  //   visionScore: number,              // 0-10 score indicating diagram density
  //   estimatedCost: number,            // Estimated cost in USD (with Sharp optimization)
  //   hasVisionProcessed: boolean,      // Whether Vision API has been run
  //   reasons?: string[],               // Reasons for recommendation (before Vision processing)
  //   benefits?: string[]               // Benefits gained after Vision processing
  // }
  updatedAt: timestamp("updated_at").defaultNow(),
  expiresAt: timestamp("expires_at"), // Smart TTL: 날짜 기반 또는 카테고리 기반 만료 시간
});

// RAG chunks table for document-based knowledge retrieval
export const agentDocumentChunks = pgTable("agent_document_chunks", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").references(() => documents.id, { onDelete: 'cascade' }).notNull(),
  agentId: integer("agent_id").references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  chunkIndex: integer("chunk_index").notNull(), // Position of chunk in document
  content: text("content").notNull(), // The chunk text content
  keywords: jsonb("keywords").default(JSON.stringify([])), // Extracted keywords for search
  metadata: jsonb("metadata").default(JSON.stringify({})), // Additional metadata (char_count, word_count, etc)
  embedding: vector("embedding"), // Vector embedding for semantic search (3072 dimensions for text-embedding-3-large)
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"), // Smart TTL: 부모 문서의 만료 시간 상속
}, (table) => [
  index("idx_chunks_document").on(table.documentId),
  index("idx_chunks_agent").on(table.agentId),
]);

export const agentStats = pgTable("agent_stats", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").references(() => agents.id).notNull().unique(),
  activeUsers: integer("active_users").default(0),
  totalMessages: integer("total_messages").default(0),
  usagePercentage: integer("usage_percentage").default(0),
  ranking: integer("ranking").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const messageReactions = pgTable("message_reactions", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").references(() => messages.id).notNull(),
  userId: text("user_id").references(() => users.id).notNull(),
  reaction: text("reaction").notNull(), // "👍" or "👎"
  createdAt: timestamp("created_at").defaultNow(),
});

// Organization categories table for dynamic organization management
export const organizationCategories = pgTable("organization_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  upperCategory: text("upper_category"),
  lowerCategory: text("lower_category"), 
  detailCategory: text("detail_category"),
  createdAt: timestamp("created_at").defaultNow(),
});

// QA Improvement Comments table for storing improvement comments
export const qaImprovementComments = pgTable("qa_improvement_comments", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => conversations.id).notNull(),
  comment: text("comment").notNull(),
  createdBy: text("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// 뉴스 캐시 시스템 - Google News RSS Cache
// ============================================================================

// 뉴스 캐시 테이블 - RSS 피드 데이터 영구 저장
export const newsCache = pgTable("news_cache", {
  id: serial("id").primaryKey(),
  section: varchar("section", { length: 50 }).notNull(), // home, korea, world, business, etc.
  newsId: varchar("news_id", { length: 100 }).notNull(), // 뉴스 고유 ID
  title: text("title").notNull(),
  verdictQuestion: text("verdict_question").notNull(),
  source: varchar("source", { length: 100 }),
  link: text("link").notNull(),
  pubDate: varchar("pub_date", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  sectionIdx: index("news_cache_section_idx").on(table.section),
  newsIdIdx: uniqueIndex("news_cache_news_id_idx").on(table.newsId),
}));

// 뉴스 캐시 메타 정보 - 섹션별 업데이트 시간 관리
export const newsCacheMeta = pgTable("news_cache_meta", {
  id: serial("id").primaryKey(),
  section: varchar("section", { length: 50 }).notNull().unique(),
  lastUpdated: timestamp("last_updated").notNull(),
  nextUpdate: timestamp("next_update").notNull(),
  itemCount: integer("item_count").default(0),
});

export const insertNewsCacheSchema = createInsertSchema(newsCache).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNewsCache = z.infer<typeof insertNewsCacheSchema>;
export type NewsCache = typeof newsCache.$inferSelect;

export const insertNewsCacheMetaSchema = createInsertSchema(newsCacheMeta).omit({ id: true });
export type InsertNewsCacheMeta = z.infer<typeof insertNewsCacheMetaSchema>;
export type NewsCacheMeta = typeof newsCacheMeta.$inferSelect;

// ============================================================================
// 통합된 채팅 시스템 - Unified Chat System
// ============================================================================

// 통합된 채팅방 테이블 - 모든 종류의 채팅방을 하나로 관리
export const unifiedChats = pgTable("unified_chats", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 100 }), // 채팅방 제목 (그룹 채팅의 경우)
  type: varchar("type").notNull().default("one_on_one"), // "one_on_one", "group", "multi_agent"
  createdBy: varchar("created_by").references(() => users.id).notNull(), // 채팅방 생성자
  isResponseBlocked: boolean("is_response_blocked").default(false), // 챗봇 응답 중 다른 사용자 입력 차단
  currentRespondingAgent: integer("current_responding_agent"), // 현재 응답 중인 에이전트 ID
  responseStartedAt: timestamp("response_started_at"), // 응답 시작 시간
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
});

// 통합된 채팅 참가자 테이블 - 사용자와 에이전트를 하나로 관리
export const chatParticipants = pgTable("chat_participants", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id").references(() => unifiedChats.id).notNull(),
  participantType: varchar("participant_type").notNull(), // "user" or "agent"
  userId: varchar("user_id").references(() => users.id), // 사용자인 경우
  agentId: integer("agent_id").references(() => agents.id), // 에이전트인 경우
  joinedAt: timestamp("joined_at").defaultNow(),
  lastReadAt: timestamp("last_read_at"),
  isActive: boolean("is_active").default(true), // 참가자가 활성 상태인지
});

// 통합된 채팅 메시지 테이블 - 모든 메시지를 하나로 관리
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id").references(() => unifiedChats.id).notNull(),
  content: text("content").notNull(),
  senderType: varchar("sender_type").notNull(), // "user" or "agent"
  senderId: varchar("sender_id"), // 사용자 ID (사용자인 경우)
  agentId: integer("agent_id"), // 에이전트 ID (에이전트인 경우)
  targetAgentIds: jsonb("target_agent_ids").default("[]"), // 특정 에이전트들을 대상으로 한 메시지
  // 기존 메시지 필드들 유지
  templateUsed: varchar("template_used"), // 사용된 템플릿 ID
  isGreeting: boolean("is_greeting").default(false), // 인사 메시지 여부
  isSynthesized: boolean("is_synthesized").default(false), // 종합 의견 여부
  responseQuality: varchar("response_quality"), // low, medium, high
  similarityScore: numeric("similarity_score"), // 유사도 점수
  createdAt: timestamp("created_at").defaultNow(),
});

// 대화 분석 결과 테이블 - 대화방별 시간대별 카테고리 분석 데이터 저장
export const conversationAnalytics = pgTable("conversation_analytics", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").references(() => conversations.id).notNull(), // 대화방 ID
  userId: varchar("user_id").references(() => users.id).notNull(),
  periodType: varchar("period_type").notNull(), // "week", "month", "quarter", "year"
  periodStart: timestamp("period_start").notNull(), // 분석 기간 시작
  periodEnd: timestamp("period_end").notNull(), // 분석 기간 종료
  categoryData: jsonb("category_data").notNull(), // 카테고리별 데이터 { "고민": 30, "질문": 25, "연애": 15, ... }
  totalMessages: integer("total_messages").notNull().default(0), // 해당 기간의 총 메시지 수
  lastAnalyzedMessageId: integer("last_analyzed_message_id"), // 마지막 분석 메시지 ID (증분 분석용)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
  managedAgents: many(agents),
  uploadedDocuments: many(documents),
}));

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  parent: one(organizations, {
    fields: [organizations.parentId],
    references: [organizations.id],
    relationName: "parentChild",
  }),
  children: many(organizations, {
    relationName: "parentChild",
  }),
  agents: many(agents),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  manager: one(users, {
    fields: [agents.managerId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [agents.organizationId],
    references: [organizations.id],
  }),
  conversations: many(conversations),
  documents: many(documents),
  stats: one(agentStats, {
    fields: [agents.id],
    references: [agentStats.agentId],
  }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  agent: one(agents, {
    fields: [conversations.agentId],
    references: [agents.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  reactions: many(messageReactions),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  agent: one(agents, {
    fields: [documents.agentId],
    references: [agents.id],
  }),
  uploadedBy: one(users, {
    fields: [documents.uploadedBy],
    references: [users.id],
  }),
}));

export const agentStatsRelations = relations(agentStats, ({ one }) => ({
  agent: one(agents, {
    fields: [agentStats.agentId],
    references: [agents.id],
  }),
}));

export const messageReactionsRelations = relations(messageReactions, ({ one }) => ({
  message: one(messages, {
    fields: [messageReactions.messageId],
    references: [messages.id],
  }),
  user: one(users, {
    fields: [messageReactions.userId],
    references: [users.id],
  }),
}));

export const qaImprovementCommentsRelations = relations(qaImprovementComments, ({ one }) => ({
  conversation: one(conversations, {
    fields: [qaImprovementComments.conversationId],
    references: [conversations.id],
  }),
  createdBy: one(users, {
    fields: [qaImprovementComments.createdBy],
    references: [users.id],
  }),
}));

// 그룹 채팅 관련 Relations
export const groupChatsRelations = relations(groupChats, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [groupChats.createdBy],
    references: [users.id],
  }),
  members: many(groupChatMembers),
  agents: many(groupChatAgents),
  messages: many(groupChatMessages),
}));

export const groupChatMembersRelations = relations(groupChatMembers, ({ one }) => ({
  groupChat: one(groupChats, {
    fields: [groupChatMembers.groupChatId],
    references: [groupChats.id],
  }),
  user: one(users, {
    fields: [groupChatMembers.userId],
    references: [users.id],
  }),
}));

export const groupChatAgentsRelations = relations(groupChatAgents, ({ one }) => ({
  groupChat: one(groupChats, {
    fields: [groupChatAgents.groupChatId],
    references: [groupChats.id],
  }),
  agent: one(agents, {
    fields: [groupChatAgents.agentId],
    references: [agents.id],
  }),
}));

export const groupChatMessagesRelations = relations(groupChatMessages, ({ one }) => ({
  groupChat: one(groupChats, {
    fields: [groupChatMessages.groupChatId],
    references: [groupChats.id],
  }),
  sender: one(users, {
    fields: [groupChatMessages.senderId],
    references: [users.id],
  }),
  agent: one(agents, {
    fields: [groupChatMessages.agentId],
    references: [agents.id],
  }),
}));

// 통합 채팅 시스템 Relations
export const unifiedChatsRelations = relations(unifiedChats, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [unifiedChats.createdBy],
    references: [users.id],
  }),
  participants: many(chatParticipants),
  messages: many(chatMessages),
}));

export const chatParticipantsRelations = relations(chatParticipants, ({ one }) => ({
  chat: one(unifiedChats, {
    fields: [chatParticipants.chatId],
    references: [unifiedChats.id],
  }),
  user: one(users, {
    fields: [chatParticipants.userId],
    references: [users.id],
  }),
  agent: one(agents, {
    fields: [chatParticipants.agentId],
    references: [agents.id],
  }),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  chat: one(unifiedChats, {
    fields: [chatMessages.chatId],
    references: [unifiedChats.id],
  }),
  sender: one(users, {
    fields: [chatMessages.senderId],
    references: [users.id],
  }),
  agent: one(agents, {
    fields: [chatMessages.agentId],
    references: [agents.id],
  }),
}));

// Insert schemas
export const insertAgentSchema = createInsertSchema(agents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  // 기본 정보
  name: z.string().min(1, "에이전트 이름은 필수입니다").max(20, "에이전트 이름은 최대 20자입니다"),
  description: z.string().max(200, "설명은 최대 200자입니다"),
  creatorId: z.string().min(1, "생성자 ID는 필수입니다"),
  
  // 카테고리 및 상태
  upperCategory: z.string().optional(),
  lowerCategory: z.string().optional(),
  detailCategory: z.string().optional(),
  status: z.enum(["active", "inactive", "pending"]).optional(),
  
  // 모델 및 응답 설정
  llmModel: z.string().optional(),
  chatbotType: z.enum(["strict-doc", "doc-fallback-llm", "general-llm", "llm-with-web-search"]).optional(),
  maxInputLength: z.number().min(1).max(10000).optional(),
  maxResponseLength: z.number().min(1).max(10000).optional(),
  
  // 웹 검색 관련 설정
  webSearchEnabled: z.boolean().optional(),
  searchEngine: z.string().optional(),
  bingApiKey: z.string().optional(),
  
  // 페르소나 설정
  personaNickname: z.string().optional(),
  speechStyle: z.string().optional(),
  personality: z.string().optional(),
  forbiddenResponseStyle: z.string().optional(),
  additionalPrompt: z.string().optional(),
  extraPrompt: z.string().optional(),
  
  // 🎭 대화 스타일 및 관계 설정
  rolePosition: z.enum(ROLE_POSITIONS).optional(),
  defaultUserRelationship: z.enum(RELATIONSHIP_TYPES).optional(),
  
  // 파일 업로드 설정
  documentType: z.string().optional(),
  maxFileSize: z.string().optional(),
  
  // 문서 설정
  uploadFormats: z.array(z.string()).optional(),
  uploadMethod: z.enum(["dragdrop", "onedrive"]).optional(),
  maxFileCount: z.number().min(1).max(1000).optional(),
  maxFileSizeMB: z.number().min(1).max(1000).optional(),
  documentManagerIds: z.array(z.string()).optional(),
  
  // 권한 설정
  visibility: z.enum(["private", "custom", "group", "organization"]).optional(),
  allowedGroups: z.array(z.string()).optional(),
  agentManagerIds: z.array(z.string()).optional(),
  agentEditorIds: z.array(z.string()).optional(),
  
  // 기존 UI 관련 필드들
  icon: z.string().optional(),
  backgroundColor: z.string().optional(),
  isCustomIcon: z.boolean().optional(),
  
  // 에이전트 유형 정보
  type: z.string().optional(),
  
  // 레거시 필드들 (호환성 유지)
  category: z.string().optional(),
  organizationId: z.number().optional(),
  isActive: z.boolean().optional(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  lastMessageAt: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
  templateUsed: true,
  isGreeting: true,
  isSynthesized: true,
  responseQuality: true,
  similarityScore: true,
});

export const insertQAImprovementCommentSchema = createInsertSchema(qaImprovementComments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMessageReactionSchema = createInsertSchema(messageReactions).omit({
  id: true,
  createdAt: true,
});

export const insertResponseTemplateSchema = createInsertSchema(responseTemplates).omit({
  id: true,
  usageCount: true,
  lastUsed: true,
  createdAt: true,
});

export const insertConversationTemplateHistorySchema = createInsertSchema(conversationTemplateHistory).omit({
  id: true,
  usedAt: true,
});

export const insertDisclaimerHistorySchema = createInsertSchema(disclaimerHistory).omit({
  id: true,
  shownAt: true,
});

export const insertGroupChatSchema = createInsertSchema(groupChats).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastMessageAt: true,
});

export const insertGroupChatMemberSchema = createInsertSchema(groupChatMembers).omit({
  id: true,
  joinedAt: true,
});

export const insertGroupChatAgentSchema = createInsertSchema(groupChatAgents).omit({
  id: true,
  addedAt: true,
});

export const insertGroupChatUserAgentSettingsSchema = createInsertSchema(groupChatUserAgentSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  relationshipType: z.string().min(1, "관계 타입은 필수입니다").optional(),
  languagePreference: z.string().min(1, "언어 설정은 필수입니다").optional(),
  debateIntensity: z.string().refine(
    (val) => {
      const num = parseFloat(val);
      return !isNaN(num) && num >= 0 && num <= 1;
    },
    { message: "토론 강도는 0.0에서 1.0 사이여야 합니다" }
  ).optional(),
});

export const insertRelationshipToneSchema = createInsertSchema(relationshipTones).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  relationshipType: z.string().min(1, "관계 타입은 필수입니다"),
  toneName: z.string().min(1, "톤 이름은 필수입니다"),
  basePrompt: z.string().min(1, "기본 프롬프트는 필수입니다"),
  toneInstructions: z.string().min(1, "톤 지침은 필수입니다"),
  exampleResponse: z.string().optional(),
  dialogueGoal: z.string().optional(),
  thinkingPattern: z.string().optional(),
  promptTemplate: z.array(z.string()).optional(),
});

export const insertToneApplicationLogSchema = createInsertSchema(toneApplicationLogs).omit({
  id: true,
  createdAt: true,
}).extend({
  agentId: z.number().min(1, "에이전트 ID는 필수입니다"),
  agentName: z.string().min(1, "에이전트 이름은 필수입니다"),
  relationshipType: z.string().min(1, "관계 타입은 필수입니다"),
  beforePrompt: z.string().min(1, "적용 전 프롬프트는 필수입니다"),
  afterPrompt: z.string().min(1, "적용 후 프롬프트는 필수입니다"),
  characterArchetype: z.string().optional(),
  debateIntensity: z.number().min(0).max(1).optional(),
  userId: z.string().optional(),
  groupChatId: z.number().optional(),
  messageId: z.number().optional(),
});

export const insertDebateTopicSchema = createInsertSchema(debateTopics).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// 🎭 캐릭터 아바타 Insert Schema
export const insertCharacterAvatarSchema = createInsertSchema(characterAvatars).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  generatedAt: true,
});

// 통합 채팅 시스템 Insert Schemas
export const insertUnifiedChatSchema = createInsertSchema(unifiedChats).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastMessageAt: true,
}).extend({
  title: z.string().max(100, "채팅방 제목은 최대 100자입니다").optional(),
  type: z.enum(["one_on_one", "group", "multi_agent"]).optional(),
  createdBy: z.string().min(1, "생성자 ID는 필수입니다"),
});

export const insertChatParticipantSchema = createInsertSchema(chatParticipants).omit({
  id: true,
  joinedAt: true,
}).extend({
  chatId: z.number().min(1, "채팅방 ID는 필수입니다"),
  participantType: z.enum(["user", "agent"], { required_error: "참가자 타입은 필수입니다" }),
  userId: z.string().optional(),
  agentId: z.number().optional(),
}).refine(
  (data) => (data.participantType === "user" && data.userId) || (data.participantType === "agent" && data.agentId),
  {
    message: "사용자인 경우 userId가, 에이전트인 경우 agentId가 필요합니다",
    path: ["userId", "agentId"],
  }
);

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
  templateUsed: true,
  isGreeting: true,
  isSynthesized: true,
  responseQuality: true,
  similarityScore: true,
}).extend({
  chatId: z.number().min(1, "채팅방 ID는 필수입니다"),
  content: z.string().min(1, "메시지 내용은 필수입니다"),
  senderType: z.enum(["user", "agent"], { required_error: "발신자 타입은 필수입니다" }),
  senderId: z.string().optional(),
  agentId: z.number().optional(),
  targetAgentIds: z.array(z.number()).optional(),
}).refine(
  (data) => (data.senderType === "user" && data.senderId) || (data.senderType === "agent" && data.agentId),
  {
    message: "사용자인 경우 senderId가, 에이전트인 경우 agentId가 필요합니다",
    path: ["senderId", "agentId"],
  }
);

export const insertConversationAnalyticsSchema = createInsertSchema(conversationAnalytics).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  conversationId: z.number().min(1, "대화방 ID는 필수입니다"),
  userId: z.string().min(1, "사용자 ID는 필수입니다"),
  periodType: z.enum(["week", "month", "quarter", "year"], { required_error: "기간 타입은 필수입니다" }),
  categoryData: z.record(z.number()).refine(
    (data) => Object.keys(data).length > 0,
    { message: "최소 하나의 카테고리 데이터가 필요합니다" }
  ),
  totalMessages: z.number().min(0, "총 메시지 수는 0 이상이어야 합니다"),
  lastAnalyzedMessageId: z.number().optional(),
});

export const insertGroupChatMessageSchema = createInsertSchema(groupChatMessages).omit({
  id: true,
  createdAt: true,
});

export const insertScenarioSummarySchema = createInsertSchema(scenarioSummaries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOrganizationCategorySchema = createInsertSchema(organizationCategories).omit({
  id: true,
  createdAt: true,
});

export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true,
  createdAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  // 기본 정보
  name: z.string().min(1, "이름은 필수입니다").max(50, "이름은 최대 50자입니다").optional(),
  email: z.string().email("올바른 이메일 형식이어야 합니다").max(100, "이메일은 최대 100자입니다").optional(),
  passwordHash: z.string().optional(),
  
  // 카테고리 및 소속
  upperCategory: z.string().optional(),
  lowerCategory: z.string().optional(),
  detailCategory: z.string().optional(),
  groups: z.array(z.string()).optional(),
  usingAgents: z.array(z.string()).optional(),
  managedCategories: z.array(z.string()).optional(),
  managedAgents: z.array(z.string()).optional(),
  
  // 역할 및 권한
  role: z.enum([
    "master_admin", 
    "operation_admin", 
    "category_admin", 
    "agent_admin", 
    "qa_admin", 
    "doc_admin", 
    "user", 
    "external"
  ], {
    required_error: "시스템 역할은 필수입니다",
    invalid_type_error: "올바른 시스템 역할을 선택해주세요"
  }),
  position: z.string().optional(), // 조직 내 직책 (예: 학과장, 조교, 연구원, 매니저 등)
  permissions: z.record(z.boolean()).optional(),
  
  // 계정 상태
  status: z.enum(["active", "inactive", "locked", "pending", "deleted"]).optional(),
  lockedReason: z.string().optional(),
  
  // 활동 및 인증
  loginFailCount: z.number().min(0).optional(),
  lastLoginIP: z.string().optional(),
  authProvider: z.enum(["email", "sso", "oauth"]).optional(),
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect & {
  upperCategory?: string;
  lowerCategory?: string;
  detailCategory?: string;
};
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Agent = typeof agents.$inferSelect & {
  managerFirstName?: string | null;
  managerLastName?: string | null;
  managerUsername?: string | null;
  organizationName?: string | null;
  organizationType?: string | null;
  documentCount?: number;
  userCount?: number;
  messageCount?: number;
};
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type AgentStats = typeof agentStats.$inferSelect;
export type MessageReaction = typeof messageReactions.$inferSelect;
export type InsertMessageReaction = z.infer<typeof insertMessageReactionSchema>;
export type OrganizationCategory = typeof organizationCategories.$inferSelect;
export type InsertOrganizationCategory = z.infer<typeof insertOrganizationCategorySchema>;
export type QAImprovementComment = typeof qaImprovementComments.$inferSelect;
export type InsertQAImprovementComment = z.infer<typeof insertQAImprovementCommentSchema>;

// 그룹 채팅 관련 타입들
export type GroupChat = typeof groupChats.$inferSelect;
export type InsertGroupChat = z.infer<typeof insertGroupChatSchema>;
export type GroupChatMember = typeof groupChatMembers.$inferSelect;
export type InsertGroupChatMember = z.infer<typeof insertGroupChatMemberSchema>;
export type GroupChatAgent = typeof groupChatAgents.$inferSelect;
export type InsertGroupChatAgent = z.infer<typeof insertGroupChatAgentSchema>;
export type GroupChatUserAgentSettings = typeof groupChatUserAgentSettings.$inferSelect;
export type InsertGroupChatUserAgentSettings = z.infer<typeof insertGroupChatUserAgentSettingsSchema>;
export type RelationshipTone = typeof relationshipTones.$inferSelect;
export type InsertRelationshipTone = z.infer<typeof insertRelationshipToneSchema>;
export type ToneApplicationLog = typeof toneApplicationLogs.$inferSelect;
export type InsertToneApplicationLog = z.infer<typeof insertToneApplicationLogSchema>;
export type DebateTopic = typeof debateTopics.$inferSelect;
export type InsertDebateTopic = z.infer<typeof insertDebateTopicSchema>;
export type GroupChatMessage = typeof groupChatMessages.$inferSelect;
export type InsertGroupChatMessage = z.infer<typeof insertGroupChatMessageSchema>;

// 🎭 캐릭터 아바타 타입들
export type CharacterAvatar = typeof characterAvatars.$inferSelect;
export type InsertCharacterAvatar = z.infer<typeof insertCharacterAvatarSchema>;

// 시나리오 요약 타입들
export type ScenarioSummaryRecord = typeof scenarioSummaries.$inferSelect;
export type InsertScenarioSummary = z.infer<typeof insertScenarioSummarySchema>;

// 캐릭터 말하는 방식 패턴 타입들
export type CharacterSpeakingPattern = typeof characterSpeakingPatterns.$inferSelect;
export type InsertCharacterSpeakingPattern = typeof characterSpeakingPatterns.$inferInsert;
export const insertCharacterSpeakingPatternSchema = createInsertSchema(characterSpeakingPatterns);

// 표현 사용 이력 타입들
export type PhraseUsageHistory = typeof phraseUsageHistory.$inferSelect;
export type InsertPhraseUsageHistory = typeof phraseUsageHistory.$inferInsert;
export const insertPhraseUsageHistorySchema = createInsertSchema(phraseUsageHistory);

// 새 템플릿 관련 타입들
export type ResponseTemplate = typeof responseTemplates.$inferSelect;
export type ConversationTemplateHistory = typeof conversationTemplateHistory.$inferSelect;
export type DisclaimerHistory = typeof disclaimerHistory.$inferSelect;
export type InsertResponseTemplate = z.infer<typeof insertResponseTemplateSchema>;
export type InsertConversationTemplateHistory = z.infer<typeof insertConversationTemplateHistorySchema>;
export type InsertDisclaimerHistory = z.infer<typeof insertDisclaimerHistorySchema>;

// User edit schema for admin interface
export const userEditSchema = z.object({
  name: z.string().min(1, "이름을 입력해주세요"),
  email: z.string().email("올바른 이메일 형식을 입력해주세요").optional(),
  upperCategory: z.string().optional(),
  lowerCategory: z.string().optional(),
  detailCategory: z.string().optional(),
  position: z.string().optional(),
  usingAgents: z.array(z.string()).optional(),
  managedCategories: z.array(z.string()).optional(),
  managedAgents: z.array(z.string()).optional(),
  organizationAffiliations: z.array(z.object({
    upperCategory: z.string(),
    lowerCategory: z.string(),
    detailCategory: z.string(),
    position: z.string(),
    systemRole: z.string()
  })).optional(),
  agentPermissions: z.array(z.object({
    agentName: z.string(),
    permissions: z.array(z.string())
  })).optional(),
  userMemo: z.string().optional(),
  role: z.enum([
    "master_admin", 
    "operation_admin", 
    "category_admin", 
    "agent_admin", 
    "qa_admin", 
    "doc_admin", 
    "user", 
    "external"
  ]),
  status: z.enum(["active", "inactive", "locked", "pending"]),
});

export type UserEditFormData = z.infer<typeof userEditSchema>;

// 통합 채팅 시스템 타입들
export type UnifiedChat = typeof unifiedChats.$inferSelect;
export type InsertUnifiedChat = z.infer<typeof insertUnifiedChatSchema>;
export type ChatParticipant = typeof chatParticipants.$inferSelect;
export type InsertChatParticipant = z.infer<typeof insertChatParticipantSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;

// 대화 분석 타입들
export type ConversationAnalytics = typeof conversationAnalytics.$inferSelect;
export type InsertConversationAnalytics = z.infer<typeof insertConversationAnalyticsSchema>;

// 카드 레이아웃 시스템 테이블
export const cardLayouts = pgTable("card_layouts", {
  id: serial("id").primaryKey(),
  cardType: varchar("card_type", { length: 20 }).notNull(), // 카드 타입
  targetType: varchar("target_type", { length: 20 }), // 타겟 타입
  targetId: integer("target_id"), // 타겟 ID
  gridWidth: integer("grid_width").notNull().default(1), // 그리드 너비
  gridHeight: integer("grid_height").notNull().default(1), // 그리드 높이
  positionX: integer("position_x").notNull().default(0), // X 위치
  positionY: integer("position_y").notNull().default(0), // Y 위치
  title: varchar("title", { length: 200 }),
  description: text("description"),
  imageUrl: varchar("image_url", { length: 500 }),
  backgroundColor: varchar("background_color", { length: 50 }),
  priority: integer("priority").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const cardFolders = pgTable("card_folders", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 100 }).notNull(),
  description: text("description"),
  image: varchar("image", { length: 500 }), // 폴더 커버 이미지 URL
  createdBy: varchar("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const cardItems = pgTable("card_items", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 20 }).notNull(), // 'chat', 'folder', 'link'
  title: varchar("title", { length: 100 }).notNull(),
  description: text("description"),
  image: varchar("image", { length: 500 }), // 카드 배경 이미지 URL (크롭된 최종 이미지)
  originalImage: varchar("original_image", { length: 500 }), // 원본 이미지 URL (레이아웃 편집용)
  imageTransform: jsonb("image_transform").$type<{ x: number; y: number; scale: number; rotation?: number }>(), // 이미지 변환 정보
  color: varchar("color", { length: 50 }), // 커스텀 배경 색상 (Tailwind 클래스명)
  icon: varchar("icon", { length: 50 }), // Lucide 아이콘 이름 (예: "MessageCircle", "Star")
  customIcon: varchar("custom_icon", { length: 500 }), // 업로드된 커스텀 아이콘 이미지 URL
  
  // 타입별 참조 ID
  chatRoomId: integer("chat_room_id"), // type='chat'일 때 - 그룹 채팅 또는 1:1 대화 ID
  folderId: integer("folder_id").references(() => cardFolders.id), // type='folder'일 때
  targetChatRoomId: integer("target_chat_room_id"), // type='link'일 때 - 그룹 채팅 또는 1:1 대화 ID
  sourceFolderId: integer("source_folder_id").references(() => cardFolders.id), // type='link'일 때 (원본 폴더)
  targetRoute: varchar("target_route", { length: 200 }), // type='link'일 때 일반 라우트 경로 (/management, /analytics 등)
  
  // 레이아웃 정보
  gridSizeX: integer("grid_size_x").notNull().default(1), // 가로 그리드 크기 (1-4)
  gridSizeY: integer("grid_size_y").notNull().default(1), // 세로 그리드 크기 (1-4)
  positionX: integer("position_x").notNull().default(0), // 그리드 X 위치
  positionY: integer("position_y").notNull().default(0), // 그리드 Y 위치
  position: integer("position").notNull().default(0), // 표시 순서 (드래그 앤 드롭으로 변경)
  
  // 소속 정보 (홈 또는 폴더 내부)
  parentFolderId: integer("parent_folder_id").references(() => cardFolders.id), // null이면 홈 화면
  
  createdBy: varchar("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 사용자별 카드 조회 기록 테이블 (NEW 뱃지 추적용)
export const userCardViews = pgTable("user_card_views", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  cardItemId: integer("card_item_id").references(() => cardItems.id).notNull(),
  firstViewedAt: timestamp("first_viewed_at").defaultNow(), // 사용자가 처음 카드를 클릭한 시간
}, (table) => [
  uniqueIndex("idx_user_card_views_unique").on(table.userId, table.cardItemId),
]);

// Zod 스키마
export const insertCardFolderSchema = createInsertSchema(cardFolders);
export const insertCardItemSchema = createInsertSchema(cardItems);
export const insertUserCardViewSchema = createInsertSchema(userCardViews);

// 타입 정의
export type CardFolder = typeof cardFolders.$inferSelect;
export type InsertCardFolder = z.infer<typeof insertCardFolderSchema>;
export type CardItem = typeof cardItems.$inferSelect;
export type InsertCardItem = z.infer<typeof insertCardItemSchema>;
export type UserCardView = typeof userCardViews.$inferSelect;
export type InsertUserCardView = z.infer<typeof insertUserCardViewSchema>;

// 게시판 테이블
export const boards = pgTable("boards", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 100 }).notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 50 }), // Lucide 아이콘 이름
  color: varchar("color", { length: 50 }), // Tailwind 색상 클래스
  isActive: boolean("is_active").notNull().default(true),
  order: integer("order").notNull().default(0), // 정렬 순서
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 게시물 테이블
export const boardPosts = pgTable("board_posts", {
  id: serial("id").primaryKey(),
  boardId: integer("board_id").references(() => boards.id).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull(),
  authorId: varchar("author_id").references(() => users.id).notNull(),
  isPinned: boolean("is_pinned").notNull().default(false), // 상단 고정
  viewCount: integer("view_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 게시판 관계
export const boardsRelations = relations(boards, ({ many }) => ({
  posts: many(boardPosts),
}));

export const boardPostsRelations = relations(boardPosts, ({ one }) => ({
  board: one(boards, {
    fields: [boardPosts.boardId],
    references: [boards.id],
  }),
  author: one(users, {
    fields: [boardPosts.authorId],
    references: [users.id],
  }),
}));

// Zod 스키마
export const insertBoardSchema = createInsertSchema(boards);
export const insertBoardPostSchema = createInsertSchema(boardPosts);

// 타입 정의
export type Board = typeof boards.$inferSelect;
export type InsertBoard = z.infer<typeof insertBoardSchema>;
export type BoardPost = typeof boardPosts.$inferSelect;
export type InsertBoardPost = z.infer<typeof insertBoardPostSchema>;

// 토큰 사용량 추적 테이블
export const tokenUsage = pgTable("token_usage", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id), // nullable - 시스템 사용일 수도 있음
  agentId: integer("agent_id").references(() => agents.id),
  conversationId: integer("conversation_id").references(() => conversations.id),
  groupChatId: integer("group_chat_id").references(() => groupChats.id),
  
  feature: varchar("feature", { length: 50 }).notNull(), // chat, document_analysis, image_generation, summarization 등
  model: varchar("model", { length: 50 }).notNull(), // gpt-4o, gpt-4o-mini 등
  
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCost: numeric("estimated_cost", { precision: 10, scale: 6 }).default("0"), // USD
  
  requestDuration: integer("request_duration"), // 요청 시간 (ms)
  metadata: jsonb("metadata"), // 추가 정보
  
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => [
  index("idx_token_usage_timestamp").on(table.timestamp),
  index("idx_token_usage_user_timestamp").on(table.userId, table.timestamp),
  index("idx_token_usage_feature").on(table.feature),
]);

// 토큰 사용량 관계
export const tokenUsageRelations = relations(tokenUsage, ({ one }) => ({
  user: one(users, {
    fields: [tokenUsage.userId],
    references: [users.id],
  }),
  agent: one(agents, {
    fields: [tokenUsage.agentId],
    references: [agents.id],
  }),
  conversation: one(conversations, {
    fields: [tokenUsage.conversationId],
    references: [conversations.id],
  }),
  groupChat: one(groupChats, {
    fields: [tokenUsage.groupChatId],
    references: [groupChats.id],
  }),
}));

// Zod 스키마
export const insertTokenUsageSchema = createInsertSchema(tokenUsage);

// 타입 정의
export type TokenUsage = typeof tokenUsage.$inferSelect;
export type InsertTokenUsage = z.infer<typeof insertTokenUsageSchema>;

// ========================================
// 🎯 토큰 절감을 위한 프롬프트 압축 엔진 테이블
// ========================================

// 1. Canon Lock 테이블 - 역할 본질 지키기 도구
// Strict Mode 도메인 옵션 (템플릿 + 커스텀)
export const STRICT_MODE_DOMAINS = [
  "biblical",           // 성경적 정확성 (목사님용)
  "teacher",            // 교육자 (선생님용)
  "customer_service",   // 서비스 상담사
  "custom",             // 직접 작성
] as const;

export type StrictModeDomain = typeof STRICT_MODE_DOMAINS[number];

export const agentCanon = pgTable("agent_canon", {
  agentId: integer("agent_id").primaryKey().references(() => agents.id, { onDelete: 'cascade' }),
  strictMode: varchar("strict_mode", { length: 50 }), // null = 비활성화, 값 = 도메인 선택 (biblical, teacher, customer_service, custom)
  customRule: text("custom_rule"), // strictMode="custom"일 때 사용자가 직접 작성한 규칙
  sources: text("sources").array().notNull().default(sql`ARRAY[]::text[]`), // Canon 범위 문서 ID 또는 태그
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 2. 유머 설정 테이블 - 스타일 선택 기반 유머 시스템
export const HUMOR_STYLES = [
  "wit",              // 위트: 가볍게 재치있는 한 마디
  "wordplay",         // 말장난: 언어유희/동음이의 장난
  "reaction",         // 리액션: 놀람/과장/상황극 반응
  "dry",              // 드라이: 건조하고 담백한 한 줄
  "self_deprecating", // 자조: 스스로를 낮춰 웃김
  "goofy",            // 허당/슬랩스틱: 일부러 허술·엉뚱
  "pattern",          // 패턴/콜백: 반복/주기적 회수 개그
  "wholesome"         // 훈훈/센스: 따뜻하고 미소 유발
] as const;

export type HumorStyle = typeof HUMOR_STYLES[number];

export const agentHumor = pgTable("agent_humor", {
  agentId: integer("agent_id").primaryKey().references(() => agents.id, { onDelete: 'cascade' }),
  enabled: boolean("enabled").notNull().default(false), // 유머 사용 여부
  styles: text("styles").array().notNull().default(sql`ARRAY[]::text[]`), // 선택된 유머 스타일 배열 (wit, wordplay, reaction, dry, self_deprecating, goofy, pattern, wholesome)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 3. Graph-RAG: Entity 테이블 - External Memory 시스템
export const ENTITY_TYPES = [
  "user",      // 사용자
  "agent",     // 에이전트
  "document",  // 문서
  "topic",     // 주제/개념
  "event"      // 이벤트
] as const;

export type EntityType = typeof ENTITY_TYPES[number];

export const ragEntities = pgTable("rag_entities", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 20 }).notNull(), // "user", "agent", "document", "topic", "event"
  externalId: varchar("external_id", { length: 255 }), // users.id, agents.id, documents.id 등
  name: varchar("name", { length: 255 }).notNull(),
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`), // 추가 정보 (임베딩, 속성 등)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_rag_entities_type").on(table.type),
  index("idx_rag_entities_external_id").on(table.externalId),
  uniqueIndex("idx_rag_entities_type_external_id").on(table.type, table.externalId),
]);

// 4. Graph-RAG: Edge 테이블 - 관계 저장
export const EDGE_TYPES = [
  "trusts",        // 신뢰
  "knows",         // 알고 있음
  "likes",         // 좋아함
  "dislikes",      // 싫어함
  "created",       // 생성함
  "references",    // 참조함
  "related_to"     // 관련됨
] as const;

export type EdgeType = typeof EDGE_TYPES[number];

export const ragEdges = pgTable("rag_edges", {
  id: serial("id").primaryKey(),
  fromEntityId: integer("from_entity_id").references(() => ragEntities.id, { onDelete: 'cascade' }).notNull(),
  toEntityId: integer("to_entity_id").references(() => ragEntities.id, { onDelete: 'cascade' }).notNull(),
  type: varchar("type", { length: 50 }).notNull(), // "trusts", "knows", "likes", etc.
  weight: numeric("weight", { precision: 5, scale: 2 }).default("0.50"), // 관계 강도 (0.0 ~ 1.0)
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`), // 추가 정보
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_rag_edges_from").on(table.fromEntityId),
  index("idx_rag_edges_to").on(table.toEntityId),
  index("idx_rag_edges_type").on(table.type),
]);

// 5. Graph-RAG: Memory 테이블 - 압축된 기억 저장
export const ragMemories = pgTable("rag_memories", {
  id: serial("id").primaryKey(),
  entityId: integer("entity_id").references(() => ragEntities.id, { onDelete: 'cascade' }).notNull(),
  conversationId: integer("conversation_id").references(() => conversations.id, { onDelete: 'cascade' }),
  groupChatId: integer("group_chat_id").references(() => groupChats.id, { onDelete: 'cascade' }),
  content: text("content").notNull(), // 압축된 기억 내용
  importance: numeric("importance", { precision: 3, scale: 2 }).default("0.50"), // 중요도 (0.0 ~ 1.0)
  metadata: jsonb("metadata").default(sql`'{}'::jsonb`), // 추가 정보 (감정, 키워드 등)
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"), // 만료 시간 (옵션)
}, (table) => [
  index("idx_rag_memories_entity").on(table.entityId),
  index("idx_rag_memories_conversation").on(table.conversationId),
  index("idx_rag_memories_importance").on(table.importance),
  index("idx_rag_memories_entity_importance_created").on(table.entityId, sql`${table.importance} DESC`, sql`${table.createdAt} DESC`),
]);

// 관계 정의
export const agentCanonRelations = relations(agentCanon, ({ one }) => ({
  agent: one(agents, {
    fields: [agentCanon.agentId],
    references: [agents.id],
  }),
}));

export const agentHumorRelations = relations(agentHumor, ({ one }) => ({
  agent: one(agents, {
    fields: [agentHumor.agentId],
    references: [agents.id],
  }),
}));

export const ragEntitiesRelations = relations(ragEntities, ({ many }) => ({
  outgoingEdges: many(ragEdges, { relationName: "from" }),
  incomingEdges: many(ragEdges, { relationName: "to" }),
  memories: many(ragMemories),
}));

export const ragEdgesRelations = relations(ragEdges, ({ one }) => ({
  fromEntity: one(ragEntities, {
    fields: [ragEdges.fromEntityId],
    references: [ragEntities.id],
    relationName: "from"
  }),
  toEntity: one(ragEntities, {
    fields: [ragEdges.toEntityId],
    references: [ragEntities.id],
    relationName: "to"
  }),
}));

export const ragMemoriesRelations = relations(ragMemories, ({ one }) => ({
  entity: one(ragEntities, {
    fields: [ragMemories.entityId],
    references: [ragEntities.id],
  }),
  conversation: one(conversations, {
    fields: [ragMemories.conversationId],
    references: [conversations.id],
  }),
  groupChat: one(groupChats, {
    fields: [ragMemories.groupChatId],
    references: [groupChats.id],
  }),
}));

// Zod 스키마
export const insertAgentCanonSchema = createInsertSchema(agentCanon).omit({ 
  agentId: true,  // agentId는 URL 파라미터로 전달되므로 제외
  createdAt: true, 
  updatedAt: true 
});

export const insertAgentHumorSchema = createInsertSchema(agentHumor).omit({ 
  agentId: true,  // agentId는 URL 파라미터로 전달되므로 제외
  createdAt: true, 
  updatedAt: true 
}).extend({
  styles: z.array(z.enum(HUMOR_STYLES)).optional(),
});

export const insertRagEntitySchema = createInsertSchema(ragEntities).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const insertRagEdgeSchema = createInsertSchema(ragEdges).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const insertRagMemorySchema = createInsertSchema(ragMemories).omit({ 
  id: true, 
  createdAt: true 
});

// 타입 정의
export type AgentCanon = typeof agentCanon.$inferSelect;
export type InsertAgentCanon = z.infer<typeof insertAgentCanonSchema>;

export type AgentHumor = typeof agentHumor.$inferSelect;
export type InsertAgentHumor = z.infer<typeof insertAgentHumorSchema>;

export type RagEntity = typeof ragEntities.$inferSelect;
export type InsertRagEntity = z.infer<typeof insertRagEntitySchema>;

export type RagEdge = typeof ragEdges.$inferSelect;
export type InsertRagEdge = z.infer<typeof insertRagEdgeSchema>;

export type RagMemory = typeof ragMemories.$inferSelect;
export type InsertRagMemory = z.infer<typeof insertRagMemorySchema>;

// ========================================
// 🎯 Canon-Style 분리 아키텍처
// ========================================

// 1. Canon Profile 테이블 - "무엇을 말할지" (지식/사실/교리)
export const canonProfiles = pgTable("canon_profiles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(), // 예: "Bible_Canon", "Physics_Canon"
  description: text("description"), // Canon 설명
  domain: varchar("domain", { length: 50 }), // "biblical", "academic", "business", "custom"
  
  // Canon 규칙 (사실/지식/교리만, 말투는 포함 안 함)
  rules: jsonb("rules").notNull().default(sql`'{}'::jsonb`), // { factRules: [], prohibitedClaims: [], sources: [] }
  
  // 🎯 Canon의 역할 책임 정의 (선생님, 목사님, 상담원 등 역할에 따른 책임)
  responsibility: text("responsibility"), // "학생의 성장과 교육을 책임. 무책임한 제안에 동조하지 않고 방향 제시"
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 2. Tone Profile 테이블 - "어떻게 말할지" (말투/유머/감정표현)
export const toneProfiles = pgTable("tone_profiles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(), // 예: "Fun_Tutor", "Strict_Teacher"
  description: text("description"), // Tone 설명
  
  // 말투 스타일 설정
  speakingStyle: text("speaking_style"), // 말투 패턴 설명
  intensity: numeric("intensity", { precision: 3, scale: 2 }).default("0.50"), // 말투 강도 (0.0~1.0)
  
  // 유머 설정
  humorEnabled: boolean("humor_enabled").default(false),
  humorStyles: text("humor_styles").array().default(sql`ARRAY[]::text[]`), // ["wit", "reaction", "dry"]
  
  // 감정 표현 설정
  emotionalExpression: varchar("emotional_expression", { length: 50 }).default("balanced"), // "minimal", "balanced", "rich"
  
  // 톤 규칙 (예시 및 금지 표현)
  toneRules: jsonb("tone_rules").default(sql`'{}'::jsonb`), // { examples: [], prohibitedPhrases: [], styleGuidelines: [] }
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 3. agents 테이블에 canonProfileId, toneProfileId 추가 (migration 필요)
// ALTER TABLE agents ADD COLUMN canon_profile_id INTEGER REFERENCES canon_profiles(id);
// ALTER TABLE agents ADD COLUMN tone_profile_id INTEGER REFERENCES tone_profiles(id);

// 관계 정의
export const canonProfilesRelations = relations(canonProfiles, ({ many }) => ({
  agents: many(agents),
}));

export const toneProfilesRelations = relations(toneProfiles, ({ many }) => ({
  agents: many(agents),
}));

// Zod 스키마
export const insertCanonProfileSchema = createInsertSchema(canonProfiles).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

export const insertToneProfileSchema = createInsertSchema(toneProfiles).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});

// 타입 정의
export type CanonProfile = typeof canonProfiles.$inferSelect;
export type InsertCanonProfile = z.infer<typeof insertCanonProfileSchema>;

export type ToneProfile = typeof toneProfiles.$inferSelect;
export type InsertToneProfile = z.infer<typeof insertToneProfileSchema>;

// 정보 휘발성 분류 레벨 상수 정의
export const CLASSIFICATION_LEVELS = [
  "LEVEL_0_IMMUTABLE",    // 불변의 진리 (10년) - 역사적 기록, 과학 법칙, 확정된 과거
  "LEVEL_1_LONG_TERM",    // 장기 지식 (6개월) - 잘 변하지 않는 정보, 문화재, 기업 연혁
  "LEVEL_2_MEDIUM_TERM",  // 중기 정보 (1개월) - 월간 통계, 분기 실적, 중장기 정책
  "LEVEL_3_SHORT_TERM",   // 단기 시사 (24시간) - 오늘 뉴스, 주가, 날씨, 최근 정책
  "LEVEL_4_REALTIME"      // 실시간 논란 (6시간) - 진행 중 논란, 속보, 미래 이벤트
] as const;

export type ClassificationLevel = typeof CLASSIFICATION_LEVELS[number];

// Search Cache 테이블 - Google Search Grounding 결과 영구 캐싱 (동적 TTL)
export const searchCache = pgTable("search_cache", {
  query: text("query").primaryKey(), // 검색 쿼리 (캐시 키)
  resultContext: text("result_context").notNull(), // 검색 결과 컨텍스트 (레거시)
  searchResults: jsonb("search_results"), // 검색 결과 배열 (최대 50개)
  perspectives: jsonb("perspectives"), // 관점 인물 리스트 및 각 인물별 유리한 기사 인덱스
  classificationType: text("classification_type"), // 정보 휘발성 분류 (LEVEL_0 ~ LEVEL_4)
  ttlSeconds: integer("ttl_seconds"), // LLM이 결정한 TTL (초 단위)
  eventDate: text("event_date"), // 이벤트 날짜 (YYYY-MM-DD 형식, 이벤트 기반 TTL용)
  expiresAt: timestamp("expires_at", { withTimezone: true }), // 캐시 만료 시간
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(), // 생성 시간
});

// Zod 스키마
export const insertSearchCacheSchema = createInsertSchema(searchCache).omit({
  createdAt: true
});

// 타입 정의
export type SearchCache = typeof searchCache.$inferSelect;
export type InsertSearchCache = z.infer<typeof insertSearchCacheSchema>;

// ========================================
// 🧠 Entity Profile - 인물/조직 정보 자산화
// ========================================

// Volatility Level 상수
export const VOLATILITY_LEVELS = [
  "HIGH",     // 시사/선거/단기 - 1~6시간 TTL
  "MEDIUM",   // 일반 뉴스/동향 - 1~7일 TTL
  "LOW"       // 역사/인물 정보/과학 - 7~30일 TTL
] as const;

export type VolatilityLevel = typeof VOLATILITY_LEVELS[number];

// Entity Profile 테이블 - 인물/조직 정보 축적
export const entityProfiles = pgTable("entity_profiles", {
  agentName: varchar("agent_name", { length: 200 }).primaryKey(), // 인물/조직 이름 (정규화됨)
  bioSummary: text("bio_summary").notNull(), // 인물 기본 정보 요약 (LLM 생성)
  tags: jsonb("tags").default(JSON.stringify([])), // 카테고리 태그: ["정치인", "기업인", "연예인" 등]
  timelineData: jsonb("timeline_data"), // 구조화된 시간축 데이터 (Lazy Migration - nullable)
  // 예: {"debut": 2010, "birth": 1992, "major_events": {"1st_asian_cup": 2011, "3rd_election": 2024}}
  lastUpdated: timestamp("last_updated", { withTimezone: true }).defaultNow(), // 최신성 관리
  volatility: varchar("volatility", { length: 20 }).default("MEDIUM"), // HIGH/MEDIUM/LOW
  source: text("source"), // 정보 출처 (검색 쿼리 또는 URL)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_entity_last_updated").on(table.lastUpdated),
  index("idx_entity_volatility").on(table.volatility),
]);

// Zod 스키마
export const insertEntityProfileSchema = createInsertSchema(entityProfiles).omit({
  createdAt: true,
  lastUpdated: true
});

// 타입 정의
export type EntityProfile = typeof entityProfiles.$inferSelect;
export type InsertEntityProfile = z.infer<typeof insertEntityProfileSchema>;

// ========================================
// 🎭 CallNAsk Guest Session & Analytics
// ========================================

// Guest Session 테이블 - 익명 사용자 세션 추적
export const guestSessions = pgTable("guest_sessions", {
  id: serial("id").primaryKey(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  embedCode: varchar("embed_code", { length: 255 }).notNull(),
  groupChatId: integer("group_chat_id").notNull().references(() => groupChats.id),
  origin: text("origin"),
  
  // User metadata
  userNumber: serial("user_number"), // 자동 증가 번호
  ipAddress: varchar("ip_address", { length: 100 }),
  userAgent: text("user_agent"),
  deviceType: varchar("device_type", { length: 50 }), // mobile/desktop/tablet
  browser: varchar("browser", { length: 100 }),
  browserVersion: varchar("browser_version", { length: 50 }),
  os: varchar("os", { length: 100 }),
  osVersion: varchar("os_version", { length: 50 }),
  country: varchar("country", { length: 100 }),
  city: varchar("city", { length: 100 }),
  timezone: varchar("timezone", { length: 100 }),
  
  // 추가 기술 메타데이터
  screenWidth: integer("screen_width"), // 화면 너비
  screenHeight: integer("screen_height"), // 화면 높이
  referrer: text("referrer"), // 접속 경로 (이전 페이지 URL)
  networkLatency: integer("network_latency"), // 네트워크 지연 (ms)
  
  // 세션 활동 메트릭 (집계 데이터)
  totalMessages: integer("total_messages").default(0), // 총 메시지 수
  averageMessageLength: integer("average_message_length").default(0), // 평균 메시지 길이
  totalActivityTime: integer("total_activity_time").default(0), // 총 활동 시간 (초)
  lastActivityAt: timestamp("last_activity_at"), // 마지막 활동 시간
  characterSwitchCount: integer("character_switch_count").default(0), // 캐릭터 전환 횟수
  errorCount: integer("error_count").default(0), // 오류 발생 횟수
  turnCount: integer("turn_count").default(0), // 대화 턴 수 (사용자-봇 쌍)
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  selectedAgents: integer("selected_agents").array().default(sql`ARRAY[]::integer[]`),
});

// Guest Analytics 테이블 - 이벤트 트래킹
export const guestAnalytics = pgTable("guest_analytics", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => guestSessions.id),
  eventType: varchar("event_type", { length: 50 }).notNull(), // character_created, character_deleted, message_sent, etc.
  eventData: jsonb("event_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Zod 스키마
export const insertGuestSessionSchema = createInsertSchema(guestSessions).omit({
  id: true,
  userNumber: true,
  createdAt: true,
});

export const insertGuestAnalyticsSchema = createInsertSchema(guestAnalytics).omit({
  id: true,
  createdAt: true,
});

// 타입 정의
export type GuestSession = typeof guestSessions.$inferSelect;
export type InsertGuestSession = z.infer<typeof insertGuestSessionSchema>;

export type GuestAnalytics = typeof guestAnalytics.$inferSelect;
export type InsertGuestAnalytics = z.infer<typeof insertGuestAnalyticsSchema>;

// ========================================
// 🔍 CallNAsk Trending & Discovery
// ========================================

// 카테고리 상수 정의
export const CALLNASK_CATEGORIES = [
  "all",        // 전체
  "philosophy", // 철학
  "science",    // 과학
  "art",        // 예술
  "politics",   // 정치
  "economy"     // 경제
] as const;

export type CallnaskCategory = typeof CALLNASK_CATEGORIES[number];

// 카테고리 라벨 매핑
export const CALLNASK_CATEGORY_LABELS: Record<CallnaskCategory, string> = {
  all: "전체",
  philosophy: "철학",
  science: "과학",
  art: "예술",
  politics: "정치",
  economy: "경제"
};

// Trending Topics 테이블 - Hot Topic Views (실시간 이슈 기반 관점별 질문)
export const trendingTopics = pgTable("trending_topics", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 20 }).notNull(), // "perspective" or "question" or "hot_topic"
  title: varchar("title", { length: 200 }).notNull(), // 관점 이름 또는 질문
  subtitle: varchar("subtitle", { length: 300 }), // 부제목 또는 설명
  category: varchar("category", { length: 50 }).notNull(), // philosophy, science, art, politics, economy
  iconEmoji: varchar("icon_emoji", { length: 10 }), // 아이콘 이모지
  agentId: integer("agent_id").references(() => agents.id), // 연결된 에이전트 (있는 경우)
  clickCount: integer("click_count").default(0), // 클릭 횟수
  isActive: boolean("is_active").default(true), // 활성 여부
  displayOrder: integer("display_order").default(0), // 표시 순서
  
  // Hot Topic Views 전용 필드
  character: varchar("character", { length: 200 }), // 답변자 이름 (예: "제롬 파월 연준 의장")
  question: text("question"), // 관점별 질문
  expectedAnswer: text("expected_answer"), // AI 모델 참고용 예상 답변
  lastGeneratedAt: timestamp("last_generated_at"), // 마지막 생성 시각
  lastCalledAt: timestamp("last_called_at"), // 마지막 호출(제공) 시각
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Message References 테이블 - 답변 참고 자료
export const messageReferences = pgTable("message_references", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => groupChatMessages.id),
  title: varchar("title", { length: 300 }).notNull(), // 참고 자료 제목
  url: text("url"), // 링크 URL (선택사항)
  description: text("description"), // 간단한 설명
  displayOrder: integer("display_order").default(0), // 표시 순서
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Follow-up Questions 테이블 - 후속 질문 제안
export const followUpQuestions = pgTable("follow_up_questions", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => groupChatMessages.id),
  question: varchar("question", { length: 300 }).notNull(), // 후속 질문 텍스트
  displayOrder: integer("display_order").default(0), // 표시 순서
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Zod 스키마
export const insertTrendingTopicSchema = createInsertSchema(trendingTopics).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMessageReferenceSchema = createInsertSchema(messageReferences).omit({
  id: true,
  createdAt: true,
});

export const insertFollowUpQuestionSchema = createInsertSchema(followUpQuestions).omit({
  id: true,
  createdAt: true,
});

// 타입 정의
export type TrendingTopic = typeof trendingTopics.$inferSelect;
export type InsertTrendingTopic = z.infer<typeof insertTrendingTopicSchema>;

export type MessageReference = typeof messageReferences.$inferSelect;
export type InsertMessageReference = z.infer<typeof insertMessageReferenceSchema>;

export type FollowUpQuestion = typeof followUpQuestions.$inferSelect;
export type InsertFollowUpQuestion = z.infer<typeof insertFollowUpQuestionSchema>;