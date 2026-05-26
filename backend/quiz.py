"""Quiz engine serving pre-generated questions from question_bank.json."""

import json
import random
from pathlib import Path


class QuizEngine:
    def __init__(self, bank_path: str = "./question_bank.json"):
        self.bank_path = bank_path
        self.questions = []
        self.by_topic = {}
        self.load()

    def load(self):
        path = Path(self.bank_path)
        if not path.exists():
            return
        self.questions = json.loads(path.read_text())
        self.by_topic = {}
        for q in self.questions:
            topic = q.get("topic", "ზოგადი")
            if topic not in self.by_topic:
                self.by_topic[topic] = []
            self.by_topic[topic].append(q)

    def get_topics(self) -> list[dict]:
        topics = []
        for topic, qs in sorted(self.by_topic.items()):
            topics.append({
                "id": topic,
                "name": topic,
                "question_count": len(qs),
            })
        return topics

    def generate_quiz(self, topic_id: str | None = None, count: int = 10) -> list[dict]:
        if topic_id and topic_id != "all" and topic_id in self.by_topic:
            pool = self.by_topic[topic_id]
        else:
            pool = self.questions

        if not pool:
            return []

        selected = random.sample(pool, min(count, len(pool)))

        quiz_questions = []
        for q in selected:
            quiz_questions.append({
                "id": q["id"],
                "question": q["question"],
                "options": q["options"],
                "correct": q["correct"],
                "explanations": q.get("explanations", {}),
                "topic": q.get("topic", ""),
                "sources": q.get("sources", []),
            })

        return quiz_questions

    @property
    def total_questions(self) -> int:
        return len(self.questions)
