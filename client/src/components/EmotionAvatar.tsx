import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";

// 16가지 감정 타입
export type AvatarEmotionType = 
  | 'neutral' | 'happy' | 'sad' | 'angry' 
  | 'determined' | 'worried' | 'thinking' | 'questioning'
  | 'listening' | 'surprised' | 'shocked' | 'embarrassed'
  | 'flustered' | 'confident' | 'arrogant' | 'tired';

// 모든 16 감정 목록
export const ALL_EMOTIONS: AvatarEmotionType[] = [
  'neutral', 'happy', 'sad', 'angry',
  'determined', 'worried', 'thinking', 'questioning',
  'listening', 'surprised', 'shocked', 'embarrassed',
  'flustered', 'confident', 'arrogant', 'tired'
];

interface CharacterAvatarResponse {
  characterId: string;
  characterName: string;
  avatars: Record<AvatarEmotionType, string | null>;
}

interface AvatarsApiResponse {
  success: boolean;
  avatars: CharacterAvatarResponse[];
}

interface EmotionAvatarProps {
  agentId?: number;
  groupChatId?: number;
  characterId?: string;
  characterName?: string;
  emotion?: AvatarEmotionType | string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  fallbackIcon?: string;
  autoGenerate?: boolean;
}

// 16감정 이모지 매핑
const EMOTION_INITIALS_MAP: Record<AvatarEmotionType, string> = {
  neutral: '😐',
  happy: '😊',
  sad: '😢',
  angry: '😠',
  determined: '😤',
  worried: '😟',
  thinking: '🤔',
  questioning: '🧐',
  listening: '👂',
  surprised: '😮',
  shocked: '😱',
  embarrassed: '😳',
  flustered: '😰',
  confident: '😏',
  arrogant: '😒',
  tired: '😴'
};

// 16감정 컬러 매핑
const EMOTION_COLOR_MAP: Record<AvatarEmotionType, string> = {
  neutral: 'bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-600',
  happy: 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700',
  sad: 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700',
  angry: 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700',
  determined: 'bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700',
  worried: 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700',
  thinking: 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700',
  questioning: 'bg-cyan-100 dark:bg-cyan-900/30 border-cyan-300 dark:border-cyan-700',
  listening: 'bg-teal-100 dark:bg-teal-900/30 border-teal-300 dark:border-teal-700',
  surprised: 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700',
  shocked: 'bg-rose-100 dark:bg-rose-900/30 border-rose-300 dark:border-rose-700',
  embarrassed: 'bg-pink-100 dark:bg-pink-900/30 border-pink-300 dark:border-pink-700',
  flustered: 'bg-fuchsia-100 dark:bg-fuchsia-900/30 border-fuchsia-300 dark:border-fuchsia-700',
  confident: 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700',
  arrogant: 'bg-slate-100 dark:bg-slate-800/50 border-slate-300 dark:border-slate-600',
  tired: 'bg-stone-100 dark:bg-stone-800/50 border-stone-300 dark:border-stone-600'
};

// 한글 → 영어 감정 매핑
const EMOTION_KO_EN_MAP: Record<string, AvatarEmotionType> = {
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

const SIZE_MAP = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-[100px] h-[100px] text-xl'  // 고정 100x100 프레임
};

