export async function ensureCommitIdentity(folderPath, command) {
  async function configured(key) {
    try {
      const { stdout } = await command('git', ['config', '--get', key], folderPath)
      return stdout.trim()
    } catch (error) {
      if (error.code === 1) return ''
      throw error
    }
  }

  const name = await configured('user.name')
  const email = await configured('user.email')
  if (name && email) return

  const { stdout } = await command('gh', ['api', 'user', '--jq', '{id,login,name}'], folderPath)
  const account = JSON.parse(stdout)
  if (!Number.isInteger(account.id) || !/^[A-Za-z0-9-]+$/.test(account.login)) {
    throw new Error('GitHub did not return a usable commit identity.')
  }

  if (!name) {
    const accountName = String(account.name ?? '').trim() || account.login
    await command('git', ['config', '--local', 'user.name', accountName], folderPath)
  }
  if (!email) {
    await command('git', ['config', '--local', 'user.email', `${account.id}+${account.login}@users.noreply.github.com`], folderPath)
  }
}
