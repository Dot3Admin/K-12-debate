import type { WeightedPhrase } from "./characterAnalyzer.js";
import type { IStorage } from "./storage.js";

/**
 * 가중치 기반 확률 샘플링으로 표현을 선택합니다.
 * @param weightedPhrases 가중치 포함 표현 목록
 * @param excludePhrases 제외할 표현들 (최근 사용한 표현)
 * @param count 선택할 개수
 * @returns 선택된 WeightedPhrase 객체들
 */
export function selectWeightedPhrases(
  weightedPhrases: WeightedPhrase[],
  excludePhrases: string[] = [],
  count: number = 2
): WeightedPhrase[] {
  if (!weightedPhrases || weightedPhrases.length === 0) {
    return [];
  }

  // 제외할 표현을 제거한 후보군
  const candidates = weightedPhrases.filter(
    (p) => !excludePhrases.includes(p.phrase)
  );

  if (candidates.length === 0) {
    // 모든 표현이 제외된 경우, 원본에서 선택 (순환 재시작)
    console.log("[Phrase Selector] 모든 표현 사용됨, 순환 재시작");
    return selectWeightedPhrases(weightedPhrases, [], count);
  }

  const selected: WeightedPhrase[] = [];
  let remaining = [...candidates]; // 남은 후보들

  for (let i = 0; i < count && remaining.length > 0; i++) {
    // 남은 후보들의 총 가중치 계산
    const totalWeight = remaining.reduce((sum, p) => sum + p.weight, 0);
    
    // 가중치 기반 확률 샘플링
    let random = Math.random() * totalWeight;
    let cumulativeWeight = 0;

    for (let j = 0; j < remaining.length; j++) {
      const candidate = remaining[j];
      cumulativeWeight += candidate.weight;
      
      if (random <= cumulativeWeight) {
        selected.push(candidate);
        // 선택된 항목을 remaining 배열에서 제거
        remaining.splice(j, 1);
        break;
      }
    }
  }

  console.log(
    `[Phrase Selector] ${selected.length}개 표현 선택 (제외: ${excludePhrases.length}개, 요청: ${count}개)`
  );
  return selected;
}

/**
 * 특정 에이전트의 최근 사용 표현을 조회합니다.
 * @param storage Storage 인스턴스
 * @param agentId 에이전트 ID
 * @param conversationId 1:1 대화 ID (선택)
 * @param groupChatId 그룹 채팅 ID (선택)
 * @returns 최근 사용한 표현 목록 (최대 5개)
 */
export async function getRecentUsedPhrases(
  storage: IStorage,
  agentId: number,
  conversationId?: number,
  groupChatId?: number
): Promise<string[]> {
  try {
    const history = await storage.getPhraseUsageHistory(
      agentId,
      conversationId,
      groupChatId
    );
    return history?.usedPhrases || [];
  } catch (error) {
    console.error("[Phrase Selector] 사용 이력 조회 실패:", error);
    return [];
  }
}

/**
 * 선택된 표현을 사용 이력에 추가합니다.
 * @param storage Storage 인스턴스
 * @param agentId 에이전트 ID
 * @param selectedPhrases 선택된 표현들
 * @param conversationId 1:1 대화 ID (선택)
 * @param groupChatId 그룹 채팅 ID (선택)
 */
export async function updatePhraseUsageHistory(
  storage: IStorage,
  agentId: number,
  selectedPhrases: string[],
  conversationId?: number,
  groupChatId?: number
): Promise<void> {
  try {
    // 기존 이력 조회
    const existingHistory = await storage.getPhraseUsageHistory(
      agentId,
      conversationId,
      groupChatId
    );

    // 최근 사용한 표현 업데이트 (최대 5개 유지)
    const updatedPhrases = [
      ...selectedPhrases,
      ...(existingHistory?.usedPhrases || []),
    ].slice(0, 5);

    await storage.savePhraseUsageHistory({
      agentId,
      conversationId: conversationId || null,
      groupChatId: groupChatId || null,
      usedPhrases: updatedPhrases,
    });

    console.log(
      `[Phrase Selector] 사용 이력 업데이트: agent=${agentId}, phrases=${selectedPhrases.join(", ")}`
    );
  } catch (error) {
    console.error("[Phrase Selector] 사용 이력 저장 실패:", error);
  }
}

/**
 * 이미 선택된 표현들을 프롬프트 형식으로 포맷합니다.
 * @param selectedPhrases 선택된 WeightedPhrase 객체들
 * @param agentName 에이전트 이름
 * @returns 프롬프트에 주입할 텍스트
 */
export function formatSelectedPhrasesForPrompt(
  selectedPhrases: WeightedPhrase[],
  agentName: string
): string {
  if (!selectedPhrases || selectedPhrases.length === 0) {
    return "";
  }

  // 카테고리별 그룹화
  const phrasesByCategory = selectedPhrases.reduce((acc, p) => {
    if (!acc[p.category]) acc[p.category] = [];
    acc[p.category].push(p);
    return acc;
  }, {} as Record<string, WeightedPhrase[]>);

  const categoryLabels = {
    emphasis: "강조 표현",
    filler: "간투사",
    signature: "시그니처 표현",
    transition: "전환 표현",
  };

  // 프롬프트 텍스트 생성
  let promptText = `\n⚡ **이번 응답에 반드시 포함할 ${agentName}의 특수 구문:**\n`;

  for (const [category, phrases] of Object.entries(phrasesByCategory)) {
    const label = categoryLabels[category as keyof typeof categoryLabels] || category;
    promptText += `- ${label}: ${phrases.map((p) => `"${p.phrase}"`).join(", ")}\n`;
  }

  promptText += "\n⚠️ 위 표현을 자연스럽게 대화에 녹여 사용하세요.";

  return promptText;
}

/**
 * 가중치 포함 표현을 사용하여 프롬프트에 주입할 텍스트를 생성합니다.
 * @param weightedPhrases 가중치 포함 표현 목록
 * @param recentUsed 최근 사용한 표현들
 * @param count 선택할 표현 개수
 * @returns 프롬프트에 주입할 텍스트
 */
export function generatePhrasePromptInjection(
  weightedPhrases: WeightedPhrase[],
  recentUsed: string[] = [],
  count: number = 3
): string {
  if (!weightedPhrases || weightedPhrases.length === 0) {
    return "";
  }

  // 표현 선택
  const selectedPhrases = selectWeightedPhrases(
    weightedPhrases,
    recentUsed,
    count
  );

  if (selectedPhrases.length === 0) {
    return "";
  }

  // 선택된 표현을 포맷하여 반환
  return formatSelectedPhrasesForPrompt(selectedPhrases, "");
}
