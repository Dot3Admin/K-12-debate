/**
 * 📏 응답 길이 전략 선택 시스템
 * 
 * 대화 맥락을 분석하여 AI가 적절한 응답 길이를 결정하도록 돕습니다.
 * "짧게 끊어서 주고받기 vs 길게 설명하기"를 상황에 맞게 자동 판단.
 */

import type { ConversationContext } from './conversationContextAnalyzer';

export type ResponseLength = 
  | 'short'        // 1-2문장, ~100 토큰 (빠른 반응, 짧은 답변)
  | 'medium'       // 3-5문장, ~300 토큰 (일반 설명)
  | 'long';        // 여러 문단, ~600 토큰 (상세 설명, 처음 개념 소개)

// 중앙화된 토큰 상수
export const MAX_TOKENS = {
  short: 100,
  medium: 300,
  long: 600
} as const;

export interface LengthStrategy {
  length: ResponseLength;
  maxTokens: number;
  rationale: string;      // 왜 이 길이를 선택했는지
  guidance: string;       // AI에게 전달할 가이드라인
}

/**
 * 대화 맥락을 기반으로 응답 길이 전략 선택 (개선된 규칙)
 */
export function selectResponseLengthStrategy(context: ConversationContext): LengthStrategy {
  const { phase, currentSpeakerStreak, lastTurnType, topicComplexity, patternDiversity, recentTurnLengths } = context;
  
  // 전체 턴 수 추정 (recentTurnLengths는 최근 5턴)
  const totalTurns = recentTurnLengths.length;
  
  // === 규칙 1: 연속 발언 제어 (analyzer에서 이미 최근 5턴 기준으로 계산됨) ===
  if (currentSpeakerStreak >= 3) {
    console.log(`[📏 Length Strategy] Streak rule fired: ${currentSpeakerStreak} consecutive turns in recent window`);
    return {
      length: 'short',
      maxTokens: MAX_TOKENS.short,
      rationale: `연속 ${currentSpeakerStreak}턴 발언 - 상대에게 턴 넘기기`,
      guidance: '1-2문장으로 핵심만 전달하고, 질문이나 의견 요청으로 상대에게 턴을 넘기세요.'
    };
  }
  
  // === 규칙 2: 질문 응답 (초기 onboarding 예외 처리) ===
  if (lastTurnType === 'question') {
    // 초기 2턴 내 복잡한 질문 → 충분히 설명
    if (totalTurns <= 2 && topicComplexity === 'complex') {
      return {
        length: 'long',
        maxTokens: MAX_TOKENS.long,
        rationale: '처음 받은 복잡한 질문 - 충분한 설명 필요',
        guidance: '처음 소개하는 내용이므로 충분히 상세하게 설명하세요.'
      };
    }
    
    // 복잡한 주제의 일반 질문 → 중간 길이
    if (topicComplexity === 'complex') {
      return {
        length: 'medium',
        maxTokens: MAX_TOKENS.medium,
        rationale: '복잡한 주제의 질문 - 적절한 설명 필요',
        guidance: '질문에 답하되, 핵심 개념만 간략히 설명하세요. 너무 길지 않게.'
      };
    }
    
    // 단순 질문 → 짧게
    return {
      length: 'short',
      maxTokens: MAX_TOKENS.short,
      rationale: '질문에 대한 즉답',
      guidance: '1-2문장으로 질문에 직접 답변하세요. 간결하게.'
    };
  }
  
  // === 규칙 3: Phase별 전략 ===
  switch (phase) {
    case 'initial_explanation':
      // 처음 설명은 충분히 상세하게
      return {
        length: 'long',
        maxTokens: MAX_TOKENS.long,
        rationale: '처음 개념 설명 - 상세한 소개 필요',
        guidance: '처음 소개하는 내용이므로 충분히 상세하게 설명하세요. 여러 문단 사용 가능.'
      };
    
    case 'debate':
      // 복잡한 주제의 논쟁 → 길게 논증
      if (topicComplexity === 'complex' && lastTurnType === 'challenge') {
        return {
          length: 'long',
          maxTokens: MAX_TOKENS.long,
          rationale: '복잡한 논쟁 반박 - 상세한 논거 필요',
          guidance: '복잡한 논점이므로 충분한 근거와 예시로 반박하세요.'
        };
      }
      
      // 일반 토론 → 중간 길이
      if (lastTurnType === 'challenge') {
        return {
          length: 'medium',
          maxTokens: MAX_TOKENS.medium,
          rationale: '반박에 대한 응수 - 논거 필요',
          guidance: '상대 논점에 반응하고 간단한 근거를 제시하세요.'
        };
      }
      
      return {
        length: 'medium',
        maxTokens: MAX_TOKENS.medium,
        rationale: '토론 중 - 적절한 논증',
        guidance: '논점을 명확히 하되, 간결하게 유지하세요.'
      };
    
    case 'consensus':
      // 합의 도달은 짧게 (동의 + 마무리)
      return {
        length: 'short',
        maxTokens: MAX_TOKENS.short,
        rationale: '합의 도달 - 간단한 동의/마무리',
        guidance: '동의를 표하고 간단히 보충하세요. 짧게 마무리.'
      };
    
    case 'q_and_a':
      // Q&A는 중간 길이
      return {
        length: 'medium',
        maxTokens: MAX_TOKENS.medium,
        rationale: 'Q&A 교환 - 적절한 설명',
        guidance: '질문에 답하거나 질문을 던지세요. 중간 길이로.'
      };
    
    case 'exploration':
    default:
      // 탐구/일반 대화는 패턴 다양성 고려
      break;
  }
  
  // === 규칙 4: 패턴 다양성 기반 조정 ===
  if (patternDiversity < 0.3) {
    // 패턴이 단조로우면 짧게 끊어서 변화 주기
    return {
      length: 'short',
      maxTokens: MAX_TOKENS.short,
      rationale: '패턴 단조로움 - 새로운 각도 제시',
      guidance: '짧게 반응하되 새로운 관점이나 질문으로 대화에 변화를 주세요.'
    };
  }
  
  // === 규칙 5: 주제 복잡도 기반 기본값 ===
  switch (topicComplexity) {
    case 'simple':
      return {
        length: 'short',
        maxTokens: MAX_TOKENS.short,
        rationale: '단순한 주제 - 간결한 답변',
        guidance: '간단한 주제이므로 1-2문장으로 충분합니다.'
      };
    
    case 'complex':
      return {
        length: 'medium',
        maxTokens: MAX_TOKENS.medium,
        rationale: '복잡한 주제 - 적절한 설명',
        guidance: '복잡한 주제이므로 충분히 설명하되, 핵심만 전달하세요.'
      };
    
    case 'moderate':
    default:
      return {
        length: 'medium',
        maxTokens: MAX_TOKENS.medium,
        rationale: '일반 대화 - 중간 길이',
        guidance: '자연스럽게 대화하세요. 3-5문장 정도가 적절합니다.'
      };
  }
}

