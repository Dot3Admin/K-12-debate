import fs from 'fs';

async function replaceAllAgents() {
  try {
    console.log('🔄 기존 에이전트 데이터 완전 교체 시작...');
    
    // 저장된 최종 에이전트 데이터 로드
    if (!fs.existsSync('./final_agents.json')) {
      console.log('❌ final_agents.json 파일을 찾을 수 없습니다.');
      return;
    }

    const finalAgents = JSON.parse(fs.readFileSync('./final_agents.json', 'utf-8'));
    console.log(`📊 ${finalAgents.length}개의 새 에이전트 데이터를 로드했습니다.`);

    // 서버 측 교체 API 호출
    const response = await fetch('http://localhost:5000/api/admin/agents/replace-all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agents: finalAgents })
    });

    if (response.ok) {
      const result = await response.json();
      console.log('✅ 에이전트 데이터 교체 완료:', result.message);
      console.log(`📈 총 ${result.totalAgents}개의 에이전트가 시스템에 적용되었습니다.`);
    } else {
      console.log('❌ 에이전트 교체 실패:', response.statusText);
    }

  } catch (error) {
    console.error('❌ 에이전트 교체 중 오류 발생:', error);
  }
}

// 스크립트가 직접 실행되는 경우
if (import.meta.url === `file://${process.argv[1]}`) {
  replaceAllAgents();
}

export default replaceAllAgents;