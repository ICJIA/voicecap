/**
 * Runs before each test file. The person's own transcripts home and reviewer name are taken out of
 * the environment, so no test can reach them, even through a mistake in the code under test that
 * reads process.env in place of the environment the test gave it. Every test gives its own.
 */
delete process.env.VOICECAP_TRANSCRIPTS;
delete process.env.VOICECAP_REVIEWER;
