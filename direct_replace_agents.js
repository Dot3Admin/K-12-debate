import xlsx from 'xlsx';
import fs from 'fs';

async function directReplaceAgents() {
  try {
    console.log('🔄 직접 에이전트 데이터 교체 시작...');
    
    // Excel 파일 읽기
    const workbook = xlsx.readFile('attached_assets/AI 에이전트 0627_2_1751056559643.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet);
    
    console.log(`📊 Excel에서 ${jsonData.length}개의 에이전트 데이터를 읽었습니다.`);
    
    // 에이전트 데이터 변환
    const agents = jsonData.map((row, index) => {
      const id = parseInt(row.id) || (100 + index + 1);
      const name = (row.name || `에이전트 ${index + 1}`).toString().trim();
      const description = (row.description || '').toString().trim();
      
      // 올바른 조직 정보 매핑
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
    
    // 기존 데이터 완전 교체
    const agentDataPath = 'data/memory-storage-agents.json';
    
    // 새 데이터로 저장 (ID를 키로 사용)
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
    
    console.log('\\n🎉 에이전트 데이터 직접 교체가 완료되었습니다!');
    console.log('서버를 재시작하면 새 데이터가 로드됩니다.');
    
  } catch (error) {
    console.error('❌ 에이전트 데이터 교체 중 오류:', error);
    throw error;
  }
}

directReplaceAgents().catch(console.error);