import { ensureCommitIdentity } from './git-identity.mjs'

const commitMessage = 'chore: sync data'

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
  await command('git', ['push', '-u', 'origin', 'main'], folderPath)
}
