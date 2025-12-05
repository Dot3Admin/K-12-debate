
export const organizationCategories = [
  // 1. 대학본부 (University Administration)
  { upperCategory: "대학본부", lowerCategory: "총장실", detailCategory: "총장비서실", status: "활성" },
  { upperCategory: "대학본부", lowerCategory: "총장실", detailCategory: "대외협력팀", status: "활성" },
  { upperCategory: "대학본부", lowerCategory: "총장실", detailCategory: "홍보팀", status: "활성" },
  { upperCategory: "대학본부", lowerCategory: "기획처", detailCategory: "기획예산팀", status: "활성" },
  { upperCategory: "대학본부", lowerCategory: "기획처", detailCategory: "평가관리팀", status: "활성" },
  { upperCategory: "대학본부", lowerCategory: "기획처", detailCategory: "IR팀", status: "등록 승인 대기중" },
  { upperCategory: "대학본부", lowerCategory: "교무처", detailCategory: "교무팀", status: "활성" },
  { upperCategory: "대학본부", lowerCategory: "교무처", detailCategory: "학사관리팀", status: "활성" },
  { upperCategory: "대학본부", lowerCategory: "교무처", detailCategory: "수업관리팀", status: "활성" },
  { upperCategory: "대학본부", lowerCategory: "학생처", detailCategory: "학생지원팀", status: "활성" },

  // 2. 학사부서 (Academic Affairs)
  { upperCategory: "학사부서", lowerCategory: "입학처", detailCategory: "입학사정팀", status: "활성" },
  { upperCategory: "학사부서", lowerCategory: "입학처", detailCategory: "입학전형팀", status: "활성" },
  { upperCategory: "학사부서", lowerCategory: "입학처", detailCategory: "입학홍보팀", status: "비활성" },
  { upperCategory: "학사부서", lowerCategory: "교육혁신원", detailCategory: "교수학습지원센터", status: "활성" },
  { upperCategory: "학사부서", lowerCategory: "교육혁신원", detailCategory: "교육과정혁신팀", status: "등록 승인 대기중" },
  { upperCategory: "학사부서", lowerCategory: "교육혁신원", detailCategory: "이러닝지원센터", status: "활성" },
  { upperCategory: "학사부서", lowerCategory: "국제교류원", detailCategory: "국제협력팀", status: "활성" },
  { upperCategory: "학사부서", lowerCategory: "국제교류원", detailCategory: "외국인학생지원팀", status: "활성" },
  { upperCategory: "학사부서", lowerCategory: "국제교류원", detailCategory: "교환학생팀", status: "활성" },
  { upperCategory: "학사부서", lowerCategory: "취업진로센터", detailCategory: "취업지원팀", status: "활성" },

  // 3. 인문대학 (College of Humanities)
  { upperCategory: "인문대학", lowerCategory: "국어국문학과", detailCategory: "현대문학전공", status: "활성" },
  { upperCategory: "인문대학", lowerCategory: "국어국문학과", detailCategory: "고전문학전공", status: "활성" },
  { upperCategory: "인문대학", lowerCategory: "국어국문학과", detailCategory: "국어학전공", status: "비활성" },
  { upperCategory: "인문대학", lowerCategory: "영어영문학과", detailCategory: "영문학전공", status: "활성" },
  { upperCategory: "인문대학", lowerCategory: "영어영문학과", detailCategory: "영어학전공", status: "활성" },
  { upperCategory: "인문대학", lowerCategory: "영어영문학과", detailCategory: "영어교육전공", status: "등록 승인 대기중" },
  { upperCategory: "인문대학", lowerCategory: "사학과", detailCategory: "한국사전공", status: "활성" },
  { upperCategory: "인문대학", lowerCategory: "사학과", detailCategory: "동양사전공", status: "활성" },
  { upperCategory: "인문대학", lowerCategory: "사학과", detailCategory: "서양사전공", status: "활성" },
  { upperCategory: "인문대학", lowerCategory: "철학과", detailCategory: "동양철학전공", status: "활성" },

  // 4. 사회과학대학 (College of Social Sciences)
  { upperCategory: "사회과학대학", lowerCategory: "정치외교학과", detailCategory: "정치학전공", status: "활성" },
  { upperCategory: "사회과학대학", lowerCategory: "정치외교학과", detailCategory: "외교학전공", status: "활성" },
  { upperCategory: "사회과학대학", lowerCategory: "정치외교학과", detailCategory: "국제관계전공", status: "등록 승인 대기중" },
  { upperCategory: "사회과학대학", lowerCategory: "행정학과", detailCategory: "일반행정전공", status: "활성" },
  { upperCategory: "사회과학대학", lowerCategory: "행정학과", detailCategory: "지방행정전공", status: "활성" },
  { upperCategory: "사회과학대학", lowerCategory: "행정학과", detailCategory: "정책학전공", status: "비활성" },
  { upperCategory: "사회과학대학", lowerCategory: "사회학과", detailCategory: "일반사회학전공", status: "활성" },
  { upperCategory: "사회과학대학", lowerCategory: "사회학과", detailCategory: "응용사회학전공", status: "활성" },
  { upperCategory: "사회과학대학", lowerCategory: "심리학과", detailCategory: "임상심리전공", status: "활성" },
  { upperCategory: "사회과학대학", lowerCategory: "심리학과", detailCategory: "인지심리전공", status: "활성" },

  // 5. 자연과학대학 (College of Natural Sciences)
  { upperCategory: "자연과학대학", lowerCategory: "수학과", detailCategory: "순수수학전공", status: "활성" },
  { upperCategory: "자연과학대학", lowerCategory: "수학과", detailCategory: "응용수학전공", status: "활성" },
  { upperCategory: "자연과학대학", lowerCategory: "수학과", detailCategory: "통계학전공", status: "등록 승인 대기중" },
  { upperCategory: "자연과학대학", lowerCategory: "물리학과", detailCategory: "이론물리전공", status: "활성" },
  { upperCategory: "자연과학대학", lowerCategory: "물리학과", detailCategory: "실험물리전공", status: "활성" },
  { upperCategory: "자연과학대학", lowerCategory: "물리학과", detailCategory: "응용물리전공", status: "비활성" },
  { upperCategory: "자연과학대학", lowerCategory: "화학과", detailCategory: "유기화학전공", status: "활성" },
  { upperCategory: "자연과학대학", lowerCategory: "화학과", detailCategory: "무기화학전공", status: "활성" },
  { upperCategory: "자연과학대학", lowerCategory: "화학과", detailCategory: "물리화학전공", status: "활성" },
  { upperCategory: "자연과학대학", lowerCategory: "생명과학과", detailCategory: "분자생물학전공", status: "활성" },

  // 6. 공과대학 (College of Engineering)
  { upperCategory: "공과대학", lowerCategory: "컴퓨터공학과", detailCategory: "소프트웨어공학전공", status: "활성" },
  { upperCategory: "공과대학", lowerCategory: "컴퓨터공학과", detailCategory: "인공지능전공", status: "활성" },
  { upperCategory: "공과대학", lowerCategory: "컴퓨터공학과", detailCategory: "데이터사이언스전공", status: "등록 승인 대기중" },
  { upperCategory: "공과대학", lowerCategory: "전자공학과", detailCategory: "반도체공학전공", status: "활성" },
  { upperCategory: "공과대학", lowerCategory: "전자공학과", detailCategory: "통신공학전공", status: "활성" },
  { upperCategory: "공과대학", lowerCategory: "전자공학과", detailCategory: "제어공학전공", status: "활성" },
  { upperCategory: "공과대학", lowerCategory: "기계공학과", detailCategory: "설계공학전공", status: "활성" },
  { upperCategory: "공과대학", lowerCategory: "기계공학과", detailCategory: "열유체공학전공", status: "비활성" },
  { upperCategory: "공과대학", lowerCategory: "기계공학과", detailCategory: "재료공학전공", status: "활성" },
  { upperCategory: "공과대학", lowerCategory: "건축학과", detailCategory: "건축설계전공", status: "활성" },

  // 7. 경영대학 (College of Business)
  { upperCategory: "경영대학", lowerCategory: "경영학과", detailCategory: "경영전략전공", status: "활성" },
  { upperCategory: "경영대학", lowerCategory: "경영학과", detailCategory: "마케팅전공", status: "활성" },
  { upperCategory: "경영대학", lowerCategory: "경영학과", detailCategory: "재무관리전공", status: "활성" },
  { upperCategory: "경영대학", lowerCategory: "경영학과", detailCategory: "인사조직전공", status: "등록 승인 대기중" },
  { upperCategory: "경영대학", lowerCategory: "회계학과", detailCategory: "재무회계전공", status: "활성" },
  { upperCategory: "경영대학", lowerCategory: "회계학과", detailCategory: "관리회계전공", status: "활성" },
  { upperCategory: "경영대학", lowerCategory: "회계학과", detailCategory: "세무회계전공", status: "비활성" },
  { upperCategory: "경영대학", lowerCategory: "경제학과", detailCategory: "미시경제전공", status: "활성" },
  { upperCategory: "경영대학", lowerCategory: "경제학과", detailCategory: "거시경제전공", status: "활성" },
  { upperCategory: "경영대학", lowerCategory: "경제학과", detailCategory: "계량경제전공", status: "활성" },

  // 8. 의과대학 (College of Medicine)
  { upperCategory: "의과대학", lowerCategory: "의학과", detailCategory: "내과학전공", status: "활성" },
  { upperCategory: "의과대학", lowerCategory: "의학과", detailCategory: "외과학전공", status: "활성" },
  { upperCategory: "의과대학", lowerCategory: "의학과", detailCategory: "소아과학전공", status: "활성" },
  { upperCategory: "의과대학", lowerCategory: "간호학과", detailCategory: "성인간호전공", status: "활성" },
  { upperCategory: "의과대학", lowerCategory: "간호학과", detailCategory: "아동간호전공", status: "등록 승인 대기중" },
  { upperCategory: "의과대학", lowerCategory: "간호학과", detailCategory: "지역간호전공", status: "활성" },
  { upperCategory: "의과대학", lowerCategory: "약학과", detailCategory: "임상약학전공", status: "활성" },
  { upperCategory: "의과대학", lowerCategory: "약학과", detailCategory: "제약학전공", status: "비활성" },
  { upperCategory: "의과대학", lowerCategory: "치의학과", detailCategory: "구강내과전공", status: "활성" },
  { upperCategory: "의과대학", lowerCategory: "치의학과", detailCategory: "구강외과전공", status: "활성" },

  // 9. 대학원 (Graduate School)
  { upperCategory: "대학원", lowerCategory: "일반대학원", detailCategory: "박사과정", status: "활성" },
  { upperCategory: "대학원", lowerCategory: "일반대학원", detailCategory: "석사과정", status: "활성" },
  { upperCategory: "대학원", lowerCategory: "일반대학원", detailCategory: "석박통합과정", status: "활성" },
  { upperCategory: "대학원", lowerCategory: "특수대학원", detailCategory: "경영대학원", status: "활성" },
  { upperCategory: "대학원", lowerCategory: "특수대학원", detailCategory: "교육대학원", status: "등록 승인 대기중" },
  { upperCategory: "대학원", lowerCategory: "특수대학원", detailCategory: "행정대학원", status: "활성" },
  { upperCategory: "대학원", lowerCategory: "전문대학원", detailCategory: "의학전문대학원", status: "활성" },
  { upperCategory: "대학원", lowerCategory: "전문대학원", detailCategory: "법학전문대학원", status: "활성" },
  { upperCategory: "대학원", lowerCategory: "전문대학원", detailCategory: "경영전문대학원", status: "비활성" },
  { upperCategory: "대학원", lowerCategory: "국제대학원", detailCategory: "국제관계전공", status: "활성" },

  // 10. 연구소 및 부설기관 (Research Institutes & Affiliated Organizations)
  { upperCategory: "연구기관", lowerCategory: "중앙연구소", detailCategory: "기초과학연구소", status: "활성" },
  { upperCategory: "연구기관", lowerCategory: "중앙연구소", detailCategory: "응용과학연구소", status: "활성" },
  { upperCategory: "연구기관", lowerCategory: "중앙연구소", detailCategory: "산업기술연구소", status: "등록 승인 대기중" },
  { upperCategory: "연구기관", lowerCategory: "인문사회연구소", detailCategory: "인문학연구소", status: "활성" },
  { upperCategory: "연구기관", lowerCategory: "인문사회연구소", detailCategory: "사회과학연구소", status: "활성" },
  { upperCategory: "연구기관", lowerCategory: "인문사회연구소", detailCategory: "교육연구소", status: "비활성" },
  { upperCategory: "연구기관", lowerCategory: "의학연구소", detailCategory: "임상의학연구소", status: "활성" },
  { upperCategory: "연구기관", lowerCategory: "의학연구소", detailCategory: "기초의학연구소", status: "활성" },
  { upperCategory: "연구기관", lowerCategory: "공학연구소", detailCategory: "신소재연구소", status: "활성" },
  { upperCategory: "연구기관", lowerCategory: "공학연구소", detailCategory: "환경공학연구소", status: "활성" }
];

