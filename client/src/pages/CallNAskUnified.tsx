import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Send, ExternalLink, Plus, MessageCircle, Check, Home, RotateCcw, Newspaper, Globe, Building2, Laptop, Tv, Trophy, Heart, Star, TrendingUp, Link2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MessageReference, FollowUpQuestion, TrendingTopic } from "@shared/schema";
import { getRandomQuestions, extractCharacterName, type SampleQuestion } from "@/data/sampleQuestions";
import { EmotionAvatar, extractCharacterNameFromMessage, mapEmotionalToneToEmotion, analyzeEmotionFromContent, type AvatarEmotionType } from "@/components/EmotionAvatar";

interface Agent {
  id: number;
  name: string;
  icon: string;
  backgroundColor: string;
  category?: string;
  description?: string;
}

interface PersonaMetadata {
  name: string;
  role: string;
  stance: string;
  sentiment: 'positive' | 'negative' | 'neutral' | 'critical';
  supportive_indices: number[];
  color: string;
  dialogue?: string; // 🎬 시나리오 작가 모드: 1인칭 반박 대사
}

interface PerspectiveData {
  success?: boolean;
  errorCode?: string;
  message?: string;
  perspectives: PersonaMetadata[];
  query: string;
  sourcesReused?: boolean;
}

// 🎭 Step 46: SuggestionChip 인터페이스
interface SuggestionChip {
  name: string;
  title: string;
  action: 'more_info' | 'new_entry';
  desc: string;
}

// 📚 Perplexity 스타일 인용 출처 인터페이스
interface SourceChunk {
  title?: string;
  url: string;
  snippet?: string;
}

interface SourceSupport {
  startIndex: number;
  endIndex: number;
  text: string;
  chunkIndices: number[];
}

// MessageSources는 두 가지 형식을 지원:
// 1. 새 형식: {chunks: [...], supports: [...]}
// 2. 레거시 형식: [{url, title, snippet}] (flat array)
type MessageSources = 
  | { chunks: SourceChunk[]; supports?: SourceSupport[] }
  | SourceChunk[];

interface Message {
  id: number;
  content: string;
  senderId?: number | null;  // Step 32: AI 메시지 구분용
  senderName?: string;
  sender?: { id: number; username: string } | null;  // Step 32: API 응답의 sender 객체
  agentId?: number;
  agentName?: string;
  agent?: Agent;
  createdAt: string;
  references?: MessageReference[];
  followUpQuestions?: FollowUpQuestion[];
  perspectives?: PersonaMetadata[];
  suggestionChips?: SuggestionChip[];  // 🎭 Step 46: VERDICT에서 생성한 추천 화자 칩
  sources?: MessageSources;  // 📚 Perplexity 스타일 인용 출처
}

interface Candidate {
  fullName: string;
  primaryDescriptor: string;
  notability: number;
  confidence: number;
  isUnique: boolean;
}

interface CallNAskUnifiedProps {
  embedCode: string;
  guestToken: string | null;
  agents: Agent[];
  groupChatId?: number;
  onAgentsUpdate?: () => void;
}

// 📰 Google News 인터페이스
interface NewsItem {
  id: string;
  title: string;
  verdictQuestion: string;
  source: string;
  link: string;
  pubDate: string;
  section: string;
}

interface CachedNews {
  items: NewsItem[];
  lastUpdated: string;
  nextUpdate: string;
}

interface NewsResponse {
  success: boolean;
  sections: Record<string, string>;
  news: Record<string, CachedNews>;
  cacheStatus: {
    sections: string[];
    lastUpdated: string | null;
    nextUpdate: string;
    itemCount: number;
  };
}

// 📰 뉴스 섹션 아이콘 매핑
const NEWS_SECTION_ICONS: Record<string, JSX.Element> = {
  home: <Home className="w-4 h-4" />,
  recommended: <Star className="w-4 h-4" />,
  korea: <TrendingUp className="w-4 h-4" />,
  world: <Globe className="w-4 h-4" />,
  business: <Building2 className="w-4 h-4" />,
  technology: <Laptop className="w-4 h-4" />,
  entertainment: <Tv className="w-4 h-4" />,
  sports: <Trophy className="w-4 h-4" />,
  health: <Heart className="w-4 h-4" />
};

// 📰 뉴스 제목 정리 함수 - 출처와 불필요한 태그 제거
const cleanNewsTitle = (title: string): string => {
  let cleaned = title;
  
  // 1. 끝부분의 출처 제거 (- 경향신문, - 조선일보, - 한겨레 등)
  cleaned = cleaned.replace(/\s*[-–]\s*[가-힣A-Za-z0-9\s]+$/, '');
  
  // 2. 앞부분의 태그 제거 ([르포], [속보], [단독], [인터뷰], [기획] 등)
  cleaned = cleaned.replace(/^\s*\[[^\]]+\]\s*/g, '');
  
  return cleaned.trim();
};

// 🎨 CSS 색상 이름 → rgba 변환 함수
const getColorWithOpacity = (color: string, opacity: number): string => {
  const colorMap: Record<string, string> = {
    red: '220, 38, 38',
    blue: '37, 99, 235',
    green: '22, 163, 74',
    yellow: '202, 138, 4',
    gray: '75, 85, 99'
  };
  
  const rgb = colorMap[color.toLowerCase()] || '75, 85, 99'; // fallback to gray
  return `rgba(${rgb}, ${opacity})`;
};

// 🎨 Step 45: 캐릭터별 고유 색상 생성 (통일된 포맷 + 색상 차별화)
const CHARACTER_COLORS = [
  { primary: '#3B82F6', light: 'rgba(59, 130, 246, 0.08)', border: 'rgba(59, 130, 246, 0.3)' },  // Blue
  { primary: '#10B981', light: 'rgba(16, 185, 129, 0.08)', border: 'rgba(16, 185, 129, 0.3)' },  // Emerald
  { primary: '#F59E0B', light: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.3)' },  // Amber
  { primary: '#EF4444', light: 'rgba(239, 68, 68, 0.08)', border: 'rgba(239, 68, 68, 0.3)' },    // Red
  { primary: '#8B5CF6', light: 'rgba(139, 92, 246, 0.08)', border: 'rgba(139, 92, 246, 0.3)' },  // Violet
  { primary: '#EC4899', light: 'rgba(236, 72, 153, 0.08)', border: 'rgba(236, 72, 153, 0.3)' },  // Pink
  { primary: '#06B6D4', light: 'rgba(6, 182, 212, 0.08)', border: 'rgba(6, 182, 212, 0.3)' },    // Cyan
  { primary: '#84CC16', light: 'rgba(132, 204, 22, 0.08)', border: 'rgba(132, 204, 22, 0.3)' },  // Lime
];

const characterColorCache: Record<string, typeof CHARACTER_COLORS[0]> = {};
let colorIndex = 0;

const getCharacterColor = (characterName: string) => {
  if (characterColorCache[characterName]) {
    return characterColorCache[characterName];
  }
  const color = CHARACTER_COLORS[colorIndex % CHARACTER_COLORS.length];
  characterColorCache[characterName] = color;
  colorIndex++;
  return color;
};

// 🎭 캐릭터 이름 파싱: 아바타 표시용 이름과 역할 추출
// 예: "쿠팡 관계자 (관계자)" → { displayName: "쿠팡", role: "관계자" }
// 예: "박상혁 (더불어민주당 의원)" → { displayName: "박상혁", role: "더불어민주당 의원" }
// 예: "Jester" → { displayName: "Jester", role: "" }
const parseCharacterForAvatar = (fullName: string): { displayName: string; role: string } => {
  // 괄호 안의 역할 추출
  const roleMatch = fullName.match(/\(([^)]+)\)/);
  const role = roleMatch ? roleMatch[1] : '';
  
  // 괄호 제거한 이름
  const nameWithoutRole = fullName.replace(/\s*\([^)]+\)\s*/g, '').trim();
  
  // 한글 이름인지 확인 (한글이 포함되어 있으면)
  const isKorean = /[\uAC00-\uD7AF]/.test(nameWithoutRole);
  
  if (isKorean) {
    // 한글 이름: 첫 번째 단어를 displayName으로 사용
    // "쿠팡 관계자" → "쿠팡", "박상혁" → "박상혁", "남동일" → "남동일"
    const parts = nameWithoutRole.split(/\s+/);
    const firstName = parts[0];
    
    // 2-3글자 이름이면 그대로 사용 (인명)
    // 그 외에는 첫 단어 사용 (기관명, 브랜드명)
    if (firstName.length <= 4) {
      return { displayName: firstName, role };
    }
    return { displayName: firstName.slice(0, 4), role };
  } else {
    // 영문 이름: 전체 이름 사용 (최대 8자)
    const displayName = nameWithoutRole.length > 8 ? nameWithoutRole.slice(0, 8) : nameWithoutRole;
    return { displayName, role };
  }
};

// 📚 Perplexity 스타일 인라인 인용 컴포넌트
// URL에서 도메인 이름 추출 (예: https://www.hani.co.kr/... → 한겨레)
const extractDomainName = (url: string): string => {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    // 한국 뉴스 도메인 매핑
    const domainMap: Record<string, string> = {
      'hani.co.kr': '한겨레',
      'chosun.com': '조선일보',
      'donga.com': '동아일보',
      'joongang.co.kr': '중앙일보',
      'khan.co.kr': '경향신문',
      'yna.co.kr': '연합뉴스',
      'yonhapnews.co.kr': '연합뉴스',
      'news.sbs.co.kr': 'SBS',
      'news.kbs.co.kr': 'KBS',
      'imnews.imbc.com': 'MBC',
      'news.jtbc.co.kr': 'JTBC',
      'newsis.com': '뉴시스',
      'news1.kr': '뉴스1',
      'mk.co.kr': '매일경제',
      'hankyung.com': '한국경제',
      'sedaily.com': '서울경제',
      'mt.co.kr': '머니투데이',
      'edaily.co.kr': '이데일리',
      'biz.chosun.com': '조선비즈',
      'nocutnews.co.kr': 'CBS노컷',
      'hankookilbo.com': '한국일보',
      'sisain.co.kr': '시사인',
      'ohmynews.com': '오마이뉴스',
      'mediatoday.co.kr': '미디어오늘',
      'pressian.com': '프레시안',
    };
    return domainMap[hostname] || hostname.split('.')[0];
  } catch {
    return '출처';
  }
};

// 인용 번호 뱃지 컴포넌트
interface CitationBadgeProps {
  number: number;
  chunk: SourceChunk;
}

