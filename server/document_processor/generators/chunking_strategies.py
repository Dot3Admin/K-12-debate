from typing import List, Dict
import re
import logging

logger = logging.getLogger(__name__)


class ChunkingStrategy:
    def chunk(self, text: str, metadata: Dict | None = None) -> List[Dict]:
        raise NotImplementedError


class FixedSizeChunking(ChunkingStrategy):
    def __init__(self, chunk_size: int = 512, overlap: int = 128):
        self.chunk_size = chunk_size
        self.overlap = overlap
    
    def chunk(self, text: str, metadata: Dict | None = None) -> List[Dict]:
        chunks = []
        words = text.split()
        
        for i in range(0, len(words), self.chunk_size - self.overlap):
            chunk_words = words[i:i + self.chunk_size]
            chunk_text = ' '.join(chunk_words)
            
            chunks.append({
                'text': chunk_text,
                'chunk_index': len(chunks),
                'char_count': len(chunk_text),
                'word_count': len(chunk_words),
                'metadata': metadata or {}
            })
        
        logger.info(f"Created {len(chunks)} fixed-size chunks")
        return chunks


class SemanticChunking(ChunkingStrategy):
    def __init__(self, min_chunk_size: int = 200, max_chunk_size: int = 800):
        self.min_chunk_size = min_chunk_size
        self.max_chunk_size = max_chunk_size
    
    def chunk(self, text: str, metadata: Dict | None = None) -> List[Dict]:
        chunks = []
        
        paragraphs = text.split('\n\n')
        
        current_chunk = []
        current_length = 0
        
        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            
            para_length = len(para)
            
            if current_length + para_length > self.max_chunk_size and current_chunk:
                chunk_text = '\n\n'.join(current_chunk)
                chunks.append({
                    'text': chunk_text,
                    'chunk_index': len(chunks),
                    'char_count': len(chunk_text),
                    'word_count': len(chunk_text.split()),
                    'metadata': metadata or {}
                })
                current_chunk = []
                current_length = 0
            
            current_chunk.append(para)
            current_length += para_length
        
        if current_chunk:
            chunk_text = '\n\n'.join(current_chunk)
            chunks.append({
                'text': chunk_text,
                'chunk_index': len(chunks),
                'char_count': len(chunk_text),
                'word_count': len(chunk_text.split()),
                'metadata': metadata or {}
            })
        
        logger.info(f"Created {len(chunks)} semantic chunks")
        return chunks


class SentenceChunking(ChunkingStrategy):
    def __init__(self, sentences_per_chunk: int = 5, overlap_sentences: int = 1):
        self.sentences_per_chunk = sentences_per_chunk
        self.overlap_sentences = overlap_sentences
    
    def chunk(self, text: str, metadata: Dict | None = None) -> List[Dict]:
        chunks = []
        
        sentences = re.split(r'(?<=[.!?])\s+', text)
        
        for i in range(0, len(sentences), self.sentences_per_chunk - self.overlap_sentences):
            chunk_sentences = sentences[i:i + self.sentences_per_chunk]
            chunk_text = ' '.join(chunk_sentences)
            
            chunks.append({
                'text': chunk_text,
                'chunk_index': len(chunks),
                'char_count': len(chunk_text),
                'word_count': len(chunk_text.split()),
                'sentence_count': len(chunk_sentences),
                'metadata': metadata or {}
            })
        
        logger.info(f"Created {len(chunks)} sentence-based chunks")
        return chunks


def get_chunking_strategy(strategy_name: str = 'semantic', **kwargs) -> ChunkingStrategy:
    if strategy_name == 'fixed':
        return FixedSizeChunking(**kwargs)
    elif strategy_name == 'semantic':
        return SemanticChunking(**kwargs)
    elif strategy_name == 'sentence':
        return SentenceChunking(**kwargs)
    else:
        raise ValueError(f"Unknown chunking strategy: {strategy_name}")