// 카테고리별 통계
export const categoryStats = {
  총개수: organizationCategories.length,
  상위카테고리별: {
    "대학본부": organizationCategories.filter(c => c.upperCategory === "대학본부").length,
    "학사부서": organizationCategories.filter(c => c.upperCategory === "학사부서").length,
    "인문대학": organizationCategories.filter(c => c.upperCategory === "인문대학").length,
    "사회과학대학": organizationCategories.filter(c => c.upperCategory === "사회과학대학").length,
    "자연과학대학": organizationCategories.filter(c => c.upperCategory === "자연과학대학").length,
    "공과대학": organizationCategories.filter(c => c.upperCategory === "공과대학").length,
    "경영대학": organizationCategories.filter(c => c.upperCategory === "경영대학").length,
    "의과대학": organizationCategories.filter(c => c.upperCategory === "의과대학").length,
    "대학원": organizationCategories.filter(c => c.upperCategory === "대학원").length,
    "연구기관": organizationCategories.filter(c => c.upperCategory === "연구기관").length
  }
};

// 카테고리 검색 함수
export function getCategoriesByUpper(upperCategory: string) {
  return organizationCategories.filter(c => c.upperCategory === upperCategory);
}

export function getCategoriesByLower(lowerCategory: string) {
  return organizationCategories.filter(c => c.lowerCategory === lowerCategory);
}

export function getUniqueUpperCategories() {
  return [...new Set(organizationCategories.map(c => c.upperCategory))];
}

export function getUniqueLowerCategories(upperCategory?: string) {
  const filtered = upperCategory 
    ? organizationCategories.filter(c => c.upperCategory === upperCategory)
    : organizationCategories;
  return [...new Set(filtered.map(c => c.lowerCategory))];
}

export function getUniqueDetailCategories(upperCategory?: string, lowerCategory?: string) {
  let filtered = organizationCategories;
  if (upperCategory) {
    filtered = filtered.filter(c => c.upperCategory === upperCategory);
  }
  if (lowerCategory) {
    filtered = filtered.filter(c => c.lowerCategory === lowerCategory);
  }
  return [...new Set(filtered.map(c => c.detailCategory))];
}
