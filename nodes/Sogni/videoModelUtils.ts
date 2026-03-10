export interface VideoModelLike {
  id?: string;
  name?: string;
  description?: string;
}

const LTX_VIDEO_PREFIXES = ['ltx2-', 'ltx23-', 'ltx2.3-'] as const;
const VIDEO_MODEL_KEYWORDS = ['video', 'vid', 'animation', 'motion', 'animate'] as const;
const LTX_FRAME_STEP = 8;
const LTX_MIN_FRAMES = 9;

function normalizeModelText(value?: string): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isWanVideoModelId(modelId?: string): boolean {
  return normalizeModelText(modelId).startsWith('wan_');
}

export function isLtxVideoModelId(modelId?: string): boolean {
  const normalizedModelId = normalizeModelText(modelId);
  return LTX_VIDEO_PREFIXES.some((prefix) => normalizedModelId.startsWith(prefix));
}

export function isVideoModelCandidate(model: VideoModelLike): boolean {
  const id = normalizeModelText(model.id);
  const haystack = `${id} ${normalizeModelText(model.name)} ${normalizeModelText(model.description)}`;

  if (isWanVideoModelId(id) || isLtxVideoModelId(id)) {
    return true;
  }

  return VIDEO_MODEL_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

export function normalizeRequestedVideoFrames(modelId: string, requestedFrames: number): number {
  if (!Number.isFinite(requestedFrames) || !isLtxVideoModelId(modelId)) {
    return requestedFrames;
  }

  return Math.max(
    LTX_MIN_FRAMES,
    Math.round((requestedFrames - 1) / LTX_FRAME_STEP) * LTX_FRAME_STEP + 1,
  );
}
