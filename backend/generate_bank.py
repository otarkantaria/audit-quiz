"""
Pre-generate a question bank of 1000 MCQ questions using Claude API.

Distribution:
  - 650 from presentation/lecture files (tier 1)
  - 250 from test chat sessions (tier 2)
  - 100 from everything else (tier 3)

Each question has per-option explanations:
  - correct answer: "რატომ ეს?" (why this)
  - wrong answers: "რატომ არა?" (why not this)
"""

import json
import os
import random
import sys
import time
import hashlib
import chromadb
from openai import OpenAI

TIER_1_KEYWORDS = ["ლექცია", "lecture", "დღე", "ნაწილი", "ssbass", "ასს ", "შესავალი",
                   "საბიუჯეტო კანონმდებლობა - ", "საბიუჯეტო კოდექსი", "ეკონომიკური",
                   "პროგრამული ბიუჯეტირება", "სახელმწიფო ვალის", "289", "სერტიფიცირების"]
TIER_2_KEYWORDS = ["testchat"]

SYSTEM_PROMPT = """შენ ხარ აუდიტის სერტიფიცირების გამოცდის მომზადების ექსპერტი.
შენი ამოცანაა მოცემული მასალის საფუძველზე შექმნა მრავალარჩევანიანი ტესტის კითხვები ქართულ ენაზე.

თითოეული კითხვისთვის:
- შექმენი კითხვა რომელიც ამოწმებს მასალის ღრმა გაგებას და პრაქტიკულ ცოდნას
- მიუთითე 4 პასუხის ვარიანტი (ა, ბ, გ, დ)
- მიუთითე სწორი პასუხი
- სწორი პასუხისთვის დაწერე "რატომ ეს?" - რატომ არის ეს პასუხი სწორი
- თითოეული არასწორი პასუხისთვის დაწერე "რატომ არა?" - რატომ არის ეს ვარიანტი არასწორი

კითხვები უნდა იყოს მრავალფეროვანი: ფაქტობრივი, კონცეპტუალური, და სცენარზე დაფუძნებული.
არ გაიმეორო კითხვები. ყოველი კითხვა უნდა იყოს უნიკალური.

პასუხი მხოლოდ JSON ფორმატში."""

QUESTION_PROMPT = """მოცემული მასალის საფუძველზე შექმენი {count} უნიკალური მრავალარჩევანიანი ტესტის კითხვა.

თემა: {topic}

მასალა:
{context}

{existing_note}

პასუხი მხოლოდ JSON ფორმატში, სხვა ტექსტის გარეშე:
{{
  "questions": [
    {{
      "question": "კითხვის ტექსტი",
      "options": {{
        "ა": "პირველი ვარიანტი",
        "ბ": "მეორე ვარიანტი",
        "გ": "მესამე ვარიანტი",
        "დ": "მეოთხე ვარიანტი"
      }},
      "correct": "ა",
      "explanations": {{
        "ა": "რატომ ეს: ახსნა რატომ არის ეს სწორი პასუხი",
        "ბ": "რატომ არა: ახსნა რატომ არის ეს არასწორი",
        "გ": "რატომ არა: ახსნა რატომ არის ეს არასწორი",
        "დ": "რატომ არა: ახსნა რატომ არის ეს არასწორი"
      }}
    }}
  ]
}}"""


def classify_chunk(source: str) -> int:
    source_lower = source.lower()
    for kw in TIER_2_KEYWORDS:
        if kw in source_lower:
            return 2
    for kw in TIER_1_KEYWORDS:
        if kw in source_lower:
            return 1
    return 3


def load_chunks(db_path: str) -> dict[int, list[dict]]:
    client = chromadb.PersistentClient(path=db_path)
    collection = client.get_collection("audit_docs")
    all_data = collection.get(include=["documents", "metadatas"])

    tiers = {1: [], 2: [], 3: []}
    for doc, meta in zip(all_data["documents"], all_data["metadatas"]):
        tier = classify_chunk(meta["source"])
        tiers[tier].append({"text": doc, "source": meta["source"], "topic": meta["topic_name"]})

    return tiers


