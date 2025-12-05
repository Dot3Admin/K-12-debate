// 챗봇 간 상호작용 시스템 - 자연스러운 대화 참여

export interface BotReactionContext {
  originalMessage: string;
  previousBotResponses: Array<{
    agentId: string;
    agentName: string;
    content: string;
    timestamp: Date;
  }>;
  currentAgent: {
    id: string;
    name: string;
    personality: string;
    speechStyle: string;
  };
}

// 봇 반응 확률 계산 (30% 기본)
export function shouldBotReact(context: BotReactionContext, isAtMention: boolean = false): boolean {
  let baseProbability = 0.3; // 30% 기본 확률
  
  // 인사말 키워드 감지
  const greetingKeywords = [
    '안녕하세요', '안녕', '반가워요', '안녕하신가요', '어떻게 지내세요', 
    '하이', '헬로', '좋은 아침', '좋은 저녁', '반갑습니다', '반가워', 
    '안녕하세용', '하이요', '안뇽', '헬로우', '좋은 밤', '좋은 하루', 
    '안녕히 계세요', '안녕히 가세요'
  ];
  
  const isGreeting = greetingKeywords.some(keyword => 
    context.originalMessage.toLowerCase().includes(keyword.toLowerCase())
  );
  
  // @질문이면서 인사말인 경우, 모든 봇이 응답하도록 함
  if (isAtMention && isGreeting) {
    return true; // 인사말은 모든 봇이 응답
  }
  
  // @질문의 경우 모든 봇이 반드시 응답하므로 확률 조정 불필요
  if (isAtMention) {
    return Math.random() < baseProbability; // 단순히 30% 확률로 추가 반응 결정
  }
  
  // 조건별 확률 조정
  const recentResponses = context.previousBotResponses.slice(-4); // 최근 4개 응답까지 고려 (토론 깊이 확장)
  
  // 이미 너무 많은 봇이 응답했으면 확률 조정 (완전히 차단하지 않음)
  if (recentResponses.length >= 4) {
    baseProbability *= 0.6; // 약간 감소하되 토론 가능성 유지
  }
  
  // 같은 봇이 최근에 응답했는지 확인 - 강화된 중복 방지
  const recentSameBot = recentResponses.some(response => 
    response.agentId === context.currentAgent.id
  );
  
  // 가장 최근 응답자가 같은 봇인지 확인 (연속 응답 방지)
  const lastResponseSameBot = recentResponses.length > 0 && 
    recentResponses[recentResponses.length - 1].agentId === context.currentAgent.id;
  
  // 강화된 반박/의견차이 키워드 감지
  const strongDisagreementKeywords = [
    '하지만', '그러나', '반대로', '다른 의견', '틀렸', '잘못', '아니', '그게 아니', 
    '반박', '다르게 생각', '의문', '논란', '논쟁', '문제', '비판', '반대', '이견',
    '오해', '착각', '부정확', '사실이 아니', '동의하지 않', '의견이 다르', '반대 의견'
  ];
  
  const hasStrongDisagreement = recentResponses.some(response =>
    strongDisagreementKeywords.some(keyword => response.content.includes(keyword))
  );
  
  // 연속 응답 방지 (가장 최근 응답자가 같은 봇인 경우 거의 차단)
  if (lastResponseSameBot) {
    // 매우 강한 의견 차이가 있어야만 예외적으로 허용
    if (hasStrongDisagreement && Math.random() < 0.1) { // 10% 예외 확률
      baseProbability *= 0.15; // 매우 낮은 확률로만 허용
    } else {
      return false; // 연속 응답 완전 차단
    }
  }
  
  // 의견 차이가 있을 때는 같은 봇의 재응답도 허용 (하지만 연속은 아님)
  if (hasStrongDisagreement) {
    baseProbability *= 2.5; // 의견 차이가 있으면 확률 대폭 증가
    if (recentSameBot && !lastResponseSameBot) {
      baseProbability *= 0.5; // 최근 응답했지만 연속은 아닌 경우 50% 확률
    }
  } else if (recentSameBot) {
    baseProbability *= 0.2; // 일반적인 경우 같은 봇 확률 더욱 감소
  }
  
  // 중간 정도의 반박이나 의견 제시 키워드
  const moderateDisagreementKeywords = [
    '음', '글쎄', '조금 다르게', '개인적으로는', '제 생각에는', '아무래도',
    '사실은', '실제로는', '좀 더 정확히', '보완하면', '추가로 말하면'
  ];
  
  const hasModerateDisagreement = recentResponses.some(response =>
    moderateDisagreementKeywords.some(keyword => response.content.includes(keyword))
  );
  
  if (hasModerateDisagreement) {
    baseProbability *= 1.6; // 중간 수준 의견 차이에도 확률 증가
  }
  
  // 질문이 있으면 확률 증가
  const hasQuestion = recentResponses.some(response =>
    response.content.includes('?') || response.content.includes('？') ||
    response.content.includes('어떻게') || response.content.includes('왜') ||
    response.content.includes('언제') || response.content.includes('무엇')
  );
  
  if (hasQuestion) {
    baseProbability *= 1.7; // 질문이 있으면 확률 증가
  }
  
  // 최종 확률로 랜덤 결정 (토론 활성화를 위해 최대값 증가)
  return Math.random() < Math.min(baseProbability, 0.85); // 최대 85%로 상향 조정
}

