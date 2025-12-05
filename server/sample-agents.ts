import type { InsertAgent } from "../shared/schema";

export const sampleAgents: Omit<InsertAgent, 'isActive' | 'organizationId' | 'isCustomIcon'>[] = [
  {
    name: "로보대학교 입학안내",
    description: "로보대학교 입학 전형, 모집요강, 지원 절차에 대한 안내를 제공합니다",
    creatorId: "admin",
    category: "학교",
    icon: "school",
    backgroundColor: "blue",
    llmModel: "gpt-4o",
    chatbotType: "doc-fallback-llm",
    personalityTraits: "친절하고 정확한 정보 제공을 위해 노력하는 입학 상담원",
    managerId: "admin"
  },
  {
    name: "컴퓨터공학과 교수진",
    description: "컴퓨터공학과 교수진 소개 및 연구 분야 안내",
    creatorId: "admin",
    category: "교수",
    icon: "user",
    backgroundColor: "green",
    llmModel: "gpt-4o",
    chatbotType: "doc-fallback-llm",
    personalityTraits: "전문적이고 학술적인 정보를 제공하는 교수진 안내자",
    managerId: "admin"
  },
  {
    name: "학과 공지사항",
    description: "각 학과의 최신 공지사항과 중요 소식을 알려드립니다",
    creatorId: "admin",
    category: "학교",
    icon: "bell",
    backgroundColor: "orange",
    llmModel: "gpt-4o-mini",
    chatbotType: "strict-doc",
    personalityTraits: "정확하고 신속한 공지사항 전달을 담당하는 안내자",
    managerId: "admin"
  },
  {
    name: "학습 도우미",
    description: "과제, 시험, 학습 방법에 대한 조언을 제공합니다",
    creatorId: "admin",
    category: "기능형",
    icon: "book",
    backgroundColor: "purple",
    llmModel: "gpt-4o",
    chatbotType: "general-llm",
    personalityTraits: "학생들의 학습을 돕는 친근하고 격려하는 멘토",
    managerId: "admin"
  },
  {
    name: "취업 상담소",
    description: "취업 준비, 인턴십, 진로 상담을 도와드립니다",
    creatorId: "admin",
    category: "기능형",
    icon: "briefcase",
    backgroundColor: "red",
    llmModel: "gpt-4o",
    chatbotType: "doc-fallback-llm",
    personalityTraits: "전문적이고 실용적인 취업 조언을 제공하는 상담사",
    managerId: "admin"
  }
];