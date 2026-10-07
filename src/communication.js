(() => {
  const api = window.floadeCommunication
  const strings = {
    'zh-TW': { title: 'AI 通訊', settings: '設定', channels: '聊天室', newChannel: '新增聊天室', thisDevice: '這台裝置', pin: '置頂', close: '關閉', github: '在 GitHub 查看', refresh: '同步', older: '載入更早訊息', empty: '留下訊息，讓其他裝置的 AI 接續工作。', message: '寫下訊息…支援 Markdown', as: '身分', to: '給', everyone: '所有人', shortcut: 'Ctrl+Enter 送出', send: '送出', sending: '送出中…', cancel: '取消', setupHint: '使用已登入的 GitHub 帳號，選擇可寫入的私人儲存庫。', repo: '私人儲存庫', deviceName: '裝置名稱', wakeHint: '這裡負責收發訊息；AI 需要透過本機 API 讀取，不會自動啟動另一台的 AI。', connect: '連線', connecting: '連線中…', channelName: '聊天室名稱', create: '建立', creating: '建立中…', unconfigured: '先連線到私人儲存庫', online: '已同步', syncing: '正在同步…', offline: '離線 · 顯示本機紀錄', pending: '待送', reply: '回覆', replyPrefix: '回覆', unavailable: '請先設定私人儲存庫', failed: '操作失敗，請重試。', queued: '待送訊息會在連線後自動重試', authentication: '請先安裝 GitHub CLI，並以 gh auth login 登入。' },
    en: { title: 'AI communication', settings: 'Settings', channels: 'Channels', newChannel: 'New channel', thisDevice: 'This device', pin: 'Always on top', close: 'Close', github: 'View on GitHub', refresh: 'Sync', older: 'Load earlier messages', empty: 'Leave a message for the AI on your other devices.', message: 'Write a message… Markdown supported', as: 'As', to: 'To', everyone: 'Everyone', shortcut: 'Ctrl+Enter to send', send: 'Send', sending: 'Sending…', cancel: 'Cancel', setupHint: 'Use your signed-in GitHub account and choose a writable private repository.', repo: 'Private repository', deviceName: 'Device name', wakeHint: 'This panel delivers messages. An AI must read through the local API; receiving a message does not automatically start an AI on another device.', connect: 'Connect', connecting: 'Connecting…', channelName: 'Channel name', create: 'Create', creating: 'Creating…', unconfigured: 'Connect a private repository first', online: 'Synced', syncing: 'Syncing…', offline: 'Offline · showing cached messages', pending: 'Pending', reply: 'Reply', replyPrefix: 'Reply to', unavailable: 'Configure a private repository first', failed: 'Operation failed. Please retry.', queued: 'Pending messages retry when connected', authentication: 'Install GitHub CLI and sign in with gh auth login.' }
  }
  const t = key => strings[window.floadeI18n.locale]?.[key] || strings.en[key] || key
  const $ = selector => document.querySelector(selector)
  const stateDialog = $('#configuration')
  const messageList = $('#message-list')
  const messageInput = $('#message')
  const agentInput = $('#agent')
  const targetInput = $('#target')
  const scroll = $('#messages')
  let state
  let channel = null
  let messages = new Map()
  let replyTo = ''
  let draftId = crypto.randomUUID()
  let sending = false
  let revision = 0
  let readCursor = ''
  let draftRepository = null
  let renderedMessages = ''
  const storage = {
    get(key) { try { return localStorage.getItem(key) } catch { return null } },
    set(key, value) { try { localStorage.setItem(key, value) } catch {} }
  }
  agentInput.value = storage.get('floade.communication.agent') || 'User'
  function localize() {
    document.title = `Floade · ${t('title')}`
    for (const element of document.querySelectorAll('[data-text]')) element.textContent = t(element.dataset.text)
    for (const element of document.querySelectorAll('[data-label]')) { element.title = t(element.dataset.label); element.setAttribute('aria-label', element.title) }
    for (const element of document.querySelectorAll('[data-placeholder]')) element.placeholder = t(element.dataset.placeholder)
  }
  localize()
  function draftKey(repo = draftRepository, room = channel) { return `floade.communication.draft.${repo}.${room}` }
  function saveDraft() {
    if (!draftRepository || !channel) return
    storage.set(draftKey(), JSON.stringify({ text: messageInput.value, agent: agentInput.value, target: targetInput.value, replyTo, id: draftId }))
    storage.set('floade.communication.agent', agentInput.value)
  }
  function loadDraft() {
    let draft
    try { draft = JSON.parse(storage.get(draftKey()) || 'null') } catch {}
    messageInput.value = draft?.text || ''
    if (draft?.agent) agentInput.value = draft.agent
    targetInput.value = draft?.target || ''
    replyTo = draft?.replyTo || ''
    draftId = draft?.id || crypto.randomUUID()
    showReply()
  }
  function showReply() {
    $('#reply').hidden = !replyTo
    const message = messages.get(replyTo)
    $('#reply span').textContent = `${t('replyPrefix')} · ${message?.agent || replyTo}: ${message?.text?.slice(0, 100) || ''}`
  }
  const unwrap = response => {
    if (!response?.ok) throw new Error(response?.error?.message || t('failed'))
    return response.result
  }
  function renderMarkdown(content, target) {
    const fragment = DOMPurify.sanitize(marked.parse(content, { gfm: true }), {
      RETURN_DOM_FRAGMENT: true, USE_PROFILES: { html: true }, ALLOW_DATA_ATTR: false,
      FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'video', 'audio', 'img', 'svg', 'math'],
      FORBID_ATTR: ['style', 'class', 'id', 'name', 'srcset']
    })
    for (const input of fragment.querySelectorAll('input')) {
      if (input.type !== 'checkbox') input.remove()
      else input.disabled = true
    }
    for (const link of fragment.querySelectorAll('a')) {
      const href = link.getAttribute('href')
      link.removeAttribute('href')
      try {
        const url = new URL(href)
        if (['https:', 'http:'].includes(url.protocol)) {
          link.dataset.url = url.href
          link.tabIndex = 0
          link.setAttribute('role', 'link')
          const open = () => void api.request('communication.open-link', { url: url.href })
          link.addEventListener('click', open)
          link.addEventListener('keydown', event => { if (event.key === 'Enter') open() })
        }
      } catch {}
    }
    target.replaceChildren(fragment)
  }
  function renderMessages() {
    const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 90
    const previousScroll = scroll.scrollTop
    const previousHeight = scroll.scrollHeight
    const rows = [...messages.values()].sort((a, b) => a.cursor && b.cursor ? Number(a.cursor) - Number(b.cursor) : a.cursor ? -1 : b.cursor ? 1 : a.createdAt.localeCompare(b.createdAt))
    const signature = JSON.stringify([rows, sending, window.floadeI18n.locale])
    if (signature === renderedMessages) return
    renderedMessages = signature
    const fragment = document.createDocumentFragment()
    for (const message of rows) {
      const item = document.createElement('article')
      item.className = `message ${message.status === 'pending' ? 'pending' : ''}`
      item.dataset.messageId = message.id
      const meta = document.createElement('div')
      meta.className = 'message-meta'
      const sender = document.createElement('strong')
      sender.textContent = `${message.deviceName} / ${message.agent}${message.target ? ` → ${message.target}` : ''}`
      sender.title = `GitHub: ${message.author || '—'} · ${message.deviceId}`
      const time = document.createElement('time')
      const date = new Date(message.createdAt)
      time.textContent = `${Number.isFinite(date.getTime()) ? date.toLocaleString(window.floadeI18n.locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}${message.status === 'pending' ? ` · ${t('pending')}` : ''}`
      const reply = document.createElement('button')
      reply.type = 'button'
      reply.textContent = t('reply')
      reply.disabled = sending
      reply.addEventListener('click', () => { replyTo = message.id; draftId = crypto.randomUUID(); showReply(); saveDraft(); messageInput.focus() })
      meta.append(sender, time, reply)
      item.append(meta)
      if (message.replyTo) {
        const reference = messages.get(message.replyTo)
        const quote = document.createElement('div')
        quote.className = 'message-reply'
        quote.textContent = `${t('replyPrefix')} · ${reference?.agent || message.replyTo}${reference ? `: ${reference.text.slice(0, 160)}` : ''}`
        item.append(quote)
      }
      const body = document.createElement('div')
      body.className = 'message-body'
      renderMarkdown(message.text, body)
      item.append(body)
      fragment.append(item)
    }
    messageList.replaceChildren(fragment)
    $('#empty').hidden = rows.length > 0
    scroll.scrollTop = nearBottom ? scroll.scrollHeight : previousScroll + Math.max(0, scroll.scrollHeight - previousHeight)
  }
  function renderState() {
    $('#device-name').textContent = state.identity.deviceName
    $('#repo-name').textContent = state.repo || ''
    $('#room-name').textContent = state.channels.find(item => item.id === channel)?.name || t('title')
    $('#sync-status').textContent = `${t(state.status)}${state.pendingCount ? ` · ${state.pendingCount} ${t('pending')}` : ''}`
    $('#connection-error').hidden = !state.error
    $('#connection-error').textContent = state.error ? `${state.error.message}${state.pendingCount ? ` · ${t('queued')}` : ''}` : ''
    $('#refresh').disabled = state.status === 'syncing' || !state.repo
    $('#new-channel').disabled = !state.repo || sending
    $('#settings').disabled = sending
    $('#github').disabled = !channel
    $('#send').disabled = !channel || sending
    $('#send').textContent = t(sending ? 'sending' : 'send')
    $('#channels').replaceChildren()
    for (const room of state.channels) {
      const button = document.createElement('button')
      button.className = room.id === channel ? 'active' : ''
      button.disabled = sending
      button.setAttribute('aria-current', room.id === channel ? 'true' : 'false')
      const name = document.createElement('span')
      name.textContent = room.name
      button.append(name)
      if (room.unread) { const badge = document.createElement('small'); badge.className = 'badge'; badge.textContent = String(room.unread); button.append(badge) }
      button.addEventListener('click', () => { saveDraft(); channel = room.id; readCursor = ''; messages = new Map(); loadDraft(); void refresh() })
      $('#channels').append(button)
    }
  }
  async function refresh(before) {
    const current = ++revision
    try {
      const next = unwrap(await api.state(channel, before))
      if (current !== revision) return
      const changed = draftRepository !== next.repo || channel !== next.selectedChannel
      if (changed) { saveDraft(); messages = new Map(); readCursor = '' }
      state = next
      channel = next.selectedChannel
      draftRepository = next.repo
      if (changed) loadDraft()
      // Pending rows become delivered rows with the same ID; keep previously
      // loaded history while incorporating server updates.
      for (const message of next.messages) messages.set(message.id, message)
      renderState()
      renderMessages()
      $('#older').hidden = !next.hasOlder
      if (!state.repo && !stateDialog.open) configure()
      if (document.hasFocus() && channel) {
        const latest = [...messages.values()].filter(message => message.cursor).sort((a, b) => Number(a.cursor) - Number(b.cursor)).at(-1)?.cursor
        if (latest && latest !== readCursor) { readCursor = latest; void api.markRead(channel, latest) }
      }
    } catch (error) { $('#connection-error').hidden = false; $('#connection-error').textContent = error.message }
  }
  function configure() {
    if (!state) return
    $('#repo').value = state.repo || ''
    $('#device').value = state.identity.deviceName
    $('#config-error').textContent = ''
    stateDialog.showModal()
    $('#repo').focus()
  }
  $('#settings').addEventListener('click', configure)
  $('#config-cancel').addEventListener('click', () => stateDialog.close())
  $('#config-form').addEventListener('submit', async event => {
    event.preventDefault()
    $('#config-save').disabled = true
    $('#config-cancel').disabled = true
    $('#config-save').textContent = t('connecting')
    try {
      unwrap(await api.request('communication.configure', { repo: $('#repo').value.trim(), deviceName: $('#device').value.trim() }))
      stateDialog.close()
      await refresh()
    } catch (error) { $('#config-error').textContent = error.message }
    finally { $('#config-save').disabled = false; $('#config-cancel').disabled = false; $('#config-save').textContent = t('connect') }
  })
  $('#new-channel').addEventListener('click', () => { $('#channel-name').value = ''; $('#channel-error').textContent = ''; $('#channel-dialog').showModal(); $('#channel-name').focus() })
  $('#channel-cancel').addEventListener('click', () => $('#channel-dialog').close())
  $('#channel-form').addEventListener('submit', async event => {
    event.preventDefault()
    $('#channel-create').disabled = true
    $('#channel-create').textContent = t('creating')
    try {
      const room = unwrap(await api.request('communication.create-channel', { name: $('#channel-name').value.trim() }))
      saveDraft(); channel = room.id; messages = new Map(); readCursor = ''; loadDraft()
      $('#channel-dialog').close()
      await refresh()
    } catch (error) { $('#channel-error').textContent = error.message }
    finally { $('#channel-create').disabled = false; $('#channel-create').textContent = t('create') }
  })
  $('#cancel-reply').addEventListener('click', () => { if (sending) return; replyTo = ''; draftId = crypto.randomUUID(); showReply(); saveDraft() })
  for (const input of [messageInput, agentInput, targetInput]) input.addEventListener('input', () => { draftId = crypto.randomUUID(); saveDraft() })
  $('#composer').addEventListener('submit', async event => {
    event.preventDefault()
    if (sending || !messageInput.value.trim() || !channel) return
    if (!agentInput.value.trim()) { agentInput.focus(); return }
    sending = true
    saveDraft()
    for (const input of [messageInput, agentInput, targetInput]) input.readOnly = true
    $('#cancel-reply').disabled = true
    renderState()
    try {
      unwrap(await api.request('communication.send', { channel, text: messageInput.value, agent: agentInput.value,
        target: targetInput.value, replyTo, id: draftId }))
      messageInput.value = ''; replyTo = ''; draftId = crypto.randomUUID(); showReply(); saveDraft()
    } catch (error) { $('#connection-error').hidden = false; $('#connection-error').textContent = error.message }
    finally {
      sending = false
      for (const input of [messageInput, agentInput, targetInput]) input.readOnly = false
      $('#cancel-reply').disabled = false
      await refresh()
      messageInput.focus()
    }
  })
  messageInput.addEventListener('keydown', event => {
    if (!event.isComposing && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $('#composer').requestSubmit() }
  })
  $('#older').addEventListener('click', () => {
    const first = [...messages.values()].filter(message => message.cursor).sort((a, b) => Number(a.cursor) - Number(b.cursor))[0]
    if (first) void refresh(first.cursor)
  })
  $('#refresh').addEventListener('click', () => void api.sync().then(unwrap).then(() => refresh()).catch(error => { $('#connection-error').hidden = false; $('#connection-error').textContent = error.message }))
  $('#github').addEventListener('click', () => void api.external(channel))
  $('#pin').addEventListener('click', () => void api.pin().then(unwrap).then(value => $('#pin').setAttribute('aria-pressed', String(value))))
  $('#close').addEventListener('click', () => { saveDraft(); void api.close() })
  window.addEventListener('beforeunload', saveDraft)
  window.addEventListener('focus', () => void refresh())
  api.onChange(() => void refresh())
  window.addEventListener('floade-locale-changed', () => { localize(); if (state) { renderState(); renderMessages() } })
  void refresh()
})()
