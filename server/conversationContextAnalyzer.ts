/**
 * 🔍 대화 맥락 분석 시스템
 * 
 * 최근 대화 턴들을 분석하여 현재 대화 상황을 파악하고,
 * AI가 적절한 응답 전략을 선택할 수 있도록 돕습니다.
 */

export type ConversationPhase = 
  | 'initial_explanation'  // 처음 설명 중
  | 'debate'              // 논쟁/토론 중
  | 'q_and_a'             // 질문-답변 교환
  | 'consensus'           // 합의 도달 중
  | 'exploration';        // 함께 탐구 중

export type TurnType = 
  | 'question'            // 질문
  | 'statement'           // 진술/설명
  | 'challenge'           // 반박/도전
  | 'agreement';          // 동의/공감

export type TopicComplexity = 
  | 'simple'              // 단순 (1-2문장으로 답변 가능)
  | 'moderate'            // 보통 (몇 문단 필요)
  | 'complex';            // 복잡 (상세 설명 필요)

export interface ParsedTurn {
  speaker: string;
  content: string;
  length: number;          // 문자 수
  category: string;        // reaction category
  reaction: string;        // reaction type
  emotionalTone: string;
}

export interface ConversationContext {
  phase: ConversationPhase;
  recentTurnLengths: number[];
  currentSpeakerStreak: number;  // 현재 발언자가 연속으로 발언한 횟수
  lastTurnType: TurnType;
  topicComplexity: TopicComplexity;
  patternDiversity: number;      // 0-1, 1에 가까울수록 다양함
}

/**
 * 대화 히스토리 문자열을 파싱하여 개별 턴으로 분리
 * 
 * 안전한 파싱: embedded quotes/brackets 처리
 */
export function parseConversationHistory(conversationHistory: string): ParsedTurn[] {
  if (!conversationHistory || conversationHistory.trim() === '') {
    return [];
  }

  const turns: ParsedTurn[] = [];
  
  // 각 줄을 파싱: {speaker}: "{content}" [category/reaction/tone]
  const lines = conversationHistory.split('\n').filter(line => line.trim() !== '');
  
  for (const line of lines) {
    try {
      // Robust parsing: 역방향 검색으로 metadata bracket과 closing quote 찾기
      
      // 1. Speaker 추출 (첫 번째 ':' 전까지)
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      
      const speaker = line.substring(0, colonIndex).trim();
      const afterColon = line.substring(colonIndex + 1).trim();
      
      // 2. Opening quote 확인
      if (!afterColon.startsWith('"')) continue;
      
      // 3. Metadata bracket 찾기 (마지막 '[' 와 ']')
      const lastBracketStart = afterColon.lastIndexOf('[');
      const lastBracketEnd = afterColon.lastIndexOf(']');
      
      if (lastBracketStart !== -1 && lastBracketEnd !== -1 && lastBracketStart < lastBracketEnd) {
        // 메타데이터 있는 케이스
        
        // 4. Metadata 전의 마지막 closing quote 찾기
        const beforeMetadata = afterColon.substring(0, lastBracketStart);
        const lastQuoteIndex = beforeMetadata.lastIndexOf('"');
        
        if (lastQuoteIndex === -1 || lastQuoteIndex === 0) continue; // opening quote만 있음
        
        // 5. Content 추출 (opening quote ~ closing quote 사이)
        const content = afterColon.substring(1, lastQuoteIndex);
        
        // 6. Metadata 추출 및 파싱
        const metadata = afterColon.substring(lastBracketStart + 1, lastBracketEnd).trim();
        const parts = metadata.split('/').map(p => p.trim());
        
        turns.push({
          speaker,
          content,
          length: content.length,
          category: parts[0] || 'unknown',
          reaction: parts[1] || 'independent',
          emotionalTone: parts[2] || 'neutral'
        });
      } else {
        // 메타데이터 없는 케이스: Speaker: "Content"
        
        // Closing quote 찾기
        const lastQuoteIndex = afterColon.lastIndexOf('"');
        
        if (lastQuoteIndex === -1 || lastQuoteIndex === 0) continue;
        
        const content = afterColon.substring(1, lastQuoteIndex);
        
        turns.push({
          speaker,
          content,
          length: content.length,
          category: 'unknown',
          reaction: 'independent',
          emotionalTone: 'neutral'
        });
      }
    } catch (error) {
      // 파싱 실패 시 조용히 스킵
      console.warn(`[conversationContextAnalyzer] Failed to parse line: ${line.substring(0, 50)}...`);
    }
  }
  
  return turns;
}

