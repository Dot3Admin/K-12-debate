from pathlib import Path
from typing import Dict, Optional
import logging

logger = logging.getLogger(__name__)


class BaseProcessor:
    def process(self, file_path: str) -> Dict:
        raise NotImplementedError


def get_processor(file_path: str, original_name: Optional[str] = None) -> BaseProcessor:
    # Try to get extension from original name first (if provided)
    if original_name:
        ext = Path(original_name).suffix.lower()
    else:
        ext = Path(file_path).suffix.lower()
    
    if ext == '.pdf':
        from .pdf_processor import PDFProcessor
        return PDFProcessor()
    
    elif ext in ['.docx', '.doc']:
        from .docx_processor import DOCXProcessor
        return DOCXProcessor()
    
    elif ext in ['.xlsx', '.xls', '.csv']:
        from .excel_processor import ExcelProcessor
        return ExcelProcessor()
    
    elif ext in ['.pptx', '.ppt']:
        from .pptx_processor import PPTXProcessor
        return PPTXProcessor()
    
    elif ext in ['.txt', '.md', '.rst']:
        from .text_processor import TextProcessor
        return TextProcessor()
    
    else:
        raise ValueError(f"Unsupported file type: {ext}")


__all__ = ['BaseProcessor', 'get_processor']
