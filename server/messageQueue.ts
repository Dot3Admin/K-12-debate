// 메시지 큐 시스템 - 챗봇이 대화 맥락을 파악하여 대답할 수 있도록 함

interface QueuedMessage {
  id: string;
  groupChatId: number;
  content: string;
  senderId?: string;
  agentId?: number;
  timestamp: Date;
  processed: boolean;
}

interface ConversationContext {
  groupChatId: number;
  recentMessages: Array<{
    role: 'user' | 'assistant';
    content: string;
    agentName?: string;
    userName?: string;
    timestamp: Date;
  }>;
  conversationSummary: string;
  participants: Array<{
    userId?: string;
    agentId?: number;
    name: string;
  }>;
}

class MessageQueue {
  private queue: QueuedMessage[] = [];
  private processing = false;
  private conversationContexts = new Map<number, ConversationContext>();

  // 메시지를 큐에 추가
  enqueue(message: Omit<QueuedMessage, 'id' | 'timestamp' | 'processed'>) {
    const queuedMessage: QueuedMessage = {
      ...message,
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      processed: false
    };
    
    this.queue.push(queuedMessage);
    console.log(`메시지 큐에 추가: ${queuedMessage.content.slice(0, 50)}...`);
    
    // 큐 처리 시작
    this.processQueue();
    
    return queuedMessage.id;
  }

