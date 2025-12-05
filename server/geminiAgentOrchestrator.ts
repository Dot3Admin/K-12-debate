import { GoogleGenerativeAI, FunctionDeclaration, Tool, SchemaType } from '@google/generative-ai';
import { searchDocumentChunks } from './documentProcessor';
import { searchWithCache } from './search/searchClient';
import { saveWebSearchAsDocument } from './webSearchDocumenter';

// ⚠️ API Key validation
if (!process.env.GEMINI_API_KEY) {
  console.error('[❌ GEMINI] GEMINI_API_KEY not found in environment variables');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// ⏱️ Timeout constants
const FUNCTION_CALL_TIMEOUT_MS = 15000; // 15초
const TOTAL_TIMEOUT_MS = 30000; // 30초

/**
 * 🎯 Gemini Function Calling 기반 응답 생성 시스템
 * 
 * 3단계 판단 로직:
 * 1. 전문 영역 → RAG + 내장 지식
 * 2. 본인·가족·주요 관련 인물 → Google Search (Fact-Check 포함)
 * 3. 무관한 영역 → 거절
 */

// 📋 Function Declarations for Gemini
const searchDocumentsFunction: FunctionDeclaration = {
  name: 'search_documents',
  description: '업로드된 문서 데이터베이스(RAG)에서 관련 정보를 검색합니다. 전문 영역 질문이나 과거 발언/사건에 대한 정보가 필요할 때 사용하세요.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: {
        type: SchemaType.STRING,
        description: '검색할 키워드 또는 질문'
      }
    },
    required: ['query']
  }
};

const searchWebFunction: FunctionDeclaration = {
  name: 'search_web',
  description: 'Google Search를 통해 최신 뉴스와 정보를 검색합니다. 본인 또는 가족/주요 관련 인물에 대한 최신 논란, 사건, 뉴스를 확인할 때 **반드시** 사용해야 합니다. 사용자 질문의 전제(예: "감옥 갔다며?")가 사실인지 확인하는 Fact-Check에도 필수입니다.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: {
        type: SchemaType.STRING,
        description: '검색할 키워드 (예: "[인물명] 최신 뉴스", "[인물명] 구속 여부")'
      }
    },
    required: ['query']
  }
};

const tools: Tool[] = [{
  functionDeclarations: [searchDocumentsFunction, searchWebFunction]
}];

/**
 * 🧠 System Instruction 생성
 */
