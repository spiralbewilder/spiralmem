#!/usr/bin/env python3

"""Test faster_whisper transcription directly"""

import json
import sys
from faster_whisper import WhisperModel

def transcribe_audio(audio_path, model_name="base"):
    try:
        print(f"Loading Whisper model: {model_name}")
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        
        print(f"Transcribing: {audio_path}")
        segments, info = model.transcribe(audio_path, beam_size=5)
        
        print(f"Detected language: {info.language} (probability: {info.language_probability:.2f})")
        
        result = {
            "text": "",
            "language": info.language,
            "duration": info.duration,
            "segments": []
        }
        
        full_text = ""
        for segment in segments:
            full_text += segment.text + " "
            result["segments"].append({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip()
            })
        
        result["text"] = full_text.strip()
        
        return result
        
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 transcription-test.py <audio_file>")
        sys.exit(1)
    
    audio_file = sys.argv[1]
    result = transcribe_audio(audio_file)
    print(json.dumps(result, indent=2))