/**
 * 길이 전략을 AI 프롬프트 문자열로 변환
 */
export function formatLengthGuidance(strategy: LengthStrategy): string {
  const lengthDescriptions = {
    short: '매우 짧게 (1-2문장)',
    medium: '적당한 길이 (3-5문장)',
    long: '충분히 상세하게 (여러 문단 가능)'
  };
  
  return `
**응답 길이 가이드라인:**
- 권장 길이: ${lengthDescriptions[strategy.length]}
- 최대 토큰: ${strategy.maxTokens}
- 이유: ${strategy.rationale}
- 지침: ${strategy.guidance}
`;
}

/**
 * 디버깅용: 전략 선택 이유를 자세히 로깅
 */
export function logStrategyDecision(
  context: ConversationContext,
  strategy: LengthStrategy
): void {
  console.log(`
[📏 응답 길이 전략]
  Phase: ${context.phase}
  Last Turn: ${context.lastTurnType}
  Speaker Streak: ${context.currentSpeakerStreak}
  Topic Complexity: ${context.topicComplexity}
  Pattern Diversity: ${context.patternDiversity.toFixed(2)}
  
  → 선택된 길이: ${strategy.length.toUpperCase()}
  → Max Tokens: ${strategy.maxTokens}
  → 이유: ${strategy.rationale}
`);
}
