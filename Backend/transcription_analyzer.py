import whisper
import json
import sys
import re
from collections import Counter

# Use "tiny" model for faster processing
model = whisper.load_model("tiny")

# Process ENTIRE audio file
# OPTIMIZATION: Use faster settings for speed
result = model.transcribe(
    "tmp/audio.wav", 
    condition_on_previous_text=False,
    fp16=True,  # Use half precision for faster processing
    beam_size=1,  # Greedy decoding (faster than beam search)
    best_of=1  # Don't try multiple decodings
)

# Get full transcription text
full_text = result["text"]
full_text_lower = full_text.lower()

flags = []

# Split into sentences for context analysis
sentences = re.split(r'[.!?]+', full_text)
sentences = [s.strip() for s in sentences if s.strip()]

# 1. SCREAM DETECTION WITH CONTEXT
# Look for scream indicators in context (not just isolated words)
scream_patterns = [
    r'\b(ah+|ahh+|ahhh+|ahhhh+|aah+|aaah+|aaaah+)\b',
    r'\b(no+|noo+|nooo+|noooo+)\b',
    r'\b(help|help me|somebody help|someone help)\b',
    r'\b(scream|screaming|screamed|screams)\b',
]

# Count screams in context - look for emotional distress indicators
scream_count = 0
scream_sentences = []

for sentence in sentences:
    sentence_lower = sentence.lower()
    for pattern in scream_patterns:
        if re.search(pattern, sentence_lower):
            # Check if sentence has distress context
            distress_indicators = ['fear', 'scared', 'afraid', 'terrified', 'panic', 'danger', 'hurt', 'pain']
            if any(indicator in sentence_lower for indicator in distress_indicators):
                scream_count += 2  # Weighted higher if in distress context
                scream_sentences.append(sentence[:100])  # Store context
            else:
                scream_count += 1

# If many screams detected (more than 5), flag it
if scream_count > 5:
    flags.append(f"excessive screams detected ({scream_count} instances) - context suggests distress")

# 2. HORROR CONTENT DETECTION WITH CONTEXT
# Analyze horror content in context, not just keyword counting
horror_keywords = [
    "horror", "horrifying", "terrifying", "scary", "frightening",
    "ghost", "ghosts", "demon", "demons", "monster", "monsters", "haunted", "haunting",
    "killer", "killers", "murderer", "murderers", "psycho", "psychopath",
    "blood", "bloody", "gore", "gory", "guts", "corpse", "corpses",
    "death", "dying", "kill", "killing", "murder", "murdered",
    "torture", "tortured", "torturing", "pain", "suffering",
    "nightmare", "nightmares", "terror", "terrorize", "fear"
]

# Context-aware horror detection
horror_sentences = []
horror_score = 0

for sentence in sentences:
    sentence_lower = sentence.lower()
    sentence_horror_count = 0
    
    for keyword in horror_keywords:
        pattern = r'\b' + re.escape(keyword) + r'\b'
        if re.search(pattern, sentence_lower):
            sentence_horror_count += 1
    
    # If sentence has multiple horror keywords, it's more concerning
    if sentence_horror_count > 0:
        # Check for violent action verbs in same sentence
        violent_verbs = ['kill', 'murder', 'torture', 'hurt', 'attack', 'stab', 'shoot', 'cut']
        if any(verb in sentence_lower for verb in violent_verbs):
            horror_score += sentence_horror_count * 2  # Weighted higher
            horror_sentences.append(sentence[:150])
        else:
            horror_score += sentence_horror_count

# If significant horror content (score > 10), flag it
if horror_score > 10:
    flags.append(f"horror content detected (severity score: {horror_score}) - context suggests violent/horror themes")

# 3. WEAPON MENTIONS WITH CONTEXTUAL ANALYSIS
weapon_keywords = [
    "knife", "knives", "blade", "blades",
    "gun", "guns", "pistol", "pistols", "rifle", "rifles",
    "weapon", "weapons", "firearm", "firearms", "machete", "machetes", "scissors"
]

weapon_count = 0
dangerous_weapon_contexts = []

for sentence in sentences:
    sentence_lower = sentence.lower()
    for weapon in weapon_keywords:
        pattern = r'\b' + re.escape(weapon) + r'\b'
        if re.search(pattern, sentence_lower):
            # Check context: is it dangerous or educational/neutral?
            dangerous_indicators = ['kill', 'murder', 'attack', 'stab', 'shoot', 'hurt', 'threat', 'danger', 'weapon', 'fight', 'violence']
            neutral_indicators = ['cooking', 'kitchen', 'tool', 'cutting', 'food', 'recipe', 'craft', 'art', 'museum', 'history', 'educational']
            
            has_dangerous_context = any(indicator in sentence_lower for indicator in dangerous_indicators)
            has_neutral_context = any(indicator in sentence_lower for indicator in neutral_indicators)
            
            # Only count as dangerous if context suggests threat, not educational use
            if has_dangerous_context and not has_neutral_context:
                weapon_count += 2  # Weighted higher for dangerous context
                dangerous_weapon_contexts.append(sentence[:150])
            elif not has_neutral_context:
                weapon_count += 1  # Neutral mention, lower weight

# If weapons mentioned in dangerous contexts (count > 3), flag it
if weapon_count > 3:
    flags.append(f"weapons mentioned in dangerous contexts ({weapon_count} weighted mentions)")

# 4. COMBINED THREAT ASSESSMENT WITH CONTEXT
# Analyze overall video context
danger_score = 0
if scream_count > 5:
    danger_score += 2
if horror_score > 10:
    danger_score += 2
if weapon_count > 3:
    danger_score += 2

# Check for escalation patterns (screams + weapons + horror together)
escalation_patterns = 0
for sentence in sentences:
    sentence_lower = sentence.lower()
    has_scream = any(re.search(pattern, sentence_lower) for pattern in scream_patterns)
    has_weapon = any(re.search(r'\b' + re.escape(w) + r'\b', sentence_lower) for w in weapon_keywords)
    has_horror = any(re.search(r'\b' + re.escape(h) + r'\b', sentence_lower) for h in horror_keywords[:10])  # Check first 10 horror keywords
    
    if (has_scream and has_weapon) or (has_scream and has_horror) or (has_weapon and has_horror):
        escalation_patterns += 1

if escalation_patterns > 2:
    flags.append(f"escalation patterns detected ({escalation_patterns} instances of combined danger elements)")

# If high danger score, add a general warning
if danger_score >= 4:
    flags.append("high danger score: multiple concerning elements detected with dangerous context (screams, horror, weapons)")

# Output flags as JSON
print(json.dumps(flags))
