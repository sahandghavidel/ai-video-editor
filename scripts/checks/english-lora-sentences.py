"""Run with the English LoRA runtime Python."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'omnivoice-lora-local'))
from english_sentence_chunks import english_sentences, group_sentences


class EnglishSentenceCheck(unittest.TestCase):
    def test_original_dialogue_and_abbreviations(self):
        expected = [
            'At 9:15 a.m., Dr. Chen checked version 3.14.',
            '“Is that right?” she asked, pointing at the U.S. guide.',
            '“Wait... did it blink?” Maya asked.',
            'The next inspection was at 10 a.m.',
            'Mr. Wells closed the cover.',
        ]
        self.assertEqual(english_sentences(' '.join(expected)), expected)
        self.assertEqual(group_sentences(expected, 1), [[s] for s in expected])

    def test_independent_action_after_quote(self):
        self.assertEqual(english_sentences('“Are you sure?” Maya opened the door.'),
                         ['“Are you sure?”', 'Maya opened the door.'])


if __name__ == '__main__':
    unittest.main()
