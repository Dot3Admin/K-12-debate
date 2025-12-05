import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { storage } from './storage';

async function extractTextFromFile(filePath: string, mimeType: string): Promise<string | null> {
  try {
    console.log(`텍스트 추출 시작: ${filePath}`);
    
    if (mimeType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') || 
        mimeType.includes('application/msword')) {
      // DOCX 파일 처리
      const result = await mammoth.extractRawText({ path: filePath });
      const cleanText = result.value
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
        .replace(/\uFFFD/g, '')
        .trim();
        
      console.log(`DOCX 추출 완료: ${cleanText.length} characters`);
      return cleanText.length > 20 ? cleanText : null;
    }
    
    if (mimeType.includes('text/plain')) {
      // TXT 파일 처리
      const textContent = fs.readFileSync(filePath, 'utf-8');
      const cleanText = textContent
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
        .replace(/\uFFFD/g, '')
        .trim();
        
      console.log(`TXT 추출 완료: ${cleanText.length} characters`);
      return cleanText.length > 20 ? cleanText : null;
    }
    
    return null;
  } catch (error) {
    console.error(`텍스트 추출 실패 (${filePath}):`, error);
    return null;
  }
}

async function fixAllDocuments() {
  try {
    console.log('문서 텍스트 추출 수정 시작...');
    
    // 모든 문서 가져오기
    const documents = await storage.getAllDocuments();
    console.log(`총 ${documents.length}개 문서를 검사합니다.`);
    
    let fixedCount = 0;
    
    for (const doc of documents) {
      // 에러 메시지가 포함된 문서만 수정
      if (doc.content && doc.content.includes('추출 중 오류가 발생했습니다')) {
        console.log(`수정 대상: ${doc.originalName} (ID: ${doc.id})`);
        
        // 파일 경로 구성
        const filePath = path.join('uploads', 'admin', doc.filename);
        
        if (fs.existsSync(filePath)) {
          const extractedText = await extractTextFromFile(filePath, doc.mimeType);
          
          if (extractedText) {
            // 문서 업데이트
            await storage.updateDocument(doc.id, { content: extractedText });
            fixedCount++;
            console.log(`✓ 수정 완료: ${doc.originalName} (${extractedText.length} chars)`);
          } else {
            console.log(`✗ 텍스트 추출 실패: ${doc.originalName}`);
          }
        } else {
          console.log(`✗ 파일이 존재하지 않음: ${filePath}`);
        }
      }
    }
    
    console.log(`\n수정 완료: ${fixedCount}개 문서`);
    
  } catch (error) {
    console.error('문서 수정 중 오류:', error);
  }
}

// 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  fixAllDocuments();
}

export { fixAllDocuments };