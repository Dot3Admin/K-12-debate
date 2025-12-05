import os
import re
from pathlib import Path
from typing import Dict, List
import logging

logger = logging.getLogger(__name__)

try:
    import fitz
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False
    logger.warning("PyMuPDF not available")

try:
    import pytesseract
    from pdf2image import convert_from_path
    from PIL import Image
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False
    logger.warning("OCR libraries not available")

from . import BaseProcessor


class PDFProcessor(BaseProcessor):
    def process(self, file_path: str) -> Dict:
        logger.info(f"Processing PDF: {file_path}")
        
        result = {
            'text': '',
            'tables': [],
            'images': [],
            'formulas': [],
            'metadata': {}
        }
        
        try:
            text_data = self._extract_text_and_formulas(file_path)
            result['text'] = text_data['text']
            result['formulas'] = text_data.get('formulas', [])
            # Merge OCR metadata into result metadata
            if 'ocr_used' in text_data:
                result['metadata']['ocr_used'] = text_data['ocr_used']
                result['metadata']['ocr_pages'] = text_data.get('ocr_pages', 0)
        except Exception as e:
            logger.error(f"Text extraction failed: {e}")
        
        try:
            metadata = self._extract_metadata(file_path)
            # Merge with existing metadata (preserve OCR info)
            result['metadata'].update(metadata)
        except Exception as e:
            logger.warning(f"Metadata extraction failed: {e}")
        
        logger.info(f"PDF processing complete: {len(result['text'])} chars")
        if result['metadata'].get('ocr_used'):
            logger.info(f"OCR was used on {result['metadata'].get('ocr_pages', 0)} pages")
        
        return result
    
    def _extract_text_and_formulas(self, file_path: str) -> Dict:
        result = {'text': '', 'formulas': [], 'ocr_used': False, 'ocr_pages': 0}
        
        if PYMUPDF_AVAILABLE:
            try:
                logger.info("Using PyMuPDF for text extraction")
                doc = fitz.open(file_path)
                
                text_parts = []
                formulas = []
                total_pages = doc.page_count
                ocr_page_count = 0
                
                for page_num in range(total_pages):
                    page = doc[page_num]
                    text = page.get_text()
                    
                    # Check if OCR is needed (scanned PDF with little text)
                    if len(text.strip()) < 50 and OCR_AVAILABLE:
                        logger.info(f"Page {page_num + 1} has minimal text, using OCR")
                        ocr_text = self._extract_text_with_ocr(file_path, page_num)
                        if ocr_text:
                            text = ocr_text
                            ocr_page_count += 1
                    
                    text_parts.append(f"--- Page {page_num + 1} ---\n{text}")
                    
                    page_formulas = self._detect_formulas(page)
                    formulas.extend(page_formulas)
                
                doc.close()
                
                result['text'] = '\n'.join(text_parts)
                result['formulas'] = formulas
                result['ocr_used'] = ocr_page_count > 0
                result['ocr_pages'] = ocr_page_count
                
                return result
                
            except Exception as e:
                logger.error(f"PyMuPDF failed: {e}")
        
        raise RuntimeError("PyMuPDF not available")
    
    def _extract_metadata(self, file_path: str) -> Dict:
        metadata = {
            'file_size': os.path.getsize(file_path),
            'file_name': os.path.basename(file_path)
        }
        
        try:
            if PYMUPDF_AVAILABLE:
                doc = fitz.open(file_path)
                
                metadata.update({
                    'total_pages': doc.page_count,
                    'metadata': doc.metadata,
                    'is_encrypted': doc.is_encrypted
                })
                
                doc.close()
        except Exception as e:
            logger.warning(f"Metadata extraction partial: {e}")
        
        return metadata
    
    def _extract_text_with_ocr(self, file_path: str, page_num: int) -> str:
        """Extract text from a specific page using OCR"""
        if not OCR_AVAILABLE:
            logger.warning("OCR not available, skipping")
            return ""
        
        try:
            # Convert specific page to image (page_num is 0-indexed, first_page is 1-indexed)
            images = convert_from_path(
                file_path, 
                first_page=page_num + 1, 
                last_page=page_num + 1,
                dpi=300  # Higher DPI for better OCR accuracy
            )
            
            if not images:
                logger.warning(f"No images extracted from page {page_num + 1}")
                return ""
            
            # OCR with Korean and English support
            text = pytesseract.image_to_string(
                images[0], 
                lang='kor+eng',  # Korean + English
                config='--psm 3'  # Automatic page segmentation
            )
            
            logger.info(f"OCR extracted {len(text)} chars from page {page_num + 1}")
            return text.strip()
            
        except Exception as e:
            logger.error(f"OCR failed for page {page_num + 1}: {e}")
            return ""
    
    def _detect_formulas(self, page) -> List[str]:
        return []
