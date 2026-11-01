(() => {
  if (new URLSearchParams(location.search).get('mode') === 'ball') return
  const pane = document.querySelector('#transfer-pane')
  const panel = document.querySelector('#panel')
  const button = document.querySelector('#file-transfer')
  const device = document.querySelector('#transfer-device')
  const status = document.querySelector('#transfer-status')
  const offers = document.querySelector('#transfer-offers')
  const jobs = document.querySelector('#transfer-jobs')
  const drop = document.querySelector('#transfer-drop')
  const selected = new Set()
  let state = { offers: [], peers: {}, jobs: [] }
  let refreshing = false
  let lastRefresh = 0
  const english = new URLSearchParams(location.search).get('lang') === 'en'
  const text = (zh, en) => english ? en : zh
  const bytes = size => size >= 1073741824 ? `${(size / 1073741824).toFixed(1)} GB` : size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`
  const labels = { queued: text('待接收', 'Queued'), receiving: text('傳輸中', 'Receiving'), waiting: text('等待來源上線', 'Waiting for source'), paused: text('已暫停，可續傳', 'Paused; resumable'), verifying: text('正在校驗', 'Verifying'), ready: text('已收齊，等待放入資料夾', 'Ready for Explorer'), delivered: text('已完成', 'Completed'), error: text('需要處理', 'Needs attention'), cancelled: text('已取消', 'Cancelled') }
  if (english) {
    document.querySelector('label[for="transfer-device"]').textContent = 'Source'
    device.options[0].textContent = 'This computer'
    document.querySelector('#transfer-refresh').textContent = 'Refresh'
    drop.textContent = 'Drop files or folders here. Multiple files supported; originals stay on this computer.'
    document.querySelector('.transfer-hint').textContent = 'Open a destination folder, then drag files from this list into it.'
  }
  function message(value, error = false) { status.textContent = value; status.classList.toggle('error', error) }
  async function call(method, params = {}) {
    const result = await window.floadeLauncher.transfer(method, params)
    if (!result?.ok) throw new Error(result?.message || text('無法完成操作', 'Transfer operation failed'))
    return result.result
  }
  function show(value) {
    pane.hidden = !value
    panel.classList.toggle('transfer-mode', value)
    button.setAttribute('aria-expanded', String(value))
    if (value) void refresh()
  }
  async function refresh() {
    if (refreshing) return
    refreshing = true
    try {
      const settings = await call('devices')
      const previous = device.value
      while (device.options.length > 1) device.remove(1)
      for (const peer of settings.devices) { const option = document.createElement('option'); option.value = peer.deviceId; option.textContent = peer.alias || peer.deviceId; device.append(option) }
      if ([...device.options].some(option => option.value === previous)) device.value = previous
      if (device.value !== 'local') {
        message(text('正在讀取來源清單…', 'Reading source shelf…'))
        await call('transfers.refresh', { deviceId: device.value })
      }
      state = await call('transfers.list')
      message(device.value === 'local' ? text('清單只記錄來源位置，拖出後才傳輸。', 'Only source paths are registered. Transfer starts when dropped.') : text('勾選多個檔案，再一起拖進目標資料夾。', 'Select multiple items, then drag them into your destination folder.'))
      render()
      lastRefresh = Date.now()
    } catch (error) { message(error.message, true) }
    finally { refreshing = false }
  }
  function render() {
    offers.replaceChildren()
    const items = device.value === 'local' ? state.offers : state.peers[device.value]?.offers || []
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'transfer-offer'; row.draggable = true; row.dataset.offerId = item.id; row.setAttribute('role', 'listitem')
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.has(item.id); check.setAttribute('aria-label', item.name)
      check.onchange = () => { if (check.checked) selected.add(item.id); else selected.delete(item.id) }
      const name = document.createElement('span'); name.className = 'transfer-name'; name.textContent = item.name; name.title = item.name
      const size = document.createElement('small'); size.textContent = bytes(item.size)
      row.append(check, name, size)
      if (device.value === 'local') {
        const remove = document.createElement('button'); remove.className = 'transfer-remove'; remove.textContent = '×'; remove.title = text('從清單移除，保留原始檔', 'Remove from shelf; keep original')
        remove.onclick = async () => { try { state = await call('transfers.remove', { offerId: item.id }); render() } catch (error) { message(error.message, true) } }
        row.append(remove)
      }
      row.addEventListener('dragstart', event => {
        event.preventDefault()
        const ids = selected.has(item.id) ? items.filter(o => selected.has(o.id)).map(o => o.id) : [item.id]
        window.floadeLauncher.dragFiles(device.value, ids)
      })
      offers.append(row)
    }
    jobs.replaceChildren()
    for (const job of state.jobs.slice().reverse().slice(0, 30)) {
      const row = document.createElement('div'); row.className = 'transfer-job'
      const title = document.createElement('strong'); title.textContent = job.name
      const progress = document.createElement('progress'); progress.max = Math.max(1, job.size); progress.value = job.bytes
      const controls = document.createElement('div'); controls.className = 'transfer-controls'
      const label = document.createElement('span'); label.textContent = `${labels[job.status] || job.status} · ${bytes(job.bytes)} / ${bytes(job.size)}`; label.title = job.error || ''
      controls.append(label)
      if (!['delivered', 'cancelled'].includes(job.status)) {
        const paused = ['paused', 'error', 'queued'].includes(job.status)
        const action = document.createElement('button'); action.textContent = paused ? text('續傳', 'Resume') : text('暫停', 'Pause')
        action.onclick = async () => { try { state = await call(paused ? 'transfers.resume' : 'transfers.pause', { jobId: job.id }); render() } catch (error) { message(error.message, true) } }
        controls.append(action)
      }
      const remove = document.createElement('button'); remove.textContent = '×'; remove.title = text('移除任務與暫存', 'Discard task and partial data')
      remove.onclick = async () => { try { state = await call('transfers.remove', { jobId: job.id }); render() } catch (error) { message(error.message, true) } }
      controls.append(remove); row.append(title, progress, controls); jobs.append(row)
    }
  }
  button.addEventListener('click', () => show(pane.hidden))
  document.querySelector('#transfer-refresh').onclick = () => void refresh()
  device.onchange = () => { selected.clear(); void refresh() }
  async function add(event) {
    event.preventDefault(); button.classList.remove('drag-over'); drop.classList.remove('drag-over')
    const files = [...event.dataTransfer.files]
    if (!files.length) return
    show(true); device.value = 'local'
    try { const result = await window.floadeLauncher.offerFiles(files); if (!result?.ok) throw new Error(result?.message); state = await call('transfers.list'); render(); message(text(`已加入 ${files.length} 個項目。`, `Added ${files.length} items.`)) } catch (error) { message(error.message, true) }
  }
  for (const target of [button, drop]) {
    target.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; target.classList.add('drag-over') } })
    target.addEventListener('dragleave', () => target.classList.remove('drag-over'))
    target.addEventListener('drop', event => void add(event))
  }
  window.floadeLauncher.onTransfers(data => { state = data; if (!pane.hidden) render() })
  setInterval(() => { if (!pane.hidden && document.visibilityState === 'visible' && Date.now() - lastRefresh > 10000 && device.value !== 'local') void refresh() }, 3000)
})()
