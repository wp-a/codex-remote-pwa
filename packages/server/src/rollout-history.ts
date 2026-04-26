import { existsSync, readFileSync } from "node:fs";

export type ImportedTranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  ts: string;
};

type RolloutLine = {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  };
};

export function loadRolloutHistory(
  rolloutPath: string,
  options?: { limit?: number },
): ImportedTranscriptEntry[] {
  if (!rolloutPath || !existsSync(rolloutPath)) {
    return [];
  }

  const limit = Math.max(1, options?.limit ?? 120);
  const entries: ImportedTranscriptEntry[] = [];
  const lines = readFileSync(rolloutPath, "utf8").split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parsed = safeParse(trimmed);
    if (!parsed) {
      continue;
    }

    if (
      parsed.type !== "response_item" ||
      parsed.payload?.type !== "message" ||
      (parsed.payload.role !== "user" && parsed.payload.role !== "assistant")
    ) {
      continue;
    }

    const text = extractMessageText(parsed);
    if (!text || shouldSkipUserMessage(parsed.payload.role, text)) {
      continue;
    }

    entries.push({
      role: parsed.payload.role,
      text,
      ts: parsed.timestamp ?? new Date().toISOString(),
    });
  }

  return entries.slice(-limit);
}

function safeParse(line: string): RolloutLine | null {
  try {
    return JSON.parse(line) as RolloutLine;
  } catch {
    return null;
  }
}

function extractMessageText(line: RolloutLine): string | null {
  const content = line.payload?.content ?? [];
  const fragments = content
    .map((item) => item.text?.trim() ?? "")
    .filter(Boolean);

  if (fragments.length === 0) {
    return null;
  }

  return fragments.join("\n\n");
}

function shouldSkipUserMessage(role: "user" | "assistant", text: string): boolean {
  if (role !== "user") {
    return false;
  }

  return text.startsWith("<environment_context>");
}
