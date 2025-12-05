import xlsx from 'xlsx';

async function checkAgentInfo() {
  try {
    console.log('📋 Excel 파일에서 화학과 멘토링 Q&A 에이전트 정보 확인 중...');
    
    // 새 Excel 파일 읽기
    const workbook = xlsx.readFile('attached_assets/AI 에이전트 0627_2_1751056559643.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // JSON으로 변환
    const jsonData = xlsx.utils.sheet_to_json(worksheet);
    console.log(`📊 Excel에서 ${jsonData.length}개의 에이전트 데이터를 읽었습니다.`);
    
    // 화학과 멘토링 Q&A 에이전트 찾기
    const agent = jsonData.find(row => 
      row.name && row.name.includes('화학과') && row.name.includes('멘토링')
    );
    
    if (agent) {
      console.log('\n=== 화학과 멘토링 Q&A 에이전트 정보 (Excel 원본) ===');
      console.log('이름:', agent.name);
      console.log('설명:', agent.description);
      console.log('상위 조직 (upperCategory):', agent.upperCategory);
      console.log('하위 조직 (lowerCategory):', agent.lowerCategory);
      console.log('세부 조직 (detailCategory):', agent.detailCategory);
      console.log('유형:', agent['유형']);
      console.log('관리자 ID:', agent.managerId);
      console.log('상태:', agent.status);
      console.log('활성 여부:', agent.isActive);
      
      // 전체 데이터 구조도 출력
      console.log('\n=== 전체 필드 정보 ===');
      Object.keys(agent).forEach(key => {
        console.log(`${key}: ${agent[key]}`);
      });
      
    } else {
      console.log('\n❌ 화학과 멘토링 Q&A 에이전트를 찾을 수 없습니다.');
      
      // 화학 관련 에이전트들 찾기
      const chemicalAgents = jsonData.filter(row => 
        row.name && row.name.includes('화학')
      );
      
      if (chemicalAgents.length > 0) {
        console.log('\n🔍 화학 관련 에이전트들:');
        chemicalAgents.forEach(agent => {
          console.log(`- ${agent.name} (${agent.upperCategory} > ${agent.lowerCategory} > ${agent.detailCategory})`);
        });
      }
      
      // 멘토링 관련 에이전트들 찾기
      const mentoringAgents = jsonData.filter(row => 
        row.name && row.name.includes('멘토링')
      );
      
      if (mentoringAgents.length > 0) {
        console.log('\n🔍 멘토링 관련 에이전트들:');
        mentoringAgents.forEach(agent => {
          console.log(`- ${agent.name} (${agent.upperCategory} > ${agent.lowerCategory} > ${agent.detailCategory})`);
        });
      }
    }
    
  } catch (error) {
    console.error('❌ 파일 읽기 중 오류:', error);
  }
}

checkAgentInfo().catch(console.error);