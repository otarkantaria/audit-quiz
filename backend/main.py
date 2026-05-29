"""FastAPI server for the Audit Certification Quiz App."""

import json
from pathlib import Path
from datetime import datetime

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from quiz import QuizEngine
import auth

app = FastAPI(title="აუდიტის სერტიფიცირება - ტესტები")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BANK_PATH = "./question_bank.json"
engine = QuizEngine(bank_path=BANK_PATH)

auth.init_db()


def _get_user(authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "ავტორიზაცია საჭიროა")
    user = auth.verify_token(authorization[7:])
    if not user:
        raise HTTPException(401, "არასწორი ან ვადაგასული ტოკენი")
    return user


# ---- Auth endpoints ----

class AuthRequest(BaseModel):
    username: str
    password: str


@app.post("/api/register")
def register(req: AuthRequest):
    result = auth.register_user(req.username, req.password)
    if not result["ok"]:
        raise HTTPException(400, result["error"])
    return result


@app.post("/api/login")
def login(req: AuthRequest):
    result = auth.login_user(req.username, req.password)
    if not result["ok"]:
        raise HTTPException(401, result["error"])
    return result


@app.get("/api/me")
def me(authorization: str | None = Header(None)):
    user = _get_user(authorization)
    return {"username": user["username"]}


# ---- Quiz endpoints ----

class QuizRequest(BaseModel):
    topic_id: str | None = None
    count: int = 10


@app.get("/api/status")
def status():
    return {"ready": engine.total_questions > 0, "total_questions": engine.total_questions}


@app.get("/api/topics")
def get_topics():
    return engine.get_topics()


@app.post("/api/quiz")
def generate_quiz(req: QuizRequest):
    questions = engine.generate_quiz(topic_id=req.topic_id, count=req.count)
    return {"questions": questions}


# ---- Progress endpoints (auth required) ----

class SyncProgressRequest(BaseModel):
    correct_ids: list[str] = []
    session: dict | None = None


@app.post("/api/progress/sync")
def sync_progress(req: SyncProgressRequest, authorization: str | None = Header(None)):
    user = _get_user(authorization)
    uid = user["user_id"]

    if req.correct_ids:
        auth.save_correct_answers(uid, req.correct_ids)

    if req.session:
        auth.save_session(uid, req.session)

    return {"ok": True}


@app.get("/api/progress")
def get_progress(authorization: str | None = Header(None)):
    user = _get_user(authorization)
    uid = user["user_id"]
    return {
        "correct_ids": auth.get_correct_answers(uid),
        "sessions": auth.get_sessions(uid),
    }


@app.post("/api/reload")
def reload_bank():
    engine.load()
    return {"total_questions": engine.total_questions}


# Serve frontend in production
for _candidate in [Path(__file__).parent / "static", Path(__file__).parent.parent / "frontend" / "dist"]:
    if _candidate.exists():
        app.mount("/", StaticFiles(directory=str(_candidate), html=True), name="frontend")
        break
