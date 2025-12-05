/**
 * 텍스트 분할 유틸리티
 * 긴 AI 응답을 의미 단위로 분할하여 여러 말풍선으로 표시
 */

/**
 * 분할 타입 정의
 * - paragraph: 단락 변경으로 인한 분할 (이름 표시 O)
 * - length: 길이 초과로 인한 분할 (이름 표시 X)
 * - topic: 주제 변경으로 인한 분할 (이름 표시 O)
 */
export type SplitType = 'paragraph' | 'length' | 'topic';

/**
 * 분할된 메시지 세그먼트
 */
export interface MessageSegment {
  content: string;
  splitType: SplitType;
}

/**
 * 긴 텍스트를 문장 단위로 분할
 * @param text 원본 텍스트
 * @param maxLength 각 메시지의 최대 길이 (기본값: 500)
 * @returns 분할된 메시지 배열
 */
function splitIntoMessages(text: string, maxLength: number = 500): string[] {
  // 문장 단위로 분할 (한글, 영어 모두 지원)
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]+/g) || [text];
  const messages: string[] = [];
  let currentMessage = '';
  
  sentences.forEach(sentence => {
    // 현재 메시지에 추가해도 최대 길이 이하면
    if ((currentMessage + sentence).length <= maxLength) {
      currentMessage += sentence;
    } else {
      // 현재 메시지 저장하고 새로 시작
      if (currentMessage) {
        messages.push(currentMessage.trim());
      }
      currentMessage = sentence;
    }
  });
  
  // 마지막 메시지 추가
  if (currentMessage) {
    messages.push(currentMessage.trim());
  }
  
  return messages;
}

/**
 * 마크다운 표가 포함되어 있는지 확인
 */
function hasMarkdownTable(text: string): boolean {
  // 연속된 2개 이상의 | 로 시작하는 라인이 있으면 표로 간주
  const lines = text.split('\n');
  let tableLineCount = 0;
  for (const line of lines) {
    if (line.trim().startsWith('|')) {
      tableLineCount++;
      if (tableLineCount >= 2) return true;
    } else if (tableLineCount > 0) {
      // 표가 끝났으면 리셋
      tableLineCount = 0;
    }
  }
  return false;
}

/**
 * 스마트 텍스트 분할 (의미 단위로 분할)
 * @param text 원본 텍스트
 * @param maxLength 각 메시지의 최대 길이 (기본값: 500)
 * @returns 분할된 메시지 세그먼트 배열
 */
export function smartSplit(text: string, maxLength: number = 500): MessageSegment[] {
  // 0. 마크다운 표가 포함된 경우 분할하지 않음 (표 구조 보호)
  if (hasMarkdownTable(text)) {
    return [{ content: text, splitType: 'paragraph' }];
  }
  
  // 1. 기존 문단이 있으면 그대로 사용
  if (text.includes('\n\n')) {
    const paragraphs = text.split('\n\n').filter(p => p.trim());
    // 각 문단이 너무 길면 추가 분할
    const result: MessageSegment[] = [];
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      // 문단 내에 표가 있으면 분할하지 않음
      if (hasMarkdownTable(para)) {
        result.push({ content: para, splitType: 'paragraph' });
      } else if (para.length > maxLength) {
        // 문단 내 길이 초과: 첫 번째만 paragraph, 나머지는 length
        const lengthSplits = splitIntoMessages(para, maxLength);
        lengthSplits.forEach((split, idx) => {
          result.push({
            content: split,
            splitType: idx === 0 ? 'paragraph' : 'length'
          });
        });
      } else {
        result.push({ content: para, splitType: 'paragraph' });
      }
    }
    return result;
  }
  
  // 2. 특정 패턴으로 분할 (Lookahead를 사용하여 구분자 유지)
  // Lookahead 패턴은 이미 구분자를 유지하므로 그대로 사용
  const patterns = [
    /(?=\d+\. )/g,           // "1. 첫째, 2. 둘째" 패턴
    /(?=[가-힣]\. )/g,       // "가. 첫째, 나. 둘째" 패턴
    /(?=첫째|둘째|셋째|넷째|다섯째)/g,    // 순서 표현
  ];
  
  for (let pattern of patterns) {
    const splits = text.split(pattern).filter(p => p.trim());
    if (splits.length > 1) {
      // 각 항목이 너무 길면 추가 분할
      const result: MessageSegment[] = [];
      for (let i = 0; i < splits.length; i++) {
        const item = splits[i];
        // 항목 내에 표가 있으면 분할하지 않음
        if (hasMarkdownTable(item)) {
          result.push({ content: item, splitType: 'topic' });
        } else if (item.length > maxLength) {
          // 항목 내 길이 초과: 첫 번째만 topic, 나머지는 length
          const lengthSplits = splitIntoMessages(item, maxLength);
          lengthSplits.forEach((split, idx) => {
            result.push({
              content: split,
              splitType: idx === 0 ? 'topic' : 'length'
            });
          });
        } else {
          result.push({ content: item, splitType: 'topic' });
        }
      }
      return result;
    }
  }
  
  // 3. 길이 기반 분할 (폴백)
  const lengthSplits = splitIntoMessages(text, maxLength);
  return lengthSplits.map((split, idx) => ({
    content: split,
    splitType: idx === 0 ? 'paragraph' : 'length' as SplitType
  }));
}

/**
 * 메시지가 분할이 필요한지 확인
 * @param text 원본 텍스트
 * @param threshold 분할 임계값 (기본값: 500자)
 * @returns 분할 필요 여부
 */
export function shouldSplit(text: string, threshold: number = 500): boolean {
  return text.length > threshold;
}
