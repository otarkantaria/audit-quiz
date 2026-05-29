"""Authentication and user progress persistence with SQLite."""

import os
import sqlite3
import hashlib
import secrets
import time
from pathlib import Path
from datetime import datetime, timedelta, timezone

import jwt

DATA_DIR = Path(os.environ.get("DATA_DIR", str(Path(__file__).parent / "data")))
DB_PATH = DATA_DIR / "users.db"
JWT_SECRET = None
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 90


def _get_secret():
    global JWT_SECRET
    if JWT_SECRET:
        return JWT_SECRET
    secret_path = DATA_DIR / ".jwt_secret"
    secret_path.parent.mkdir(parents=True, exist_ok=True)
    if secret_path.exists():
        JWT_SECRET = secret_path.read_text().strip()
    else:
        JWT_SECRET = secrets.token_hex(32)
        secret_path.write_text(JWT_SECRET)
    return JWT_SECRET


def get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS correct_answers (
            user_id INTEGER NOT NULL,
            question_id TEXT NOT NULL,
            answered_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (user_id, question_id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            topic_id TEXT,
            total INTEGER NOT NULL,
            correct INTEGER NOT NULL,
            score INTEGER NOT NULL,
            time_spent_seconds INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    """)
    conn.commit()
    conn.close()


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), 100_000
    ).hex()


def register_user(username: str, password: str) -> dict:
    if len(username) < 2 or len(username) > 30:
        return {"ok": False, "error": "მომხმარებლის სახელი 2-30 სიმბოლო უნდა იყოს"}
    if len(password) < 4:
        return {"ok": False, "error": "პაროლი მინიმუმ 4 სიმბოლო უნდა იყოს"}

    salt = secrets.token_hex(16)
    password_hash = _hash_password(password, salt)

    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)",
            (username, password_hash, salt),
        )
        conn.commit()
        user_id = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()["id"]
    except sqlite3.IntegrityError:
        conn.close()
        return {"ok": False, "error": "ეს სახელი უკვე დაკავებულია"}
    conn.close()

    token = _make_token(user_id, username)
    return {"ok": True, "token": token, "username": username}


def login_user(username: str, password: str) -> dict:
    conn = get_db()
    row = conn.execute(
        "SELECT id, password_hash, salt FROM users WHERE username = ?", (username,)
    ).fetchone()
    conn.close()

    if not row:
        return {"ok": False, "error": "მომხმარებელი ვერ მოიძებნა"}

    if _hash_password(password, row["salt"]) != row["password_hash"]:
        return {"ok": False, "error": "არასწორი პაროლი"}

    token = _make_token(row["id"], username)
    return {"ok": True, "token": token, "username": username}


def _make_token(user_id: int, username: str) -> str:
    payload = {
        "sub": str(user_id),
        "name": username,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, _get_secret(), algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])
        return {"user_id": int(payload["sub"]), "username": payload["name"]}
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def save_correct_answers(user_id: int, question_ids: list[str]):
    if not question_ids:
        return
    conn = get_db()
    conn.executemany(
        "INSERT OR IGNORE INTO correct_answers (user_id, question_id) VALUES (?, ?)",
        [(user_id, qid) for qid in question_ids],
    )
    conn.commit()
    conn.close()


def get_correct_answers(user_id: int) -> list[str]:
    conn = get_db()
    rows = conn.execute(
        "SELECT question_id FROM correct_answers WHERE user_id = ?", (user_id,)
    ).fetchall()
    conn.close()
    return [r["question_id"] for r in rows]


def save_session(user_id: int, session: dict):
    conn = get_db()
    conn.execute(
        """INSERT INTO sessions (user_id, timestamp, topic_id, total, correct, score, time_spent_seconds)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            user_id,
            session.get("timestamp", datetime.now(timezone.utc).isoformat()),
            session.get("topic_id"),
            session["total"],
            session["correct"],
            session["score"],
            session.get("time_spent_seconds", 0),
        ),
    )
    conn.commit()
    conn.close()


def get_sessions(user_id: int) -> list[dict]:
    conn = get_db()
    rows = conn.execute(
        "SELECT timestamp, topic_id, total, correct, score, time_spent_seconds FROM sessions WHERE user_id = ? ORDER BY id",
        (user_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
