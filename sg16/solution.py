"""English-first project-planning template composer.

This helper extracts a few English action words and keywords, then fills a
fixed solution template. It is not a general reasoner; it may misunderstand
short, ambiguous, or non-English project descriptions. Treat the output as a
starting point to verify, not an expert assessment.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .retrieval import HashVectorizer
from .charter import (
    SOLUTION_FIRST_PRINCIPLES,
    PANIC_AVOIDANCE_PRINCIPLES,
    HUMILITY_PRINCIPLES,
    INTELLECTUAL_HONESTY_PRINCIPLES,
    NO_EGO_PRINCIPLES,
    RESPONSE_ADAPTATION_PRINCIPLES,
    PERMANENT_BEHAVIORAL_HIERARCHY,
    MASTER_CHARACTER_PRINCIPLE,
)

__all__ = ["IdeaAnalysis", "analyse_idea", "compose_solution"]

from .retrieval import STOPWORDS  # noqa: E402

ACTION_VERBS = {
    "build": "build",
    "create": "create",
    "make": "make",
    "design": "design",
    "launch": "launch",
    "start": "start",
    "sell": "sell",
    "learn": "learn",
    "write": "write",
    "grow": "grow",
    "fix": "fix",
    "improve": "improve",
    "automate": "automate",
    "teach": "teach",
    "open": "open",
}


@dataclass(frozen=True)
class IdeaAnalysis:
    action: str
    subject: str
    keywords: tuple[str, ...]
    word_count: int
    raw: str

    def to_dict(self) -> dict:
        return {
            "action": self.action,
            "subject": self.subject,
            "keywords": list(self.keywords),
            "word_count": self.word_count,
        }


FILLER = frozenset(
    """meant mean want need exact really actually basically just like new one thing way
    help please make try get use look say said good bad much many yes okay ok sure
    version version's""".split()
)


def _keywords(text: str, limit: int = 6, skip_verbs: bool = False) -> list[str]:
    vectorizer = HashVectorizer()
    counts: dict[str, int] = {}
    order: dict[str, int] = {}
    for position, word in enumerate(vectorizer.tokenize(text)):
        if len(word) < 3 or word in STOPWORDS or word.isdigit() or word in FILLER:
            continue
        if skip_verbs and word in ACTION_VERBS:
            continue
        counts[word] = counts.get(word, 0) + 1
        order.setdefault(word, position)
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], order[kv[0]]))
    return [word for word, _ in ranked[:limit]]


def analyse_idea(text: str) -> IdeaAnalysis:
    folded = text.casefold()
    action = "build"
    for verb, canonical in ACTION_VERBS.items():
        if re.search(rf"\b{verb}\b", folded):
            action = canonical
            break
    subject_words = _keywords(text, limit=6, skip_verbs=True)[:3]
    idea_order = {w: i for i, w in enumerate(HashVectorizer().tokenize(text))}
    keywords = _keywords(text)
    subject_words.sort(key=lambda w: idea_order.get(w, 0))
    subject = " ".join(subject_words[:3]) if subject_words else "your idea"
    return IdeaAnalysis(
        action=action,
        subject=subject,
        keywords=tuple(keywords),
        word_count=len(folded.split()),
        raw=text.strip(),
    )


def _vision_understanding(analysis: IdeaAnalysis) -> dict:
    objective = f"{analysis.action} {analysis.subject}"
    philosophy = f"Focus on {', '.join(analysis.keywords[:3])}" if analysis.keywords else "Practical value creation"
    value = f"Potential value in {analysis.subject} for real users"
    constraints = "Time, resources, and existing tools" if analysis.word_count < 20 else "Scope, resources, and validation"
    outcome = f"Finished {analysis.subject} that works for one real person"
    return {
        "objective": objective,
        "philosophy": philosophy,
        "value": value,
        "constraints": constraints,
        "outcome": outcome,
    }


def _balanced_analysis(analysis: IdeaAnalysis) -> dict:
    subject = analysis.subject
    strengths = [
        f"Clear intent to {analysis.action} {subject}",
        f"Uses your own words and context: {', '.join(analysis.keywords[:3])}" if analysis.keywords else "Grounded in your description",
        "Testable in small steps, low risk to start",
    ]
    risks = [
        {
            "level": PANIC_AVOIDANCE_PRINCIPLES["severity_distinction"]["manageable_limitation"],
            "risk": f"{subject} may be too broad to test in one week",
            "why": "Broad scope delays feedback and increases waste",
            "solution": f"Cut {subject} to smallest version testable in one week with one real person — {SOLUTION_FIRST_PRINCIPLES['philosophy']}",
        },
        {
            "level": PANIC_AVOIDANCE_PRINCIPLES["severity_distinction"]["significant_risk"],
            "risk": f"Unclear if anyone needs {subject} today",
            "why": "Building without demand risks building something unused",
            "solution": f"Ask one real person who would use {subject} today what they would pay or do — incremental deployment, testing methodology",
        },
        {
            "level": PANIC_AVOIDANCE_PRINCIPLES["severity_distinction"]["optimization_opportunity"],
            "risk": "Adding features before fixing first break",
            "why": "Feature creep hides core problem",
            "solution": "Fix first thing that broke, then repeat test, do not add features yet — simpler workflow, backup approach",
        },
    ]
    return {"strengths": strengths, "risks": risks}


