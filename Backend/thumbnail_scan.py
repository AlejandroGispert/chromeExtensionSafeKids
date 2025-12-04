from ultralytics import YOLO
import json
import sys
import os
import cv2
import numpy as np
import signal

# Handle graceful shutdown
def signal_handler(sig, frame):
	print("[]", file=sys.stdout)
	sys.stdout.flush()
	sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

# Try to import specialized content safety models
try:
    from transformers import pipeline, AutoImageProcessor, AutoModelForImageClassification
    import torch
    HAS_TRANSFORMERS = True
except ImportError:
    HAS_TRANSFORMERS = False

try:
    import tensorflow as tf
    import tensorflow_hub as hub
    HAS_TF_HUB = True
except ImportError:
    HAS_TF_HUB = False

# Try to import requests, fallback to urllib if not available
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    try:
        import urllib.request
        HAS_URLLIB = True
    except ImportError:
        HAS_URLLIB = False

# Suppress YOLO verbose output
import warnings
warnings.filterwarnings("ignore")
os.environ["YOLO_VERBOSE"] = "False"

# Initialize YOLO model for object detection
yolo_model = YOLO("yolov8n.pt", verbose=False)

# Initialize specialized content safety models (lazy loading)
content_safety_model = None
content_safety_processor = None
content_safety_model_type = None  # Track which model is loaded

def load_content_safety_model():
    """Load specialized content safety model for violence/horror/gore detection with fallbacks"""
    global content_safety_model, content_safety_processor, content_safety_model_type
    
    if content_safety_model is not None:
        return True
    
    if not HAS_TRANSFORMERS:
        print("⚠️ Transformers library not available, skipping specialized models", file=sys.stderr)
        return False
    
    # Try multiple models in order of preference
    model_options = [
        {
            "name": "Falconsai/nsfw_image_detection",
            "type": "nsfw",
            "description": "NSFW and content safety detection",
            "use_classification": True
        },
        {
            "name": "openai/clip-vit-base-patch32",
            "type": "clip",
            "description": "CLIP for semantic image understanding",
            "use_classification": False
        }
    ]
    
    for model_option in model_options:
        try:
            model_name = model_option["name"]
            print(f"🔄 Attempting to load {model_name}...", file=sys.stderr)
            
            if model_option["use_classification"]:
                # Standard image classification model
                processor = AutoImageProcessor.from_pretrained(model_name)
                model = AutoModelForImageClassification.from_pretrained(model_name)
            else:
                # CLIP model - use different approach
                try:
                    from transformers import CLIPProcessor, CLIPModel
                    processor = CLIPProcessor.from_pretrained(model_name)
                    model = CLIPModel.from_pretrained(model_name)
                except ImportError:
                    print(f"⚠️ CLIP models require CLIPProcessor, skipping {model_name}", file=sys.stderr)
                    continue
            
            content_safety_processor = processor
            content_safety_model = model
            content_safety_model_type = model_option["type"]
            
            print(f"✅ Loaded specialized content safety model: {model_name} ({model_option['description']})", file=sys.stderr)
            return True
            
        except Exception as e:
            print(f"⚠️ Could not load {model_name}: {str(e)[:200]}", file=sys.stderr)
            continue
    
    print("⚠️ All specialized content safety models failed to load, using YOLO only", file=sys.stderr)
    return False

flags = []

# Dangerous objects to detect (expanded list for AI detection)
dangerous_objects = [
    "knife", "gun", "pistol", "rifle", "weapon", "firearm",
    "sword", "machete", "axe", "scissors", "blade", "handgun"
]

