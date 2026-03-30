import os
import cv2
import numpy as np
import joblib
import mediapipe as mp
import base64
import torch
import librosa
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from transformers import Wav2Vec2ForSequenceClassification, Wav2Vec2FeatureExtractor
from safetensors.torch import load_file
import io

app = FastAPI()

# --- CONSTANTS ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CV_MODEL_DIR = os.path.join(BASE_DIR, "cv_model")
AUDIO_MODEL_DIR = os.path.join(BASE_DIR, "audio_model")
LANDMARKER_PATH = os.path.join(BASE_DIR, "face_landmarker.task")

# --- LOAD MODELS ---

# Load CV Model (MLP)
mlp = joblib.load(os.path.join(CV_MODEL_DIR, "model.pkl"))
scaler = joblib.load(os.path.join(CV_MODEL_DIR, "scaler.pkl"))
le = joblib.load(os.path.join(CV_MODEL_DIR, "label_encoder.pkl"))

# Load Audio Model (Wav2Vec2)
feature_extractor = Wav2Vec2FeatureExtractor.from_pretrained(AUDIO_MODEL_DIR)
audio_model = Wav2Vec2ForSequenceClassification.from_pretrained(AUDIO_MODEL_DIR)
audio_model.eval()

# MediaPipe Setup
BaseOptions = mp.tasks.BaseOptions
FaceLandmarker = mp.tasks.vision.FaceLandmarker
FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions
VisionRunningMode = mp.tasks.vision.RunningMode

options = FaceLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=LANDMARKER_PATH),
    running_mode=VisionRunningMode.IMAGE
)
face_landmarker = FaceLandmarker.create_from_options(options)

# --- SCHEMAS ---
class ImageRequest(BaseModel):
    image_base64: str

class AudioRequest(BaseModel):
    audio_base64: str
    sample_rate: int = 16000

# --- HELPERS ---
def decode_base64_image(b64_str):
    header, encoded = b64_str.split(",", 1) if "," in b64_str else ("", b64_str)
    decoded = base64.b64decode(encoded)
    np_arr = np.frombuffer(decoded, np.uint8)
    return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

def build_features(landmarks, target_dim):
    pts = np.array(landmarks).reshape(-1, 3)[:, :2]
    pts = pts - pts.mean(axis=0)
    feats = pts.flatten()
    if len(feats) < target_dim:
        feats = np.pad(feats, (0, target_dim - len(feats)))
    else:
        feats = feats[:target_dim]
    return feats.reshape(1, -1)

# --- ENDPOINTS ---

@app.post("/analyse-face")
async def analyse_face(req: ImageRequest):
    img = decode_base64_image(req.image_base64)
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    results = face_landmarker.detect(mp_image)

    if not results.face_landmarks:
        return {"emotion": "neutral", "confidence": 0, "notes": "No face detected in image."}

    lm = []
    for p in results.face_landmarks[0]:
        lm.extend([p.x, p.y, p.z])

    features = build_features(lm, scaler.n_features_in_)
    features = scaler.transform(features)
    
    pred = mlp.predict(features)
    prob = mlp.predict_proba(features)
    
    emotion = le.inverse_transform(pred)[0]
    confidence = float(np.max(prob))
    
    return {
        "emotion": emotion,
        "confidence": round(confidence * 100, 2),
        "expressiveness": round(confidence * 100, 2), # Using confidence as a proxy for expressiveness
        "notes": f"Expression looks {emotion} with {int(confidence*100)}% confidence."
    }

@app.post("/analyse-audio-emotion")
async def analyse_audio_emotion(req: AudioRequest):
    # Decode audio
    decoded = base64.b64decode(req.audio_base64)
    
    # Load audio using librosa
    with io.BytesIO(decoded) as audio_file:
        y, sr = librosa.load(audio_file, sr=16000)
    
    # Preprocess
    inputs = feature_extractor(y, sampling_rate=16000, return_tensors="pt")
    
    # Inference
    with torch.no_grad():
        logits = audio_model(**inputs).logits
    
    scores = torch.nn.functional.softmax(logits, dim=-1)
    pred_idx = torch.argmax(scores, dim=-1).item()
    confidence = scores[0][pred_idx].item()
    
    label = audio_model.config.id2label[str(pred_idx)]
    
    # Map label to readable format
    label_map = {"neu": "neutral", "hap": "happy", "ang": "angry", "sad": "sad"}
    emotion = label_map.get(label, label)
    
    return {
        "emotion": emotion,
        "confidence": round(confidence * 100, 2),
        "notes": f"Voice sounds {emotion}."
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