  // 큐 처리
  private async processQueue() {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const message = this.queue.shift();
        if (!message || message.processed) continue;

        await this.processMessage(message);
        message.processed = true;
      }
    } catch (error) {
      console.error('메시지 큐 처리 중 오류:', error);
    } finally {
      this.processing = false;
    }
  }

  // 개별 메시지 처리
  private async processMessage(message: QueuedMessage) {
    console.log(`메시지 처리 중: ${message.content.slice(0, 50)}...`);
    
    // 대화 맥락 업데이트
    await this.updateConversationContext(message);
  }

  // 대화 맥락 업데이트
  private async updateConversationContext(message: QueuedMessage) {
    const { storage } = await import('./storage');
    
    try {
      // 그룹 채팅의 모든 메시지 가져오기
      const allMessages = await storage.getGroupChatMessages(message.groupChatId);
      
      // 🎯 엄격한 주제별 토픽 경계 찾기: 최신 @모두/@all 멘션부터만 시작
      let topicStartIndex = -1;
      let currentTopicContent = '';
      
      for (let i = allMessages.length - 1; i >= 0; i--) {
        const msg = allMessages[i];
        if (!msg.isBot && (msg.content.includes('@모두') || msg.content.includes('@all'))) {
          topicStartIndex = i;
          currentTopicContent = msg.content;
          console.log(`[🎯 주제별 토픽 경계] ${topicStartIndex}번째 메시지부터 현재 주제 시작: "${msg.content.substring(0, 30)}..."`);
          break;
        }
      }
      
      let recentMessages;
      
      if (topicStartIndex === -1) {
        // 📍 @모두 토픽이 없는 경우: 최근 10개 메시지만 사용 (주제 혼재 방지)
        recentMessages = allMessages.slice(-10);
        console.log(`[📍 단일 주제] @모두 멘션이 없어 최근 ${recentMessages.length}개 메시지만 사용 (주제 혼재 방지)`);
      } else {
        // 🔍 주제별 엄격한 분리: 현재 @모두 멘션부터만 사용, 이전 주제 제외
        const currentTopicMessages = allMessages.slice(topicStartIndex);
        
        // 🔄 중복 질문 감지 로직 (컨텍스트 다이어트)
        const isDuplicateQuestion = this.detectDuplicateQuestion(currentTopicMessages);
        
        // 📊 키워드 기반 주제 일관성 검증
        const topicKeywords = this.extractTopicKeywords(currentTopicContent);
        const filteredMessages = currentTopicMessages.filter((msg, index) => {
          if (index === 0) return true; // 첫 번째 @모두 메시지는 항상 포함
          
          // 🚀 컨텍스트 다이어트: 중복 질문 시 이전 봇 응답 제외
          if (isDuplicateQuestion && (msg.isBot || msg.agentId)) {
            console.log(`[🔄 중복 방지] 이전 봇 응답 제외: "${msg.content.substring(0, 30)}..."`);
            return false;
          }
          
          // 봇 응답이면 포함 (사용자 질문에 대한 답변) - 중복이 아닌 경우만
          if (msg.isBot || msg.agentId) return true;
          
          // 사용자 메시지면 주제 관련성 검증
          if (!msg.isBot) {
            // 새로운 @모두 멘션이면 주제 변경으로 간주
            if (msg.content.includes('@모두') || msg.content.includes('@all')) {
              return index === 0; // 첫 번째만 허용, 나머지는 새 주제로 분리
            }
            
            // 개별 멘션은 현재 주제와 관련있으면 포함
            return this.isRelatedToTopic(msg.content, topicKeywords);
          }
          
          return true;
        });
        
        // 최근 12개 메시지로 제한 (컨텍스트 창 관리)
        recentMessages = filteredMessages.slice(-12);
        
        const contextInfo = isDuplicateQuestion ? '중복 질문 감지로 이전 답변 제외' : '일반 맥락';
        console.log(`[🎯 주제별 분리] 원본 ${currentTopicMessages.length}개 → 필터링 ${filteredMessages.length}개 → 최종 ${recentMessages.length}개 메시지`);
        console.log(`[🎯 주제 키워드] "${topicKeywords.join(', ')}" 기준으로 관련 메시지만 선별`);
        console.log(`[🔄 컨텍스트 상태] ${contextInfo}`);
      }
      
      // 메시지를 역할별로 변환
      const conversationHistory = await Promise.all(
        recentMessages.map(async (msg) => {
          let role: 'user' | 'assistant' = 'user';
          let name = '';
          
          if (msg.agentId) {
            role = 'assistant';
            const agent = await storage.getAgent(msg.agentId);
            name = agent?.name || 'AI 어시스턴트';
          } else if (msg.senderId) {
            const user = await storage.getUser(msg.senderId);
            name = user?.name || '사용자';
          }
          
          return {
            role,
            content: msg.content,
            agentName: role === 'assistant' ? name : undefined,
            userName: role === 'user' ? name : undefined,
            timestamp: msg.createdAt || new Date()
          };
        })
      );

      // 대화 요약 생성 (최근 대화가 길 경우)
      let conversationSummary = '';
      if (conversationHistory.length > 10) {
        conversationSummary = this.generateConversationSummary(conversationHistory.slice(0, -5));
      }

      // 참여자 목록 구성
      const participants = await this.getGroupChatParticipants(message.groupChatId);

      // 맥락 저장
      this.conversationContexts.set(message.groupChatId, {
        groupChatId: message.groupChatId,
        recentMessages: conversationHistory,
        conversationSummary,
        participants
      });

      console.log(`그룹 채팅 ${message.groupChatId} 대화 맥락 업데이트: ${conversationHistory.length}개 메시지`);
      
    } catch (error) {
      console.error('대화 맥락 업데이트 중 오류:', error);
    }
  }

  // 그룹 채팅 참여자 목록 가져오기
  private async getGroupChatParticipants(groupChatId: number) {
    const { storage } = await import('./storage');
    const participants = [];

    try {
      // 사용자 멤버들
      const members = await storage.getGroupChatMembers(groupChatId);
      for (const member of members) {
        const user = await storage.getUser(member.userId);
        if (user) {
          participants.push({
            userId: user.id,
            name: user.name || user.username
          });
        }
      }

      // 챗봇 에이전트들
      const agents = await storage.getGroupChatAgents(groupChatId);
      for (const groupAgent of agents) {
        const agent = await storage.getAgent(groupAgent.agentId);
        if (agent) {
          participants.push({
            agentId: agent.id,
            name: agent.name
          });
        }
      }
    } catch (error) {
      console.error('참여자 목록 가져오기 중 오류:', error);
    }

    return participants;
  }

  // 대화 요약 생성 (개선된 버전)
  private generateConversationSummary(messages: Array<{role: string, content: string, agentName?: string, userName?: string}>) {
    if (messages.length === 0) return '';

    const topics = new Set<string>();
    const speakers = new Set<string>();
    const recentQuestions: string[] = [];
    
    // 주요 키워드와 화자 추출
    messages.forEach(msg => {
      // 화자 정보
      if (msg.agentName) speakers.add(msg.agentName);
      if (msg.userName) speakers.add(msg.userName);
      
      // 질문 수집
      if (msg.content.includes('?') || msg.content.includes('？')) {
        recentQuestions.push(msg.content.slice(0, 100));
      }
      
      // 주요 키워드 추출 (한국어 특화)
      const keywords = msg.content
        .split(/\s+/)
        .filter(word => word.length > 2 && 
          !['있는', '하는', '그런', '이런', '같은', '또는', '그리고', '하지만', '그래서', '때문에'].includes(word))
        .slice(0, 3);
      
      keywords.forEach(keyword => topics.add(keyword));
    });

    const topicList = Array.from(topics).slice(0, 7);
    const speakerList = Array.from(speakers).slice(0, 5);
    const questionList = recentQuestions.slice(-2); // 최근 2개 질문
    
    let summary = `이전 대화 주제: ${topicList.join(', ')}`;
    if (speakerList.length > 0) summary += `. 참여자: ${speakerList.join(', ')}`;
    if (questionList.length > 0) summary += `. 최근 질문: ${questionList.join(' | ')}`;
    
    return summary;
  }

  // 특정 그룹 채팅의 대화 맥락 가져오기
  getConversationContext(groupChatId: number): ConversationContext | null {
    return this.conversationContexts.get(groupChatId) || null;
  }

  // 챗봇을 위한 향상된 대화 히스토리 생성
  generateEnhancedConversationHistory(groupChatId: number): Array<{role: 'user' | 'assistant', content: string}> {
    const context = this.getConversationContext(groupChatId);
    if (!context) return [];

    let conversationHistory = [];

    // 대화 요약이 있으면 먼저 추가
    if (context.conversationSummary) {
      conversationHistory.push({
        role: 'assistant' as const,
        content: `[이전 대화 요약] ${context.conversationSummary}`
      });
    }

    // 최근 메시지들 추가 (역할과 화자명 포함)
    const recentMessages = context.recentMessages.slice(-10);
    conversationHistory.push(...recentMessages.map(msg => ({
      role: msg.role,
      content: msg.role === 'assistant' 
        ? `[${msg.agentName}] ${msg.content}`
        : `[${msg.userName}] ${msg.content}`
    })));

    return conversationHistory;
  }

  // 큐 상태 확인
  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      contextCount: this.conversationContexts.size
    };
  }
  
  // 메시지 큐 상태 정리 (메모리 최적화)
  cleanupOldContexts(maxAge: number = 1000 * 60 * 60 * 2) { // 2시간
    const now = Date.now();
    
    for (const [groupChatId, context] of Array.from(this.conversationContexts.entries())) {
      const lastMessageTime = context.recentMessages.length > 0 
        ? new Date(context.recentMessages[context.recentMessages.length - 1].timestamp).getTime()
        : 0;
        
      if (now - lastMessageTime > maxAge) {
        this.conversationContexts.delete(groupChatId);
        console.log(`대화 맥락 정리: ${groupChatId}`);
      }
    }
  }

  // 🔄 중복 질문 감지 (컨텍스트 다이어트용)
  private detectDuplicateQuestion(messages: any[]): boolean {
    const userQuestions = messages.filter(msg => 
      !msg.isBot && !msg.agentId && (msg.content.includes('@모두') || msg.content.includes('@all'))
    );
    
    if (userQuestions.length < 2) return false; // 질문이 2개 미만이면 중복 불가능
    
    // 가장 최신 질문과 직전 질문 비교
    const latestQuestion = userQuestions[userQuestions.length - 1];
    const previousQuestion = userQuestions[userQuestions.length - 2];
    
    // 질문 내용 정규화 (멘션, 특수문자 제거)
    const cleanLatest = this.cleanQuestionText(latestQuestion.content);
    const cleanPrevious = this.cleanQuestionText(previousQuestion.content);
    
    // 완전히 동일하거나 90% 이상 유사하면 중복으로 판단
    if (cleanLatest === cleanPrevious) {
      console.log(`[🔄 중복 감지] 완전히 동일한 질문: "${cleanLatest}"`);
      return true;
    }
    
    // 키워드 기반 유사도 검사
    const latestKeywords = this.extractTopicKeywords(cleanLatest);
    const previousKeywords = this.extractTopicKeywords(cleanPrevious);
    
    if (latestKeywords.length === 0 || previousKeywords.length === 0) return false;
    
    const commonKeywords = latestKeywords.filter(keyword => 
      previousKeywords.includes(keyword)
    );
    
    const similarity = commonKeywords.length / Math.max(latestKeywords.length, previousKeywords.length);
    
    if (similarity >= 0.8) { // 80% 이상 유사하면 중복으로 판단
      console.log(`[🔄 중복 감지] 유사도 ${Math.round(similarity * 100)}% - 키워드: ${commonKeywords.join(', ')}`);
      return true;
    }
    
    return false;
  }
  
  // 질문 텍스트 정규화 (중복 감지용)
  private cleanQuestionText(content: string): string {
    return content
      .replace(/@[^\s]+/g, '') // @멘션 제거
      .replace(/[?!.,;:()\[\]{}"']/g, '') // 특수문자 제거
      .replace(/\s+/g, ' ') // 연속 공백을 하나로
      .toLowerCase()
      .trim();
  }

  // 🎯 주제 키워드 추출 (주제 일관성 유지용)
  private extractTopicKeywords(content: string): string[] {
    // @멘션과 특수문자 제거
    const cleanContent = content
      .replace(/@[^\s]+/g, '') // @멘션 제거
      .replace(/[?!.,;:()\[\]{}"']/g, ' ') // 특수문자 공백 변환
      .toLowerCase()
      .trim();
    
    // 의미있는 단어 추출 (2글자 이상)
    const words = cleanContent
      .split(/\s+/)
      .filter(word => word.length >= 2)
      .filter(word => !this.isStopWord(word));
    
    // 중복 제거 후 최대 5개 키워드 반환
    const uniqueWords = Array.from(new Set(words)).slice(0, 5);
    
    return uniqueWords;
  }

  // 🚫 불용어 검사 (의미없는 단어 필터링)
  private isStopWord(word: string): boolean {
    const stopWords = [
      // 한국어 불용어
      '그', '것', '이', '그것', '저', '저것', '이것', '그런', '저런', '이런',
      '있다', '없다', '이다', '아니다', '하다', '되다', '같다', '다른', '많다',
      '좋다', '나쁘다', '크다', '작다', '높다', '낮다', '빠르다', '느리다',
      '우리', '나', '너', '그녀', '그들', '여러분', '모두', 'all',
      '때문', '경우', '정도', '처럼', '같이', '함께', '또한', '그리고',
      '하지만', '그러나', '그런데', '따라서', '즉', '예를들어',
      // 영어 불용어
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have',
      'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'can', 'may', 'might', 'this', 'that', 'these', 'those'
    ];
    
    return stopWords.includes(word);
  }

  // 🔍 메시지 주제 관련성 검증
  private isRelatedToTopic(messageContent: string, topicKeywords: string[]): boolean {
    if (topicKeywords.length === 0) return true; // 키워드가 없으면 모든 메시지 허용
    
    const messageKeywords = this.extractTopicKeywords(messageContent);
    
    // 키워드 교집합 확인 (최소 1개 공통 키워드 필요)
    const commonKeywords = messageKeywords.filter(keyword => 
      topicKeywords.some(topicKeyword => 
        topicKeyword.includes(keyword) || keyword.includes(topicKeyword)
      )
    );
    
    const isRelated = commonKeywords.length > 0;
    
    if (!isRelated) {
      console.log(`[🚫 주제 불일치] "${messageContent.substring(0, 30)}..." - 키워드: ${messageKeywords.join(', ')}`);
    }
    
    return isRelated;
  }
}

// 싱글톤 인스턴스
export const messageQueue = new MessageQueue();