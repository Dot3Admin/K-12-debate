import { storage } from "./storage";
import bcrypt from "bcrypt";

interface TestUser {
  username: string;
  password: string;
  email: string;
  firstName: string;
  lastName: string;
  userType: "student" | "faculty";
  nickname: string;
  age: number;
  gender: string;
  country: string;
  religion: string;
  occupation: string;
}

const testUsers: TestUser[] = [
  {
    username: "test001",
    password: "test123",
    email: "park.jihoo@elementary.ac.kr",
    firstName: "지후",
    lastName: "박",
    userType: "student",
    nickname: "지후",
    age: 8,
    gender: "남성",
    country: "대한민국",
    religion: "기독교",
    occupation: "초등학생 2학년 (아동 전기)"
  },
  {
    username: "test002",
    password: "test123",
    email: "choi.yuna@elementary.ac.kr",
    firstName: "유나",
    lastName: "최",
    userType: "student",
    nickname: "유나",
    age: 11,
    gender: "여성",
    country: "대한민국",
    religion: "불교",
    occupation: "초등학생 5학년 (아동 후기)"
  },
  {
    username: "test003",
    password: "test123",
    email: "lee.minsu@middle.ac.kr",
    firstName: "민수",
    lastName: "이",
    userType: "student",
    nickname: "민수",
    age: 14,
    gender: "남성",
    country: "대한민국",
    religion: "천주교",
    occupation: "중학생 2학년 (초기 청소년기)"
  },
  {
    username: "test004",
    password: "test123",
    email: "kim.minho@university.ac.kr",
    firstName: "민호",
    lastName: "김",
    userType: "student",
    nickname: "민호",
    age: 17,
    gender: "남성",
    country: "대한민국",
    religion: "기독교",
    occupation: "고등학생 (청소년기)"
  },
  {
    username: "test005",
    password: "test123",
    email: "lee.sujin@university.ac.kr",
    firstName: "수진",
    lastName: "이",
    userType: "student",
    nickname: "수진",
    age: 20,
    gender: "여성",
    country: "대한민국",
    religion: "불교",
    occupation: "컴퓨터공학과 학생 (청년 전기)"
  },
  {
    username: "test006",
    password: "test123",
    email: "choi.yunho@university.ac.kr",
    firstName: "윤호",
    lastName: "최",
    userType: "student",
    nickname: "윤호",
    age: 22,
    gender: "남성",
    country: "대한민국",
    religion: "무교",
    occupation: "경영학과 학생 (청년 전기)"
  },
  {
    username: "test007",
    password: "test123",
    email: "han.minjung@university.ac.kr",
    firstName: "민정",
    lastName: "한",
    userType: "student",
    nickname: "민정",
    age: 24,
    gender: "여성",
    country: "대한민국",
    religion: "불교",
    occupation: "심리학과 대학원생 (청년 전기)"
  },
  {
    username: "test008",
    password: "test123",
    email: "kang.seunghyun@university.ac.kr",
    firstName: "승현",
    lastName: "강",
    userType: "student",
    nickname: "승현",
    age: 28,
    gender: "남성",
    country: "대한민국",
    religion: "천주교",
    occupation: "화학과 박사과정 (청년 후기)"
  },
  {
    username: "test009",
    password: "test123",
    email: "yoon.sooyoung@university.ac.kr",
    firstName: "수영",
    lastName: "윤",
    userType: "student",
    nickname: "수영",
    age: 33,
    gender: "여성",
    country: "대한민국",
    religion: "기독교",
    occupation: "건축학과 연구원 (청년 후기)"
  },
  {
    username: "test010",
    password: "test123",
    email: "jung.hyejin@university.ac.kr",
    firstName: "혜진",
    lastName: "정",
    userType: "faculty",
    nickname: "정 교수",
    age: 38,
    gender: "여성",
    country: "대한민국",
    religion: "기독교",
    occupation: "영어영문학과 교수 (중년 전기)"
  },
  {
    username: "test011",
    password: "test123",
    email: "park.jiwon@university.ac.kr",
    firstName: "지원",
    lastName: "박",
    userType: "faculty",
    nickname: "박 교수",
    age: 45,
    gender: "여성",
    country: "대한민국",
    religion: "천주교",
    occupation: "수학과 교수 (중년 전기)"
  },
  {
    username: "test012",
    password: "test123",
    email: "oh.jihoon@university.ac.kr",
    firstName: "지훈",
    lastName: "오",
    userType: "faculty",
    nickname: "오 교수",
    age: 56,
    gender: "남성",
    country: "대한민국",
    religion: "무교",
    occupation: "철학과 교수 (중년 후기)"
  },
  {
    username: "test013",
    password: "test123",
    email: "lim.donghyuk@university.ac.kr",
    firstName: "동혁",
    lastName: "임",
    userType: "faculty",
    nickname: "임 교수",
    age: 68,
    gender: "남성",
    country: "대한민국",
    religion: "천주교",
    occupation: "법학과 명예교수 (원숙기)"
  }
];

export async function seedTestUsers() {
  console.log("🌱 테스트 사용자 시드 시작...");
  
  for (const user of testUsers) {
    try {
      // 이미 존재하는 사용자인지 확인
      const existingUser = await storage.getUserByUsername(user.username);
      
      if (existingUser) {
        console.log(`✓ 사용자 ${user.username} (${user.firstName} ${user.lastName}) 이미 존재함 - 스킵`);
        continue;
      }
      
      // 비밀번호 해시
      const hashedPassword = await bcrypt.hash(user.password, 10);
      
      // 사용자 생성
      await storage.createUser({
        id: user.username, // ID를 username과 동일하게 설정
        username: user.username,
        password: hashedPassword,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        nickname: user.nickname,
        age: user.age,
        gender: user.gender,
        country: user.country,
        religion: user.religion,
        occupation: user.occupation,
      });
      
      console.log(`✅ 사용자 생성: ${user.username} (${user.firstName} ${user.lastName}, ${user.age}세, ${user.occupation})`);
    } catch (error) {
      console.error(`❌ 사용자 ${user.username} 생성 실패:`, error);
    }
  }
  
  console.log("✅ 테스트 사용자 시드 완료!");
}

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}`) {
  seedTestUsers()
    .then(() => {
      console.log("완료");
      process.exit(0);
    })
    .catch((error) => {
      console.error("에러:", error);
      process.exit(1);
    });
}
