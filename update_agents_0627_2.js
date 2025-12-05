import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

async function updateAgents0627v2() {
  try {
    console.log('🔄 새로운 에이전트 데이터 교체 중...');
    
    // 새 Excel 파일 읽기
    const workbook = xlsx.readFile('attached_assets/AI 에이전트 0627_2_1751056305886.xlsx');
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
    
    // 에이전트 데이터 변환
    const agents = jsonData.map((row, index) => {
      const id = row.id || (100 + index + 1);
      const name = row.name || row['이름'] || row['에이전트명'] || `에이전트 ${index + 1}`;
      const description = row.description || row['설명'] || row['역할'] || '';
      const upperCategory = row.upperCategory || row['상위카테고리'] || row['대학'] || '공과대학';
      const lowerCategory = row.lowerCategory || row['하위카테고리'] || row['학과'] || '컴퓨터공학과';
      const detailCategory = row.detailCategory || row['세부카테고리'] || row.lowerCategory || '컴퓨터공학과';
      const status = row.status || row['상태'] || 'active';
      const llmModel = row.llmModel || row['모델'] || 'gpt-4o';
      const chatbotType = row.chatbotType || row['챗봇타입'] || 'doc-fallback-llm';
      const maxInputLength = parseInt(row.maxInputLength || row['최대입력길이'] || 2048);
      const maxResponseLength = parseInt(row.maxResponseLength || row.maxOutputLength || row['최대출력길이'] || 1024);
      const personaName = row.personaName || row['페르소나명'] || '';
      const speakingStyle = row.speakingStyle || row['말투'] || '';
      const personalityTraits = row.personalityTraits || row['성격특성'] || '';
      const rolePrompt = row.rolePrompt || row['역할프롬프트'] || '';
      const prohibitedWordResponse = row.prohibitedWordResponse || row['금지어응답'] || '';
      const visibility = row.visibility || row['공개범위'] || 'organization';
      const managerId = row.managerId || row['관리자ID'] || 'prof001';
      const isActive = row.isActive !== undefined ? row.isActive : (row['활성상태'] !== '비활성');
      const category = row['유형'] || row.category || row['카테고리'] || '학생';
      
      return {
        id: parseInt(id),
        name: name.toString().trim(),
        description: description.toString().trim(),
        category: category.toString().trim(),
        icon: "Bot",
        backgroundColor: "#3B82F6",
        upperCategory: upperCategory.toString().trim(),
        lowerCategory: lowerCategory.toString().trim(), 
        detailCategory: detailCategory.toString().trim(),
        status: status.toString().trim(),
        llmModel: llmModel.toString().trim(),
        chatbotType: chatbotType.toString().trim(),
        maxInputLength: maxInputLength,
        maxOutputLength: maxResponseLength,
        personaNickname: personaName.toString().trim(),
        speechStyle: speakingStyle.toString().trim(),
        personality: personalityTraits.toString().trim(),
        forbiddenResponseStyle: prohibitedWordResponse.toString().trim(),
        visibility: visibility.toString().trim(),
        managerId: managerId.toString().trim(),
        agentEditorIds: [],
        documentManagerIds: [],
        isActive: isActive,
        createdAt: new Date().toISOString(),
        averageRating: null,
        messageCount: 0
      };
    });

    console.log(`✅ ${agents.length}개의 에이전트 데이터 변환 완료`);

    // 기존 데이터 삭제 및 새 데이터 저장
    const agentDataPath = 'data/memory-storage-agents.json';
    
    // 기존 파일 삭제
    if (fs.existsSync(agentDataPath)) {
      fs.unlinkSync(agentDataPath);
      console.log('🗑️ 기존 에이전트 데이터 파일 삭제 완료');
    }
    
    // 새 데이터 저장
    const dataToSave = {
      agents: agents,
      lastUpdated: new Date().toISOString(),
      totalCount: agents.length
    };
    
    fs.writeFileSync(agentDataPath, JSON.stringify(dataToSave, null, 2), 'utf8');
    console.log(`💾 새 에이전트 데이터 저장 완료: ${agents.length}개`);
    
    // 통계 출력
    const categoryStats = agents.reduce((acc, agent) => {
      acc[agent.category] = (acc[agent.category] || 0) + 1;
      return acc;
    }, {});
    
    console.log('📊 에이전트 유형별 통계:');
    Object.entries(categoryStats).forEach(([category, count]) => {
      console.log(`  - ${category}: ${count}개`);
    });
    
    console.log('🎉 에이전트 데이터 교체가 완료되었습니다!');
    
  } catch (error) {
    console.error('❌ 에이전트 데이터 교체 중 오류:', error);
    throw error;
  }
}

// 스크립트 실행
updateAgents0627v2().catch(console.error);