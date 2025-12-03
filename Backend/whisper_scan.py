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

# OPTIMIZATION: Use faster settings for speed
result = model.transcribe(
    audio_file, 
    condition_on_previous_text=False,
    fp16=True,  # Use half precision for faster processing
    beam_size=1,  # Greedy decoding (faster than beam search)
    best_of=1  # Don't try multiple decodings
)

# Get transcription text
text = result["text"].lower()

# Expanded list of inappropriate words/phrases (including suicide, self-harm, etc.)
bad_words = [
    "fuck", "fucking", "fucked", "shit", "shitting", "sex", "sexual", "cocaine", 
    "marijuana", "weed", "drug", "kill", "killing", "killed", "pedo", "pedophile",
    "ass", "bitch", "damn", "hell", "porn", "pornography", "nude", "naked",
    "violence", "violent", "gun", "shoot", "shooting", "murder", "death", "die",
    "suicide", "suicidal", "kill myself", "end my life", "self harm", "self-harm",
    "cutting", "cut myself", "hang myself", "overdose", "overdosing"
]

# Scream detection patterns
scream_patterns = [
    r'\b(ah+|ahh+|ahhh+|ahhhh+|aah+|aaah+|aaaah+)\b',  # Repeated "ah" sounds
    r'\b(no+|noo+|nooo+|noooo+)\b',  # Repeated "no" (distress)
    r'\b(help|help me|somebody help)\b',  # Help calls
    r'\b(scream|screaming|screamed|screams)\b',  # Explicit scream words
    r'\b(aa+|ee+|ii+|oo+|uu+)\b',  # Long vowel sounds (screams)
]

import re

flags = []

# 1. Check for inappropriate words
for w in bad_words:
    # Use word boundaries to avoid false positives
    pattern = r'\b' + re.escape(w) + r'\b'
    if re.search(pattern, text, re.IGNORECASE):
        flags.append(f"inappropriate language: {w}")

# 2. Scream detection (more thorough in 2-minute scan)
scream_count = 0
for pattern in scream_patterns:
    matches = re.findall(pattern, text, re.IGNORECASE)
    scream_count += len(matches)

# If multiple scream indicators found, flag it
if scream_count >= 3:
    flags.append(f"screams detected in audio ({scream_count} instances)")

print(json.dumps(flags))
