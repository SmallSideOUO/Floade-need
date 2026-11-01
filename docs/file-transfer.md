# File transfer

The wide **File transfer** button below the translation buttons opens the floating shelf.
In 0.1.41, use the pin button in the panel header to keep it open while working in Explorer.
The pin setting is remembered. The two translation actions occupy one compact row, with
File transfer spanning their combined width immediately below them.
Drop one or more local files or folders onto the button or shelf. Floade registers their paths;
the originals stay in place and no file contents are sent at this stage.

On the receiving computer, select the source device and refresh its shelf. Select multiple
items using their checkboxes, then drag an item from that selection into an open Explorer
folder. Windows receives virtual files; their contents are downloaded only when Explorer
requests the dropped streams. Partial data stays resumable after a pause or Floade restart.

Both computers need Floade 0.1.40 or later running. Save the source device with its permanent
password in Remote settings first. The shelf uses that existing protected credential to open
an authenticated, encrypted, direct-only P2P tunnel. The file service listens on loopback port
52961, never a public network interface. It serves only explicitly offered files.

Saved-password origin-key metadata stays DPAPI protected. When available, it allows the same
Windows account to read an existing credential after switching between a regular desktop
launch and an MSIX-hosted launch without copying Chromium Local State or revealing passwords.
`remote.credentials.check` reports readability only, retains validated protected origin-key
metadata, and does not connect to the peer. The native control endpoint is also published
under `%USERPROFILE%/.floade/remote` so both launch contexts can reach the same running engine.

Choose **Pause** to retain progress or **Resume** to continue. If a dropped copy was cancelled,
drag the same source item again: its verified partial data is reused. Source changes stop the
old job; add the changed file as a new offer. Removing an offer never deletes its source.
Received blocks and completed files are verified with SHA-256 before Explorer reads them.
Existing destination files are handled by Explorer; the local API preserves them using a new
name. Interrupted copies retain a local partial cache until completed or explicitly removed.

## Local AI API

Discover methods with `api.describe`. All paths are local to the computer receiving the API
call; remote files use offer IDs rather than arbitrary remote disk paths.

- `transfers.offer { paths: [absolutePath, ...] }`: register files/folders without uploading.
- `transfers.list {}`: local offers, remembered peer catalogs, and durable job states.
- `transfers.refresh { deviceId }`: refresh peer metadata without downloading file contents.
- `transfers.receive { deviceId, offerIds, destination }`: receive into an existing local folder.
- `transfers.pause { jobId }` / `transfers.resume { jobId }`: retain/reuse verified blocks.
- `transfers.remove { offerId }` or `{ jobId }`: remove an own offer or discard a job/cache.

`transfers.receive` can outlive a local API request's timeout for a large transfer. Inspect
`transfers.list` before retrying; a timeout is not a cancellation. Software-specific project
discovery, saved-state boundaries, exports, path mapping and imports remain with the calling
AI and the application's existing APIs. Private Live2D code is not included in Floade.

In 0.1.42, retrying a failed shelf connection closes the native mapping and session without
waiting indefinitely for the bridge event subscription to cancel. This only changes the
background shelf cleanup path; desktop sessions and incoming permissions are unchanged.
