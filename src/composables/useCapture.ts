import { Capacitor } from '@capacitor/core';

// Photo, audio and barcode capture. Nothing captured ever leaves the device, and
// media is written to Filesystem rather than kept as a data url so a long history
// does not sit in memory or in Preferences.

export const MEDIA_DIR = 'media';
export const MAX_RECORDING_SECONDS = 300;

// #region photo

export interface CapturedPhoto {
	blob: Blob;
	/** object url for preview; revoke it when the sheet closes */
	preview: string;
}

/** camera only, never the library - a library pick defeats the point of a nudge */
export async function capturePhoto(): Promise<CapturedPhoto | null> {
	if (!Capacitor.isNativePlatform()) return capturePhotoWeb();

	try {
		const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
		const photo = await Camera.getPhoto({
			quality: 92,
			resultType: CameraResultType.Uri,
			source: CameraSource.Camera,
			saveToGallery: false,
			// keeps EXIF, which the fresh-capture check reads
			correctOrientation: true
		});

		const uri = photo.webPath ?? photo.path;
		if (!uri) return null;

		const blob = await (await fetch(uri)).blob();
		return { blob, preview: URL.createObjectURL(blob) };
	} catch (error) {
		// the user cancelling is not an error worth surfacing
		if (isCancellation(error)) return null;
		console.warn('[capture] photo failed:', error);
		return null;
	}
}

function isCancellation(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /cancel/i.test(message) || /OS-PLUG-CAMR-000(6|20)/.test(message);
}

/** file input fallback so the web build and e2e can exercise the flow */
async function capturePhotoWeb(): Promise<CapturedPhoto | null> {
	if (typeof document === 'undefined') return null;

	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.capture = 'environment';
		input.style.display = 'none';
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			input.remove();
			resolve(file ? { blob: file, preview: URL.createObjectURL(file) } : null);
		});
		input.addEventListener('cancel', () => {
			input.remove();
			resolve(null);
		});
		document.body.append(input);
		input.click();
	});
}

// #endregion

// #region audio

export interface CapturedAudio {
	blob: Blob;
	seconds: number;
	preview: string;
}

let webRecorder: MediaRecorder | null = null;
let webChunks: Blob[] = [];
let webStream: MediaStream | null = null;
let startedAt = 0;

export async function startRecording(): Promise<boolean> {
	if (Capacitor.isNativePlatform()) {
		try {
			const { CapacitorAudioRecorder } = await import('@capgo/capacitor-audio-recorder');
			await CapacitorAudioRecorder.startRecording();
			startedAt = Date.now();
			return true;
		} catch (error) {
			console.warn('[capture] recording failed to start:', error);
			return false;
		}
	}

	try {
		webStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
			MediaRecorder.isTypeSupported(type)
		);
		webRecorder = new MediaRecorder(webStream, mime ? { mimeType: mime } : undefined);
		webChunks = [];
		webRecorder.addEventListener('dataavailable', (event) => {
			if (event.data.size > 0) webChunks.push(event.data);
		});
		webRecorder.start(100);
		startedAt = Date.now();
		return true;
	} catch (error) {
		console.warn('[capture] recording failed to start:', error);
		return false;
	}
}

export async function stopRecording(): Promise<CapturedAudio | null> {
	const seconds = Math.round((Date.now() - startedAt) / 1000);

	if (Capacitor.isNativePlatform()) {
		try {
			const { CapacitorAudioRecorder } = await import('@capgo/capacitor-audio-recorder');
			const result = await CapacitorAudioRecorder.stopRecording();
			const uri =
				(result as { uri?: string; path?: string }).uri ?? (result as { path?: string }).path;
			if (!uri) return null;
			const blob = await (await fetch(uri)).blob();
			return { blob, seconds, preview: URL.createObjectURL(blob) };
		} catch (error) {
			console.warn('[capture] recording failed to stop:', error);
			return null;
		}
	}

	if (!webRecorder) return null;

	return new Promise((resolve) => {
		const recorder = webRecorder as MediaRecorder;
		recorder.addEventListener(
			'stop',
			() => {
				const blob = new Blob(webChunks, { type: recorder.mimeType || 'audio/webm' });
				webStream?.getTracks().forEach((track) => track.stop());
				webRecorder = null;
				webStream = null;
				webChunks = [];
				resolve(blob.size > 0 ? { blob, seconds, preview: URL.createObjectURL(blob) } : null);
			},
			{ once: true }
		);
		recorder.stop();
	});
}

export function isRecording(): boolean {
	return webRecorder !== null || startedAt > 0;
}

// #endregion

// #region barcode

export interface BarcodeResult {
	data: string;
	format: number;
}

export async function scanBarcode(): Promise<BarcodeResult | null> {
	if (!Capacitor.isNativePlatform()) return null;

	try {
		const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } =
			await import('@capacitor/barcode-scanner');
		const result = await CapacitorBarcodeScanner.scanBarcode({
			hint: CapacitorBarcodeScannerTypeHint.ALL,
			scanInstructions: 'Center the barcode in the frame',
			scanButton: false
		});

		const data = result.ScanResult;
		if (!data) return null;
		// web engines disagree on format ordinals; -1 means "unknown", which the
		// structural check treats as "do not judge by symbology"
		return { data, format: -1 };
	} catch (error) {
		if (isCancellation(error)) return null;
		console.warn('[capture] barcode scan failed:', error);
		return null;
	}
}

