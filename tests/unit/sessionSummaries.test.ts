import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupWorkspacesForDisplay,
  type WorkspaceDisplayGroup,
} from '../../apps/web/src/features/sessions/model/sessionSummaries.js';

test('groupWorkspacesForDisplay merges shared path prefixes', () => {
  assert.deepEqual(
    stripSessions(
      groupWorkspacesForDisplay({
        '/Users/bytedance/cui': [],
        '/Users/bytedance/oss/go': [],
      }),
    ),
    [
      {
        id: 'prefix:/:Users/bytedance',
        prefix: '/Users/bytedance',
        workspaces: [
          {
            workspace: '/Users/bytedance/cui',
            label: 'cui',
          },
          {
            workspace: '/Users/bytedance/oss/go',
            label: 'oss/go',
          },
        ],
      },
    ],
  );
});

test('groupWorkspacesForDisplay leaves unrelated single workspace labels complete', () => {
  assert.deepEqual(
    stripSessions(
      groupWorkspacesForDisplay({
        '/Users/bytedance/cui': [],
        '/Users/bytedance/oss/go': [],
        '/tmp/project': [],
      }),
    ),
    [
      {
        id: 'prefix:/:Users/bytedance',
        prefix: '/Users/bytedance',
        workspaces: [
          {
            workspace: '/Users/bytedance/cui',
            label: 'cui',
          },
          {
            workspace: '/Users/bytedance/oss/go',
            label: 'oss/go',
          },
        ],
      },
      {
        id: '/tmp/project',
        workspaces: [
          {
            workspace: '/tmp/project',
            label: '/tmp/project',
          },
        ],
      },
    ],
  );
});

function stripSessions(groups: WorkspaceDisplayGroup[]) {
  return groups.map((group) => ({
    id: group.id,
    ...(group.prefix ? { prefix: group.prefix } : {}),
    workspaces: group.workspaces.map((workspace) => ({
      workspace: workspace.workspace,
      label: workspace.label,
    })),
  }));
}