const CitationBadge = ({ number, chunk }: CitationBadgeProps) => {
  const [open, setOpen] = useState(false);
  const sourceName = extractDomainName(chunk.url);
  
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-sm hover:bg-blue-200 dark:hover:bg-blue-800/60 transition-colors ml-0.5 align-super cursor-pointer"
          data-testid={`citation-badge-${number}`}
        >
          {number}
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-72 p-0 shadow-lg" 
        side="top" 
        sideOffset={5}
      >
        <a
          href={chunk.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors rounded-lg"
          onClick={() => setOpen(false)}
          data-testid={`citation-link-${number}`}
        >
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 w-6 h-6 bg-blue-100 dark:bg-blue-900/30 rounded flex items-center justify-center">
              <Link2 className="w-3 h-3 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/20 rounded">
                  {sourceName}
                </span>
                <ExternalLink className="w-3 h-3 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2 leading-snug">
                {chunk.title}
              </p>
              {chunk.snippet && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                  {chunk.snippet}
                </p>
              )}
            </div>
          </div>
        </a>
      </PopoverContent>
    </Popover>
  );
};

// 메시지 내용에 인용 번호를 삽입하는 컴포넌트 (Perplexity 스타일)
// 마크다운을 한 번만 렌더링하고, 내용 끝에 인용 배지들을 인라인으로 추가
interface CitationContentProps {
  content: string;
  sources?: MessageSources;
}

