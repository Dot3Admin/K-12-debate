
import sys
import json
import os
sys.path.insert(0, os.path.dirname(__file__))

from processors import get_processor

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)
    
    file_path = sys.argv[1]
    original_name = sys.argv[2] if len(sys.argv) > 2 else None
    
    try:
        processor = get_processor(file_path, original_name)
        result = processor.process(file_path)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
