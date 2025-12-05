
import sys
import json
import os
from pdf2image import convert_from_path

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No PDF path provided"}))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    
    try:
        # PDF를 이미지로 변환 (첫 페이지만)
        images = convert_from_path(pdf_path, dpi=150, first_page=1, last_page=1)
        
        if len(images) == 0:
            print(json.dumps({"error": "No pages found"}))
            sys.exit(1)
        
        # 임시 이미지 파일로 저장
        temp_dir = os.path.dirname(pdf_path)
        image_path = os.path.join(temp_dir, "temp_vision_ppt_slide_1.png")
        images[0].save(image_path, 'PNG')
        
        print(json.dumps({"success": True, "image_path": image_path}))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
