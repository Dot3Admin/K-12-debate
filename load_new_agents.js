import fs from 'fs';

// 새 에이전트 데이터를 메모리 스토리지에 직접 로드하는 스크립트
async function loadNewAgents() {
  try {
    console.log('🚀 새 에이전트 데이터 로드 시작...');
    
    // JSON 파일 읽기
    const agentData = JSON.parse(fs.readFileSync('./new_agents.json', 'utf8'));
    console.log(`📋 로드된 에이전트 수: ${agentData.length}`);
    
    // 기존 에이전트 삭제 및 새 에이전트 추가 API 호출
    const response = await fetch('http://localhost:5000/api/admin/agents/clear-and-load', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agents: agentData })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ 에이전트 데이터 교체 성공:', result.message);
      console.log(`📊 총 ${result.count}개 에이전트가 시스템에 추가되었습니다.`);
    } else {
      console.error('❌ 에이전트 데이터 교체 실패:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('오류 상세:', errorText);
    }
    
  } catch (error) {
    console.error('❌ 오류 발생:', error);
  }
}

loadNewAgents();