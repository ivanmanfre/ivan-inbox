import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Link2, List, ListOrdered, Quote, Redo2, Undo2 } from 'lucide-react'
import { validEmailHref, type EmailRichNode } from '../../lib/emailRichText'
import './rich-email.css'

type Props = {
  value: EmailRichNode
  onChange: (doc: EmailRichNode) => void
  label: string
  disabled?: boolean
  onBlur?: () => void
  onSendShortcut?: () => void
  compact?: boolean
}

type LinkDraft = { from: number; to: number; label: string; url: string; error: string }

// Tiptap adds presentation attributes (including `title: null`) to link marks.
// Persist only the href that the strict email renderer accepts and uses.
function emailDocument(node: EmailRichNode): EmailRichNode {
  return {
    ...node,
    ...(node.marks ? { marks: node.marks.map(mark => mark.type === 'link'
      ? { type: 'link', attrs: { href: mark.attrs?.href } }
      : mark) } : {}),
    ...(node.content ? { content: node.content.map(emailDocument) } : {}),
  }
}

const serializedEmailDocument = (node: EmailRichNode) => JSON.stringify(emailDocument(node))

export function RichEmailEditor({ value, onChange, label, disabled = false, onBlur, onSendShortcut, compact = false }: Props) {
  const callbacks = useRef({ onChange, onBlur, onSendShortcut })
  callbacks.current = { onChange, onBlur, onSendShortcut }
  const lastDocument = useRef(serializedEmailDocument(value))
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null)
  const editor = useEditor({
    extensions: [StarterKit.configure({
      heading: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      trailingNode: false,
      link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: uri => validEmailHref(uri) },
    })],
    content: value,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', 'data-autosave': '', spellcheck: 'true' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          callbacks.current.onSendShortcut?.()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: current }) => {
      const document = emailDocument(current.getJSON() as EmailRichNode)
      const serialized = JSON.stringify(document)
      if (serialized !== lastDocument.current) {
        lastDocument.current = serialized
        callbacks.current.onChange(document)
      }
    },
    onBlur: () => callbacks.current.onBlur?.(),
  })

  useEffect(() => {
    if (!editor) return
    if (serializedEmailDocument(editor.getJSON() as EmailRichNode) !== serializedEmailDocument(value)) {
      editor.commands.setContent(value, { emitUpdate: false })
      lastDocument.current = serializedEmailDocument(editor.getJSON() as EmailRichNode)
    }
  }, [editor, value])

  useEffect(() => { editor?.setEditable(!disabled) }, [editor, disabled])

  function openLink() {
    if (!editor || disabled) return
    let { from, to } = editor.state.selection
    if (editor.isActive('link')) {
      editor.chain().extendMarkRange('link').run()
      ;({ from, to } = editor.state.selection)
    }
    setLinkDraft({ from, to, label: editor.state.doc.textBetween(from, to), url: editor.getAttributes('link').href ?? '', error: '' })
  }

  function saveLink() {
    if (!editor || !linkDraft) return
    const url = linkDraft.url.trim()
    if (!validEmailHref(url)) {
      setLinkDraft({ ...linkDraft, error: 'Use an http, https, or mailto link.' })
      return
    }
    const text = linkDraft.label.trim()
    if (!text) {
      setLinkDraft({ ...linkDraft, error: 'Enter link text.' })
      return
    }
    editor.chain().focus().insertContentAt({ from: linkDraft.from, to: linkDraft.to }, { type: 'text', text, marks: [{ type: 'link', attrs: { href: url } }] }).run()
    setLinkDraft(null)
  }

  function removeLink() {
    if (!editor || !linkDraft) return
    editor.chain().focus().setTextSelection({ from: linkDraft.from, to: linkDraft.to }).unsetLink().run()
    setLinkDraft(null)
  }

  const action = (name: string, glyph: ReactNode, active: boolean, run: () => void, title?: string) => <button
    type="button" title={title ?? name} aria-label={name} aria-pressed={active} disabled={disabled || !editor}
    onMouseDown={event => event.preventDefault()} onClick={run}>{glyph}</button>

  return <div className={`dm-rich-email-editor${compact ? ' dm-rich-email-compact' : ''}`}>
    <div className="dm-rich-email-toolbar" role="toolbar" aria-label={`${label} formatting`}>
      {action('Bold', 'B', !!editor?.isActive('bold'), () => editor?.chain().focus().toggleBold().run(), 'Bold (⌘/Ctrl+B)')}
      {action('Italic', 'I', !!editor?.isActive('italic'), () => editor?.chain().focus().toggleItalic().run(), 'Italic (⌘/Ctrl+I)')}
      {action('Underline', 'U', !!editor?.isActive('underline'), () => editor?.chain().focus().toggleUnderline().run(), 'Underline (⌘/Ctrl+U)')}
      {action('Strikethrough', 'S', !!editor?.isActive('strike'), () => editor?.chain().focus().toggleStrike().run())}
      <span className="dm-rich-email-separator" aria-hidden="true" />
      {action('Bulleted list', <List size={18} strokeWidth={1.8} />, !!editor?.isActive('bulletList'), () => editor?.chain().focus().toggleBulletList().run())}
      {action('Numbered list', <ListOrdered size={18} strokeWidth={1.8} />, !!editor?.isActive('orderedList'), () => editor?.chain().focus().toggleOrderedList().run())}
      {action('Quote', <Quote size={17} strokeWidth={1.8} />, !!editor?.isActive('blockquote'), () => editor?.chain().focus().toggleBlockquote().run())}
      <span className="dm-rich-email-separator" aria-hidden="true" />
      {action('Insert or edit link', <Link2 size={18} strokeWidth={1.8} />, !!editor?.isActive('link'), openLink)}
      {action('Undo', <Undo2 size={18} strokeWidth={1.8} />, false, () => editor?.chain().focus().undo().run())}
      {action('Redo', <Redo2 size={18} strokeWidth={1.8} />, false, () => editor?.chain().focus().redo().run())}
    </div>
    {linkDraft && <div className="dm-rich-email-link-dialog" role="dialog" aria-label="Edit link">
      <label>Link text<input aria-label="Link text" value={linkDraft.label} onChange={event => setLinkDraft({ ...linkDraft, label: event.target.value, error: '' })} /></label>
      <label>URL<input aria-label="Link URL" inputMode="url" value={linkDraft.url} onChange={event => setLinkDraft({ ...linkDraft, url: event.target.value, error: '' })} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveLink() } }} /></label>
      {linkDraft.error && <span role="alert" className="dm-rich-email-link-error">{linkDraft.error}</span>}
      <div className="dm-rich-email-link-actions">
        <button type="button" onClick={saveLink}>Save link</button>
        {linkDraft.from !== linkDraft.to && editor?.isActive('link') && <button type="button" onClick={removeLink}>Remove link</button>}
        <button type="button" onClick={() => { setLinkDraft(null); editor?.commands.focus() }}>Cancel</button>
      </div>
    </div>}
    <EditorContent editor={editor} className="dm-rich-email-content" />
  </div>
}
