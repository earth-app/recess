import { describe, expect, it } from 'vitest';
import {
	parseSemver,
	semverToVersionCode,
	setAndroidVersions,
	setIosVersions
} from '~/utils/version';

describe('parseSemver', () => {
	it('parses a plain version', () => {
		expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
	});

	it('drops a prerelease or build suffix', () => {
		expect(parseSemver('1.2.3-beta.1')).toEqual({ major: 1, minor: 2, patch: 3 });
		expect(parseSemver('1.2.3+abc')).toEqual({ major: 1, minor: 2, patch: 3 });
	});

	it('tolerates surrounding whitespace', () => {
		expect(parseSemver('  1.0.0 ')).toEqual({ major: 1, minor: 0, patch: 0 });
	});

	it('throws on anything else', () => {
		for (const bad of ['', '1', '1.2', 'v1.2.3', '1.2.3.4', 'nope']) {
			expect(() => parseSemver(bad), bad).toThrow(/invalid semver/);
		}
	});
});

describe('semverToVersionCode', () => {
	it('is monotonic across each component', () => {
		expect(semverToVersionCode('1.0.0')).toBe(10000);
		expect(semverToVersionCode('1.0.1')).toBe(10001);
		expect(semverToVersionCode('1.1.0')).toBe(10100);
		expect(semverToVersionCode('2.0.0')).toBe(20000);
	});

	it('increases with every bump', () => {
		const ordered = ['1.0.0', '1.0.1', '1.0.99', '1.1.0', '1.99.99', '2.0.0'];
		const codes = ordered.map(semverToVersionCode);
		expect([...codes].sort((a, b) => a - b)).toEqual(codes);
	});

	it('refuses a minor or patch that would collide', () => {
		expect(() => semverToVersionCode('1.100.0')).toThrow(/< 100/);
		expect(() => semverToVersionCode('1.0.100')).toThrow(/< 100/);
	});
});

describe('setIosVersions', () => {
	it('rewrites every occurrence, so all three targets stay aligned', () => {
		const pbxproj = [
			'MARKETING_VERSION = 0.9.0;',
			'CURRENT_PROJECT_VERSION = 1;',
			'MARKETING_VERSION = 0.9.0;',
			'CURRENT_PROJECT_VERSION = 1;',
			'MARKETING_VERSION = 0.9.0;'
		].join('\n');

		const next = setIosVersions(pbxproj, '1.2.3', 10203);
		expect(next.match(/MARKETING_VERSION = 1\.2\.3;/g)).toHaveLength(3);
		expect(next.match(/CURRENT_PROJECT_VERSION = 10203;/g)).toHaveLength(2);
		expect(next).not.toContain('0.9.0');
	});

	it('leaves unrelated settings alone', () => {
		const pbxproj = 'SWIFT_VERSION = 5.0;\nMARKETING_VERSION = 0.1.0;';
		expect(setIosVersions(pbxproj, '1.0.0', 10000)).toContain('SWIFT_VERSION = 5.0;');
	});

	it('is a no-op when already current', () => {
		const pbxproj = 'MARKETING_VERSION = 1.0.0;\nCURRENT_PROJECT_VERSION = 10000;';
		expect(setIosVersions(pbxproj, '1.0.0', 10000)).toBe(pbxproj);
	});
});

describe('setAndroidVersions', () => {
	it('rewrites versionName and versionCode', () => {
		const gradle = 'android {\n  versionCode 1\n  versionName "0.9.0"\n}';
		const next = setAndroidVersions(gradle, '1.2.3', 10203);
		expect(next).toContain('versionCode 10203');
		expect(next).toContain('versionName "1.2.3"');
	});

	it('is a no-op when already current', () => {
		const gradle = 'versionCode 10000\nversionName "1.0.0"';
		expect(setAndroidVersions(gradle, '1.0.0', 10000)).toBe(gradle);
	});
});
