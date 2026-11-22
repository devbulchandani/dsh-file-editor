/**
 * Host half of the file editor bundle.
 *
 * The Sidebar's document preview is a read-only viewer, so the browser needs a
 * write path of its own. This plugin mounts two authenticated exact routes on
 * the shared `/api` Fetch channel that the Connection carrier already guards:
 *
 * - `POST /api/file-editor/read`  — one bounded UTF-8 read plus the freshness
 *   token used to guard the following save;
 * - `POST /api/file-editor/write` — a full-file write guarded by that token.
 *
 * Both go through `ctx.fs`, so the deployment's filesystem backend keeps its
 * own authority: reads use its read authority, and writes pass the same
 * per-call sandbox fence as every model-facing mutation (`workspace-write`
 * confinements included). A refused write is reported to the dialog as a
 * denial, never silently retried with a wider mode.
 *
 * The routes carry no model-facing surface: no tool, prompt section, or
 * session event is registered here.
 *
 * @module @local/dsh-file-editor
 */

/** Required Host services: the shared Fetch channel and the filesystem seam. */
export const inject = ['connection', 'fs']

/** Authenticated read route below the shared `/api` channel. */
const READ_PATH = '/api/file-editor/read'

/** Authenticated guarded-write route below the shared `/api` channel. */
const WRITE_PATH = '/api/file-editor/write'

/** Largest file the dialog may load, in bytes (4 MiB of UTF-8 text). */
const MAX_READ_BYTES = 4 * 1024 * 1024

/**
 * Largest replacement the dialog may send, in characters. The read cap bounds
 * the dialog itself; this is the route's own guard against a caller that does
 * not go through it.
 */
const MAX_WRITE_CHARS = 8 * 1024 * 1024

/**
 * Build one JSON response for the dialog.
 * @param value - JSON-serializable business result.
 * @param status - HTTP status, 200 unless the request itself was malformed.
 * @returns a `no-store` JSON response.
 */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * Read one JSON request body without trusting its shape.
 * @param request - authenticated request from the Connection carrier.
 * @returns the parsed object, or `undefined` for a malformed body.
 */
async function bodyOf(request) {
  try {
    const value = await request.json()
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Stable failure code of a filesystem error.
 * @param error - anything thrown by `ctx.fs`.
 * @param fallback - code reported when the error carries none.
 * @returns the filesystem code, or the fallback.
 */
function codeOf(error, fallback) {
  const code = typeof error === 'object' && error !== null ? error.code : undefined
  return typeof code === 'string' && code !== '' ? code : fallback
}

/**
 * Human-readable failure message.
 * @param error - anything thrown by `ctx.fs`.
 * @returns the error's message, or its string form.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Format a byte count for a user-facing limit message.
 * @param bytes - size in bytes.
 * @returns a short binary-prefix size.
 */
function humanBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MiB`
}

/**
 * Requesting path from a decoded body, trimmed, or an empty string.
 * @param body - parsed request body.
 * @returns the path the dialog asked for.
 */
function pathOf(body) {
  return typeof body?.path === 'string' ? body.path.trim() : ''
}

/**
 * Whether a UTF-8 file starts with a byte-order mark. The text reader decodes
 * with a BOM-stripping decoder, so the bytes are the only place that says so.
 * @param ctx - plugin context carrying the filesystem service.
 * @param target - resolved file target.
 * @returns true when the first three bytes are `EF BB BF`.
 */
async function hasByteOrderMark(ctx, target) {
  try {
    const head = await ctx.fs.readByteRange(target, { offset: 0, length: 3 })
    return head.length === 3 && head[0] === 0xEF && head[1] === 0xBB && head[2] === 0xBF
  } catch {
    return false
  }
}

/**
 * Read one text file for the editor.
 * @param ctx - plugin context carrying the filesystem service.
 * @param request - authenticated POST request.
 * @returns `{ ok: true, text, version, path, size }` or a coded failure.
 */
async function readFile(ctx, request) {
  const body = await bodyOf(request)
  const path = pathOf(body)
  if (path === '') {
    return json({ ok: false, code: 'bad-request', message: 'A file path is required.' }, 400)
  }
  try {
    const target = await ctx.fs.resolve(path)
    const info = await ctx.fs.stat(target)
    if (info === undefined) {
      return json({ ok: false, code: 'missing', message: `"${target.displayPath}" does not exist.` })
    }
    if (info.type !== 'file') {
      return json({ ok: false, code: 'not-file', message: `"${target.displayPath}" is not a regular file.` })
    }
    if (info.size !== undefined && info.size > MAX_READ_BYTES) {
      return json({
        ok: false,
        code: 'too-large',
        message: `Only files up to ${humanBytes(MAX_READ_BYTES)} can be edited here.`,
      })
    }
    const text = await ctx.fs.readText(target)
    return json({
      ok: true,
      path: target.displayPath,
      text,
      version: info.version,
      size: info.size ?? null,
      // The editor normalizes to LF while it is open and rebuilds the file's own
      // shape on save, so the read reports what that shape was.
      eol: text.includes('\r\n') ? 'crlf' : 'lf',
      bom: await hasByteOrderMark(ctx, target),
    })
  } catch (error) {
    return json({ ok: false, code: codeOf(error, 'read-failed'), message: messageOf(error) })
  }
}

/**
 * Save one full-file replacement for the editor.
 *
 * A `version` from the read guards the write: any intervening change on disk,
 * by the model or another editor, is refused as a conflict instead of being
 * overwritten silently. Omitting the version is the dialog's explicit
 * overwrite choice.
 *
 * @param ctx - plugin context carrying the filesystem service.
 * @param request - authenticated POST request.
 * @returns `{ ok: true, version, path, operation }` or a coded failure.
 */
async function writeFile(ctx, request) {
  const body = await bodyOf(request)
  const path = pathOf(body)
  if (path === '') {
    return json({ ok: false, code: 'bad-request', message: 'A file path is required.' }, 400)
  }
  if (typeof body?.text !== 'string') {
    return json({ ok: false, code: 'bad-request', message: 'The new file content is required.' }, 400)
  }
  if (body.text.length > MAX_WRITE_CHARS) {
    return json({ ok: false, code: 'too-large', message: 'The new file content is too large to save here.' }, 413)
  }
  const version = typeof body.version === 'string' && body.version !== '' ? body.version : undefined
  try {
    const target = await ctx.fs.resolve(path)
    const outcome = await ctx.fs.writeText(
      target,
      body.text,
      version === undefined ? undefined : { kind: 'replaceIfVersion', version },
    )
    return json({
      ok: true,
      path: target.displayPath,
      version: outcome.version,
      operation: outcome.operation,
    })
  } catch (error) {
    const code = codeOf(error, 'write-failed')
    if (code === 'FS_STALE_VERSION' || code === 'FS_NOT_OBSERVED') {
      return json({
        ok: false,
        code: 'conflict',
        message: `"${path}" changed on disk after it was opened here.`,
      })
    }
    if (code === 'FS_SANDBOX_DENIED') {
      return json({ ok: false, code: 'denied', message: messageOf(error) })
    }
    return json({ ok: false, code, message: messageOf(error) })
  }
}

/**
 * Mount the editor's read and write routes.
 * @param ctx - plugin context; both registrations are effects of this context.
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: READ_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => readFile(ctx, request),
    }),
    'file-editor: read route',
  )
  ctx.effect(
    () => ctx.connection.fetch.register({
      path: WRITE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => writeFile(ctx, request),
    }),
    'file-editor: write route',
  )
}
