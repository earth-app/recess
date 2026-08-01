# Eval corpus

A labeled corpus for the on-device validators in `src/utils/validate.ts`. Every case
names a real nudge id from `src/data/en/**`, so the rubric, label set and threshold used
during a run are the shipped ones; nothing is duplicated here. `bun run test:eval` fails
if a case points at a nudge that does not exist, at a nudge with a different
`validation_type`, or if a text / photo / audio nudge in the catalog has no case at all.

Nothing here is a real photo or a real recording. Photos and voice recordings of a real
person's home cannot be invented, so the corpus is declarative: each case describes the
submission, and the runner turns that description into the signal the validator scores.
What that buys and what it costs is spelled out per file below.

## `text.json`

`{ nudgeId, text, shouldPass, note }`. This exercises `validateText` end to end with no
approximation at all: the fixture is exactly what a user would type.

Every text nudge gets four kinds of case, and most get five:

| kind              | `shouldPass` | what it tests                                                                                       |
| ----------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| strong            | true         | all rubric criteria answered, in the user's own voice                                               |
| plain but genuine | true         | the same criteria answered flatly, so the corpus is not all best-case                               |
| weak              | false        | real content, deliberately under `min_length`; the length guard should reject it before any scoring |
| off topic         | false        | long enough to clear the guard, answers a different question                                        |
| adversarial       | false        | rubric vocabulary stuffed in with nothing behind it                                                 |

The adversarial cases are the interesting ones. A bag-of-words scorer cannot tell them
from a real answer, so under the stub backend they are false passes and they are what
caps text F1. Under a real sentence embedder they are the case worth watching, because
whether the embedder catches them is the difference between a validator that works and a
validator that rewards keyword stuffing.

## `photo.json`

`{ nudgeId, describedAs, shouldPass, note, image? }`.

**This is an approximation, and it is the weakest part of the corpus.** There is no image
here. `describedAs` is the caption a correct or incorrect photo would produce, and the
runner hands that caption to the scorer in place of pixels; the stub backend then scores
caption text against the authored `labels` and `negative_labels` in the same embedding
space. So the numbers measure the **label set and the softmax around it**, not what CLIP
sees.

What it does catch:

- a label set whose positives are indistinguishable from its negatives
- a missing negative label, where the obvious wrong photo has nothing to lose against
- regressions in `photoLabelSet`, `softmax` and `positiveMass`
- a threshold that no longer separates the two groups

What it cannot catch, at all:

- whether CLIP recognizes the thing in the photo
- anything about framing, lighting, blur or resolution
- a photo of a screen showing the right subject, which is exactly what
  `require_fresh_exif` and the screenshot negatives exist for

It is also vocabulary-sensitive, and the corpus keeps one case that shows it:
`art.create.handwritten_poem` is described as "four lines of handwriting in blue biro
across a notebook page", which loses to the negative label "a photo of a blank notebook
page" on shared words and comes out as a false miss. A real caption, a real failure of
the proxy, left in rather than reworded.

## `audio.json`

`{ nudgeId, transcript, seconds, shouldPass, note, audio? }`.

`validateAudio` transcribes first and then scores the transcript against the rubric, so a
transcript fixture drives the **scoring** half of that path exactly, with no
approximation. What it does not drive is Whisper: the transcript is given, not produced,
so nothing here measures transcription accuracy.

`seconds` feeds the `min_seconds` guard. Two cases sit under their nudge's floor, and two
carry an empty transcript, which is what an ambient recording with nobody speaking
actually produces; `validateAudio` returns `missed` on that before it scores. That is the
authoring trap in `CLAUDE.md` ("audio nudges must ask the user to speak") in fixture form.

## Adding a real corpus later

Both `photo.json` and `audio.json` already carry an optional media field, and the runner
prefers a real file whenever it finds one:

1. Put files under `tests/eval/fixtures/images/` and `tests/eval/fixtures/recordings/`.
   They are binary; do not commit them to git. Keep them out of the repo, or add them
   through Git LFS.
2. Point cases at them: `"image": "images/clear_desk_01.jpg"`,
   `"audio": "recordings/first_bird_01.m4a"`. Paths are relative to `fixtures/`.
3. Run `EVAL_REAL=1 bun run test:eval`. Real weights load, real bytes go to CLIP and
   Whisper, and the report is allowed to call itself model accuracy.

Under `EVAL_REAL=1` a photo case with no `image` is reported `unavailable` rather than
scored, because a caption cannot be shown to CLIP. Caption-only cases stay useful for the
stub lane, so both can live in the same file.

Two rules for a real corpus:

- **Consent and provenance.** Only photos and recordings taken for this purpose by
  someone who agreed to it. No scraped images, no stock, nothing with a stranger or an
  identifiable interior in it.
- **Label the hard cases.** A corpus of obvious passes and obvious failures reports a
  high F1 and calibrates nothing. The near misses are the whole value: the right subject
  photographed off a screen, the right room at night, the correct answer mumbled.
