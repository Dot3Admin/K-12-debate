import os
from typing import Dict, List
import logging

logger = logging.getLogger(__name__)

try:
    import pandas as pd
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False
    logger.error("pandas not available")

from . import BaseProcessor


class ExcelProcessor(BaseProcessor):
    def process(self, file_path: str) -> Dict:
        if not PANDAS_AVAILABLE:
            raise RuntimeError("pandas not installed")
        
        logger.info(f"Processing Excel: {file_path}")
        
        result = {
            'text': '',
            'tables': [],
            'images': [],
            'formulas': [],
            'metadata': {}
        }
        
        try:
            if file_path.lower().endswith('.csv'):
                df = pd.read_csv(file_path)
                result['tables'] = [self._dataframe_to_table(df, 'Sheet1', 0)]
                result['text'] = df.to_string()
                result['metadata'] = {
                    'file_type': 'csv',
                    'shape': df.shape,
                    'columns': list(df.columns)
                }
            else:
                excel_file = pd.ExcelFile(file_path)
                
                all_dfs = {}
                for sheet_name in excel_file.sheet_names:
                    df = pd.read_excel(file_path, sheet_name=sheet_name)
                    all_dfs[sheet_name] = df
                    
                    table_dict = self._dataframe_to_table(df, sheet_name, len(result['tables']))
                    result['tables'].append(table_dict)
                
                text_parts = []
                for sheet_name, df in all_dfs.items():
                    text_parts.append(f"=== {sheet_name} ===\n{df.to_string()}")
                result['text'] = '\n\n'.join(text_parts)
                
                result['metadata'] = {
                    'file_type': 'xlsx/xls',
                    'sheet_names': excel_file.sheet_names,
                    'total_sheets': len(excel_file.sheet_names)
                }
            
        except Exception as e:
            logger.error(f"Excel processing error: {e}")
            raise
        
        logger.info(f"Excel processing complete: {len(result['tables'])} sheets")
        
        return result
    
    def _dataframe_to_table(self, df: pd.DataFrame, sheet_name: str, index: int) -> Dict:
        table_dict = {
            'id': f'table_{index:03d}',
            'sheet_name': sheet_name,
            'data': df.to_dict('records'),
            'shape': df.shape,
            'columns': list(df.columns),
            'dtypes': {col: str(dtype) for col, dtype in df.dtypes.items()}
        }
        
        return table_dict
