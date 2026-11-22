import { apply } from '../index.js'

const routes = new Map()
const files = new Map([
  ['/w/a.txt', { text: 'alpha\nbeta\n', version: 'v1' }],
  ['/w/big.txt', { text: 'x'.repeat(10), version: 'v9', size: 5 * 1024 * 1024 }],
  ['/w/crlf.txt', { text: 'one\r\ntwo\r\n', version: 'c1' }],
  ['/w/bom.txt', { text: 'hello\n', version: 'b1', bom: true }],
])

function fsError(code, message) {
  return Object.assign(new Error(message ?? code), { code })
}

const ctx = {
  effect(fn) { fn() },
  connection: { fetch: { register(route) { routes.set(route.path, route); return async () => {} } } },
  fs: {
    async resolve(path) {
      if (path === '/w/boom.txt') throw fsError('FS_PERMISSION_DENIED', 'permission denied')
      return { targetKey: path, displayPath: path }
    },
    async stat(target) {
      const entry = files.get(target.displayPath)
      if (entry === undefined) return undefined
      return { version: entry.version, type: target.displayPath.endsWith('/dir') ? 'directory' : 'file', size: entry.size ?? Buffer.byteLength(entry.text) }
    },
    async readByteRange(target, range) {
      const entry = files.get(target.displayPath)
      if (entry === undefined) throw fsError('FS_NOT_FOUND')
      if (entry.bom === true) return Uint8Array.from([0xEF, 0xBB, 0xBF])
      return Uint8Array.from(Buffer.from(entry.text).subarray(range.offset, range.offset + range.length))
    },
    async readText(target) {
      const entry = files.get(target.displayPath)
      if (entry === undefined) throw fsError('FS_NOT_FOUND')
      return entry.text
    },
    async writeText(target, text, intent) {
      const entry = files.get(target.displayPath)
      if (target.displayPath === '/w/locked.txt') throw fsError('FS_SANDBOX_DENIED', 'cannot write "/w/locked.txt": file access denied under workspace-write mode')
      if (intent?.kind === 'replaceIfVersion') {
        if (entry === undefined) throw fsError('FS_NOT_OBSERVED')
        if (entry.version !== intent.version) throw fsError('FS_STALE_VERSION')
      }
      const version = 'v' + (Math.random().toString(36).slice(2, 8))
      files.set(target.displayPath, { text, version })
      return { operation: entry === undefined ? 'create' : 'update', version, before: entry?.text ?? null, after: text }
    },
  },
}

apply(ctx)

const read = routes.get('/api/file-editor/read')
const write = routes.get('/api/file-editor/write')
if (read === undefined || write === undefined) throw new Error('routes not registered: ' + [...routes.keys()])

const call = async (route, body) => {
  const response = await route.fetch(new Request('http://h' + route.path, { method: 'POST', body: JSON.stringify(body) }))
  return { status: response.status, body: await response.json() }
}

let failures = 0
const check = (name, ok, detail) => {
  if (ok) console.log('PASS', name)
  else { failures += 1; console.log('FAIL', name, JSON.stringify(detail)) }
}

const ok = await call(read, { path: '/w/a.txt' })
check('read returns text and version', ok.status === 200 && ok.body.ok === true && ok.body.text === 'alpha\nbeta\n' && ok.body.version === 'v1', ok)

const missing = await call(read, { path: '/w/ghost.txt' })
check('missing file is coded', missing.body.ok === false && missing.body.code === 'missing', missing)

const crlf = await call(read, { path: '/w/crlf.txt' })
check('CRLF style is reported', crlf.body.ok === true && crlf.body.eol === 'crlf' && crlf.body.text === 'one\r\ntwo\r\n', crlf)

const bomFile = await call(read, { path: '/w/bom.txt' })
check('byte-order mark is reported', bomFile.body.ok === true && bomFile.body.bom === true && bomFile.body.eol === 'lf', bomFile)

const big = await call(read, { path: '/w/big.txt' })
check('oversized file is refused', big.body.code === 'too-large', big)

const noPath = await call(read, {})
check('missing path is a 400', noPath.status === 400 && noPath.body.code === 'bad-request', noPath)

const deniedRead = await call(read, { path: '/w/boom.txt' })
check('read error code is preserved', deniedRead.body.ok === false && deniedRead.body.code === 'FS_PERMISSION_DENIED', deniedRead)

const saved = await call(write, { path: '/w/a.txt', text: 'alpha\ngamma\n', version: 'v1' })
check('guarded save succeeds and bumps the version', saved.body.ok === true && saved.body.version !== 'v1' && saved.body.operation === 'update', saved)
const current = files.get('/w/a.txt')
check('content is stored', current.text === 'alpha\ngamma\n', current)

const conflict = await call(write, { path: '/w/a.txt', text: 'stale', version: 'v1' })
check('stale save reports a conflict', conflict.body.ok === false && conflict.body.code === 'conflict', conflict)
check('conflict left the file untouched', files.get('/w/a.txt').text === 'alpha\ngamma\n', files.get('/w/a.txt'))

const overwrite = await call(write, { path: '/w/a.txt', text: 'forced\n' })
check('unversioned save overwrites', overwrite.body.ok === true && files.get('/w/a.txt').text === 'forced\n', overwrite)

const created = await call(write, { path: '/w/new.txt', text: 'hello\n', version: 'whatever' })
check('guarded create reports not-observed as conflict', created.body.code === 'conflict', created)

const sandboxed = await call(write, { path: '/w/locked.txt', text: 'x' })
check('sandbox denial is reported as denied', sandboxed.body.ok === false && sandboxed.body.code === 'denied', sandboxed)

const badText = await call(write, { path: '/w/a.txt', text: 42 })
check('non-string content is a 400', badText.status === 400, badText)

const huge = await call(write, { path: '/w/a.txt', text: 'x'.repeat(8 * 1024 * 1024 + 1) })
check('oversized save body is refused', huge.status === 413 && huge.body.code === 'too-large', huge.status)

const malformed = await write.fetch(new Request('http://h/api/file-editor/write', { method: 'POST', body: 'not json' }))
check('malformed JSON body is a 400', malformed.status === 400, malformed.status)

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES')
process.exit(failures === 0 ? 0 : 1)