function normalizeCharacterId(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// 감정 문자열을 AvatarEmotionType으로 변환
function normalizeEmotion(emotion: string | null | undefined): AvatarEmotionType {
  if (!emotion) return 'neutral';
  
  // 이미 영어 감정인 경우
  if (ALL_EMOTIONS.includes(emotion as AvatarEmotionType)) {
    return emotion as AvatarEmotionType;
  }
  
  // 한글 감정 → 영어로 변환
  const koEmotion = EMOTION_KO_EN_MAP[emotion];
  if (koEmotion) return koEmotion;
  
  // 부분 매칭 시도
  const lowerEmotion = emotion.toLowerCase();
  for (const [ko, en] of Object.entries(EMOTION_KO_EN_MAP)) {
    if (emotion.includes(ko) || lowerEmotion.includes(ko)) {
      return en;
    }
  }
  
  return 'neutral';
}

export function EmotionAvatar({ 
  agentId = 0,
  groupChatId,
  characterId, 
  characterName,
  emotion = 'neutral',
  size = 'sm',
  className = '',
  fallbackIcon,
  autoGenerate = false
}: EmotionAvatarProps) {
  const [imageError, setImageError] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationAttempted, setGenerationAttempted] = useState(false);
  const queryClient = useQueryClient();
  
  const normalizedEmotion = normalizeEmotion(emotion);
  const effectiveCharacterId = characterId || (characterName ? normalizeCharacterId(characterName) : undefined);
  
  const effectiveId = groupChatId || agentId;
  const isGroupChat = !!groupChatId;
  const isEnabled = effectiveId > 0;

  const queryUrl = isGroupChat 
    ? `/api/avatars/${effectiveId}?type=groupChat`
    : `/api/avatars/${effectiveId}`;

  const { data: response, isLoading } = useQuery<AvatarsApiResponse>({
    queryKey: ['/api/avatars', effectiveId, isGroupChat ? 'groupChat' : 'agent'],
    queryFn: async () => {
      console.log('[EmotionAvatar] Fetching avatars:', queryUrl);
      const res = await fetch(queryUrl);
      if (!res.ok) throw new Error('Failed to fetch avatars');
      const data = await res.json();
      console.log('[EmotionAvatar] Avatars response:', data);
      return data;
    },
    enabled: isEnabled,
    staleTime: 1000 * 30,
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasNoAvatars = !data?.avatars || data.avatars.length === 0;
      const hasNoMatchingAvatar = data?.avatars && characterName && 
        !data.avatars.some((a: CharacterAvatarResponse) => a.characterName === characterName);
      if (hasNoAvatars || hasNoMatchingAvatar) {
        console.log('[EmotionAvatar] Polling for avatars (none found yet)');
        return 3000;
      }
      return false;
    },
    retry: false
  });

  const avatarUrl = useMemo(() => {
    if (!response?.success || !response?.avatars) return null;
    
    const characterAvatar = response.avatars.find(a => {
      if (effectiveCharacterId && a.characterId === effectiveCharacterId) return true;
      if (characterName && a.characterName === characterName) return true;
      if (!effectiveCharacterId && !characterName) return true;
      return false;
    });
    
    if (!characterAvatar) return null;
    
    // 요청된 감정의 URL 찾기
    const emotionUrl = characterAvatar.avatars[normalizedEmotion];
    
    // 요청된 감정이 없으면 neutral 폴백
    if (!emotionUrl && normalizedEmotion !== 'neutral') {
      return characterAvatar.avatars['neutral'];
    }
    
    return emotionUrl;
  }, [response, effectiveCharacterId, characterName, normalizedEmotion]);

  useEffect(() => {
    if (autoGenerate && !avatarUrl && !generationAttempted && characterName && effectiveId > 0 && !isGenerating) {
      setIsGenerating(true);
      setGenerationAttempted(true);
      
      const requestBody = isGroupChat 
        ? { groupChatId: effectiveId, characterId: effectiveCharacterId, characterName }
        : { agentId: effectiveId, characterId: effectiveCharacterId, characterName };
      
      apiRequest('POST', '/api/avatars/generate-single', requestBody)
        .then(() => {
          queryClient.invalidateQueries({ 
            queryKey: ['/api/avatars', effectiveId, isGroupChat ? 'groupChat' : 'agent'] 
          });
        })
        .catch((error) => {
          console.error('[EmotionAvatar] Auto-generate failed:', error);
        })
        .finally(() => {
          setIsGenerating(false);
        });
    }
  }, [autoGenerate, avatarUrl, generationAttempted, characterName, effectiveId, effectiveCharacterId, isGenerating, isGroupChat, queryClient]);

  useEffect(() => {
    setImageError(false);
  }, [avatarUrl]);

  const sizeClass = SIZE_MAP[size];
  const emotionColorClass = EMOTION_COLOR_MAP[normalizedEmotion];
  
  const getCharacterInitial = useCallback((name?: string) => {
    if (!name) return '?';
    const cleanName = name.replace(/[^\w가-힣]/g, '').trim();
    if (!cleanName) return '?';
    const koreanMatch = cleanName.match(/[가-힣]/);
    if (koreanMatch) return koreanMatch[0];
    return cleanName.charAt(0).toUpperCase();
  }, []);

  if (avatarUrl && !imageError) {
    return (
      <div 
        className={`rounded-lg overflow-hidden border-2 flex-shrink-0 ${emotionColorClass} ${sizeClass} ${className}`}
        data-testid={`emotion-avatar-${normalizedEmotion}`}
      >
        <img 
          src={avatarUrl} 
          alt={`${characterName || 'Character'} - ${normalizedEmotion}`}
          className="w-full h-full object-cover"
          onError={() => setImageError(true)}
        />
      </div>
    );
  }

  if (isGenerating || isLoading) {
    return (
      <div 
        className={`rounded-lg border-2 flex items-center justify-center flex-shrink-0 animate-pulse bg-gradient-to-br from-purple-200 to-blue-200 dark:from-purple-800 dark:to-blue-800 ${sizeClass} ${className}`}
        data-testid={`emotion-avatar-generating`}
        title="아바타 생성 중..."
      >
        <span className="text-purple-600 dark:text-purple-300 font-bold">
          {getCharacterInitial(characterName)}
        </span>
      </div>
    );
  }

  if (fallbackIcon) {
    return (
      <div 
        className={`rounded-lg border-2 flex items-center justify-center flex-shrink-0 ${emotionColorClass} ${sizeClass} ${className}`}
        data-testid={`emotion-avatar-fallback-${normalizedEmotion}`}
        title={characterName || '캐릭터'}
      >
        <span>{fallbackIcon}</span>
      </div>
    );
  }

  return (
    <div 
      className={`rounded-lg border-2 flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-indigo-100 to-purple-100 dark:from-indigo-800 dark:to-purple-800 border-indigo-300 dark:border-indigo-600 ${sizeClass} ${className}`}
      data-testid={`emotion-avatar-initial-${normalizedEmotion}`}
      title={characterName || '캐릭터'}
    >
      <span className="text-indigo-600 dark:text-indigo-300 font-bold">
        {getCharacterInitial(characterName)}
      </span>
    </div>
  );
}

