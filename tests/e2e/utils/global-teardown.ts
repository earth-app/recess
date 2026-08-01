import { mergeAndReport } from './coverage';

/**
 * Merges the per-test V8 files once, after the last worker exits.
 *
 * It has to happen here rather than per test: workers run in separate processes, so each one only
 * ever sees its own shard of the raw files. A failure is logged and swallowed - a broken coverage
 * merge is not a reason to fail a green test run.
 */
export default async function globalTeardown(): Promise<void> {
	if (process.env.COVERAGE !== '1') return;

	try {
		await mergeAndReport();
	} catch (error) {
		console.error('[teardown] coverage merge failed:', error);
	}
}
