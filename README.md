# Project Neo Archiver

[日本語](README.ja.md) | **English**

A **Chrome extension** that backs up and archives your Adobe Project Neo
projects locally. Downloaded projects can be re-uploaded as new projects.

> **Unofficial tool** — not affiliated with or endorsed by Adobe.

## Features

- **No Node.js required**: runs entirely as an MV3 extension. Permissions are
  limited to `scripting` + the `projectneo.adobe.com` host only
- **Native authentication**: every Adobe API call runs inside a signed-in
  `projectneo.adobe.com` page. Auth tokens are never held by the extension
  or written to any managed file
- **Local storage**: writes `*.neo.json` / `thumbs/` / `meta.json` (sha256
  and upload history) into a folder you pick via the File System Access API

## Layout

```
├── manifest.json       # Chrome extension manifest (MV3) — repo root is the extension root
├── extension/          # Extension-specific implementation
│   ├── background.js   #   Opens the archiver page on icon click
│   ├── index.html      #   Archiver page (shares UI under public/)
│   ├── ext-shim.mjs    #   fetch('/api/*') shim, thumb/file swap, library-picker UI
│   ├── ext-api.mjs     #   API handlers (runs neoOp in the Neo tab via executeScript)
│   ├── ext-lib.mjs     #   Library management via File System Access
│   └── icons/
├── src/neo-ops.mjs     # In-page operations (neoOp: auth/list/download/thumb/create/uploadThumb/reload)
├── src/util.mjs        # safeName/uniqueName etc.
├── public/             # Shared GUI assets (app.js / ui.css / fonts)
├── tools/pack-extension.sh   # Builds the distribution zip (whitelist of required files)
├── PRIVACY.md          # Privacy policy (for Chrome Web Store submission)
└── test/               # node --test (utils only; behavior is verified on the extension page)
```

## Usage

1. Open `chrome://extensions` and turn on **Developer mode** (top right)
2. **Load unpacked** → select this repository root
3. Click the extension icon in the toolbar → the archiver page opens in a tab
4. Click `Select Local Library Folder` and grant permission to a folder
5. If a signed-in `projectneo.adobe.com` tab exists, it connects automatically
   (otherwise it opens one — sign in there)

### UI

- **Download tab**: remote project list. Select cards or use Download all
- **Upload tab**: local library. Uploads selected files (always creates a NEW
  project; name collisions get an automatic `name (2)` suffix)
- **Auth lamp** (next to the title): green = authenticated, amber = anonymous,
  red = not connected. Click to re-check. State changes are polled and the
  page reloads automatically
- **Detail balloon**: hovering a card shows uuid, owner, dates, sha256 and
  upload history
- **Cancel**: bulk operations can be interrupted from the progress row

## Architecture

```
[Extension page] ──executeScript(world:'MAIN')──→ [neoOp inside Neo page] ←→ [project-neo.adobe.io]
       │ File System Access API                            authenticated fetch
       └→ user-chosen folder (library/ equivalent)
```

- In-page fetch runs inside the browser's auth context, so IMS sign-in and
  token refresh are fully delegated to the native app machinery
- No local server, no CDP, no external processes

## Security design

| Measure | Implementation |
|---|---|
| Minimal permissions | `scripting` + `projectneo.adobe.com` host only (no `debugger`, no all-hosts) |
| Page injection | Only packaged code executes (no remote code; webpack-chunk push limited to once per page to prevent runaway execution) |
| File writes | User-selected folder via File System Access API only; filenames validated against `^[\w.-]+$` |
| Tokens | Stay inside the page; never saved by the extension or written to managed files |
| Anonymous guard | List fetching is refused while `localUser` is unconfirmed (prevents showing the public community list) |

## Notes & prerequisites

- **Adobe Terms of Use 6.2(d)** ("no access to the services except through
  provided interfaces") is the most relevant clause. This tool is designed to
  mitigate that concern by executing inside the page, but use it at your own
  risk
- **No overwrite**: uploads always create a new project (no REST overwrite
  path exists; updating an existing project uses a WebSocket
  `document_update`, which is out of scope)
- **Depends on page internals**: relies on Adobe implementation details such
  as webpack module IDs, so an Adobe deploy may break it
- **Tested on**: Chrome 102+ (macOS and Windows behave mostly the same)
- `library/` is gitignored (contains personal data)

## Distribution

```bash
bash tools/pack-extension.sh     # produces dist/neo-archiver-ext-<version>.zip
```

The zip is built from a whitelist of required files only. For Chrome Web
Store submission, `PRIVACY.md` can be used as the privacy policy document.

## License

[MIT](LICENSE) © 2026 p53*design. The bundled font (`public/fonts/`) is under the
SIL Open Font License 1.1.