def generate_batch(client: OpenAI, model: str, context_chunks: list[dict],
                   count: int, existing_questions: list[str]) -> list[dict]:
    context = "\n\n---\n\n".join(
        f"[წყარო: {c['source']}]\n{c['text']}" for c in context_chunks
    )

    topics = list(set(c["topic"] for c in context_chunks))
    topic_str = ", ".join(topics)

    existing_note = ""
    if existing_questions:
        sample = random.sample(existing_questions, min(10, len(existing_questions)))
        existing_note = "უკვე შექმნილი კითხვები (არ გაიმეორო!):\n" + "\n".join(f"- {q}" for q in sample)

    prompt = QUESTION_PROMPT.format(
        count=count,
        topic=topic_str,
        context=context,
        existing_note=existing_note,
    )

    kwargs = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "timeout": 300,
    }
    if not model.startswith("gpt-5"):
        kwargs["temperature"] = 0.8

    response = client.chat.completions.create(**kwargs)

    content = response.choices[0].message.content.strip()

    data = json.loads(content)
    questions = data.get("questions", [])

    for q in questions:
        q["id"] = hashlib.md5(q["question"].encode()).hexdigest()[:12]
        q["sources"] = list(set(c["source"] for c in context_chunks))
        q["topic"] = topics[0] if len(topics) == 1 else topic_str

    return questions


def log(msg):
    print(msg, flush=True)


def main():
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        log("Set OPENAI_API_KEY environment variable")
        sys.exit(1)

    model = os.environ.get("OPENAI_MODEL", "gpt-4.1-mini")
    db_path = os.environ.get("CHROMA_DB_PATH", "./chroma_db")
    output_file = os.environ.get("OUTPUT_FILE", "./question_bank.json")

    # Resume from existing file if present
    existing_bank = []
    if os.path.exists(output_file):
        existing_bank = json.loads(open(output_file).read())
        log(f"Resuming from {len(existing_bank)} existing questions")

    client = OpenAI(api_key=api_key)
    tiers = load_chunks(db_path)

    log(f"Chunks: Tier 1 (presentations): {len(tiers[1])}, Tier 2 (testchats): {len(tiers[2])}, Tier 3 (other): {len(tiers[3])}")

    target_total = 1000
    remaining = target_total - len(existing_bank)
    if remaining <= 0:
        log(f"Already have {len(existing_bank)} questions. Done.")
        return

    # Calculate remaining per tier
    tier_targets = {
        1: max(0, 650 - sum(1 for q in existing_bank if q.get("tier") == 1)),
        2: max(0, 250 - sum(1 for q in existing_bank if q.get("tier") == 2)),
        3: max(0, 100 - sum(1 for q in existing_bank if q.get("tier") == 3)),
    }

    log(f"Targets: Tier 1: {tier_targets[1]}, Tier 2: {tier_targets[2]}, Tier 3: {tier_targets[3]}")

    existing_q_texts = [q["question"] for q in existing_bank]
    batch_size = 5
    all_questions = list(existing_bank)

    for tier_num, target in tier_targets.items():
        if target <= 0:
            continue
        chunks = tiers[tier_num]
        if not chunks:
            log(f"  No chunks for tier {tier_num}, skipping")
            continue

        generated = 0
        batch_num = 0
        retries = 0
        max_retries = 5
        while generated < target:
            count = min(batch_size, target - generated)
            context = random.sample(chunks, min(4, len(chunks)))

            try:
                questions = generate_batch(client, model, context, count, existing_q_texts)
                for q in questions:
                    q["tier"] = tier_num
                all_questions.extend(questions)
                existing_q_texts.extend(q["question"] for q in questions)
                generated += len(questions)
                batch_num += 1
                retries = 0

                with open(output_file, "w") as f:
                    json.dump(all_questions, f, ensure_ascii=False, indent=2)

                log(f"  Tier {tier_num}: batch {batch_num} → +{len(questions)} questions (total: {generated}/{target})")

                time.sleep(1)

            except Exception as e:
                retries += 1
                wait = min(30, 5 * retries)
                log(f"  Error in tier {tier_num} batch {batch_num} (retry {retries}/{max_retries}): {e}")
                if retries >= max_retries:
                    log(f"  Too many retries, moving on")
                    break
                time.sleep(wait)

    log(f"\nDone! Total questions: {len(all_questions)}")
    log(f"Saved to: {output_file}")


if __name__ == "__main__":
    main()
