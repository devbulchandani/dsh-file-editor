import assert from 'node:assert/strict'

// ---------- browser globals the module touches ----------
let loaded
globalThis.window = { __ModuleLoader__: { load(definition) { loaded = definition } } }
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel' }, configurable: true })
globalThis.document = { baseURI: 'http://127.0.0.1:54238/', activeElement: null }
globalThis.requestAnimationFrame = (fn) => { fn() }

await import(new URL('../client.js', import.meta.url).href)
assert.equal(loaded.id, '@local/dsh-file-editor')

// ---------- React test double with a tiny hook runtime ----------
let hookIndex = 0
let slots = []
const Fragment = Symbol('Fragment')
const React = {
  Fragment,
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(2).filter(child => child !== null && child !== undefined && child !== false) }
  },
  useState(initial) {
    const index = hookIndex++
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
    return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
  },
  useRef(initial) {
    const index = hookIndex++
    if (!(index in slots)) slots[index] = { current: initial }
    return slots[index]
  },
  useMemo(compute) {
    const index = hookIndex++
    if (!(index in slots)) slots[index] = compute()
    return slots[index]
  },
  useEffect() { hookIndex += 1 },
  useSyncExternalStore(subscribe, getSnapshot) { return getSnapshot() },
}

const module_ = loaded.factory((specifier) => {
  assert.equal(specifier, 'react')
  return React
})
assert.deepEqual([...module_.inject].sort(), ['locale', 'slots'])

const dictionaries = new Map()
const registrations = []
module_.apply({
  effect: (effect) => effect(),
  locale: { register: (namespace, dicts) => { dictionaries.set(namespace, dicts); return () => {} } },
  slots: {
    inject: (key, effect) => effect(),
    register: (declaration, component) => { registrations.push({ declaration, component }); return () => {} },
  },
})

// ---------- registration contract ----------
assert.equal(dictionaries.size, 1)
const [namespace, dicts] = [...dictionaries.entries()][0]
assert.equal(namespace, 'file-editor')
assert.deepEqual(Object.keys(dicts.en).sort(), Object.keys(dicts.zh).sort())
for (const value of Object.values(dicts.en)) assert.equal(typeof value, 'string')
console.log('PASS dictionaries:', Object.keys(dicts.en).length, 'keys with en/zh parity')

const bySlot = new Map(registrations.map(entry => [entry.declaration.name, entry]))
assert.deepEqual([...bySlot.keys()].sort(), ['shell.overlay', 'sidebar.right.tab.document.actions'])
assert.equal(bySlot.get('sidebar.right.tab.document.actions').declaration.id, 'file-editor')
assert.equal(bySlot.get('sidebar.right.tab.document.actions').declaration.locale, 'file-editor')
assert.equal(bySlot.get('shell.overlay').declaration.id, 'file-editor.dialog')
assert.equal(bySlot.get('shell.overlay').declaration.locale, 'file-editor')
console.log('PASS slot registrations')

const findAll = (node, predicate, found = []) => {
  if (node === null || node === undefined || typeof node !== 'object') return found
  if (node.props !== undefined && predicate(node)) found.push(node)
  for (const child of node.children ?? []) findAll(child, predicate, found)
  return found
}
const findOne = (node, predicate) => findAll(node, predicate)[0]
const byAttr = (node, attr) => findOne(node, element => element.props[attr] !== undefined)
const textOf = (node) => (node.children.length > 0 ? node.children[0] : node.props.children)

// ---------- header control ----------
const t = (key) => key
const EditAction = bySlot.get('sidebar.right.tab.document.actions').component
const injected = bySlot.get('sidebar.right.tab.document.actions').declaration.inject()
assert.equal(typeof injected.openEditor, 'function')
assert.equal(EditAction({ t, openEditor() {}, absolutePath: '/w/logo.png' }), null)
assert.equal(EditAction({ t, openEditor() {}, absolutePath: '/w/a.docx' }), null)
assert.equal(EditAction({ t, openEditor() {} }), null)
const action = EditAction({ t, openEditor() {}, absolutePath: '/w/src/index.ts' })
const actionButton = findOne(action, node => node.type === 'button')
assert.equal(actionButton.props.className, 'dsh-fe-tool')
assert.equal(actionButton.props['aria-label'], 'action.edit')
let openedPath
findOne(EditAction({ t, openEditor: (path) => { openedPath = path }, absolutePath: '/w/src/index.ts' }), node => node.type === 'button')
  .props.onClick()