/**
 * 연속 발언 횟수 계산 (최근 5턴 window로 제한)
 * 
 * 과거 streak이 아닌 최근 대화에서의 연속성을 측정하여
 * historical dominance를 방지합니다.
 */
export function calculateSpeakerStreak(turns: ParsedTurn[], currentSpeaker: string): number {
  if (turns.length === 0) return 0;
  
  // 최근 5턴만 고려 (현재 턴 제외)
  const recentWindow = turns.slice(-5);
  
  let streak = 0;
  // 뒤에서부터 세기
  for (let i = recentWindow.length - 1; i >= 0; i--) {
    if (recentWindow[i].speaker === currentSpeaker) {
      streak++;
    } else {
      break;
    }
  }
  
  return streak;
}

/**
 * 마지막 턴의 유형 감지 (언어 독립적)
 */
export function detectLastTurnType(turns: ParsedTurn[]): TurnType {
  if (turns.length === 0) return 'statement';
  
  const lastTurn = turns[turns.length - 1];
  const content = lastTurn.content.trim();
  
  // 1순위: Reaction metadata 활용 (가장 신뢰할 수 있음)
  const challengeReactions = ['refute', 'challenge', 'deflect'];
  if (challengeReactions.includes(lastTurn.reaction)) {
    return 'challenge';
  }
  
  const agreementReactions = ['affinity', 'complement', 'augment'];
  if (agreementReactions.includes(lastTurn.reaction)) {
    return 'agreement';
  }
  
  const questionReactions = ['explore_together'];
  if (questionReactions.includes(lastTurn.reaction)) {
    return 'question';
  }
  
  // 2순위: 구두점 및 언어 독립적 패턴
  if (content.endsWith('?') || content.includes('?')) {
    return 'question';
  }
  
  // 3순위: 한국어/영어 interrogatives
  const lowerContent = content.toLowerCase();
  const koreanInterrogatives = ['어떻', '무엇', '왜', '어떤', '언제', '어디', '누구'];
  const englishInterrogatives = ['what', 'why', 'how', 'when', 'where', 'who', 'which'];
  
  const hasInterrogative = 
    koreanInterrogatives.some(kw => lowerContent.includes(kw)) ||
    englishInterrogatives.some(kw => lowerContent.startsWith(kw + ' '));
  
  if (hasInterrogative) {
    return 'question';
  }
  
  return 'statement';
}

/**
 * 대화 단계(phase) 감지 (명확한 우선순위)
 * 
 * 우선순위:
 * 1. initial_explanation (첫 1-2턴)
 * 2. debate (반박 많음)
 * 3. consensus (동의 많음)
 * 4. q_and_a (질문-답변 교환)
 * 5. exploration (기본/탐구 패턴)
 */
export function detectConversationPhase(turns: ParsedTurn[]): ConversationPhase {
  // 0턴: 초기 상태
  if (turns.length === 0) return 'initial_explanation';
  
  // 1-2턴: 초기 설명 단계
  if (turns.length <= 2) return 'initial_explanation';
  
  // 최근 3턴 분석 (충분한 턴이 있는 경우만)
  const recentTurns = turns.slice(-3);
  
  // 토론 패턴: 반박이 2개 이상 (가장 강한 신호)
  const challengeCount = recentTurns.filter(t => 
    ['refute', 'challenge', 'deflect'].includes(t.reaction)
  ).length;
  if (challengeCount >= 2) return 'debate';
  
  // 합의 패턴: 동의가 2개 이상
  const agreementCount = recentTurns.filter(t => 
    ['affinity', 'complement', 'augment'].includes(t.reaction)
  ).length;
  if (agreementCount >= 2) return 'consensus';
  
  // Q&A 패턴: 질문 마크나 질문 reaction
  const questionCount = recentTurns.filter(t => 
    t.content.includes('?') || ['explore_together'].includes(t.reaction)
  ).length;
  if (questionCount >= 1) return 'q_and_a';
  
  // 기본: 탐구/일반 대화
  return 'exploration';
}

