import streamlit as st
import cv2
import numpy as np
import base64
import requests
import json
import os
import pandas as pd
import torch
import librosa
import io
import mediapipe as mp
from transformers import Wav2Vec2ForSequenceClassification, Wav2Vec2FeatureExtractor
import joblib

# ─────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────
st.set_page_config(page_title="CogniScan Caregiver Dashboard", layout="wide")
st.title("🧠 CogniScan Caregiver Dashboard")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SESSIONS_FILE = os.path.join(BASE_DIR, "sessions.json")
CONTACTS_FILE = os.path.join(BASE_DIR, "contacts.json")
EMERGENCY_FILE = os.path.join(BASE_DIR, "emergency_events.json")

CV_MODEL_DIR = os.path.join(BASE_DIR, "cv_model")
AUDIO_MODEL_DIR = os.path.join(BASE_DIR, "audio_model")
LANDMARKER_PATH = os.path.join(BASE_DIR, "face_landmarker.task")

ML_SERVICE_URL = "http://localhost:8000"

# ─────────────────────────────────────────
# LOAD MODELS (CACHED FOR STREAMLIT)
# ─────────────────────────────────────────
@st.cache_resource
def load_cv_models():
    mlp = joblib.load(os.path.join(CV_MODEL_DIR, "model.pkl"))
    scaler = joblib.load(os.path.join(CV_MODEL_DIR, "scaler.pkl"))
    le = joblib.load(os.path.join(CV_MODEL_DIR, "label_encoder.pkl"))
    return mlp, scaler, le

@st.cache_resource
def load_audio_models():
    feature_extractor = Wav2Vec2FeatureExtractor.from_pretrained(AUDIO_MODEL_DIR)
    audio_model = Wav2Vec2ForSequenceClassification.from_pretrained(AUDIO_MODEL_DIR)
    audio_model.eval()
    return feature_extractor, audio_model

@st.cache_resource
def load_face_landmarker():
    BaseOptions = mp.tasks.BaseOptions
    FaceLandmarker = mp.tasks.vision.FaceLandmarker
    FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions
    VisionRunningMode = mp.tasks.vision.RunningMode

    options = FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=LANDMARKER_PATH),
        running_mode=VisionRunningMode.IMAGE
    )
    return FaceLandmarker.create_from_options(options)

# ─────────────────────────────────────────
# ML HELPERS (INTERNAL FALLBACK)
# ─────────────────────────────────────────
def internal_analyse_face(img_bytes):
    mlp, scaler, le = load_cv_models()
    face_landmarker = load_face_landmarker()
    
    np_arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    results = face_landmarker.detect(mp_image)

    if not results.face_landmarks:
        return {"emotion": "neutral", "confidence": 0, "notes": "No face detected in image."}

    lm = []
    for p in results.face_landmarks[0]:
        lm.extend([p.x, p.y, p.z])

    pts = np.array(lm).reshape(-1, 3)[:, :2]
    pts = pts - pts.mean(axis=0)
    feats = pts.flatten()
    target_dim = scaler.n_features_in_
    if len(feats) < target_dim:
        feats = np.pad(feats, (0, target_dim - len(feats)))
    else:
        feats = feats[:target_dim]
    
    features = feats.reshape(1, -1)
    features = scaler.transform(features)
    
    pred = mlp.predict(features)
    prob = mlp.predict_proba(features)
    emotion = le.inverse_transform(pred)[0]
    confidence = float(np.max(prob))
    
    return {
        "emotion": emotion,
        "confidence": round(confidence * 100, 2),
        "notes": f"Internal Analysis: {emotion} ({int(confidence*100)}%)"
    }

def internal_analyse_audio(audio_bytes):
    feature_extractor, audio_model = load_audio_models()
    
    with io.BytesIO(audio_bytes) as audio_file:
        y, sr = librosa.load(audio_file, sr=16000)
    
    inputs = feature_extractor(y, sampling_rate=16000, return_tensors="pt")
    with torch.no_grad():
        logits = audio_model(**inputs).logits
    
    scores = torch.nn.functional.softmax(logits, dim=-1)
    pred_idx = torch.argmax(scores, dim=-1).item()
    confidence = scores[0][pred_idx].item()
    label = audio_model.config.id2label[str(pred_idx)]
    
    label_map = {"neu": "neutral", "hap": "happy", "ang": "angry", "sad": "sad"}
    emotion = label_map.get(label, label)
    
    return {
        "emotion": emotion,
        "confidence": round(confidence * 100, 2),
        "notes": f"Internal Analysis: Voice sounds {emotion}."
    }

