# Kidsafe Chrome Extension

Chrome extension that automatically checks YouTube videos for inappropriate content using AI.

## Installation

### 1. Load the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `extension` folder from this project
5. The extension should now appear in your extensions list

### 2. Start the Backend Server

The extension requires the backend server to be running:

```bash
cd backend
node server.cjs
```

The server should start on `http://localhost:4000`

### 3. Create Extension Icons (Optional)

The extension needs icon files. You can create simple placeholder icons:

- `icon16.png` - 16x16 pixels
- `icon48.png` - 48x48 pixels
- `icon128.png` - 128x128 pixels

Or use an online icon generator to create shield/safety-themed icons.

## Usage

1. Navigate to any YouTube video
2. The extension will automatically check the video safety
3. A badge will appear showing:

   - ✅ **Safe for Kids** - No issues detected
   - ⚠️ **Not Safe for Kids** - Issues detected
   - ⏳ **Checking...** - Analysis in progress

4. Click the extension icon in the toolbar to see detailed results in the popup

## Features

- **Automatic Detection**: Checks videos automatically when you visit them
- **Real-time Analysis**: Uses AI to analyze audio and video content
- **Visual Indicators**: Clear badges on YouTube pages
- **Detailed Results**: Popup shows specific reasons if content is unsafe
- **Caching**: Results are cached for faster subsequent checks

## Troubleshooting

### Extension shows "Backend not running"

Make sure the backend server is running:

```bash
cd backend
node server.cjs
```

### CORS Errors

The backend already has CORS enabled. If you see CORS errors, check:

- Backend is running on `http://localhost:4000`
- Extension has proper permissions in `manifest.json`

### Icons Missing

Create placeholder PNG files or use an icon generator. The extension will work without icons, but Chrome may show warnings.

## Development

To modify the extension:

1. Edit files in the `extension` folder
2. Go to `chrome://extensions/`
3. Click the refresh icon on the Kidsafe extension card
4. Reload the YouTube page to see changes

## Files Structure

- `manifest.json` - Extension configuration
- `content.js` - Runs on YouTube pages, shows badges
- `background.js` - Service worker for API calls
- `popup.html/js/css` - Extension popup UI
- `styles.css` - Styles for YouTube page badges
