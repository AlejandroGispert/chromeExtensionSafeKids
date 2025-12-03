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
**Duration:** ~20-40 seconds (optimized)  
**Status:** `"quick"`

- **Audio Analysis:** First 2 minutes transcribed and checked for bad words
- **Image Analysis:** Up to 30 frames analyzed for dangerous objects (weapons, knives, guns)
- **Parallel Processing:** Audio processing starts immediately after audio download, video downloads in parallel
- **Early Exit:** If unsafe content detected in audio, video download is skipped entirely
- **Optimized:** Uses faster Whisper settings (fp16, greedy decoding) for 2x speedup

**Result:** Returns preliminary safe/unsafe status to user immediately

### Phase 2: Full Audio Word Filtering (Background)
**Duration:** ~2-5 minutes (depending on video length)  
**Status:** `"phase2"` (if safe) or `"full"` (if unsafe found)

- **Full Audio Transcription:** Entire video audio transcribed using Whisper AI
- **Word Filtering:** Checks entire transcription for inappropriate words/phrases
- **Fast Processing:** Simple keyword matching (faster than context analysis)
- **Parallel with Phase 3:** Runs simultaneously with Phase 3 for maximum efficiency

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
- **Parallel with Phase 2:** Runs simultaneously with Phase 2 for faster completion

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
Phase 1: Quick Scan
    ├─→ Download Audio (priority)
    ├─→ Start Audio Processing Immediately
    ├─→ Download Video (in parallel)
    ├─→ If Audio Unsafe → Skip Video, Return Immediately
    ├─→ Extract Frames (30 frames, every 15s)
    └─→ Process Images
         ├─→ Unsafe? → Return immediately
         └─→ Safe? → Return preliminary result + Start Phase 2 & 3 (parallel)
                        ↓
            Phase 2: Full Audio Word Filtering (parallel)
            Phase 3: Context-Aware Analysis (parallel)
                ├─→ Either finds unsafe? → Update DB, block page
                └─→ Both safe? → Final confirmation
```

## Performance Optimizations

The system includes several performance optimizations:

1. **Early Exit Strategy:** If audio finds unsafe content, video download is skipped (50-70% faster for unsafe videos)
2. **Parallel Processing:** Audio processing starts while video downloads, Phase 2 & 3 run simultaneously
3. **Reduced Frame Processing:** 30 frames instead of 50, extracted every 15s instead of 10s (40% faster)
4. **Optimized Whisper:** Uses fp16 precision, greedy decoding (beam_size=1) for 2x faster transcription
5. **Smart Caching:** Results cached in database to avoid re-scanning

**Performance:**
- **Phase 1:** ~20-40 seconds (optimized, was 30-60s)
- **Phase 2 & 3:** ~2-8 minutes (parallel, background)
- **Unsafe Videos:** 50-70% faster (skips video download)
- **Safe Videos:** 30-40% faster overall

## Development Environment Setup

### Prerequisites

- **Node.js** 18+ (for backend server)
- **Python** 3.11+ (for AI processing)
- **ffmpeg** (for audio/video processing)
- **yt-dlp** (for YouTube downloads)

### Installation

1. **Clone the repository:**
```bash
git clone <repository-url>
cd kidsafe/backend/Backend
```

2. **Install Node.js dependencies:**
```bash
npm install
```

3. **Create Python virtual environment:**
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

4. **Install Python dependencies:**
```bash
pip install openai-whisper ultralytics opencv-python numpy==1.26.4
```

**Note:** NumPy 1.26.4 is required (not 2.x) for compatibility with PyTorch/Ultralytics.

5. **Install system dependencies:**

**macOS:**
```bash
brew install ffmpeg yt-dlp
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install ffmpeg
pip install yt-dlp
```

**Windows:**
```bash
# Download ffmpeg from https://ffmpeg.org/download.html
# Install yt-dlp via pip
pip install yt-dlp
```

6. **Download YOLO model:**
The `yolov8n.pt` model will be downloaded automatically on first run of `image_scan.py`.

### Running the Development Server

1. **Activate Python virtual environment:**
```bash
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. **Start the server:**
```bash
node server.cjs
```

The server will run on `http://localhost:4000`

3. **Verify installation:**
```bash
curl http://localhost:4000/health
# Should return: {"status":"ok","service":"kidsafe-backend"}
```

### Development Workflow

