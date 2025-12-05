import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "./db.js";
import { trendingTopics } from "@shared/schema";
import { desc, and, eq } from "drizzle-orm";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

interface HotTopicView {
  character: string;
  question: string;
  expectedAnswer: string;
  category: string;
}

export async function generateHotTopicViews(): Promise<HotTopicView[]> {
  console.log('[🔥 HOT TOPICS] 생성 시작...');
  
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 4000,
      }
    });

    const prompt = `당신은 한국 뉴스 및 이슈 분석 전문가입니다.

**목표**: 현재 대중이 가장 궁금해하는 논쟁적인 이슈나 스캔들에 대해, 당사자(핵심 인물)에게 직접 책임을 추궁하는 질문을 10개 생성하세요.

**제약 조건**:
1. 발언 근거 필수: 해당 인물이 실제로 발언하거나 공식 의견을 표명한 주제여야 합니다.
2. 스캔들/논쟁 포함: 최소 30%는 유명 인물의 행동, 결정, 또는 논란에 대한 책임 추궁 질문이어야 합니다.
3. 다양성: 정치, 경제, 사회, 문화, 과학 등 다양한 분야를 포함하세요.
4. 시의성: 최근 2-3개월 이내의 이슈를 우선하세요.
5. 한국어: 모든 내용은 한국어로 작성하세요.

**출력 형식** (JSON):
\`\`\`json
[
  {
    "character": "제롬 파월 연준 의장",
    "question": "장기간 고금리를 유지해야 하는 궁극적인 목표는 무엇인가요?",
    "expectedAnswer": "인플레이션 억제와 경제 안정을 위한 통화정책의 일환입니다.",
    "category": "economy"
  },
  ...
]
\`\`\`

**카테고리**: philosophy, science, art, politics, economy 중 선택

지금 바로 10개의 Hot Topic Views를 JSON 형식으로 생성하세요:`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    console.log('[🔥 HOT TOPICS] Gemini 응답 수신');
    
    const jsonText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const hotTopics = JSON.parse(jsonText) as HotTopicView[];
    
    console.log(`[✅ HOT TOPICS] ${hotTopics.length}개 생성 완료`);
    
    return hotTopics;
  } catch (error: any) {
    console.error('[❌ HOT TOPICS] 생성 실패:', error);
    throw error;
  }
}

export async function updateHotTopicViews(): Promise<void> {
  console.log('[🔄 HOT TOPICS] 업데이트 시작...');
  
  try {
    const hotTopics = await generateHotTopicViews();
    const now = new Date();
    
    await db.transaction(async (tx) => {
      await tx
        .delete(trendingTopics)
        .where(eq(trendingTopics.type, 'hot_topic'));
      
      for (let i = 0; i < hotTopics.length; i++) {
        const topic = hotTopics[i];
        await tx.insert(trendingTopics).values({
          type: 'hot_topic',
          title: topic.character,
          subtitle: topic.question,
          category: topic.category,
          character: topic.character,
          question: topic.question,
          expectedAnswer: topic.expectedAnswer,
          lastGeneratedAt: now,
          lastCalledAt: now,
          displayOrder: i,
          isActive: true,
        });
      }
    });
    
    console.log('[✅ HOT TOPICS] 데이터베이스 업데이트 완료');
  } catch (error: any) {
    console.error('[❌ HOT TOPICS] 업데이트 실패:', error);
    throw error;
  }
}

export async function getHotTopicViews(): Promise<any[]> {
  const topics = await db
    .select()
    .from(trendingTopics)
    .where(and(
      eq(trendingTopics.type, 'hot_topic'),
      eq(trendingTopics.isActive, true)
    ))
    .orderBy(desc(trendingTopics.displayOrder))
    .limit(10);
  
  return topics;
}

export async function shouldUpdateHotTopics(): Promise<boolean> {
  const latestTopic = await db
    .select()
    .from(trendingTopics)
    .where(eq(trendingTopics.type, 'hot_topic'))
    .orderBy(desc(trendingTopics.lastGeneratedAt))
    .limit(1);
  
  if (latestTopic.length === 0) {
    return true;
  }
  
  const lastGenerated = latestTopic[0].lastGeneratedAt;
  const lastCalled = latestTopic[0].lastCalledAt;
  
  if (!lastGenerated || !lastCalled) {
    return true;
  }
  
  const now = new Date();
  const hoursSinceGenerated = (now.getTime() - lastGenerated.getTime()) / (1000 * 60 * 60);
  const hoursSinceCalled = (now.getTime() - lastCalled.getTime()) / (1000 * 60 * 60);
  
  const isExpired = hoursSinceGenerated >= 24;
  const hasRecentActivity = hoursSinceCalled <= 24;
  
  return isExpired && hasRecentActivity;
}

export async function updateLastCalledAt(): Promise<void> {
  const now = new Date();
  await db
    .update(trendingTopics)
    .set({ lastCalledAt: now })
    .where(eq(trendingTopics.type, 'hot_topic'));
}
