import {
  isLtxVideoModelId,
  isVideoModelCandidate,
  normalizeRequestedVideoFrames,
} from '../nodes/Sogni/videoModelUtils';

console.log('🧪 Starting video model utility tests...\n');

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    testsPassed++;
  } catch (error) {
    console.error(`❌ FAIL: ${name}`);
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    testsFailed++;
  }
}

test('Should recognize LTX 2, LTX 2.3, and wrapper-style ltx23 model IDs', () => {
  if (!isLtxVideoModelId('ltx2-19b-fp8_t2v')) {
    throw new Error('Expected ltx2-* model to be recognized');
  }

  if (!isLtxVideoModelId('ltx23-13b-distilled_t2v')) {
    throw new Error('Expected ltx23-* model to be recognized');
  }

  if (!isLtxVideoModelId('ltx2.3-13b-distilled_t2v')) {
    throw new Error('Expected ltx2.3-* model to be recognized');
  }
});

test('Should treat ltx23 models as video candidates without keyword matches', () => {
  const isCandidate = isVideoModelCandidate({
    id: 'ltx23-13b-distilled_t2v',
    name: 'LTX 2.3 Distilled',
    description: 'Text to image pipeline',
  });

  if (!isCandidate) {
    throw new Error('Expected explicit ltx23 model prefix to pass video filtering');
  }
});

test('Should continue to detect generic video models by keyword fallback', () => {
  const isCandidate = isVideoModelCandidate({
    id: 'custom-model',
    name: 'Cinematic Motion Generator',
    description: 'Video animation model',
  });

  if (!isCandidate) {
    throw new Error('Expected keyword-based video model to pass filtering');
  }
});

test('Should normalize LTX frame counts to 8n+1 for generation and estimates', () => {
  const normalized = normalizeRequestedVideoFrames('ltx23-13b-distilled_t2v', 30);
  if (normalized !== 33) {
    throw new Error(`Expected 30 requested frames to normalize to 33, got ${normalized}`);
  }

  const preserved = normalizeRequestedVideoFrames('ltx23-13b-distilled_t2v', 113);
  if (preserved !== 113) {
    throw new Error(`Expected 113 requested frames to stay 113, got ${preserved}`);
  }
});

test('Should leave non-LTX frame counts unchanged', () => {
  const normalized = normalizeRequestedVideoFrames('wan_v2.2-14b-fp8_t2v_lightx2v', 30);
  if (normalized !== 30) {
    throw new Error(`Expected WAN frames to stay 30, got ${normalized}`);
  }
});

console.log('\n' + '='.repeat(50));
console.log(`✅ Tests passed: ${testsPassed}`);
console.log(`❌ Tests failed: ${testsFailed}`);
console.log(`📊 Total tests: ${testsPassed + testsFailed}`);
console.log('='.repeat(50));

if (testsFailed > 0) {
  process.exit(1);
}