// 반응 타입 결정
export function determineReactionType(context: BotReactionContext): 'agree' | 'disagree' | 'add_info' | 'ask_question' {
  const recentResponses = context.previousBotResponses.slice(-3); // 더 많은 응답 고려
  const combinedText = recentResponses.map(r => r.content).join(' ');
  
  // 강화된 반박 키워드 체크
  const strongDisagreementKeywords = [
    '하지만', '그러나', '틀렸', '잘못', '아니', '반대', '다른 의견', '반박',
    '논란', '논쟁', '문제', '비판', '이견', '오해', '착각', '부정확', 
    '사실이 아니', '동의하지 않', '의견이 다르', '반대 의견', '그게 아니'
  ];
  const hasStrongDisagreement = strongDisagreementKeywords.some(keyword => combinedText.includes(keyword));
  
  // 중간 정도 의견 차이 키워드
  const moderateDisagreementKeywords = [
    '음', '글쎄', '조금 다르게', '개인적으로는', '제 생각에는', '아무래도',
    '사실은', '실제로는', '좀 더 정확히', '다른 관점', '별개로'
  ];
  const hasModerateDisagreement = moderateDisagreementKeywords.some(keyword => combinedText.includes(keyword));
  
  // 불완전한 정보 키워드 체크
  const incompleteKeywords = ['더 있다', '추가로', '또한', '빠진', '보완', '덧붙이면', '참고로'];
  const hasIncompleteInfo = incompleteKeywords.some(keyword => combinedText.includes(keyword));
  
  // 의문 키워드 체크 (확장)
  const questionKeywords = ['?', '？', '궁금', '어떻게', '왜', '언제', '무엇', '어디', '누구', '어떤'];
  const hasQuestions = questionKeywords.some(keyword => combinedText.includes(keyword));
  
  // 토론 활성화를 위한 확률적 반응 타입 결정
  const random = Math.random();
  
  // 강한 의견 차이가 있을 때 더 높은 확률로 반박
  if (hasStrongDisagreement && random < 0.7) { // 40% -> 70% 증가
    return 'disagree';
  } 
  
  // 중간 정도 의견 차이도 반박 기회 제공
  if (hasModerateDisagreement && random < 0.5) {
    return 'disagree';
  }
  
  // 질문이 있을 때도 더 높은 확률로 추가 질문
  if (hasQuestions && random < 0.7) { // 60% -> 70% 증가
    return 'ask_question';
  } 
  
  // 불완전한 정보에 대한 보완 확률 증가
  if (hasIncompleteInfo && random < 0.6) { // 50% -> 60% 증가
    return 'add_info';
  } 
  
  // 기본 반응: 토론 활성화를 위해 반박 확률 증가
  if (random < 0.35) { // 새로운 반박 기회 추가
    return 'disagree';
  } else if (random < 0.55) {
    return 'ask_question';
  } else if (random < 0.75) {
    return 'add_info';
  } else {
    return 'agree';
  }
}

