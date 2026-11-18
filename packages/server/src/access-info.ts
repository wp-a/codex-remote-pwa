import {
  accessCandidateSchema,
  type AccessCandidate,
} from "@codex-remote/shared";

const MAX_ACCESS_CANDIDATES = 8;

export function parseAccessCandidates(raw: string | undefined): AccessCandidate[] {
  if (!raw) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const candidates: AccessCandidate[] = [];
  const seenUrls = new Set<string>();

  for (const value of parsed) {
    const result = accessCandidateSchema.safeParse(value);
    if (!result.success || seenUrls.has(result.data.url)) {
      continue;
    }

    seenUrls.add(result.data.url);
    candidates.push(result.data);
    if (candidates.length === MAX_ACCESS_CANDIDATES) {
      break;
    }
  }

  return candidates;
}
