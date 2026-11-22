# File editor for DeepSeek Harness

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle that adds editing to
the right Sidebar's file preview. The preview itself stays read-only; this plugin adds one control
to its header and a modal editor behind it, so a workspace text file can be changed without leaving
the harness.

![The editor dialog over the app](docs/preview.svg)

## What it adds

- **Edit file** (a pencil) in the document-preview header, next to the open-in-app control. It
  appears only for files the plain-text reader can open — images, PDFs, archives, and Office
  documents get no control.
- A modal editor with a line-numbered source field, `Save`/`Cancel`, the platform save shortcut
  (`⌘S` / `Ctrl+S`), and `⌘]` / `⌘[` to indent or outdent the selected lines. Plain `Tab` keeps
  moving focus so the dialog stays reachable by keyboard.
- Unsaved and saved state in the header, a discard confirmation when closing or reloading with
  pending edits, and conflict handling when the file changed on disk after it was opened
  (**Reload** asks before dropping your buffer; **Overwrite** replaces it deliberately).
- Locale-aware copy (English and Simplified Chinese) and theme tokens only, so light and dark
  follow the harness.

## Install

Install this directory as a plugin bundle in your harness profile:

- **Plugin Manager → Add plugin → local directory**, pointing at a clone of this repo; or
- the harness's `install_bundle` action with the absolute path of this directory.

Installing links the directory, so editing these files and reloading the page picks up changes.
Enabling the bundle adds a **File editor** row under Plugins; disabling it removes the control and
the dialog and leaves every file untouched.

Written against DeepSeek Harness `0.2.2-rc.2` (Desktop and Web).

## How it works

- `index.js` (Host half) registers two authenticated routes on the Connection's shared `/api`
  channel: `POST /api/file-editor/read` and `POST /api/file-editor/write`. Both go through
  `ctx.fs`, so a write passes the same file-sandbox fence as the agent's own tools, and a refusal
  is reported to the dialog instead of being retried with a wider mode.
- Reads report the file's version token, its line-ending style, and whether it starts with a UTF-8
  BOM. Saves carry that version as a `replaceIfVersion` guard: an intervening change by the model
  or another editor comes back as a conflict rather than being overwritten silently.
- The editor works in LF while open and rebuilds the file's stored shape (CRLF, BOM) on save.
- `client.js` (Client half) contributes the header control through
  `sidebar.right.tab.document.actions` and the dialog through `shell.overlay`. It is hand-written
  React using only the browser module table's `react`, with no Harness client package imported.

## Known limits

- Text files up to 4 MiB. Binary files are rejected by the reader, not by the plugin.
- The dialog renders inside the overlay layer rather than a `document.body` portal; in the narrow
  drawer layout a frame mask can paint over it.
- No writable-path pre-check: a path the sandbox refuses is reported when you save, and your buffer
  is kept.
- A save that never answers is bounded at 30 seconds, then reported as a transport failure with
  **Try again**.

## Tests

```sh
npm test        # or: node test/host.test.mjs && node test/client.test.mjs
```

`test/host.test.mjs` drives both routes against a stubbed filesystem (reads, guarded and
unversioned writes, conflicts, sandbox denial, malformed and oversized bodies, EOL/BOM reporting).
`test/client.test.mjs` renders the contributions against a small React test double (slot
registration, binary-file filtering, dirty/save/conflict/discard flows, CRLF round-trip,
localized failures).

There is no browser automation here: neither suite asserts what the running page looks like.
