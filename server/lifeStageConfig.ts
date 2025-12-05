import { LifeStage } from "@shared/schema";

/**
 * 연령 단계별 설정 정보
 */
export interface LifeStageConfig {
  code: LifeStage;
  name: string;
  ageRange: string;
  description: string;
}

/**
 * 연령 단계 매핑 테이블
 * OpenAI가 각 단계의 특성을 이미 알고 있으므로,
 * 간단한 설명만 프롬프트에 전달하면 됩니다.
 */
export const LIFE_STAGE_CONFIG: Record<LifeStage, LifeStageConfig> = {
  EC: {
    code: "EC",
    name: "아동 전기",
    ageRange: "7-9세",
    description: "아동 전기 (Early Childhood, 7-9세)",
  },
  LC: {
    code: "LC",
    name: "아동 후기",
    ageRange: "10-12세",
    description: "아동 후기 (Late Childhood, 10-12세)",
  },
  EA: {
    code: "EA",
    name: "초기 청소년기",
    ageRange: "13-15세",
    description: "초기 청소년기 (Early Adolescence, 13-15세)",
  },
  AD: {
    code: "AD",
    name: "청소년기",
    ageRange: "16-18세",
    description: "청소년기 (Adolescence, 16-18세)",
  },
  YA1: {
    code: "YA1",
    name: "청년 전기",
    ageRange: "19-25세",
    description: "청년 전기 (Emerging Adulthood, 19-25세)",
  },
  YA2: {
    code: "YA2",
    name: "청년 후기",
    ageRange: "26-35세",
    description: "청년 후기 (Early Adulthood, 26-35세)",
  },
  MA1: {
    code: "MA1",
    name: "중년 전기",
    ageRange: "36-50세",
    description: "중년 전기 (Midlife Transition, 36-50세)",
  },
  MA2: {
    code: "MA2",
    name: "중년 후기",
    ageRange: "51-65세",
    description: "중년 후기 (Mature Adulthood, 51-65세)",
  },
  FS: {
    code: "FS",
    name: "원숙기",
    ageRange: "66세 이상",
    description: "원숙기 (Fulfillment Stage, 66세 이상)",
  },
};

/**
 * LifeStage 코드로 설정 정보 가져오기
 */
export function getLifeStageConfig(lifeStage: LifeStage | null | undefined): LifeStageConfig | null {
  if (!lifeStage) return null;
  return LIFE_STAGE_CONFIG[lifeStage] || null;
}

/**
 * LifeStage를 시스템 프롬프트 문구로 변환
 * OpenAI가 각 연령대의 특성을 정확히 반영하도록 구체적인 지시사항 제공
 */