function generateSystemInstruction(
  agentName: string,
  agentDescription: string,
  knowledgeDomain: string,
  userLanguage: string = 'ko'
): string {
  return `## 역할 정의 (Role Definition)
당신은 "${agentName}"의 페르소나를 가진 AI 챗봇입니다. 당신의 핵심 전문 분야는 "${knowledgeDomain}"입니다.

## 판단 및 행동 지침 (Decision Logic)
사용자의 질문을 분석하여 다음 세 가지 카테고리 중 하나로 분류하고, 각 지침에 따라 엄격히 행동하십시오.

### 1. 전문 분야 관련 질문 (Domain Expertise)
**조건:** 질문이 "${knowledgeDomain}"에 대한 지식, 견해, 분석을 요구하는 경우.

**행동:**
- \`search_documents()\` 도구를 사용하여 관련 문서를 검색할 수 있습니다.
- 학습된 지식과 검색된 문서를 활용하여 전문가로서의 통찰력 있는 답변을 제공하십시오.

**어조:** 전문적이고 자신감 있는 태도.

### 2. 본인, 가족 및 주요 관련 인물 이슈 (Personal, Family & Associates)
**조건:**
1. 본인("${agentName}") 및 가족.
2. **언론에 보도된 주요 지인이나 측근** (사회적 논란, 법적 공방, 정치적 이슈로 인해 당신과 함께 이름이 거론되는 인물).

**행동:**
1. **\`search_web()\` 도구를 반드시 호출**하여 최신 기사와 사실 관계를 확인하십시오.
2. **전제 확인(Fact-Check):**
   - **사실인 경우:** 검색된 기사를 인용하여 "언론 보도에 따르면 [날짜]에 [사법 조치]가 취해진 것으로 알려져 있습니다"라고 객관적으로 답하십시오.
   - **거짓인 경우:** "확인해 본 결과, 현재 해당 내용(감옥, 구속 등)은 언론에 보도된 바 없으며 사실이 아닌 것으로 보입니다"라고 **사용자의 오류를 정정**하십시오.
3. **거리 두기 (Distancing):**
   - 지인을 '친한 친구'나 '소중한 지인'으로 묘사하여 감정적 친밀감을 드러내지 마십시오.
   - 철저하게 **'뉴스에 등장하는 제3자'**로서 건조하게 지칭하십시오.
   - "언론 보도에 따르면...", "현재 알려진 바에 의하면..."과 같은 인용 문구를 사용하십시오.
4. **비공개 인물 거절:**
   - 검색 결과에 나오지 않는 일반인 친구에 대해 묻는다면 "그분은 공인이 아니거나 언론에 알려진 바 없어 제가 말씀드릴 정보가 없습니다"라고 보호하십시오.

**중요:** 개인적인 감정, 억울함 호소, 혹은 법적 판단에 대한 주관적 의견은 절대 포함하지 마십시오. 제3자적 관찰자 시점을 유지하십시오.

### 3. 그 외 관련 없는 질문 (Out of Scope)
**조건:** 위 두 가지에 해당하지 않는 질문 (예: 주식 투자 조언, 코딩, 무관한 과학 지식 등).

**행동:** 정중하게 답변을 거절하십시오.

**예시:** "죄송하지만, 그 부분은 제 전문 분야인 ${knowledgeDomain}와 관련이 없어 답변드리기 어렵습니다."

## 주의 사항 (Critical Safety Rules)
- **거짓 정보 금지:** 모르는 사실을 지어내지 마십시오. 최신 이슈는 반드시 \`search_web()\` 도구를 통해 검증된 내용만 말하십시오.
- **중립성 유지:** 민감한 논란에 대해서는 방어적이거나 공격적인 태도를 취하지 말고, 뉴스 앵커가 사실을 브리핑하듯 건조하게 전달하십시오.
- **언어:** ${userLanguage === 'ko' ? '한국어' : 'English'}로 답변하십시오.

## 도구 사용 규칙
- 전문 영역 질문 → \`search_documents()\` 사용 가능 (선택)
- 본인/가족/지인 관련 질문 → \`search_web()\` **필수 사용**
- 무관한 질문 → 도구 사용 없이 거절`;
}

/**
 * 🔧 Function Call Handler: search_documents
 */
async function handleSearchDocuments(
  agentId: number,
  query: string
): Promise<string> {
  console.log(`[🔍 search_documents] agentId=${agentId}, query="${query}"`);
  
  try {
    const chunks = await searchDocumentChunks(agentId, query, 5);
    
    if (chunks.length === 0) {
      return '관련 문서를 찾을 수 없습니다.';
    }
    
    const results = chunks.map((chunk: any, index: number) => {
      return `[문서 ${index + 1}] (관련도: ${chunk.score?.toFixed(2) || 'N/A'})\n${chunk.content}`;
    }).join('\n\n');
    
    console.log(`[✅ search_documents] ${chunks.length}개 문서 발견`);
    return `다음은 관련 문서 검색 결과입니다:\n\n${results}`;
  } catch (error) {
    console.error(`[❌ search_documents Error]`, error);
    return '문서 검색 중 오류가 발생했습니다.';
  }
}

/**
 * 🔧 Function Call Handler: search_web
 */
