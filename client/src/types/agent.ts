export interface Agent {
  id: number;
  
  // 1. 기본 정보
  name: string;
  description: string;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
  
  // 2. 카테고리 및 상태 정보
  upperCategory?: string;    // 상위 카테고리 (예: 단과대학)
  lowerCategory?: string;    // 하위 카테고리 (예: 학과)
  detailCategory?: string;   // 세부 카테고리
  status?: "active" | "inactive" | "pending";
  
  // 3. 모델 및 응답 설정
  llmModel?: string;         // 사용 모델
  chatbotType?: "strict-doc" | "doc-fallback-llm" | "general-llm" | "llm-with-web-search";
  maxInputLength?: number;   // 최대 입력 길이
  maxResponseLength?: number; // 최대 응답 길이
  
  // 웹 검색 관련 설정
  webSearchEnabled?: boolean; // 웹 검색 사용 여부
  searchEngine?: string;     // 검색 엔진 종류
  bingApiKey?: string;       // Bing 검색 API 키
  
  // 4. 역할 및 페르소나 설정
  personaNickname?: string;  // 페르소나 닉네임
  speechStyle?: string;      // 말투 스타일
  personality?: string;      // 성격 설명
  additionalPrompt?: string; // 추가 프롬프트
  extraPrompt?: string;      // 추가 프롬프트 영역
  
  // 5. 문서 연결 및 업로드
  uploadFormats?: string[];  // 업로드 가능한 포맷
  uploadMethod?: "dragdrop" | "onedrive";
  maxFileCount?: number;     // 최대 문서 수
  maxFileSizeMB?: number;    // 최대 파일 크기(MB)
  documentManagerIds?: string[]; // 문서 업로드/연결 권한자 목록
  
  // 6. 권한 및 접근 설정
  visibility?: "private" | "custom" | "group" | "organization";
  allowedGroups?: string[];  // 접근 가능한 사용자 그룹
  agentManagerIds?: string[]; // 에이전트 관리자 목록
  agentEditorIds?: string[];  // 에이전트 편집 가능 사용자 목록
  
  // 기존 UI 관련 필드들 (호환성 유지)
  icon: string;
  backgroundColor: string;
  isCustomIcon?: boolean;
  
  // 기존 레거시 필드들 (호환성 유지)
  category: "학교" | "교수" | "학생" | "그룹" | "기능형";
  managerId?: string;
  organizationId?: number;   // 조직 ID
  isActive: boolean;
  
  // 추가 필드들 (통계 등)
  documentCount?: number;    // 문서 수
  userCount?: number;        // 사용자 수
}

export interface AgentStats {
  id: number;
  agentId: number;
  activeUsers: number;
  totalMessages: number;
  usagePercentage: number;
  ranking: number;
  updatedAt: string;
}

export interface Conversation {
  id: number;
  userId: string;
  agentId: number;
  unreadCount: number;
  lastReadAt?: string;
  lastMessageAt: string;
  createdAt: string;
  agent: Agent;
  lastMessage?: Message;
}

export interface Message {
  id: number;
  conversationId: number;
  content: string;
  isFromUser: boolean;
  createdAt: string;
}

export interface Document {
  id: number;
  agentId: number;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  content?: string;
  uploadedBy: string;
  createdAt: string;
}

export interface ChatResponse {
  userMessage: Message;
  aiMessage: Message;
  usedDocuments?: string[];
}

// 그룹 채팅 관련 타입 정의
export interface GroupChat {
  id: number;
  title: string;
  createdBy: string;
  languageLevel?: number; // 챗봇 언어 레벨 (1-5단계, 기본값: 3)
  model?: string; // GPT 모델 (gpt-4o, gpt-4o-mini 등)
  temperature?: number; // Temperature 설정 (0.0 ~ 2.0)
  metaPrompt?: string | null; // 대화방별 메타 프롬프트 (시스템 프롬프트)
  visibility?: 'private' | 'public'; // 공개 범위
  embedEnabled?: boolean; // 웹 임베드 활성화 여부
  sharingMode?: 'shared' | 'template'; // 공유 모드
  embedCode?: string; // 임베드 코드
  allowedDomains?: string[]; // 허용된 도메인 목록
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
}

export interface GroupChatMember {
  id: number;
  groupChatId: number;
  userId: string;
  joinedAt: string;
  lastReadAt?: string;
  user?: {
    id: string;
    username: string;
    name?: string;
  };
}

export interface GroupChatAgent {
  id: number;
  groupChatId: number;
  agentId: number;
  addedAt: string;
  agent?: Agent;
}

export interface GroupChatMessage {
  id: number;
  groupChatId: number;
  content: string;
  senderId?: string; // 사용자 ID 또는 null (챗봇인 경우)
  agentId?: number; // 챗봇 ID 또는 null (사용자인 경우)
  targetAgentIds?: number[]; // 특정 챗봇들을 대상으로 한 메시지인 경우
  replyOrder?: number; // 여러 챗봇이 순서대로 답할 때의 순서
  sources?: {
    chunks: Array<{ title: string; url: string }>;
    supports: Array<{
      startIndex: number;
      endIndex: number;
      text: string;
      chunkIndices: number[];
    }>;
  }; // Google Search 출처 (세그먼트별 매핑 포함)
  splitType?: 'paragraph' | 'length' | 'topic'; // 메시지 분할 타입 (length일 때 이름 숨김)
  createdAt: string;
  sender?: {
    id: string;
    username: string;
    name?: string;
  };
  agent?: Agent;
}

// Helper type for splitType reuse
export type SplitType = NonNullable<GroupChatMessage['splitType']>;

export interface GroupChatWithDetails extends GroupChat {
  members: GroupChatMember[];
  agents: GroupChatAgent[];
  lastMessage?: GroupChatMessage;
}
