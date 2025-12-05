import xlsx from 'xlsx';
import fs from 'fs';

async function forceReplaceAgents() {
  try {
    console.log('🔄 강제 에이전트 데이터 교체 및 final_agents.json 생성...');
    
    // Excel 파일 읽기
    const workbook = xlsx.readFile('attached_assets/AI 에이전트 0627_2_1751056559643.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet);
    
    console.log(`📊 Excel에서 ${jsonData.length}개의 에이전트 데이터를 읽었습니다.`);
    
    // 에이전트 데이터 변환 - 올바른 조직 정보 사용
    const agents = jsonData.map((row, index) => {
      const id = parseInt(row.id) || (100 + index + 1);
      const name = (row.name || `에이전트 ${index + 1}`).toString().trim();
      const description = (row.description || '').toString().trim();
      
      // Excel 원본 조직 정보 사용
      const upperCategory = (row.upperCategory || '공과대학').toString().trim();
      const lowerCategory = (row.lowerCategory || '컴퓨터공학과').toString().trim();
      const detailCategory = (row.detailCategory || row.lowerCategory || '컴퓨터공학과').toString().trim();
      
      const category = (row['유형'] || '학생').toString().trim(); // 유형 컬럼 사용
      const managerId = (row.managerId || 'prof001').toString().trim();
      
      return {
        id: id,
        name: name,
        description: description,
        category: category,
        icon: "Bot",
        backgroundColor: "#3B82F6",
        upperCategory: upperCategory,
        lowerCategory: lowerCategory,
        detailCategory: detailCategory,
        status: "active",
        llmModel: "gpt-4o",
        chatbotType: "doc-fallback-llm",
        maxInputLength: 2048,
        maxOutputLength: 1024,
        personaNickname: (row.personaName || '').toString().trim(),
        speechStyle: (row.speakingStyle || '').toString().trim(),
        personality: (row.personalityTraits || '').toString().trim(),
        forbiddenResponseStyle: (row.prohibitedWordResponse || '').toString().trim(),
        visibility: "organization",
        managerId: managerId,
        agentEditorIds: [],
        documentManagerIds: [],
        isActive: true,
        createdAt: new Date().toISOString(),
        averageRating: null,
        messageCount: 0
      };
    });
    
    console.log(`✅ ${agents.length}개의 에이전트 데이터 변환 완료`);
    
    // final_agents.json 파일 생성 (서버가 이 파일을 찾음)
    fs.writeFileSync('final_agents.json', JSON.stringify(agents, null, 2), 'utf8');
    console.log('💾 final_agents.json 파일 생성 완료');
    
    // 기존 memory-storage-agents.json도 업데이트
    const agentDataPath = 'data/memory-storage-agents.json';
    const dataToSave = {};
    agents.forEach(agent => {
      dataToSave[agent.id] = agent;
    });
    
    // 디렉토리 생성
    const dataDir = 'data';
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(agentDataPath, JSON.stringify(dataToSave, null, 2), 'utf8');
    console.log(`💾 memory-storage-agents.json 업데이트 완료: ${agents.length}개`);
    
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
    
    // 통계 출력
    const categoryStats = agents.reduce((acc, agent) => {
      acc[agent.category] = (acc[agent.category] || 0) + 1;
      return acc;
    }, {});
    
    console.log('\\n📊 에이전트 유형별 통계:');
    Object.entries(categoryStats).forEach(([category, count]) => {
      console.log(`  - ${category}: ${count}개`);
    });
    
    console.log('\\n🎉 강제 에이전트 데이터 교체 완료!');
    console.log('서버를 재시작하면 final_agents.json이 로드되어 올바른 조직 정보로 업데이트됩니다.');
    
  } catch (error) {
    console.error('❌ 강제 에이전트 데이터 교체 중 오류:', error);
    throw error;
  }
}

forceReplaceAgents().catch(console.error);