#!/usr/bin/env python3
"""
PDF에서 embedded 이미지와 주변 캡션을 추출하는 스크립트
"""
import sys
import json
import fitz  # PyMuPDF
from pathlib import Path
from PIL import Image
import io

def get_caption_text(page, image_bbox, distance_threshold=50):
    """
    이미지 주변의 캡션 텍스트를 찾습니다.
    
    Args:
        page: PyMuPDF 페이지 객체
        image_bbox: 이미지의 bounding box [x0, y0, x1, y1]
        distance_threshold: 캡션으로 간주할 최대 거리 (픽셀)
    
    Returns:
        str: 추출된 캡션 텍스트
    """
    x0, y0, x1, y1 = image_bbox
    image_height = y1 - y0
    
    # 이미지 하단 아래 영역 (캡션이 주로 위치)
    caption_area = fitz.Rect(
        x0 - 20,  # 약간 넓게
        y1,  # 이미지 하단
        x1 + 20,  # 약간 넓게
        y1 + distance_threshold  # 이미지 높이의 일정 비율
    )
    
    # 해당 영역의 텍스트 추출
    text_instances = page.get_text("dict", clip=caption_area)
    
    caption_lines = []
    for block in text_instances.get("blocks", []):
        if block.get("type") == 0:  # 텍스트 블록
            for line in block.get("lines", []):
                line_text = ""
                for span in line.get("spans", []):
                    line_text += span.get("text", "")
                if line_text.strip():
                    caption_lines.append(line_text.strip())
    
    # 상단도 확인 (일부 문서는 캡션이 위에 있음)
    caption_area_top = fitz.Rect(
        x0 - 20,
        y0 - distance_threshold,
        x1 + 20,
        y0
    )
    
    text_instances_top = page.get_text("dict", clip=caption_area_top)
    top_lines = []
    for block in text_instances_top.get("blocks", []):
        if block.get("type") == 0:
            for line in block.get("lines", []):
                line_text = ""
                for span in line.get("spans", []):
                    line_text += span.get("text", "")
                if line_text.strip():
                    top_lines.append(line_text.strip())
    
    # 상단과 하단 캡션 합치기
    all_captions = top_lines + caption_lines
    return " ".join(all_captions) if all_captions else ""


def extract_images_from_pdf(pdf_path, output_dir):
    """
    PDF에서 모든 이미지를 추출하고 메타데이터 반환
    
    Args:
        pdf_path: PDF 파일 경로
        output_dir: 이미지 저장 디렉토리
    
    Returns:
        list: [{page, image_index, path, bbox, caption, width, height}, ...]
    """
    try:
        doc = fitz.open(pdf_path)
        extracted_images = []
        image_counter = 0
        
        for page_num in range(len(doc)):
            page = doc[page_num]
            image_list = page.get_images(full=True)
            
            for img_index, img in enumerate(image_list):
                try:
                    xref = img[0]
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image["image"]
                    image_ext = base_image["ext"]
                    
                    # 이미지를 PIL로 로드
                    pil_image = Image.open(io.BytesIO(image_bytes))
                    
                    # 너무 작은 이미지는 무시 (아이콘, 로고 등)
                    if pil_image.width < 100 or pil_image.height < 100:
                        continue
                    
                    # 이미지 위치 정보 가져오기
                    image_rects = page.get_image_rects(xref)
                    if image_rects:
                        rect = image_rects[0]  # 첫 번째 발견 위치
                        bbox = [rect.x0, rect.y0, rect.x1, rect.y1]
                        
                        # 캡션 추출
                        caption = get_caption_text(page, bbox)
                    else:
                        bbox = [0, 0, pil_image.width, pil_image.height]
                        caption = ""
                    
                    # 이미지 저장
                    image_filename = f"img_{image_counter:03d}_p{page_num+1}_{img_index}.{image_ext}"
                    image_path = Path(output_dir) / image_filename
                    
                    with open(image_path, "wb") as img_file:
                        img_file.write(image_bytes)
                    
                    extracted_images.append({
                        "page": page_num + 1,
                        "image_index": img_index,
                        "path": str(image_path),
                        "bbox": bbox,
                        "caption": caption,
                        "width": pil_image.width,
                        "height": pil_image.height
                    })
                    
                    image_counter += 1
                    
                except Exception as e:
                    print(f"Error extracting image {img_index} from page {page_num}: {e}", file=sys.stderr)
                    continue
        
        doc.close()
        
        return extracted_images
        
    except Exception as e:
        print(f"Error processing PDF: {e}", file=sys.stderr)
        return []


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: extract_images_from_pdf.py <pdf_path> <output_dir>"}))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    # 출력 디렉토리 생성
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    # 이미지 추출
    images = extract_images_from_pdf(pdf_path, output_dir)
    
    # 결과 출력
    print(json.dumps({
        "success": True,
        "images": images,
        "total": len(images)
    }))
