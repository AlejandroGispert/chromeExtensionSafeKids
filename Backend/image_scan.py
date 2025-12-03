from ultralytics import YOLO
import cv2
import os
import json
import sys

# Suppress YOLO verbose output - redirect to stderr so JSON goes to stdout
import warnings
warnings.filterwarnings("ignore")

# Suppress YOLO progress messages
os.environ["YOLO_VERBOSE"] = "False"

model = YOLO("yolov8n.pt", verbose=False)

flags = []

# Expanded list of dangerous objects to detect
dangerous_objects = [
    "knife", "gun", "pistol", "rifle", "weapon", "firearm",
    "sword", "machete", "axe", "scissors", "blade"
]

# Get sorted list of frame files and limit to first 50
frame_files = sorted([f for f in os.listdir("tmp") if f.endswith(".jpg")])[:50]

for file in frame_files:
    img_path = f"tmp/{file}"
    # Run with verbose=False to suppress progress output
    results = model(img_path, verbose=False)

    for r in results:
        for cls in r.boxes.cls:
            name = model.names[int(cls)].lower()
            # Check if detected object is in dangerous list
            if any(danger in name for danger in dangerous_objects):
                flags.append(f"weapon detected: {name}")
    
    # Early exit: if we found something dangerous, stop processing
    if flags:
        break

# Only print JSON to stdout, everything else goes to stderr
print(json.dumps(flags), file=sys.stdout)
sys.stdout.flush()
