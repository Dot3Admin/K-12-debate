import { storage } from "./storage";
import { responseTemplates, messages } from "../shared/schema";
import { eq, and, desc, notInArray } from "drizzle-orm";

// 기본 템플릿 데이터 - 12종의 다양한 인사 템플릿
const defaultTemplates = [
  // 정중한 스타일 (formal)
  {
    category: "greeting",
    template: "안녕하세요! 저는 {agentName}입니다. 오늘 어떤 도움이 필요하신지 알려주시면 성심껏 도와드리겠습니다.",
    agentType: "formal",
    language: "ko"
  },
  {
    category: "greeting", 
    template: "반갑습니다. {agentName}이라고 합니다. 궁금한 사항이나 필요한 정보가 있으시면 언제든 말씀해 주세요.",
    agentType: "formal",
    language: "ko"
  },
  {
    category: "greeting",
    template: "안녕하세요! {agentName}입니다. 무엇을 도와드릴까요?",
    agentType: "formal", 
    language: "ko"
  },
  {
    category: "greeting",
    template: "좋은 하루입니다! 저는 {agentName}이고, 여러분의 질문에 최선을 다해 답변드리겠습니다.",
    agentType: "formal",
    language: "ko"
  },

  // 친근한 스타일 (friendly)
  {
    category: "greeting",
    template: "안녕하세요! {agentName}예요~ 무엇이든 편하게 물어보세요!",
    agentType: "friendly",
    language: "ko"
  },
  {
    category: "greeting",
    template: "하이! {agentName}입니다. 오늘도 좋은 하루 되시고, 필요한 거 있으면 언제든 말씀하세요 😊",
    agentType: "friendly", 
    language: "ko"
  },
  {
    category: "greeting",
    template: "안녕하세요! {agentName}이에요. 궁금한 게 있으시면 편하게 물어보시면 됩니다!",
    agentType: "friendly",
    language: "ko"
  },
  {
    category: "greeting",
    template: "반가워요! 저는 {agentName}이고, 여러분을 도와드리려고 여기 있어요. 뭐든 물어보세요!",
    agentType: "friendly",
    language: "ko"
  },

  // 전문가 스타일 (expert)
  {
    category: "greeting",
    template: "안녕하세요. {agentName}입니다. 전문적인 정보와 정확한 답변을 제공해드리겠습니다.",
    agentType: "expert",
    language: "ko"
  },
  {
    category: "greeting",
    template: "반갑습니다. 저는 {agentName}이며, 관련 분야의 체계적이고 정확한 정보를 안내해드리겠습니다.",
    agentType: "expert",
    language: "ko"
  },
  {
    category: "greeting",
    template: "{agentName}입니다. 전문 지식을 바탕으로 상세하고 정확한 답변을 제공해드리겠습니다.",
    agentType: "expert",
    language: "ko"
  },
  {
    category: "greeting",
    template: "안녕하세요, {agentName}입니다. 깊이 있는 분석과 전문적인 관점에서 도움을 드리겠습니다.",
    agentType: "expert",
    language: "ko"
  },

  // 전환 템플릿
  {
    category: "transition",
    template: "추가로 궁금한 사항이 있으시면 언제든 말씀해 주세요.",
    agentType: "formal",
    language: "ko"
  },
  {
    category: "transition",
    template: "다른 질문이 있으시거나 더 자세한 설명이 필요하시면 알려주세요.",
    agentType: "formal",
    language: "ko"
  },
  {
    category: "transition",
    template: "또 다른 도움이 필요하시면 편하게 말씀하세요!",
    agentType: "friendly",
    language: "ko"
  },
  {
    category: "transition",
    template: "추가적인 정보나 분석이 필요하시면 구체적으로 요청해 주시기 바랍니다.",
    agentType: "expert",
    language: "ko"
  },

  // 마무리 템플릿
  {
    category: "closing",
    template: "도움이 되셨기를 바라며, 언제든 다시 문의해 주세요.",
    agentType: "formal",
    language: "ko"
  },
  {
    category: "closing",
    template: "좋은 하루 되세요! 또 궁금한 게 있으면 언제든 와주세요~",
    agentType: "friendly",
    language: "ko"
  },
  {
    category: "closing",
    template: "제공된 정보가 유용하셨기를 바라며, 추가 문의사항이 있으시면 언제든 연락 바랍니다.",
    agentType: "expert",
    language: "ko"
  }
];

