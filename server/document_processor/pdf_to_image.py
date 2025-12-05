
import sys
import json
import os
import fitz  # PyMuPDF

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No PDF path provided"}))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    
    try:
        # PyMuPDF로 PDF 열기
        doc = fitz.open(pdf_path)
        
        if len(doc) == 0:
            print(json.dumps({"error": "PDF has no pages"}))
            sys.exit(1)
        
        # 첫 페이지만 이미지로 변환 (비용 절감)
        page = doc[0]
        
        # 페이지를 이미지로 렌더링 (150 DPI)
        zoom = 150 / 72  # 72 DPI가 기본값
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        
        # 임시 이미지 파일로 저장
        temp_dir = os.path.dirname(pdf_path)
        image_path = os.path.join(temp_dir, "temp_vision_page_1.png")
        pix.save(image_path)
        
        doc.close()
        
        print(json.dumps({"success": True, "image_path": image_path}))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