def compose_solution(
    idea: str,
    refined: bool = False,
    correction: str | None = None,
    knowledge_note: str | None = None,
) -> dict:
    analysis = analyse_idea(idea)
    subject = analysis.subject
    action = analysis.action
    first = analysis.keywords[0] if analysis.keywords else "the smallest useful piece"

    vision = _vision_understanding(analysis)
    balanced = _balanced_analysis(analysis)

    if not refined:
        steps = [
            f"Write the one outcome that would make {subject} a success, in a single sentence.",
            f"List what you already have for it: money, time, people, tools, contacts.",
            f"Cut {subject} down to the smallest version you could test within one week.",
            f"Put that small version in front of one real person and write down exactly what broke.",
            f"Fix the first thing that broke, then repeat the test. Do not add features yet.",
        ]
        headline = f"Here is a solution for your idea to {action} {subject}."
        check = f"What I would check first: whether anyone actually needs {subject} today, before anything is built for it."
        question = f"One question so the next version is exact: when you say {first!r}, what does finished look like to you?"
    else:
        correction_words = _keywords(correction or "", 3)
        focus = (
            " ".join(correction_words)
            if len(correction_words) >= 2
            else " ".join(_keywords(idea, limit=2, skip_verbs=True)) or first
        )
        steps = [
            f"Take {subject} exactly as you described it, and drop everything that is not {focus}.",
            f"State the one change you are asking for, in one line, as a test you can run.",
            f"Do that single change first, and nothing else alongside it.",
            f"Check it against your own words. If it does not match, it is not finished.",
            f"Only then continue with the rest of the plan, one step at a time.",
        ]
        headline = f"Here is the exact version, focused on {focus}."
        check = "What I would check first: that this matches what you described, not what I assumed."
        question = "Is this the version you meant, or is there one detail still missing?"

    body = [headline, ""]
    body.append("Stage 1 — Understand the Vision:")
    body.append(f"Objective: {vision['objective']}")
    body.append(f"Philosophy: {vision['philosophy']}")
    body.append(f"Potential value: {vision['value']}")
    body.append(f"Constraints: {vision['constraints']}")
    body.append(f"Intended outcome: {vision['outcome']}")
    body.append("")
    body.append("Your idea, as I understood it:")
    body.append(f'"{analysis.raw}"' if len(analysis.raw) <= 280 else f'"{analysis.raw[:277]}..."')
    body.append("")
    body.append("Stage 2 — Balanced Analysis (Strengths & Risks):")
    body.append("Strengths / Positives:")
    for s in balanced["strengths"]:
        body.append(f"- {s}")
    body.append("")
    body.append("Risks / Limitations / Weaknesses — Risk → Why it matters → Possible solution:")
    for r in balanced["risks"]:
        body.append(f"- [{r['level']}] Risk: {r['risk']}")
        body.append(f"  Why it matters: {r['why']}")
        body.append(f"  Possible solution: {r['solution']}")
    body.append("")
    body.append("Stage 3 — Solution-First Reasoning:")
    body.append(SOLUTION_FIRST_PRINCIPLES["philosophy"])
    body.append(f"Options: {SOLUTION_FIRST_PRINCIPLES['possible_responses']}")
    body.append("")
    body.append("Steps:")
    body.extend(f"{i}. {step}" for i, step in enumerate(steps, start=1))
    body.append("")
    body.append(check)
    if knowledge_note:
        body.append("")
        body.append(f"From my own records: {knowledge_note}")
    body.append("")
    body.append("Intellectual Honesty:")
    body.append(INTELLECTUAL_HONESTY_PRINCIPLES["distinguish"])
    body.append(f"What I know: your idea text. What I calculate: word count {analysis.word_count}, keywords {analysis.keywords}. What I infer: objective {vision['objective']}. What requires verification: real user demand for {subject}.")
    body.append("")
    body.append("Humility in Deliverables:")
    body.append(HUMILITY_PRINCIPLES["philosophy"])
    body.append("")
    body.append("Permanent Principle:")
    body.append(PERMANENT_BEHAVIORAL_HIERARCHY["hierarchy"])
    body.append("")
    body.append(f"Master Character: {MASTER_CHARACTER_PRINCIPLE['objective']}")
    body.append("")
    body.append(question)

    return {
        "refined": refined,
        "headline": headline,
        "steps": steps,
        "analysis": analysis.to_dict(),
        "vision": vision,
        "balanced_analysis": balanced,
        "intellectual_honesty": INTELLECTUAL_HONESTY_PRINCIPLES["distinguish"],
        "humility": HUMILITY_PRINCIPLES["philosophy"],
        "text": "\n".join(body),
    }
