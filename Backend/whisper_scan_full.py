import whisper
import json
import sys

# Use "tiny" model for faster processing
model = whisper.load_model("tiny")

# Process ENTIRE audio file (no time limit)
# OPTIMIZATION: Use faster settings for speed
result = model.transcribe(
    "tmp/audio.wav", 
    condition_on_previous_text=False,
    fp16=True,  # Use half precision for faster processing
    beam_size=1,  # Greedy decoding (faster than beam search)
    best_of=1  # Don't try multiple decodings
)

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
    pattern = r'\b' + re.escape(w) + r'\b'
    if re.search(pattern, text):
        flags.append(f"bad speech: {w}")

print(json.dumps(flags))
sys.stdout.flush()

