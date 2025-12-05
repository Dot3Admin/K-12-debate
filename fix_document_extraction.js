import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

// Memory storage를 불러와서 문서 정보 업데이트
const memoryStoragePath = './data/memory-storage.json';

async function extractTextFromFile(filePath, mimeType) {
  try {
    console.log(`Extracting text from: ${filePath}`);
    
    if (mimeType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') || 
        mimeType.includes('application/msword')) {
      // DOCX 파일 처리
      const result = await mammoth.extractRawText({ path: filePath });
      const cleanText = result.value
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
        .replace(/\uFFFD/g, '')
        .trim();
        
      console.log(`DOCX 추출 완료: ${cleanText.length} characters`);
      return cleanText;
    }
    
    if (mimeType.includes('application/pdf')) {
      // PDF 파일 처리
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      const cleanText = data.text
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
        .replace(/\uFFFD/g, '')
        .trim();
        
      console.log(`PDF 추출 완료: ${cleanText.length} characters`);
      return cleanText;
    }
    
    if (mimeType.includes('text/plain')) {
      const text = fs.readFileSync(filePath, 'utf-8');
      console.log(`TXT 추출 완료: ${text.length} characters`);
      return text;
    }
    
    console.log(`지원되지 않는 파일 타입: ${mimeType}`);
    return null;
  } catch (error) {
    console.error(`텍스트 추출 실패 (${filePath}):`, error.message);
    return null;
  }
}

async function fixDocumentExtraction() {
  try {
    // 메모리 스토리지 로드
    if (!fs.existsSync(memoryStoragePath)) {
      console.log('Memory storage 파일이 없습니다.');
      return;
    }
    
    const storageData = JSON.parse(fs.readFileSync(memoryStoragePath, 'utf-8'));
    
    if (!storageData.documents) {
      console.log('문서 데이터가 없습니다.');
      return;
    }
    
    console.log(`총 ${storageData.documents.length}개 문서를 처리합니다.`);
    
    let updatedCount = 0;
    
    for (const doc of storageData.documents) {
      // 파일 경로 구성
      const filePath = path.join('uploads', 'admin', doc.filename);
      
      if (!fs.existsSync(filePath)) {
        console.log(`파일이 존재하지 않음: ${filePath}`);
        continue;
      }
      
      // 현재 content가 에러 메시지인 경우에만 다시 추출
      if (doc.content && doc.content.includes('추출 중 오류가 발생했습니다')) {
        console.log(`재추출 대상: ${doc.originalName}`);
        
        const extractedText = await extractTextFromFile(filePath, doc.mimeType);
        
        if (extractedText && extractedText.length > 50) {
          doc.content = extractedText;
          updatedCount++;
          console.log(`✓ 성공적으로 텍스트 추출: ${doc.originalName} (${extractedText.length} chars)`);
        } else {
          console.log(`✗ 텍스트 추출 실패: ${doc.originalName}`);
        }
      }
    }
    
    if (updatedCount > 0) {
      // 업데이트된 데이터 저장
      fs.writeFileSync(memoryStoragePath, JSON.stringify(storageData, null, 2));
      console.log(`\n${updatedCount}개 문서의 텍스트 추출이 완료되었습니다.`);
    } else {
      console.log('\n업데이트할 문서가 없습니다.');
    }
    
  } catch (error) {
    console.error('문서 추출 수정 중 오류:', error);
  }
}

// 실행
fixDocumentExtraction();