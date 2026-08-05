const params = new URLSearchParams(window.location.search)
const toast = document.querySelector('#toast')
const title = document.querySelector('#title')
const message = document.querySelector('#message')
const progress = document.querySelector('#progress')

toast.classList.add(params.get('type') ?? 'success')
title.textContent = params.get('title') ?? ''
message.textContent = params.get('message') ?? ''
progress.style.setProperty('--duration', `${params.get('duration') ?? '2500'}ms`)
