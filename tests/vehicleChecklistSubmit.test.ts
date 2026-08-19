import assert from 'node:assert/strict';
import type { GFVehicleCheck } from '../src/types/routeStart';

type TestDraft = {
  bool?: boolean;
  numeric?: string;
  text?: string;
  reason?: string;
  photoUri?: string;
  queued?: boolean;
};

interface SubmitModule {
  validateRequiredChecklistDrafts: (
    checks: GFVehicleCheck[],
    drafts: Record<number, TestDraft>,
  ) => { ok: boolean; missing: Array<{ id: number; sequence: number; name: string }> };
  collectUnsubmittedChecks: (
    checks: GFVehicleCheck[],
    drafts: Record<number, TestDraft>,
  ) => GFVehicleCheck[];
  checkNeedsSubmit: (
    check: GFVehicleCheck,
    draft: TestDraft | undefined,
  ) => boolean;
  buildAnswerFromDraft: (input: {
    check: GFVehicleCheck;
    draft: TestDraft;
    photoBase64?: string | null;
    photoOnline?: boolean;
  }) => { ok: true; answer: Record<string, unknown> } | { ok: false; error: string };
  formatMissingRequiredChecks: (missing: Array<{ id: number; sequence: number; name: string }>) => string;
}

function makeCheck(partial: Partial<GFVehicleCheck> & Pick<GFVehicleCheck, 'id' | 'name' | 'check_type'>): GFVehicleCheck {
  return {
    id: partial.id,
    sequence: partial.sequence ?? partial.id,
    name: partial.name,
    check_type: partial.check_type,
    required: partial.required ?? true,
    blocking_on_fail: partial.blocking_on_fail ?? false,
    passed: partial.passed ?? false,
    answered: partial.answered ?? false,
    not_passed_reason: partial.not_passed_reason ?? '',
    expected_bool: partial.expected_bool,
    min_value: partial.min_value ?? null,
    max_value: partial.max_value ?? null,
    result_bool: partial.result_bool ?? null,
    result_numeric: partial.result_numeric ?? null,
    result_text: partial.result_text ?? '',
    result_photo_url: partial.result_photo_url ?? null,
  };
}

function testMissingRequiredBlocksMutation(m: SubmitModule) {
  const checks = [
    makeCheck({ id: 1, name: 'Llantas', check_type: 'yes_no', required: true, expected_bool: true }),
    makeCheck({ id: 2, name: 'Odómetro', check_type: 'numeric', required: true }),
    makeCheck({ id: 3, name: 'Notas', check_type: 'text', required: false }),
  ];
  const validation = m.validateRequiredChecklistDrafts(checks, {
    1: { bool: true },
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.missing.length, 1);
  assert.equal(validation.missing[0].id, 2);
  assert.match(m.formatMissingRequiredChecks(validation.missing), /Odómetro/);
  assert.equal(
    m.collectUnsubmittedChecks(checks, { 1: { bool: true } }).length,
    1,
    'missing required must be detected before any submit list is used as a mutation',
  );
}

function testQualityFailDoesNotCountAsMissing(m: SubmitModule) {
  const checks = [
    makeCheck({ id: 1, name: 'Llantas', check_type: 'yes_no', required: true, expected_bool: true }),
  ];
  const validation = m.validateRequiredChecklistDrafts(checks, {
    1: { bool: false, reason: 'llanta baja' },
  });
  assert.equal(validation.ok, true, 'a failed yes/no is still an answered required item');
  const built = m.buildAnswerFromDraft({
    check: checks[0],
    draft: { bool: false, reason: 'llanta baja' },
  });
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.answer.result_bool, false);
  }
}

function testAlreadyAnsweredDoesNotNeedResubmit(m: SubmitModule) {
  const check = makeCheck({
    id: 4,
    name: 'Gas',
    check_type: 'yes_no',
    answered: true,
    result_bool: true,
    expected_bool: true,
  });
  assert.equal(m.checkNeedsSubmit(check, { bool: true }), false);
  assert.equal(m.checkNeedsSubmit(check, { bool: false }), true, 'changed draft must resubmit');
  assert.equal(
    m.validateRequiredChecklistDrafts([check], {}).ok,
    true,
    'server-answered required items satisfy local validation without a draft',
  );
}

function testQueuedDraftSatisfiesRequired(m: SubmitModule) {
  const check = makeCheck({ id: 5, name: 'Foto', check_type: 'photo', required: true });
  assert.equal(m.validateRequiredChecklistDrafts([check], { 5: { queued: true, photoUri: 'file://x' } }).ok, true);
  assert.equal(m.checkNeedsSubmit(check, { queued: true, photoUri: 'file://x' }), false);
}

function testPhotoNeedsUriToSubmit(m: SubmitModule) {
  const check = makeCheck({ id: 6, name: 'Odómetro foto', check_type: 'photo' });
  assert.equal(m.checkNeedsSubmit(check, {}), false);
  assert.equal(m.checkNeedsSubmit(check, { photoUri: 'file://odo.jpg' }), true);
  const online = m.buildAnswerFromDraft({
    check,
    draft: { photoUri: 'file://odo.jpg' },
    photoOnline: true,
    photoBase64: 'abc',
  });
  assert.equal(online.ok, true);
  const missingPhoto = m.buildAnswerFromDraft({
    check,
    draft: { photoUri: 'file://odo.jpg' },
    photoOnline: true,
    photoBase64: null,
  });
  assert.equal(missingPhoto.ok, false);
}

async function main() {
  const m = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/services/vehicleChecklistSubmit.ts', import.meta.url).pathname
  ) as SubmitModule;

  testMissingRequiredBlocksMutation(m);
  testQualityFailDoesNotCountAsMissing(m);
  testAlreadyAnsweredDoesNotNeedResubmit(m);
  testQueuedDraftSatisfiesRequired(m);
  testPhotoNeedsUriToSubmit(m);

  console.log('vehicle checklist submit tests: ok');
}

void main();