1. **Backend Development:**
   - Main server: `server.cjs`
   - Routes: `routes/analyze.js`, `routes/index.js`
   - Modules: `config.js`, `database.js`, `download.js`, `scanner.js`, `phases.js`, `utils.js`, `middleware.js`

2. **Python Scripts:**
   - `whisper_scan.py` - Phase 1 quick audio scan
   - `whisper_scan_full.py` - Phase 2 full audio word filtering
   - `transcription_analyzer.py` - Phase 3 context-aware analysis
   - `image_scan.py` - Image/weapon detection

3. **Testing:**
   - Test with a YouTube video ID: `curl -X POST http://localhost:4000/analyze -H "Content-Type: application/json" -d '{"videoId":"dQw4w9WgXcQ"}'`
   - Check database: `sqlite3 videos.db "SELECT * FROM videos LIMIT 5;"`

4. **Debugging:**
   - Check server logs for detailed processing information
   - Python scripts output JSON to stdout, errors to stderr
   - Temporary files in `tmp/` directory (cleaned up automatically)

### Environment Configuration

The system uses configuration in `config.js`:

- **Python Command:** Automatically detects venv Python or falls back to system `python3`
- **Timeouts:** Configurable timeouts for each operation
- **Paths:** All paths are relative to the `Backend` directory

### File Structure

```
Backend/
├── server.cjs              # Main Express server entry point
├── config.js               # Configuration (paths, timeouts, commands)
├── database.js             # Database setup and helper functions
├── utils.js                # Utility functions (cleanup, JSON parsing)
├── download.js             # Download operations (audio, video, frames)
├── scanner.js              # Scanning functions (all AI processing)
├── phases.js               # Phase execution logic
├── middleware.js           # Express middleware
├── routes/
│   ├── analyze.js          # Main /analyze route handler
│   └── index.js            # Other routes (/, /health, 404)
├── whisper_scan.py         # Phase 1: Quick audio scan (2 min)
├── whisper_scan_full.py    # Phase 2: Full audio word filtering
├── transcription_analyzer.py  # Phase 3: Context-aware analysis
├── image_scan.py           # Image analysis (weapon detection)
├── videos.db               # SQLite database (auto-created)
├── tmp/                    # Temporary files (auto-cleaned)
├── venv/                   # Python virtual environment
├── package.json            # Node.js dependencies
└── jsconfig.json           # JavaScript/TypeScript configuration
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

### `GET /`
API information endpoint.

**Response:**
```json
{
  "service": "Kidsafe Backend",
  "version": "1.0.0",
  "endpoints": {
    "POST /analyze": "Analyze a YouTube video for safety",
    "GET /health": "Health check endpoint"
  }
}
```

## Database

The system uses SQLite to cache scan results. The database is automatically created on first run.

**Schema:**
- `videoId`: TEXT PRIMARY KEY (YouTube video ID)
- `safe`: INTEGER (1 = safe, 0 = unsafe)
- `reasons`: TEXT (JSON array of detected issues)
- `scannedAt`: TEXT (Timestamp of last scan)
- `scanStatus`: TEXT (`"quick"`, `"phase2"`, or `"full"`)

**Database Location:** `Backend/videos.db`

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

## Error Handling

The system includes robust error handling:
- Database connection errors (auto-creates database if missing)
- Download failures (multiple fallback strategies with different YouTube clients)
- AI processing timeouts (configurable per operation)
- File cleanup on errors (automatic temp file removal)
- Graceful degradation (returns preliminary results on errors)
- Corrupted video file detection (validates before processing)

## Troubleshooting

### Common Issues

1. **"Backend not running" in extension:**
   - Ensure server is running: `node server.cjs`
   - Check port 4000 is not in use
   - Verify `http://localhost:4000/health` returns OK

2. **Python import errors:**
   - Ensure virtual environment is activated: `source venv/bin/activate`
   - Verify packages are installed: `pip list | grep whisper`
   - Check Python path in `config.js`

3. **Download failures (403 Forbidden):**
   - Update yt-dlp: `yt-dlp -U`
   - System uses multiple fallback strategies automatically

4. **Database errors:**
   - Database is auto-created on first run
   - Check file permissions: `chmod 666 videos.db`
   - Delete and recreate if corrupted: `rm videos.db`

5. **Frame extraction errors:**
   - Verify ffmpeg is installed: `ffmpeg -version`
   - Check video file is not corrupted (system validates automatically)

## License

ISC
