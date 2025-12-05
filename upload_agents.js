import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

// 에이전트 데이터 업로드 스크립트
async function uploadAgentData() {
  try {
    console.log('🚀 에이전트 데이터 업로드 시작...');
    
    // Excel 파일 읽기
    const filePath = './new_agent_data.xlsx';
    if (!fs.existsSync(filePath)) {
      console.error('❌ 파일을 찾을 수 없습니다:', filePath);
      return;
    }
    
    console.log('📊 Excel 파일 읽는 중...');
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const agents = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📋 발견된 에이전트 수: ${agents.length}`);
    
    // 에이전트 데이터 변환
    const processedAgents = agents.map((agent, index) => {
      const processedAgent = {
        name: agent['에이전트명'] || agent.name || `에이전트_${index + 1}`,
        description: agent['설명'] || agent.description || agent['기능설명'] || '',
        category: agent['카테고리'] || agent.category || agent['분류'] || '기능',
        icon: agent['아이콘'] || agent.icon || 'Bot',
        backgroundColor: agent['배경색'] || agent.backgroundColor || '#3B82F6',
        isActive: true,
        managerId: agent['관리자ID'] || agent.managerId || 'prof001',
        organizationId: agent['조직ID'] || agent.organizationId || 1,
        persona: agent['페르소나'] || agent.persona || '',
        systemPrompt: agent['시스템프롬프트'] || agent.systemPrompt || '',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      console.log(`처리된 에이전트 ${index + 1}: ${processedAgent.name}`);
      return processedAgent;
    });
    
    // API 호출을 통한 업로드
    const FormData = require('form-data');
    const fetch = require('node-fetch');
    
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('clearExisting', 'true'); // 기존 에이전트 삭제
    formData.append('validateOnly', 'false');
    
    console.log('🔄 API 호출 중...');
    const response = await fetch('http://localhost:5000/api/admin/agents/upload', {
      method: 'POST',
      body: formData,
      headers: {
        'Cookie': 'connect.sid=s%3A' // 세션 쿠키가 필요할 수 있음
      }
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ 업로드 성공:', result.message);
      console.log(`📊 생성된 에이전트: ${result.created}개`);
      console.log(`❌ 오류: ${result.errors}개`);
    } else {
      console.error('❌ 업로드 실패:', response.status, response.statusText);
    }
    
  } catch (error) {
    console.error('❌ 오류 발생:', error);
  }
}

// 직접 메모리 스토리지에 에이전트 추가하는 방법
async function directUpload() {
  try {
    console.log('🚀 직접 업로드 시작...');
    
    // Excel 파일 읽기
    const filePath = './new_agent_data.xlsx';
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const agents = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📋 발견된 에이전트 수: ${agents.length}`);
    
    // 메모리 스토리지 직접 조작을 위한 파일 생성
    const agentData = agents.map((agent, index) => ({
      id: index + 1,
      name: agent['에이전트명'] || agent.name || `에이전트_${index + 1}`,
      description: agent['설명'] || agent.description || agent['기능설명'] || '',
      category: agent['카테고리'] || agent.category || agent['분류'] || '기능',
      icon: agent['아이콘'] || agent.icon || 'Bot',
      backgroundColor: agent['배경색'] || agent.backgroundColor || '#3B82F6',
      isActive: true,
      status: 'active',
      managerId: agent['관리자ID'] || agent.managerId || 'prof001',
      organizationId: agent['조직ID'] || agent.organizationId || 1,
      persona: agent['페르소나'] || agent.persona || '',
      systemPrompt: agent['시스템프롬프트'] || agent.systemPrompt || '',
      visibility: 'public',
      isCustomIcon: false,
      maxInputLength: 1000,
      responseStyle: 'default',
      llmModel: 'gpt-4o',
      chatbotType: 'general-llm',
      upperCategory: null,
      lowerCategory: null,
      documentManagerIds: [],
      agentEditorIds: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    
    // JSON 파일로 저장
    fs.writeFileSync('./new_agents.json', JSON.stringify(agentData, null, 2), 'utf8');
    console.log('✅ 에이전트 데이터를 new_agents.json에 저장했습니다.');
    console.log(`📊 총 ${agentData.length}개 에이전트 처리됨`);
    
    // 처리된 에이전트 목록 출력
    agentData.forEach((agent, index) => {
      console.log(`${index + 1}. ${agent.name} (${agent.category})`);
    });
    
  } catch (error) {
    console.error('❌ 오류 발생:', error);
  }
}

// 실행
directUpload();