const CitationContent = ({ content, sources }: CitationContentProps) => {
  // 단순화: sources 배열 정규화
  const sourcesList: SourceChunk[] = (() => {
    if (!sources) return [];
    if (Array.isArray(sources)) return sources;
    if (sources.chunks && Array.isArray(sources.chunks)) return sources.chunks;
    return [];
  })();

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
      {/* 📚 Sources 표시 - 번호 뱃지만 표시 (헤더 없음) */}
      {sourcesList.length > 0 && (
        <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700">
          <div className="inline-flex flex-wrap gap-1.5">
            {sourcesList.map((chunk, idx) => (
              <CitationBadge 
                key={`cite-${idx}`} 
                number={idx + 1} 
                chunk={chunk} 
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default function CallNAskUnified({ embedCode, guestToken, agents, groupChatId, onAgentsUpdate }: CallNAskUnifiedProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [messageInput, setMessageInput] = useState("");
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("심층 분석 중입니다...");
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [randomSampleQuestions, setRandomSampleQuestions] = useState<SampleQuestion[]>([]);
  const [showManageModal, setShowManageModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"your-views" | "create-view">("your-views");
  const [createViewInput, setCreateViewInput] = useState("");
  const [quickCreateInput, setQuickCreateInput] = useState("");
  const [showCandidatesDialog, setShowCandidatesDialog] = useState(false);
  const [candidatesList, setCandidatesList] = useState<Candidate[]>([]);
  const [showDetailedSearch, setShowDetailedSearch] = useState(false);
  const [occupation, setOccupation] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [activePeriod, setActivePeriod] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageIdWhenSent = useRef<number>(-1); // Step 28: ID 기반 로딩 종료 (-1 = 미설정)
  const lastSubmitTimeStamp = useRef<number>(0);
  const pendingQuestionRef = useRef<{ characterName: string; question: string } | null>(null);
  
  // 🎬 Step 44: 순차 메시지 표시 (메신저 스타일 말풍선)
  const [displayedMessages, setDisplayedMessages] = useState<Message[]>([]);
  const messageQueueRef = useRef<Message[]>([]);
  const isProcessingQueueRef = useRef<boolean>(false);
  const lastDisplayedIdRef = useRef<number>(0);
  
  // 🎭 Perspectives 상태 관리
  const [perspectivesByMessage, setPerspectivesByMessage] = useState<Record<number, PersonaMetadata[]>>({});
  const [loadingPerspectives, setLoadingPerspectives] = useState(false);
  const [currentPerspective, setCurrentPerspective] = useState<Record<number, PersonaMetadata | null>>({});
  const [failedPerspectiveIds, setFailedPerspectiveIds] = useState<number[]>([]); // ✅ Set 대신 배열 사용
  
  // 🗣️ Perspective replies (1인칭 토론 답변) - 🎬 시나리오 작가 모드: dialogue 즉시 표시
  const [perspectiveReplies, setPerspectiveReplies] = useState<Record<number, Array<{persona: string, role: string, reply: string, color: string}>>>({});

  // 🎭 Step 46: Interactive Speaker Chips - 토론 참여자 + 추천 인물
  interface RecommendedSpeaker {
    name: string;
    title: string;
    reason: string;
    stance: 'support' | 'oppose' | 'neutral' | 'authority';
    speaker_icon: string;
    isExisting: boolean;
  }
  const [speakerChips, setSpeakerChips] = useState<RecommendedSpeaker[]>([]);
  const [loadingSpeakers, setLoadingSpeakers] = useState(false);
  const [expandingSpeaker, setExpandingSpeaker] = useState<string | null>(null);
  const speakersLoadedRef = useRef(false);
  
  // 🖱️ 스피커 칩 드래그 스크롤 (마우스 전용, 터치는 네이티브 스크롤 사용)
  const speakerChipsRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef({
    isMouseDown: false,
    hasDragged: false,
    startX: 0,
    scrollStartX: 0
  });
  
  const handleSpeakerChipsMouseDown = (e: React.MouseEvent) => {
    const container = speakerChipsRef.current;
    if (!container) return;
    
    dragStateRef.current = {
      isMouseDown: true,
      hasDragged: false,
      startX: e.clientX,
      scrollStartX: container.scrollLeft
    };
  };
  
  const handleSpeakerChipsMouseMove = (e: React.MouseEvent) => {
    const state = dragStateRef.current;
    if (!state.isMouseDown) return;
    
    const container = speakerChipsRef.current;
    if (!container) return;
    
    const deltaX = state.startX - e.clientX;
    
    // 5px 이상 이동하면 드래그로 판단
    if (Math.abs(deltaX) > 5) {
      state.hasDragged = true;
      container.scrollLeft = state.scrollStartX + deltaX;
    }
  };
  
  const handleSpeakerChipsMouseUp = () => {
    setTimeout(() => {
      dragStateRef.current.isMouseDown = false;
      dragStateRef.current.hasDragged = false;
    }, 50);
  };
  
  const handleSpeakerChipsMouseLeave = () => {
    dragStateRef.current.isMouseDown = false;
    dragStateRef.current.hasDragged = false;
  };

  // 📰 Google News 상태
  const [selectedNewsSection, setSelectedNewsSection] = useState<string>('home');
  
  // 🖱️ 뉴스 섹션 탭 드래그 스크롤 (마우스 전용, 터치는 네이티브 스크롤 사용)
  const newsSectionRef = useRef<HTMLDivElement>(null);
  const newsSectionDragRef = useRef({
    isMouseDown: false,
    hasDragged: false,
    startX: 0,
    scrollStartX: 0
  });
  
  const handleNewsSectionMouseDown = (e: React.MouseEvent) => {
    const container = newsSectionRef.current;
    if (!container) return;
    
    newsSectionDragRef.current = {
      isMouseDown: true,
      hasDragged: false,
      startX: e.clientX,
      scrollStartX: container.scrollLeft
    };
  };
  
  const handleNewsSectionMouseMove = (e: React.MouseEvent) => {
    const state = newsSectionDragRef.current;
    if (!state.isMouseDown) return;
    
    const container = newsSectionRef.current;
    if (!container) return;
    
    const deltaX = state.startX - e.clientX;
    
    if (Math.abs(deltaX) > 5) {
      state.hasDragged = true;
      container.scrollLeft = state.scrollStartX + deltaX;
    }
  };
  
  const handleNewsSectionMouseUp = () => {
    setTimeout(() => {
      newsSectionDragRef.current.isMouseDown = false;
      newsSectionDragRef.current.hasDragged = false;
    }, 50);
  };
  
  const handleNewsSectionMouseLeave = () => {
    newsSectionDragRef.current.isMouseDown = false;
    newsSectionDragRef.current.hasDragged = false;
  };

  const activeAgent = agents.find(a => a.id === selectedAgentId) || agents[0];
  
  // 🏠 새 대화 시작 mutation
  const resetChatMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/embed/${embedCode}/messages`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${guestToken}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) throw new Error('Failed to reset chat');
      return response.json();
    },
    onSuccess: () => {
      // 클라이언트 상태 초기화
      setDisplayedMessages([]);
      messageQueueRef.current = [];
      queuedIdsRef.current.clear();
      isProcessingQueueRef.current = false;
      lastDisplayedIdRef.current = 0;
      // 캐릭터 색상 캐시도 초기화
      Object.keys(characterColorCache).forEach(key => delete characterColorCache[key]);
      colorIndex = 0;
      // 쿼리 무효화
      queryClient.invalidateQueries({ queryKey: [`/api/embed/${embedCode}/messages`] });
      toast({
        title: "새 대화 시작",
        description: "대화가 초기화되었습니다. 새로운 질문을 입력해보세요!",
      });
    },
    onError: (error) => {
      console.error('Reset chat error:', error);
      toast({
        title: "오류",
        description: "대화 초기화에 실패했습니다.",
        variant: "destructive"
      });
    }
  });
  
  // Initialize random sample questions on mount
  useEffect(() => {
    setRandomSampleQuestions(getRandomQuestions(5));
  }, []);

  // 🎯 랜덤 스폰서 로딩 메시지 (로딩 시작 시 변경)
  useEffect(() => {
    if (isWaitingForResponse) {
      const sponsorMessages = [
        "이 답변은 나이키의 지원으로 생성되고 있습니다.",
        "답변을 기다리는 동안 쿠팡 특가 확인해보세요.",
        "잠시만요, 스타벅스 커피 한 잔 마시고 생각 좀 해볼게요.."
      ];
      const randomIndex = Math.floor(Math.random() * sponsorMessages.length);
      setLoadingMessage(sponsorMessages[randomIndex]);
    }
  }, [isWaitingForResponse]);

  // Initialize selectedAgentId when agents change
  useEffect(() => {
    if (!selectedAgentId && agents.length > 0) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);
  
  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: [`/api/embed/${embedCode}/messages`],
    enabled: !!guestToken,
    refetchInterval: 3000,
    queryFn: async () => {
      const response = await fetch(`/api/embed/${embedCode}/messages`, {
        headers: {
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin,
          'Cache-Control': 'no-cache'
        }
      });
      if (!response.ok) throw new Error('Failed to fetch messages');
      
      const baseMessages = await response.json();
      
      // 🔍 Debug: Check sources in messages
      const sourcesCheck = baseMessages.filter((m: Message) => m.sources);
      if (sourcesCheck.length > 0) {
        console.log('[📚 SOURCES CHECK] Messages with sources:', sourcesCheck.length);
        sourcesCheck.forEach((m: Message) => {
          console.log(`  - Message ${m.id}: sources type=${typeof m.sources}, isArray=${Array.isArray(m.sources)}`, m.sources);
        });
      }
      
      const messagesWithExtras = await Promise.all(
        baseMessages.map(async (msg: Message) => {
          if (!msg.agentId) return msg;
          
          try {
            const [refsRes, followUpsRes] = await Promise.all([
              fetch(`/api/embed/${embedCode}/messages/${msg.id}/references`, {
                headers: {
                  'Authorization': `Bearer ${guestToken}`,
                  'Origin': window.location.origin
                }
              }),
              fetch(`/api/embed/${embedCode}/messages/${msg.id}/followups`, {
                headers: {
                  'Authorization': `Bearer ${guestToken}`,
                  'Origin': window.location.origin
                }
              })
            ]);
            
            const references = refsRes.ok ? await refsRes.json() : [];
            const followUpQuestions = followUpsRes.ok ? await followUpsRes.json() : [];
            
            return { ...msg, references, followUpQuestions };
          } catch (error) {
            console.error('Error fetching message extras:', error);
            return msg;
          }
        })
      );
      
      return messagesWithExtras;
    },
    retry: false,
  });

  // 🎬 Step 44: 순차 메시지 표시 로직 (메신저 스타일)
  // 새 메시지가 여러 개 도착하면 1.5~2초 간격으로 하나씩 표시
  const queuedIdsRef = useRef<Set<number>>(new Set()); // 🔧 Fix: 이미 큐에 추가된 ID 추적
  const lastMessageIdsRef = useRef<string>(''); // 🔧 Fix3: 전체 메시지 ID 시그니처 추적
  
  useEffect(() => {
    // 🔧 Fix3: 메시지 ID 시그니처로 변경 감지 (방 전환, 삭제, 클리어 모두 처리)
    const currentIdsSignature = messages.map(m => m.id).join(',');
    const prevIdsSignature = lastMessageIdsRef.current;
    
    // 메시지가 비어있으면 UI 클리어
    if (!messages || messages.length === 0) {
      if (displayedMessages.length > 0 || messageQueueRef.current.length > 0) {
        console.log(`[🎬 Step 44] 메시지 클리어 감지, UI 리셋`);
        setDisplayedMessages([]);
        messageQueueRef.current = [];
        queuedIdsRef.current.clear();
        isProcessingQueueRef.current = false;
        lastDisplayedIdRef.current = 0;
      }
      lastMessageIdsRef.current = '';
      return;
    }
    
    // 🔧 Fix3: 메시지가 삭제되거나 방이 바뀌면 displayedMessages를 서버 상태와 동기화
    // 시그니처가 변경되고, 새 메시지 중 displayedMessages에 없는 것이 없으면 = 삭제 발생
    const serverIds = new Set(messages.map(m => m.id));
    const displayedIds = new Set(displayedMessages.map(m => m.id));
    
    // displayedMessages에 있지만 서버에 없는 메시지 = 삭제됨
    const deletedFromDisplay = displayedMessages.filter(m => !serverIds.has(m.id));
    
    // 방 전환 감지: 첫 메시지 ID가 완전히 다르면 완전 리셋
    const currentFirstId = messages[0]?.id;
    const displayedFirstId = displayedMessages[0]?.id;
    const isRoomSwitch = displayedFirstId && currentFirstId && 
      displayedFirstId !== currentFirstId && 
      !serverIds.has(displayedFirstId);
    
    if (isRoomSwitch) {
      console.log(`[🎬 Step 44] 방 전환 감지: ${displayedFirstId} → ${currentFirstId}, 완전 리셋`);
      setDisplayedMessages([]);
      messageQueueRef.current = [];
      queuedIdsRef.current.clear();
      isProcessingQueueRef.current = false;
      lastDisplayedIdRef.current = 0;
      lastMessageIdsRef.current = currentIdsSignature;
      return;
    }
    
    // 삭제된 메시지가 있으면 displayedMessages에서 제거
    if (deletedFromDisplay.length > 0) {
      console.log(`[🎬 Step 44] ${deletedFromDisplay.length}개 메시지 삭제 감지, UI 동기화`);
      setDisplayedMessages(prev => prev.filter(m => serverIds.has(m.id)));
      deletedFromDisplay.forEach(m => queuedIdsRef.current.delete(m.id));
    }
    
    // 🔧 Fix: 큐에서 서버에 없는 메시지 필터링 + queuedIdsRef에서도 제거
    const queuedButDeleted = messageQueueRef.current.filter(m => !serverIds.has(m.id));
    if (queuedButDeleted.length > 0) {
      console.log(`[🎬 Step 44] 큐에서 ${queuedButDeleted.length}개 삭제된 메시지 제거`);
      messageQueueRef.current = messageQueueRef.current.filter(m => serverIds.has(m.id));
      queuedButDeleted.forEach(m => queuedIdsRef.current.delete(m.id));
    }
    
    lastMessageIdsRef.current = currentIdsSignature;
    
    // 🔧 Fix4: displayedIds를 삭제 동기화 후 다시 계산 (레이스 컨디션 방지)
    // 이렇게 해야 삭제 후 다시 나타난 메시지를 올바르게 처리
    const updatedDisplayedIds = new Set(
      displayedMessages.filter(m => serverIds.has(m.id)).map(m => m.id)
    );
    
    // 🔧 Fix: 이미 표시됐거나 큐에 있는 메시지는 제외
    const newMessages = messages.filter(m => 
      !updatedDisplayedIds.has(m.id) && !queuedIdsRef.current.has(m.id)
    );
    
    if (newMessages.length === 0) return;
    
    console.log(`[🎬 Step 44] 새 메시지 ${newMessages.length}개 발견, 큐에 추가`);
    
    // 새 메시지 ID 기록
    newMessages.forEach(m => queuedIdsRef.current.add(m.id));
    
    // 🔧 Fix5: 서버 순서 유지 - 전체 큐를 서버(messages) 순서대로 재정렬
    // 일시 삭제 후 복원된 메시지도 올바른 위치에 삽입됨
    const serverOrderMap = new Map(messages.map((m, idx) => [m.id, idx]));
    const combinedQueue = [...messageQueueRef.current, ...newMessages];
    const sortedQueue = combinedQueue.sort((a, b) => {
      const aIdx = serverOrderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bIdx = serverOrderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return aIdx - bIdx;
    });
    messageQueueRef.current = sortedQueue;
    
    // 🔧 Step 44 Fix: 초기 로드시 모든 메시지 즉시 표시, 새 메시지만 순차 표시
    // 페이지 로드 시 이미 DB에 있던 메시지는 바로 표시하고
    // 이후 새로 추가되는 메시지만 순차적으로 표시
    const isInitialLoad = displayedMessages.length === 0 && newMessages.length > 1;
    
    if (isInitialLoad) {
      // 초기 로드: 모든 메시지 즉시 표시 (sources 포함)
      console.log(`[🎬 Step 44] 초기 로드: ${newMessages.length}개 메시지 즉시 표시`);
      setDisplayedMessages(messages);
      messageQueueRef.current = [];
      newMessages.forEach(m => queuedIdsRef.current.delete(m.id));
      isProcessingQueueRef.current = false;
    } else {
      // 새 메시지 도착: 순차 표시
      const processNext = () => {
        if (messageQueueRef.current.length === 0) {
          isProcessingQueueRef.current = false;
          return;
        }
        
        const nextMessage = messageQueueRef.current.shift()!;
        const isUserMessage = !nextMessage.agentId && (nextMessage.senderId || nextMessage.sender);
        
        // 메시지 추가 (sources 보존)
        setDisplayedMessages(prev => {
          if (prev.some(m => m.id === nextMessage.id)) return prev;
          lastDisplayedIdRef.current = nextMessage.id;
          return [...prev, nextMessage];
        });
        
        queuedIdsRef.current.delete(nextMessage.id);
        console.log(`[🎬 Step 44] 메시지 표시: ID=${nextMessage.id}, sources=${!!nextMessage.sources}`);
        
        if (messageQueueRef.current.length > 0) {
          const delay = isUserMessage ? 500 : 1500; // 새 메시지는 빠르게
          setTimeout(processNext, delay);
        } else {
          isProcessingQueueRef.current = false;
        }
      };
      
      if (!isProcessingQueueRef.current && messageQueueRef.current.length > 0) {
        isProcessingQueueRef.current = true;
        processNext();
      }
    }
  }, [messages]);

  // 🎭 Perspectives fetch 함수
  const fetchPerspectives = async (topic: string, question: string, messageId: number) => {
    console.log(`[🎭 FETCH START] Fetching perspectives for message ${messageId}`);
    setLoadingPerspectives(true);
    
    // 🕐 타임아웃 180초로 설정 (Step 10 Texturing + 심층 검색 + 분석 시간 고려)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);
    
    try {
      // 🎬 시나리오 작가 모드: 메인 답변(originalAnswer) 찾기
      const message = messages.find(m => m.id === messageId);
      const originalAnswer = message?.content || '';
      const agentName = message?.agent?.name || ''; // ✅ 답변 작성 agent 이름 추출
      
      const response = await fetch('/api/search/perspectives', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin
        },
        body: JSON.stringify({ 
          topic, 
          question,
          messageId, // ✅ 답변 메시지의 sources 재사용
          originalAnswer, // 🎬 시나리오 작가 모드: 대사 생성을 위한 메인 답변
          agentName // ✅ Dynamic Title Recognition용 agent 이름
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error('Failed to fetch perspectives');
      
      const data: PerspectiveData = await response.json();
      
      // ✅ 에러 처리: success: false 응답
      if (!data.success) {
        console.error(`[❌ PERSPECTIVES] ${data.errorCode || 'UNKNOWN'}:`, data.message);
        
        // 🛑 실패한 메시지 ID 추적하여 무한 루프 방지 (불변 배열)
        setFailedPerspectiveIds(prev => prev.includes(messageId) ? prev : [...prev, messageId]);
        
        toast({
          variant: "destructive",
          title: "관점 분석 실패",
          description: data.message || "관점을 찾을 수 없습니다.",
        });
        return;
      }
      
      // ✅ 빈 배열 체크
      if (!data.perspectives || data.perspectives.length === 0) {
        console.warn(`[⚠️ PERSPECTIVES] No perspectives for message ${messageId}`);
        
        // 🛑 빈 배열도 실패로 추적 (불변 배열)
        setFailedPerspectiveIds(prev => prev.includes(messageId) ? prev : [...prev, messageId]);
        
        toast({
          title: "관점 없음",
          description: "이 주제에서 다양한 관점을 찾을 수 없었습니다.",
        });
        return;
      }
      
      console.log(`[🎭 PERSPECTIVES] Fetched ${data.perspectives.length} perspectives for message ${messageId} (reused: ${data.sourcesReused || false})`, data);
      
      // ✅ 성공 시 실패 목록에서 제거 (일시적 오류 복구)
      setFailedPerspectiveIds(prev => prev.filter(id => id !== messageId));
      
      setPerspectivesByMessage(prev => {
        const updated = {
          ...prev,
          [messageId]: data.perspectives
        };
        
        // ✅ 첫 번째 persona를 자동 선택하여 즉시 표시
        if (data.perspectives.length > 0) {
          setCurrentPerspective(prevPerspective => ({
            ...prevPerspective,
            [messageId]: data.perspectives[0]
          }));
          console.log(`[🎭 AUTO-SELECT] Selected first persona: ${data.perspectives[0].name} for message ${messageId}`);
        }
        
        return updated;
      });
    } catch (error: any) {
      console.error('[🎭 ERROR] Failed to fetch perspectives:', error);
      
      // 🛑 네트워크 오류도 실패로 추적 (불변 배열)
      setFailedPerspectiveIds(prev => prev.includes(messageId) ? prev : [...prev, messageId]);
      
      // 🕐 타임아웃 에러 구분
      const isTimeout = error?.name === 'AbortError';
      
      toast({
        variant: "destructive",
        title: isTimeout ? "응답 시간 초과" : "네트워크 오류",
        description: isTimeout 
          ? "AI가 답변을 생성하는데 시간이 너무 오래 걸렸습니다. 잠시 후 다시 시도해주세요."
          : "관점을 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      });
      
      clearTimeout(timeoutId);
    } finally {
      setLoadingPerspectives(false);
    }
  };
  
  // 🗣️ Generate perspective reply (1인칭 토론 답변)
  
  // 🎭 자동 perspectives 로드 (첫 번째 에이전트 답변에 대해)
  useEffect(() => {
    console.log('[🎭 PERSPECTIVES DEBUG]', {
      embedCode,
      messagesLength: messages.length,
      messages: messages.map(m => ({ id: m.id, agentId: m.agentId, content: m.content?.substring(0, 30) })),
      perspectivesByMessage,
      loadingPerspectives
    });
    
    // 📚 Debug: Check sources in messages here (definitely runs)
    const msgsWithSources = messages.filter(m => m.sources);
    if (msgsWithSources.length > 0) {
      console.log(`[📚 SOURCES EFFECT] Found ${msgsWithSources.length} messages with sources:`);
      msgsWithSources.forEach(m => {
        console.log(`  - Message ${m.id}: sources=`, m.sources);
      });
    } else if (messages.length > 0) {
      console.log(`[📚 SOURCES EFFECT] No sources found in ${messages.length} messages`);
    }
    
    if (!embedCode || messages.length === 0) {
      console.log('[🎭 SKIP] No embedCode or messages');
      return;
    }
    
    // 마지막 2개 메시지 확인 (사용자 질문 + 에이전트 답변)
    if (messages.length >= 2) {
      const lastMsg = messages[messages.length - 1];
      const prevMsg = messages[messages.length - 2];
      
      // ✅ 빈 배열 체크 수정
      const currentPerspectives = lastMsg.id ? perspectivesByMessage[lastMsg.id] : undefined;
      const hasPerspectives = currentPerspectives && currentPerspectives.length > 0;
      
      // 🛑 이미 실패한 메시지는 재시도하지 않음
      const hasFailed = lastMsg.id && failedPerspectiveIds.includes(lastMsg.id);
      
      console.log('[🎭 CHECK]', {
        lastMsgId: lastMsg.id,
        lastMsgAgentId: lastMsg.agentId,
        prevMsgAgentId: prevMsg.agentId,
        hasPerspectives,
        perspectivesCount: currentPerspectives?.length || 0,
        isLoading: loadingPerspectives,
        hasFailed // ✅ 실패 여부 추가
      });
      
      // 에이전트 메시지이고, 이전 메시지가 사용자 메시지이며, 아직 perspectives가 없고, 실패하지 않은 경우
      if (
        lastMsg.agentId && 
        !prevMsg.agentId && // 이전 메시지가 사용자 메시지 (agentId 없음)
        lastMsg.id &&
        !hasPerspectives && // ✅ 빈 배열 체크 수정
        !loadingPerspectives &&
        !hasFailed // 🛑 실패한 메시지 제외
      ) {
        // 질문 내용에서 topic 추출 (간단하게 처음 50자 사용)
        const question = prevMsg.content;
        const topic = question.substring(0, 50).replace(/\?/g, '').trim();
        
        console.log(`[🎭 AUTO FETCH] Fetching perspectives for message ${lastMsg.id}`);
        fetchPerspectives(topic, question, lastMsg.id);
      }
    }
  }, [messages, embedCode, perspectivesByMessage, loadingPerspectives, failedPerspectiveIds]);

  const { data: trendingTopics = [] } = useQuery<TrendingTopic[]>({
    queryKey: [`/api/embed/${embedCode}/trending`],
    enabled: !!guestToken,
    queryFn: async () => {
      const response = await fetch(
        `/api/embed/${embedCode}/trending`,
        {
          headers: {
            'Authorization': `Bearer ${guestToken}`,
            'Origin': window.location.origin
          }
        }
      );
      if (!response.ok) throw new Error('Failed to fetch trending topics');
      return response.json();
    },
  });

  // 📰 Google News 쿼리
  const { data: newsData, isLoading: isNewsLoading } = useQuery<NewsResponse>({
    queryKey: ['/api/news'],
    queryFn: async () => {
      const response = await fetch('/api/news');
      if (!response.ok) throw new Error('Failed to fetch news');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5분 캐싱
    refetchInterval: 10 * 60 * 1000, // 10분마다 새로고침
  });

  // 📰 현재 선택된 섹션의 뉴스 가져오기
  const currentSectionNews = newsData?.news?.[selectedNewsSection]?.items || [];

  const disambiguateMutation = useMutation({
    mutationFn: async (characterName: string) => {
      const response = await fetch(`/api/embed/${embedCode}/disambiguate`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin
        },
        body: JSON.stringify({ characterName }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to search character');
      }
      return response.json();
    },
    retry: false,
    onSuccess: (data: { status: 'unique' | 'needsSelection'; candidates: Candidate[] }) => {
      if (data.status === 'unique' && data.candidates.length > 0) {
        if (!confirmCharacterMutation.isPending) {
          confirmCharacterMutation.mutate(data.candidates[0]);
        }
      } else if (data.status === 'needsSelection' && data.candidates.length > 0) {
        // needsSelection 상태일 때 후보 목록 표시
        setCandidatesList(data.candidates);
        setShowCandidatesDialog(true);
      } else {
        // 후보가 없는 경우
        pendingQuestionRef.current = null;
        toast({
          title: "인물을 찾을 수 없습니다",
          description: "다른 이름을 시도해 주세요.",
        });
      }
    },
    onError: (error: any) => {
      // 에러 발생 시 pendingQuestion 초기화
      pendingQuestionRef.current = null;
      toast({
        title: "오류",
        description: error.message || "인물 검색에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const detailedSearchMutation = useMutation({
    mutationFn: async (params: { characterName: string; occupation?: string; affiliation?: string; activePeriod?: string }) => {
      const response = await fetch(`/api/embed/${embedCode}/detailed-search`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin
        },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to search character details');
      }
      return response.json();
    },
    retry: false,
    onSuccess: (data: { status: 'matched' | 'new'; profile: any; dbCandidates: any[] }) => {
      // 초기화
      setShowDetailedSearch(false);
      setOccupation("");
      setAffiliation("");
      setActivePeriod("");
      
      // matched든 new든 모두 confirmCharacterMutation 호출
      // 백엔드에서 중복 체크 후 기존 agent 재사용 or 신규 생성
      if (data.status === 'matched') {
        toast({
          title: "기존 인물 발견",
          description: `${data.profile.fullName}은(는) 이미 등록된 인물입니다. 해당 관점으로 전환합니다.`,
        });
      } else {
        toast({
          title: "신규 인물 확인",
          description: `${data.profile.fullName}에 대한 정보를 찾았습니다. 새 캐릭터를 생성합니다.`,
        });
      }
      
      const candidate: Candidate = {
        fullName: data.profile.fullName,
        primaryDescriptor: data.profile.primaryDescriptor,
        notability: 10,
        confidence: data.profile.confidence || 1.0,
        isUnique: true
      };
      
      confirmCharacterMutation.mutate(candidate);
    },
    onError: (error: any) => {
      toast({
        title: "오류",
        description: error.message || "상세 검색에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const confirmCharacterMutation = useMutation({
    mutationFn: async (candidate: Candidate) => {
      const response = await fetch(`/api/embed/${embedCode}/confirm-character`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin
        },
        body: JSON.stringify({ candidate }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create character');
      }
      return response.json();
    },
    retry: false,
    onSuccess: async (data: { agent: Agent; selectedAgentIds?: number[] }) => {
      setSelectedAgentId(data.agent.id);
      
      // selectedAgentIds가 백엔드에서 자동으로 업데이트되지 않은 경우 수동으로 선택
      if (!data.selectedAgentIds || !data.selectedAgentIds.includes(data.agent.id)) {
        try {
          await fetch(`/api/embed/${embedCode}/select-agent`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${guestToken}`,
              'Origin': window.location.origin
            },
            body: JSON.stringify({ agentId: data.agent.id }),
          });
        } catch (error) {
          console.error('Failed to auto-select agent:', error);
        }
      }
      
      await queryClient.invalidateQueries({ queryKey: [`/api/embed/${embedCode}/agents`] });
      await queryClient.refetchQueries({ queryKey: [`/api/embed/${embedCode}/agents`] });
      if (onAgentsUpdate) {
        onAgentsUpdate();
      }
      toast({
        title: "관점 추가 완료",
        description: `${data.agent.name} 관점이 활성화되었습니다.`,
      });
      
      // 질문 예시로부터 생성된 경우 자동으로 질문 전송
      // characterName이 일치하는 경우에만 전송 (동시성 버그 방지)
      if (pendingQuestionRef.current && data.agent.name === pendingQuestionRef.current.characterName) {
        const questionToSend = pendingQuestionRef.current.question;
        pendingQuestionRef.current = null;
        
        // 짧은 지연 후 질문 전송 (agent 선택이 완전히 완료되도록)
        setTimeout(() => {
          // Step 28: mutation 호출 전에 직접 ID 설정 (stale closure 방지)
          const lastMsg = messages[messages.length - 1];
          lastMessageIdWhenSent.current = lastMsg?.id ?? 0;
          console.log(`[🔄 LOADING START] Step 28: Stored lastMessageId=${lastMessageIdWhenSent.current}`);
          
          sendMessageMutation.mutate(questionToSend);
        }, 300);
      }
    },
    onError: (error: any) => {
      pendingQuestionRef.current = null;
      toast({
        title: "오류",
        description: error.message || "캐릭터 생성에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      const response = await fetch(`/api/embed/${embedCode}/messages`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin
        },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to send message');
      }
      return response.json();
    },
    retry: false,
    onSuccess: () => {
      setMessageInput("");
      setIsWaitingForResponse(true);
      queryClient.invalidateQueries({ queryKey: [`/api/embed/${embedCode}/messages`] });
    },
    onError: (error: any) => {
      setIsWaitingForResponse(false);
      lastMessageIdWhenSent.current = -1; // Step 28: 에러 시 리셋 (-1 = 미설정)
      toast({
        title: "오류",
        description: error.message || "메시지 전송에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  // 🎬 시나리오 기반 질문 처리 Mutation
  const scenarioMutation = useMutation({
    mutationFn: async ({ question, mainCharacter }: { question: string; mainCharacter?: string }) => {
      const response = await fetch(`/api/embed/${embedCode}/scenario`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin
        },
        body: JSON.stringify({ question, mainCharacter }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to generate scenario');
      }
      return response.json();
    },
    retry: false,
    onSuccess: () => {
      setMessageInput("");
      setIsWaitingForResponse(true);
      queryClient.invalidateQueries({ queryKey: [`/api/embed/${embedCode}/messages`] });
    },
    onError: (error: any) => {
      setIsWaitingForResponse(false);
      lastMessageIdWhenSent.current = -1; // Step 28: 에러 시 리셋 (-1 = 미설정)
      toast({
        title: "시나리오 생성 실패",
        description: error.message || "시나리오를 생성하는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 🎭 Step 46: Speaker Chips - 발언자 목록 가져오기
  const fetchSpeakersMutation = useMutation({
    mutationFn: async () => {
      if (!groupChatId) return { speakers: [] };
      
      const response = await fetch(`/api/verdict/speakers`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin
        },
        body: JSON.stringify({ groupChatId }),
      });
      if (!response.ok) throw new Error('Failed to fetch speakers');
      return response.json();
    },
    onSuccess: (data) => {
      setLoadingSpeakers(false);
      // 🎭 Step 46: Stale-response 가드 - 새 응답 생성 중이면 무시
      // speakersLoadedRef가 false이면 이미 새 질문이 시작되었다는 의미
      if (!speakersLoadedRef.current) {
        console.log('[🎭 Step 46] Stale response - ignoring speakers (new question started)');
        return;
      }
      if (data.speakers && data.speakers.length > 0) {
        setSpeakerChips(data.speakers);
        console.log(`[🎭 Step 46] Loaded ${data.speakers.length} speakers`);
      }
    },
    onError: (error) => {
      setLoadingSpeakers(false);
      console.error('[🎭 Step 46] Failed to fetch speakers:', error);
    }
  });

  // 🎭 Step 46: Speaker Expansion - 인물 추가 발언 생성
  const expandSpeakerMutation = useMutation({
    mutationFn: async (speaker: RecommendedSpeaker) => {
      if (!groupChatId) throw new Error('No group chat ID');
      
      // 🎭 Step 46 Fix: chat_history를 함께 전송 (백엔드에서 대화 맥락 파악용)
      const chatHistory = displayedMessages.map(msg => ({
        id: msg.id,
        content: msg.content,
        agentName: msg.agentName || null,
        senderId: msg.senderId || null,
        createdAt: msg.createdAt
      }));
      
      const response = await fetch(`/api/verdict/expand-speaker`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin
        },
        body: JSON.stringify({ 
          groupChatId,
          speakerName: speaker.name,
          speakerTitle: speaker.title,
          isExisting: speaker.isExisting,
          chatHistory  // 🎭 대화 히스토리 전송
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to expand speaker');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setExpandingSpeaker(null);
      queryClient.invalidateQueries({ queryKey: [`/api/embed/${embedCode}/messages`] });
      toast({
        title: `${data.response.name}의 추가 발언`,
        description: "새로운 관점이 추가되었습니다.",
      });
    },
    onError: (error: any) => {
      setExpandingSpeaker(null);
      toast({
        title: "발언 생성 실패",
        description: error.message || "추가 발언을 생성하는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  });

  // 🎭 Step 46-1: 응답 생성 중에는 스피커 칩 즉시 숨김
  useEffect(() => {
    if (isWaitingForResponse || sendMessageMutation.isPending || scenarioMutation.isPending) {
      // 응답 대기 시작 → 즉시 칩 숨기기 및 리셋
      if (speakerChips.length > 0) {
        console.log('[🎭 Step 46] Response pending - hiding speaker chips');
        setSpeakerChips([]);
        speakersLoadedRef.current = false;
      }
    }
  }, [isWaitingForResponse, sendMessageMutation.isPending, scenarioMutation.isPending]);

  // 🎭 Step 46-2 Refactored: 메시지에서 직접 suggestionChips 읽기 (API 호출 불필요)
  // 토론 완료 판단: AI 메시지가 최소 4개 이상 && 마지막 메시지에 suggestionChips가 있음
  useEffect(() => {
    // 새 대화 시작 시 리셋
    if (messages.length === 0) {
      speakersLoadedRef.current = false;
      setSpeakerChips([]);
      return;
    }
    
    // 응답 대기 중이면 로드 안함
    if (isWaitingForResponse || sendMessageMutation.isPending || scenarioMutation.isPending) {
      return;
    }
    
    // 🎭 Step 46 Fix: 현재 로드된 칩이 있으면 스킵 (speakersLoadedRef 대신 실제 칩 상태 확인)
    // 이전에는 speakersLoadedRef.current가 API fallback에서도 true로 설정되어
    // 이후 메시지에 suggestionChips가 도착해도 무시되는 버그가 있었음
    if (speakerChips.length > 0) {
      return;
    }
    
    // AI 메시지 카운트 (토론 완료 판단 기준: 최소 4개 이상의 AI 응답)
    const aiMessages = messages.filter(m => m.agentName && !m.senderId && m.content && m.content.length > 50);
    
    console.log(`[🎭 Step 46 DEBUG] Messages: ${messages.length}, AI: ${aiMessages.length}, speakerChips: ${speakerChips.length}`);
    
    // 🎭 Step 46 New: 마지막 AI 메시지에서 suggestionChips 찾기 (역순 탐색)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      // 메시지에 suggestionChips가 있으면 사용
      if (msg.suggestionChips && Array.isArray(msg.suggestionChips) && msg.suggestionChips.length > 0) {
        console.log(`[🎭 Step 46] Found suggestionChips in message ${msg.id}: ${msg.suggestionChips.length} chips`);
        
        // suggestionChips를 RecommendedSpeaker 형식으로 변환
        const convertedSpeakers: RecommendedSpeaker[] = msg.suggestionChips.map((chip: any) => ({
          name: chip.name,
          title: chip.title,
          reason: chip.desc || '',
          stance: chip.action === 'more_info' ? 'neutral' : 'authority',
          speaker_icon: chip.action === 'more_info' ? '💬' : '🆕',
          isExisting: chip.action === 'more_info'
        }));
        
        setSpeakerChips(convertedSpeakers);
        speakersLoadedRef.current = true;
        return;
      }
    }
    
    // Fallback: suggestionChips가 없는 경우 기존 API 호출 (backwards compatibility)
    // 마지막 메시지가 AI 응답이고, AI 메시지가 4개 이상이면 토론 완료로 판단
    const lastMessage = messages[messages.length - 1];
    const isDebateComplete = aiMessages.length >= 4 && 
                              lastMessage?.agentName && 
                              !lastMessage?.senderId &&
                              lastMessage?.content?.length > 50;
    
    // 🎭 Step 46 Fix: speakersLoadedRef 대신 !loadingSpeakers 사용
    // API 호출 중이 아닐 때만 fallback 시도
    if (groupChatId && isDebateComplete && !loadingSpeakers && !speakersLoadedRef.current) {
      console.log(`[🎭 Step 46] No embedded chips, fallback to API: ${aiMessages.length} AI messages`);
      speakersLoadedRef.current = true;
      setLoadingSpeakers(true);
      fetchSpeakersMutation.mutate();
    }
  }, [messages, isWaitingForResponse, groupChatId, sendMessageMutation.isPending, scenarioMutation.isPending, speakerChips.length, loadingSpeakers]);

  const handleSpeakerChipClick = (speaker: RecommendedSpeaker) => {
    if (expandSpeakerMutation.isPending) return;
    setExpandingSpeaker(speaker.name);
    expandSpeakerMutation.mutate(speaker);
  };

  // 📰 Step 47: 핵심 제출 로직 추출 (직접 호출 가능)
  const submitQuestion = (question: string) => {
    if (sendMessageMutation.isPending || isWaitingForResponse || scenarioMutation.isPending || disambiguateMutation.isPending || confirmCharacterMutation.isPending) {
      return;
    }
    
    if (!question.trim()) return;

    const input = question.trim();

    // Step 28: mutation 호출 전에 직접 ID 설정 (stale closure 방지)
    const lastMsg = messages[messages.length - 1];
    lastMessageIdWhenSent.current = lastMsg?.id ?? 0;
    console.log(`[🔄 LOADING START] Step 28: Stored lastMessageId=${lastMessageIdWhenSent.current}`);
    
    // 새 질문 시 speaker chips 초기화
    setSpeakerChips([]);
    speakersLoadedRef.current = false;
    
    scenarioMutation.mutate({ question: input });
  };

  const handleSubmit = (e: React.FormEvent | React.KeyboardEvent) => {
    e.preventDefault();
    
    const currentTimeStamp = 'timeStamp' in e ? e.timeStamp : Date.now();
    if (currentTimeStamp === lastSubmitTimeStamp.current) {
      return;
    }
    lastSubmitTimeStamp.current = currentTimeStamp;
    
    submitQuestion(messageInput);
  };

  const handleFollowUpClick = (question: string) => {
    setMessageInput(question);
    submitQuestion(question);
  };

  const handleQuestionExampleClick = (example: TrendingTopic) => {
    setMessageInput(example.title);
  };

  const handleSampleQuestionClick = (sample: SampleQuestion) => {
    // 인물명 추출 및 질문 저장 (characterName도 함께 저장하여 동시성 버그 방지)
    const characterName = extractCharacterName(sample.character);
    pendingQuestionRef.current = {
      characterName,
      question: sample.question
    };
    
    // 관점 생성 (confirmCharacterMutation의 onSuccess에서 자동으로 질문 전송됨)
    disambiguateMutation.mutate(characterName);
  };

  // 🎬 Hot Topic 클릭 - 시나리오 기반 질문 처리
  const handleHotTopicClick = (topic: any) => {
    const characterName = topic.character || topic.title;
    const question = topic.question || topic.subtitle;
    
    // 전체 질문 포맷: "인물에게: 질문"
    const fullQuestion = `${characterName}에게: ${question}`;
    
    // Step 28: mutation 호출 전에 직접 ID 설정 (stale closure 방지)
    const lastMsg = messages[messages.length - 1];
    lastMessageIdWhenSent.current = lastMsg?.id ?? 0;
    console.log(`[🔄 LOADING START] Step 28: Stored lastMessageId=${lastMessageIdWhenSent.current}`);
    
    // 시나리오 생성 API 호출
    scenarioMutation.mutate({ question: fullQuestion, mainCharacter: characterName });
  };

  const handleSelectAgent = async (agentId: number) => {
    // 수동 선택 시 pendingQuestion 초기화 (sample question 플로우가 아님)
    pendingQuestionRef.current = null;
    
    try {
      await fetch(`/api/embed/${embedCode}/select-agent`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin
        },
        body: JSON.stringify({ agentId }),
      });
      
      setSelectedAgentId(agentId);
      setShowManageModal(false);
      
      await queryClient.invalidateQueries({ queryKey: [`/api/embed/${embedCode}/agents`] });
      if (onAgentsUpdate) {
        onAgentsUpdate();
      }
      
      const agent = agents.find(a => a.id === agentId);
      toast({
        title: "관점 선택 완료",
        description: `${agent?.name} 관점으로 전환되었습니다.`,
      });
    } catch (error) {
      toast({
        title: "오류",
        description: "관점 선택에 실패했습니다.",
        variant: "destructive",
      });
    }
  };

  const handleCreateView = () => {
    if (!createViewInput.trim()) {
      toast({
        title: "오류",
        description: "인물 이름을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    
    // 수동 생성 시 pendingQuestion 초기화 (sample question 플로우가 아님)
    pendingQuestionRef.current = null;
    
    disambiguateMutation.mutate(createViewInput.trim());
    setCreateViewInput("");
    setShowManageModal(false);
  };

  const handleQuickCreate = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (!quickCreateInput.trim()) {
      toast({
        title: "오류",
        description: "인물 이름을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    
    // 수동 생성 시 pendingQuestion 초기화 (sample question 플로우가 아님)
    pendingQuestionRef.current = null;
    
    // 상세 검색 모드인 경우 detailed-search API 호출
    if (showDetailedSearch && (occupation || affiliation || activePeriod)) {
      detailedSearchMutation.mutate({
        characterName: quickCreateInput.trim(),
        occupation: occupation.trim() || undefined,
        affiliation: affiliation.trim() || undefined,
        activePeriod: activePeriod.trim() || undefined,
      });
      setQuickCreateInput("");
    } else {
      // 기본 동명이인 검색
      disambiguateMutation.mutate(quickCreateInput.trim());
      setQuickCreateInput("");
    }
  };

  // 🎬 Step 44 Fix: displayedMessages 변경 시 스크롤 (순차 표시와 연동)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayedMessages]);

  // Step 28+32: ID 기반 로딩 종료 - 저장된 ID보다 큰 AI 메시지가 도착하면 로딩 종료
  // 핵심: lastMessage.id > lastMessageIdWhenSent AND 마지막이 AI 응답
  // 장점: 시계 동기화 불필요, 서버 ID는 항상 순차적으로 증가
  // 초기값 -1: 빈 대화에서 첫 질문 시에도 정상 작동 (0 > -1 = true)
  // Step 32 수정: VERDICT 시나리오는 agentId/agentName 없이 senderId=null로 AI 메시지 구분
  useEffect(() => {
    if (isWaitingForResponse && lastMessageIdWhenSent.current >= 0) {
      const lastMessage = messages[messages.length - 1];
      
      // AI 응답 확인: 
      // 1. agentId 또는 agentName이 있으면 AI 메시지 (일반 채팅)
      // 2. sender가 null/undefined이고 content에 캐릭터 형식(**이모지 이름**)이 있으면 VERDICT 시나리오 메시지
      const isNormalAIResponse = lastMessage?.agentId || lastMessage?.agentName;
      const isScenarioMessage = !lastMessage?.sender && 
                                 !lastMessage?.senderName && 
                                 lastMessage?.content?.startsWith('**');
      const isAIResponse = isNormalAIResponse || isScenarioMessage;
      
      // 저장된 ID보다 큰 새 AI 메시지가 도착했으면 로딩 종료
      if (isAIResponse && lastMessage?.id && lastMessage.id > lastMessageIdWhenSent.current) {
        console.log(`[🔄 LOADING END] Step 32: New AI message! (storedId: ${lastMessageIdWhenSent.current}, newId: ${lastMessage.id}, isScenario: ${isScenarioMessage})`);
        setIsWaitingForResponse(false);
        lastMessageIdWhenSent.current = -1; // 리셋 (-1 = 미설정)
      }
    }
  }, [messages, isWaitingForResponse]);

  // 타임아웃 처리: 180초 이상 응답이 없으면 스피너 중지
  useEffect(() => {
    if (!isWaitingForResponse) return;
    
    const timeoutId = setTimeout(() => {
      setIsWaitingForResponse(false);
      lastMessageIdWhenSent.current = -1; // Step 28: 타임아웃 시 리셋 (-1 = 미설정)
      toast({
        title: "응답 시간 초과",
        description: "AI 응답 생성 중 오류가 발생했습니다. 다시 시도해주세요.",
        variant: "destructive",
      });
    }, 180000); // 180초 - 심층 분석 시 Google Search + AI 처리 시간
    
    return () => clearTimeout(timeoutId);
  }, [isWaitingForResponse]);

  const formatMessageTime = (dateString: string) => {
    const messageDate = new Date(dateString);
    return messageDate.toLocaleTimeString('ko-KR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  // 🎭 하단 버튼: Perspectives만 표시 (trending topics fallback 제거)
  const lastMessage = messages[messages.length - 1];
  const lastMessagePerspectives = lastMessage?.id && lastMessage.agentId 
    ? perspectivesByMessage[lastMessage.id] 
    : undefined;
  
  // ✅ perspectives가 있을 때만 표시 (trending topics로 fallback 안함)
  const randomExamples = (lastMessagePerspectives && lastMessagePerspectives.length > 0)
    ? lastMessagePerspectives.map(p => ({
        id: `perspective-${p.name}`,
        title: `${p.name} (${p.role})`,
        iconEmoji: '',
        persona: p
      }))
    : []; // trending topics 제거 - suggestion_chips만 사용

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-900">
      {/* 1. 상단 영역 (서비스 정체성 및 관점 관리) */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-b from-gray-50 to-white dark:from-gray-800 dark:to-gray-900">
        <div className="px-4 py-4 space-y-3">
          {/* 제목/로고 + 새 대화 버튼 */}
          <div className="text-center relative">
            {/* 🏠 새 대화 버튼 - 대화가 있을 때만 표시 */}
            {displayedMessages.length > 0 && (
              <button
                onClick={() => resetChatMutation.mutate()}
                disabled={resetChatMutation.isPending}
                className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="button-new-chat"
              >
                {resetChatMutation.isPending ? (
                  <RotateCcw className="w-4 h-4 animate-spin" />
                ) : (
                  <Home className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">홈으로</span>
              </button>
            )}
            <h1 
              className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-2"
              data-testid="text-logo"
            >
              VERDICT
            </h1>
            {/* 슬로건 */}
            <p className="text-sm md:text-base font-semibold text-gray-700 dark:text-gray-300 tracking-wide">
              KILL SEARCH
            </p>
            <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 italic">
              From Information to Judgment.
            </p>
          </div>
        </div>
      </div>

      {/* 2. 중앙 영역 (Empty State / 대화 내용) */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {displayedMessages.length === 0 ? (
          /* Empty State - 뉴스 섹션 */
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* 📰 고정 프레임: 뉴스 헤더 + 섹션 탭 */}
            <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 pt-4 pb-3">
              {/* 섹션 헤더 */}
              <div className="flex items-center justify-between mb-3 max-w-2xl mx-auto">
                <div className="flex items-center gap-2">
                  <Newspaper className="w-5 h-5 text-blue-600" />
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                    오늘의 뉴스
                  </h2>
                </div>
                {newsData?.cacheStatus?.lastUpdated && (
                  <span className="text-xs text-gray-400">
                    업데이트: {new Date(newsData.cacheStatus.lastUpdated).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>

              {/* 섹션 탭 (드래그 스크롤 가능) */}
              <div 
                ref={newsSectionRef}
                className="overflow-x-auto scrollbar-hide -mx-4 px-4"
                onMouseDown={handleNewsSectionMouseDown}
                onMouseMove={handleNewsSectionMouseMove}
                onMouseUp={handleNewsSectionMouseUp}
                onMouseLeave={handleNewsSectionMouseLeave}
              >
                <div className="flex gap-2 min-w-max pb-1 max-w-2xl mx-auto">
                  {newsData?.sections && Object.entries(newsData.sections).map(([key, name]) => (
                    <button
                      key={key}
                      onClick={() => {
                        if (!newsSectionDragRef.current.hasDragged) {
                          setSelectedNewsSection(key);
                        }
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                        selectedNewsSection === key
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                      data-testid={`news-section-${key}`}
                    >
                      {NEWS_SECTION_ICONS[key]}
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 스크롤 가능한 뉴스 목록 영역 */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="max-w-2xl mx-auto">

                {/* 뉴스 목록 */}
                {isNewsLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                      뉴스를 불러오는 중...
                    </p>
                  </div>
                ) : currentSectionNews.length > 0 ? (
                  <div className="space-y-2">
                    {currentSectionNews.map((news) => (
                      <button
                        key={news.id}
                        onClick={() => {
                          setMessageInput(news.verdictQuestion);
                          submitQuestion(news.verdictQuestion);
                        }}
                        className="w-full text-left px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-gray-750 transition-colors hover:shadow-sm group"
                        data-testid={`news-item-${news.id}`}
                        disabled={sendMessageMutation.isPending || isWaitingForResponse}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 mt-0.5">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white">
                              {NEWS_SECTION_ICONS[news.section] || <Newspaper className="w-4 h-4" />}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white mb-1 line-clamp-2">
                              {cleanNewsTitle(news.title)}
                            </p>
                            <p className="text-sm text-blue-600 dark:text-blue-400 leading-relaxed line-clamp-1">
                              "{news.verdictQuestion}"
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <Newspaper className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">이 섹션에 뉴스가 없습니다.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* 대화 기록 - 🎬 Step 44: displayedMessages 사용 (순차 표시) */
          <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-4 max-w-3xl mx-auto">
            {/* 🎬 Step 44: displayedMessages 사용 (순차 표시, sources 보존) */}
            {displayedMessages.map((message) => {
              const verdictCharacterName = !message.senderName ? extractCharacterNameFromMessage(message.content) : null;
              const isVerdictMessage = !!verdictCharacterName;
              
              // 🎙️ Step 48: 앵커 티저 감지 - 하이브리드 방식
              // 앵커는 agentName='🎙️ 진행자'로 식별 (새 메시지)
              // 레거시 메시지는 content 휴리스틱으로 감지 (senderId/agentId 없음)
              const hasAnchorMetadata = message.agentName === '🎙️ 진행자';
              // 레거시: agentName 없고, 사용자 아님(senderId 없음), 에이전트 아님(agentId 없음)
              const isLegacyAnchorPattern = !message.agentName && !message.senderId && !message.agentId &&
                message.content && (
                  message.content.includes('시작합니다') ||
                  message.content.includes('알아보겠습니다') ||
                  message.content.includes('따져보겠습니다') ||
                  message.content.includes('입장을 들어보겠습니다') ||
                  message.content.includes('검증하겠습니다') ||
                  message.content.includes('흥미로운 상황입니다') ||
                  message.content.includes('답변을') ||
                  message.content.includes('관계자들 입장')
                );
              // 새 메시지: agentName 메타데이터로 확정 감지
              // 레거시: content 패턴 + 메타데이터 부재로 감지
              const isAnchorTeaser = !isVerdictMessage && 
                (hasAnchorMetadata || isLegacyAnchorPattern);
              
              const isUser = !message.agentId && !isVerdictMessage && !isAnchorTeaser;
              const agent = message.agent;
              const hasPerspectives = message.id && perspectivesByMessage[message.id]?.length > 0;
              
              return (
                <div
                  key={`${message.id}-${hasPerspectives ? 'with-perspectives' : 'no-perspectives'}`}
                  className={`flex ${isUser ? 'justify-center' : 'justify-start'}`}
                  data-testid={`message-${message.id}`}
                >
                  <div className={`${isUser ? 'w-full' : 'max-w-[80%]'} ${isUser ? '' : 'order-1'}`}>
                    {/* VERDICT 캐릭터 메시지 - Step 45: 통일된 포맷 + 캐릭터별 색상 */}
                    {isVerdictMessage && verdictCharacterName && (() => {
                      const charColor = getCharacterColor(verdictCharacterName);
                      const { displayName, role } = parseCharacterForAvatar(verdictCharacterName);
                      return (
                        <div className="flex items-start gap-3">
                          {/* 아바타 영역 - 이름 + 역할 표시 */}
                          <div className="flex flex-col items-center flex-shrink-0 w-20">
                            {/* 색상 테두리가 있는 아바타 - 이름 표시 */}
                            <div 
                              className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold shadow-md px-1"
                              style={{ 
                                backgroundColor: charColor.primary,
                                border: `3px solid ${charColor.primary}`,
                                fontSize: displayName.length <= 2 ? '1.1rem' : displayName.length <= 4 ? '0.75rem' : '0.65rem'
                              }}
                            >
                              {displayName}
                            </div>
                            {/* 역할 표시 */}
                            {role && (
                              <span 
                                className="mt-1 text-[10px] font-medium text-center leading-tight max-w-[80px] line-clamp-2"
                                style={{ color: charColor.primary }}
                              >
                                {role}
                              </span>
                            )}
                          </div>
                          
                          {/* 말풍선 영역 - 캐릭터별 색상 */}
                          <div className="flex-1 relative">
                            {/* 말풍선 꼬리 */}
                            <div 
                              className="absolute left-0 top-5 w-0 h-0 border-t-[8px] border-t-transparent border-b-[8px] border-b-transparent border-r-[10px] -translate-x-full"
                              style={{ borderRightColor: charColor.light }}
                            />
                            <div
                              className="rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm border"
                              style={{ 
                                backgroundColor: charColor.light,
                                borderColor: charColor.border
                              }}
                            >
                              {/* 📚 Perplexity 스타일 인용 지원 */}
                              <CitationContent
                                content={(() => {
                                  let cleanContent = message.content;
                                  cleanContent = cleanContent.replace(/^\*\*[^\s\*]+\s*[^\*]+\*\*\s*\n*/m, '');
                                  return cleanContent.trim();
                                })()}
                                sources={message.sources}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    
                    {/* 🎙️ 앵커 티저 메시지 - 이름 없이 말풍선만 표시 */}
                    {isAnchorTeaser && (
                      <div
                        className="rounded-2xl px-4 py-3 shadow-sm border bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                        style={{ marginBottom: '8px' }}
                      >
                        <div className="prose prose-sm max-w-none dark:prose-invert leading-relaxed">
                          <CitationContent
                            content={message.content}
                            sources={message.sources}
                          />
                        </div>
                      </div>
                    )}
                    
                    {/* 일반 에이전트 메시지 헤더 */}
                    {!isUser && !isVerdictMessage && !isAnchorTeaser && agent && (
                      <div className="flex items-center gap-2 mb-2">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
                          style={{ backgroundColor: agent.backgroundColor }}
                        >
                          <span>{agent.icon || '🤖'}</span>
                        </div>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {agent.name}
                        </span>
                        <span className="text-xs text-gray-500">
                          {formatMessageTime(message.createdAt)}
                        </span>
                      </div>
                    )}
                    
                    {/* 일반 메시지 (VERDICT이 아닌 경우, 앵커 티저도 아닌 경우) */}
                    {!isVerdictMessage && !isAnchorTeaser && (
                      <div
                        className={isUser ? 'user-question' : 'minimal-message assistant'}
                        style={{ marginBottom: '8px' }}
                      >
                        <div className={`${isUser ? '' : 'prose prose-sm max-w-none dark:prose-invert'} leading-relaxed`}>
                          {/* 📚 사용자 메시지가 아닌 경우 Perplexity 스타일 인용 지원 */}
                          {isUser ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {message.content}
                            </ReactMarkdown>
                          ) : (
                            <CitationContent
                              content={message.content}
                              sources={message.sources}
                            />
                          )}
                        </div>
                      </div>
                    )}

                    {!isUser && message.references && message.references.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {message.references.map((ref, idx) => (
                          <a
                            key={ref.id}
                            href={ref.url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            data-testid={`reference-${ref.id}`}
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span>{idx + 1}. {ref.title}</span>
                          </a>
                        ))}
                      </div>
                    )}

                    {!isUser && message.followUpQuestions && message.followUpQuestions.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          이 관점에서 더 알아보기:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {message.followUpQuestions.map((followUp) => (
                            <Button
                              key={followUp.id}
                              variant="outline"
                              size="sm"
                              onClick={() => handleFollowUpClick(followUp.question)}
                              className="text-xs h-auto py-2 px-3 min-h-[44px]"
                              data-testid={`followup-${followUp.id}`}
                            >
                              {followUp.question}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    {!isUser && message.id && perspectivesByMessage[message.id] && perspectivesByMessage[message.id].length > 0 && (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                          다른 관점에서 보기:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {perspectivesByMessage[message.id]
                            .filter(persona => persona.dialogue) // 🎬 시나리오 작가 모드: dialogue 없는 persona 제외
                            .map((persona) => {
                            console.log(`[🎨 RENDER] Rendering perspective button: ${persona.name} for message ${message.id}`);
                            
                            // Check if already replied
                            const hasReplied = perspectiveReplies[message.id]?.some(r => r.persona === persona.name);
                            
                            return (
                            <Button
                              key={persona.name}
                              variant={hasReplied ? "default" : "outline"}
                              size="sm"
                              onClick={() => {
                                // Always update current perspective for visual feedback
                                setCurrentPerspective(prev => ({
                                  ...prev,
                                  [message.id!]: persona
                                }));
                                
                                // 🎬 시나리오 작가 모드: dialogue 즉시 표시 (API 재호출 없음)
                                if (!hasReplied && persona.dialogue) {
                                  console.log(`[💬 INSTANT REPLY] Showing pre-generated dialogue for ${persona.name}`);
                                  
                                  setPerspectiveReplies(prev => ({
                                    ...prev,
                                    [message.id!]: [
                                      ...(prev[message.id!] || []),
                                      {
                                        persona: persona.name,
                                        role: persona.role,
                                        reply: persona.dialogue || '',
                                        color: persona.color
                                      }
                                    ]
                                  }));
                                }
                              }}
                              disabled={hasReplied}
                              className="text-xs h-auto py-2 px-3 min-h-[44px]"
                              style={{
                                borderColor: hasReplied ? persona.color : undefined,
                                backgroundColor: hasReplied ? `${persona.color}20` : undefined,
                              }}
                              data-testid={`perspective-${message.id}-${persona.name}`}
                            >
                              <span 
                                className="inline-block w-2 h-2 rounded-full mr-2"
                                style={{ backgroundColor: persona.color }}
                              />
                              {persona.name} ({persona.role})
                            </Button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {!isUser && message.id && perspectiveReplies[message.id] && perspectiveReplies[message.id].length > 0 && (
                      <div className="mt-4 space-y-3 w-full">
                        {perspectiveReplies[message.id].map((reply, idx) => (
                          <div 
                            key={`${reply.persona}-${idx}`} 
                            className="flex items-start gap-3 w-full"
                          >
                            <div className="flex-shrink-0 text-2xl mt-1">↳</div>
                            <div 
                              className="flex-1 min-w-0 p-4 rounded-xl shadow-sm border"
                              style={{ 
                                backgroundColor: getColorWithOpacity(reply.color, 0.03),
                                borderColor: getColorWithOpacity(reply.color, 0.3)
                              }}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <span 
                                  className="inline-block w-2.5 h-2.5 rounded-full"
                                  style={{ backgroundColor: reply.color }}
                                />
                                <span className="font-bold text-sm text-gray-700 dark:text-gray-300">
                                  {reply.persona}의 반박
                                </span>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  ({reply.role})
                                </span>
                              </div>
                              <p className="text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap break-words">
                                {reply.reply}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {isUser && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1 text-center">
                        {formatMessageTime(message.createdAt)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {isWaitingForResponse && (
              <div className="flex justify-start">
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-750 rounded-2xl px-5 py-4 shadow-sm border border-blue-100 dark:border-gray-700">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      <span className="font-medium text-blue-600 dark:text-blue-400">{loadingMessage}</span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        (관련 법안 및 책임자 검색 중)
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
          </div>
        )}
      </div>

      {/* 3. 하단 영역 (질문 입력 및 흥미 유발) */}
      <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <div className="max-w-3xl mx-auto space-y-3">
          {/* 🎭 Step 46: Interactive Speaker Chips - 토론 참여자 + 추천 인물 (질문 후에만 표시) */}
          {displayedMessages.length > 0 && speakerChips.length > 0 && !isWaitingForResponse && (
            <div className="space-y-2">
              <p className="text-xs text-center text-gray-500 dark:text-gray-400">
                다른 관점을 듣고 싶으신가요? 아래 인물을 클릭하세요
              </p>
              {/* 가로 스크롤 가능한 한 행 - 좌우 드래그 */}
              <div className="relative -mx-4 overflow-hidden">
                <div 
                  ref={speakerChipsRef}
                  className="overflow-x-auto scrollbar-hide px-4 pt-2 pb-2 touch-pan-x"
                  style={{ 
                    WebkitOverflowScrolling: 'touch',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none'
                  }}
                  onMouseDown={handleSpeakerChipsMouseDown}
                  onMouseMove={handleSpeakerChipsMouseMove}
                  onMouseUp={handleSpeakerChipsMouseUp}
                  onMouseLeave={handleSpeakerChipsMouseLeave}
                >
                  <div className="flex gap-3 min-w-max pr-4">
                    {speakerChips.map((speaker, idx) => {
                      const isExpanding = expandingSpeaker === speaker.name;
                      const stanceColors: Record<string, { bg: string; border: string; text: string }> = {
                        'support': { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-700', text: 'text-blue-700 dark:text-blue-300' },
                        'oppose': { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-700', text: 'text-red-700 dark:text-red-300' },
                        'neutral': { bg: 'bg-gray-50 dark:bg-gray-800', border: 'border-gray-200 dark:border-gray-600', text: 'text-gray-700 dark:text-gray-300' },
                        'authority': { bg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-700', text: 'text-purple-700 dark:text-purple-300' }
                      };
                      const colors = stanceColors[speaker.stance] || stanceColors['neutral'];
                      
                      return (
                        <button
                          key={`speaker-${idx}-${speaker.name}`}
                          onClick={(e) => {
                            // 드래그 중이면 클릭 무시
                            if (dragStateRef.current.hasDragged) {
                              e.preventDefault();
                              e.stopPropagation();
                              return;
                            }
                            handleSpeakerChipClick(speaker);
                          }}
                          disabled={expandSpeakerMutation.isPending}
                          className={`
                            flex-shrink-0 flex flex-col items-center px-4 py-2 rounded-xl text-sm
                            border transition-all duration-200 min-w-[90px]
                            ${colors.bg} ${colors.border}
                            ${speaker.isExisting 
                              ? 'ring-2 ring-offset-1 ring-opacity-50 ring-current' 
                              : 'opacity-80 hover:opacity-100'}
                            hover:shadow-md active:scale-95
                            disabled:opacity-50 disabled:cursor-not-allowed
                          `}
                          data-testid={`speaker-chip-${idx}`}
                          title={speaker.reason}
                        >
                          {isExpanding ? (
                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <>
                              {/* 이름 (위) */}
                              <span className={`font-medium ${colors.text} flex items-center gap-1 whitespace-nowrap`}>
                                {speaker.speaker_icon}
                                <span>{speaker.name}</span>
                                {speaker.isExisting && <span className="text-xs opacity-70">✓</span>}
                              </span>
                              {/* 직책 (아래) */}
                              {speaker.title && (
                                <span className="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                  {speaker.title}
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Perspectives - 질문 후 & 응답 완료 후에만 표시 */}
          {displayedMessages.length > 0 && !isWaitingForResponse && randomExamples.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center">
              {randomExamples.map((example: any) => {
                // Perspective 버튼인지 확인
                const isPerspective = 'persona' in example && example.persona;
                
                return (
                  <button
                    key={example.id}
                    onClick={() => {
                      if (isPerspective && lastMessage?.id) {
                        // Perspective 클릭: dialogue 표시
                        const persona = example.persona;
                        const hasReplied = perspectiveReplies[lastMessage.id]?.some(
                          r => r.persona === persona.name
                        );
                        
                        if (!hasReplied && persona.dialogue) {
                          console.log(`[💬 BOTTOM CLICK] Showing dialogue for ${persona.name}`);
                          
                          setPerspectiveReplies(prev => ({
                            ...prev,
                            [lastMessage.id!]: [
                              ...(prev[lastMessage.id!] || []),
                              {
                                persona: persona.name,
                                role: persona.role,
                                reply: persona.dialogue || '',
                                color: persona.color
                              }
                            ]
                          }));
                        }
                      } else {
                        // Trending Topic 클릭: 기존 핸들러
                        handleQuestionExampleClick(example);
                      }
                    }}
                    className="px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    data-testid={`question-example-${example.id}`}
                  >
                    {example.iconEmoji && <span className="mr-1">{example.iconEmoji}</span>}
                    {example.title}
                  </button>
                );
              })}
            </div>
          )}

          {/* 질문 입력창 - 강조된 스타일 */}
          <form onSubmit={handleSubmit} className="flex gap-3 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-750 rounded-xl border-2 border-blue-200 dark:border-blue-800 shadow-lg">
            <Input
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder="무엇이 궁금하신가요? 질문을 입력하세요..."
              className="flex-1 h-12 text-base bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800"
              disabled={sendMessageMutation.isPending || isWaitingForResponse || disambiguateMutation.isPending || confirmCharacterMutation.isPending}
              data-testid="input-message"
              aria-label="질문 입력"
            />
            <Button
              type="submit"
              disabled={!messageInput.trim() || sendMessageMutation.isPending || isWaitingForResponse || disambiguateMutation.isPending || confirmCharacterMutation.isPending}
              className="h-12 px-6 bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-md hover:shadow-lg transition-all"
              data-testid="button-send"
              aria-label="전송"
            >
              {(disambiguateMutation.isPending || confirmCharacterMutation.isPending) ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
          </form>
        </div>
      </div>

      {/* 4. 고지 및 신뢰 확보 문구 (Footer) */}
      <div className="flex-shrink-0 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 py-3">
        <p className="text-xs text-center text-gray-600 dark:text-gray-400 max-w-4xl mx-auto">
          VERDICT는 방대한 데이터를 기반으로 당사자의 관점과 입장을 최적으로 재현하기 위해 노력했습니다. 
          다만, 이 관점은 AI에 의해 생성되었으며, 실제 당사자의 현재 의견이나 공식적인 입장을 100% 대변하지 않을 수 있습니다. 
          이 관점을 다양한 입장을 이해하는 도구로 활용해 주십시오.
        </p>
      </div>

      {/* 관점 관리 모달 */}
      <Dialog open={showManageModal} onOpenChange={setShowManageModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>관점 관리</DialogTitle>
          </DialogHeader>
          
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "your-views" | "create-view")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="your-views" data-testid="tab-your-views">Your Views</TabsTrigger>
              <TabsTrigger value="create-view" data-testid="tab-create-view">Create View</TabsTrigger>
            </TabsList>
            
            <TabsContent value="your-views" className="space-y-4 mt-4">
              {agents.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <p>아직 생성된 관점이 없습니다.</p>
                  <p className="text-sm mt-2">Create View 탭에서 새로운 관점을 만들어보세요.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => handleSelectAgent(agent.id)}
                      className={`p-4 rounded-lg border transition-all ${
                        selectedAgentId === agent.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                      data-testid={`agent-card-${agent.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0"
                          style={{ backgroundColor: agent.backgroundColor }}
                        >
                          <span>{agent.icon || '🤖'}</span>
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-gray-900 dark:text-white truncate">
                              {agent.name}
                            </h3>
                            {selectedAgentId === agent.id && (
                              <Check className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                            )}
                          </div>
                          {agent.description && (
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                              {agent.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="create-view" className="space-y-4 mt-4">
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                    인물 이름 입력
                  </label>
                  <Input
                    value={createViewInput}
                    onChange={(e) => setCreateViewInput(e.target.value)}
                    placeholder="예: 이재명, 트럼프, 아인슈타인"
                    data-testid="input-create-view"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateView();
                      }
                    }}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    역사적 인물, 정치인, 과학자 등 다양한 인물의 관점을 생성할 수 있습니다.
                  </p>
                </div>
                
                <Button
                  onClick={handleCreateView}
                  disabled={!createViewInput.trim() || disambiguateMutation.isPending || confirmCharacterMutation.isPending}
                  className="w-full"
                  data-testid="button-create-view"
                >
                  {(disambiguateMutation.isPending || confirmCharacterMutation.isPending) ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      생성 중...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      관점 생성
                    </>
                  )}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* 🆕 후보 선택 다이얼로그 */}
      <Dialog open={showCandidatesDialog} onOpenChange={setShowCandidatesDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>인물 선택</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {candidatesList.length}명의 인물을 찾았습니다. 원하는 인물을 선택하세요:
            </p>
            {candidatesList.map((candidate, idx) => (
              <Card
                key={idx}
                className="cursor-pointer hover:border-blue-500 transition-all"
                onClick={() => {
                  setShowCandidatesDialog(false);
                  confirmCharacterMutation.mutate(candidate);
                }}
                data-testid={`card-candidate-${idx}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg text-gray-900 dark:text-white">
                        {candidate.fullName}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {candidate.primaryDescriptor}
                      </p>
                    </div>
                    <Badge variant="secondary" className="ml-2">
                      인지도 {candidate.notability}/10
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {/* 안내 메시지 */}
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-900 dark:text-blue-100">
                💡 <span className="font-semibold">다른 동명이인을 찾으시나요?</span>
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                직업, 소속, 활동 시기 등 추가 정보를 입력하면 더 정확한 결과를 얻을 수 있습니다.
              </p>
            </div>
            
            {/* 버튼 */}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCandidatesDialog(false);
                  pendingQuestionRef.current = null;
                }}
                data-testid="button-cancel-selection"
              >
                취소
              </Button>
              <Button
                variant="default"
                onClick={() => {
                  setShowCandidatesDialog(false);
                  setShowManageModal(true);
                  setActiveTab("create-view");
                  setShowDetailedSearch(true);
                  
                  // 캐릭터 이름 자동 입력: pendingQuestion 또는 candidatesList에서 가져오기
                  const characterName = pendingQuestionRef.current?.characterName 
                    || candidatesList[0]?.fullName 
                    || '';
                  setCreateViewInput(characterName);
                }}
                data-testid="button-detailed-search"
              >
                🔍 다른 동명이인 검색
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
