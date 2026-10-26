# Rich email composition

Ivan wants Gmail-style HTML composition, useful link formatting and a proper signature. He also needs to see the exact email being answered and whether it is the latest received message.

The existing native email envelope stays. Replace email body textareas with a focused rich editor supporting bold, italic, underline, strike, lists, quotes, undo/redo and link text plus URL. Pasted content enters the editor's restricted document schema. Keep the existing send confirmation, shortcut, holds, forwarding and autosave behavior.

Show the sender's signature below the body. Use the existing verified ARCH and RISE identities, with name/company/linked website. Allow editing, removal and reset of the signature for this message. No invented phone numbers or titles. The preview and sender must render the same structured content, including the signature.

Store a versioned structured document under draft_evidence.email_composition, or email_mirror_composition for a mirrored email. Contract: {version:1,source_text:string,body:EmailRichNode,signature:EmailRichNode|null}. source_text is the exact stored message_text/email_mirror_text. It contains the Subject prefix and the document body's deterministic plain text, excluding the separate signature. The deterministic plain text includes custom link URLs, preserving their meaning in the MIME text alternative and in the searchable history. Existing plain drafts retain their send path.

Render only approved node and mark types, escaping all text and validating href protocols. No raw HTML is persisted or trusted. Invalid or stale rich documents fail before sending. Guard rich-draft saves against approval, send, discard and concurrent evidence changes. The rich renderer is shared with the dispatcher's embedded code through a tested source projection.

Each Reply action selects its email. The composer shows Replying to, sender, date, subject, a readable excerpt and a jump to the original. The default selects the latest received email and labels it. Selecting an older email is explicit. A changed latest target must be reviewed before queuing. Confirmation retains the displayed recipient, subject and thread headers.

Verify formatting, custom links, paste filtering, signatures, reload/autosave, rich sent history, manual replies, companion/mirror drafts, keyboard send and stale-target guards. Inspect the actual Daily Brief window after deployment. No real outgoing emails or bookings are used as tests.
