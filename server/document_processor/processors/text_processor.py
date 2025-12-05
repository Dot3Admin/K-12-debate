import os
import re
from typing import Dict, List
import logging

logger = logging.getLogger(__name__)

from . import BaseProcessor


class TextProcessor(BaseProcessor):
    def process(self, file_path: str) -> Dict:
        logger.info(f"Processing text file: {file_path}")
        
        result = {
            'text': '',
            'tables': [],
            'images': [],
            'formulas': [],
            'metadata': {}
        }
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            result['text'] = content
            
            file_ext = os.path.splitext(file_path)[1].lower()
            
            if file_ext == '.md':
                result['tables'] = self._extract_markdown_tables(content)
                result['formulas'] = self._extract_latex_formulas(content)
            
            elif file_ext == '.rst':
                result['tables'] = self._extract_rst_tables(content)
                result['formulas'] = self._extract_latex_formulas(content)
            
            result['metadata'] = self._extract_metadata(file_path, content)
            
        except Exception as e:
            logger.error(f"Text file processing error: {e}")
            raise
        
        logger.info(f"Text file processing complete: {len(result['text'])} chars")
        
        return result
    
    def _extract_markdown_tables(self, content: str) -> List[Dict]:
        tables = []
        table_pattern = r'^\|.*\|.*\n\|[\s\-|:]*\|[\s\-|:]*\n(?:\|.*\|.*\n)*'
        
        matches = re.finditer(table_pattern, content, re.MULTILINE)
        
        for table_idx, match in enumerate(matches):
            table_text = match.group(0)
            lines = table_text.strip().split('\n')
            
            if len(lines) < 2:
                continue
            
            header_line = lines[0]
            headers = [h.strip() for h in header_line.split('|')[1:-1]]
            
            data_rows = []
            for line in lines[2:]:
                if line.strip():
                    row = [cell.strip() for cell in line.split('|')[1:-1]]
                    data_rows.append(row)
            
            if data_rows:
                table_dict = {
                    'id': f'table_{table_idx:03d}',
                    'format': 'markdown',
                    'headers': headers,
                    'data': data_rows,
                    'shape': (len(data_rows), len(headers))
                }
                tables.append(table_dict)
        
        logger.info(f"Extracted {len(tables)} markdown tables")
        return tables
    
    def _extract_rst_tables(self, content: str) -> List[Dict]:
        tables = []
        
        table_pattern = r'^\+[-=+]+\n(?:\|.*\n)+\+[-=+]+\n'
        
        matches = re.finditer(table_pattern, content, re.MULTILINE)
        
        for table_idx, match in enumerate(matches):
            table_text = match.group(0)
            
            table_dict = {
                'id': f'table_{table_idx:03d}',
                'format': 'rst',
                'raw_text': table_text.strip()
            }
            tables.append(table_dict)
        
        logger.info(f"Extracted {len(tables)} RST tables")
        return tables
    
    def _extract_latex_formulas(self, content: str) -> List[str]:
        formulas = []
        
        display_pattern = r'\$\$(.+?)\$\$'
        display_matches = re.findall(display_pattern, content, re.DOTALL)
        formulas.extend([f"$${m}$$" for m in display_matches])
        
        inline_pattern = r'(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)'
        inline_matches = re.findall(inline_pattern, content)
        formulas.extend([f"${m}$" for m in inline_matches])
        
        bracket_pattern = r'\\\\?\[(.+?)\\\\?\]'
        bracket_matches = re.findall(bracket_pattern, content, re.DOTALL)
        formulas.extend([f"\\[{m}\\]" for m in bracket_matches])
        
        paren_pattern = r'\\\\?\((.+?)\\\\?\)'
        paren_matches = re.findall(paren_pattern, content)
        formulas.extend([f"\\({m}\\)" for m in paren_matches])
        
        return list(set(formulas))
    
    def _extract_metadata(self, file_path: str, content: str) -> Dict:
        file_ext = os.path.splitext(file_path)[1].lower()
        
        metadata = {
            'file_size': os.path.getsize(file_path),
            'file_name': os.path.basename(file_path),
            'file_type': file_ext[1:],
            'lines': len(content.split('\n')),
            'characters': len(content),
            'words': len(content.split())
        }
        
        if file_ext == '.md':
            headings = re.findall(r'^#{1,6}\s+(.+)$', content, re.MULTILINE)
            metadata['headings'] = headings
            
            if content.startswith('---'):
                frontmatter_match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
                if frontmatter_match:
                    metadata['has_frontmatter'] = True
                    frontmatter_lines = frontmatter_match.group(1).split('\n')
                    metadata['frontmatter_lines'] = len(frontmatter_lines)
        
        elif file_ext == '.rst':
            headings = re.findall(r'^([^\n]+)\n([-=`:"\'~^_*+#<>]{3,})', content, re.MULTILINE)
            metadata['headings'] = [h[0] for h in headings]
        
        return metadata
