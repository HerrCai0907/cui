import type { ApiAtomicDiffReviewItem } from "../../../types";

export function createAtomicReviewCommentPrompt(input: {
  sessionId: string;
  round: number;
  comments: Array<{
    item: ApiAtomicDiffReviewItem;
    comment: string;
  }>;
}): string {
  const commentBlocks = input.comments.map(({ item, comment }) =>
    [
      `## Atomic review ${item.order}. ${item.title}`,
      "",
      `Capability: ${item.capabilityLabel}`,
      "",
      "Intent:",
      item.intent,
      "",
      "Files:",
      item.files.length > 0 ? item.files.join("\n") : "No files listed.",
      "",
      "Reviewer comment:",
      comment.trim(),
      "",
      "Relevant diff:",
      "```diff",
      item.diff.trim() || "No textual diff available.",
      "```",
    ].join("\n"),
  );

  return [
    "请根据下面这些 atomic review 评论继续修改代码。",
    "",
    "请优先只处理评论涉及的问题；如果需要修改相关代码或测试，请保持范围尽量小。",
    "",
    "Review context:",
    `- Session: ${input.sessionId}`,
    `- Round: ${input.round}`,
    `- Comment count: ${input.comments.length}`,
    "",
    ...commentBlocks,
  ].join("\n");
}
