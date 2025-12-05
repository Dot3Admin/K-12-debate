import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { db } from './db';
import { agentDocumentChunks, documents } from '../shared/schema';
import { eq, inArray, and, or, gt, isNull } from 'drizzle-orm';
import { analyzeDocument, analyzePDFPageImage } from './openai';
import { storage } from './storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ProcessedDocument {
  text: string;
  tables: any[];
  images: any[];
  formulas: any[];
  metadata: any;
}

interface RAGChunk {
  text: string;
  chunk_index: number;
  char_count: number;
  word_count: number;
  keywords: string[];
  metadata: any;
}

export async function processDocument(filePath: string, documentId: number, agentId: number, originalName?: string): Promise<{ success: boolean; chunks?: number; text?: string; analysis?: any; error?: string }> {
  try {
    const startTime = Date.now();
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📄 [문서 처리 시작] ${originalName || path.basename(filePath)}`);
    console.log(`${'='.repeat(80)}\n`);
    
    // Step 1: Extract text and metadata from document
    console.log(`[1/4] 📖 텍스트 추출 시작...`);
    console.log(`  - 파일 경로: ${filePath}`);
    console.log(`  - 원본 파일명: ${originalName || 'Unknown'}`);
    const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    console.log(`  - 파일 크기: ${(fileSize / 1024).toFixed(2)} KB`);
    console.log(`  - 예상 소요 시간: ${fileSize > 1024 * 1024 ? '10-30초' : '5-15초'}`);
    
    const extractStart = Date.now();
    const processedDoc = await extractDocumentContent(filePath, originalName);
    const extractDuration = ((Date.now() - extractStart) / 1000).toFixed(1);
    
    if (!processedDoc || !processedDoc.text) {
      throw new Error('No text content extracted from document');
    }
    
    console.log(`\n  ✅ 텍스트 추출 완료 (${extractDuration}초)`);
    console.log(`  - 추출된 문자 수: ${processedDoc.text.length.toLocaleString()}자`);
    console.log(`  - 단어 수 (추정): ${Math.round(processedDoc.text.split(/\s+/).length).toLocaleString()}개`);
    if (processedDoc.metadata?.total_pages) {
      console.log(`  - 총 페이지 수: ${processedDoc.metadata.total_pages}페이지`);
    }
    if (processedDoc.metadata?.ocr_used) {
      console.log(`  - 🖼️  OCR 사용됨: ${processedDoc.metadata.ocr_pages}개 페이지`);
    }
    
    // Step 2: Analyze document with OpenAI (Text + Vision API if enabled)
    console.log(`\n[2/4] 🤖 OpenAI 분석 시작...`);
    console.log(`  - 분석 대상: ${processedDoc.text.length.toLocaleString()}자`);
    console.log(`  - 예상 토큰 수: ~${Math.round(processedDoc.text.length / 3).toLocaleString()} 토큰`);
    
    const analysisStart = Date.now();
    const analysis = await analyzeDocument(processedDoc.text, originalName || 'document');
    const analysisDuration = ((Date.now() - analysisStart) / 1000).toFixed(1);
    
    console.log(`\n  ✅ OpenAI 텍스트 분석 완료 (${analysisDuration}초)`);
    if (analysis.summary) {
      console.log(`  - 요약 길이: ${analysis.summary.length}자`);
      console.log(`  - 요약 미리보기: ${analysis.summary.substring(0, 80)}...`);
    } else {
      console.log(`  - ⚠️  요약 생성 실패`);
    }
    if (analysis.keyPoints?.length) {
      console.log(`  - 핵심 포인트: ${analysis.keyPoints.length}개 추출됨`);
    }
    
    // Analyze document structure for Vision API recommendation (no automatic execution)
    const isPDF = (originalName || filePath).toLowerCase().endsWith('.pdf');
    console.log(`\n  🔍 문서 구조 분석 중... (다이어그램 감지)`);
    const structureStart = Date.now();
    const visionAnalysis = await analyzeDocumentStructure(processedDoc.text, processedDoc.metadata);
    const structureDuration = ((Date.now() - structureStart) / 1000).toFixed(1);
    console.log(`  ✅ 구조 분석 완료 (${structureDuration}초)`);
    
    if (visionAnalysis.recommendVision) {
      console.log(`  📊 Vision API 권장: 다이어그램 ${visionAnalysis.diagramCount}개 감지`);
      console.log(`  💰 예상 비용: $${visionAnalysis.estimatedCost?.toFixed(4)} (Sharp 최적화 적용시)`);
    } else {
      console.log(`  ℹ️  Vision API 비권장: 텍스트 기반 문서`);
    }
    
    // Step 3: Update document with analysis results (if documentId exists)
    if (documentId > 0) {
      console.log(`\n[3/4] 💾 데이터베이스 업데이트...`);
      await db.update(documents)
        .set({
          description: analysis.summary,
          visionAnalysis: visionAnalysis
        })
        .where(eq(documents.id, documentId));
      console.log(`  ✅ 문서 ${documentId} 업데이트 완료`);
    }
    
    // Step 4: Generate RAG chunks (only if documentId > 0)
    if (documentId > 0) {
      console.log(`\n[4/4] 🔍 RAG 청크 생성 시작...`);
      console.log(`  - 청크 전략: semantic (의미론적 분할)`);
      console.log(`  - 청크 크기 범위: 200-800자`);
      console.log(`  - 예상 청크 수: ~${Math.ceil(processedDoc.text.length / 500)}개 (평균 500자 기준)`);
      
      const chunkStart = Date.now();
      const chunks = await generateRAGChunks(processedDoc);
      const chunkDuration = ((Date.now() - chunkStart) / 1000).toFixed(1);
      
      if (chunks.length === 0) {
        console.error(`\n  ❌ RAG 청크 생성 실패: 청크가 생성되지 않았습니다`);
        throw new Error('RAG chunking failed: no chunks generated');
      }
      
      console.log(`\n  ✅ RAG 청크 생성 완료 (${chunkDuration}초)`);
      console.log(`  - 생성된 청크 수: ${chunks.length}개`);
      console.log(`  - 평균 청크 크기: ${Math.round(processedDoc.text.length / chunks.length)}자`);
      console.log(`  - 총 커버리지: ${processedDoc.text.length.toLocaleString()}자`);
      
      // Add summary and metadata chunks for better search
      console.log(`\n  📝 요약/메타데이터 청크 추가 중...`);
      const metadataChunks: RAGChunk[] = [];
      
      // Add summary chunk if available
      if (analysis.summary) {
        metadataChunks.push({
          text: `[문서 요약: ${originalName || 'document'}]\n${analysis.summary}`,
          chunk_index: -1, // Special index for summary
          char_count: analysis.summary.length,
          word_count: analysis.summary.split(/\s+/).length,
          keywords: ['요약', 'summary', originalName || 'document'].concat(
            analysis.keyPoints?.slice(0, 5) || []
          ),
          metadata: { type: 'summary', filename: originalName }
        });
        console.log(`  - 요약 청크 추가 완료`);
      }
      
      // Add metadata chunk with filename and description
      if (originalName) {
        const metadataText = `[파일 정보]\n파일명: ${originalName}\n` + 
          (analysis.summary ? `설명: ${analysis.summary.substring(0, 200)}...` : '');
        metadataChunks.push({
          text: metadataText,
          chunk_index: -2, // Special index for metadata
          char_count: metadataText.length,
          word_count: metadataText.split(/\s+/).length,
          keywords: [originalName, '파일', 'file', 'document'],
          metadata: { type: 'metadata', filename: originalName }
        });
        console.log(`  - 메타데이터 청크 추가 완료`);
      }
      
      const allChunks = [...metadataChunks, ...chunks];
      console.log(`  ✅ 총 ${allChunks.length}개 청크 (메타: ${metadataChunks.length}, 본문: ${chunks.length})`);
      
      // Step 5: Save chunks to database with embeddings
      console.log(`\n  💾 청크 저장 및 embedding 생성 중...`);
      await saveChunksToDatabase(allChunks, documentId, agentId, originalName);
      console.log(`  ✅ ${allChunks.length}개 청크 저장 완료`);
      
      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ [문서 처리 완료] 총 소요 시간: ${totalDuration}초`);
      console.log(`${'='.repeat(80)}\n`);
      
      return {
        success: true,
        chunks: chunks.length,
        text: processedDoc.text,
        analysis
      };
    } else {
      // If documentId is 0, just return text and analysis without saving
      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ [문서 처리 완료] 총 소요 시간: ${totalDuration}초 (저장 생략)`);
      console.log(`${'='.repeat(80)}\n`);
      
      return {
        success: true,
        text: processedDoc.text,
        analysis
      };
    }
    
  } catch (error) {
    console.error(`\n${'='.repeat(80)}`);
    console.error('❌ [문서 처리 실패]');
    console.error(`${'='.repeat(80)}`);
    console.error('[Document Processor] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function extractDocumentContent(filePath: string, originalName?: string): Promise<ProcessedDocument> {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, 'document_processor', 'extract_document.py');
    
    // Create the Python script if it doesn't exist
    const scriptDir = path.dirname(pythonScript);
    if (!fs.existsSync(scriptDir)) {
      fs.mkdirSync(scriptDir, { recursive: true });
    }
    
    // Create a simple Python script that uses the processors
    const extractScript = `
import sys
import json
import os
sys.path.insert(0, os.path.dirname(__file__))

from processors import get_processor

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)
    
    file_path = sys.argv[1]
    original_name = sys.argv[2] if len(sys.argv) > 2 else None
    
    try:
        processor = get_processor(file_path, original_name)
        result = processor.process(file_path)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
