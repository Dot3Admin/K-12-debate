// 단순한 기관명 교정만 유지 - 모든 복잡한 템플릿 제거

// 기관명 자동 교정 함수
export function correctInstitutionNames(response: string): string {
  return response
    .replace(/입학처/g, '교무처 학사팀')
    .replace(/SNS\s*등?/g, '학사공지/학사요람')
    .replace(/입학처[\s]*[\,\.]?[\s]*SNS/g, '교무처 학사팀, 학사공지');
}