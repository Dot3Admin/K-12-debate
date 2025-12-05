export function safeParseJSON<T = any>(llmOutput: string): T | null {
  if (!llmOutput || typeof llmOutput !== 'string') {
    return null;
  }

  try {
    // 1. 순수 JSON 파싱 시도
    return JSON.parse(llmOutput);
  } catch (e) {
    // 2. 마크다운 코드 블록 제거 (```json ... ```)
    let cleanJson = llmOutput
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    
    // 3. 앞뒤 공백 및 개행 제거
    cleanJson = cleanJson.replace(/^\s+|\s+$/g, '');
    
    try {
      return JSON.parse(cleanJson);
    } catch (e2) {
      console.error("[❌ JSON 파싱 최종 실패]", {
        originalLength: llmOutput.length,
        cleanedLength: cleanJson.length,
        sample: llmOutput.substring(0, 200)
      });
      return null;
    }
  }
}
