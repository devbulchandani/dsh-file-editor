/**
 * Client half of the file editor bundle.
 *
 * The right Sidebar's document preview is read-only, so this half adds the one
 * thing it cannot do: writing the file back. It contributes
 *
 * - an **Edit file** control in the preview header
 *   (`sidebar.right.tab.document.actions`), rendered only for files the plain
 *   text reader can open; and
 * - one frame-wide editor dialog in `shell.overlay`, opened by that control,
 *   with a line-numbered source field, dirty tracking, the platform save
 *   shortcut, an explicit discard confirmation for both closing and reloading,
 *   and localized failure copy backed by the Host's guarded write.
 *
 * Everything the dialog reads or writes goes through the Host routes mounted by
 * this bundle's `index.js`, which use the sanitized `ctx.fs` service. The
 * dialog never touches the filesystem itself, and it inherits the Host's
 * authority decisions, including a refusal the active sandbox policy imposes.
 *
 * @module @local/dsh-file-editor/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-file-editor',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace owned by this plugin. */
    const NS = 'file-editor'

    /** English dictionary (the fallback every other locale resolves through). */
    const en = {
      'action.edit': 'Edit file',
      'dialog.title': 'Edit file',
      'dialog.loading': 'Opening file\u2026',
      'dialog.save': 'Save',
      'dialog.saving': 'Saving\u2026',
      'dialog.cancel': 'Cancel',
      'dialog.close': 'Close editor',
      'dialog.discard': 'Discard changes',
      'dialog.keepEditing': 'Keep editing',
      'dialog.confirmDiscard': 'Discard unsaved changes?',
      'dialog.confirmReload': 'Reloading the file discards your changes.',
      'dialog.saved': 'Saved',
      'dialog.unsaved': 'Unsaved changes',
      'dialog.lines': '{count} lines',
      'dialog.line': '1 line',
      'dialog.saveHint': '{shortcut}S to save',
      'dialog.indentHint': '{mod}] indents',
      'dialog.reload': 'Reload',
      'dialog.overwrite': 'Overwrite',
      'dialog.retry': 'Try again',
      'error.conflict': 'This file changed on disk after it was opened here.',
      'error.denied': 'The file sandbox does not allow writing this path.',
      'error.tooLarge': 'This file is too large to open in the editor.',
      'error.missing': 'This file no longer exists.',
      'error.notFile': 'This path is not a regular file.',
      'error.binary': 'This file is not UTF-8 text, so it cannot be edited here.',
      'error.permission': 'This file cannot be read.',
      'error.read': 'This file could not be opened for editing.',
      'error.save': 'This file could not be saved.',
      'error.transport': 'The Harness Host could not be reached.',
    }

    /** Simplified Chinese dictionary. */
    const zh = {
      'action.edit': '编辑文件',
      'dialog.title': '编辑文件',
      'dialog.loading': '正在打开文件\u2026',
      'dialog.save': '保存',
      'dialog.saving': '正在保存\u2026',
      'dialog.cancel': '取消',
      'dialog.close': '关闭编辑器',
      'dialog.discard': '放弃修改',
      'dialog.keepEditing': '继续编辑',
      'dialog.confirmDiscard': '放弃未保存的修改？',
      'dialog.confirmReload': '重新加载将放弃你的修改。',
      'dialog.saved': '已保存',
      'dialog.unsaved': '有未保存的修改',
      'dialog.lines': '{count} 行',
      'dialog.line': '1 行',
      'dialog.saveHint': '{shortcut}S 保存',
      'dialog.indentHint': '{mod}] 缩进',
      'dialog.reload': '重新加载',
      'dialog.overwrite': '覆盖保存',
      'dialog.retry': '重试',
      'error.conflict': '打开后该文件已在磁盘上发生变化。',
      'error.denied': '文件沙箱不允许写入该路径。',
      'error.tooLarge': '该文件过大，无法在编辑器中打开。',
      'error.missing': '该文件已不存在。',
      'error.notFile': '该路径不是普通文件。',
      'error.binary': '该文件不是 UTF-8 文本，无法在此编辑。',
      'error.permission': '无法读取该文件。',
      'error.read': '无法打开该文件进行编辑。',
      'error.save': '无法保存该文件。',
      'error.transport': '无法连接到 Harness 宿主。',
    }

    /** Host routes mounted by this bundle's Host half. */
    const READ_ROUTE = 'api/file-editor/read'
    const WRITE_ROUTE = 'api/file-editor/write'

    /** One indentation step for the indent shortcut. */
    const INDENT = '  '

    /** Suffixes the plain-text reader cannot open, so no Edit control is offered. */
    const BINARY_SUFFIXES = new Set([
      'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'tiff', 'psd',
      'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', 'tar', 'rar', '7z',
      'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
      'mp3', 'wav', 'ogg', 'flac', 'm4a', 'mp4', 'mov', 'webm', 'avi', 'mkv',
      'woff', 'woff2', 'ttf', 'otf', 'eot',
      'exe', 'dmg', 'pkg', 'bin', 'so', 'dylib', 'dll', 'node', 'wasm',
      'sqlite', 'db', 'jar', 'class', 'pyc', 'o', 'a',
    ])

    /** Failure codes that retrying can never fix. */
    const PERMANENT_FAILURES = new Set(['missing', 'not-file', 'too-large', 'FS_NOT_TEXT'])

    /** Editor styling: theme tokens only, so light and dark follow the Harness. */
    const CSS = `
.dsh-fe-tool {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; border: 0; border-radius: 7px;
  background: transparent; color: var(--dsw-alias-label-secondary, #6b7280);
  cursor: pointer; flex: 0 0 auto;
}
.dsh-fe-tool:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.14)); color: var(--dsw-alias-label-primary, #111827); }
.dsh-fe-tool:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #2563eb); outline-offset: 1px; }
.dsh-fe-tool:disabled { opacity: .45; cursor: default; background: transparent; }
.dsh-fe-backdrop {
  position: fixed; inset: var(--dsh-frame-chrome-top, 0px) 0 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center; padding: 24px;
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, .24));
  backdrop-filter: var(--dsw-mask-blur, none); pointer-events: auto;
}
.dsh-fe-card {
  display: flex; flex-direction: column; overflow: hidden;
  width: min(940px, 100%);
  height: min(760px, calc(100vh - 2 * max(24px, var(--dsh-frame-overlay-top, 24px))));
  background: var(--dsw-alias-bg-layer-2, #ffffff);
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
  border-radius: var(--dsw-radius-panel, 16px);
  box-shadow: var(--dsw-elevation-prominent, 0 24px 60px rgba(0, 0, 0, .34));
  color: var(--dsw-alias-label-primary, #111827); font-size: 13px;
}
.dsh-fe-card:focus { outline: none; }
.dsh-fe-head {
  display: flex; align-items: center; gap: 10px; flex: 0 0 auto;
  padding: 10px 10px 10px 14px; min-height: 48px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
}
.dsh-fe-headGlyph { display: flex; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-fe-headText { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dsh-fe-headTitle { font-size: 13px; font-weight: 600; line-height: 18px; }
.dsh-fe-headPath {
  font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-primary, #111827);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 62ch;
}
.dsh-fe-headDir { color: var(--dsw-alias-label-tertiary, #6b7280); }
.dsh-fe-headRight { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.dsh-fe-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-tertiary, #6b7280); white-space: nowrap; }
.dsh-fe-dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
.dsh-fe-body { position: relative; flex: 1 1 auto; display: flex; min-height: 0; background: var(--dsw-specific-sidebar-fill, #f6f7f9); }
.dsh-fe-gutter {
  flex: 0 0 auto; overflow: hidden; user-select: none; text-align: right;
  padding: 14px 0 14px 14px; min-width: 52px;
  font-family: var(--dsw-code-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 12px; line-height: 20px;
  color: var(--dsw-alias-label-tertiary, #9aa1ac);
}
.dsh-fe-gutterLine { height: 20px; padding-right: 10px; }
.dsh-fe-field {
  flex: 1 1 auto; min-width: 0; margin: 0; padding: 14px 16px 14px 6px;
  border: 0; outline: none; resize: none; background: transparent;
  color: var(--dsw-alias-label-primary, #111827);
  font-family: var(--dsw-code-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 12px; line-height: 20px;
  tab-size: 2; white-space: pre; overflow: auto; caret-color: var(--dsw-alias-brand-primary, #2563eb);
}
.dsh-fe-state {
  flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 24px; text-align: center; max-width: 56ch; margin: 0 auto;
  color: var(--dsw-alias-label-secondary, #6b7280);
}
.dsh-fe-notice { display: flex; flex-direction: column; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); }
.dsh-fe-noticeText { font-size: 12.5px; line-height: 18px; color: var(--dsw-alias-state-error-primary, #dc2626); }
.dsh-fe-noticeRow { display: flex; align-items: center; gap: 8px; }
.dsh-fe-foot {
  display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
  padding: 10px 12px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
  background: var(--dsw-alias-bg-layer-2, #ffffff);
}
.dsh-fe-footText { margin-right: auto; font-size: 12px; color: var(--dsw-alias-label-tertiary, #6b7280); }
.dsh-fe-footWarn { margin-right: auto; font-size: 12px; color: var(--dsw-alias-state-warn-label, #b45309); }
.dsh-fe-btn {
  appearance: none; font: inherit; font-size: 12.5px; line-height: 18px; padding: 6px 12px;
  border-radius: 8px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,.12));
  background: transparent; color: var(--dsw-alias-label-primary, #111827);
}
.dsh-fe-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12)); }
.dsh-fe-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #2563eb); outline-offset: 1px; }
.dsh-fe-btn:disabled { opacity: .5; cursor: default; }
.dsh-fe-btnPrimary {
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #2563eb));
  border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
}
.dsh-fe-btnPrimary:hover { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary, #2563eb)); }
.dsh-fe-btnPrimary:disabled { background: var(--dsw-alias-button-primary-dimmed, rgba(127,127,127,.2)); color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-fe-btnDanger { color: var(--dsw-alias-state-error-primary, #dc2626); }
`.trim()

    /**
     * Render the editor's stylesheet once per mounted entry.
     * @returns a style element carrying the plugin's rules.
     */
    function Style() {
      return h('style', { 'data-dsh-file-editor': '' }, CSS)
    }

    /**
     * Resolve one dictionary key, substituting `{name}` placeholders.
     * @param translate - bound translate function from the locale service.
     * @param key - dictionary key.
     * @param values - placeholder values.
     * @returns the resolved text.
     */
    function t(translate, key, values) {
      let text = translate(key)
      if (values !== undefined) {
        for (const [name, value] of Object.entries(values)) text = text.split(`{${name}}`).join(String(value))
      }
      return text
    }

    /**
     * Localized copy for a Host failure code.
     * @param translate - bound translate function.
     * @param failure - the coded failure.
     * @returns localized copy, or the Host's own message for an unmapped code.
     */
    function failureText(translate, failure) {
      if (failure.code === 'conflict') return t(translate, 'error.conflict')
      if (failure.code === 'denied') return t(translate, 'error.denied')
      if (failure.code === 'too-large') return t(translate, 'error.tooLarge')
      if (failure.code === 'missing') return t(translate, 'error.missing')
      if (failure.code === 'not-file') return t(translate, 'error.notFile')
      if (failure.code === 'FS_NOT_TEXT') return t(translate, 'error.binary')
      if (failure.code === 'FS_PERMISSION_DENIED') return t(translate, 'error.permission')
      if (failure.code === 'transport') return t(translate, 'error.transport')
      if (failure.code === 'read-failed') return t(translate, 'error.read')
      if (failure.code === 'write-failed') return t(translate, 'error.save')
      if (typeof failure.message === 'string' && failure.message !== '') return failure.message
      return t(translate, failure.stage === 'write' ? 'error.save' : 'error.read')
    }

    /** The one open editor request, shared by the header control and the dialog. */
    let pendingRequest = null
    /** Monotone opener counter, so each open mounts a fresh dialog body. */
    let openCount = 0
    /** Dialog subscribers. */
    const subscribers = new Set()

    /**
     * Read the current editor request.
     * @returns the open request, or `null` while the dialog is closed.
     */
    function snapshot() {
      return pendingRequest
    }

    /**
     * Subscribe to editor request changes.
     * @param listener - callback invoked after each change.
     * @returns the unsubscribe function.
     */
    function subscribe(listener) {
      subscribers.add(listener)
      return () => { subscribers.delete(listener) }
    }

    /**
     * Publish one request change to every subscriber.
     * @param next - the new request, or `null` to close.
     */
    function publish(next) {
      pendingRequest = next
      for (const listener of [...subscribers]) listener()
    }

    /**
     * Open the editor dialog for one Host path.
     * @param path - absolute Host path of the file to edit.
     */
    function openEditor(path) {
      openCount += 1
      publish({ path, nonce: openCount })
    }

    /** Close the editor dialog. */
    function closeEditor() {
      publish(null)
    }

    /**
     * Subscribe the dialog to the shared request.
     * @returns the current request.
     */
    function useRequest() {
      return React.useSyncExternalStore(subscribe, snapshot, snapshot)
    }

    /**
     * POST one JSON body to a Host route and decode its JSON answer.
     * @param route - document-relative route below `/api`.
     * @param payload - JSON-serializable request body.
     * @param signal - cancellation for the request.
     * @returns the decoded business result.
     */
    async function post(route, payload, signal) {
      const response = await fetch(new URL(route, document.baseURI).href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
        signal,
      })
      let value
      try {
        value = await response.json()
      } catch {
        value = undefined
      }
      if (typeof value === 'object' && value !== null) return value
      return { ok: false, code: 'transport', message: `The Host answered ${response.status}.` }
    }

    /**
     * Whether the plain-text reader can open a path, by its suffix.
     * @param path - Host path of the previewed file.
     * @returns true when the suffix names a binary container.
     */
    function isBinaryPath(path) {
      const name = path.replaceAll('\\', '/').split('/').pop() ?? ''
      const dot = name.lastIndexOf('.')
      if (dot <= 0 || dot === name.length - 1) return false
      return BINARY_SUFFIXES.has(name.slice(dot + 1).toLowerCase())
    }

    /**
     * Parent directory of a Host path, slash included.
     * @param path - absolute Host path.
     * @returns the directory portion, or an empty string.
     */
    function directoryOf(path) {
      const at = path.lastIndexOf('/')
      return at > 0 ? path.slice(0, at + 1) : ''
    }

    /**
     * Rebuild the source text the way the file stored it.
     * @param text - LF text from the field.
     * @param eol - the file's line ending style at open time.
     * @param bom - whether the file started with a byte-order mark.
     * @returns the text to write.
     */
    function serialize(text, eol, bom) {
      const body = eol === 'crlf' ? text.split('\n').join('\r\n') : text
      return bom ? `\uFEFF${body}` : body
    }

    /** Platform save hint label. */
    const SAVE_HINT = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform ?? '')
      ? '\u2318'
      : 'Ctrl+'

    /**
     * Pencil glyph for the header control.
     * @param props - requested pixel size.
     * @returns the icon element.
     */
    function PencilGlyph(props) {
      const size = props.size ?? 15
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': 'true', focusable: 'false',
      },
      h('path', {
        d: 'M11.2 2.3a1.4 1.4 0 0 1 2 0l.5.5a1.4 1.4 0 0 1 0 2L5.8 12.7 2 14l1.3-3.8 7.9-7.9Z',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round',
      }),
      h('path', {
        d: 'M10 3.5 12.5 6',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
      }))
    }

    /**
     * Header control contributed to every text preview.
     * @param props - owner `absolutePath`, bound translate, and the injected opener.
     * @returns the edit control, or `null` for a file the text reader cannot open.
     */
    function EditAction(props) {
      const path = props.absolutePath
      if (typeof path !== 'string' || path === '' || isBinaryPath(path)) return null
      const label = t(props.t, 'action.edit')
      return h(React.Fragment, null,
        h(Style),
        h('button', {
          type: 'button',
          className: 'dsh-fe-tool',
          title: label,
          'aria-label': label,
          'data-file-editor-action': '',
          onClick: () => { props.openEditor(path) },
        }, h(PencilGlyph, { size: 15 })))
    }

    /**
     * Mount the editor dialog for the current request.
     * @param props - bound translate function.
     * @returns the overlay entry, or `null` while nothing is being edited.
     */
    function EditorOverlay(props) {
      const request = useRequest()
      if (request === null) return null
      return h(React.Fragment, null,
        h(Style),
        h(EditorSession, { key: request.nonce, path: request.path, t: props.t }))
    }

    /**
     * One editor session: loading, editing, saving, and closing one file.
     * @param props - the Host path to edit and the bound translate function.
     * @returns the modal editor.
     */
    function EditorSession(props) {
      const translate = props.t
      const path = props.path
      const [phase, setPhase] = React.useState('loading')
      const [text, setText] = React.useState('')
      const [baseline, setBaseline] = React.useState('')
      const [version, setVersion] = React.useState(undefined)
      const [displayPath, setDisplayPath] = React.useState(path)
      const [saving, setSaving] = React.useState(false)
      const [failure, setFailure] = React.useState(null)
      const [confirm, setConfirm] = React.useState(null)
      const [justSaved, setJustSaved] = React.useState(false)
      const [reloadToken, setReloadToken] = React.useState(0)
      const [eol, setEol] = React.useState('lf')
      const [bom, setBom] = React.useState(false)
      const fieldRef = React.useRef(null)
      const gutterRef = React.useRef(null)
      const cardRef = React.useRef(null)
      const keepRef = React.useRef(null)
      const savingRef = React.useRef(false)
      const returnFocusRef = React.useRef(null)
      const dirty = phase === 'ready' && text !== baseline

      // Remember the control that opened the dialog and give focus back on close.
      React.useEffect(() => {
        returnFocusRef.current = document.activeElement
        return () => {
          const previous = returnFocusRef.current
          returnFocusRef.current = null
          if (previous !== null && typeof previous.focus === 'function' && previous.isConnected) previous.focus()
        }
      }, [])

      // Read the file (and re-read it after a confirmed reload).
      React.useEffect(() => {
        const controller = new AbortController()
        setPhase('loading')
        setFailure(null)
        setConfirm(null)
        post(READ_ROUTE, { path }, controller.signal)
          .then((result) => {
            if (controller.signal.aborted) return
            if (result.ok === true && typeof result.text === 'string') {
              const loaded = result.text.replaceAll('\r\n', '\n').replace(/^\uFEFF/u, '')
              setText(loaded)
              setBaseline(loaded)
              setVersion(result.version)
              setDisplayPath(typeof result.path === 'string' ? result.path : path)
              setEol(result.eol === 'crlf' || result.eol === 'lf'
                ? result.eol
                : (result.text.includes('\r\n') ? 'crlf' : 'lf'))
              setBom(result.bom === true)
              setJustSaved(false)
              setPhase('ready')
              return
            }
            setFailure({
              stage: 'read',
              code: typeof result.code === 'string' ? result.code : 'read-failed',
              message: typeof result.message === 'string' ? result.message : '',
            })
            setPhase('failed')
          })
          .catch((error) => {
            if (controller.signal.aborted) return
            setFailure({ stage: 'read', code: 'transport', message: String(error?.message ?? error) })
            setPhase('failed')
          })
        return () => { controller.abort() }
      }, [path, reloadToken])

      // Take focus while loading or failed, so Escape and Tab belong to the dialog
      // before there is a field to put them in.
      React.useEffect(() => {
        if (phase === 'ready') return
        const card = cardRef.current
        if (card !== null) card.focus()
      }, [phase, reloadToken])

      // Focus the source field once there is something to edit.
      React.useEffect(() => {
        if (phase !== 'ready') return
        const field = fieldRef.current
        if (field === null) return
        field.focus()
        field.setSelectionRange(0, 0)
        field.scrollTop = 0
        if (gutterRef.current !== null) gutterRef.current.scrollTop = 0
      }, [phase, reloadToken])

      // A confirmation replaces the focused footer buttons with new ones.
      React.useEffect(() => {
        if (confirm === null) return
        const keep = keepRef.current
        if (keep !== null) keep.focus()
      }, [confirm])

      // The "Saved" acknowledgement fades on its own.
      React.useEffect(() => {
        if (!justSaved) return
        const timer = setTimeout(() => { setJustSaved(false) }, 2400)
        return () => { clearTimeout(timer) }
      }, [justSaved])

      const lineCount = React.useMemo(() => {
        if (phase !== 'ready') return 0
        let count = 1
        for (let index = 0; index < text.length; index += 1) {
          if (text.charCodeAt(index) === 10) count += 1
        }
        return count
      }, [phase, text])

      // The gutter is rebuilt only when the line count changes, so typing inside a
      // line does not reconcile thousands of numbers; a very long file drops the
      // numbers instead of building a huge node list.
      const gutter = React.useMemo(() => {
        if (lineCount === 0 || lineCount > 20000) return null
        const lines = []
        for (let line = 1; line <= lineCount; line += 1) {
          lines.push(h('div', { className: 'dsh-fe-gutterLine', key: line }, line))
        }
        return lines
      }, [lineCount])

      const save = (overwrite) => {
        if (savingRef.current || phase !== 'ready') return
        savingRef.current = true
        setSaving(true)
        setFailure(null)
        setConfirm(null)
        const payload = { path: displayPath, text: serialize(text, eol, bom) }
        if (overwrite !== true && version !== undefined) payload.version = version
        // A write that never answers must not own the dialog: after this bound the
        // attempt reports a transport failure and the usual Retry returns.
        const timeout = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(30000)
          : undefined
        post(WRITE_ROUTE, payload, timeout)
          .then((result) => {
            if (result.ok === true) {
              setBaseline(text)
              setVersion(result.version)
              setJustSaved(true)
              if (typeof result.path === 'string') setDisplayPath(result.path)
              return
            }
            setFailure({
              stage: 'write',
              code: typeof result.code === 'string' ? result.code : 'write-failed',
              message: typeof result.message === 'string' ? result.message : '',
            })
          })
          .catch((error) => {
            setFailure({ stage: 'write', code: 'transport', message: String(error?.message ?? error) })
          })
          .finally(() => {
            savingRef.current = false
            setSaving(false)
          })
      }

      const requestClose = () => {
        // A save in flight owns the file until it settles; closing now would hide
        // the outcome of a write that may already be published.
        if (savingRef.current) return
        if (dirty) {
          setConfirm('close')
          return
        }
        closeEditor()
      }

      /**
       * Keep keyboard focus inside the dialog while it is open.
       * @param event - the Tab keydown event.
       */
      const trapFocus = (event) => {
        const card = cardRef.current
        if (card === null) return
        const focusable = [...card.querySelectorAll('button, textarea, input, select, a[href], [tabindex]:not([tabindex="-1"])')]
          .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length > 0)
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (document.activeElement === card) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
          return
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
          return
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }

      /**
       * Dialog-wide shortcuts: Escape closes, the platform save chord saves, and
       * Tab stays inside the card.
       * @param event - the keydown event.
       */
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          if (confirm !== null) {
            setConfirm(null)
            if (phase === 'ready' && fieldRef.current !== null) fieldRef.current.focus()
            return
          }
          requestClose()
          return
        }
        if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'S')) {
          event.preventDefault()
          event.stopPropagation()
          if (phase === 'ready' && dirty) save(false)
          return
        }
        if (event.key === 'Tab') trapFocus(event)
      }

      /**
       * Indent or outdent every line the selection touches. Plain Tab moves focus,
       * so the chord is the platform's `]`/`[` modifier pair instead of Tab.
       * @param outdent - remove one step instead of adding it.
       */
      const shiftIndent = (outdent) => {
        const field = fieldRef.current
        if (field === null) return
        const start = field.selectionStart ?? 0
        const end = field.selectionEnd ?? start
        const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1
        let lineEnd = text.indexOf('\n', end)
        if (lineEnd === -1) lineEnd = text.length
        const lines = text.slice(lineStart, lineEnd).split('\n')
        const deltas = []
        const shifted = lines.map((line) => {
          if (!outdent) {
            deltas.push(INDENT.length)
            return INDENT + line
          }
          const removed = line.startsWith(INDENT) ? INDENT.length : (/^[ \t]/u.test(line) ? 1 : 0)
          deltas.push(-removed)
          return line.slice(removed)
        })
        const total = deltas.reduce((sum, delta) => sum + delta, 0)
        const nextStart = Math.max(lineStart, start + deltas[0])
        const nextEnd = Math.max(nextStart, end + total)
        setText(text.slice(0, lineStart) + shifted.join('\n') + text.slice(lineEnd))
        requestAnimationFrame(() => {
          field.selectionStart = nextStart
          field.selectionEnd = nextEnd
        })
      }

      /**
       * Field shortcuts: indent with the platform modifier pair.
       * @param event - the textarea keydown event.
       */
      const onFieldKeyDown = (event) => {
        if (!(event.metaKey || event.ctrlKey)) return
        if (event.key === ']') {
          event.preventDefault()
          shiftIndent(false)
          return
        }
        if (event.key === '[') {
          event.preventDefault()
          shiftIndent(true)
        }
      }

      const reload = () => {
        setConfirm(null)
        setReloadToken(value => value + 1)
      }
      const failText = failure === null ? '' : failureText(translate, failure)
      const lineSuffix = lineCount === 1 ? t(translate, 'dialog.line') : t(translate, 'dialog.lines', { count: lineCount })
      const status = failure !== null && phase !== 'failed'
        ? null
        : dirty
          ? h(React.Fragment, null,
            h('span', { className: 'dsh-fe-dot', style: { background: 'var(--dsw-alias-state-warn-primary, #d97706)' } }),
            t(translate, 'dialog.unsaved'))
          : justSaved
            ? h(React.Fragment, null,
              h('span', { className: 'dsh-fe-dot', style: { background: 'var(--dsw-alias-state-success-primary, #16a34a)' } }),
              t(translate, 'dialog.saved'))
            : phase === 'ready'
              ? lineSuffix
              : null

      const body = phase === 'loading'
        ? h('div', { className: 'dsh-fe-state' }, t(translate, 'dialog.loading'))
        : phase === 'failed'
          ? h('div', { className: 'dsh-fe-state' },
            h('span', { 'data-file-editor-read-failed': failure === null ? '' : failure.code ?? '' }, failText),
            failure !== null && PERMANENT_FAILURES.has(failure.code)
              ? null
              : h('div', { className: 'dsh-fe-noticeRow' },
                h('button', {
                  type: 'button', className: 'dsh-fe-btn', 'data-file-editor-retry': '',
                  onClick: reload,
                }, t(translate, 'dialog.retry'))))
          : h('div', { className: 'dsh-fe-body', onMouseDown: event => event.stopPropagation() },
            h('div', { className: 'dsh-fe-gutter', ref: gutterRef, 'aria-hidden': 'true' }, gutter),
            h('textarea', {
              ref: fieldRef,
              className: 'dsh-fe-field',
              value: text,
              spellCheck: false,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              'aria-label': `${t(translate, 'dialog.title')}: ${displayPath}`,
              'data-file-editor-field': '',
              onChange: (event) => { setJustSaved(false); setText(event.target.value) },
              onKeyDown: onFieldKeyDown,
              onScroll: (event) => {
                if (gutterRef.current !== null) gutterRef.current.scrollTop = event.currentTarget.scrollTop
              },
            }))

      const footer = confirm !== null
        ? h('div', { className: 'dsh-fe-foot' },
          h('span', { className: 'dsh-fe-footWarn' },
            t(translate, confirm === 'reload' ? 'dialog.confirmReload' : 'dialog.confirmDiscard')),
          h('button', {
            type: 'button', className: 'dsh-fe-btn', 'data-file-editor-keep': '', ref: keepRef,
            onClick: () => {
              setConfirm(null)
              if (phase === 'ready' && fieldRef.current !== null) fieldRef.current.focus()
            },
          }, t(translate, 'dialog.keepEditing')),
          h('button', {
            type: 'button', className: 'dsh-fe-btn dsh-fe-btnDanger', 'data-file-editor-discard': '',
            onClick: () => {
              if (confirm === 'reload') reload()
              else closeEditor()
            },
          }, t(translate, 'dialog.discard')))
        : h('div', { className: 'dsh-fe-foot' },
          h('span', { className: 'dsh-fe-footText' },
            phase === 'ready'
              ? `${t(translate, 'dialog.saveHint', { shortcut: SAVE_HINT })}\u00a0\u00b7\u00a0${t(translate, 'dialog.indentHint', { mod: SAVE_HINT })}`
              : ''),
          h('button', {
            type: 'button', className: 'dsh-fe-btn', 'data-file-editor-cancel': '',
            disabled: saving,
            onClick: requestClose,
          }, t(translate, 'dialog.cancel')),
          h('button', {
            type: 'button', className: 'dsh-fe-btn dsh-fe-btnPrimary', 'data-file-editor-save': '',
            disabled: phase !== 'ready' || !dirty || saving,
            onClick: () => { save(false) },
          }, t(translate, saving ? 'dialog.saving' : 'dialog.save')))

      // A failed load states its reason in the body, so the notice reports only a
      // save failure or a conflict over the text still in the field.
      const notice = failure === null || phase === 'failed'
        ? null
        : h('div', { className: 'dsh-fe-notice' },
          h('span', {
            className: 'dsh-fe-noticeText',
            'data-file-editor-error': failure.code ?? '',
            role: 'alert',
          }, failText),
          h('div', { className: 'dsh-fe-noticeRow' },
            failure.code === 'conflict'
              ? h(React.Fragment, null,
                h('button', {
                  type: 'button', className: 'dsh-fe-btn', 'data-file-editor-reload': '',
                  onClick: () => { setConfirm('reload') },
                }, t(translate, 'dialog.reload')),
                h('button', {
                  type: 'button', className: 'dsh-fe-btn dsh-fe-btnDanger', 'data-file-editor-overwrite': '',
                  onClick: () => { save(true) },
                }, t(translate, 'dialog.overwrite')))
              : h('button', {
                type: 'button', className: 'dsh-fe-btn', 'data-file-editor-retry': '',
                onClick: () => { save(false) },
              }, t(translate, 'dialog.retry'))))

      const directory = directoryOf(displayPath)
      return h('div', {
        className: 'dsh-fe-backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) requestClose()
        },
      },
      h('div', {
        ref: cardRef,
        className: 'dsh-fe-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t(translate, 'dialog.title'),
        tabIndex: -1,
        onKeyDown,
        'data-file-editor-dialog': '',
      },
      h('div', { className: 'dsh-fe-head' },
        h('span', { className: 'dsh-fe-headGlyph' }, h(PencilGlyph, { size: 16 })),
        h('div', { className: 'dsh-fe-headText' },
          h('span', { className: 'dsh-fe-headTitle' }, t(translate, 'dialog.title')),
          h('span', { className: 'dsh-fe-headPath', title: displayPath },
            h('span', { className: 'dsh-fe-headDir' }, directory),
            displayPath.slice(directory.length))),
        h('div', { className: 'dsh-fe-headRight' },
          status === null
            ? null
            : h('span', {
              className: 'dsh-fe-status', 'data-file-editor-status': '',
              role: 'status', 'aria-live': 'polite',
            }, status),
          h('button', {
            type: 'button', className: 'dsh-fe-tool', 'aria-label': t(translate, 'dialog.close'),
            title: t(translate, 'dialog.close'), 'data-file-editor-close': '',
            disabled: saving,
            onClick: requestClose,
          }, h('svg', {
            width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
          },
          h('path', {
            d: 'M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5',
            stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
          }))))),
      body,
      notice,
      footer))
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Mount the dictionary, the preview-header control, and the dialog seat.
       * @param ctx - client root context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'file-editor: dictionaries')
        ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register({
          name: 'sidebar.right.tab.document.actions',
          id: 'file-editor',
          locale: NS,
          inject: () => ({ openEditor }),
        }, EditAction))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'file-editor.dialog',
          locale: NS,
        }, EditorOverlay))
      },
    }
  },
})
