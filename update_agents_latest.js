import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

async function updateAgentsLatest() {
  try {
    console.log('🔄 최신 에이전트 데이터 업데이트 중...');
    
    // 최신 Excel 파일 읽기
    const workbook = xlsx.readFile('attached_assets/AI 에이전트 0627_1751054472984.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // JSON으로 변환
    const jsonData = xlsx.utils.sheet_to_json(worksheet);
    console.log(`📊 Excel에서 ${jsonData.length}개의 에이전트 데이터를 읽었습니다.`);
    
    // 데이터 구조 확인
    if (jsonData.length > 0) {
      console.log('컬럼 구조:', Object.keys(jsonData[0]));
      console.log('첫 번째 행 샘플:', jsonData[0]);
    }
    
    // 에이전트 데이터 변환 - Excel의 실제 컬럼명 매핑
    const agents = jsonData.map((row, index) => {
      // Excel 컬럼명에 따른 정확한 매핑
      const id = row.id || (100 + index + 1);
      const name = row.name || `에이전트 ${index + 1}`;
      const description = row.description || '';
      const upperCategory = row.upperCategory || '공과대학';
      const lowerCategory = row.lowerCategory || '컴퓨터공학과';
      const detailCategory = row.detailCategory || row.lowerCategory || '컴퓨터공학과';
      const status = row.status || 'active';
      const llmModel = row.llmModel || 'gpt-4o';
      const chatbotType = row.chatbotType || 'doc-fallback-llm';
      const maxInputLength = row.maxInputLength || 2048;
      const maxResponseLength = row.maxResponseLength || row.maxOutputLength || 1024;
      const personaName = row.personaName || '';
      const speakingStyle = row.speakingStyle || '';
      const personalityTraits = row.personalityTraits || '';
      const rolePrompt = row.rolePrompt || '';
      const prohibitedWordResponse = row.prohibitedWordResponse || '';
      const visibility = row.visibility || 'organization';
      const managerId = row.managerId || 'prof001';
      const isActive = row.isActive !== undefined ? row.isActive : true;
      const category = row['유형'] || row.category || '학생'; // '유형' 컬럼 우선 사용
      
      return {
        id: parseInt(id),
        name: name.toString().trim(),
        description: description.toString().trim(),
        category: category.toString().trim(), // Excel의 '유형' 컬럼 사용
        icon: 'Bot',
        backgroundColor: 'bg-blue-500',
        upperCategory: upperCategory.toString().trim(),
        lowerCategory: lowerCategory.toString().trim(),
        detailCategory: detailCategory.toString().trim(),
        status: status.toString().trim(),
        manager: managerId.toString().trim(),
        personality: personalityTraits.toString().trim(),
        llmModel: llmModel.toString().trim(),
        chatbotType: chatbotType.toString().trim(),
        maxInputLength: parseInt(maxInputLength) || 2048,
        maxOutputLength: parseInt(maxResponseLength) || 1024,
        temperature: 0.7,
        visibility: visibility.toString().trim(),
        isActive: Boolean(isActive),
        personaName: personaName.toString().trim(),
        speakingStyle: speakingStyle.toString().trim(),
        personalityTraits: personalityTraits.toString().trim(),
        rolePrompt: rolePrompt.toString().trim(),
        prohibitedWordResponse: prohibitedWordResponse.toString().trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });
    
    console.log(`✅ ${agents.length}개의 에이전트 데이터 변환 완료`);
    
    // 유형별 통계
    const categoryStats = {};
    agents.forEach(agent => {
      categoryStats[agent.category] = (categoryStats[agent.category] || 0) + 1;
    });
    
    console.log('\n📊 유형별 통계:');
    Object.entries(categoryStats).forEach(([category, count]) => {
      console.log(`  ${category}: ${count}개`);
    });
    
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
    
    console.log('\n🎉 에이전트 데이터 업데이트 완료!');
    console.log('서버를 재시작하면 새 데이터가 적용됩니다.');
    
    return agents;
    
  } catch (error) {
    console.error('❌ 에이전트 데이터 업데이트 실패:', error);
    throw error;
  }
}

// 실행
updateAgentsLatest()
  .then(() => {
    console.log('✅ 최신 에이전트 데이터 업데이트 완료');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ 업데이트 실패:', error);
    process.exit(1);
  });

export { updateAgentsLatest };