export function EmotionBadge({ 
  emotion = 'neutral',
  showLabel = true
}: { 
  emotion?: AvatarEmotionType | string | null;
  showLabel?: boolean;
}) {
  const normalizedEmotion = normalizeEmotion(emotion);

  const EMOTION_LABELS: Record<AvatarEmotionType, string> = {
    neutral: '기본',
    happy: '기쁨',
    sad: '슬픔',
    angry: '화남',
    determined: '단호',
    worried: '고민',
    thinking: '생각중',
    questioning: '물음',
    listening: '경청',
    surprised: '놀람',
    shocked: '충격',
    embarrassed: '부끄러움',
    flustered: '당황',
    confident: '자신감',
    arrogant: '거만',
    tired: '피곤'
  };

  const emoji = EMOTION_INITIALS_MAP[normalizedEmotion];
  const label = EMOTION_LABELS[normalizedEmotion];
  const colorClass = EMOTION_COLOR_MAP[normalizedEmotion];

  return (
    <span 
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${colorClass}`}
      data-testid={`emotion-badge-${normalizedEmotion}`}
    >
      <span>{emoji}</span>
      {showLabel && <span className="text-gray-700 dark:text-gray-300">{label}</span>}
    </span>
  );
}

export function extractCharacterNameFromMessage(content: string): string | null {
  const verdictPattern = /^\*\*[^\s\*]+\s+([\w가-힣\s()]+)\*\*/;
  
  const match = content.match(verdictPattern);
  if (match) {
    const name = match[1].trim();
    console.log('[EmotionAvatar] Character name extracted:', name);
    return name;
  }
  
  console.log('[EmotionAvatar] No character name found in:', content.substring(0, 50));
  return null;
}

export function mapEmotionalToneToEmotion(tone: string | null | undefined): AvatarEmotionType {
  return normalizeEmotion(tone);
}

// 감정 분석 함수 - 메시지 내용에서 감정 추출 (VERDICT 토론에 최적화)
export function analyzeEmotionFromContent(content: string): AvatarEmotionType {
  const lowerContent = content.toLowerCase();
  
  // 감정 키워드 - 우선순위순 (더 구체적인 것부터)
  const emotionPatterns: { emotion: AvatarEmotionType; keywords: string[]; weight: number }[] = [
    // 억울함, 강변 = flustered (당황) 또는 determined (단호)
    { emotion: 'flustered', keywords: ['억울', '누명', '모함', '무고', '오해', '아니', '아닙니다', '아니에요', '절대', '결코'], weight: 10 },
    { emotion: 'determined', keywords: ['단호', '분명히', '명백히', '확실히', '반드시', '절대로', '강력히', '단언', '주장', '해명'], weight: 9 },
    { emotion: 'angry', keywords: ['분노', '화가', '열받', '짜증', '빡', '격분', '기가 막혀', '어이없', '황당', '말도 안'], weight: 9 },
    { emotion: 'confident', keywords: ['자신있', '확신', '당연', '물론', '증거', '팩트', '사실', '진실', '명확', '증명'], weight: 8 },
    { emotion: 'questioning', keywords: ['왜', '어떻게', '무엇', '뭐가', '어디', '누가', '언제', '의문', '질문', '묻', '?'], weight: 7 },
    { emotion: 'worried', keywords: ['걱정', '고민', '불안', '염려', '우려', '심각', '문제', '위험', '위기'], weight: 6 },
    { emotion: 'shocked', keywords: ['충격', '경악', '믿을 수 없', '놀랍', '세상에', '어머나', '헐', '대박'], weight: 6 },
    { emotion: 'sad', keywords: ['슬픔', '우울', '아쉽', '안타깝', '눈물', '슬프', '유감', '가슴 아프'], weight: 5 },
    { emotion: 'embarrassed', keywords: ['부끄', '창피', '쑥스', '민망', '죄송', '미안', '송구'], weight: 5 },
    { emotion: 'arrogant', keywords: ['거만', '오만', '잘난', '뭘 알아', '모르면', '내가', '나는'], weight: 4 },
    { emotion: 'thinking', keywords: ['생각', '고려', '검토', '분석', '판단', '보면', '보자면'], weight: 3 },
    { emotion: 'happy', keywords: ['기쁨', '행복', '좋', '감사', '축하', '다행', '좋습니다', '환영'], weight: 3 },
    { emotion: 'surprised', keywords: ['놀라', '깜짝', '예상치 못', '의외'], weight: 3 },
    { emotion: 'tired', keywords: ['피곤', '지침', '힘들', '지겹'], weight: 2 },
    { emotion: 'listening', keywords: ['듣', '경청', '이해', '알겠', '네', '그렇군'], weight: 1 },
  ];
  
  let bestMatch: { emotion: AvatarEmotionType; score: number } = { emotion: 'neutral', score: 0 };
  
  for (const pattern of emotionPatterns) {
    let matchCount = 0;
    for (const keyword of pattern.keywords) {
      if (lowerContent.includes(keyword)) {
        matchCount++;
      }
    }
    
    if (matchCount > 0) {
      const score = matchCount * pattern.weight;
      if (score > bestMatch.score) {
        bestMatch = { emotion: pattern.emotion, score };
      }
    }
  }
  
  // 디버그 로그
  if (bestMatch.emotion !== 'neutral') {
    console.log(`[EmotionAvatar] 감정 분석: "${content.substring(0, 50)}..." → ${bestMatch.emotion} (score: ${bestMatch.score})`);
  }
  
  return bestMatch.emotion;
}
