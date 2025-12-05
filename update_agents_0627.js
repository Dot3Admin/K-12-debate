import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

async function updateAgents0627() {
  try {
    console.log('새 에이전트 데이터 로드 중...');
    
    // Excel 파일 읽기
    const workbook = xlsx.readFile('attached_assets/AI 에이전트 0627_1751054223233.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // JSON으로 변환
    const jsonData = xlsx.utils.sheet_to_json(worksheet);
    console.log(`📊 Excel에서 ${jsonData.length}개의 에이전트 데이터를 읽었습니다.`);
    
    // 데이터 구조 확인
    if (jsonData.length > 0) {
      console.log('첫 번째 행 데이터 구조:', Object.keys(jsonData[0]));
      console.log('샘플 데이터:', jsonData[0]);
    }
    
    // 에이전트 데이터 변환
    const agents = jsonData.map((row, index) => {
      // 다양한 컬럼명 패턴 지원
      const name = row['에이전트명'] || row['이름'] || row['name'] || row['agent_name'] || `에이전트 ${index + 1}`;
      const description = row['설명'] || row['description'] || row['desc'] || '';
      const category = row['카테고리'] || row['유형'] || row['category'] || row['type'] || '학생';
      const personality = row['페르소나'] || row['personality'] || row['persona'] || '';
      const manager = row['관리자'] || row['manager'] || 'prof001';
      const upperCategory = row['상위조직'] || row['상위카테고리'] || row['upper_category'] || '공과대학';
      const lowerCategory = row['하위조직'] || row['하위카테고리'] || row['lower_category'] || '컴퓨터공학과';
      const detailCategory = row['세부조직'] || row['세부카테고리'] || row['detail_category'] || '컴퓨터공학과';
      
      return {
        id: 100 + index + 1, // ID는 101부터 시작
        name: name.toString().trim(),
        description: description.toString().trim(),
        category: category.toString().trim(),
        icon: 'Bot',
        backgroundColor: 'bg-blue-500',
        upperCategory: upperCategory.toString().trim(),
        lowerCategory: lowerCategory.toString().trim(), 
        detailCategory: detailCategory.toString().trim(),
        status: 'active',
        manager: manager.toString().trim(),
        personality: personality.toString().trim(),
        llmModel: 'gpt-4o',
        chatbotType: 'doc-fallback-llm',
        maxInputLength: 2048,
        maxOutputLength: 1024,
        temperature: 0.7,
        visibility: 'organization',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });
    
    console.log(`✅ ${agents.length}개의 새 에이전트가 로드되었습니다.`);
    
    // 기존 데이터 백업
    const backupPath = `data/agents_backup_${Date.now()}.json`;
    if (fs.existsSync('data/memory-storage-agents.json')) {
      fs.copyFileSync('data/memory-storage-agents.json', backupPath);
      console.log(`💾 기존 데이터를 ${backupPath}에 백업했습니다.`);
    }
    
    // 새 데이터 저장
    const agentsData = { agents, lastModified: new Date().toISOString() };
    fs.writeFileSync('data/memory-storage-agents.json', JSON.stringify(agentsData, null, 2));
    console.log('💾 새 에이전트 데이터를 data/memory-storage-agents.json에 저장했습니다.');
    
    // 통계 출력
    const categoryStats = {};
    agents.forEach(agent => {
      categoryStats[agent.category] = (categoryStats[agent.category] || 0) + 1;
    });
    
    console.log('\n📊 카테고리별 통계:');
    Object.entries(categoryStats).forEach(([category, count]) => {
      console.log(`  ${category}: ${count}개`);
    });
    
    console.log('\n🎉 에이전트 데이터 업데이트 완료!');
    console.log('서버를 재시작하면 새 데이터가 적용됩니다.');
    
    return agents;
    
  } catch (error) {
    console.error('❌ 에이전트 데이터 업데이트 실패:', error);
    throw error;
  }
}

// 실행
updateAgents0627()
  .then(() => {
    console.log('✅ 스크립트 실행 완료');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ 스크립트 실행 실패:', error);
    process.exit(1);
  });

export { updateAgents0627 };