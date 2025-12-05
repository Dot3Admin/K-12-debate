import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface Agent {
  id: number;
  name: string;
  description?: string | null;
  category?: string | null;
  upperCategory?: string | null;
  lowerCategory?: string | null;
  speechStyle?: string | null;
  personality?: string | null;
  knowledgeDomain?: string | null;
  type?: string | null;
  responseLanguage?: string | null;
}

export interface RouteAnalysis {
  selectedAgentId: number;
  reasoning: string;
  confidence: number;
  secondaryAgents: number[];
  specialization: 'specific' | 'none';
}

// 🎯 Phase 2: 멘션 컨텍스트 감지 함수들
function hasMentionContext(question: string): boolean {
  return question.includes('@') && question.match(/@[\w가-힣]+/) !== null;
}

function isSimpleGreeting(question: string): boolean {
  const greetings = ['안녕', '반가', '하이', '헬로', '안녕하세요', '반갑습니다'];
  return greetings.some(g => question.includes(g));
}

function extractMentionedAgentId(question: string, availableAgents: Agent[]): number | null {
  const mentionMatch = question.match(/@([\w가-힣]+)/);
  if (mentionMatch) {
    const mentionedName = mentionMatch[1];
    const agent = availableAgents.find(a => a.name.includes(mentionedName));
    return agent ? agent.id : null;
  }
  return null;
}

/**
 * @mention 질문을 분석하여 가장 적합한 전문 에이전트를 선택하는 라우터
 * 전문성 기반으로 주도권을 가질 에이전트를 결정합니다.
 */
