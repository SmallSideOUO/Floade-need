import { ensureCommitIdentity } from './git-identity.mjs'

const commitMessage = 'chore: sync data'

async function integrateRemote(folderPath, command) {
  const git = args => command('git', args, folderPath)
  // An empty repository has no main yet. Authentication/network errors still fail.
  try { await git(['ls-remote', '--exit-code', 'origin', 'refs/heads/main']) } catch (error) {
    if (error.code === 2) return
    throw error
  }
  await git(['fetch', '--no-tags', 'origin', 'main'])
  const local = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  const remote = (await git(['rev-parse', 'FETCH_HEAD'])).stdout.trim()
  async function ancestor(a, b) {
    try { await git(['merge-base', '--is-ancestor', a, b]); return true } catch (error) {
      if (error.code === 1) return false
      throw error
    }
  }
  if (local === remote || await ancestor(remote, local)) return
  async function unchanged() {
    if ((await git(['rev-parse', 'HEAD'])).stdout.trim() !== local ||
        (await git(['status', '--porcelain', '--untracked-files=all'])).stdout.trim()) {
      throw new Error('Files changed during sync. Retry Push. 同步期間文件有變更，請重試 Push。')
    }
  }
  await unchanged()
  if (await ancestor(local, remote)) {
    await git(['merge', '--ff-only', remote])
    return
  }
  // Compute the merge without touching the index or working files. A conflict
  // leaves both devices' commits intact and never exposes conflict markers.
  let tree
  try { tree = (await git(['merge-tree', '--write-tree', local, remote])).stdout.trim().split(/\r?\n/)[0] } catch (error) {
    if (error.code === 1) throw new Error('Both devices edited the same content. Resolve the conflict before Push; both versions are retained. 兩台裝置修改了相同內容，請先處理衝突再 Push；兩邊版本均已保留。')
    throw error
  }
  await ensureCommitIdentity(folderPath, command)
  const merged = (await git(['commit-tree', tree, '-p', local, '-p', remote, '-m', 'chore: merge device changes'])).stdout.trim()
  await unchanged()
  await git(['merge', '--ff-only', merged])
}

export async function syncFolderToRepository(folderPath, repo, command) {
  await command('gh', ['auth', 'setup-git'], folderPath)
  await command('git', ['init'], folderPath)

  const { stdout: remotes } = await command('git', ['remote'], folderPath)
  const remoteUrl = `https://github.com/${repo}.git`
  if (remotes.split(/\r?\n/).includes('origin')) {
    await command('git', ['remote', 'set-url', 'origin', remoteUrl], folderPath)
  } else {
    await command('git', ['remote', 'add', 'origin', remoteUrl], folderPath)
  }

  await command('git', ['add', '-A'], folderPath)

  let hasStagedChanges = false
  try {
    await command('git', ['diff', '--cached', '--quiet'], folderPath)
  } catch (error) {
    if (error.code === 1) hasStagedChanges = true
    else throw error
  }

  let hasCommit = true
  try {
    await command('git', ['rev-parse', '--verify', 'HEAD'], folderPath)
  } catch {
    hasCommit = false
  }

  if (hasStagedChanges) {
    await ensureCommitIdentity(folderPath, command)
    await command('git', ['commit', '-m', commitMessage], folderPath)
  } else if (!hasCommit) {
    await ensureCommitIdentity(folderPath, command)
    await command('git', ['commit', '--allow-empty', '-m', commitMessage], folderPath)
  }

  await command('git', ['branch', '-M', 'main'], folderPath)
  await integrateRemote(folderPath, command)
  await command('git', ['push', '-u', 'origin', 'main'], folderPath)
}
