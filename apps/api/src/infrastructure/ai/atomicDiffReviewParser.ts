import type {
  AtomicCapabilityType,
  AtomicDiffReviewItem,
} from '../../types.js';
import {
  getNumberProperty,
  getStringArrayProperty,
  getStringProperty,
} from './jsonFields.js';
import { parseSummaryJson } from './summaryJson.js';

export function parseAtomicDiffReviewItems(
  content: string,
): AtomicDiffReviewItem[] {
  const parsed = parseSummaryJson(content);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Atomic diff review was not valid JSON');
  }

  const rawItems = 'items' in parsed ? parsed.items : undefined;

  if (!Array.isArray(rawItems)) {
    throw new Error('Atomic diff review JSON must include items array');
  }

  return rawItems.map((item, index) => parseAtomicDiffReviewItem(item, index));
}

function parseAtomicDiffReviewItem(
  item: unknown,
  index: number,
): AtomicDiffReviewItem {
  if (!item || typeof item !== 'object') {
    throw new Error(`Atomic diff review item ${index + 1} must be an object`);
  }

  const order = getNumberProperty(item, 'order') ?? index + 1;
  const capabilityType = parseCapabilityType(
    getNumberProperty(item, 'capabilityType') ??
      getNumberProperty(item, 'capability_type'),
  );
  const title = requiredStringProperty(item, 'title', index);
  const intent = requiredStringProperty(item, 'intent', index);
  const diff = requiredStringProperty(item, 'diff', index);
  const id =
    getStringProperty(item, 'id')?.trim() || `atomic-${String(order)}`;
  const files = getStringArrayProperty(item, 'files');
  const capabilityLabel =
    getStringProperty(item, 'capabilityLabel')?.trim() ||
    getStringProperty(item, 'capability_label')?.trim() ||
    capabilityLabelForType(capabilityType);
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
  fallback: Omit<AtomicDiffReviewItem, 'diff' | 'outputJson'>,
): Record<string, unknown> {
  const outputJson = 'outputJson' in item ? item.outputJson : undefined;

  if (
    outputJson &&
    typeof outputJson === 'object' &&
    !Array.isArray(outputJson)
  ) {
    return outputJson as Record<string, unknown>;
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
  if (
    value === 0 ||
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === 4 ||
    value === 5
  ) {
    return value;
  }

  throw new Error(
    'Atomic diff review capabilityType must be 0, 1, 2, 3, 4, or 5',
  );
}

function capabilityLabelForType(value: AtomicCapabilityType): string {
  switch (value) {
    case 0:
      return '格式调整';
    case 1:
      return '重构';
    case 2:
      return '新功能';
    case 3:
      return '单点修改';
    case 4:
      return '多点调整';
    case 5:
      return '测试修改';
  }
}

function requiredStringProperty(
  value: object,
  key: string,
  index: number,
): string {
  const property = getStringProperty(value, key)?.trim();

  if (!property) {
    throw new Error(`Atomic diff review item ${index + 1} must include ${key}`);
  }

  return property;
}
