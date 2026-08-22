import type {
  ApiAtomicDiffReview,
  ApiAtomicDiffReviewItem,
} from '../../../types';
import { parseDiff, type DiffFile } from './diffParser';
import {
  createEmptyAtomicItemState,
  type ReviewBrowserState,
} from './reviewBrowserState';

export type ReviewNavigationFile = {
  id: string;
  path: string;
  label: string;
  targetId: string;
  additions: number;
  deletions: number;
};

export type ReviewNavigationStatusGroup = {
  status: 'approved' | 'pending';
  label: string;
  files: ReviewNavigationFile[];
};

export type ReviewNavigationItem = {
  itemId: string;
  order: number;
  title: string;
  targetId: string;
  statusGroups: ReviewNavigationStatusGroup[];
};

export type ReviewNavigation = {
  items: ReviewNavigationItem[];
};

export type ReviewNavigationTarget = {
  targetId: string;
  itemId?: string;
};

export function createAtomicReviewNavigation(
  review: ApiAtomicDiffReview | undefined,
  reviewState: ReviewBrowserState,
): ReviewNavigation | null {
  if (!review || review.status !== 'ready') {
    return null;
  }

  const sortedItems = [...review.items].sort(compareAtomicReviewItems);
  const filesByItem = new Map<string, DiffFile[]>();
  const basenameCounts = new Map<string, number>();

  sortedItems.forEach((item) => {
    const files = parseDiff(item.diff).sort(compareDiffFiles);

    filesByItem.set(item.id, files);
    files.forEach((file) => {
      const basename = getFileBasename(file.path);

      basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
    });
  });

  return {
    items: sortedItems.map((item) => {
      const itemState =
        reviewState.atomicItems[item.id] ?? createEmptyAtomicItemState();
      const approvedFileIds = new Set(itemState.approvedFileIds);
      const files = filesByItem.get(item.id) ?? [];
      const approved: ReviewNavigationFile[] = [];
      const pending: ReviewNavigationFile[] = [];

      files.forEach((file) => {
        const navFile = createNavigationFile(item, file, basenameCounts);

        if (approvedFileIds.has(file.id)) {
          approved.push(navFile);
        } else {
          pending.push(navFile);
        }
      });

      return {
        itemId: item.id,
        order: item.order,
        title: item.title,
        targetId: createAtomicReviewSectionId(item.id),
        statusGroups: [
          { status: 'approved', label: 'approved', files: approved },
          { status: 'pending', label: 'pending', files: pending },
        ],
      };
    }),
  };
}

export function createAtomicReviewSectionId(itemId: string): string {
  return createReviewAnchorId('atomic-review', itemId);
}

export function createAtomicReviewFileSectionId(
  itemId: string,
  fileId: string,
): string {
  return createReviewAnchorId('atomic-review-file', itemId, fileId);
}

function createNavigationFile(
  item: ApiAtomicDiffReviewItem,
  file: DiffFile,
  basenameCounts: Map<string, number>,
): ReviewNavigationFile {
  const basename = getFileBasename(file.path);

  return {
    id: file.id,
    path: file.path,
    label:
      (basenameCounts.get(basename) ?? 0) > 1 ? file.path : basename,
    targetId: createAtomicReviewFileSectionId(item.id, file.id),
    additions: file.additions,
    deletions: file.deletions,
  };
}

function compareAtomicReviewItems(
  left: ApiAtomicDiffReviewItem,
  right: ApiAtomicDiffReviewItem,
): number {
  return (
    left.order - right.order ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function compareDiffFiles(left: DiffFile, right: DiffFile): number {
  return left.path.localeCompare(right.path);
}

function createReviewAnchorId(prefix: string, ...parts: string[]): string {
  return [prefix, ...parts.map(encodeAnchorPart)].join('-');
}

function encodeAnchorPart(value: string): string {
  return encodeURIComponent(value).replace(/%/g, '_');
}

function getFileBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
