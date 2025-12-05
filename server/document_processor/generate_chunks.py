
import sys
import json
import os
sys.path.insert(0, os.path.dirname(__file__))

from generators.rag_generator import RAGGenerator

def main():
    try:
        # Read from stdin instead of command-line args
        input_data = sys.stdin.read()
        processed_doc = json.loads(input_data)
        
        generator = RAGGenerator(chunking_strategy='semantic', min_chunk_size=200, max_chunk_size=500)
        chunks = generator.generate_chunks(processed_doc)
        print(json.dumps(chunks, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
