#!/bin/bash

# CogniScan Master Launch Script

echo "🚀 Starting CogniScan Fullstack Services..."

# 1. Start ML Service (FastAPI)
echo "🧠 Starting ML Service (FastAPI) on port 8000..."
python3 ml_service.py > ml_service.log 2>&1 &
ML_PID=$!

# 2. Start Backend Server (Node.js)
echo "🌐 Starting Backend Server (Node.js) on port 3000..."
node server.js > server.log 2>&1 &
NODE_PID=$!

# 3. Start Streamlit Dashboard
echo "📊 Starting Caregiver Dashboard (Streamlit) on port 8501..."
streamlit run streamlit_app.py --server.port 8501 > streamlit.log 2>&1 &
STREAMLIT_PID=$!

echo "✅ All services are launching!"
echo "--------------------------------------------------"
echo "Main App: http://localhost:3000"
echo "Caregiver Dashboard: http://localhost:8501"
echo "ML Service (API): http://localhost:8000"
echo "--------------------------------------------------"
echo "To stop all services, run: kill $ML_PID $NODE_PID $STREAMLIT_PID"

# Keep script running to allow easy termination
wait