// 템플릿 시딩 함수
export async function seedTemplates() {
  try {
    // 기존 템플릿 확인
    const existingTemplates = await storage.db.select().from(responseTemplates).limit(1);
    
    if (existingTemplates.length === 0) {
      console.log("템플릿 초기 데이터를 삽입합니다...");
      await storage.db.insert(responseTemplates).values(defaultTemplates);
      console.log(`${defaultTemplates.length}개의 템플릿이 성공적으로 삽입되었습니다.`);
    } else {
      console.log("템플릿 데이터가 이미 존재합니다.");
    }
  } catch (error) {
    console.error("템플릿 시딩 중 오류 발생:", error);
  }
}

// 템플릿 선택 함수 - 최근 5턴 내에 사용되지 않은 템플릿을 선택
export async function selectTemplate(
  conversationId: number, 
  category: string, 
  agentType: string = "formal"
): Promise<string> {
  try {
    // 최근 5개 메시지에서 사용된 템플릿 ID 조회 (단순화)
    const recentMessages = await storage.db
      .select({ templateUsed: messages.templateUsed })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(5);
    
    const excludeTemplateIds = recentMessages.map((m: any) => m.templateUsed).filter(Boolean);

    // 사용 가능한 템플릿 조회 (최근 사용된 템플릿 제외)
    let availableTemplates = await storage.db
      .select()
      .from(responseTemplates)
      .where(
        and(
          eq(responseTemplates.category, category),
          eq(responseTemplates.agentType, agentType),
          eq(responseTemplates.isActive, true),
          excludeTemplateIds.length > 0 ? notInArray(responseTemplates.id, excludeTemplateIds) : undefined
        )
      );

    // 사용 가능한 템플릿이 없으면 모든 템플릿에서 선택
    if (availableTemplates.length === 0) {
      availableTemplates = await storage.db
        .select()
        .from(responseTemplates)
        .where(
          and(
            eq(responseTemplates.category, category),
            eq(responseTemplates.agentType, agentType),
            eq(responseTemplates.isActive, true)
          )
        );
    }

    if (availableTemplates.length === 0) {
      // 폴백 기본 템플릿
      return category === "greeting" 
        ? "안녕하세요! 무엇을 도와드릴까요?"
        : "추가로 궁금한 사항이 있으시면 언제든 말씀해 주세요.";
    }

    // 가장 적게 사용된 템플릿 우선 선택
    const selectedTemplate = availableTemplates.sort((a: any, b: any) => a.usageCount - b.usageCount)[0];
    
    // 사용 횟수 업데이트
    await storage.db
      .update(responseTemplates)
      .set({ 
        usageCount: selectedTemplate.usageCount + 1,
        lastUsed: new Date()
      })
      .where(eq(responseTemplates.id, selectedTemplate.id));

    return selectedTemplate.template;
  } catch (error) {
    console.error("템플릿 선택 중 오류:", error);
    return category === "greeting" 
      ? "안녕하세요! 무엇을 도와드릴까요?"
      : "추가로 궁금한 사항이 있으시면 언제든 말씀해 주세요.";
  }
}

// 응답 유사도 검사 함수 (간단한 버전)
export function calculateSimilarity(text1: string, text2: string): number {
  // 간단한 단어 기반 유사도 계산
  const words1 = text1.toLowerCase().split(/\s+/);
  const words2 = text2.toLowerCase().split(/\s+/);
  
  const intersection = words1.filter(word => words2.includes(word));
  const union = Array.from(new Set([...words1, ...words2]));
  
  return intersection.length / union.length;
}

// 에이전트 타입에 따른 스타일 가이드
export const AGENT_STYLE_GUIDES = {
  formal: {
    tone: "정중하고 격식 있는",
    structure: "체계적이고 명확한",
    vocabulary: "정확하고 표준적인 용어 사용",
    features: ["존댓말 사용", "완전한 문장", "명확한 논리 구조"]
  },
  friendly: {
    tone: "친근하고 따뜻한",
    structure: "편안하고 대화하는 듯한",
    vocabulary: "일상적이고 친숙한 표현",
    features: ["반말/존댓말 혼용", "이모티콘 활용", "개인적인 표현"]
  },
  expert: {
    tone: "전문적이고 신뢰할 수 있는",
    structure: "논리적이고 세밀한",
    vocabulary: "전문 용어와 정확한 표현",
    features: ["근거 제시", "상세한 설명", "학술적 접근"]
  }
};