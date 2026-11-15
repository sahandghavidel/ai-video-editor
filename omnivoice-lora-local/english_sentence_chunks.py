"""Detect original English sentence boundaries and group prepared sentences for LoRA."""
import json
import re
import sys

import pysbd

_SENTENCE_END = re.compile(r"""[.!?…]["'’”»)\]}]*\s*\Z""")
_QUOTE_END = re.compile(r"""[.!?…]["'’”»]+\s*\Z""")
# A reporting clause immediately after closing dialogue belongs to that quote.
_SPEAKER = r"(?:[Hh]e|[Ss]he|[Tt]hey|[Ww]e|I|[Yy]ou|[A-Z][\w’'-]*(?:[ \t]+[A-Z][\w’'-]*){0,3})"
_VERB = r"(?i:asked|said|replied|answered|added|whispered|shouted|murmured|exclaimed|continued|called|cried|yelled|remarked|responded)"
_ATTRIBUTION = re.compile(rf"(?:{_SPEAKER}\s+{_VERB}|{_VERB}\s+{_SPEAKER})\b")


def english_sentences(text):
    detection_text = re.sub(r'\s', ' ', text)
    spans = pysbd.Segmenter(language='en', clean=False, char_span=True).segment(detection_text)
    sentences = []
    start = 0
    for span in spans:
        if not _SENTENCE_END.search(span.sent):
            continue
        if _QUOTE_END.search(span.sent) and _ATTRIBUTION.match(detection_text, span.end):
            continue
        sentences.append(text[start:span.end].strip())
        start = span.end
    if text[start:].strip():
        sentences.append(text[start:].strip())
    return sentences


def group_sentences(sentences, chunk_len):
    groups = []
    current = []
    length = 0
    for sentence in sentences:
        if current and length + 1 + len(sentence) > chunk_len:
            groups.append(current)
            current = []
            length = 0
        length += len(sentence) + bool(current)
        current.append(sentence)
    if current:
        groups.append(current)
    return groups


def install_english_sentence_chunking(sentences=None, on_chunks=None):
    # Jobs run serially in a dedicated, single-language worker. Bind this job's
    # prepared sentences to the splitter used by the model's long-input path.
    from omnivoice.models import omnivoice
    counts = []

    def split(text, chunk_len, min_chunk_len=None):
        if sentences is not None and ' '.join(sentences) != text:
            raise ValueError('English sentence plan does not match synthesis text')
        groups = group_sentences(sentences if sentences is not None else english_sentences(text), chunk_len)
        if on_chunks is not None:
            on_chunks(groups)
        counts.extend(len(group) for group in groups)
        return [' '.join(group) for group in groups]

    omnivoice.chunk_text_punctuation = split
    return counts


if __name__ == '__main__':
    print(json.dumps(english_sentences(sys.argv[1])))
