import { processDocument } from './server/documentProcessor.js';
import { analyzeVisualContent } from './server/documentProcessor.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testVisionAPI() {
  console.log('\n🧪 Vision API 테스트 시작...\n');
  
  const testFile = path.join(__dirname, 'uploads', 'metro-map-sample.pdf');
  
  // 파일 존재 확인
  if (!fs.existsSync(testFile)) {
    console.error('❌ 테스트 파일이 없습니다:', testFile);
    return;
  }
  
  console.log('✅ 테스트 파일 확인:', testFile);
  const fileSize = fs.statSync(testFile).size;
  console.log('📦 파일 크기:', (fileSize / 1024).toFixed(2), 'KB\n');
  
  try {
    // 1단계: 문서 분석 (Vision API 없이)
    console.log('📄 1단계: 텍스트 분석 + Vision 권장 점수 계산...');
    const result = await processDocument(
      testFile,
      'metro-map-sample.pdf',
      'application/pdf',
      1 // 임시 에이전트 ID
    );
    
    console.log('\n✅ 문서 분석 완료!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Vision 분석 결과:');
    console.log('   • Vision 점수:', result.visionAnalysis.visionScore, '/ 10');
    console.log('   • 다이어그램 개수:', result.visionAnalysis.diagramCount, '개');
    console.log('   • Vision API 권장:', result.visionAnalysis.recommendVision ? '✅ 예' : '❌ 아니오');
    console.log('   • 예상 비용: $', result.visionAnalysis.estimatedCost);
    
    if (result.visionAnalysis.reasons && result.visionAnalysis.reasons.length > 0) {
      console.log('\n   📋 감지된 내용:');
      result.visionAnalysis.reasons.forEach((reason: string) => {
        console.log('      •', reason);
      });
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // 2단계: Vision API 실행 (점수가 충분히 높으면)
    if (result.visionAnalysis.visionScore >= 3) {
      console.log('🔥 Vision 점수가 높습니다. Vision API 실행...\n');
      
      const visionStart = Date.now();
      const visionResult = await analyzeVisualContent(testFile, 'metro-map-sample.pdf');
      const visionDuration = ((Date.now() - visionStart) / 1000).toFixed(1);
      
      console.log('\n✅ Vision API 분석 완료!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('⏱️  처리 시간:', visionDuration, '초');
      console.log('📝 분석 결과 길이:', visionResult?.length || 0, '문자');
      console.log('\n🔍 Vision API 분석 내용 (처음 500자):');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(visionResult?.substring(0, 500) || '(결과 없음)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } else {
      console.log('ℹ️  Vision 점수가 낮아서 Vision API를 건너뜁니다.');
      console.log('   (수동으로 실행하려면 점수와 관계없이 버튼을 클릭하세요)\n');
    }
    
    console.log('✅ 모든 테스트 완료!\n');
    
  } catch (error) {
    console.error('\n❌ 테스트 중 오류 발생:');
    console.error(error);
  }
}

// 테스트 실행
testVisionAPI().then(() => {
  console.log('🏁 테스트 종료');
  process.exit(0);
}).catch((error) => {
  console.error('💥 치명적 오류:', error);
  process.exit(1);
});
