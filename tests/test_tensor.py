"""Tensor algebra, tokenizer and structural matrix determinism."""

from __future__ import annotations

import unittest

from sg16 import fixed as F
from sg16 import matrix as M
from sg16 import tokenizer as T
from sg16.tensor import Tensor, cosine, dot, layer_norm, mean_pool, vector_norm


class TensorAlgebraTests(unittest.TestCase):
    def test_matmul_reference_value(self) -> None:
        a = Tensor.from_rows([[F.fx(1), F.fx(2)], [F.fx(3), F.fx(4)]])
        b = Tensor.from_rows([[F.fx(2)], [F.fx(3)]])
        out = a.matmul(b)
        self.assertEqual([F.unfx(v) for v in out.vector()], [8.0, 18.0])

    def test_matmul_shape_mismatch_raises(self) -> None:
        a = Tensor.from_rows([[F.fx(1), F.fx(2)]])
        b = Tensor.from_rows([[F.fx(1), F.fx(2)]])
        with self.assertRaises(ValueError):
            a.matmul(b)

    def test_ragged_rows_rejected(self) -> None:
        with self.assertRaises(ValueError):
            Tensor.from_rows([[1, 2], [3]])

    def test_transpose_round_trip(self) -> None:
        a = Tensor.from_rows([[1, 2, 3], [4, 5, 6]])
        self.assertEqual(a.transpose().transpose().data, a.data)

    def test_add_vector_is_rowwise(self) -> None:
        a = Tensor.from_rows([[0, 0], [10, 10]])
        out = a.add_vector([1, 2])
        self.assertEqual(out.row(0), [1, 2])
        self.assertEqual(out.row(1), [11, 12])

    def test_matvec_matches_matmul(self) -> None:
        a = Tensor.from_rows([[F.fx(1), F.fx(2)], [F.fx(3), F.fx(4)]])
        vec = [F.fx(2), F.fx(3)]
        self.assertEqual(a.matvec(vec), a.matmul(Tensor.from_vector(vec)).vector())


class NormalisationTests(unittest.TestCase):
    def test_layer_norm_has_zero_mean_per_row(self) -> None:
        a = Tensor.from_rows([[F.fx(1), F.fx(5), F.fx(9)], [F.fx(-3), F.fx(0), F.fx(7)]])
        out = layer_norm(a)
        for r in range(out.rows):
            self.assertAlmostEqual(sum(F.unfx(v) for v in out.row(r)), 0.0, places=3)

    def test_mean_pool_averages_columns(self) -> None:
        a = Tensor.from_rows([[F.fx(1), F.fx(2)], [F.fx(3), F.fx(4)]])
        pooled = mean_pool(a)
        self.assertEqual([F.unfx(v) for v in pooled], [2.0, 3.0])

    def test_cosine_of_identical_vectors_is_one(self) -> None:
        v = [F.fx(1), F.fx(-2), F.fx(3)]
        self.assertEqual(cosine(v, v), F.FX_ONE)

    def test_cosine_of_opposite_vectors_is_minus_one(self) -> None:
        v = [F.fx(1), F.fx(-2), F.fx(3)]
        self.assertEqual(cosine(v, [-x for x in v]), -F.FX_ONE)

    def test_cosine_of_zero_vector_is_zero(self) -> None:
        self.assertEqual(cosine([0, 0], [F.fx(1), F.fx(2)]), 0)

    def test_vector_norm(self) -> None:
        self.assertAlmostEqual(F.unfx(vector_norm([F.fx(3), F.fx(4)])), 5.0, places=2)

    def test_dot_length_mismatch_raises(self) -> None:
        with self.assertRaises(ValueError):
            dot([1, 2], [1])


class SerialisationTests(unittest.TestCase):
    def test_canonical_bytes_are_stable(self) -> None:
        a = Tensor.from_rows([[1, 2], [3, 4]])
        b = Tensor.from_rows([[1, 2], [3, 4]])
        self.assertEqual(a.sha256(), b.sha256())
        self.assertEqual(a.canonical_bytes(), b"2x2|1,2,3,4")

    def test_different_data_gives_different_digest(self) -> None:
        self.assertNotEqual(
            Tensor.from_rows([[1, 2]]).sha256(), Tensor.from_rows([[2, 1]]).sha256()
        )


class TokenizerTests(unittest.TestCase):
    def test_round_trip_ascii(self) -> None:
        text = "Hello, SG16 BRAIN!"
        self.assertEqual(T.decode(T.encode(text)), text)

    def test_round_trip_unicode(self) -> None:
        for text in ("سلام عليكم", "世界你好", "🌏🚀", "café résumé"):
            self.assertEqual(T.decode(T.encode(text)), text)

    def test_special_tokens_wrap_the_sequence(self) -> None:
        ids = T.encode("hi")
        self.assertEqual(ids[0], T.BOS)
        self.assertEqual(ids[-1], T.EOS)
        self.assertEqual(len(ids), len("hi".encode("utf-8")) + 2)

    def test_ids_stay_inside_the_vocabulary(self) -> None:
        for token in T.encode("mixed content 123 !@#"):
            self.assertGreaterEqual(token, 0)
            self.assertLess(token, T.VOCAB_SIZE)

    def test_empty_string(self) -> None:
        self.assertEqual(T.encode(""), [T.BOS, T.EOS])
        self.assertEqual(T.decode([T.BOS, T.EOS]), "")

    def test_normalize_folds_case_and_compatibility(self) -> None:
        self.assertEqual(T.normalize("ＡＢＣ"), "abc")
        self.assertEqual(T.normalize("  Hello  "), "hello")

    def test_signature_is_stable_and_sensitive(self) -> None:
        self.assertEqual(
            T.token_signature(T.encode("abc")), T.token_signature(T.encode("abc"))
        )
        self.assertNotEqual(
            T.token_signature(T.encode("abc")), T.token_signature(T.encode("abd"))
        )


class StructuralMatrixTests(unittest.TestCase):
    def test_same_seed_gives_same_matrix(self) -> None:
        self.assertEqual(M.build("seed.a", 4, 4).data, M.build("seed.a", 4, 4).data)

    def test_different_seed_gives_different_matrix(self) -> None:
        self.assertNotEqual(M.build("seed.a", 4, 4).data, M.build("seed.b", 4, 4).data)

    def test_values_stay_in_range(self) -> None:
        matrix = M.build("seed.range", 8, 8)
        for value in matrix.data:
            self.assertGreaterEqual(value, -F.FX_ONE)
            self.assertLess(value, F.FX_ONE)

    def test_magnitude_scales_output(self) -> None:
        full = M.build("seed.mag", 4, 4, F.FX_ONE)
        half = M.build("seed.mag", 4, 4, F.FX_ONE // 2)
        self.assertTrue(all(abs(h) <= abs(f) for f, h in zip(full.data, half.data)))

    def test_draw_is_index_sensitive(self) -> None:
        self.assertNotEqual(M.draw("seed.x", 0), M.draw("seed.x", 1))

    def test_fingerprint_is_order_sensitive(self) -> None:
        a = M.build("seed.a", 3, 3)
        b = M.build("seed.b", 3, 3)
        self.assertNotEqual(M.fingerprint(a, b), M.fingerprint(b, a))

    def test_invalid_dimensions_raise(self) -> None:
        with self.assertRaises(ValueError):
            M.build("seed.a", 0, 4)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
