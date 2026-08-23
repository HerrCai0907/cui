import type { AtomicCapabilityType, AtomicDiffReviewItem } from "../../types.js";
import { getNumberProperty, getStringArrayProperty, getStringProperty } from "./jsonFields.js";
import { parseSummaryJson } from "./summaryJson.js";

export function parseAtomicDiffReviewItems(content: string): AtomicDiffReviewItem[] {
  const parsed = parseSummaryJson(content);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Atomic diff review was not valid JSON");
  }

  const rawItems = "items" in parsed ? parsed.items : undefined;

  if (!Array.isArray(rawItems)) {
    throw new Error("Atomic diff review JSON must include items array");
  }

  const items = rawItems.map((item, index) => parseAtomicDiffReviewItem(item, index));
  const validationErrors = validateAtomicDiffReviewItems(items);

  if (validationErrors.length > 0) {
    throw new Error(`Atomic diff review had invalid diff format:\n${validationErrors.join("\n")}`);
  }

  return items;
}

export function validateAtomicDiffReviewItems(items: AtomicDiffReviewItem[]): string[] {
  return items.flatMap((item, index) =>
    validateAtomicDiffReviewItemDiff(item.diff).map(
      (error) => `item ${index + 1} (${item.id}): ${error}`,
    ),
  );
}

function validateAtomicDiffReviewItemDiff(diff: string): string[] {
  const errors: string[] = [];
  const lines = diff.replace(/\r\n?/g, "\n").split("\n");
  const fileHeaderIndexes = lines.reduce<number[]>((indexes, line, index) => {
    if (line.startsWith("diff --git ")) {
      indexes.push(index);
    }

    return indexes;
  }, []);

  if (fileHeaderIndexes.length === 0) {
    return ["diff must include at least one file block starting with `diff --git `"];
  }

  fileHeaderIndexes.forEach((fileHeaderIndex, blockIndex) => {
    const nextFileHeaderIndex = fileHeaderIndexes[blockIndex + 1] ?? lines.length;
    const blockLines = lines.slice(fileHeaderIndex, nextFileHeaderIndex);
    const header = blockLines[0];

    if (!/^diff --git a\/.+ b\/.+$/.test(header)) {
      errors.push(`file block ${blockIndex + 1} has invalid header ${JSON.stringify(header)}`);
    }

    if (!blockLines.some((line) => line.startsWith("--- "))) {
      errors.push(`file block ${blockIndex + 1} is missing a --- file header`);
    }

    if (!blockLines.some((line) => line.startsWith("+++ "))) {
      errors.push(`file block ${blockIndex + 1} is missing a +++ file header`);
    }

    const hunkHeaderIndexes = blockLines.reduce<number[]>((indexes, line, index) => {
      if (line.startsWith("@@")) {
        indexes.push(index);
      }

      return indexes;
    }, []);

    if (hunkHeaderIndexes.length === 0) {
      errors.push(`file block ${blockIndex + 1} is missing a hunk header`);
      return;
    }

    hunkHeaderIndexes.forEach((hunkHeaderIndex, hunkIndex) => {
      const hunkHeader = blockLines[hunkHeaderIndex];

      if (!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(hunkHeader)) {
        errors.push(
          `file block ${blockIndex + 1} hunk ${hunkIndex + 1} has invalid hunk header ${JSON.stringify(hunkHeader)}`,
        );
        return;
      }

      const nextHunkHeaderIndex = hunkHeaderIndexes[hunkIndex + 1] ?? blockLines.length;
      const hunkLines = blockLines.slice(hunkHeaderIndex + 1, nextHunkHeaderIndex);
      const hasChangedLine = hunkLines.some(
        (line) =>
          (line.startsWith("+") && !line.startsWith("+++ ")) ||
          (line.startsWith("-") && !line.startsWith("--- ")),
      );

      if (!hasChangedLine) {
        errors.push(
          `file block ${blockIndex + 1} hunk ${hunkIndex + 1} has no added or removed lines`,
        );
      }
    });
  });

  return errors;
}

function parseAtomicDiffReviewItem(item: unknown, index: number): AtomicDiffReviewItem {
  if (!item || typeof item !== "object") {
    throw new Error(`Atomic diff review item ${index + 1} must be an object`);
  }

  const order = getNumberProperty(item, "order") ?? index + 1;
  const capabilityType = parseCapabilityType(
    getNumberProperty(item, "capabilityType") ?? getNumberProperty(item, "capability_type"),
  );
  const title = requiredStringProperty(item, "title", index);
  const intent = requiredStringProperty(item, "intent", index);
  const diff = requiredStringProperty(item, "diff", index);
  const id = getStringProperty(item, "id")?.trim() || `atomic-${String(order)}`;
  const files = getStringArrayProperty(item, "files");
  const capabilityLabel = capabilityLabelForType(capabilityType);
  const outputJson = normalizeOutputJson(item, {
    id,
    order,
    capabilityType,
    capabilityLabel,
    title,
    intent,
    files,
  });

  return {
    id,
    order,
    capabilityType,
    capabilityLabel,
    title,
    intent,
    files,
    diff,
    outputJson,
  };
}

function normalizeOutputJson(
  item: object,
  fallback: Omit<AtomicDiffReviewItem, "diff" | "outputJson">,
): Record<string, unknown> {
  const outputJson = "outputJson" in item ? item.outputJson : undefined;

  if (outputJson && typeof outputJson === "object" && !Array.isArray(outputJson)) {
    return {
      ...(outputJson as Record<string, unknown>),
      capability_type: fallback.capabilityType,
      capability_label: fallback.capabilityLabel,
    };
  }

  return {
    id: fallback.id,
    order: fallback.order,
    capability_type: fallback.capabilityType,
    capability_label: fallback.capabilityLabel,
    title: fallback.title,
    intent: fallback.intent,
    files: fallback.files,
  };
}

function parseCapabilityType(value: number | undefined): AtomicCapabilityType {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 5) {
    return value;
  }

  throw new Error("Atomic diff review capabilityType must be 0, 1, 2, 3, or 5");
}

function capabilityLabelForType(value: AtomicCapabilityType): string {
  switch (value) {
    case 0:
      return "格式调整";
    case 1:
      return "重构";
    case 2:
      return "新功能";
    case 3:
      return "局部修复";
    case 5:
      return "测试修改";
  }
}

function requiredStringProperty(value: object, key: string, index: number): string {
  const property = getStringProperty(value, key)?.trim();

  if (!property) {
    throw new Error(`Atomic diff review item ${index + 1} must include ${key}`);
  }

  return property;
}