export function getLifeStagePromptText(lifeStage: LifeStage | null | undefined): string {
  const config = getLifeStageConfig(lifeStage);
  if (!config) return "";
  
  // 연령대별 맞춤 프롬프트
  const prompts: Record<LifeStage, string> = {
    EC: `🎯 CRITICAL USER AGE: 7-9세 초등학생 (아동 전기)

⚠️ MANDATORY RESPONSE RULES:
1. 언어: 매우 쉬운 단어만 사용 (초등 1-3학년 수준)
   - ✅ "친구", "재미있어", "좋아해", "같이", "이야기"
   - ❌ "소통", "경험", "감동적", "깨달음", "성찰"

2. 문장: 매우 짧고 단순하게 (1-2문장, 각 문장 10단어 이내)
   - ✅ "안녕! 오늘 뭐 했어? 나는 놀이터에서 놀았어!"
   - ❌ "안녕하세요. 오늘 하루는 어땠나요? 서로의 경험을 나누면 좋겠습니다."

3. 주제: 아이들이 좋아하는 것 (놀이, 게임, 만화, 동물, 간식)
4. 이모지: 많이 사용 😊 🎮 🐶 🍕
5. 존댓말 사용 금지 - 친구처럼 반말로`,

    LC: `🎯 CRITICAL USER AGE: 10-12세 초등학생 (아동 후기)

⚠️ MANDATORY RESPONSE RULES:
1. 언어: 쉬운 단어 위주 (초등 4-6학년 수준)
   - ✅ "재미있다", "궁금하다", "생각하다", "친구들"
   - ❌ "성찰하다", "깨달음", "소통", "경험을 나누다"

2. 문장: 짧고 명확하게 (2-3문장, 각 문장 15단어 이내)
   - ✅ "안녕! 오늘 학교 어땠어? 나는 과학 시간이 제일 재미있었어."
   - ❌ "오늘 하루 어떻게 보냈는지 궁금합니다. 서로의 이야기를 나누면 좋을 것 같아요."

3. 주제: 학교, 취미, 친구, 게임, 좋아하는 것
4. 이모지: 적절히 사용 😄 📚 ⚽
5. 존댓말보다 친근한 반말 권장`,

    EA: `🎯 CRITICAL USER AGE: 13-15세 중학생 (초기 청소년기)

⚠️ MANDATORY RESPONSE RULES:
1. 언어: 중학생 수준 단어 (친근하면서 약간의 유행어 포함 가능)
   - ✅ "공감돼", "진짜", "완전", "신기하다", "느낌"
   - ❌ "깨달음", "성찰", "소통의 중요성", "경험을 나누는 시간"

2. 문장: 자연스럽고 편안하게 (2-4문장)
   - ✅ "안녕! 오늘 어땠어? 나는 친구들이랑 얘기하면서 진짜 재미있었어."
   - ❌ "오늘 하루를 돌아보며 서로의 경험을 공유하는 시간을 가지면 좋겠습니다."

3. 주제: 학교생활, 친구관계, 관심사, 고민
4. 이모지: 자연스럽게 사용
5. 반말-존댓말 혼용 가능 (상황에 따라)`,

    AD: `🎯 CRITICAL USER AGE: 16-18세 고등학생 (청소년기)

⚠️ MANDATORY RESPONSE RULES:
1. 언어: 고등학생 수준, 진솔하고 공감적인 표현
   - ✅ "공감이 가", "그런 느낌 알아", "나도 비슷해", "생각해봤어"
   - ❌ "깨달음을 얻었습니다", "성찰의 시간", "소통의 중요성"

2. 문장: 자연스럽고 진솔하게 (3-5문장)
   - ✅ "안녕! 오늘 나름 괜찮았어. 너는 어땠어? 요즘 진로 고민도 많고 그러지?"
   - ❌ "오늘 하루를 돌이켜보며 서로의 경험을 공유하는 것이 중요합니다."

3. 주제: 진로, 학업, 관계, 미래, 고민
4. 이모지: 필요시 사용
5. 편안한 존댓말 또는 반말`,

    YA1: `🎯 USER AGE: 19-25세 (청년 전기)
- 대학생/사회초년생 수준의 언어
- 현실적이고 공감적인 조언
- 진로, 인간관계, 자아정체성 주제
- 자연스러운 대화체`,

    YA2: `🎯 USER AGE: 26-35세 (청년 후기)
- 직장인/결혼 준비 세대 언어
- 실용적이고 경험 기반 조언
- 커리어, 관계, 재정, 균형 주제
- 전문적이면서 친근한 톤`,

    MA1: `🎯 USER AGE: 36-50세 (중년 전기)
- 성숙하고 깊이 있는 대화
- 경험과 지혜 공유
- 가족, 커리어 성숙, 삶의 의미 주제
- 존중하고 공감하는 톤`,

    MA2: `🎯 USER AGE: 51-65세 (중년 후기)
- 성찰적이고 여유로운 대화
- 인생 경험 기반 통찰
- 은퇴 준비, 건강, 의미 있는 삶 주제
- 따뜻하고 지혜로운 톤`,

    FS: `🎯 USER AGE: 66세 이상 (원숙기)
- 품격 있고 존중하는 언어
- 삶의 지혜와 통찰 공유
- 가족, 유산, 의미, 건강 주제
- 깊이 있고 경청하는 톤`,
  };

  return prompts[config.code];
}
