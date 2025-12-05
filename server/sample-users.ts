export const sampleUsers = [
  // 대학본부 직원들 (40명)
  // 총장실 (8명)
  {
    id: "ADM001", username: "ADM001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "김총장", email: "president@university.edu", userType: "faculty",
    upperCategory: "대학본부", lowerCategory: "총장실", detailCategory: "총장비서실",
    role: "operation_admin", position: "총장", status: "active"
  },
  {
    id: "ADM002", username: "ADM002", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "이비서", email: "secretary@university.edu", userType: "faculty",
    upperCategory: "대학본부", lowerCategory: "총장실", detailCategory: "총장비서실",
    role: "user", position: "비서실장", status: "active"
  },
  {
    id: "ADM003", username: "ADM003", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "박협력", email: "cooperation@university.edu", userType: "faculty",
    upperCategory: "대학본부", lowerCategory: "총장실", detailCategory: "대외협력팀",
    role: "user", position: "팀장", status: "active"
  },
  {
    id: "ADM004", username: "ADM004", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "최홍보", email: "pr@university.edu", userType: "faculty",
    upperCategory: "대학본부", lowerCategory: "총장실", detailCategory: "홍보팀",
    role: "user", position: "팀장", status: "active"
  },
  {
    id: "ADM005", username: "ADM005", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "정기획", email: "planning@university.edu", userType: "faculty",
    upperCategory: "대학본부", lowerCategory: "기획처", detailCategory: "기획예산팀",
    role: "operation_admin", position: "처장", status: "active"
  },
  {
    id: "ADM006", username: "ADM006", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "한평가", email: "evaluation@university.edu", userType: "faculty",
    upperCategory: "대학본부", lowerCategory: "기획처", detailCategory: "평가관리팀",
    role: "user", position: "팀장", status: "active"
  },
  {
    id: "ADM007", username: "ADM007", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "송IR", email: "ir@university.edu", userType: "faculty",
    upperCategory: "대학본부", lowerCategory: "기획처", detailCategory: "IR팀",
    role: "user", position: "팀장", status: "active"
  },
  {
    id: "ADM008", username: "ADM008", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "오교무", email: "academic@university.edu", userType: "faculty",
    upperCategory: "대학본부", lowerCategory: "교무처", detailCategory: "교무팀",
    role: "operation_admin", position: "처장", status: "active"
  },

  // 대학본부 나머지 직원들 (32명)
  {
    id: "ADM009", username: "ADM009", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "김학사", email: "academic1@university.edu", userType: "faculty",
    upperCategory: "대학본부", lowerCategory: "교무처", detailCategory: "학사관리팀",
    role: "user", position: "팀장", status: "active"
  },
  {
    id: "ADM010", username: "ADM010", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "이수업", email: "class@university.edu", userType: "faculty",
    upperCategory: "대학본부", lowerCategory: "교무처", detailCategory: "수업관리팀",
    role: "user", position: "팀장", status: "active"
  },
  {
    id: "ADM011", username: "ADM011", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "박학생", email: "student@university.edu", userType: "faculty",
    upperCategory: "대학본부", lowerCategory: "학생처", detailCategory: "학생지원팀",
    role: "operation_admin", position: "처장", status: "active"
  },

  // 학사부서 직원들 (35명)
  {
    id: "ACA001", username: "ACA001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "최입학", email: "admission@university.edu", userType: "faculty",
    upperCategory: "학사부서", lowerCategory: "입학처", detailCategory: "입학사정팀",
    role: "operation_admin", position: "처장", status: "active"
  },
  {
    id: "ACA002", username: "ACA002", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "정전형", email: "admission1@university.edu", userType: "faculty",
    upperCategory: "학사부서", lowerCategory: "입학처", detailCategory: "입학전형팀",
    role: "user", position: "팀장", status: "active"
  },
  {
    id: "ACA003", username: "ACA003", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "한홍보", email: "admission2@university.edu", userType: "faculty",
    upperCategory: "학사부서", lowerCategory: "입학처", detailCategory: "입학홍보팀",
    role: "user", position: "팀장", status: "active"
  },

  // 인문대학 구성원들 (50명)
  // 국어국문학과 (15명)
  {
    id: "HUM001", username: "HUM001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "김국문", email: "korean@university.edu", userType: "faculty",
    upperCategory: "인문대학", lowerCategory: "국어국문학과", detailCategory: "현대문학전공",
    role: "user", position: "교수", status: "active"
  },
  {
    id: "HUM002", username: "HUM002", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "이고전", email: "classic@university.edu", userType: "faculty",
    upperCategory: "인문대학", lowerCategory: "국어국문학과", detailCategory: "고전문학전공",
    role: "user", position: "부교수", status: "active"
  },
  {
    id: "2024101001", username: "2024101001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "박학생", email: "student101@university.edu", userType: "student",
    upperCategory: "인문대학", lowerCategory: "국어국문학과", detailCategory: "현대문학전공",
    role: "user", position: "학부생", status: "active"
  },
  {
    id: "2024101002", username: "2024101002", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "최문학", email: "student102@university.edu", userType: "student",
    upperCategory: "인문대학", lowerCategory: "국어국문학과", detailCategory: "고전문학전공",
    role: "user", position: "학부생", status: "active"
  },

  // 영어영문학과 (12명)
  {
    id: "HUM010", username: "HUM010", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "Smith교수", email: "english@university.edu", userType: "faculty",
    upperCategory: "인문대학", lowerCategory: "영어영문학과", detailCategory: "영문학전공",
    role: "user", position: "교수", status: "active"
  },
  {
    id: "HUM011", username: "HUM011", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "Johnson교수", email: "linguistics@university.edu", userType: "faculty",
    upperCategory: "인문대학", lowerCategory: "영어영문학과", detailCategory: "영어학전공",
    role: "user", position: "부교수", status: "active"
  },
  {
    id: "2024102001", username: "2024102001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "김영어", email: "student201@university.edu", userType: "student",
    upperCategory: "인문대학", lowerCategory: "영어영문학과", detailCategory: "영문학전공",
    role: "user", position: "학부생", status: "active"
  },

  // 사회과학대학 구성원들 (60명)
  // 정치외교학과
  {
    id: "SOC001", username: "SOC001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "김정치", email: "politics@university.edu", userType: "faculty",
    upperCategory: "사회과학대학", lowerCategory: "정치외교학과", detailCategory: "정치학전공",
    role: "user", position: "교수", status: "active"
  },
  {
    id: "SOC002", username: "SOC002", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "이외교", email: "diplomacy@university.edu", userType: "faculty",
    upperCategory: "사회과학대학", lowerCategory: "정치외교학과", detailCategory: "외교학전공",
    role: "user", position: "부교수", status: "active"
  },
  {
    id: "2024201001", username: "2024201001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "박정외", email: "student301@university.edu", userType: "student",
    upperCategory: "사회과학대학", lowerCategory: "정치외교학과", detailCategory: "정치학전공",
    role: "user", position: "학부생", status: "active"
  },

  // 자연과학대학 구성원들 (50명)
  // 수학과
  {
    id: "SCI001", username: "SCI001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "오수학", email: "math@university.edu", userType: "faculty",
    upperCategory: "자연과학대학", lowerCategory: "수학과", detailCategory: "순수수학전공",
    role: "user", position: "교수", status: "active"
  },
  {
    id: "SCI002", username: "SCI002", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "유응용", email: "applied@university.edu", userType: "faculty",
    upperCategory: "자연과학대학", lowerCategory: "수학과", detailCategory: "응용수학전공",
    role: "user", position: "부교수", status: "active"
  },
  {
    id: "2024401001", username: "2024401001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "김수리", email: "student401@university.edu", userType: "student",
    upperCategory: "자연과학대학", lowerCategory: "수학과", detailCategory: "순수수학전공",
    role: "user", position: "학부생", status: "active"
  },

  // 공과대학 구성원들 (70명)
  // 컴퓨터공학과 (25명)
  {
    id: "ENG001", username: "ENG001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "김컴공", email: "cs@university.edu", userType: "faculty",
    upperCategory: "공과대학", lowerCategory: "컴퓨터공학과", detailCategory: "소프트웨어공학전공",
    role: "agent_admin", position: "교수", status: "active"
  },
  {
    id: "ENG002", username: "ENG002", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "이AI", email: "ai@university.edu", userType: "faculty",
    upperCategory: "공과대학", lowerCategory: "컴퓨터공학과", detailCategory: "인공지능전공",
    role: "user", position: "부교수", status: "active"
  },
  {
    id: "ENG003", username: "ENG003", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "박데이터", email: "data@university.edu", userType: "faculty",
    upperCategory: "공과대학", lowerCategory: "컴퓨터공학과", detailCategory: "데이터사이언스전공",
    role: "user", position: "조교수", status: "active"
  },
  // 컴공과 학생들 (22명)
  {
    id: "2024501001", username: "2024501001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "최코딩", email: "student501@university.edu", userType: "student",
    upperCategory: "공과대학", lowerCategory: "컴퓨터공학과", detailCategory: "소프트웨어공학전공",
    role: "user", position: "학부생", status: "active"
  },
  {
    id: "2024501002", username: "2024501002", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "정알고", email: "student502@university.edu", userType: "student",
    upperCategory: "공과대학", lowerCategory: "컴퓨터공학과", detailCategory: "인공지능전공",
    role: "user", position: "학부생", status: "active"
  },

  // 경영대학 구성원들 (45명)
  {
    id: "BUS001", username: "BUS001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "김경영", email: "management@university.edu", userType: "faculty",
    upperCategory: "경영대학", lowerCategory: "경영학과", detailCategory: "경영전략전공",
    role: "user", position: "교수", status: "active"
  },
  {
    id: "BUS002", username: "BUS002", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "이마케팅", email: "marketing@university.edu", userType: "faculty",
    upperCategory: "경영대학", lowerCategory: "경영학과", detailCategory: "마케팅전공",
    role: "user", position: "부교수", status: "active"
  },
  {
    id: "2024601001", username: "2024601001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "박경영", email: "student601@university.edu", userType: "student",
    upperCategory: "경영대학", lowerCategory: "경영학과", detailCategory: "경영전략전공",
    role: "user", position: "학부생", status: "active"
  },

  // 의과대학 구성원들 (40명)
  {
    id: "MED001", username: "MED001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "김의사", email: "doctor@university.edu", userType: "faculty",
    upperCategory: "의과대학", lowerCategory: "의학과", detailCategory: "내과학전공",
    role: "user", position: "교수", status: "active"
  },
  {
    id: "MED002", username: "MED002", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "이외과", email: "surgery@university.edu", userType: "faculty",
    upperCategory: "의과대학", lowerCategory: "의학과", detailCategory: "외과학전공",
    role: "user", position: "부교수", status: "active"
  },
  {
    id: "2024701001", username: "2024701001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "박의대", email: "student701@university.edu", userType: "student",
    upperCategory: "의과대학", lowerCategory: "의학과", detailCategory: "내과학전공",
    role: "user", position: "의대생", status: "active"
  },

  // 대학원생들 (30명)
  {
    id: "GRAD001", username: "GRAD001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "김박사", email: "phd@university.edu", userType: "student",
    upperCategory: "대학원", lowerCategory: "일반대학원", detailCategory: "박사과정",
    role: "user", position: "박사과정", status: "active"
  },
  {
    id: "GRAD002", username: "GRAD002", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "이석사", email: "master@university.edu", userType: "student",
    upperCategory: "대학원", lowerCategory: "일반대학원", detailCategory: "석사과정",
    role: "user", position: "석사과정", status: "active"
  },

  // 연구기관 구성원들 (30명)
  {
    id: "RES001", username: "RES001", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "김연구", email: "research@university.edu", userType: "faculty",
    upperCategory: "연구기관", lowerCategory: "중앙연구소", detailCategory: "기초과학연구소",
    role: "user", position: "연구소장", status: "active"
  },
  {
    id: "RES002", username: "RES002", password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
    name: "이응용", email: "applied@university.edu", userType: "faculty",
    upperCategory: "연구기관", lowerCategory: "중앙연구소", detailCategory: "응용과학연구소",
    role: "user", position: "선임연구원", status: "active"
  }
];

