import { describe, expect, it } from 'vitest';
import { AUDIO_TYPES, IMAGE_TYPES, mediaExtension, playbackType } from '~/composables/useCapture';

/**
 * The capture-to-playback contract.
 *
 * A highlight has two halves in different files: a validation surface picks the extension a blob is
 * saved under, and `week/Highlights.vue` picks a playback mime from that extension. Those were two
 * hand-kept lists, and the writer's was open-ended - it passed any blob subtype straight through -
 * so a recorder emitting `audio/ogg` wrote a `.ogg` the week had no mime for, and the highlight
 * rendered nothing at all. No error, no broken-image icon, just a card with an empty box.
 *
 * Both directions now live in one file, and the second half of this spec is what keeps them in step:
 * every extension the writer can produce has to come back as a playable type of the right kind.
 */

const blob = (type: string) => new Blob(['x'], { type });

describe('the extension a capture is saved under', () => {
	it('uses the table entry for a known type', () => {
		expect(mediaExtension(blob('image/png'), 'image')).toBe('png');
		expect(mediaExtension(blob('audio/mpeg'), 'audio')).toBe('mp3');
	});

	// browsers append a codec list, so the raw type is almost never a bare mime
	it('ignores codec parameters', () => {
		expect(mediaExtension(blob('audio/webm;codecs=opus'), 'audio')).toBe('webm');
		expect(mediaExtension(blob('image/jpeg; charset=binary'), 'image')).toBe('jpg');
	});

	it('is case insensitive', () => {
		expect(mediaExtension(blob('IMAGE/JPEG'), 'image')).toBe('jpg');
	});

	/**
	 * The old behaviour was to pass an unknown subtype through as the extension, which is exactly
	 * how an unplayable file reached the disk. Falling back keeps the extension inside the table;
	 * a mislabelled container still decodes, because both engines sniff the bytes.
	 */
	it('falls back rather than passing an unknown type through', () => {
		expect(mediaExtension(blob('audio/flac'), 'audio')).toBe('webm');
		expect(mediaExtension(blob('image/jxl'), 'image')).toBe('jpg');
	});

	it('falls back for a blob with no type at all', () => {
		expect(mediaExtension(blob(''), 'image')).toBe('jpg');
		expect(mediaExtension(blob(''), 'audio')).toBe('webm');
	});

	it('never returns something that is not a bare extension', () => {
		for (const type of ['image/svg+xml', 'audio/x-m4a', '../../etc/passwd', 'audio/']) {
			const image = mediaExtension(blob(type), 'image');
			const audio = mediaExtension(blob(type), 'audio');
			expect(image, `${type} produced "${image}"`).toMatch(/^[a-z0-9]+$/);
			expect(audio, `${type} produced "${audio}"`).toMatch(/^[a-z0-9]+$/);
		}
	});
});

describe('everything written can be played back', () => {
	it('has a playback type for every extension a photo can be saved as', () => {
		for (const extension of Object.values(IMAGE_TYPES)) {
			expect(playbackType(extension), `an image saved as .${extension} cannot be played`).toEqual({
				kind: 'image',
				mime: expect.stringMatching(/^image\//)
			});
		}
	});

	it('has a playback type for every extension a recording can be saved as', () => {
		for (const extension of Object.values(AUDIO_TYPES)) {
			expect(playbackType(extension), `a clip saved as .${extension} cannot be played`).toEqual({
				kind: 'audio',
				mime: expect.stringMatching(/^audio\//)
			});
		}
	});

	// the fallbacks are what an unknown capture lands on, so they have to be playable too
	it('can play back what an unrecognised capture falls back to', () => {
		expect(playbackType(mediaExtension(new Blob([], { type: 'image/jxl' }), 'image'))).toEqual({
			kind: 'image',
			mime: 'image/jpeg'
		});
		expect(playbackType(mediaExtension(new Blob([], { type: 'audio/flac' }), 'audio'))).toEqual({
			kind: 'audio',
			mime: 'audio/webm'
		});
	});

	it('round-trips a known type through both directions', () => {
		for (const [mime, extension] of Object.entries({ ...IMAGE_TYPES, ...AUDIO_TYPES })) {
			const kind = mime.startsWith('image/') ? 'image' : 'audio';
			const saved = mediaExtension(new Blob([], { type: mime }), kind);
			expect(saved, `${mime} did not save as .${extension}`).toBe(extension);
			expect(playbackType(saved)?.kind, `.${saved} came back as the wrong kind`).toBe(kind);
		}
	});

	// an extension in both tables would resolve to whichever map is consulted first
	it('shares no extension between the two kinds', () => {
		const images = new Set(Object.values(IMAGE_TYPES));
		const overlap = Object.values(AUDIO_TYPES).filter((extension) => images.has(extension));
		expect(overlap, 'an extension is both an image and a clip').toEqual([]);
	});

	it('refuses an extension nothing can play', () => {
		for (const extension of ['flac', 'txt', '', 'exe']) {
			expect(playbackType(extension), `.${extension} was offered a player`).toBeNull();
		}
	});

	it('is case insensitive on the way back, since a path may be anything', () => {
		expect(playbackType('JPG')).toEqual({ kind: 'image', mime: 'image/jpeg' });
	});
});
