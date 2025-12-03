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

# Scary/monster-like objects that YOLO can detect
scary_objects = [
    "bear", "wolf", "dog", "cat", "spider", "snake",  # Potentially scary animals
    "person"  # Will check if person looks scary/distorted
]

# OPTIMIZATION: Process max 30 frames (was 50) for faster scanning
frame_files = sorted([f for f in os.listdir("tmp") if f.endswith(".jpg")])[:30]

# Removed simple color-based heuristics - relying on AI (YOLO) instead

def detect_scary_face(img_path):
    """Use AI/ML to detect if faces look scary, distorted, or monster-like"""
    try:
        img = cv2.imread(img_path)
        if img is None:
            return False
        
        # Use OpenCV's face detector (Haar Cascade) to find faces
        face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.1, 4)
        
        if len(faces) == 0:
            return False
        
        # Analyze each detected face for scary/distorted features
        for (x, y, w, h) in faces:
            face_roi = gray[y:y+h, x:x+w]
            
            # Check for distorted/scary features:
            # 1. Very dark face (monster makeup, shadows)
            face_brightness = np.mean(face_roi)
            if face_brightness < 30:  # Very dark face
                return True
            
            # 2. High contrast (scary makeup, sharp features)
            face_contrast = np.std(face_roi)
            if face_contrast > 50 and face_brightness < 50:  # High contrast + dark
                return True
            
            # 3. Unusual face proportions (distorted/monster-like)
            aspect_ratio = w / h if h > 0 else 1.0
            if aspect_ratio < 0.5 or aspect_ratio > 2.0:  # Very distorted proportions
                return True
        
        return False
    except Exception as e:
        return False

for file in frame_files:
    img_path = f"tmp/{file}"
    
    # AI-based detection using YOLO (no simple color heuristics)
    try:
        # Use higher confidence threshold for more accurate detection
        results = model(img_path, verbose=False, conf=0.6)  # Require 60% confidence
        
        detected_objects = []
        weapon_detected = False
        person_detected = False
        
        for r in results:
            for i, cls in enumerate(r.boxes.cls):
                confidence = float(r.boxes.conf[i])
                name = model.names[int(cls)].lower()
                detected_objects.append((name, confidence))
                
                # Check for weapons with high confidence
                if confidence >= 0.7 and any(danger in name for danger in dangerous_objects):
                    weapon_detected = True
                    flags.append(f"weapon detected: {name} (confidence: {confidence:.2f})")
                
                # Check for person (context for dangerous scenes)
                if name == "person" and confidence >= 0.7:
                    person_detected = True
        
        # Context-aware detection: weapon + person = more dangerous
        if weapon_detected and person_detected:
            # Already flagged weapon, but this adds context
            pass
        
        # Check for scary/monster content
        if person_detected:
            # Check if person looks scary/distorted (monster-like)
            if detect_scary_face(img_path):
                flags.append("scary/distorted face detected (monster-like)")
        
        # Check for scary animals in dark contexts
        for obj_name, confidence in detected_objects:
            if obj_name in ["bear", "wolf", "dog", "snake", "spider"] and confidence >= 0.6:
                # Check if image is dark (scary context)
                try:
                    img = cv2.imread(img_path)
                    if img is not None:
                        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                        avg_brightness = np.mean(gray)
                        # If dark scene + scary animal, flag it
                        if avg_brightness < 40:
                            flags.append(f"scary animal detected in dark context: {obj_name}")
                            break
                except:
                    pass
        
    except Exception as e:
        # If YOLO fails, continue to next frame
        pass
    
    # Early exit: if we found something dangerous, stop processing
    if flags:
        break

# Only print JSON to stdout, everything else goes to stderr
print(json.dumps(flags), file=sys.stdout)
sys.stdout.flush()