// 추가 샘플 사용자들을 생성하는 함수
export function generateAdditionalUsers(): any[] {
  const additionalUsers = [];
  let userIdCounter = 1000;

  // 각 카테고리별로 추가 사용자 생성
  const categories = [
    { upper: "인문대학", lower: "국어국문학과", detail: "현대문학전공", count: 15 },
    { upper: "인문대학", lower: "영어영문학과", detail: "영문학전공", count: 12 },
    { upper: "인문대학", lower: "사학과", detail: "한국사전공", count: 10 },
    { upper: "사회과학대학", lower: "정치외교학과", detail: "정치학전공", count: 20 },
    { upper: "사회과학대학", lower: "행정학과", detail: "일반행정전공", count: 15 },
    { upper: "사회과학대학", lower: "심리학과", detail: "임상심리전공", count: 18 },
    { upper: "자연과학대학", lower: "물리학과", detail: "이론물리전공", count: 16 },
    { upper: "자연과학대학", lower: "화학과", detail: "유기화학전공", count: 14 },
    { upper: "자연과학대학", lower: "생명과학과", detail: "분자생물학전공", count: 15 },
    { upper: "공과대학", lower: "전자공학과", detail: "반도체공학전공", count: 22 },
    { upper: "공과대학", lower: "기계공학과", detail: "설계공학전공", count: 20 },
    { upper: "공과대학", lower: "건축학과", detail: "건축설계전공", count: 18 },
    { upper: "경영대학", lower: "회계학과", detail: "재무회계전공", count: 16 },
    { upper: "경영대학", lower: "경제학과", detail: "미시경제전공", count: 14 },
    { upper: "의과대학", lower: "간호학과", detail: "성인간호전공", count: 15 },
    { upper: "의과대학", lower: "약학과", detail: "임상약학전공", count: 12 },
    { upper: "대학원", lower: "특수대학원", detail: "경영대학원", count: 10 },
    { upper: "대학원", lower: "전문대학원", detail: "의학전문대학원", count: 8 },
    { upper: "연구기관", lower: "인문사회연구소", detail: "인문학연구소", count: 6 },
    { upper: "연구기관", lower: "공학연구소", detail: "신소재연구소", count: 8 }
  ];

  const positions = ["학부생", "대학원생", "박사과정", "석사과정", "연구원", "교수", "부교수", "조교수", "학과장", "연구소장"];
  const names = ["김", "이", "박", "최", "정", "한", "송", "오", "조", "윤", "장", "임", "서", "강", "유", "신"];
  const suffixes = ["철수", "영희", "민수", "지영", "현우", "수연", "진호", "은지", "성민", "혜진"];

  categories.forEach(category => {
    for (let i = 0; i < category.count; i++) {
      userIdCounter++;
      const name = names[Math.floor(Math.random() * names.length)] + suffixes[Math.floor(Math.random() * suffixes.length)];
      const position = positions[Math.floor(Math.random() * positions.length)];
      const userType = position.includes("교수") || position.includes("연구원") ? "faculty" : "student";

      // 직책에 따른 시스템 역할 결정
      let systemRole = "user";
      if (position === "교수" || position === "학과장" || position === "연구소장") {
        systemRole = "operation_admin";
      } else if (position === "부교수" || position === "조교수") {
        systemRole = "agent_admin";
      }

      additionalUsers.push({
        id: `USR${userIdCounter.toString().padStart(4, '0')}`,
        username: `USR${userIdCounter.toString().padStart(4, '0')}`,
        password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO",
        name: name,
        email: `user${userIdCounter}@university.edu`,
        userType: userType,
        upperCategory: category.upper,
        lowerCategory: category.lower,
        detailCategory: category.detail,
        role: systemRole,
        position: position,
        status: "active"
      });
    }
  });

  return additionalUsers;
}