assert.equal(openedPath, '/w/src/index.ts')
console.log('PASS header control hides for binary files and opens a path')

// ---------- dialog ----------
const EditorOverlay = bySlot.get('shell.overlay').component
assert.equal(EditorOverlay({ t }), null)
console.log('PASS overlay closed while idle')

injected.openEditor('/w/src/index.ts')
hookIndex = 0
slots = []
const overlay = EditorOverlay({ t })
const sessionElement = findAll(overlay, node => typeof node.type === 'function').find(node => node.props.path !== undefined)
assert.equal(sessionElement.props.path, '/w/src/index.ts')

// first render = loading state, the card itself takes focus
hookIndex = 0
const loadingTree = sessionElement.type(sessionElement.props)
assert.ok(findOne(loadingTree, node => node.props.className === 'dsh-fe-state'), 'loading state renders')
assert.equal(byAttr(loadingTree, 'data-file-editor-field'), undefined)
const card = byAttr(loadingTree, 'data-file-editor-dialog')
assert.equal(card.props.tabIndex, -1, 'card is focusable while loading')
console.log('PASS dialog opens in its loading state on a focusable card')

// second render = ready, clean, CRLF source
slots[0] = 'ready'
slots[1] = 'alpha\nbeta\ngamma'
slots[2] = 'alpha\nbeta\ngamma'
slots[3] = 'v1'
slots[4] = '/w/src/index.ts'
slots[10] = 'crlf'
slots[11] = false
delete slots[24]
delete slots[25]
hookIndex = 0
const cleanTree = sessionElement.type(sessionElement.props)
const field = byAttr(cleanTree, 'data-file-editor-field')
assert.equal(field.props.value, 'alpha\nbeta\ngamma')
assert.equal(findAll(cleanTree, node => node.props.className === 'dsh-fe-gutterLine').length, 3)
assert.equal(byAttr(cleanTree, 'data-file-editor-save').props.disabled, true, 'save is disabled without changes')
assert.ok(byAttr(cleanTree, 'data-file-editor-status'), 'status is shown')
console.log('PASS dialog renders the source with a 3-line gutter and a disabled Save')

// dirty render
slots[1] = 'alpha\nbeta\ngamma\ndelta'
delete slots[24]
delete slots[25]
hookIndex = 0
const dirtyTree = sessionElement.type(sessionElement.props)
const dirtySave = byAttr(dirtyTree, 'data-file-editor-save')
assert.equal(dirtySave.props.disabled, false)
assert.equal(findAll(dirtyTree, node => node.props.className === 'dsh-fe-gutterLine').length, 4)
assert.ok(findOne(dirtyTree, node => node.props.className === 'dsh-fe-dot'), 'unsaved marker')
console.log('PASS dirty state enables Save and marks the header')

// save round trip: CRLF restored, version guard sent
let request
const fetchCalls = []
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init })
  return { ok: true, status: 200, json: async () => ({ ok: true, version: 'v2', path: '/w/src/index.ts', operation: 'update' }) }
}
dirtySave.props.onClick()
await new Promise(resolve => setTimeout(resolve, 20))
request = fetchCalls[fetchCalls.length - 1]
assert.equal(request.url, 'http://127.0.0.1:54238/api/file-editor/write')
assert.deepEqual(JSON.parse(request.init.body), {
  path: '/w/src/index.ts',
  text: 'alpha\r\nbeta\r\ngamma\r\ndelta',
  version: 'v1',
})
assert.equal(request.init.method, 'POST')
assert.equal(request.init.credentials, 'same-origin')
assert.equal(slots[2], 'alpha\nbeta\ngamma\ndelta', 'baseline advances after the save')
assert.equal(slots[3], 'v2', 'version advances after the save')
assert.equal(slots[8], true, 'saved acknowledgement is set')
console.log('PASS save restores CRLF, keeps the version guard, and records the new version')