// 반응 프롬프트 생성
export function generateReactionPrompt(
  context: BotReactionContext,
  reactionType: 'agree' | 'disagree' | 'add_info' | 'ask_question',
  isAtMention: boolean = false
): string {
  const { originalMessage, previousBotResponses, currentAgent } = context;
  
  const recentResponses = previousBotResponses.slice(-3);
  const responsesText = recentResponses.map(response => 
    `${response.agentName}: ${response.content}`
  ).join('\n\n');
  
  const baseContext = isAtMention 
    ? `@질문: "${originalMessage}"

다른 챗봇들의 응답:
${responsesText}

당신은 ${currentAgent.name}입니다. 위 @질문과 다른 챗봇들의 응답을 듣고 자연스럽게 참여하세요.`
    : `원래 질문: "${originalMessage}"

다른 챗봇들의 응답:
${responsesText}

당신은 ${currentAgent.name}입니다. 위 대화를 듣고 자연스럽게 참여하세요.`;

  const reactionPrompts = {
    agree: `${baseContext}

위 응답들에 동의하며 짧게 동조하거나 확인해주세요. 
- "맞아요", "정확합니다", "동감이에요" 등으로 시작
- 간단하게 1-2문장으로 동의 표현`,

    disagree: `${baseContext}

위 응답 중 일부에 다른 의견이 있거나 보완할 점이 있다면 적극적으로 자신의 관점을 제시해주세요.
- "음, 저는 조금 다르게 생각하는데요", "그런데 제가 보기에는", "다른 관점에서 보면" 등으로 시작
- 구체적인 근거나 다른 정보를 제시하며 건설적인 토론 유도
- 반박보다는 "추가 관점 제시"나 "보완적 의견" 형태로 자연스럽게 표현
- 필요하면 상대방 의견에 대해 궁금한 점도 물어보며 토론 지속`,

    add_info: `${baseContext}

위 응답들에 추가할 만한 정보나 보완할 내용이 있다면 자연스럽게 덧붙여주세요.
- "추가로 말씀드리면", "또 하나 중요한 점은" 등으로 시작
- 유용한 추가 정보나 팁 제공`,

    ask_question: `${baseContext}

위 응답들을 듣고 자연스럽게 관련 질문을 해주세요.
- "그런데 궁금한 게", "혹시" 등으로 시작
- 토론을 이어갈 수 있는 관련 질문`
  };

  return reactionPrompts[reactionType];
}

// 반응 메시지 길이 제한
export function limitReactionLength(message: string, maxLength: number = 150): string {
  // 매우 긴 응답만 제한 (500자 이상)
  if (message.length <= 500) {
    return message; // 대부분의 응답은 그대로 유지
  }
  
  // 문장 단위로 자연스럽게 자르기 (완전한 문장만 유지)
  const sentences = message.split(/(?<=[.!?])\s+/);
  let result = '';
  
  for (const sentence of sentences) {
    if ((result + sentence).length > maxLength * 1.5) { // 더 관대한 길이 제한
      break;
    }
    result += (result ? ' ' : '') + sentence;
  }
  
  // 완전한 문장이 없으면 원본 반환
  if (!result.trim() || result.length < 20) {
    return message;
  }
  
  // 문장 부호로 끝나지 않으면 적절히 마무리
  if (!result.match(/[.!?]$/)) {
    result = result.trim() + '.';
  }
  
  return result.trim();
}