// 전체 사용자 데이터 (기본 + 추가)
export const allSampleUsers = [...sampleUsers, ...generateAdditionalUsers()];

// 카테고리별 통계
export const userCategoryStats = {
  총개수: allSampleUsers.length,
  상위카테고리별: {
    "대학본부": allSampleUsers.filter(u => u.upperCategory === "대학본부").length,
    "학사부서": allSampleUsers.filter(u => u.upperCategory === "학사부서").length,
    "인문대학": allSampleUsers.filter(u => u.upperCategory === "인문대학").length,
    "사회과학대학": allSampleUsers.filter(u => u.upperCategory === "사회과학대학").length,
    "자연과학대학": allSampleUsers.filter(u => u.upperCategory === "자연과학대학").length,
    "공과대학": allSampleUsers.filter(u => u.upperCategory === "공과대학").length,
    "경영대학": allSampleUsers.filter(u => u.upperCategory === "경영대학").length,
    "의과대학": allSampleUsers.filter(u => u.upperCategory === "의과대학").length,
    "대학원": allSampleUsers.filter(u => u.upperCategory === "대학원").length,
    "연구기관": allSampleUsers.filter(u => u.upperCategory === "연구기관").length
  },
  사용자유형별: {
    "교직원": allSampleUsers.filter(u => u.userType === "faculty").length,
    "학생": allSampleUsers.filter(u => u.userType === "student").length
  }
};

// 사용자 검색 함수들
export function getUsersByCategory(upperCategory: string) {
  return allSampleUsers.filter(u => u.upperCategory === upperCategory);
}

export function getUsersByPosition(position: string) {
  return allSampleUsers.filter(u => u.position === position);
}

export function getUsersByUserType(userType: string) {
  return allSampleUsers.filter(u => u.userType === userType);
}