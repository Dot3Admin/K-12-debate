#!/usr/bin/env python3
"""
추출된 이미지들을 grid로 합성하고 번호를 overlay하는 스크립트
"""
import sys
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math

def calculate_grid_dimensions(num_images, max_size=2048):
    """
    이미지 개수에 맞는 최적의 grid 크기 계산
    
    Args:
        num_images: 이미지 개수
        max_size: Vision API 권장 최대 크기 (px)
    
    Returns:
        tuple: (rows, cols, cell_size)
    """
    # 정사각형에 가까운 grid 계산
    cols = math.ceil(math.sqrt(num_images))
    rows = math.ceil(num_images / cols)
    
    # 각 셀 크기 계산 (여백 포함)
    cell_size = max_size // max(rows, cols)
    
    return rows, cols, cell_size


def create_image_grid(image_paths, output_path, metadata_list, max_size=2048):
    """
    이미지들을 grid로 합성하고 번호 overlay
    
    Args:
        image_paths: 이미지 경로 리스트
        output_path: 출력 이미지 경로
        metadata_list: 메타데이터 리스트 (page/slide 정보 포함)
        max_size: 최대 크기 (px)
    
    Returns:
        dict: {success, grid_path, mapping, skipped_images}
    """
    try:
        num_images = len(image_paths)
        if num_images == 0:
            return {"success": False, "error": "No images to process"}
        
        # 임시로 최대 크기로 grid 계산 (나중에 valid_image_count로 재계산)
        rows, cols, cell_size = calculate_grid_dimensions(num_images, max_size)
        
        # Grid 이미지 생성 (흰색 배경)
        grid_width = cols * cell_size
        grid_height = rows * cell_size
        grid_image = Image.new('RGB', (grid_width, grid_height), 'white')
        draw = ImageDraw.Draw(grid_image)
        
        # 폰트 설정 (번호 overlay용)
        try:
            # 시스템 폰트 사용 (없으면 기본 폰트)
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
        except:
            font = ImageFont.load_default()
        
        # 이미지 배치 및 번호 overlay
        mapping = []
        valid_image_count = 0
        skipped_images = []
        
        for idx, (img_path, metadata) in enumerate(zip(image_paths, metadata_list)):
            try:
                # 이미지 로드 시도
                img = Image.open(img_path)
                
                # 비율 유지하며 셀 크기에 맞춤 (여백 10px)
                padding = 10
                max_img_size = cell_size - (2 * padding)
                img.thumbnail((max_img_size, max_img_size), Image.Resampling.LANCZOS)
                
                # 실제 배치할 위치 계산
                row = valid_image_count // cols
                col = valid_image_count % cols
                
                # Grid에 이미지 붙이기 (중앙 정렬)
                x_offset = col * cell_size + padding + (max_img_size - img.width) // 2
                y_offset = row * cell_size + padding + (max_img_size - img.height) // 2
                
                grid_image.paste(img, (x_offset, y_offset))
                
                # 번호 overlay (왼쪽 상단)
                number = valid_image_count + 1
                number_text = f"#{number}"
                
                # 번호 배경 (흰색 반투명 박스)
                text_bbox = draw.textbbox((0, 0), number_text, font=font)
                text_width = text_bbox[2] - text_bbox[0]
                text_height = text_bbox[3] - text_bbox[1]
                
                bg_x = col * cell_size + 5
                bg_y = row * cell_size + 5
                
                draw.rectangle(
                    [bg_x, bg_y, bg_x + text_width + 10, bg_y + text_height + 10],
                    fill='white',
                    outline='black',
                    width=2
                )
                
                # 번호 텍스트
                draw.text(
                    (bg_x + 5, bg_y + 5),
                    number_text,
                    fill='red',
                    font=font
                )
                
                # 매핑 정보 저장
                page_or_slide = metadata.get('page') or metadata.get('slide', 0)
                mapping.append({
                    "number": number,
                    "page": page_or_slide,
                    "caption": metadata.get('caption', ''),
                    "original_path": img_path
                })
                
                valid_image_count += 1
                
            except Exception as img_error:
                # Unsupported 이미지 형식 (WMF, EMF 등) 건너뛰기
                img_name = Path(img_path).name
                skipped_images.append(f"{img_name} ({str(img_error)})")
                print(f"⚠️  Skipping unsupported image: {img_name} - {str(img_error)}", file=sys.stderr)
                continue
        
        # 유효한 이미지가 없으면 에러
        if valid_image_count == 0:
            return {
                "success": False, 
                "error": f"No valid images found. Skipped: {len(skipped_images)}"
            }
        
        # 실제 유효한 이미지 개수로 grid 크기 재계산 (빈 공간 제거)
        actual_rows, actual_cols, _ = calculate_grid_dimensions(valid_image_count, max_size)
        actual_width = actual_cols * cell_size
        actual_height = actual_rows * cell_size
        
        # 필요하면 grid 이미지를 실제 크기로 crop
        if actual_width < grid_width or actual_height < grid_height:
            grid_image = grid_image.crop((0, 0, actual_width, actual_height))
        
        # Grid 이미지 저장
        grid_image.save(output_path, 'PNG', optimize=True)
        
        return {
            "success": True,
            "grid_path": str(output_path),
            "grid_size": [actual_width, actual_height],
            "rows": actual_rows,
            "cols": actual_cols,
            "total_images": num_images,
            "valid_images": valid_image_count,
            "skipped_images": skipped_images,
            "mapping": mapping
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: create_image_grid.py <images_json> <output_path> <metadata_json>"}))
        sys.exit(1)
    
    images_json = sys.argv[1]
    output_path = sys.argv[2]
    metadata_json = sys.argv[3]
    
    # JSON 파싱
    image_paths = json.loads(images_json)
    metadata_list = json.loads(metadata_json)
    
    # Grid 생성
    result = create_image_grid(image_paths, output_path, metadata_list)
    
    # 결과 출력
    print(json.dumps(result))
