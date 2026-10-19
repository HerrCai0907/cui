import { rpcRequest } from "../../../shared/api/rpcClient";

export type CodeRangeQuery = {
  filePath: string;
  startLine?: number;
  endLine?: number;
};

export type CodeRangeResult = {
  filePath: string;
  startLine: number;
  endLine: number;
  code: string;
  lines: Array<{
    lineNumber: number;
    content: string;
  }>;
};

export type SourceDefinitionQuery = {
  workspace: string;
  filePath: string;
  line: number;
  character: number;
  language?: "rust";
};

export type SourceDefinitionResult = {
  found: boolean;
  language: string;
  target?: {
    filePath: string;
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  };
};

export type WorkspaceGitInfo = {
  workspace: string;
  gitBranch?: string;
  gitCommitSha?: string;
};

export function getWorkspacePathSuggestions(path: string, signal: AbortSignal) {
  return rpcRequest<{ suggestions: string[] }>(
    "code.workspacePathSuggestions",
    { path },
    { signal },
  );
}

export function getCodeRange(query: CodeRangeQuery): Promise<CodeRangeResult> {
  return rpcRequest<CodeRangeResult>("code.getRange", query);
}

export function getSourceDefinition(query: SourceDefinitionQuery): Promise<SourceDefinitionResult> {
  return rpcRequest<SourceDefinitionResult>("code.getSourceDefinition", query);
}

export function getWorkspaceGitInfo(query: { workspace: string }): Promise<WorkspaceGitInfo> {
  return rpcRequest<WorkspaceGitInfo>("code.workspaceGitInfo", query);
}
