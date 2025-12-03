# Kidsafe 

AI-powered YouTube video content safety checker for children.

## Overview

Kidsafe uses a **3-phase progressive scanning system** to analyze YouTube videos for inappropriate content, including:
- Inappropriate language and profanity
- Dangerous objects (weapons, knives, guns)
- Horror content and violence
- Screams and distress indicators
- Context-aware threat detection

## 3-Phase Scanning System

### Phase 1: Quick Scan (Immediate Response)
**Duration:** ~30-60 seconds  
**Status:** `"quick"`

- **Audio Analysis:** First 2 minutes transcribed and checked for bad words
- **Image Analysis:** Up to 50 frames analyzed for dangerous objects (weapons, knives, guns)
- **Parallel Processing:** Audio and images analyzed simultaneously for speed
- **Early Exit:** If unsafe content detected, returns immediately

**Result:** Returns preliminary safe/unsafe status to user immediately

### Phase 2: Full Audio Word Filtering (Background)
**Duration:** ~2-5 minutes (depending on video length)  
**Status:** `"phase2"` (if safe) or `"full"` (if unsafe found)

- **Full Audio Transcription:** Entire video audio transcribed using Whisper AI
- **Word Filtering:** Checks entire transcription for inappropriate words/phrases
- **Fast Processing:** Simple keyword matching (faster than context analysis)

**Result:** 
- If unsafe content found → Updates database and stops (skips Phase 3)
- If safe → Proceeds to Phase 3 for deeper analysis

### Phase 3: Context-Aware AI Analysis (Final Check)
**Duration:** ~3-8 minutes (depending on video length)  
**Status:** `"full"` (final confirmation)

- **Context Analysis:** Analyzes transcription with intelligent context understanding
- **Scream Detection:** Detects excessive screams with distress context (not just casual mentions)
- **Horror Content:** Identifies horror themes with violence detection
- **Weapon Context:** Distinguishes dangerous weapon mentions from educational/neutral uses
- **Escalation Patterns:** Detects when multiple danger elements appear together

**Features:**
- ✅ Understands context (e.g., "kitchen knife" vs "knife to attack")
- ✅ Weighted scoring based on dangerous vs. neutral context
- ✅ Detects escalation patterns (screams + weapons + horror together)
- ✅ Sentence-level analysis for better accuracy

**Result:** Final safety confirmation with detailed reasons

## Architecture

```
User Request
    ↓
Phase 1: Quick Scan (2min audio + images)
    ├─→ Unsafe? → Return immediately
    └─→ Safe? → Return preliminary result + Start Phase 2
                    ↓
            Phase 2: Full Audio Word Filtering
                ├─→ Unsafe? → Update DB, stop
                └─→ Safe? → Update DB, start Phase 3
                                ↓
                        Phase 3: Context-Aware Analysis
                            ├─→ Unsafe? → Update DB
                            └─→ Safe? → Final confirmation
```

## API Endpoints

### `POST /analyze`
Analyzes a YouTube video for safety.

**Request:**
```json
{
  "videoId": "dQw4w9WgXcQ"
}
```

**Response (Phase 1 - Preliminary):**
```json
{
  "videoId": "dQw4w9WgXcQ",
  "safe": true,
  "reasons": [],
  "cached": false,
  "scanType": "preliminary",
  "scanning": true
}
```

**Response (Phase 2/3 - Complete):**
```json
{
  "videoId": "dQw4w9WgXcQ",
  "safe": false,
  "reasons": [
    "inappropriate language: fuck",
    "weapons mentioned multiple times (5 mentions)",
    "excessive screams detected (12 instances) - context suggests distress"
  ],
  "cached": false,
  "scanType": "full",
  "scanStatus": "full"
}
```

### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "service": "kidsafe-backend"
}
```

## Installation

### Prerequisites
- Node.js 18+
- Python 3.11+
- ffmpeg
- yt-dlp

### Setup

1. **Install Node.js dependencies:**
```bash
npm install
```

2. **Create Python virtual environment:**
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. **Install Python dependencies:**
```bash
pip install openai-whisper ultralytics opencv-python numpy
```

4. **Download YOLO model:**
The `yolov8n.pt` model will be downloaded automatically on first run.

5. **Start the server:**
```bash
node server.cjs
```

The server will run on `http://localhost:4000`

## Database

The system uses SQLite to cache scan results. The database tracks:
- `videoId`: YouTube video ID
- `safe`: Boolean (1 = safe, 0 = unsafe)
- `reasons`: JSON array of detected issues
- `scannedAt`: Timestamp of last scan
- `scanStatus`: `"quick"`, `"phase2"`, or `"full"`

## Detection Capabilities

### Inappropriate Language
- Profanity and swear words
- Sexual content references
- Drug-related terms
- Violence-related language

### Dangerous Objects
- Knives, blades, swords
- Guns, pistols, rifles
- Other weapons (machetes, axes, etc.)

### Horror & Violence
- Horror themes and keywords
- Violence indicators
- Blood, gore, death mentions
- Torture and suffering references

### Screams & Distress
- Excessive scream patterns
- Distress indicators
- Help calls
- Emotional distress context

### Context-Aware Analysis
- Distinguishes dangerous vs. educational weapon mentions
- Detects escalation patterns (multiple dangers together)
- Weighted scoring based on context
- Sentence-level understanding

## Performance

- **Phase 1:** ~30-60 seconds (immediate response)
- **Phase 2:** ~2-5 minutes (background)
- **Phase 3:** ~3-8 minutes (background)
- **Total:** ~5-13 minutes for complete analysis

The system is optimized for speed:
- Parallel processing in Phase 1
- Early exit on unsafe detection
- Smart frame sampling (max 50 frames)
- Fast Whisper model ("tiny" for 5x speed)

## Error Handling

The system includes robust error handling:
- Database connection errors
- Download failures (multiple fallback strategies)
- AI processing timeouts
- File cleanup on errors
- Graceful degradation

## File Structure

```
Backend/
├── server.cjs              # Main Express server
├── whisper_scan.py         # Phase 1: Quick audio scan (2 min)
├── whisper_scan_full.py   # Phase 2: Full audio word filtering
├── transcription_analyzer.py  # Phase 3: Context-aware analysis
├── image_scan.py           # Image analysis (weapon detection)
├── videos.db              # SQLite database
├── tmp/                   # Temporary files (audio, video, frames)
└── venv/                  # Python virtual environment
```

## License

ISC

