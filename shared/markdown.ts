/**
 * 단일 라인 마크다운 표를 다중 라인 GFM 표로 변환
 */
export function preprocessMarkdownTables(content: string): string {
  if (!content || !content.includes('|')) {
    return content;
  }

  console.log('[📋 표 전처리 시작]');
  
  // 표 패턴 찾기: 연속된 파이프 블록
  // 최소 3개 이상의 파이프와 구분선(---)을 포함
  const tableRegex = /(\|[^|\n]*\|[^|\n]*\|[^|\n]*\|[-–—|]*)/g;
  
  let result = content;
  let replaced = false;
  
  const matches = content.match(tableRegex);
  if (!matches || matches.length === 0) {
    console.log('[📋 표 전처리] 표 패턴 없음');
    return content;
  }
  
  console.log(`[📋 표 전처리] ${matches.length}개 표 후보 발견`);
  
  // 각 매치에 대해 변환 시도
  for (const tableCandidate of matches) {
    const normalized = normalizeTable(tableCandidate);
    if (normalized && normalized !== tableCandidate) {
      result = result.replace(tableCandidate, '\n\n' + normalized + '\n\n');
      replaced = true;
      console.log('[📋 표 전처리 성공] 표 변환 완료');
    }
  }
  
  if (!replaced) {
    console.log('[📋 표 전처리] 변환 실패 - 유효한 표 없음');
  }
  
  return result;
}

/**
 * 단일 표 블록을 다중 라인 GFM으로 변환
 */
function normalizeTable(tableText: string): string | null {
  // 모든 파이프로 셀 추출
  const cells = tableText.split('|').map(c => c.trim()).filter(c => c.length > 0);
  
  if (cells.length === 0) {
    return null;
  }
  
  // 구분선 찾기
  let separatorIdx = -1;
  for (let i = 0; i < cells.length; i++) {
    if (/^[-–—]+$/.test(cells[i])) {
      separatorIdx = i;
      break;
    }
  }
  
  if (separatorIdx === -1 || separatorIdx === 0) {
    return null;
  }
  
  const colCount = separatorIdx;
  
  // 헤더
  const header = cells.slice(0, colCount);
  
  // 구분선
  const separators = Array(colCount).fill('---');
  
  // 데이터 행
  const dataStartIdx = separatorIdx + colCount;
  const dataRows: string[][] = [];
  
  for (let i = dataStartIdx; i < cells.length; i += colCount) {
    const row: string[] = [];
    for (let j = 0; j < colCount && i + j < cells.length; j++) {
      row.push(cells[i + j]);
    }
    if (row.length === colCount) {
      dataRows.push(row);
    }
  }
  
  if (dataRows.length === 0) {
    return null;
  }
  
  // 표 생성
  const lines: string[] = [];
  lines.push('| ' + header.join(' | ') + ' |');
  lines.push('| ' + separators.join(' | ') + ' |');
  dataRows.forEach(row => {
    lines.push('| ' + row.join(' | ') + ' |');
  });
  
  return lines.join('\n');
}

/**
 * 텍스트에서 표를 추출하고 정규화
 * 
 * 핵심: 단일 라인 표를 다중 라인 GFM으로 변환
 * 입력: "| A | B | |---|---| | C | D |"
 * 출력: "| A | B |\n|---|---|\n| C | D |"
 */
function extractAndNormalizeTables(text: string): string | null {
  if (!text || !text.includes('|')) {
    return null;
  }
  
  // Step 1: 모든 셀을 파싱 (| 기준으로 분리)
  const cells = text.split('|')
    .map(c => c.trim())
    .filter(c => c.length > 0);
  
  if (cells.length === 0) {
    return null;
  }
  
  // Step 2: 구분선 찾기 (---로만 구성된 셀)
  let separatorIdx = -1;
  for (let i = 0; i < cells.length; i++) {
    if (/^[-–—]+$/.test(cells[i])) {
      separatorIdx = i;
      break;
    }
  }
  
  if (separatorIdx === -1) {
    return null; // 표가 아님
  }
  
  // Step 3: 열 개수 파악 (헤더 셀 개수)
  const colCount = separatorIdx;
  
  if (colCount === 0) {
    return null;
  }
  
  // Step 4: 헤더 행
  const header = cells.slice(0, colCount);
  
  // Step 5: 구분선 행 (colCount만큼의 --- 셀)
  const separators: string[] = [];
  for (let i = 0; i < colCount; i++) {
    if (separatorIdx + i < cells.length && /^[-–—]+$/.test(cells[separatorIdx + i])) {
      separators.push(cells[separatorIdx + i]);
    } else {
      separators.push('---');
    }
  }
  
  // Step 6: 데이터 행들 (구분선 다음부터)
  const dataStartIdx = separatorIdx + colCount;
  const dataRows: string[][] = [];
  
  for (let i = dataStartIdx; i < cells.length; i += colCount) {
    const row: string[] = [];
    for (let j = 0; j < colCount && i + j < cells.length; j++) {
      row.push(cells[i + j]);
    }
    if (row.length === colCount) {
      dataRows.push(row);
    }
  }
  
  // Step 7: 결과 생성
  const result: string[] = [];
  result.push('| ' + header.join(' | ') + ' |');
  result.push('| ' + separators.join(' | ') + ' |');
  dataRows.forEach(row => {
    result.push('| ' + row.join(' | ') + ' |');
  });
  
  return result.join('\n');
}