`;
    
    fs.writeFileSync(pythonScript, extractScript);
    
    // Pass original filename if available to help with file type detection
    const args = [pythonScript, filePath];
    if (originalName) {
      args.push(originalName);
    }
    
    const python = spawn('python3', args, {
      env: { ...process.env }
    });
    
    let stdout = '';
    let stderr = '';
    
    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    python.on('close', (code) => {
      if (code !== 0) {
        console.error('[Python] stderr:', stderr);
        reject(new Error(`Python process exited with code ${code}: ${stderr}`));
        return;
      }
      
      try {
        const result = JSON.parse(stdout);
        
        if (result.error) {
          reject(new Error(result.error));
          return;
        }
        
        resolve(result as ProcessedDocument);
      } catch (error) {
        reject(new Error(`Failed to parse Python output: ${error}`));
      }
    });
  });
}

async function generateRAGChunks(processedDoc: ProcessedDocument): Promise<RAGChunk[]> {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, 'document_processor', 'generate_chunks.py');
    
    // Create the RAG generation script - reads from stdin to avoid arg size limits
    const ragScript = `
import sys
import json
import os
sys.path.insert(0, os.path.dirname(__file__))

from generators.rag_generator import RAGGenerator

def main():
    try:
        # Read from stdin instead of command-line args
        input_data = sys.stdin.read()
        processed_doc = json.loads(input_data)
        
        generator = RAGGenerator(chunking_strategy='semantic', min_chunk_size=200, max_chunk_size=500)
        chunks = generator.generate_chunks(processed_doc)
        print(json.dumps(chunks, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
`;
    
    fs.writeFileSync(pythonScript, ragScript);
    
    // Spawn without args, will pipe to stdin
    const python = spawn('python3', [pythonScript], {
      env: { ...process.env }
    });
    
    let stdout = '';
    let stderr = '';
    
    // Pipe the JSON to stdin to avoid OS arg size limits
    python.stdin.write(JSON.stringify(processedDoc));
    python.stdin.end();
    
    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    python.on('close', (code) => {
      if (code !== 0) {
        console.error('[Python RAG] stderr:', stderr);
        reject(new Error(`Python RAG process exited with code ${code}: ${stderr}`));
        return;
      }
      
      try {
        const chunks = JSON.parse(stdout);
        
        if (chunks.error) {
          reject(new Error(chunks.error));
          return;
        }
        
        resolve(chunks as RAGChunk[]);
      } catch (error) {
        reject(new Error(`Failed to parse Python RAG output: ${error}`));
      }
    });
  });
}

// Vision API: PDF 시각적 콘텐츠 분석
export async function analyzeVisualContent(
  pdfPath: string, 
  originalName?: string,
  options: {
    userId?: string;
    agentId?: number;
    documentId?: number;
  } = {}
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, 'document_processor', 'pdf_to_image.py');
    
    // PDF를 이미지로 변환하는 Python 스크립트 (PyMuPDF 사용 - 이미 설치됨)
    const pdfToImageScript = `
import sys
import json
import os
import fitz  # PyMuPDF

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No PDF path provided"}))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    
    try:
        # PyMuPDF로 PDF 열기
        doc = fitz.open(pdf_path)
        
        if len(doc) == 0:
            print(json.dumps({"error": "PDF has no pages"}))
            sys.exit(1)
        
        # 첫 페이지만 이미지로 변환 (비용 절감)
        page = doc[0]
        
        # 페이지를 이미지로 렌더링 (150 DPI)
        zoom = 150 / 72  # 72 DPI가 기본값
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        
        # 임시 이미지 파일로 저장
        temp_dir = os.path.dirname(pdf_path)
        image_path = os.path.join(temp_dir, "temp_vision_page_1.png")
        pix.save(image_path)
        
        doc.close()
        
        print(json.dumps({"success": True, "image_path": image_path}))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
`;
    
    fs.writeFileSync(pythonScript, pdfToImageScript);
    
    const python = spawn('python3', [pythonScript, pdfPath]);
    
    let stdout = '';
    let stderr = '';
    
    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    python.on('close', async (code) => {
      if (code !== 0) {
        console.error('[PDF to Image] stderr:', stderr);
        reject(new Error(`PDF to image conversion failed: ${stderr}`));
        return;
      }
      
      try {
        const result = JSON.parse(stdout);
        
        if (result.error) {
          reject(new Error(result.error));
          return;
        }
        
        // Vision API로 이미지 분석
        const imagePath = result.image_path;
        
        try {
          // 노선도/지도로 추정하여 분석
          const visionAnalysis = await analyzePDFPageImage(imagePath, 1, "map", {
            userId: options.userId,
            agentId: options.agentId,
            documentId: options.documentId
          });
          
          // 임시 이미지 파일 삭제
          try {
            fs.unlinkSync(imagePath);
          } catch (cleanupError) {
            console.error('[Vision API] Failed to cleanup temp image:', cleanupError);
          }
          
          resolve(visionAnalysis);
        } catch (visionError) {
          // Vision API 실패 시 임시 파일 정리
          try {
            fs.unlinkSync(imagePath);
          } catch (cleanupError) {
            // Ignore cleanup errors
          }
          reject(visionError);
        }
        
      } catch (error) {
        reject(new Error(`Failed to parse PDF to image output: ${error}`));
      }
    });
  });
}

// Vision API: PPT/PPTX 시각적 콘텐츠 분석
export async function analyzePPTXVisualContent(
  pptPath: string,
  originalName?: string,
  options: {
    userId?: string;
    agentId?: number;
    documentId?: number;
  } = {}
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const fileExtension = path.extname(originalName || '').toLowerCase();
    console.log(`[Vision PPT] Converting ${fileExtension} to images: ${originalName}`);
    
    // PPT/PPTX → PDF → 이미지 변환 (LibreOffice 사용)
    const tempDir = path.dirname(pptPath);
    
    // Step 1: PPT/PPTX → PDF (LibreOffice)
    // LibreOffice supports both .ppt and .pptx formats
    const libreofficeCmd = `libreoffice --headless --convert-to pdf --outdir "${tempDir}" "${pptPath}"`;
    
    let execProcess: any;
    let hasTimedOut = false;
    
    // Timeout for LibreOffice conversion (30 seconds)
    const conversionTimeout = setTimeout(() => {
      hasTimedOut = true;
      console.error('[Vision PPT] LibreOffice conversion timeout');
      if (execProcess) {
        execProcess.kill('SIGTERM');
      }
      reject(new Error('LibreOffice conversion timeout (30s). Please try again.'));
    }, 30000);
    
    execProcess = exec(libreofficeCmd, async (error, stdout, stderr) => {
      clearTimeout(conversionTimeout);
      
      // If already timed out, ignore the callback
      if (hasTimedOut) {
        return;
      }
      
      if (error) {
        console.error('[Vision PPT] LibreOffice conversion failed:', error);
        reject(new Error(`PPT/PPTX to PDF conversion failed: ${error.message}. LibreOffice may not be available.`));
        return;
      }
      
      console.log('[Vision PPT] PPT/PPTX → PDF conversion successful');
      
      // Step 2: PDF → 이미지 (pdf2image Python)
      const pythonScript = path.join(__dirname, 'document_processor', 'pdf_to_image_ppt.py');
      
      const pdfToImageScript = `
import sys
import json
import os
from pdf2image import convert_from_path

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No PDF path provided"}))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    
    try:
        # PDF를 이미지로 변환 (첫 페이지만)
        images = convert_from_path(pdf_path, dpi=150, first_page=1, last_page=1)
        
        if len(images) == 0:
            print(json.dumps({"error": "No pages found"}))
            sys.exit(1)
        
        # 임시 이미지 파일로 저장
        temp_dir = os.path.dirname(pdf_path)
        image_path = os.path.join(temp_dir, "temp_vision_ppt_slide_1.png")
        images[0].save(image_path, 'PNG')
        
        print(json.dumps({"success": True, "image_path": image_path}))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
`;
      
      fs.writeFileSync(pythonScript, pdfToImageScript);
      
      // Find the converted PDF file (LibreOffice names it based on original file)
      const baseFilename = path.basename(pptPath, path.extname(pptPath));
      const convertedPdfPath = path.join(tempDir, `${baseFilename}.pdf`);
      
      if (!fs.existsSync(convertedPdfPath)) {
        reject(new Error('LibreOffice conversion succeeded but output PDF not found. Check file permissions.'));
        return;
      }
      
      const python = spawn('python3', [pythonScript, convertedPdfPath]);
      
      let pythonStdout = '';
      let pythonStderr = '';
      
      python.stdout.on('data', (data) => {
        pythonStdout += data.toString();
      });
      
      python.stderr.on('data', (data) => {
        pythonStderr += data.toString();
      });
      
      python.on('close', async (code) => {
        // Cleanup converted PDF
        try {
          fs.unlinkSync(convertedPdfPath);
        } catch (e) {
          console.error('[Vision PPT] Failed to cleanup converted PDF:', e);
        }
        
        if (code !== 0) {
          console.error('[Vision PPT] PDF to image conversion failed:', pythonStderr);
          reject(new Error(`PDF to image conversion failed: ${pythonStderr}`));
          return;
        }
        
        try {
          const result = JSON.parse(pythonStdout);
          
          if (result.error) {
            reject(new Error(result.error));
            return;
          }
          
          // Vision API로 이미지 분석
          const imagePath = result.image_path;
          
          try {
            const visionAnalysis = await analyzePDFPageImage(imagePath, 1, "general", {
              userId: options.userId,
              agentId: options.agentId,
              documentId: options.documentId
            });
            
            // 임시 이미지 파일 삭제
            try {
              fs.unlinkSync(imagePath);
            } catch (cleanupError) {
              console.error('[Vision PPT] Failed to cleanup temp image:', cleanupError);
            }
            
            console.log('[Vision PPT] Analysis completed successfully');
            resolve(visionAnalysis);
          } catch (visionError) {
            // Vision API 실패 시 임시 파일 정리
            try {
              fs.unlinkSync(imagePath);
            } catch (cleanupError) {
              // Ignore cleanup errors
            }
            reject(visionError);
          }
          
        } catch (error) {
          reject(new Error(`Failed to parse PDF to image output: ${error}`));
        }
      });
    });
  });
}

// Vision API: 이미지 파일 직접 분석
export async function analyzeImageFile(
  imagePath: string,
  originalName?: string,
  options: {
    userId?: string;
    agentId?: number;
    documentId?: number;
  } = {}
): Promise<string | null> {
  console.log(`[Vision Image] Analyzing image file: ${originalName}`);
  
  try {
    const visionAnalysis = await analyzePDFPageImage(imagePath, 1, "general", {
      userId: options.userId,
      agentId: options.agentId,
      documentId: options.documentId
    });
    
    console.log('[Vision Image] Analysis completed successfully');
    return visionAnalysis;
  } catch (error) {
    console.error('[Vision Image] Analysis failed:', error);
    throw error;
  }
}

// Vision API: Grid 응답을 파싱하여 페이지별로 매핑
function parseVisionGridResult(
  visionResult: string,
  mapping: Array<{ number: number; page: number; caption: string }>
): Map<number, string> {
  const pageDescriptions = new Map<number, string>();
  
  // 정규식으로 #번호: 설명 패턴 추출
  const pattern = /#(\d+):\s*([^#]+)/g;
  let match;
  
  while ((match = pattern.exec(visionResult)) !== null) {
    const imageNumber = parseInt(match[1], 10);
    const description = match[2].trim();
    
    // 매핑에서 해당 번호의 페이지 찾기
    const mappingEntry = mapping.find(m => m.number === imageNumber);
    if (mappingEntry) {
      const page = mappingEntry.page;
      const caption = mappingEntry.caption;
      
      // 캡션 정보 추가
      const fullDescription = caption 
        ? `[이미지 설명]\n캡션: ${caption}\n내용: ${description}`
        : `[이미지 설명]\n${description}`;
      
      // 같은 페이지에 여러 이미지가 있을 수 있으므로 누적
      if (pageDescriptions.has(page)) {
        const existing = pageDescriptions.get(page)!;
        pageDescriptions.set(page, `${existing}\n\n${fullDescription}`);
      } else {
        pageDescriptions.set(page, fullDescription);
      }
    }
  }
  
  console.log(`[Vision Grid Parser] Parsed ${pageDescriptions.size} pages with image descriptions`);
  return pageDescriptions;
}

// Helper: Grid 생성 및 Vision API 분석 (PPTX/PDF 공통)
async function processImagesWithGrid(
  extractedImages: any[],
  imageOutputDir: string,
  tempDir: string,
  options: {
    userId?: string;
    agentId?: number;
    documentId?: number;
    onProgress?: (step: string, details?: any) => void;
    isPPT?: boolean;
    convertedFilePath?: string;
  }
): Promise<{ success: boolean; visionResult?: string; pageDescriptions?: Record<number, string>; pageMapping?: any[]; error?: string }> {
  const { onProgress } = options;
  
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`[Vision Grid] Processing ${extractedImages.length} images with Grid...`);
      onProgress?.('extracted', { 
        message: `✅ 1단계: 이미지 추출 완료 (${extractedImages.length}개)`,
        totalImages: extractedImages.length,
        currentStep: 1,
        totalSteps: 4
      });
      
      // Step 2: Create image grid
      console.log('[Vision Grid] Step 2: Creating image grid...');
      onProgress?.('creating_grid', { 
        message: '⏳ 2단계: Grid 이미지 생성 중...',
        currentStep: 2,
        totalSteps: 4
      });
      
      const gridScript = path.join(__dirname, 'vision_processor', 'create_image_grid.py');
      const gridOutputPath = path.join(tempDir, `grid_${Date.now()}.png`);
      
      const imagePaths = extractedImages.map((img: any) => img.path);
      const imagePathsJson = JSON.stringify(imagePaths);
      const metadataJson = JSON.stringify(extractedImages);
      
      const gridPython = spawn('python3', [gridScript, imagePathsJson, gridOutputPath, metadataJson]);
      
      let gridStdout = '';
      let gridStderr = '';
      
      gridPython.stdout.on('data', (data) => {
        gridStdout += data.toString();
      });
      
      gridPython.stderr.on('data', (data) => {
        gridStderr += data.toString();
      });
      
      gridPython.on('close', async (gridCode) => {
        if (gridCode !== 0) {
          console.error('[Vision Grid] Grid creation failed:', gridStderr);
          
          // Cleanup extracted images
          try {
            fs.rmSync(imageOutputDir, { recursive: true, force: true });
          } catch (e) {}
          
          reject(new Error(`Grid creation failed: ${gridStderr}`));
          return;
        }
        
        try {
          const gridResult = JSON.parse(gridStdout);
          
          if (!gridResult.success) {
            throw new Error(gridResult.error || 'Grid creation failed');
          }
          
          console.log(`[Vision Grid] Grid created: ${gridResult.grid_size[0]}x${gridResult.grid_size[1]}px`);
          console.log(`[Vision Grid] Grid layout: ${gridResult.rows}×${gridResult.cols} (${gridResult.mapping.length} images)`);
          
          // Log skipped images if any
          if (gridResult.skipped_images && gridResult.skipped_images.length > 0) {
            console.log(`[Vision Grid] ⚠️  Skipped ${gridResult.skipped_images.length} unsupported images (WMF/EMF/etc):`);
            gridResult.skipped_images.forEach((skipped: string) => {
              console.log(`  - ${skipped}`);
            });
          }
          
          onProgress?.('grid_created', {
            message: `✅ 2단계: Grid 생성 완료 (${gridResult.rows}×${gridResult.cols}, ${gridResult.mapping.length}개 이미지)`,
            gridSize: gridResult.grid_size,
            validImages: gridResult.mapping.length,
            skippedImages: gridResult.skipped_images?.length || 0,
            currentStep: 2,
            totalSteps: 4
          });
          
          // Step 3: Call Vision API with grid image
          console.log('[Vision Grid] Step 3: Analyzing grid with Vision API...');
          onProgress?.('analyzing', { 
            message: '⏳ 3단계: Vision API 분석 중... (약 20~30초 소요)',
            currentStep: 3,
            totalSteps: 4
          });
          
          // Import analyzeImageGridWithVision function
          const { analyzeImageGridWithVision } = await import('./openai');
          
          const visionResult = await analyzeImageGridWithVision(
            gridResult.grid_path,
            gridResult.mapping,
            {
              userId: options.userId,
              agentId: options.agentId,
              documentId: options.documentId
            }
          );
          
          console.log('[Vision Grid] Vision API analysis completed');
          
          // Parse vision result and map to pages
          const pageDescriptions = parseVisionGridResult(visionResult, gridResult.mapping);
          const pagesAnalyzed = pageDescriptions.size;
          
          onProgress?.('completed', {
            message: `✅ 4단계: 분석 완료! (${pagesAnalyzed}페이지 처리됨)`,
            pagesAnalyzed: pagesAnalyzed,
            currentStep: 4,
            totalSteps: 4
          });
          
          // Cleanup temporary files
          try {
            fs.rmSync(imageOutputDir, { recursive: true, force: true });
            fs.unlinkSync(gridResult.grid_path);
            
            // If we converted .ppt file, clean it up
            if (options.isPPT && options.convertedFilePath && fs.existsSync(options.convertedFilePath)) {
              fs.unlinkSync(options.convertedFilePath);
            }
          } catch (cleanupError) {
            console.error('[Vision Grid] Cleanup failed:', cleanupError);
          }
          
          resolve({
            success: true,
            visionResult: visionResult,
            pageDescriptions: Object.fromEntries(pageDescriptions),
            pageMapping: gridResult.mapping
          });
          
        } catch (error) {
          // Cleanup on error
          try {
            fs.rmSync(imageOutputDir, { recursive: true, force: true });
            
            if (options.isPPT && options.convertedFilePath && fs.existsSync(options.convertedFilePath)) {
              fs.unlinkSync(options.convertedFilePath);
            }
          } catch (e) {}
          
          reject(error);
        }
      });
      
    } catch (error) {
      reject(error);
    }
  });
}

// Vision API: Grid 방식 - 문서에서 모든 이미지 추출 후 한 번에 분석
export async function extractAndAnalyzeImagesWithGrid(
  filePath: string,
  originalName?: string,
  options: {
    userId?: string;
    agentId?: number;
    documentId?: number;
    onProgress?: (step: string, details?: any) => void;
  } = {}
): Promise<{ success: boolean; visionResult?: string; pageDescriptions?: Record<number, string>; pageMapping?: any[]; error?: string }> {
  return new Promise(async (resolve, reject) => {
    console.log(`\n[Vision Grid] Starting image extraction and grid analysis: ${originalName}`);
    
    const { onProgress } = options;
    
    const tempDir = path.join(__dirname, 'temp_vision');
    
    try {
      // 임시 디렉토리 생성
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const fileName = (originalName || '').toLowerCase();
      const isPDF = fileName.endsWith('.pdf');
      const isPPT = fileName.endsWith('.ppt');
      const isPPTX = fileName.endsWith('.pptx');
      
      let extractedImages: any[] = [];
      const imageOutputDir = path.join(tempDir, `images_${Date.now()}`);
      
      if (isPPTX || isPPT) {
        // PPTX/PPT → PNG slides (직접 변환하여 벡터 그래픽 포함)
        console.log('[Vision Grid] Converting PPTX/PPT slides to PNG images...');
        onProgress?.('converting', { message: 'PPTX 슬라이드를 이미지로 변환 중...' });
        
        try {
          // 임시 디렉토리 생성
          if (!fs.existsSync(imageOutputDir)) {
            fs.mkdirSync(imageOutputDir, { recursive: true });
          }
          
          const convertedImages = await new Promise<string[]>((resolveConvert, rejectConvert) => {
            // LibreOffice로 PPTX 슬라이드를 PNG로 변환
            const libreofficeCmd = `libreoffice --headless --convert-to png --outdir "${imageOutputDir}" "${filePath}"`;
            let execProcess: any;
            let hasTimedOut = false;
            
            const conversionTimeout = setTimeout(() => {
              hasTimedOut = true;
              console.error('[Vision Grid] PNG conversion timeout');
              if (execProcess) {
                execProcess.kill('SIGTERM');
              }
              rejectConvert(new Error('PNG conversion timeout (30s). Please try again.'));
            }, 30000);
            
            execProcess = exec(libreofficeCmd, (error, stdout, stderr) => {
              clearTimeout(conversionTimeout);
              
              if (hasTimedOut) {
                return;
              }
              
              if (error) {
                console.error('[Vision Grid] PNG conversion failed:', error);
                console.error('[Vision Grid] stdout:', stdout);
                console.error('[Vision Grid] stderr:', stderr);
                rejectConvert(new Error(`PNG conversion failed: ${error.message}. LibreOffice may not be available.`));
                return;
              }
              
              console.log('[Vision Grid] LibreOffice conversion completed');
              console.log('[Vision Grid] stdout:', stdout);
              
              // LibreOffice가 생성한 PNG 파일들 찾기
              // 패턴: filename.png (단일), filename_1.png, filename_2.png, ... (복수)
              const baseFilename = path.basename(filePath, path.extname(filePath));
              const pngFiles: string[] = [];
              
              try {
                const files = fs.readdirSync(imageOutputDir);
                console.log('[Vision Grid] Files in output directory:', files);
                
                // PNG 파일만 필터링하고 정렬
                const pngPattern = new RegExp(`^${baseFilename}(_\\d+)?\\.png$`, 'i');
                const matchingFiles = files
                  .filter(f => pngPattern.test(f))
                  .sort((a, b) => {
                    // 파일명에서 숫자 추출하여 정렬
                    const numA = a.match(/_(\d+)\.png$/)?.[1];
                    const numB = b.match(/_(\d+)\.png$/)?.[1];
                    
                    if (!numA && !numB) return 0; // 둘 다 숫자 없음 (단일 슬라이드)
                    if (!numA) return -1; // a가 숫자 없음 (먼저 옴)
                    if (!numB) return 1; // b가 숫자 없음
                    
                    return parseInt(numA) - parseInt(numB);
                  });
                
                matchingFiles.forEach(file => {
                  pngFiles.push(path.join(imageOutputDir, file));
                });
                
                if (pngFiles.length === 0) {
                  console.error('[Vision Grid] No PNG files found after conversion');
                  rejectConvert(new Error('No PNG files generated. Check LibreOffice output.'));
                  return;
                }
                
                console.log(`[Vision Grid] Successfully converted to ${pngFiles.length} PNG slides`);
                resolveConvert(pngFiles);
                
              } catch (readError) {
                console.error('[Vision Grid] Error reading output directory:', readError);
                rejectConvert(new Error(`Failed to read converted files: ${readError}`));
              }
            });
          });
          
          // PNG 파일들을 extractedImages 형식으로 변환
          extractedImages = convertedImages.map((imagePath, index) => ({
            page: index + 1,
            image_index: 0,
            path: imagePath,
            bbox: [0, 0, 0, 0], // PNG는 bbox 정보 없음
            caption: `Slide ${index + 1}`,
            width: 0, // 실제 크기는 나중에 확인
            height: 0
          }));
          
          console.log(`[Vision Grid] Converted ${extractedImages.length} slides to PNG images`);
          
          // PPTX 변환 완료 → Grid 생성 및 Vision API 호출
          const result = await processImagesWithGrid(
            extractedImages,
            imageOutputDir,
            tempDir,
            {
              ...options,
              isPPT: isPPT,
              convertedFilePath: undefined // PPTX는 변환 파일 없음
            }
          );
          
          resolve(result);
          
        } catch (conversionError: any) {
          console.error('[Vision Grid] PNG conversion error:', conversionError);
          reject(new Error(`PNG conversion failed: ${conversionError.message}`));
          return;
        }
        
      } else if (isPDF) {
        // PDF → embedded 이미지 추출 (기존 방식)
        console.log('[Vision Grid] Extracting embedded images from PDF...');
        
        const pythonScript = path.join(__dirname, 'vision_processor', 'extract_images_from_pdf.py');
        
        if (!fs.existsSync(imageOutputDir)) {
          fs.mkdirSync(imageOutputDir, { recursive: true });
        }
        
        console.log('[Vision Grid] Executing Python script:', pythonScript);
        console.log('[Vision Grid] Args:', filePath, imageOutputDir);
        const python = spawn('python3', [pythonScript, filePath, imageOutputDir]);
      
      let pythonStdout = '';
      let pythonStderr = '';
      
      python.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('[Vision Python STDOUT]', output);
        pythonStdout += output;
      });
      
      python.stderr.on('data', (data) => {
        const error = data.toString();
        console.error('[Vision Python STDERR]', error);
        pythonStderr += error;
      });
      
      python.on('close', async (code) => {
        console.log('[Vision Python] Process exited with code:', code);
        console.log('[Vision Python] Full stdout:', pythonStdout);
        console.log('[Vision Python] Full stderr:', pythonStderr);
        
        if (code !== 0) {
          console.error('[Vision Grid] Image extraction failed:', pythonStderr);
          reject(new Error(`Image extraction failed: ${pythonStderr}`));
          return;
        }
        
        try {
          const extractResult = JSON.parse(pythonStdout);
          
          if (!extractResult.success || extractResult.total === 0) {
            console.log('[Vision Grid] No images found in document');
            onProgress?.('error', { message: '문서에서 이미지를 찾을 수 없습니다' });
            resolve({ success: false, error: 'No images found in document' });
            return;
          }
          
          console.log(`[Vision Grid] Extracted ${extractResult.total} images from PDF`);
          
          // PDF 이미지 추출 완료 → Grid 생성 및 Vision API 호출
          const result = await processImagesWithGrid(
            extractResult.images,
            imageOutputDir,
            tempDir,
            {
              ...options,
              isPPT: false,
              convertedFilePath: undefined
            }
          );
          
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse extraction output: ${error}`));
        }
      });
      
      } else {
        // Unsupported file type
        reject(new Error('Unsupported file type for grid analysis'));
        return;
      }
      
    } catch (error) {
      reject(error);
    }
  });
}

