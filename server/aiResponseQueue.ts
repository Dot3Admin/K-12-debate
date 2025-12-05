// AI 응답 생성 전용 큐 시스템
// 메시지 중복 처리와 순차 실행을 보장

import type { Agent } from '@shared/schema';

interface AIResponseTask {
  id: string;
  groupChatId: number;
  content: string;
  availableAgents: Agent[];
  userId: string;
  userTurnId: string;
  detectedLanguage: string;
  timestamp: Date;
  processed: boolean;
}

class AIResponseQueue {
  private queue: AIResponseTask[] = [];
  private processing = false;

  // AI 응답 작업을 큐에 추가
  enqueue(task: Omit<AIResponseTask, 'id' | 'timestamp' | 'processed'>) {
    const queuedTask: AIResponseTask = {
      ...task,
      id: `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      processed: false
    };
    
    this.queue.push(queuedTask);
    console.log(`[🎭 AI 큐 추가] ${queuedTask.content.slice(0, 50)}... (큐 크기: ${this.queue.length})`);
    
    // 🚀 즉시 반환: 큐 처리를 다음 이벤트 루프로 넘김 (메인 스레드 블로킹 방지)
    setImmediate(() => {
      this.processQueue();
    });
    
    return queuedTask.id;
  }

  // 큐 순차 처리 (단일 소비자 패턴)
  private async processQueue() {
    if (this.processing) {
      console.log(`[🎭 AI 큐 대기] 이미 처리 중 - 현재 큐 크기: ${this.queue.length}`);
      return;
    }
    
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift();
        if (!task || task.processed) continue;

        console.log(`[🎭 AI 큐 처리] ${task.content.slice(0, 50)}... (남은 작업: ${this.queue.length})`);
        
        await this.processAIResponse(task);
        task.processed = true;
      }
    } catch (error) {
      console.error('[🎭 AI 큐 오류]:', error);
    } finally {
      this.processing = false;
      console.log(`[🎭 AI 큐 완료] 모든 작업 처리 완료`);
    }
  }

  // 개별 AI 응답 생성 처리
  private async processAIResponse(task: AIResponseTask) {
    const { groupChatId, content, availableAgents, userId, userTurnId, detectedLanguage } = task;
    
    try {
      // 필요한 모듈 임포트
      const { AgentOrchestrator } = await import('./agentOrchestrator');
      const storageModule = await import('./storage');
      const { broadcastGroupChatMessage, broadcastGroupChatStatus } = await import('./broadcast');
      const { appendMessageToThread } = await import('./assistantManager');
      
      const orchestrator = AgentOrchestrator.getInstance();
      const storage = storageModule.storage;

      console.log(`[🔥 AI 큐 워커] @모두 메시지 처리 시작 - ${availableAgents.length}개 에이전트`);

      // 🎭 AI 응답 생성
      const scenarioResponses = await orchestrator.generateScenarioBasedResponse(
        content,
        availableAgents,
        groupChatId,
        userId,
        userTurnId,
        detectedLanguage
      );

      console.log(`[✅ AI 큐 워커] ${scenarioResponses.length}개 응답 생성 완료 - 저장 및 브로드캐스트 시작`);

      // 🎭 시나리오 실행 ID 생성 (중복 방지용)
      const scenarioRunId = `scenario_${groupChatId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // ⚡ PHASE 1: 첫 번째 응답 즉시 저장 + 브로드캐스트
      if (scenarioResponses.length > 0) {
        const firstResponse = scenarioResponses[0] as any;
        const firstAgent = availableAgents.find(a => a.id === firstResponse.agentId);
        
        if (firstAgent) {
          // 🔍 점진적 파싱에서 이미 저장된 경우 건너뛰기
          if (firstResponse.savedMessageId) {
            console.log(`[⏭️ 중복 방지] 첫 번째 응답 이미 저장됨 (ID: ${firstResponse.savedMessageId}) - 건너뛰기`);
          } else {
            const canBroadcast = await orchestrator.broadcastTurn(groupChatId, scenarioRunId, firstAgent.id, 0);
            
            if (canBroadcast) {
              const firstMessage = await storage.createGroupChatMessage({
                groupChatId,
                content: firstResponse.content,
                senderId: `agent_${firstAgent.id}`,
                agentName: firstAgent.name,
                agentId: firstAgent.id,
                userTurnId: userTurnId,
                replyOrder: undefined
              });
              
              // 🚀 SSE 브로드캐스트 (중요!)
              broadcastGroupChatMessage(groupChatId, firstMessage);
              
              // 📝 Thread에 봇 메시지 추가
              try {
                await appendMessageToThread(groupChatId, `Bot: ${firstAgent.name}`, firstResponse.content);
              } catch (threadError) {
                console.error('[ThreadManager] Failed to append first bot message to thread:', threadError);
              }
              
              console.log(`[⚡ AI 큐 즉시 저장] ${firstAgent.name}: ${firstResponse.content.slice(0, 60)}...`);
            }
          }
        }
      }
      
      // 🚀 PHASE 2: 나머지 응답들 백그라운드 순차 처리
      if (scenarioResponses.length > 1) {
        setImmediate(async () => {
          try {
            for (let i = 1; i < scenarioResponses.length; i++) {
              const scenarioResponse = scenarioResponses[i] as any;
              const agent = availableAgents.find(a => a.id === scenarioResponse.agentId);
              
              if (agent) {
                // 🔍 점진적 파싱에서 이미 저장된 경우 건너뛰기
                if (scenarioResponse.savedMessageId) {
                  console.log(`[⏭️ 중복 방지] ${agent.name} 이미 저장됨 (ID: ${scenarioResponse.savedMessageId}) - 건너뛰기`);
                  continue;
                }
                
                // 🔍 중복 체크 (로깅용)
                const canBroadcast = await orchestrator.broadcastTurn(groupChatId, scenarioRunId, agent.id, i);
                console.log(`[🔍 브로드캐스트 체크] ${agent.name} (index ${i}): ${canBroadcast ? '승인' : '중복 감지 - 무시하고 진행'}`);
                
                // ✅ 중복 여부와 무관하게 항상 처리 (사용자 경험 우선)
                console.log(`[⚡ AI 큐 처리] ${agent.name} 응답 즉시 저장 (${i+1}/${scenarioResponses.length})`);
                
                const agentMessage = await storage.createGroupChatMessage({
                  groupChatId,
                  content: scenarioResponse.content,
                  senderId: `agent_${agent.id}`,
                  agentName: agent.name,
                  agentId: agent.id,
                  userTurnId: userTurnId,
                  replyOrder: undefined
                });
                
                // 🚀 SSE 브로드캐스트 (중요!)
                broadcastGroupChatMessage(groupChatId, agentMessage);
                
                // 📝 Thread에 봇 메시지 추가
                try {
                  await appendMessageToThread(groupChatId, `Bot: ${agent.name}`, scenarioResponse.content);
                } catch (threadError) {
                  console.error('[ThreadManager] Failed to append bot message to thread:', threadError);
                }
                
                console.log(`[🎭 AI 큐 백그라운드 ${i+1}/${scenarioResponses.length}] ${agent.name}: ${scenarioResponse.content.slice(0, 60)}...`);
              }
            }
            
            // 모든 응답 완료 후 typing_end 발송
            console.log(`[🏁 AI 큐 완료] 모든 ${scenarioResponses.length}개 메시지 처리 완료`);
            await broadcastGroupChatStatus(groupChatId, 'typing_end');
          } catch (error) {
            console.error('[🎭 AI 큐 백그라운드 오류]:', error);
            await broadcastGroupChatStatus(groupChatId, 'typing_end');
          }
        });
      } else {
        // 단일 응답인 경우 즉시 typing_end
        await broadcastGroupChatStatus(groupChatId, 'typing_end');
      }

    } catch (error) {
      console.error(`[❌ AI 큐 워커 오류] groupChatId=${groupChatId}:`, error);
      
      // 오류 발생 시 typing_end 발송
      try {
        const { broadcastGroupChatStatus } = await import('./broadcast');
        await broadcastGroupChatStatus(groupChatId, 'typing_end');
        console.log(`[🚨 AI 큐 복구] typing_end 발송으로 오류 복구`);
      } catch (broadcastError) {
        console.error(`[🚨 AI 큐 심각] typing_end 발송 실패:`, broadcastError);
      }
    }
  }

  // 큐 상태 확인
  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing
    };
  }

  // 특정 그룹 채팅의 대기 중인 작업 확인
  hasPendingTasks(groupChatId: number): boolean {
    return this.queue.some(task => task.groupChatId === groupChatId && !task.processed);
  }
}

// 싱글톤 인스턴스
export const aiResponseQueue = new AIResponseQueue();
