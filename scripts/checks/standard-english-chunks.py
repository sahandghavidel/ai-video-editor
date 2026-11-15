"""Run with the editor's standard OmniVoice Python environment."""
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'omnivoice-local'), str(ROOT / 'omnivoice-lora-local')]
from english_sentence_chunks import english_sentences
from omnivoice_worker import _generate_english
from omnivoice.models import omnivoice


class StandardEnglishChunking(unittest.TestCase):
    def test_short_job_logs_one_group_and_retains_native_splitter(self):
        native = omnivoice.chunk_text_punctuation
        output = StringIO()
        with redirect_stderr(output):
            _, counts = _generate_english(Mock(), {'text': 'One. Two.'}, ['One.', 'Two.'], 'short')
        self.assertEqual(counts, [2])
        self.assertIn('chunk=1/1 sentences=["One.", "Two."]', output.getvalue())
        self.assertIs(omnivoice.chunk_text_punctuation, native)

    def test_long_job_groups_prepared_sentences_and_restores_splitter_after_failure(self):
        original = ['“Open Next.js?” Maya asked.', 'At 9 a.m., Dr. Wu checked version 3.14.']
        self.assertEqual(english_sentences(' '.join(original)), original)
        prepared = ['Open Next .js? Maya asked.', 'At 9 a .m., Dr. Wu checked version 3.14.']
        native = omnivoice.chunk_text_punctuation

        def synthesize(text):
            self.assertEqual(omnivoice.chunk_text_punctuation(text, 1, 3), prepared)
            raise RuntimeError('generation failed')

        model = Mock()
        model.generate.side_effect = synthesize
        output = StringIO()
        with redirect_stderr(output), self.assertRaisesRegex(RuntimeError, 'generation failed'):
            _generate_english(model, {'text': ' '.join(prepared)}, prepared, 'long')
        self.assertIn('chunk=2/2', output.getvalue())
        self.assertIs(omnivoice.chunk_text_punctuation, native)


if __name__ == '__main__':
    unittest.main()
