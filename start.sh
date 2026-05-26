#!/bin/bash
# Start the Audit Quiz App

cd "$(dirname "$0")"

# Check for .env
if [ ! -f backend/.env ]; then
  echo "Creating .env from .env.example..."
  cp backend/.env.example backend/.env
  echo "⚠️  Please edit backend/.env and add your ANTHROPIC_API_KEY"
  exit 1
fi

# Source env vars
export $(grep -v '^#' backend/.env | xargs)

# Start backend
echo "Starting backend on :8000..."
cd backend
python -m uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

# Start frontend
echo "Starting frontend on :5173..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ App running at http://localhost:5173"
echo "   Backend API at http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