// conflict -> Reload asks before dropping the buffer
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, code: 'conflict', message: 'changed on disk' }) })
slots[1] = 'edited again'
delete slots[24]
delete slots[25]
hookIndex = 0
const conflictSource = sessionElement.type(sessionElement.props)
byAttr(conflictSource, 'data-file-editor-save').props.onClick()
await new Promise(resolve => setTimeout(resolve, 20))
hookIndex = 0
const conflictTree = sessionElement.type(sessionElement.props)
assert.equal(byAttr(conflictTree, 'data-file-editor-error').props['data-file-editor-error'], 'conflict')
assert.equal(textOf(byAttr(conflictTree, 'data-file-editor-error')), 'error.conflict', 'localized conflict copy')
const reloadButton = byAttr(conflictTree, 'data-file-editor-reload')
const reloadTokenBefore = slots[9]
reloadButton.props.onClick()
assert.equal(slots[7], 'reload', 'reload asks for confirmation first')
assert.equal(slots[9], reloadTokenBefore, 'the file is not re-read before confirmation')
hookIndex = 0
const confirmTree = sessionElement.type(sessionElement.props)
assert.equal(textOf(byAttr(confirmTree, 'data-file-editor-keep')), 'dialog.keepEditing')
byAttr(confirmTree, 'data-file-editor-discard').props.onClick()
assert.equal(slots[9], reloadTokenBefore + 1, 'discarding reloads the file')
assert.equal(slots[7], null, 'the confirmation closes')
console.log('PASS conflict Reload asks before discarding the buffer')

// a failed save retries the save, never a reload
slots[1] = 'still mine'
delete slots[24]
delete slots[25]
hookIndex = 0
const retrySource = sessionElement.type(sessionElement.props)
let attempts = 0
globalThis.fetch = async () => { attempts += 1; throw new Error('socket closed') }
byAttr(retrySource, 'data-file-editor-save').props.onClick()
await new Promise(resolve => setTimeout(resolve, 20))
hookIndex = 0
const failedSaveTree = sessionElement.type(sessionElement.props)
assert.equal(byAttr(failedSaveTree, 'data-file-editor-error').props['data-file-editor-error'], 'transport')
const tokenBeforeRetry = slots[9]
const retryButton = byAttr(failedSaveTree, 'data-file-editor-retry')
assert.ok(retryButton, 'a failed save offers retry')
retryButton.props.onClick()
await new Promise(resolve => setTimeout(resolve, 20))
assert.equal(attempts, 2, 'retry repeats the write')
assert.equal(slots[9], tokenBeforeRetry, 'retry does not reload and keep the edits')
console.log('PASS a failed save retries the write and keeps the buffer')

// permanent read failures offer no pointless retry
slots[0] = 'failed'
slots[6] = { stage: 'read', code: 'missing', message: 'ENOENT' }
delete slots[24]
delete slots[25]
hookIndex = 0
const missingTree = sessionElement.type(sessionElement.props)
assert.equal(textOf(byAttr(missingTree, 'data-file-editor-read-failed')), 'error.missing', 'localized read failure')
assert.equal(byAttr(missingTree, 'data-file-editor-retry'), undefined, 'no retry for a missing file')

slots[6] = { stage: 'read', code: 'read-failed', message: 'boom' }
hookIndex = 0
const retryableTree = sessionElement.type(sessionElement.props)
assert.ok(byAttr(retryableTree, 'data-file-editor-retry'), 'a transient read failure is retryable')
console.log('PASS read failures are localized and only retried when retrying can help')

// discard flow
slots[0] = 'ready'
slots[1] = 'changed'
slots[2] = 'baseline'
delete slots[24]
delete slots[25]
hookIndex = 0
const dirtyAgain = sessionElement.type(sessionElement.props)
byAttr(dirtyAgain, 'data-file-editor-cancel').props.onClick()
assert.equal(slots[7], 'close', 'closing with unsaved changes asks first')
hookIndex = 0
const closeConfirm = sessionElement.type(sessionElement.props)
byAttr(closeConfirm, 'data-file-editor-discard').props.onClick()
assert.equal(EditorOverlay({ t }), null, 'discarding closes the dialog')
console.log('PASS closing with unsaved changes confirms, then discards')

console.log('ALL PASS')