async function saveChunksToDatabase(chunks: RAGChunk[], documentId: number, agentId: number, filename?: string): Promise<void> {
  const { generateEmbedding } = await import('./openai');
  
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`📦 청크 저장 시작: ${chunks.length}개 청크`);
  console.log(`${'─'.repeat(80)}`);
  
  // Delete existing chunks for this document
  await db.delete(agentDocumentChunks).where(eq(agentDocumentChunks.documentId, documentId));
  
  let totalEmbeddingTokens = 0;
  const startTime = Date.now();
  
  // Insert new chunks with embeddings
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkTokens = estimateTokens(chunk.text);
    
    // 청크 내용 미리보기 (첫 80자)
    const preview = chunk.text.substring(0, 80).replace(/\n/g, ' ');
    const previewText = chunk.text.length > 80 ? `${preview}...` : preview;
    
    console.log(`\n📄 청크 ${i + 1}/${chunks.length}:`);
    console.log(`   ├─ 청크 인덱스: ${chunk.chunk_index}`);
    console.log(`   ├─ 내용 길이: ${chunk.text.length}자 (예상 ${chunkTokens} 토큰)`);
    console.log(`   ├─ 미리보기: "${previewText}"`);
    if (chunk.keywords && chunk.keywords.length > 0) {
      console.log(`   ├─ 키워드: ${chunk.keywords.slice(0, 5).join(', ')}${chunk.keywords.length > 5 ? '...' : ''}`);
    }
    
    try {
      // Generate embedding for this chunk
      const embeddingStart = Date.now();
      console.log(`   └─ 🔄 Embedding 생성 중...`);
      const embedding = await generateEmbedding(chunk.text);
      const embeddingTime = Date.now() - embeddingStart;
      
      totalEmbeddingTokens += chunkTokens;
      
      console.log(`      ✅ Embedding 생성 완료 (${embeddingTime}ms)`);
      console.log(`      └─ Vector 크기: ${embedding.length} 차원`);
      
      await db.insert(agentDocumentChunks).values({
        documentId,
        agentId,
        chunkIndex: chunk.chunk_index,
        content: chunk.text,
        keywords: chunk.keywords || [],
        metadata: chunk.metadata || {},
        embedding: embedding
      });
    } catch (error) {
      console.error(`   ⚠️  Embedding 생성 실패:`, error);
      // Save chunk without embedding on error
      await db.insert(agentDocumentChunks).values({
        documentId,
        agentId,
        chunkIndex: chunk.chunk_index,
        content: chunk.text,
        keywords: chunk.keywords || [],
        metadata: chunk.metadata || {}
      });
    }
  }
  
  const totalTime = Date.now() - startTime;
  const estimatedCost = (totalEmbeddingTokens / 1000000) * 0.02; // OpenAI text-embedding-3-large pricing
  
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`✅ 청크 저장 완료`);
  console.log(`   ├─ 총 청크 수: ${chunks.length}개`);
  console.log(`   ├─ 총 토큰 수: ~${totalEmbeddingTokens} 토큰`);
  console.log(`   ├─ 예상 비용: $${estimatedCost.toFixed(6)}`);
  console.log(`   └─ 소요 시간: ${(totalTime / 1000).toFixed(1)}초`);
  console.log(`${'─'.repeat(80)}\n`);
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function removeDuplicateSentences(text: string): string {
  const sentences = text.split(/([.!?。！？\n]+)/);
  const seen = new Set<string>();
  const result: string[] = [];
  
  for (let i = 0; i < sentences.length; i += 2) {
    const sentence = sentences[i];
    const separator = sentences[i + 1] || '';
    
    if (!sentence.trim()) continue;
    
    const normalized = sentence.trim().toLowerCase().replace(/[^\w가-힣]/g, '');
    
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(sentence + separator);
    }
  }
  
  return result.join('').trim();
}

