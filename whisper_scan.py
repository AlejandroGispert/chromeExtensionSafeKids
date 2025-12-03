import whisper
import json
import sys
import subprocess
import os

# Use "tiny" model for 5x faster processing (slightly less accurate but much faster)
model = whisper.load_model("tiny")

# Extract only first 2 minutes (120 seconds) for quick scan
# This catches most inappropriate content which usually appears early
quick_audio_path = "tmp/audio_quick.wav"
try:
    subprocess.run([
        "ffmpeg", "-i", "tmp/audio.wav", 
        "-t", "120",  # First 120 seconds (2 minutes)
        "-y",  # Overwrite if exists
        quick_audio_path
    ], check=True, capture_output=True)
    
    # Process only the first 2 minutes
    audio_file = quick_audio_path
except:
    # Fallback to full audio if extraction fails
    audio_file = "tmp/audio.wav"

result = model.transcribe(audio_file, condition_on_previous_text=False)

# Get transcription text
text = result["text"].lower()

# Expanded list of inappropriate words/phrases
bad_words = [
    "fuck", "fucking", "fucked", "shit", "shitting", "sex", "sexual", "cocaine", 
    "marijuana", "weed", "drug", "kill", "killing", "killed", "pedo", "pedophile",
    "ass", "bitch", "damn", "hell", "porn", "pornography", "nude", "naked",
    "violence", "violent", "gun", "shoot", "shooting", "murder", "death", "die"
]

flags = []
for w in bad_words:
    # Use word boundaries to avoid false positives (e.g., "class" containing "ass")
    import re
    pattern = r'\b' + re.escape(w) + r'\b'
    if re.search(pattern, text):
        flags.append(f"inappropriate language: {w}")

print(json.dumps(flags))
