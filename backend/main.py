"""FastAPI server for the Audit Certification Quiz App."""

import json
from pathlib import Path
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from quiz import QuizEngine

app = FastAPI(title="აუდიტის სერტიფიცირება - ტესტები")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BANK_PATH = "./question_bank.json"
PROGRESS_FILE = "./progress.json"

engine = QuizEngine(bank_path=BANK_PATH)


def load_progress() -> dict:
    if Path(PROGRESS_FILE).exists():
        return json.loads(Path(PROGRESS_FILE).read_text())
    return {"sessions": [], "topic_stats": {}}


def save_progress(data: dict):
    Path(PROGRESS_FILE).write_text(json.dumps(data, ensure_ascii=False, indent=2))


class QuizRequest(BaseModel):
    topic_id: str | None = None
    count: int = 10


class AnswerSubmission(BaseModel):
    topic_id: str
    questions: list[dict]
    answers: dict[str, str]
    time_spent_seconds: int = 0


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


@app.post("/api/submit")
def submit_answers(sub: AnswerSubmission):
    correct = 0
    total = len(sub.questions)
    results = []

    for q in sub.questions:
        user_answer = sub.answers.get(q["id"])
        is_correct = user_answer == q["correct"]
        if is_correct:
            correct += 1
        results.append({
            "question_id": q["id"],
            "user_answer": user_answer,
            "correct_answer": q["correct"],
            "is_correct": is_correct,
            "explanations": q.get("explanations", {}),
        })

    score = round(correct / total * 100) if total > 0 else 0
    session = {
        "timestamp": datetime.now().isoformat(),
        "topic_id": sub.topic_id,
        "total": total,
        "correct": correct,
        "score": score,
        "time_spent_seconds": sub.time_spent_seconds,
    }

    progress = load_progress()
    progress["sessions"].append(session)
    topic = sub.topic_id or "all"
    if topic not in progress["topic_stats"]:
        progress["topic_stats"][topic] = {"attempts": 0, "total_questions": 0, "total_correct": 0}
    progress["topic_stats"][topic]["attempts"] += 1
    progress["topic_stats"][topic]["total_questions"] += total
    progress["topic_stats"][topic]["total_correct"] += correct
    save_progress(progress)

    return {"score": score, "correct": correct, "total": total, "results": results}


@app.get("/api/progress")
def get_progress():
    return load_progress()


@app.post("/api/reload")
def reload_bank():
    engine.load()
    return {"total_questions": engine.total_questions}


# Serve frontend in production (Docker: ./static, Dev: ../frontend/dist)
for _candidate in [Path(__file__).parent / "static", Path(__file__).parent.parent / "frontend" / "dist"]:
    if _candidate.exists():
        app.mount("/", StaticFiles(directory=str(_candidate), html=True), name="frontend")
        break