function estimateTokens(text: string): number {
  const koreanChars = (text.match(/[가-힣]/g) || []).length;
  const otherChars = text.length - koreanChars;
  
  return Math.ceil(koreanChars * 0.4 + otherChars * 0.25);
}

function smartTruncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  
  const sentenceBoundaries = /[.!?。！？\n]/g;
  
  const truncated = text.substring(0, maxLength);
  const matches = Array.from(truncated.matchAll(sentenceBoundaries));
  
  if (matches.length > 0) {
    const lastBoundary = matches[matches.length - 1];
    const boundaryPos = lastBoundary.index! + lastBoundary[0].length;
    
    if (boundaryPos >= maxLength * 0.5) {
      return text.substring(0, boundaryPos).trim();
    }
  }
  
  const ellipsis = '...';
  const truncatedForSpace = text.substring(0, maxLength - ellipsis.length);
  const lastSpace = truncatedForSpace.lastIndexOf(' ');
  
  if (lastSpace > (maxLength - ellipsis.length) * 0.7) {
    return truncatedForSpace.substring(0, lastSpace).trim() + ellipsis;
  }
  
  return truncatedForSpace.trim() + ellipsis;
}

export async function searchDocumentChunks(agentId: number, query: string, limit: number = 3): Promise<any[]> {
  try {
    console.log(`[RAG Hybrid Search] Searching for agent ${agentId}, query: "${query.substring(0, 50)}..."`);
    
    // 🎯 Canon Lock: RAG 검색 범위 제한으로 토큰 절감
    const canonSettings = await storage.getAgentCanon(agentId);
    let allChunks: any[];
    
    if (canonSettings?.sources && canonSettings.sources.length > 0) {
      // Canon Lock 활성화: SQL에서 지정된 문서만 검색 (성능 최적화)
      const allowedDocIds = canonSettings.sources.map(s => parseInt(s)).filter(id => !isNaN(id));
      
      if (allowedDocIds.length === 0) {
        console.log(`[🔒 Canon Lock] No valid document IDs in canon sources`);
        return [];
      }
      
      console.log(`[🔒 Canon Lock] Limiting search to ${allowedDocIds.length} documents: [${allowedDocIds.join(', ')}]`);
      
      // JOIN documents to check both chunk.expiresAt and document.expiresAt
      allChunks = await db
        .select({
          id: agentDocumentChunks.id,
          documentId: agentDocumentChunks.documentId,
          agentId: agentDocumentChunks.agentId,
          chunkIndex: agentDocumentChunks.chunkIndex,
          content: agentDocumentChunks.content,
          keywords: agentDocumentChunks.keywords,
          metadata: agentDocumentChunks.metadata,
          embedding: agentDocumentChunks.embedding,
          createdAt: agentDocumentChunks.createdAt,
          expiresAt: agentDocumentChunks.expiresAt
        })
        .from(agentDocumentChunks)
        .innerJoin(documents, eq(agentDocumentChunks.documentId, documents.id))
        .where(
          and(
            eq(agentDocumentChunks.agentId, agentId),
            inArray(agentDocumentChunks.documentId, allowedDocIds),
            // 청크 또는 문서 레벨에서 만료 확인 (둘 다)
            or(
              isNull(agentDocumentChunks.expiresAt),
              gt(agentDocumentChunks.expiresAt, new Date())
            ),
            or(
              isNull(documents.expiresAt),
              gt(documents.expiresAt, new Date())
            )
          )
        );
      
      console.log(`[🔒 Canon Lock] Found ${allChunks.length} chunks from canon sources (만료되지 않음)`);
    } else {
      // Canon Lock 비활성화: 모든 문서 검색 (만료되지 않은 것만)
      console.log(`[RAG Search] Canon Lock disabled - searching all documents`);
      allChunks = await db
        .select({
          id: agentDocumentChunks.id,
          documentId: agentDocumentChunks.documentId,
          agentId: agentDocumentChunks.agentId,
          chunkIndex: agentDocumentChunks.chunkIndex,
          content: agentDocumentChunks.content,
          keywords: agentDocumentChunks.keywords,
          metadata: agentDocumentChunks.metadata,
          embedding: agentDocumentChunks.embedding,
          createdAt: agentDocumentChunks.createdAt,
          expiresAt: agentDocumentChunks.expiresAt
        })
        .from(agentDocumentChunks)
        .innerJoin(documents, eq(agentDocumentChunks.documentId, documents.id))
        .where(
          and(
            eq(agentDocumentChunks.agentId, agentId),
            // 청크 또는 문서 레벨에서 만료 확인 (둘 다)
            or(
              isNull(agentDocumentChunks.expiresAt),
              gt(agentDocumentChunks.expiresAt, new Date())
            ),
            or(
              isNull(documents.expiresAt),
              gt(documents.expiresAt, new Date())
            )
          )
        );
    }
    
    if (allChunks.length === 0) {
      console.log('[RAG Hybrid Search] No chunks found for this agent');
      return [];
    }
    
    console.log(`[RAG Hybrid Search] Found ${allChunks.length} chunks total`);
    
    // Generate query embedding for semantic search
    let queryEmbedding: number[] | null = null;
    try {
      const { generateEmbedding } = await import('./openai');
      queryEmbedding = await generateEmbedding(query);
      console.log('[RAG Hybrid Search] Query embedding generated successfully');
    } catch (error) {
      console.error('[RAG Hybrid Search] Failed to generate query embedding:', error);
    }
    
    // Prepare keyword search
    const queryKeywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    // Score chunks using hybrid approach
    const scoredChunks = allChunks.map((chunk: any) => {
      const content = chunk.content.toLowerCase();
      const chunkKeywords = (chunk.keywords as string[]) || [];
      
      // 1. Keyword-based score (0-10 points)
      let keywordScore = 0;
      for (const keyword of queryKeywords) {
        if (content.includes(keyword)) keywordScore += 2;
        if (chunkKeywords.some(k => k.toLowerCase().includes(keyword))) keywordScore += 3;
      }
      
      // 2. Semantic similarity score (0-10 points, scaled from 0-1)
      let semanticScore = 0;
      if (queryEmbedding && chunk.embedding) {
        try {
          const embedding = typeof chunk.embedding === 'string' 
            ? JSON.parse(chunk.embedding) 
            : chunk.embedding;
          const similarity = cosineSimilarity(queryEmbedding, embedding);
          semanticScore = similarity * 10; // Scale to 0-10
        } catch (error) {
          console.error('[RAG Hybrid Search] Error calculating similarity:', error);
        }
      }
      
      // Combined score: keyword (40%) + semantic (60%)
      const totalScore = (keywordScore * 0.4) + (semanticScore * 0.6);
      
      return { 
        ...chunk, 
        score: totalScore,
        keywordScore,
        semanticScore
      };
    });
    
    // Sort by total score
    const sortedChunks = scoredChunks
      .filter((c: any) => c.score > 0.1)
      .sort((a: any, b: any) => b.score - a.score);
    
    // Token-aware re-ranking: select chunks within token budget
    const TOKEN_BUDGET = 8000;
    const SYSTEM_PROMPT_TOKENS = 2000;
    const DIALOGUE_TOKENS = 1000;
    const REMAINING_BUDGET = TOKEN_BUDGET - SYSTEM_PROMPT_TOKENS - DIALOGUE_TOKENS;
    
    const selectedChunks: any[] = [];
    let totalTokens = 0;
    
    for (const chunk of sortedChunks) {
      if (selectedChunks.length >= 5) break;
      
      const chunkTokens = estimateTokens(chunk.content);
      
      if (totalTokens + chunkTokens <= REMAINING_BUDGET) {
        selectedChunks.push(chunk);
        totalTokens += chunkTokens;
      }
    }
    
    const finalCount = Math.max(2, Math.min(selectedChunks.length, 5));
    const topChunks = selectedChunks.slice(0, finalCount);
    
    console.log(`[RAG Token Budget] Budget: ${REMAINING_BUDGET}, Used: ${totalTokens}, Selected: ${topChunks.length} chunks`);
    
    // Optimize chunks: remove duplicates + smart truncate
    const MAX_CHUNK_LENGTH = 400;
    const optimizedChunks = topChunks.map((chunk: any) => {
      const originalLength = chunk.content.length;
      
      const deduplicated = removeDuplicateSentences(chunk.content);
      const dedupeReduction = originalLength - deduplicated.length;
      
      const truncated = deduplicated.length > MAX_CHUNK_LENGTH 
        ? smartTruncate(deduplicated, MAX_CHUNK_LENGTH)
        : deduplicated;
      
      const finalTokens = estimateTokens(truncated);
      
      return {
        ...chunk,
        content: truncated,
        _originalLength: originalLength,
        _dedupedLength: deduplicated.length,
        _finalLength: truncated.length,
        _dedupeReduction: dedupeReduction,
        _totalReduction: originalLength - truncated.length,
        _estimatedTokens: finalTokens
      };
    });
    
    const totalEstimatedTokens = optimizedChunks.reduce((sum, c) => sum + c._estimatedTokens, 0);
    
    console.log(`[RAG Optimization] ${optimizedChunks.length} chunks selected:`);
    optimizedChunks.forEach((chunk: any, idx: number) => {
      console.log(`  ${idx + 1}. Score: ${chunk.score.toFixed(2)} (kw: ${chunk.keywordScore.toFixed(2)}, sem: ${chunk.semanticScore.toFixed(2)})`);
      console.log(`     Reduction: ${chunk._originalLength} → ${chunk._dedupedLength} (dedupe -${chunk._dedupeReduction}) → ${chunk._finalLength} (truncate) = ${chunk._totalReduction} chars saved`);
      console.log(`     Est. tokens: ${chunk._estimatedTokens}`);
    });
    console.log(`[RAG Total] Estimated tokens for all chunks: ${totalEstimatedTokens}`);
    
    return optimizedChunks;
    
  } catch (error) {
    console.error('[RAG Hybrid Search] Error:', error);
    return [];
  }
}

