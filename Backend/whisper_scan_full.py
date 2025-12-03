import whisper
import json
import sys

# Use "tiny" model for faster processing
model = whisper.load_model("tiny")

# Process ENTIRE audio file (no time limit)
result = model.transcribe("tmp/audio.wav", condition_on_previous_text=False)

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
        flags.append(f"bad speech: {w}")

print(json.dumps(flags))