async function handleSearchWeb(
  agentId: number,
  agentName: string,
  query: string
): Promise<string> {
  console.log(`[🌐 search_web] agentId=${agentId}, query="${query}"`);
  
  try {
    const searchResults = await searchWithCache(agentId, query, '');
    
    if (!searchResults || searchResults.length === 0) {
      return '관련 뉴스를 찾을 수 없습니다.';
    }
    
    console.log(`[✅ search_web] ${searchResults.length}개 검색 결과 발견`);
    
    const results = searchResults.slice(0, 5).map((result, index: number) => {
      return `[검색 결과 ${index + 1}]\n제목: ${result.title}\n내용: ${result.snippet}\n출처: ${result.url}`;
    }).join('\n\n');
    
    // 백그라운드에서 자동 문서화 (Smart TTL 적용)
    const webSearchResults = searchResults.map(result => ({
      title: result.title,
      snippet: result.snippet || '',
      url: result.url
    }));
    saveWebSearchAsDocument(agentId, query, webSearchResults, 'system').catch(err => {
      console.error('[❌ Web→Doc] 백그라운드 문서화 실패:', err);
    });
    
    return `다음은 구글 검색 결과입니다:\n\n${results}`;
  } catch (error) {
    console.error(`[❌ search_web Error]`, error);
    return '검색 중 오류가 발생했습니다.';
  }
}

/**
 * 🎯 Gemini Function Calling 기반 응답 생성
 */
export async function generateGeminiFunctionCallingResponse(params: {
  agentId: number;
  agentName: string;
  agentDescription: string;
  knowledgeDomain: string;
  userQuestion: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  userLanguage?: string;
}): Promise<{
  content: string;
  toolsUsed: string[];
  factCheckPerformed: boolean;
  stagesTaken: string[];
}> {
  const {
    agentId,
    agentName,
    agentDescription,
    knowledgeDomain,
    userQuestion,
    conversationHistory = [],
    userLanguage = 'ko'
  } = params;

  console.log(`[🤖 Gemini Function Calling] 시작 - Agent: ${agentName}, Question: "${userQuestion.slice(0, 50)}..."`);

  const systemInstruction = generateSystemInstruction(
    agentName,
    agentDescription,
    knowledgeDomain,
    userLanguage
  );

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction,
    tools
  });

  const toolsUsed: string[] = [];
  const stagesTaken: string[] = [];
  let factCheckPerformed = false;

  try {
    // 대화 히스토리 구성
    const chat = model.startChat({
      history: conversationHistory.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }))
    });

    // 첫 번째 요청
    let result = await chat.sendMessage(userQuestion);
    let response = result.response;

    // Function calling 처리 (최대 3회 반복)
    let iterationCount = 0;
    const MAX_ITERATIONS = 3;

    while (response.functionCalls && response.functionCalls() && iterationCount < MAX_ITERATIONS) {
      iterationCount++;
      const functionCalls = response.functionCalls();
      if (!functionCalls) break;
      
      console.log(`[🔧 Function Calls] ${functionCalls.length}개 함수 호출 (반복 ${iterationCount}/${MAX_ITERATIONS})`);

      const functionResponses = [];

      for (const call of functionCalls) {
        const functionName = call.name;
        const args = call.args as Record<string, any>;

        console.log(`[📞 Calling] ${functionName}(${JSON.stringify(args)})`);
        toolsUsed.push(functionName);

        let functionResult: string;

        if (functionName === 'search_documents') {
          stagesTaken.push('RAG');
          functionResult = await handleSearchDocuments(agentId, args.query as string);
        } else if (functionName === 'search_web') {
          stagesTaken.push('Web');
          factCheckPerformed = true;
          functionResult = await handleSearchWeb(agentId, agentName, args.query as string);
        } else {
          functionResult = '알 수 없는 함수입니다.';
        }

        functionResponses.push({
          functionResponse: {
            name: functionName,
            response: { result: functionResult }
          }
        });
      }

      // Function 결과와 함께 다시 요청
      result = await chat.sendMessage(functionResponses);
      response = result.response;
    }

    // 최종 텍스트 응답
    const finalText = response.text();

    if (stagesTaken.length === 0) {
      stagesTaken.push('Internal'); // 도구 사용 없이 내부 지식만 사용
    }

    console.log(`[✅ Gemini Function Calling 완료] Tools: ${toolsUsed.join(', ')}, Stages: ${stagesTaken.join(' → ')}`);

    return {
      content: finalText,
      toolsUsed,
      factCheckPerformed,
      stagesTaken
    };

  } catch (error) {
    console.error(`[❌ Gemini Function Calling Error]`, error);
    throw error;
  }
}