interface VisionAnalysis {
  diagramCount: number;
  recommendVision: boolean;
  recommendationLevel: 'unnecessary' | 'optional' | 'recommended' | 'highly_recommended';
  visionScore: number;
  estimatedCost: number;
  hasVisionProcessed: boolean;
  reasons: string[];
  benefits?: string[];
}

export async function analyzeDocumentStructure(
  text: string,
  metadata: any
): Promise<VisionAnalysis> {
  console.log(`\n${'─'.repeat(80)}`);
  console.log('📊 Vision API 분석 시작');
  console.log(`${'─'.repeat(80)}`);
  
  let diagramCount = 0;
  let visionScore = 0;
  const reasons: string[] = [];
  
  const textLength = text.length;
  const pageCount = metadata?.total_pages || 1;
  const ocrUsed = metadata?.ocr_used || false;
  const ocrPages = metadata?.ocr_pages || 0;
  
  console.log(`\n📄 문서 기본 정보:`);
  console.log(`   ├─ 텍스트 길이: ${textLength.toLocaleString()}자`);
  console.log(`   ├─ 페이지 수: ${pageCount}페이지`);
  console.log(`   └─ OCR 사용: ${ocrUsed ? `Yes (${ocrPages}페이지)` : 'No'}`);
  
  const avgCharsPerPage = textLength / pageCount;
  
  console.log(`\n📐 페이지 밀도 분석:`);
  console.log(`   └─ 평균 페이지당 문자 수: ${Math.round(avgCharsPerPage)}자`);
  
  if (avgCharsPerPage < 300) {
    diagramCount = Math.floor(pageCount * 0.7);
    visionScore += 8;
    const reason = `페이지당 텍스트 적음 (${Math.round(avgCharsPerPage)}자) - 다이어그램/차트 가능성 높음`;
    reasons.push(reason);
    console.log(`      ✅ ${reason} → +8점`);
  } else if (avgCharsPerPage < 600) {
    diagramCount = Math.floor(pageCount * 0.4);
    visionScore += 5;
    const reason = `페이지당 텍스트 중간 (${Math.round(avgCharsPerPage)}자) - 일부 시각 자료 포함 가능`;
    reasons.push(reason);
    console.log(`      ✅ ${reason} → +5점`);
  } else {
    console.log(`      ℹ️  텍스트 밀도 높음 (${Math.round(avgCharsPerPage)}자) - 시각 자료 가능성 낮음`);
  }
  
  // 카테고리별 키워드 정의 (우선순위 및 점수 가중치 포함)
  const keywordCategories = {
    // 지도/노선도 (가중치 높음: 8점)
    maps: {
      keywords: ['metro', 'subway', 'map', 'route', 'station', 'line', 'transfer', 'network', 
                 '지하철', '노선', '역', '환승', '지도', '경로'],
      weight: 8,
      description: '지도/노선도'
    },
    // 복잡한 수식/물리학 (가중치 높음: 8점) - 수식은 OCR로 읽기 어려움
    equations: {
      keywords: ['equation', 'formula', 'mathematical', '수식', '공식', '∑', '∫', '√', '∂', '∞', 
                 '±', '≤', '≥', '≠', '∈', '∀', '∃', 'theorem', '정리', 'coulomb', 'force', 'law',
                 'vector', 'field', 'charge', 'electric', 'magnetic', '전기장', '쿨롱', '전하', 
                 '벡터', 'potential', 'energy', '에너지', 'momentum', 'velocity', '속도', 
                 'acceleration', '가속도', 'derivative', 'integral', '미분', '적분', 'limit',
                 'π', 'ε', 'μ', 'σ', 'Ω', 'Δ', 'λ', 'θ', 'φ', 'ω'],
      weight: 8,
      description: '수학/물리 수식'
    },
    // 회로도/전자공학 (가중치 높음: 7점) - 회로도는 텍스트로 표현 불가
    circuits: {
      keywords: ['circuit', 'resistor', 'capacitor', 'inductor', 'voltage', 'current', 'ohm',
                 'semiconductor', 'transistor', 'diode', 'amplifier', '회로', '저항', '전류', 
                 '전압', '반도체', '다이오드', '트랜지스터', '증폭기', 'schematic', '회로도',
                 'wiring', 'connection', 'node', '노드', 'ground', 'GND', 'VCC', 'VDD'],
      weight: 7,
      description: '회로도/전자공학'
    },
    // 복잡한 표 (가중치 높음: 6점)
    tables: {
      keywords: ['table', 'matrix', 'grid', 'cell', 'row', 'column', '표', '행', '열', '셀', 
                 'thead', 'tbody', '|---', '┌', '└', '├'],
      weight: 6,
      description: '복잡한 표/행렬'
    },
    // 다이어그램/차트 (가중치 중간: 5점)
    diagrams: {
      keywords: ['그림', '도표', 'figure', 'chart', 'graph', 'diagram', 'flowchart', 'plot',
                 'visualization', '시각화', '차트', '그래프', 'illustration', '도해'],
      weight: 5,
      description: '다이어그램/차트'
    }
  };
  
  // 각 카테고리별로 키워드 검색 및 점수 계산
  console.log(`\n🔍 카테고리별 키워드 분석:`);
  let totalKeywordCount = 0;
  const foundCategories: string[] = [];
  
  for (const [category, config] of Object.entries(keywordCategories)) {
    const foundKeywords = config.keywords.filter(kw => {
      const lowerText = text.toLowerCase();
      return lowerText.includes(kw.toLowerCase());
    });
    
    if (foundKeywords.length > 0) {
      const keywordCount = foundKeywords.reduce((sum, kw) => {
        const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        return sum + (text.match(regex) || []).length;
      }, 0);
      
      totalKeywordCount += keywordCount;
      const categoryScore = Math.min(config.weight, keywordCount * 0.8);
      visionScore += categoryScore;
      diagramCount += Math.floor(keywordCount * 0.6);
      
      foundCategories.push(config.description);
      const reason = `${config.description} 감지: ${foundKeywords.length}개 키워드 (${keywordCount}회 언급) → +${categoryScore.toFixed(1)}점`;
      reasons.push(reason);
      
      console.log(`   ├─ ${config.description}:`);
      console.log(`   │  ├─ 발견된 키워드: ${foundKeywords.slice(0, 8).join(', ')}${foundKeywords.length > 8 ? '...' : ''}`);
      console.log(`   │  ├─ 총 언급 횟수: ${keywordCount}회`);
      console.log(`   │  └─ 점수: +${categoryScore.toFixed(1)}점 (최대 ${config.weight}점)`);
    }
  }
  
  if (totalKeywordCount === 0) {
    console.log(`   └─ ℹ️  특별한 키워드 감지되지 않음`);
  }
  
  if (ocrUsed && ocrPages > 0) {
    visionScore += 6;
    const reason = `OCR 사용됨 (${ocrPages}페이지) - 스캔 문서로 시각 자료 포함 가능성 높음`;
    reasons.push(reason);
    console.log(`\n📷 OCR 정보:`);
    console.log(`   └─ ${reason} → +6점`);
  }
  
  visionScore = Math.min(10, visionScore);
  const recommendVision = visionScore >= 5;
  
  // 추천 레벨 분류 (0-3: 불필요, 4-6: 선택적, 7-9: 추천, 10+: 적극 추천)
  let recommendationLevel: 'unnecessary' | 'optional' | 'recommended' | 'highly_recommended';
  if (visionScore >= 10) {
    recommendationLevel = 'highly_recommended';
  } else if (visionScore >= 7) {
    recommendationLevel = 'recommended';
  } else if (visionScore >= 4) {
    recommendationLevel = 'optional';
  } else {
    recommendationLevel = 'unnecessary';
  }
  
  const estimatedCost = diagramCount * 0.00255;
  
  // 최종 결과 표시
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`📊 Vision API 분석 결과`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`\n🎯 최종 점수: ${visionScore}/10`);
  console.log(`   ├─ 추정 다이어그램: ${diagramCount}개`);
  console.log(`   ├─ 예상 비용: $${estimatedCost.toFixed(4)} (Sharp 최적화 적용)`);
  console.log(`   ├─ Vision API 권장: ${recommendVision ? '✅ YES' : '❌ NO'}`);
  console.log(`   └─ 추천 레벨: ${recommendationLevel}`);
  
  if (visionScore >= 10) {
    console.log(`\n🔥 적극 추천: 지도/노선도/복잡한 수식/표 등이 포함되어 Vision API 필수`);
  } else if (visionScore >= 7) {
    console.log(`\n⚠️  추천: 시각 자료가 많아 Vision API 사용을 권장합니다`);
  } else if (visionScore >= 4) {
    console.log(`\nℹ️  선택적: 기본 텍스트 추출로 충분하지만, 필요시 Vision API 사용 가능`);
  } else {
    console.log(`\n✅ 불필요: 텍스트 문서로 Vision API가 필요하지 않습니다`);
  }
  
  if (reasons.length > 0) {
    console.log(`\n📋 감지된 내용:`);
    reasons.forEach(r => console.log(`   • ${r}`));
  }
  
  console.log(`${'─'.repeat(80)}\n`);
  
  return {
    diagramCount,
    recommendVision,
    recommendationLevel,
    visionScore,
    estimatedCost,
    hasVisionProcessed: false,
    reasons
  };
}

export async function optimizeImageForVision(imagePath: string): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  
  console.log(`[Sharp Optimization] 이미지 최적화 시작: ${imagePath}`);
  
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  
  console.log(`  - 원본 크기: ${metadata.width}×${metadata.height}px`);
  console.log(`  - 원본 포맷: ${metadata.format}`);
  
  const optimized = await image
    .resize(512, 512, {
      fit: 'inside',
      withoutEnlargement: false
    })
    .png()
    .toBuffer();
  
  console.log(`  - 최적화 완료: 512×512px (max)`);
  console.log(`  - 파일 크기: ${(optimized.length / 1024).toFixed(2)} KB`);
  
  return optimized;
}
