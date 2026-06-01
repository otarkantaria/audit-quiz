#!/usr/bin/env python3
"""One-off diagnostic sweep over the question bank to flag malformed questions.

Read-only: prints a categorized report, modifies nothing.
"""
import json
import sys
from collections import defaultdict

PATH = "backend/question_bank.json"

with open(PATH, encoding="utf-8") as fh:
    data = json.load(fh)

# Normalize: the bank is a JSON array of question objects.
questions = data if isinstance(data, list) else data.get("questions", data)

PLACEHOLDER_OPTION_TEXT = {"არასწორი პასუხი", "არასწორი პასუხი.", "სწორი პასუხი", "სწორი პასუხი."}
BOGUS_BOTH = {"ორივე სწორია", "ორივე არასწორია", "ორივე სწორია.", "ორივე არასწორია."}
CORRECT_PREFIXES = ("სწორია",)  # explanation text marking the correct option


def norm(s):
    return " ".join((s or "").strip().split())


findings = defaultdict(list)  # category -> list of (id, detail)

for q in questions:
    qid = q.get("id", "<no-id>")
    opts = q.get("options", {}) or {}
    expl = q.get("explanations", {}) or {}
    correct = q.get("correct")

    # --- referential integrity ---
    if correct is None:
        findings["missing_correct_field"].append((qid, "no 'correct' field"))
    elif correct not in opts:
        findings["correct_not_in_options"].append((qid, f"correct={correct!r} not among options {list(opts)}"))

    # --- placeholder / bogus option TEXT ---
    for k, v in opts.items():
        nv = norm(v)
        if nv in PLACEHOLDER_OPTION_TEXT:
            findings["placeholder_option_text"].append((qid, f"option {k} = {v!r}"))
        if nv in BOGUS_BOTH:
            findings["bogus_both_option"].append((qid, f"option {k} = {v!r}"))

    # --- duplicate / near-duplicate option text ---
    seen = {}
    for k, v in opts.items():
        nv = norm(v)
        if nv and nv in seen:
            findings["duplicate_option_text"].append((qid, f"options {seen[nv]} and {k} identical: {v!r}"))
        seen[nv] = k

    # --- explanation/answer-key consistency ---
    if expl:
        marked_correct = [k for k, v in expl.items() if norm(v).startswith(CORRECT_PREFIXES)]
        if correct in opts:
            ce = norm(expl.get(correct, ""))
            if ce and not ce.startswith(CORRECT_PREFIXES):
                findings["correct_explanation_not_marked"].append(
                    (qid, f"correct={correct} but its explanation does not start with 'სწორია': {expl.get(correct)!r}")
                )
        if len(marked_correct) > 1:
            findings["multiple_explanations_marked_correct"].append((qid, f"explanations marked correct: {marked_correct}"))
        if len(marked_correct) == 1 and correct and marked_correct[0] != correct:
            findings["answer_key_mismatch"].append(
                (qid, f"correct={correct} but explanation marks {marked_correct[0]} as correct")
            )
        # explanation keys not matching option keys
        extra = set(expl) - set(opts)
        missing = set(opts) - set(expl)
        if extra:
            findings["explanation_keys_extra"].append((qid, f"explanation keys not in options: {sorted(extra)}"))
        if missing:
            findings["explanation_keys_missing"].append((qid, f"options without explanation: {sorted(missing)}"))

    # --- true/false statements with >2 options ---
    opt_texts = {norm(v) for v in opts.values()}
    tf_tokens = {"სწორია", "მცდარია", "სწორი", "მცდარი"}
    if opt_texts & tf_tokens and len(opts) > 2:
        findings["truefalse_with_extra_options"].append((qid, f"{len(opts)} options incl. T/F tokens: {list(opts.values())}"))

    # --- empty explanations dict but multiple options ---
    if not expl and len(opts) >= 2:
        findings["no_explanations"].append((qid, f"{len(opts)} options, explanations={{}}"))

    # --- very short / empty option text ---
    for k, v in opts.items():
        if not norm(v):
            findings["empty_option_text"].append((qid, f"option {k} is empty"))

print(f"Total questions scanned: {len(questions)}\n")
order = [
    "correct_not_in_options",
    "missing_correct_field",
    "answer_key_mismatch",
    "correct_explanation_not_marked",
    "multiple_explanations_marked_correct",
    "placeholder_option_text",
    "bogus_both_option",
    "truefalse_with_extra_options",
    "duplicate_option_text",
    "empty_option_text",
    "explanation_keys_extra",
    "explanation_keys_missing",
    "no_explanations",
]
total = 0
for cat in order:
    items = findings.get(cat, [])
    if not items:
        continue
    total += len(items)
    print(f"### {cat}  ({len(items)})")
    for qid, detail in items:
        print(f"  - {qid}: {detail}")
    print()

# any categories not in `order`
for cat, items in findings.items():
    if cat not in order and items:
        total += len(items)
        print(f"### {cat}  ({len(items)})")
        for qid, detail in items:
            print(f"  - {qid}: {detail}")
        print()

print(f"TOTAL FLAGS: {total}")
