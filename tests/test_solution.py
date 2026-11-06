"""The solution composer and the retrieval signal."""

from __future__ import annotations

import unittest

from sg16 import fixed as F
from sg16.retrieval import HashVectorizer, cosine, overlap_coefficient, stem
from sg16.solution import analyse_idea, compose_solution


class StemmerTests(unittest.TestCase):
    def test_common_suffixes_fold(self) -> None:
        self.assertEqual(stem("deployed"), "deploy")
        self.assertEqual(stem("hosting"), "host")
        self.assertEqual(stem("models"), "model")
        self.assertEqual(stem("processes"), "process")
        self.assertEqual(stem("cities"), "city")

    def test_short_words_are_left_alone(self) -> None:
        for word in ("is", "as", "run", "gas", "class"):
            self.assertEqual(stem(word), word)


class VectorizerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.vectorizer = HashVectorizer()

    def test_vector_is_l2_normalised(self) -> None:
        vector = self.vectorizer.vector("the master door controls entry and exit")
        norm = sum(F.mul(v, v) for v in vector)
        self.assertAlmostEqual(F.unfx(norm), 1.0, places=2)

    def test_identical_text_has_cosine_one(self) -> None:
        a = self.vectorizer.vector("master door")
        # components are rounded to Q16.16 during normalisation, so the
        # self-similarity can land one or two LSB below exactly 1.0
        self.assertLessEqual(abs(cosine(a, a) - F.FX_ONE), 2)

    def test_unrelated_text_has_low_cosine(self) -> None:
        similarity = self.vectorizer.similarity(
            "the master door controls entry and exit",
            "fried rice with egg and spring onion",
        )
        self.assertLess(F.unfx(similarity), 0.15)

    def test_stemming_makes_inflected_forms_match(self) -> None:
        # "deployed" stems to "deploy", so the two sentences share a feature.
        stemmed = self.vectorizer.similarity(
            "how do i deploy", "the brain was deployed yesterday"
        )
        # "deployment" does not stem to "deploy", so they share nothing.  The
        # gap between these two numbers is exactly what the stemmer buys, and
        # it is why the knowledge base also carries explicit keyword forms.
        unstemmed = self.vectorizer.similarity(
            "how do i deploy", "the brain was deployment yesterday"
        )
        self.assertGreater(F.unfx(stemmed), 0.0)
        self.assertEqual(unstemmed, 0)
        self.assertGreater(stemmed, unstemmed)

    def test_suffix_only_stemming_does_not_fold_every_derivative(self) -> None:
        self.assertNotEqual(stem("deployment"), stem("deploy"))

    def test_empty_text_gives_a_zero_vector(self) -> None:
        self.assertEqual(set(self.vectorizer.vector("")), {0})

    def test_overlap_coefficient_is_scale_invariant(self) -> None:
        short = {"master", "door"}
        long = {"master", "door", "gate", "perimeter", "seal", "joint", "room"}
        self.assertEqual(overlap_coefficient(short, long), F.FX_ONE)

    def test_overlap_coefficient_of_disjoint_sets_is_zero(self) -> None:
        self.assertEqual(overlap_coefficient({"a"}, {"b"}), 0)

    def test_overlap_coefficient_of_empty_set_is_zero(self) -> None:
        self.assertEqual(overlap_coefficient(set(), {"a"}), 0)

    def test_content_tokens_drop_stopwords(self) -> None:
        tokens = self.vectorizer.content_tokens("what is the capital of France")
        self.assertIn("capital", tokens)
        self.assertIn("france", tokens)
        self.assertNotIn("what", tokens)
        self.assertNotIn("the", tokens)

    def test_deterministic(self) -> None:
        self.assertEqual(
            self.vectorizer.vector("repeat me"), self.vectorizer.vector("repeat me")
        )


class IdeaAnalysisTests(unittest.TestCase):
    def test_action_verb_is_detected(self) -> None:
        self.assertEqual(analyse_idea("I want to build a solar dryer").action, "build")
        self.assertEqual(analyse_idea("help me launch a coffee shop").action, "launch")

    def test_defaults_to_build_when_no_verb_is_present(self) -> None:
        self.assertEqual(analyse_idea("a solar dryer for my village").action, "build")

    def test_subject_does_not_repeat_the_verb(self) -> None:
        analysis = analyse_idea("I want to build a solar dryer for my village")
        self.assertNotIn("build", analysis.subject.split())
        self.assertIn("solar", analysis.subject)

    def test_subject_keeps_document_order(self) -> None:
        analysis = analyse_idea("I want to build a solar dryer for my village")
        self.assertEqual(analysis.subject.split()[:2], ["solar", "dryer"])


class SolutionCompositionTests(unittest.TestCase):
    def test_fresh_solution_has_five_steps(self) -> None:
        solution = compose_solution("I want to build a solar dryer for my village")
        self.assertEqual(len(solution["steps"]), 5)
        self.assertFalse(solution["refined"])

    def test_refined_solution_is_flagged(self) -> None:
        solution = compose_solution(
            "I want to build a solar dryer", refined=True, correction="the cheap version"
        )
        self.assertTrue(solution["refined"])
        self.assertIn("exact version", solution["headline"])

    def test_solution_quotes_the_users_own_words(self) -> None:
        idea = "I want to build a solar dryer for my village"
        self.assertIn(idea, compose_solution(idea)["text"])

    def test_long_ideas_are_truncated_in_the_quote(self) -> None:
        solution = compose_solution("x" * 400)
        self.assertIn("...", solution["text"])

    def test_refined_falls_back_to_the_original_subject(self) -> None:
        solution = compose_solution(
            "I want to build a solar dryer for my village",
            refined=True,
            correction="no, not what I meant",
        )
        self.assertIn("solar", solution["headline"])

    def test_knowledge_note_is_appended_when_supplied(self) -> None:
        solution = compose_solution("build a solar dryer", knowledge_note="a recorded fact")
        self.assertIn("From my own records", solution["text"])
        self.assertIn("a recorded fact", solution["text"])

    def test_solution_ends_with_a_question(self) -> None:
        text = compose_solution("I want to build a solar dryer")["text"].strip()
        self.assertTrue(text.endswith("?"))

    def test_deterministic(self) -> None:
        idea = "I want to build a solar dryer for my village"
        self.assertEqual(
            compose_solution(idea)["text"], compose_solution(idea)["text"]
        )

    def test_analysis_is_json_shaped(self) -> None:
        analysis = compose_solution("build a solar dryer")["analysis"]
        self.assertEqual(
            sorted(analysis), ["action", "keywords", "subject", "word_count"]
        )


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
