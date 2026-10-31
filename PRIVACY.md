# Privacy Policy — Neo Archiver

Effective date: 2026-10-31

## What this extension does

Neo Archiver is a local backup tool for Adobe Project Neo. It runs on `projectneo.adobe.com`
tabs that **you** are signed in to, and downloads/uploads your own project
documents using the page's own authenticated session.

## Data access

- The extension executes script inside the Project Neo page you open, using the
  browser's native scripting capability (`chrome.scripting`, MAIN world).
- It reads your project list and document data through the page's own API
  calls, under your own signed-in session.
- It accesses an authentication token **in-page only**, transiently, to make
  those API calls. The token is never copied to the extension, never written
  to disk, and never sent anywhere other than to Adobe's own API endpoints.

## Data storage

- Downloaded documents and thumbnails are written only to a **local folder
  that you choose** (File System Access API).
- The extension stores a directory handle and permission state in the
  extension's own IndexedDB storage on your machine.

## Data transmission and collection

- The extension **does not collect, transmit, or share** any user data with
  the developer or any third party.
- All network requests go directly from your browser to Adobe's services.
- There are **no analytics, no tracking, no telemetry, and no remote code**.

## Contact

If you have questions about this policy, please open an issue on the source
repository where this extension is distributed.