export async function routeQuestion(
  question: string, 
  availableAgents: Agent[], 
  conversationContext: string = ''
): Promise<RouteAnalysis> {
  
  try {
    // 🎯 Phase 2: 멘션+인사 조합 우선 처리
    if (hasMentionContext(question) && isSimpleGreeting(question)) {
      const mentionedAgentId = extractMentionedAgentId(question, availableAgents);
      if (mentionedAgentId) {
        console.log(`[🎯 멘션+인사 감지] ${question} → 에이전트 ${mentionedAgentId} 단독 응답`);
        return {
          selectedAgentId: mentionedAgentId,
          reasoning: "멘션된 에이전트와의 1:1 인사로 라우팅",
          confidence: 95,
          secondaryAgents: [],
          specialization: "specific"
        };
      }
    }

    // 에이전트 프로필 요약 생성
    const agentProfiles = availableAgents.map(agent => ({
      id: agent.id,
      name: agent.name,
      expertise: `${agent.description || ''} ${agent.category || ''} ${agent.upperCategory || ''} ${agent.lowerCategory || ''}`.trim(),
      field: extractField(agent)
    }));

    const routingPrompt = `당신은 전문 챗봇 라우터입니다. 사용자의 @질문을 분석하여 가장 적합한 전문가를 선택하세요.

**사용자 질문:** "${question}"

**대화 맥락:** ${conversationContext}

**사용 가능한 전문가들:**
${agentProfiles.map((agent, index) => 
  `${index + 1}. ${agent.name} (ID: ${agent.id})
   - 전문분야: ${agent.field}
   - 설명: ${agent.expertise}`
).join('\n\n')}

**라우팅 규칙:**
1. **멘션+인사 조합** (@캐릭터명 안녕, @캐릭터명 반가워요 등): 특정 에이전트와의 1:1 인사이므로 해당 에이전트만 응답하도록 specialization: "specific" 반환
2. **일반 인사 질문** (멘션 없이 안녕하세요, 안녕, 반가워요, 안녕하신가요, 어떻게 지내세요, 하이, 헬로, 좋은 아침, 좋은 저녁, 반갑습니다 등): 전문성이 필요하지 않은 일반적 소통이므로 모든 에이전트가 개성있게 응답하도록 반드시 specialization: "none" 반환
3. **전공 선택/추천 질문** (전공을, 전공 선택, 어떤 전공, 전공 추천, 전공을 고르, 전공을 정하, 전공 선택하 등): 모든 전공 챗봇이 개인 경험을 바탕으로 응답해야 하므로 반드시 specialization: "none" 반환
4. **단순 @멘션** (@만 있고 구체적 질문 없는 경우): specialization: "none" 반환
5. 질문 내용과 가장 관련성이 높은 전문분야를 가진 에이전트를 선택
6. 공학계열 질문: MSE(재료공학), CSE(컴퓨터공학), EE(전자공학) 등 해당 분야 우선
7. 생명과학/의학 질문: 생명과학, 의학 관련 에이전트 우선
8. 심리학 질문 (심리학, 학습지, 심리적, 정신, 인지, 행동, 상담심리, 임상심리 등): 심리학 관련 에이전트를 최우선 선택
9. 학사행정 질문 (학사일정, 수강신청, 학점, 성적, 졸업, 등록, 휴학, 복학, 커리큘럼, 시간표, 학기 등): 학사행정 관련 에이전트를 최우선 선택
10. 진로/학과 상담: 학생 상담 경험이 있는 에이전트 우선

신뢰도는 다음 기준으로 산정:
- 90-100%: 명확한 전문분야 매칭
- 70-89%: 관련 분야 매칭
- 50-69%: 일반적 적합성
- 30-49%: 부분적 관련성

JSON 형식으로 응답하세요:
{
  "selectedAgentId": 숫자,
  "reasoning": "선택 이유 (한국어)",
  "confidence": 0-100 사이 숫자,
  "secondaryAgents": [부가적으로 의견을 제시할 수 있는 에이전트 ID들],
  "specialization": "specific" | "none"
}
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 🚀 경량 모델로 교체 - 라우팅 분류에 최적화 (4배 빠름)
      messages: [
        { role: 'system', content: routingPrompt },
        { role: 'user', content: question }
      ],
      response_format: { type: "json_object" },
      max_tokens: 300 // 🎯 500 → 300으로 감소 (라우팅 결과만 필요)
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    
    // 유효성 검증
    if (!result.selectedAgentId || !availableAgents.find(a => a.id === result.selectedAgentId)) {
      console.warn('[라우터] 유효하지 않은 에이전트 ID, 첫 번째 에이전트 사용');
      return {
        selectedAgentId: availableAgents[0].id,
        reasoning: '시스템 오류로 인한 기본 선택',
        confidence: 50,
        secondaryAgents: availableAgents.slice(1, 3).map(a => a.id),
        specialization: 'specific'
      };
    }

    return {
      selectedAgentId: result.selectedAgentId,
      reasoning: result.reasoning || '전문성 기반 선택',
      confidence: Math.min(100, Math.max(30, result.confidence || 70)),
      secondaryAgents: (result.secondaryAgents || []).filter((id: number) => 
        availableAgents.find(a => a.id === id) && id !== result.selectedAgentId
      ),
      specialization: result.specialization || 'specific'
    };

  } catch (error) {
    console.error('[라우터 오류]:', error);
    
    // 폴백: 키워드 기반 간단한 라우팅
    return fallbackRouting(question, availableAgents);
  }
}

/**
 * AI 라우터 실패 시 사용하는 폴백 라우팅 시스템
 */
function fallbackRouting(question: string, availableAgents: Agent[]): RouteAnalysis {
  const q = question.toLowerCase();
  
  // 🔥 인사말 감지 - 최우선 처리
  const greetingKeywords = ['안녕', '하이', '헬로', '반가', '좋은', '처음', '만나'];
  const hasGreeting = greetingKeywords.some(keyword => q.includes(keyword));
  const isShortMessage = question.trim().length < 15;
  const isSimpleAtMention = question.trim() === '@' || (question.startsWith('@') && question.length < 10);
  
  // 🔥 전공 선택 질문 감지 - 최우선 처리 (더 단순하고 확실한 감지)
  const majorSelectionKeywords = ['전공을', '전공 선택', '어떤 전공', '전공 추천', '전공을 고르', '전공을 정하', '전공 선택하', '전공이', '전공에'];
  const hasMajorSelection = majorSelectionKeywords.some(keyword => q.includes(keyword)) ||
    // "각자" 같은 키워드가 있으면 무조건 모든 챗봇 응답
    q.includes('각자') || q.includes('각각') || q.includes('모두') || q.includes('전체') || 
    q.includes('다들') || q.includes('여러분') ||
    // 전공 관련 질문 확장 감지
    (q.includes('전공') && (
      q.includes('비전') || q.includes('미래') || q.includes('전망') ||
      q.includes('어떻') || q.includes('생각') || q.includes('의견') ||
      q.includes('추천') || q.includes('조언') || q.includes('상담') ||
      q.includes('개별') || q.includes('경험') ||
      q.includes('선택') || q.includes('결정') || q.includes('고민') ||
      q.includes('장점') || q.includes('매력') || q.includes('특징') ||
      q.includes('입장') || q.includes('관점')
    ));
  
  console.log(`[라우터] 전공 선택 감지: ${hasMajorSelection}, 질문: "${question}"`);
  console.log(`[라우터] 키워드 감지 - 각자: ${q.includes('각자')}, 각각: ${q.includes('각각')}, 모두: ${q.includes('모두')}`);
  console.log(`[라우터] 키워드 감지 - 전체: ${q.includes('전체')}, 다들: ${q.includes('다들')}, 여러분: ${q.includes('여러분')}`);
  
  if (q.includes('전공')) {
    console.log(`[라우터] 전공 확장 감지 - 입장: ${q.includes('입장')}, 관점: ${q.includes('관점')}, 장점: ${q.includes('장점')}`);
    console.log(`[라우터] 전공 확장 감지 - 비전: ${q.includes('비전')}, 어떻: ${q.includes('어떻')}, 생각: ${q.includes('생각')}`);
  }
  
  if (hasGreeting || isShortMessage || isSimpleAtMention) {
    return {
      selectedAgentId: availableAgents[0].id,
      reasoning: '인사말 또는 간단한 소통 - 모든 에이전트 개성 응답',
      confidence: 95,
      secondaryAgents: availableAgents.slice(1, 3).map(a => a.id),
      specialization: 'none'
    };
  }
  
  if (hasMajorSelection) {
    return {
      selectedAgentId: availableAgents[0].id,
      reasoning: '전공 선택 상담 - 모든 전공 챗봇이 개인 경험으로 응답',
      confidence: 95,
      secondaryAgents: availableAgents.slice(1, 3).map(a => a.id),
      specialization: 'none'
    };
  }
  
  // 전공별 키워드 매칭
  const fieldKeywords = {
    computer: ['컴퓨터', '프로그래밍', '코딩', '소프트웨어', '알고리즘', 'ai', '인공지능', '개발'],
    materials: ['재료', '신소재', '금속', '세라믹', '폴리머', '나노', '소재'],
    electronics: ['전자', '회로', '반도체', '전기', '신호', '통신'],
    bio: ['생명', '생물', '의학', '바이오', '화학', '약학', '생체'],
    psychology: ['심리', '심리학', '학습지', '심리적', '정신', '인지', '행동', '상담심리', '임상심리'],
    academic: ['학사', '학사일정', '수강신청', '학점', '성적', '졸업', '등록', '휴학', '복학', '전과', '편입', '장학금', '학비', '커리큘럼', '교과과정', '시간표', '강의', '수업', '학기', '방학', '개강', '종강', '중간고사', '기말고사', '행정', '학사행정'],
    general: ['진로', '취업', '대학원', '학과', '전공선택', '상담']
  };
  
  let bestMatch = { agentId: availableAgents[0].id, score: 0, field: 'general' };
  
  for (const agent of availableAgents) {
    const agentField = extractField(agent).toLowerCase();
    let score = 0;
    
    // 각 필드별 키워드 점수 계산
    for (const [field, keywords] of Object.entries(fieldKeywords)) {
      const keywordMatches = keywords.filter(keyword => q.includes(keyword)).length;
      
      if (keywordMatches > 0) {
        if (agentField.includes(field) || 
            (field === 'computer' && agentField.includes('컴퓨터')) ||
            (field === 'materials' && agentField.includes('재료')) ||
            (field === 'electronics' && agentField.includes('전자')) ||
            (field === 'bio' && agentField.includes('생명')) ||
            (field === 'psychology' && agentField.includes('심리')) ||
            (field === 'academic' && (agentField.includes('학사') || agentField.includes('행정') || agentField.includes('교무')))) {
          // 학사행정 관련 에이전트는 추가 보너스
          if (field === 'academic' && (agentField.includes('학사') || agentField.includes('행정'))) {
            score += keywordMatches * 15; // 학사행정 특별 보너스
          } else {
            score += keywordMatches * 10; // 일반 전문분야 매칭 보너스
          }
        } else {
          score += keywordMatches * 2; // 일반적 관련성
        }
      }
    }
    
    // 학사행정 에이전트는 문서 보유 여부에 따른 추가 점수
    if (agentField.includes('학사') || agentField.includes('행정')) {
      score += 5; // 학사행정 에이전트 기본 보너스
    }
    
    if (score > bestMatch.score) {
      bestMatch = { agentId: agent.id, score, field: agentField };
    }
  }
  
  const confidence = Math.min(85, Math.max(40, bestMatch.score * 10));
  
  return {
    selectedAgentId: bestMatch.agentId,
    reasoning: `키워드 기반 매칭 (${bestMatch.field})`,
    confidence,
    secondaryAgents: availableAgents
      .filter(a => a.id !== bestMatch.agentId)
      .slice(0, 2)
      .map(a => a.id),
    specialization: 'specific'
  };
}

/**
 * 에이전트의 전문 분야를 추출하는 헬퍼 함수
 */
function extractField(agent: Agent): string {
  const combined = `${agent.name} ${agent.description || ''} ${agent.category || ''} ${agent.upperCategory || ''} ${agent.lowerCategory || ''}`.toLowerCase();
  
  if (combined.includes('컴퓨터') || combined.includes('cse') || combined.includes('프로그래밍')) return 'CSE(컴퓨터공학)';
  if (combined.includes('재료') || combined.includes('mse') || combined.includes('신소재')) return 'MSE(재료공학)';
  if (combined.includes('전자') || combined.includes('전기') || combined.includes('ee')) return 'EE(전자전기공학)';
  if (combined.includes('생명') || combined.includes('바이오') || combined.includes('의학')) return '생명과학/의학';
  if (combined.includes('기계') || combined.includes('me')) return 'ME(기계공학)';
  if (combined.includes('화학') || combined.includes('화공')) return '화학/화공';
  if (combined.includes('경영') || combined.includes('비즈니스')) return '경영/비즈니스';
  if (combined.includes('학사') || combined.includes('행정') || combined.includes('교무') || combined.includes('학사행정')) return '학사행정/교무';
  
  return '종합교육/상담';
}