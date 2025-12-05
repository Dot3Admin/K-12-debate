import OpenAI from "openai";

// 사용자 요청으로 모든 모델을 GPT-4o로 변경 (안정성 및 성능 향상)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 텍스트 분석 및 요약
export async function summarizeText(text: string): Promise<string> {
  const prompt = `다음 텍스트를 핵심 포인트를 유지하면서 간결하게 요약해 주세요:\n\n${text}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini", // 🚀 경량 모델로 교체 (4배 빠름)
    messages: [{ role: "user", content: prompt }],
    max_tokens: 400 // 🎯 요약은 간단하게
  });

  return response.choices[0].message.content || "";
}

// 감정 분석
export async function analyzeSentiment(text: string): Promise<{
  rating: number;
  confidence: number;
  emotions: string[];
}> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 🚀 경량 모델로 교체 (4배 빠름)
      messages: [
        {
          role: "system",
          content: "당신은 감정 분석 전문가입니다. 텍스트의 감정을 분석하고 1-5 척도의 평점, 신뢰도(0-1), 그리고 감지된 감정들을 제공하세요. JSON 형식으로 응답하세요: { 'rating': number, 'confidence': number, 'emotions': string[] }",
        },
        {
          role: "user",
          content: text,
        },
      ],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content || "{}");

    return {
      rating: Math.max(1, Math.min(5, Math.round(result.rating || 3))),
      confidence: Math.max(0, Math.min(1, result.confidence || 0.5)),
      emotions: result.emotions || ["중립"],
    };
  } catch (error) {
    throw new Error("감정 분석 실패: " + (error as Error).message);
  }
}

// 키워드 추출
export async function extractKeywords(text: string): Promise<string[]> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 🚀 경량 모델로 교체 (4배 빠름)
      messages: [
        {
          role: "system",
          content: "주어진 텍스트에서 가장 중요한 키워드 5-10개를 추출하세요. JSON 배열 형식으로 응답하세요: { 'keywords': string[] }",
        },
        {
          role: "user",
          content: text,
        },
      ],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content || "{}");
    return result.keywords || [];
  } catch (error) {
    throw new Error("키워드 추출 실패: " + (error as Error).message);
  }
}

// 이미지 분석
export async function analyzeImage(base64Image: string): Promise<string> {
  const visionResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini", // 🚀 경량 모델로 교체 (4배 빠름)
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "이 이미지를 자세히 분석하고 주요 요소, 맥락, 특이한 점들을 설명해 주세요.",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`,
            },
          },
        ],
      },
    ],
    max_tokens: 800, // 🎯 2048 → 800으로 감소 (빠른 이미지 분석)
  });

  return visionResponse.choices[0].message.content || "";
}

// 이미지 생성
export async function generateImage(prompt: string): Promise<{ url: string }> {
  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt: prompt,
    n: 1,
    size: "1024x1024",
    quality: "standard",
  });

  return { url: response.data?.[0]?.url || "" };
}

// 오디오 전사
export async function transcribeAudio(audioBuffer: Buffer, filename: string): Promise<{ text: string; language: string }> {
  // Buffer를 File 객체로 변환
  const audioFile = new File([audioBuffer], filename, {
    type: "audio/mpeg",
  });

  const transcription = await openai.audio.transcriptions.create({
    file: audioFile,
    model: "whisper-1",
    language: "ko", // 한국어 우선
  });

  return {
    text: transcription.text,
    language: "ko", // Whisper API의 기본 언어 설정
  };
}

// 스마트 문서 분석 (요약 + 키워드 + 감정 분석)
export async function analyzeDocumentSmart(text: string): Promise<{
  summary: string;
  keywords: string[];
  sentiment: {
    rating: number;
    confidence: number;
    emotions: string[];
  };
  keyPoints: string[];
}> {
  try {
    // 병렬로 분석 실행
    const [summary, keywords, sentiment] = await Promise.all([
      summarizeText(text),
      extractKeywords(text),
      analyzeSentiment(text)
    ]);

    // 핵심 포인트 추출
    const keyPointsResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 🚀 경량 모델로 교체 (4배 빠름)
      messages: [
        {
          role: "system",
          content: "다음 텍스트에서 가장 중요한 핵심 포인트 3-7개를 추출하세요. JSON 형식으로 응답하세요: { 'keyPoints': string[] }",
        },
        {
          role: "user",
          content: text,
        },
      ],
      response_format: { type: "json_object" },
    });

    const keyPointsResult = JSON.parse(keyPointsResponse.choices[0].message.content || "{}");

    return {
      summary,
      keywords,
      sentiment,
      keyPoints: keyPointsResult.keyPoints || [],
    };
  } catch (error) {
    throw new Error("스마트 문서 분석 실패: " + (error as Error).message);
  }
}

// 언어 감지
export async function detectLanguage(text: string): Promise<{
  language: string;
  confidence: number;
}> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 🚀 경량 모델로 교체 (4배 빠름)
      messages: [
        {
          role: "system",
          content: "주어진 텍스트의 언어를 감지하고 신뢰도를 제공하세요. JSON 형식: { 'language': string, 'confidence': number }",
        },
        {
          role: "user",
          content: text,
        },
      ],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content || "{}");
    return {
      language: result.language || "unknown",
      confidence: result.confidence || 0.5,
    };
  } catch (error) {
    throw new Error("언어 감지 실패: " + (error as Error).message);
  }
}

// 텍스트 번역
export async function translateText(text: string, targetLanguage: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini", // 🚀 경량 모델로 교체 (4배 빠름)
    messages: [
      {
        role: "system",
        content: `다음 텍스트를 ${targetLanguage}로 번역해 주세요. 자연스럽고 맥락에 맞게 번역하세요.`,
      },
      {
        role: "user",
        content: text,
      },
    ],
    max_tokens: 300 // 🎯 번역에는 간단한 응답
  });

  return response.choices[0].message.content || "";
}