from ultralytics import YOLO
import cv2
import os
import json
import sys
import numpy as np

# Suppress YOLO verbose output - redirect to stderr so JSON goes to stdout
import warnings
warnings.filterwarnings("ignore")

# Suppress YOLO progress messages
os.environ["YOLO_VERBOSE"] = "False"

model = YOLO("yolov8n.pt", verbose=False)

flags = []

# Expanded list of dangerous objects to detect (weapons)
dangerous_objects = [
    "knife", "gun", "pistol", "rifle", "weapon", "firearm",
    "sword", "machete", "axe", "scissors", "blade"
]

# Additional scary/dangerous objects YOLO can detect
scary_objects = [
    "person"  # Will be combined with other indicators for violence detection
]

# OPTIMIZATION: Process max 30 frames (was 50) for faster scanning
frame_files = sorted([f for f in os.listdir("tmp") if f.endswith(".jpg")])[:30]

def detect_blood_gore(img_path):
    """Detect blood and gore indicators using color analysis"""
    try:
        img = cv2.imread(img_path)
        if img is None:
            return False
        
        # Convert to HSV for better color detection
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        
        # Define red color range for blood detection (dark red to bright red)
        # Blood red: hue 0-10 and 170-180, high saturation, medium to low value
        lower_red1 = np.array([0, 50, 50])
        upper_red1 = np.array([10, 255, 255])
        lower_red2 = np.array([170, 50, 50])
        upper_red2 = np.array([180, 255, 255])
        
        # Create mask for red colors
        mask1 = cv2.inRange(hsv, lower_red1, upper_red1)
        mask2 = cv2.inRange(hsv, lower_red2, upper_red2)
        red_mask = mask1 + mask2
        
        # Count red pixels (potential blood)
        red_pixel_count = cv2.countNonZero(red_mask)
        total_pixels = img.shape[0] * img.shape[1]
        red_percentage = (red_pixel_count / total_pixels) * 100
        
        # If more than 2% of image is red (blood-like), flag it
        if red_percentage > 2.0:
            return True, red_percentage
        
        return False, 0
    except Exception as e:
        return False, 0

def detect_dark_scary_content(img_path):
    """Detect dark/scary content that might indicate horror or violence"""
    try:
        img = cv2.imread(img_path)
        if img is None:
            return False
        
        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Calculate average brightness
        avg_brightness = np.mean(gray)
        
        # Calculate contrast (standard deviation)
        contrast = np.std(gray)
        
        # Very dark images (avg brightness < 30) with high contrast might indicate scary content
        # High contrast in dark images often indicates dramatic/scary scenes
        if avg_brightness < 30 and contrast > 50:
            return True
        
        # Very low brightness overall (< 20) is suspicious
        if avg_brightness < 20:
            return True
        
        return False
    except Exception as e:
        return False

for file in frame_files:
    img_path = f"tmp/{file}"
    
    # 1. YOLO object detection for weapons
    results = model(img_path, verbose=False)
    
    for r in results:
        for cls in r.boxes.cls:
            name = model.names[int(cls)].lower()
            # Check if detected object is in dangerous list
            if any(danger in name for danger in dangerous_objects):
                flags.append(f"weapon detected: {name}")
    
    # 2. Blood/gore detection using color analysis
    has_blood, blood_percentage = detect_blood_gore(img_path)
    if has_blood:
        flags.append(f"blood/gore detected ({blood_percentage:.1f}% red content)")
    
    # 3. Dark/scary content detection
    if detect_dark_scary_content(img_path):
        flags.append("dark/scary content detected")
    
    # Early exit: if we found something dangerous, stop processing
    if flags:
        break

# Only print JSON to stdout, everything else goes to stderr
print(json.dumps(flags), file=sys.stdout)
sys.stdout.flush()
