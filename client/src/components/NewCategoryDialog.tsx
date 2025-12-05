import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";

interface NewCategoryFormData {
  categoryLevel: string;
  parentCategory: string;
  categoryName: string;
  description: string;
}

interface NewCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: NewCategoryFormData) => void;
}

export function NewCategoryDialog({ open, onOpenChange, onSubmit }: NewCategoryDialogProps) {
  const { t } = useLanguage();
  const [step, setStep] = useState(1);
  const [categoryType, setCategoryType] = useState("");
  const [upperCategory, setUpperCategory] = useState("");
  const [middleCategory, setMiddleCategory] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [description, setDescription] = useState("");

  const resetDialog = () => {
    setStep(1);
    setCategoryType("");
    setUpperCategory("");
    setMiddleCategory("");
    setCategoryName("");
    setDescription("");
  };

  const handleClose = () => {
    resetDialog();
    onOpenChange(false);
  };

  const handleNext = () => setStep(step + 1);
  const handleBack = () => setStep(step - 1);

  const handleSubmit = () => {
    const data: NewCategoryFormData = {
      categoryLevel: categoryType,
      parentCategory: categoryType === "detail" ? middleCategory : categoryType === "lower" ? upperCategory : "",
      categoryName,
      description,
    };
    onSubmit(data);
    handleClose();
  };

  const categories = {
    upper: ["로보대학교", "대학본부", "학사부서"],
    lower: {
      "로보대학교": ["인문대학", "사회과학대학", "자연과학대학", "공과대학", "경영대학", "의과대학", "대학원"],
      "대학본부": ["총장실", "기획처", "교무처", "학생처"],
      "학사부서": ["입학처", "취업지원센터", "국제교류원", "도서관"]
    }
  };

  const getLowerCategories = (upper: string) => categories.lower[upper as keyof typeof categories.lower] || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>새 조직 카테고리 생성</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('org.createStepByStep')}
          </p>
        </DialogHeader>

        <div className="space-y-6">
          {/* 진행 단계 표시 */}
          <div className="flex items-center justify-between">
            {[1, 2, 3].map((stepNum) => (
              <div key={stepNum} className="flex items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                  step === stepNum 
                    ? 'bg-blue-500 text-white' 
                    : step > stepNum 
                    ? 'bg-green-500 text-white' 
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {step > stepNum ? '✓' : stepNum}
                </div>
                {stepNum < 3 && (
                  <div className={`w-20 h-1 mx-2 transition-all ${
                    step > stepNum ? 'bg-green-500' : 'bg-gray-200'
                  }`} />
                )}
              </div>
            ))}
          </div>

          {/* 1단계: 카테고리 유형 선택 */}
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">{t('org.selectCategoryType')}</h3>
              <div className="grid gap-3">
                {[
                  { value: "upper", title: t('org.upperCategory'), desc: t('org.upperCategoryDesc') },
                  { value: "lower", title: t('org.lowerCategory'), desc: t('org.lowerCategoryDesc') },
                  { value: "detail", title: t('org.detailCategory'), desc: t('org.detailCategoryDesc') }
                ].map((option) => (
                  <div 
                    key={option.value}
                    className={`p-4 border-2 rounded-lg cursor-pointer transition-all hover:bg-blue-50 ${
                      categoryType === option.value ? "border-blue-500 bg-blue-50" : "border-gray-200"
                    }`}
                    onClick={() => setCategoryType(option.value)}
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        categoryType === option.value ? "border-blue-500 bg-blue-500" : "border-gray-300"
                      }`}>
                        {categoryType === option.value && <div className="w-2 h-2 bg-white rounded-full" />}
                      </div>
                      <div>
                        <h4 className="font-medium">{option.title}</h4>
                        <p className="text-sm text-gray-600">{option.desc}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2단계: 상위 카테고리 선택 */}
          {step === 2 && (categoryType === "lower" || categoryType === "detail") && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">{t('org.selectUpperCategory')}</h3>
              <Select value={upperCategory} onValueChange={setUpperCategory}>
                <SelectTrigger>
                  <SelectValue placeholder={t('org.selectUpperCategory')} />
                </SelectTrigger>
                <SelectContent className="z-[10000]">
                  {categories.upper.map((category) => (
                    <SelectItem key={category} value={category}>{category}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {categoryType === "detail" && upperCategory && (
                <div className="space-y-2">
                  <Label>{t('org.middleCategorySelect')}</Label>
                  <Select value={middleCategory} onValueChange={setMiddleCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('org.selectMiddleCategory')} />
                    </SelectTrigger>
                    <SelectContent className="z-[10000]">
                      {getLowerCategories(upperCategory).map((category) => (
                        <SelectItem key={category} value={category}>{category}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* 3단계: 카테고리 정보 입력 */}
          {step === 3 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">{t('org.categoryInfo')}</h3>
              
              {/* 경로 미리보기 */}
              <div className="bg-blue-50 p-3 rounded-lg">
                <Label className="text-blue-800 text-sm font-medium">{t('org.categoryPath')}</Label>
                <p className="text-blue-700 mt-1 font-medium">
                  {upperCategory && `${upperCategory} > `}
                  {middleCategory && `${middleCategory} > `}
                  {categoryName || t('org.newCategory')}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t('org.categoryName')} *</Label>
                <Input 
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  placeholder={
                    categoryType === "upper" ? t('org.categoryNamePlaceholder') :
                    categoryType === "lower" ? t('org.categoryNamePlaceholderLower') :
                    t('org.categoryNamePlaceholderDetail')
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>{t('org.description')}</Label>
                <Textarea 
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('org.descriptionPlaceholder')}
                  rows={3}
                />
              </div>
            </div>
          )}

          {/* 버튼 그룹 */}
          <div className="flex justify-between pt-4 border-t">
            <Button variant="outline" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            
            <div className="flex space-x-2">
              {step > 1 && (
                <Button variant="outline" onClick={handleBack}>
                  {t('common.previous')}
                </Button>
              )}
              
              {step < 3 ? (
                <Button 
                  onClick={handleNext}
                  disabled={
                    (step === 1 && !categoryType) ||
                    (step === 2 && categoryType === "lower" && !upperCategory) ||
                    (step === 2 && categoryType === "detail" && (!upperCategory || !middleCategory))
                  }
                >
                  {t('common.next')}
                </Button>
              ) : (
                <Button 
                  onClick={handleSubmit}
                  disabled={!categoryName.trim()}
                  className="bg-blue-500 hover:bg-blue-600"
                >
                  {t('common.create')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}