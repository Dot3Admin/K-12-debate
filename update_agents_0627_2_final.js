import xlsx from 'xlsx';
import fs from 'fs';

async function updateAgents0627v2Final() {
  try {
    console.log('🔄 최신 Excel 파일로 에이전트 데이터 교체 중...');
    
    // 최신 Excel 파일 읽기
    const workbook = xlsx.readFile('attached_assets/AI 에이전트 0627_2_1751056559643.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // JSON으로 변환
    const jsonData = xlsx.utils.sheet_to_json(worksheet);
    console.log(`📊 Excel에서 ${jsonData.length}개의 에이전트 데이터를 읽었습니다.`);
    
    // 에이전트 데이터 변환 - 올바른 조직 정보 매핑
    const agents = jsonData.map((row, index) => {
      const id = row.id || (100 + index + 1);
      const name = row.name || `에이전트 ${index + 1}`;
      const description = row.description || '';
      
      // 조직 정보 - Excel 컬럼명 그대로 사용
      const upperCategory = row.upperCategory || '공과대학';
      const lowerCategory = row.lowerCategory || '컴퓨터공학과';
      const detailCategory = row.detailCategory || row.lowerCategory || '컴퓨터공학과';
      
      const status = row.status || 'active';
      const llmModel = row.llmModel || 'gpt-4o';
      const chatbotType = row.chatbotType || 'doc-fallback-llm';
      const maxInputLength = parseInt(row.maxInputLength || 2048);
      const maxResponseLength = parseInt(row.maxResponseLength || 1024);
      const personaName = row.personaName || '';
      const speakingStyle = row.speakingStyle || '';
      const personalityTraits = row.personalityTraits || '';
      const rolePrompt = row.rolePrompt || '';
      const prohibitedWordResponse = row.prohibitedWordResponse || '';
      const visibility = row.visibility || 'organization';
      const managerId = row.managerId || 'prof001';
      const isActive = row.isActive !== undefined ? row.isActive : true;
      const category = row['유형'] || '학생'; // 유형 컬럼 사용
      
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

    // 화학과 멘토링 Q&A 에이전트 확인
    const chemicalAgent = agents.find(a => a.name.includes('화학과') && a.name.includes('멘토링'));
    if (chemicalAgent) {
      console.log('\\n🔍 화학과 멘토링 Q&A 에이전트 확인:');
      console.log(`  이름: ${chemicalAgent.name}`);
      console.log(`  상위 조직: ${chemicalAgent.upperCategory}`);
      console.log(`  하위 조직: ${chemicalAgent.lowerCategory}`);
      console.log(`  세부 조직: ${chemicalAgent.detailCategory}`);
      console.log(`  유형: ${chemicalAgent.category}`);
    }

    // 기존 데이터 삭제 및 새 데이터 저장
    const agentDataPath = 'data/memory-storage-agents.json';
    
    // 새 데이터로 저장 (ID를 키로 사용)
    const dataToSave = {};
    agents.forEach(agent => {
      dataToSave[agent.id] = agent;
    });
    
    fs.writeFileSync(agentDataPath, JSON.stringify(dataToSave, null, 2), 'utf8');
    console.log(`💾 새 에이전트 데이터 저장 완료: ${agents.length}개`);
    
    // 통계 출력
    const categoryStats = agents.reduce((acc, agent) => {
      acc[agent.category] = (acc[agent.category] || 0) + 1;
      return acc;
    }, {});
    
    console.log('\\n📊 에이전트 유형별 통계:');
    Object.entries(categoryStats).forEach(([category, count]) => {
      console.log(`  - ${category}: ${count}개`);
    });
    
    console.log('\\n🎉 에이전트 데이터 교체가 완료되었습니다!');
    
  } catch (error) {
    console.error('❌ 에이전트 데이터 교체 중 오류:', error);
    throw error;
  }
}

updateAgents0627v2Final().catch(console.error);