# Scary/monster-like objects that YOLO can detect
scary_objects = [
    "bear", "wolf", "dog", "cat", "spider", "snake",  # Potentially scary animals
    "person"  # Will check if person looks scary/distorted
]

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
        
        scary_score = 0
        
        # Analyze each detected face for scary/distorted features
        for (x, y, w, h) in faces:
            face_roi = gray[y:y+h, x:x+w]
            
            # 1. Very dark face (monster makeup, shadows)
            face_brightness = np.mean(face_roi)
            if face_brightness < 30:  # Very dark face
                scary_score += 2
            
            # 2. High contrast (scary makeup, sharp features)
            face_contrast = np.std(face_roi)
            if face_contrast > 50 and face_brightness < 50:  # High contrast + dark
                scary_score += 2
            
            # 3. Unusual face proportions (distorted/monster-like)
            aspect_ratio = w / h if h > 0 else 1.0
            if aspect_ratio < 0.5 or aspect_ratio > 2.0:  # Very distorted proportions
                scary_score += 3
            
            # 4. Check for unusual texture patterns (deformed features)
            # Calculate local variance (texture complexity)
            if face_roi.size > 0:
                # Use Laplacian to detect edges/texture
                laplacian = cv2.Laplacian(face_roi, cv2.CV_64F)
                texture_variance = np.var(laplacian)
                # High texture variance can indicate deformed/distorted features
                if texture_variance > 500:  # Unusually high texture complexity
                    scary_score += 1
            
            # 5. Check for asymmetry (monster-like deformation)
            # Split face in half and compare
            if w > 20 and h > 20:
                left_half = face_roi[:, :w//2]
                right_half = face_roi[:, w//2:]
                if left_half.size > 0 and right_half.size > 0:
                    left_mean = np.mean(left_half)
                    right_mean = np.mean(right_half)
                    asymmetry = abs(left_mean - right_mean)
                    if asymmetry > 30:  # Significant asymmetry
                        scary_score += 2
        
        # Flag if scary score is high enough (multiple indicators)
        return scary_score >= 3
        
    except Exception as e:
        return False

def detect_deformed_monster(img_path):
    """Detect deformed/monster-like humanoid shapes using YOLO + image analysis"""
    try:
        img = cv2.imread(img_path)
        if img is None:
            return False
        
        # Use YOLO to detect person
        results = yolo_model(img_path, verbose=False, conf=0.5)
        
        person_detected = False
        person_boxes = []
        
        for r in results:
            for i, cls in enumerate(r.boxes.cls):
                name = yolo_model.names[int(cls)].lower()
                if name == "person":
                    confidence = float(r.boxes.conf[i])
                    if confidence >= 0.6:
                        person_detected = True
                        # Get bounding box
                        box = r.boxes.xyxy[i].cpu().numpy()
                        person_boxes.append((box, confidence))
        
        if not person_detected:
            return False
        
        # Analyze detected person(s) for monster-like features
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        monster_score = 0
        
        for box, confidence in person_boxes:
            x1, y1, x2, y2 = map(int, box)
            # Ensure coordinates are within image bounds
            x1 = max(0, x1)
            y1 = max(0, y1)
            x2 = min(img.shape[1], x2)
            y2 = min(img.shape[0], y2)
            
            if x2 <= x1 or y2 <= y1:
                continue
            
            person_roi = gray[y1:y2, x1:x2]
            
            if person_roi.size == 0:
                continue
            
            # 1. Check for very dark person (monster-like)
            person_brightness = np.mean(person_roi)
            if person_brightness < 25:
                monster_score += 2
            
            # 2. Check for unusual proportions (deformed)
            person_width = x2 - x1
            person_height = y2 - y1
            if person_height > 0:
                aspect_ratio = person_width / person_height
                # Normal human proportions are roughly 0.3-0.6 (width/height)
                # Very wide or very tall = deformed
                if aspect_ratio < 0.2 or aspect_ratio > 0.8:
                    monster_score += 2
            
            # 3. Check for high contrast edges (distorted features)
            edges = cv2.Canny(person_roi, 50, 150)
            edge_density = np.sum(edges > 0) / person_roi.size
            if edge_density > 0.3:  # Very high edge density = distorted
                monster_score += 1
            
            # 4. Check for unusual texture (deformed skin/features)
            laplacian = cv2.Laplacian(person_roi, cv2.CV_64F)
            texture_variance = np.var(laplacian)
            if texture_variance > 600:  # Unusually complex texture
                monster_score += 1
        
        # Flag if multiple monster indicators found
        return monster_score >= 3
        
    except Exception as e:
        return False

def detect_scary_animals(img_path, detected_objects):
    """Check if detected animals are in scary/aggressive contexts"""
    scary_animals = ["bear", "wolf", "dog", "snake", "spider"]
    
    for obj_name, confidence in detected_objects:
        if obj_name in scary_animals and confidence >= 0.6:
            # Check if image is dark (scary context)
            try:
                img = cv2.imread(img_path)
                if img is not None:
                    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                    avg_brightness = np.mean(gray)
                    # If dark scene + scary animal, flag it
                    if avg_brightness < 40:
                        return True
            except:
                pass
    
    return False

def detect_blood_gore_advanced(img_path):
    """Advanced blood/gore detection using multiple techniques"""
    try:
        img = cv2.imread(img_path)
        if img is None:
            return False, 0
        
        # Convert to HSV for better color detection
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        
        # More sophisticated red detection for blood
        # Blood typically has specific hue ranges and saturation
        lower_red1 = np.array([0, 120, 70])   # Deep red, high saturation
        upper_red1 = np.array([10, 255, 200])
        lower_red2 = np.array([170, 120, 70])
        upper_red2 = np.array([180, 255, 200])
        
        mask1 = cv2.inRange(hsv, lower_red1, upper_red1)
        mask2 = cv2.inRange(hsv, lower_red2, upper_red2)
        red_mask = mask1 + mask2
        
        # Count red pixels
        red_pixel_count = cv2.countNonZero(red_mask)
        total_pixels = img.shape[0] * img.shape[1]
        red_percentage = (red_pixel_count / total_pixels) * 100
        
        # Check for blood-like patterns (clusters, not just scattered red)
        # Use morphological operations to find blood-like regions
        kernel = np.ones((5, 5), np.uint8)
        red_mask_closed = cv2.morphologyEx(red_mask, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(red_mask_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        # Check for significant blood-like regions
        large_blood_regions = 0
        for contour in contours:
            area = cv2.contourArea(contour)
            if area > (total_pixels * 0.01):  # Region > 1% of image
                large_blood_regions += 1
        
        # Flag if: significant red content (>3%) OR multiple large blood regions
        if red_percentage > 3.0 or large_blood_regions >= 2:
            return True, red_percentage
        
        return False, 0
    except Exception as e:
        return False, 0

def detect_horror_scene(img_path):
    """Detect horror scenes using multiple indicators"""
    try:
        img = cv2.imread(img_path)
        if img is None:
            return False
        
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Multiple horror indicators
        horror_score = 0
        
        # 1. Very dark overall (horror movies are often dark)
        avg_brightness = np.mean(gray)
        if avg_brightness < 25:
            horror_score += 2
        
        # 2. High contrast (dramatic horror lighting)
        contrast = np.std(gray)
        if contrast > 55 and avg_brightness < 40:
            horror_score += 2
        
        # 3. Check for dark regions with bright highlights (horror lighting)
        _, thresh = cv2.threshold(gray, 30, 255, cv2.THRESH_BINARY_INV)
        dark_regions = np.sum(thresh > 0) / gray.size
        if dark_regions > 0.4 and contrast > 50:  # >40% dark with high contrast
            horror_score += 2
        
        # 4. Check for red tint (blood/horror atmosphere)
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        red_mask = cv2.inRange(hsv, np.array([0, 50, 50]), np.array([10, 255, 255])) + \
                   cv2.inRange(hsv, np.array([170, 50, 50]), np.array([180, 255, 255]))
        red_percentage = np.sum(red_mask > 0) / red_mask.size * 100
        if red_percentage > 2.5 and avg_brightness < 50:  # Red tint in dark scene
            horror_score += 1
        
        # Flag if multiple horror indicators
        return horror_score >= 3
    except Exception as e:
        return False

def detect_content_safety_specialized(img_path):
    """Use specialized content safety model to detect violence, gore, horror"""
    if not load_content_safety_model():
        return []
    
    try:
        try:
            from PIL import Image
        except ImportError:
            print("⚠️ PIL not available, skipping specialized model", file=sys.stderr)
            return []
        
        # Load and preprocess image
        image = Image.open(img_path).convert("RGB")
        
        # Run inference
        inputs = content_safety_processor(image, return_tensors="pt")
        
        with torch.no_grad():
            outputs = content_safety_model(**inputs)
            predictions = torch.nn.functional.softmax(outputs.logits, dim=-1)
        
        # Get top predictions (check more for better detection)
        top_predictions = torch.topk(predictions[0], k=5)
        
        safety_flags = []
        
        # Different handling based on model type
        if content_safety_model_type == "nsfw":
            # NSFW model - check for inappropriate content
            dangerous_keywords = [
                "nsfw", "violence", "gore", "blood", "horror", "scary", "weapon",
                "explicit", "inappropriate", "adult", "mature", "disturbing",
                "porn", "sexual", "nude", "naked"
            ]
            
            for idx, score in zip(top_predictions.indices, top_predictions.values):
                label = content_safety_model.config.id2label[idx.item()]
                confidence = score.item()
                
                if any(keyword in label.lower() for keyword in dangerous_keywords):
                    # Lower threshold for NSFW model (20% instead of 30%)
                    if confidence > 0.2:
                        safety_flags.append(f"specialized model detected {label} (confidence: {confidence:.2f})")
        
        elif content_safety_model_type == "clip":
            # CLIP-based model - use text prompts for semantic understanding
            try:
                from transformers import CLIPProcessor, CLIPModel
                
                # Define dangerous text prompts
                dangerous_prompts = [
                    "violence", "gore", "blood", "horror scene", "scary image", "weapon",
                    "inappropriate content", "disturbing imagery", "adult content",
                    "monster", "zombie", "demon", "horror movie", "bloody scene",
                    "violent scene", "horror character", "scary monster"
                ]
                
                # Process image and text prompts
                inputs = content_safety_processor(
                    text=dangerous_prompts,
                    images=image,
                    return_tensors="pt",
                    padding=True
                )
                
                with torch.no_grad():
                    outputs = content_safety_model(**inputs)
                    # Get image-text similarity scores
                    logits_per_image = outputs.logits_per_image
                    probs = logits_per_image.softmax(dim=1)
                
                # Check each dangerous prompt
                for i, prompt in enumerate(dangerous_prompts):
                    score = probs[0][i].item()
                    if score > 0.15:  # 15% threshold for CLIP (lower because it's semantic matching)
                        safety_flags.append(f"CLIP detected '{prompt}' (confidence: {score:.2f})")
                
            except Exception as clip_err:
                # Fallback: try pipeline approach
                try:
                    from transformers import pipeline
                    classifier = pipeline("zero-shot-image-classification", 
                                        model=content_safety_model,
                                        device=-1)
                    
                    candidate_labels = [
                        "violence", "gore", "blood", "horror", "scary", "weapon",
                        "inappropriate content", "disturbing imagery", "adult content",
                        "monster", "zombie", "demon", "horror movie scene"
                    ]
                    
                    result = classifier(image, candidate_labels=candidate_labels)
                    
                    for item in result[:3]:
                        label = item["label"].lower()
                        score = item["score"]
                        dangerous_keywords = [
                            "violence", "gore", "blood", "horror", "scary", "weapon",
                            "inappropriate", "disturbing", "adult", "monster", "zombie", "demon"
                        ]
                        if any(keyword in label for keyword in dangerous_keywords):
                            if score > 0.25:
                                safety_flags.append(f"specialized model detected {item['label']} (confidence: {score:.2f})")
                except Exception as pipeline_err:
                    print(f"⚠️ CLIP detection failed: {clip_err}, pipeline also failed: {pipeline_err}", file=sys.stderr)
        else:
            # Generic model - use standard approach
            dangerous_keywords = [
                "nsfw", "violence", "gore", "blood", "horror", "scary", "weapon",
                "explicit", "inappropriate", "adult", "mature", "disturbing"
            ]
            
            for idx, score in zip(top_predictions.indices, top_predictions.values):
                label = content_safety_model.config.id2label[idx.item()]
                confidence = score.item()
                
                if any(keyword in label.lower() for keyword in dangerous_keywords):
                    if confidence > 0.2:  # 20% threshold for generic models
                        safety_flags.append(f"specialized model detected {label} (confidence: {confidence:.2f})")
        
        return safety_flags
        
    except Exception as e:
        # If specialized model fails, return empty (fallback to YOLO)
        print(f"⚠️ Specialized model detection failed: {e}", file=sys.stderr)
        import traceback
        print(f"⚠️ Traceback: {traceback.format_exc()}", file=sys.stderr)
        return []

# Get thumbnail URL from command line argument
thumbnail_url = sys.argv[1] if len(sys.argv) > 1 else None

if not thumbnail_url:
    print(json.dumps([]))
    sys.exit(0)

# Download thumbnail
thumbnail_path = "tmp/thumbnail.jpg"
try:
    if HAS_REQUESTS:
        response = requests.get(thumbnail_url, timeout=10)
        if response.status_code == 200:
            with open(thumbnail_path, "wb") as f:
                f.write(response.content)
        else:
            print(json.dumps([]))
            sys.exit(0)
    elif HAS_URLLIB:
        urllib.request.urlretrieve(thumbnail_url, thumbnail_path)
    else:
        print(json.dumps([]))
        sys.exit(0)
except Exception as e:
    print(json.dumps([]))
    sys.exit(0)

# AI-based detection using YOLO + Specialized Content Safety Models
try:
    # 1. YOLO Object Detection (weapons, people, objects)
    # Use higher confidence threshold for more accurate detection
    results = yolo_model(thumbnail_path, verbose=False, conf=0.6)  # Require 60% confidence
    
    detected_objects = []
    weapon_detected = False
    person_detected = False
    
    for r in results:
        for i, cls in enumerate(r.boxes.cls):
            confidence = float(r.boxes.conf[i])
            name = yolo_model.names[int(cls)].lower()
            detected_objects.append((name, confidence))
            
            # Check for weapons with high confidence
            if confidence >= 0.7 and any(danger in name for danger in dangerous_objects):
                weapon_detected = True
                flags.append(f"weapon detected in thumbnail: {name} (confidence: {confidence:.2f})")
            
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
        if detect_scary_face(thumbnail_path):
            flags.append("scary/distorted face detected in thumbnail (monster-like)")
        
        # Check for deformed/monster-like humanoid shapes
        if detect_deformed_monster(thumbnail_path):
            flags.append("deformed/monster-like humanoid detected in thumbnail")
    
    # Check for scary animals in dark contexts
    if detect_scary_animals(thumbnail_path, detected_objects):
        flags.append("scary animal detected in dark/creepy context")
    
    # 2. Specialized Content Safety Model (violence, gore, horror, NSFW)
    specialized_flags = detect_content_safety_specialized(thumbnail_path)
    flags.extend(specialized_flags)
    
    # 3. Fallback: Advanced blood/gore detection (if specialized model didn't catch it)
    if len(specialized_flags) == 0:  # Only use fallback if specialized model found nothing
        has_blood, blood_pct = detect_blood_gore_advanced(thumbnail_path)
        if has_blood:
            flags.append(f"blood/gore detected in thumbnail ({blood_pct:.1f}% red content)")
    
    # 4. Fallback: Horror scene detection
    if detect_horror_scene(thumbnail_path):
        flags.append("horror scene detected in thumbnail (dark, high contrast, red tint)")
    
except Exception as e:
    print(f"⚠️ Detection error: {e}", file=sys.stderr)
    pass

# Removed simple color-based blood/gore and dark content detection
# These were causing false positives. Relying on YOLO's AI understanding instead.

# Cleanup
try:
    if os.path.exists(thumbnail_path):
        os.remove(thumbnail_path)
except:
    pass

try:
	print(json.dumps(flags))
	sys.stdout.flush()
except (KeyboardInterrupt, BrokenPipeError):
	# Graceful shutdown - output empty result
	print("[]", file=sys.stdout)
	sys.stdout.flush()
	sys.exit(0)