# ─────────────────────────────────────────
# DATA HELPERS
# ─────────────────────────────────────────
def load_json(path):
    if os.path.exists(path):
        with open(path, "r") as f:
            return json.load(f)
    return []

# ─────────────────────────────────────────
# SIDEBAR - QUICK STATS
# ─────────────────────────────────────────
st.sidebar.header("Navigation")
page = st.sidebar.radio("Go to", ["Analytics", "Emergency Alerts", "Live ML Test"])

# ─────────────────────────────────────────
# ANALYTICS PAGE
# ─────────────────────────────────────────
if page == "Analytics":
    st.subheader("Patient Session History")
    sessions = load_json(SESSIONS_FILE)
    
    if sessions:
        df = pd.DataFrame(sessions)
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df = df.sort_values('timestamp', ascending=False)
        
        col1, col2, col3, col4 = st.columns(4)
        latest = df.iloc[0]
        col1.metric("Latest Score", f"{latest['overall']}%")
        col2.metric("Voice Clarity", f"{latest['voiceScore']}%")
        col3.metric("Memory Recall", f"{latest['memScore']}%")
        col4.metric("Facial Expressiveness", f"{latest['faceScore']}%")
        
        st.line_chart(df.set_index('timestamp')[['overall', 'voiceScore', 'memScore', 'faceScore']])
        
        st.write("Recent Sessions")
        st.dataframe(df)
    else:
        st.info("No session data available yet. Please complete a test in the main app.")

# ─────────────────────────────────────────
# EMERGENCY ALERTS PAGE
# ─────────────────────────────────────────
elif page == "Emergency Alerts":
    st.subheader("🚨 Emergency Events")
    alerts = load_json(EMERGENCY_FILE)
    
    if alerts:
        df_alerts = pd.DataFrame(alerts)
        st.table(df_alerts)
    else:
        st.success("No emergency alerts recorded.")

# ─────────────────────────────────────────
# LIVE ML TEST PAGE
# ─────────────────────────────────────────
elif page == "Live ML Test":
    st.subheader("Live Model Testing")
    tab1, tab2 = st.tabs(["Facial Scan", "Audio Analysis"])
    
    with tab1:
        st.write("Test facial emotion detection")
        uploaded_image = st.file_uploader("Upload Face Image", type=["jpg","png","jpeg"], key="face")
        
        if uploaded_image:
            img_bytes = uploaded_image.read()
            st.image(img_bytes, width=400)
            
            # Try external service first, then internal fallback
            try:
                b64_img = base64.b64encode(img_bytes).decode('utf-8')
                res = requests.post(f"{ML_SERVICE_URL}/analyse-face", json={"image_base64": b64_img}, timeout=2)
                data = res.json()
                st.success(f"Emotion (API): {data['emotion']}")
            except:
                with st.spinner("API unavailable, running internal model..."):
                    data = internal_analyse_face(img_bytes)
                    st.success(f"Emotion (Internal): {data['emotion']}")
            
            st.write(f"Confidence: {data['confidence']}%")
            st.info(data['notes'])
                
    with tab2:
        st.write("Test voice emotion detection")
        uploaded_audio = st.file_uploader("Upload Audio", type=["wav","webm","mp3"], key="audio")
        
        if uploaded_audio:
            audio_bytes = uploaded_audio.read()
            st.audio(audio_bytes)
            
            # Try external service first, then internal fallback
            try:
                b64_audio = base64.b64encode(audio_bytes).decode('utf-8')
                res = requests.post(f"{ML_SERVICE_URL}/analyse-audio-emotion", json={"audio_base64": b64_audio}, timeout=2)
                data = res.json()
                st.success(f"Emotion (API): {data['emotion']}")
            except:
                with st.spinner("API unavailable, running internal model..."):
                    data = internal_analyse_audio(audio_bytes)
                    st.success(f"Emotion (Internal): {data['emotion']}")
            
            st.write(f"Confidence: {data['confidence']}%")
            st.info(data['notes'])

st.divider()
st.caption("Powered by CogniScan Fullstack Engine · Local AI Integration")