// #endregion

// #region persistence

/**
 * Every media type recess writes to disk, and the extension it is stored under.
 *
 * These tables are the contract between the two halves of a highlight: the validation surfaces
 * choose an extension from them, and `week/Highlights.vue` inverts them to pick a playback type.
 * They used to be two independent lists - a local `extensionOf` in each surface that passed *any*
 * blob subtype straight through, against a closed map in Highlights - so a recorder emitting
 * `audio/ogg` wrote a `.ogg` the week could not play, and the highlight silently rendered nothing.
 * A format has to be in here to be written at all, which is what keeps them in step.
 */
export const IMAGE_TYPES: Readonly<Record<string, string>> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/heic': 'heic',
	'image/heif': 'heif',
	'image/avif': 'avif'
};

export const AUDIO_TYPES: Readonly<Record<string, string>> = {
	'audio/webm': 'webm',
	'audio/mp4': 'm4a',
	'audio/aac': 'aac',
	'audio/mpeg': 'mp3',
	'audio/wav': 'wav',
	'audio/x-wav': 'wav',
	'audio/x-caf': 'caf',
	'audio/ogg': 'ogg',
	'audio/opus': 'opus',
	'audio/3gpp': '3gp'
};

/** what an unrecognised blob is stored as; both are decodable on every platform recess ships to */
const FALLBACK_EXTENSION = { image: 'jpg', audio: 'webm' } as const;

/**
 * The extension a captured blob is saved under.
 *
 * An unknown type falls back rather than passing through, so what lands on disk is always something
 * the Week tab can hand back to an `<img>` or an `<audio>`. A misnamed container still decodes -
 * both engines sniff the bytes - whereas an extension with no playback type shows nothing at all.
 */
export function mediaExtension(blob: Blob, kind: 'image' | 'audio'): string {
	const type = blob.type.split(';')[0]?.trim().toLowerCase() ?? '';
	const table = kind === 'image' ? IMAGE_TYPES : AUDIO_TYPES;
	return table[type] ?? FALLBACK_EXTENSION[kind];
}

/** first mime wins, so heic and heif do not collapse onto one another */
function invert(types: Readonly<Record<string, string>>): Record<string, string> {
	const byExtension: Record<string, string> = {};
	for (const [mime, extension] of Object.entries(types)) byExtension[extension] ??= mime;
	return byExtension;
}

// liberal on read: aliases an older build could already have written to a device
const IMAGE_PLAYBACK: Record<string, string> = { ...invert(IMAGE_TYPES), jpeg: 'image/jpeg' };
const AUDIO_PLAYBACK: Record<string, string> = { ...invert(AUDIO_TYPES), mp4: 'audio/mp4' };

/**
 * The mime a stored file is handed back as, or null when nothing can play it.
 *
 * `readMedia` returns a generic octet-stream data url, so retyping it is what makes an `<img>` or
 * `<audio>` decode at all. This is the exact inverse of `mediaExtension`, and living next to it is
 * the point: the writer cannot gain a format the reader has no type for.
 */
export function playbackType(extension: string): { kind: 'image' | 'audio'; mime: string } | null {
	const key = extension.toLowerCase();
	const image = IMAGE_PLAYBACK[key];
	if (image) return { kind: 'image', mime: image };

	const audio = AUDIO_PLAYBACK[key];
	return audio ? { kind: 'audio', mime: audio } : null;
}

/** keep a captured blob so the Week tab can show it back later */
export async function persistMedia(
	blob: Blob,
	id: string,
	extension: string
): Promise<string | null> {
	try {
		const { Directory, Encoding, Filesystem } = await import('@capacitor/filesystem');

		try {
			await Filesystem.mkdir({ path: MEDIA_DIR, directory: Directory.Data, recursive: true });
		} catch {
			// exists
		}

		const path = `${MEDIA_DIR}/${id}-${Date.now()}.${extension}`;
		const buffer = await blob.arrayBuffer();
		const bytes = new Uint8Array(buffer);
		let binary = '';
		for (let i = 0; i < bytes.length; i += 8192) {
			binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
		}

		await Filesystem.writeFile({
			path,
			data: btoa(binary),
			directory: Directory.Data,
			encoding: Encoding.UTF8
		});

		return path;
	} catch {
		// out of disk or unsupported; the nudge still resolves without the keepsake
		return null;
	}
}

export async function readMedia(path: string): Promise<string | null> {
	try {
		const { Directory, Encoding, Filesystem } = await import('@capacitor/filesystem');
		const file = await Filesystem.readFile({
			path,
			directory: Directory.Data,
			encoding: Encoding.UTF8
		});
		return `data:application/octet-stream;base64,${file.data as string}`;
	} catch {
		return null;
	}
}

// #endregion