/**
 * 주제 복잡도 추정
 */
export function estimateTopicComplexity(
  topicContext: string,
  recentTurns: ParsedTurn[]
): TopicComplexity {
  // 평균 턴 길이로 복잡도 추정
  if (recentTurns.length > 0) {
    const avgLength = recentTurns.reduce((sum, t) => sum + t.length, 0) / recentTurns.length;
    
    if (avgLength < 100) return 'simple';
    if (avgLength > 300) return 'complex';
    return 'moderate';
  }
  
  // 주제 키워드로 추정
  const complexKeywords = ['구조', '시스템', '이론', '원리', '철학', '역사'];
  const simpleKeywords = ['무엇', '누구', '언제', '어디'];
  
  const hasComplexKeyword = complexKeywords.some(kw => topicContext.includes(kw));
  const hasSimpleKeyword = simpleKeywords.some(kw => topicContext.includes(kw));
  
  if (hasComplexKeyword) return 'complex';
  if (hasSimpleKeyword) return 'simple';
  
  return 'moderate';
}

/**
 * 패턴 다양성 계산 (최근 5턴 분석)
 * 
 * 정규화된 지표를 사용하여 0-1 범위로 반환
 */
export function calculatePatternDiversity(turns: ParsedTurn[]): number {
  if (turns.length < 2) return 1.0; // 턴이 적으면 다양성 높음으로 간주
  
  const recent = turns.slice(-5);
  
  // 1. 길이 변화율 (Coefficient of Variation 사용)
  const lengths = recent.map(t => t.length);
  const lengthCV = calculateCoefficientOfVariation(lengths);
  const lengthDiversity = Math.min(lengthCV / 0.5, 1); // CV 0.5 이상이면 최대
  
  // 2. 반응 타입 다양성
  const reactions = recent.map(t => t.reaction);
  const uniqueReactions = new Set(reactions).size;
  const reactionDiversity = uniqueReactions / reactions.length;
  
  // 3. 발언자 변화율
  const speakers = recent.map(t => t.speaker);
  const speakerChanges = speakers.reduce((count, speaker, i) => {
    if (i > 0 && speaker !== speakers[i - 1]) count++;
    return count;
  }, 0);
  const speakerDiversity = speakers.length > 1 ? speakerChanges / (speakers.length - 1) : 1;
  
  // 가중 평균 (모두 0-1 범위)
  const diversity = (
    lengthDiversity * 0.3 +
    reactionDiversity * 0.4 +
    speakerDiversity * 0.3
  );
  
  return Math.max(0, Math.min(1, diversity));
}

/**
 * 분산 계산 헬퍼
 */
function calculateVariance(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  const squaredDiffs = numbers.map(n => Math.pow(n - mean, 2));
  return squaredDiffs.reduce((sum, d) => sum + d, 0) / numbers.length;
}

/**
 * 변동 계수(Coefficient of Variation) 계산
 * CV = 표준편차 / 평균
 */
function calculateCoefficientOfVariation(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  
  const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  if (mean === 0) return 0; // 0으로 나누기 방지
  
  const variance = calculateVariance(numbers);
  const stdDev = Math.sqrt(variance);
  
  return stdDev / mean;
}

/**
 * 🎯 메인 분석 함수: 대화 맥락 전체 분석
 */
export function analyzeConversationContext(
  conversationHistory: string,
  topicContext: string,
  currentSpeaker: string
): ConversationContext {
  const turns = parseConversationHistory(conversationHistory);
  
  return {
    phase: detectConversationPhase(turns),
    recentTurnLengths: turns.slice(-5).map(t => t.length),
    currentSpeakerStreak: calculateSpeakerStreak(turns, currentSpeaker),
    lastTurnType: detectLastTurnType(turns),
    topicComplexity: estimateTopicComplexity(topicContext, turns.slice(-3)),
    patternDiversity: calculatePatternDiversity(turns)
  };
}
