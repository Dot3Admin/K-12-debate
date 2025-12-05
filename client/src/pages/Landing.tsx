import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GraduationCap } from "lucide-react";
import { useState } from "react";

export default function Landing() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async () => {
    if (!username || !password) {
      alert("학번/교번과 비밀번호를 입력해주세요.");
      return;
    }

    try {
      console.log("로그인 시도:", { username, password });
      
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          username,
          password,
        }),
      });

      if (response.ok) {
        // 로그인 성공 시 홈 페이지로 리다이렉트
        window.location.href = "/";
      } else {
        const errorData = await response.text();
        console.error("로그인 실패:", errorData);
        alert("로그인에 실패했습니다. 학번/교번과 비밀번호를 확인해주세요.");
      }
    } catch (error) {
      console.error("로그인 오류:", error);
      alert("로그인 중 오류가 발생했습니다. 다시 시도해주세요.");
    }
  };

  const handleDemoAccountClick = async (demoUsername: string, demoPassword: string) => {
    setUsername(demoUsername);
    setPassword(demoPassword);
    
    // 데모계정 정보를 설정한 후 자동으로 로그인 실행
    try {
      console.log("데모계정 로그인 시도:", { username: demoUsername, password: demoPassword });
      
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          username: demoUsername,
          password: demoPassword,
        }),
      });

      if (response.ok) {
        // 로그인 성공 시 홈 페이지로 리다이렉트
        window.location.href = "/";
      } else {
        const errorData = await response.text();
        console.error("데모계정 로그인 실패:", errorData);
        alert("데모계정 로그인에 실패했습니다.");
      }
    } catch (error) {
      console.error("데모계정 로그인 오류:", error);
      alert("로그인 중 오류가 발생했습니다. 다시 시도해주세요.");
    }
  };

  return (
    <div className="mobile-container">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        {/* Logo Section */}
        <div className="mb-8 text-center">
          <div className="w-20 h-20 bg-slate-800 rounded-3xl flex items-center justify-center mb-4 mx-auto">
            <GraduationCap className="text-white text-2xl w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2 korean-text">LoBo</h1>
          <p className="text-muted-foreground text-sm korean-text">대학교 AI 챗봇 시스템</p>
        </div>

        {/* Login Form */}
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <h2 className="text-xl font-medium text-foreground mb-6 text-center korean-text">로그인</h2>
            <p className="text-muted-foreground text-sm text-center mb-6 korean-text">
              학번/교번과 비밀번호를 입력해주세요
            </p>
            
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleLogin(); }}>
              <div>
                <Label className="korean-text">학번/교번</Label>
                <Input 
                  type="text" 
                  placeholder="예: 2024001 또는 prof001"
                  className="korean-text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              
              <div>
                <Label className="korean-text">비밀번호</Label>
                <Input 
                  type="password" 
                  placeholder="비밀번호를 입력하세요"
                  className="korean-text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <Button 
                type="submit"
                className="w-full korean-text"
              >
                로그인
              </Button>
            </form>

            {/* Account Types */}
            <div className="mt-6 p-4 bg-muted rounded-xl">
              <h3 className="text-sm font-medium text-foreground mb-3 korean-text">데모 계정</h3>
              <div className="space-y-2 text-xs text-muted-foreground korean-text">
                <div 
                  className="cursor-pointer hover:text-foreground transition-colors p-1 rounded hover:bg-background"
                  onClick={() => handleDemoAccountClick("student1", "123#$%People")}
                >
                  <span className="font-medium">학생:</span> student1 / 123#$%People
                </div>
                <div 
                  className="cursor-pointer hover:text-foreground transition-colors p-1 rounded hover:bg-background"
                  onClick={() => handleDemoAccountClick("manager1", "456#$%People")}
                >
                  <span className="font-medium">김일환 교수:</span> manager1 / 456#$%People
                </div>
                <div 
                  className="cursor-pointer hover:text-foreground transition-colors p-1 rounded hover:bg-background"
                  onClick={() => handleDemoAccountClick("admin1", "789#$%People")}
                >
                  <span className="font-medium">관리자:</span> admin1 / 789#$%People
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="text-center text-xs text-muted-foreground py-4 korean-text">
        © 2024 LoBo - University AI Chatbot System
      </div>
    </div>
  );
}
