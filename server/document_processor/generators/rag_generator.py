from typing import List, Dict
import json
import logging

logger = logging.getLogger(__name__)

from .chunking_strategies import get_chunking_strategy


class RAGGenerator:
    def __init__(self, chunking_strategy: str = 'semantic', **strategy_kwargs):
        self.chunker = get_chunking_strategy(chunking_strategy, **strategy_kwargs)
    
    def generate_chunks(self, processed_doc: Dict) -> List[Dict]:
        logger.info("Generating RAG chunks from processed document")
        
        text = processed_doc.get('text', '')
        metadata = processed_doc.get('metadata', {})
        
        if not text:
            logger.warning("No text found in document")
            return []
        
        chunks = self.chunker.chunk(text, metadata)
        
        for chunk in chunks:
            self._enrich_chunk(chunk, processed_doc)
        
        logger.info(f"Generated {len(chunks)} RAG chunks")
        return chunks
    
    def _enrich_chunk(self, chunk: Dict, processed_doc: Dict):
        chunk['has_tables'] = len(processed_doc.get('tables', [])) > 0
        chunk['has_images'] = len(processed_doc.get('images', [])) > 0
        chunk['has_formulas'] = len(processed_doc.get('formulas', [])) > 0
        
        keywords = self._extract_keywords(chunk['text'])
        chunk['keywords'] = keywords
    
    def _extract_keywords(self, text: str) -> List[str]:
        words = text.lower().split()
        
        stopwords = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
                     'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
                     '이', '그', '저', '것', '수', '등', '및', '에', '를', '을', '의', '가', '이'}
        
        keywords = [w for w in words if len(w) > 2 and w not in stopwords]
        
        word_freq = {}
        for w in keywords:
            word_freq[w] = word_freq.get(w, 0) + 1
        
        sorted_keywords = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)
        
        top_keywords = [w for w, count in sorted_keywords[:20]]
        
        return top_keywords
    
    def save_chunks(self, chunks: List[Dict], output_path: str):
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(chunks, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Saved {len(chunks)} chunks to {output_path}")
