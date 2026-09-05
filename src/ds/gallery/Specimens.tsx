import { useState } from 'react'
import {
  Shell, ShellBody, Peer,
  Avatar, Badge, Banner, BulkBar, Button, Card, Chip, CommandList, DayHeader,
  Dialog, Divider, EmptyState, Header, Icon, IconButton, ICON_NAMES, Input,
  Kbd, List, ListRow, LiveDot, Popover, PopoverItem, Rail, RailGroup, RailItem,
  RailSeparator, SectionCard, Segmented, SettingRow, Sheet, Skeleton,
  SkeletonRows, StatTile, Stepper, Switch, TabBar, Table, Tabs, Textarea,
  ToastStack, Working, Composer, LevelMeter,
} from '..'
import { Item, Section } from './Spec'

const NAV = [
  { id: 'today', icon: 'today' as const, label: 'Today' },
  { id: 'dms', icon: 'dms' as const, label: 'DMs', count: 12 },
  { id: 'content', icon: 'content' as const, label: 'Content', count: 4 },
  { id: 'sends', icon: 'sends' as const, label: 'Lanes', count: 3, sev: 'attention' as const },
  { id: 'ops', icon: 'ops' as const, label: 'Ops', count: 2, sev: 'urgent' as const },
  { id: 'ask', icon: 'ask' as const, label: 'Claude' },
]

const ROWS = [
  { id: 'r1', who: 'Nadia Berger', what: 'Asked what the second seat covers', when: '09:41' },
  { id: 'r2', who: 'Tomas Reiner', what: 'Replied to the audit offer', when: '08:12' },
  { id: 'r3', who: 'Priya Raman', what: 'Booked a call for Thursday', when: 'Yesterday' },
]

/** Every primitive, every state. Rendered identically in both columns. */
export function Specimens({ compact = false }: { compact?: boolean }) {
  const [seg, setSeg] = useState('all')
  const [tab, setTab] = useState('review')
  const [on, setOn] = useState(true)
  const [off, setOff] = useState(false)
  const [text, setText] = useState('')
  const [draft, setDraft] = useState('Reads well. Sending it as it stands.')

  return (
    <>
      <Section name="Shell / ShellBody / Peer" note="the pistachio ground is the page, the plate is the app">
        <Item label="desktop: rail, working column, docked peer" wide>
          <div className="gal-shell-scroll"><div className="gal-shell" data-w="desktop">
            <Shell
              layout="desktop"
              rail={
                <Rail top={<><Avatar name="Ivan Manfredi" initials="IM" /><IconButton icon="collapse" label="Collapse the rail" size="sm" /></>}>
                  <RailItem icon="today" label="Today" active markerId="gal-shell-rail" />
                  <RailItem icon="dms" label="DMs" count={12} markerId="gal-shell-rail" />
                  <RailItem icon="content" label="Content" count={4} markerId="gal-shell-rail" />
                  <RailItem icon="sends" label="Lanes" count={3} sev="attention" markerId="gal-shell-rail" />
                  <RailItem icon="ops" label="Ops" count={2} sev="urgent" markerId="gal-shell-rail" />
                </Rail>
              }
              peer={
                <Peer>
                  <Header title="Claude" sub="Docked beside your work" tail={<IconButton icon="close" label="Undock" size="sm" />} />
                  <div className="ds-col-body">
                    <Card tone="quiet" title="Reading the thread" sub="Two files, one search." />
                  </div>
                  <Composer value="" onChange={() => {}} onSend={() => {}} mode="empty" placeholder="Ask about anything on this screen" />
                </Peer>
              }
            >
              <Header title="Today" sub="Four waiting on you" tail={<IconButton icon="refresh" label="Refresh" />} />
              <ShellBody>
                <List aria-label="Today">
                  <ListRow onClick={() => {}} anchor={<Avatar name="Nadia Berger" initials="NB" tint={1} />} title="Nadia Berger" sub="Asked what the second seat covers" tail={<span className="ds-t-mono">09:41</span>} />
                  <ListRow onClick={() => {}} unread anchor={<Avatar name="Tomas Reiner" initials="TR" tint={2} />} title="Tomas Reiner" sub="Replied to the audit offer" tail={<span className="ds-t-mono">08:12</span>} />
                  <ListRow onClick={() => {}} sev="urgent" anchor={<Icon name="blocked" size={20} />} title="A workflow stopped" sub="Red means a stopped thing." tail={<Chip tone="urgent">Failed</Chip>} />
                </List>
              </ShellBody>
            </Shell>
          </div></div>
        </Item>
        <Item label="phone: header, pager, tab bar">
          <div className="gal-shell" data-w="phone">
            <Shell layout="phone" tabBar={<TabBar items={NAV} active="today" onSelect={() => {}} markerId="gal-tabbar-shell" />}>
              <Header title="Today" sub="Four waiting on you" lead={<Avatar name="Ivan Manfredi" initials="IM" size="sm" />} tail={<IconButton icon="search" label="Search" size="sm" />} />
              <ShellBody>
                <List aria-label="Today">
                  <ListRow onClick={() => {}} anchor={<Avatar name="Nadia Berger" initials="NB" tint={1} />} title="Nadia Berger" sub="Asked what the second seat covers" />
                  <ListRow onClick={() => {}} unread anchor={<Avatar name="Tomas Reiner" initials="TR" tint={2} />} title="Tomas Reiner" sub="Replied to the audit offer" />
                </List>
              </ShellBody>
            </Shell>
          </div>
        </Item>
      </Section>

      <Section name="Colour roles" note="tokens.css is the only file with a literal">
        <div className="gal-swatches">
          {[
            ['ground', '--ds-ground'], ['canvas', '--ds-canvas'],
            ['surface 1', '--ds-surface-1'], ['surface 2', '--ds-surface-2'],
            ['surface 3', '--ds-surface-3'], ['accent', '--ds-accent'],
            ['accent soft', '--ds-accent-soft'], ['clear', '--ds-sev-clear'],
            ['attention', '--ds-sev-attention'], ['urgent', '--ds-sev-urgent'],
            ['text', '--ds-text'], ['text 2', '--ds-text-2'],
            ['text 3', '--ds-text-3'], ['text 4', '--ds-text-4'],
          ].map(([label, v]) => (
            <span key={v} className="gal-sw">
              <i style={{ background: `var(${v})` }} />
              <span className="gal-label">{label}</span>
            </span>
          ))}
        </div>
      </Section>

      <Section name="Type ladder" note={compact ? 'desktop compact' : 'phone / desktop comfortable'}>
        <div className="gal-item" data-wide="true">
          <div className="ds-stack-v">
            <span className="ds-t-display">Display</span>
            <span className="ds-t-figure">1,284</span>
            <span className="ds-t-page">Page title</span>
            <span className="ds-t-title">Row title</span>
            <span className="ds-t-body">Body. The size a sentence is read at.</span>
            <span className="ds-t-meta">Meta, the second line under a title.</span>
            <span className="ds-t-eyebrow">Eyebrow above a group</span>
            <span className="ds-t-mono">09:41 · 1,284 · a7f3c9</span>
          </div>
        </div>
      </Section>

      <Section name="Icon" note="lucide-react · 16 / 20 / 24 · stroke 1.75">
        <Item label="sizes">
          <div className="ds-stack-h">
            <Icon name="today" size={16} /><Icon name="today" size={20} /><Icon name="today" size={24} />
          </div>
        </Item>
        <div className="gal-item" data-wide="true" data-gal-state="the set">
          <span className="gal-label">the set ({ICON_NAMES.length} names)</span>
          <div className="gal-icons">
            {ICON_NAMES.map((n) => (
              <span key={n} className="gal-icon"><Icon name={n} size={20} /><span>{n}</span></span>
            ))}
          </div>
        </div>
      </Section>

      <Section name="Button">
        <Item label="default"><Button icon="check">Approve</Button></Item>
        <Item label="primary"><Button variant="primary" icon="send">Send it</Button></Item>
        <Item label="quiet"><Button variant="quiet">Cancel</Button></Item>
        <Item label="outline"><Button variant="outline" icon="refresh">Retry</Button></Item>
        <Item label="danger"><Button variant="danger" icon="discard">Delete</Button></Item>
        <Item label="busy"><Button variant="primary" busy>Writing</Button></Item>
        <Item label="disabled"><Button disabled>Approve</Button></Item>
        <Item label="small"><Button size="sm">Skip</Button></Item>
        <Item label="large"><Button size="lg" variant="primary">Approve and post</Button></Item>
      </Section>

      <Section name="IconButton" note="every one carries a label">
        <Item label="ghost"><IconButton icon="more" label="More" /></Item>
        <Item label="solid"><IconButton icon="refresh" label="Refresh" variant="solid" /></Item>
        <Item label="accent round"><IconButton icon="send" label="Send" variant="accent" round /></Item>
        <Item label="danger"><IconButton icon="discard" label="Discard" variant="danger" /></Item>
        <Item label="active"><IconButton icon="mic" label="Dictate" active /></Item>
        <Item label="small"><IconButton icon="close" label="Close" size="sm" /></Item>
        <Item label="disabled"><IconButton icon="send" label="Send" disabled /></Item>
      </Section>

      <Section name="Chip">
        <Item label="neutral"><Chip icon="time">Posts 09:00</Chip></Item>
        <Item label="quiet"><Chip tone="quiet">Carousel</Chip></Item>
        <Item label="accent"><Chip tone="accent" icon="check">Approved</Chip></Item>
        <Item label="clear"><Chip tone="clear">Sent</Chip></Item>
        <Item label="attention"><Chip tone="attention" icon="alert">Held</Chip></Item>
        <Item label="urgent"><Chip tone="urgent" icon="blocked">Failed</Chip></Item>
        <Item label="selected filter"><Chip onClick={() => {}} selected count={12}>Waiting</Chip></Item>
        <Item label="removable"><Chip onRemove={() => {}}>rise dtc</Chip></Item>
      </Section>

      <Section name="Badge">
        <Item label="count"><Badge>7</Badge></Item>
        <Item label="ring"><Badge variant="ring">7</Badge></Item>
        <Item label="accent"><Badge tone="accent">3</Badge></Item>
        <Item label="attention"><Badge tone="attention">2</Badge></Item>
        <Item label="urgent"><Badge tone="urgent">1</Badge></Item>
        <Item label="dot"><Badge variant="dot" tone="urgent" label="A workflow stopped" /></Item>
      </Section>

      <Section name="Avatar">
        <Item label="small"><Avatar name="Ivan Manfredi" initials="IM" size="sm" /></Item>
        <Item label="medium"><Avatar name="Ivan Manfredi" initials="IM" /></Item>
        <Item label="large"><Avatar name="Ivan Manfredi" initials="IM" size="lg" /></Item>
        <Item label="tint 1"><Avatar name="Nadia Berger" initials="NB" tint={1} /></Item>
        <Item label="tint 2"><Avatar name="Tomas Reiner" initials="TR" tint={2} /></Item>
        <Item label="tint 4"><Avatar name="Priya Raman" initials="PR" tint={4} /></Item>
        <Item label="live"><Avatar name="Claude" initials="C" tint={1} live /></Item>
      </Section>

      <Section name="Kbd">
        <Item label="chord">
          <span className="ds-stack-h"><Kbd><Icon name="cmd" size={16} /></Kbd><Kbd>K</Kbd></span>
        </Item>
        <Item label="single"><Kbd>j</Kbd></Item>
      </Section>

      <Section name="Working / LiveDot">
        <Item label="live"><Working>Reading four memory files</Working></Item>
        <Item label="settled"><Working live={false}>Read four files, ran two searches</Working></Item>
        <Item label="live dot"><LiveDot label="Claude is working" /></Item>
      </Section>

      <Section name="Switch">
        <Item label="on"><Switch checked={on} onChange={setOn} label="Push notifications" /></Item>
        <Item label="off"><Switch checked={off} onChange={setOff} label="New reply sound" /></Item>
        <Item label="busy"><Switch checked onChange={() => {}} label="Push" busy /></Item>
        <Item label="disabled"><Switch checked={false} onChange={() => {}} label="Push" disabled /></Item>
      </Section>

      <Section name="Segmented">
        <Item label="three arms">
          <Segmented
            label="Frame"
            markerId="gal-seg-1"
            value={seg}
            onChange={setSeg}
            options={[{ id: 'all', label: 'Wide' }, { id: 'mine', label: 'Tight' }, { id: 'held', label: 'Flush' }]}
          />
        </Item>
        <Item label="with counts">
          <Segmented
            label="Lane"
            markerId="gal-seg-2"
            value="ivan"
            onChange={() => {}}
            options={[{ id: 'ivan', label: 'Ivan', count: 8 }, { id: 'rise', label: 'Rise', count: 3 }]}
          />
        </Item>
      </Section>

      <Section name="Tabs">
        <Item label="stage tabs with counts" wide>
          <Tabs
            label="Stage"
            markerId="gal-tabs"
            value={tab}
            onChange={setTab}
            options={[
              { id: 'ideas', label: 'Ideas', count: 14 },
              { id: 'review', label: 'Review', count: 4 },
              { id: 'ready', label: 'Ready', count: 2 },
              { id: 'failed', label: 'Failed', count: 1, sev: 'urgent' },
            ]}
          />
        </Item>
      </Section>

      <Section name="Input">
        <Item label="default"><Input label="Search" placeholder="Search this list" icon="search" /></Item>
        <Item label="with hint"><Input label="Slot" placeholder="09:00" hint="The first free morning." /></Item>
        <Item label="invalid"><Input label="Slot" defaultValue="25:00" error="That is not a time." /></Item>
        <Item label="disabled"><Input label="Lane" defaultValue="rise" disabled /></Item>
        <Item label="mono"><Input label="Draft id" defaultValue="bdc81411" mono /></Item>
      </Section>

      <Section name="Textarea">
        <Item label="default" wide>
          <Textarea label="Reply" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />
        </Item>
        <Item label="empty with hint" wide>
          <Textarea label="Angle" placeholder="Write the angle the post gets written from." hint="Edit before approving." rows={2} />
        </Item>
      </Section>

      <Section name="ListRow" note="the container draws the hairline, the row draws a wash">
        <div className="gal-item" data-wide="true" data-gal-state="states">
          <span className="gal-label">default · unread · focused · selected · attention · urgent</span>
          <List aria-label="Rows">
            <ListRow
              onClick={() => {}}
              anchor={<Avatar name={ROWS[0].who} initials="NB" tint={1} />}
              title={ROWS[0].who}
              sub={ROWS[0].what}
              meta={<><Chip tone="quiet">DM</Chip><Chip>Rise</Chip></>}
              tail={<span className="ds-t-mono">{ROWS[0].when}</span>}
              actions={<IconButton icon="discard" label="Discard" size="sm" />}
            />
            <ListRow onClick={() => {}} unread anchor={<Avatar name={ROWS[1].who} initials="TR" tint={2} />}
              title={ROWS[1].who} sub={ROWS[1].what}
              tail={<span className="ds-t-mono">{ROWS[1].when}</span>} />
            <ListRow onClick={() => {}} focused anchor={<Avatar name={ROWS[2].who} initials="PR" tint={3} />}
              title={ROWS[2].who} sub={ROWS[2].what}
              tail={<Badge tone="accent">new</Badge>} />
            <ListRow onClick={() => {}} selected anchor={<Icon name="checked" size={20} />}
              title="Selected row" sub="Carries the accent tint, never the fill." />
            <ListRow onClick={() => {}} sev="attention" anchor={<Icon name="alert" size={20} />}
              title="A lane is held" sub="The stripe says which severity, the chip says why."
              tail={<Chip tone="attention">Held</Chip>} />
            <ListRow onClick={() => {}} sev="urgent" anchor={<Icon name="blocked" size={20} />}
              title="A workflow stopped" sub="Red means a stopped thing, never a backlog."
              tail={<Chip tone="urgent">Failed</Chip>} />
          </List>
        </div>
      </Section>

      <Section name="Divider / DayHeader">
        <Item label="day header" wide>
          <div className="gal-panel">
            <DayHeader label="Today" tail="4" />
            <Divider />
            <DayHeader label="Yesterday" tail="11" />
          </div>
        </Item>
      </Section>

      <Section name="Card">
        <Item label="default">
          <Card
            lead={<Avatar name="Nadia Berger" initials="NB" tint={1} />}
            title="Nadia Berger replied"
            sub="Two hours ago"
            foot={<><Button size="sm" variant="primary">Approve</Button><Button size="sm" variant="quiet">Discard</Button></>}
          >
            <span className="ds-t-body">Asked what the second seat covers and whether it changes the price.</span>
          </Card>
        </Item>
        <Item label="quiet">
          <Card tone="quiet" title="No screenshot captured yet" sub="The harvest ran, the shot did not land." />
        </Item>
        <Item label="raised + selected">
          <Card tone="raised" selected title="Selected" sub="An accent hairline, never a fill." onClick={() => {}} />
        </Item>
      </Section>

      <Section name="SectionCard / SettingRow">
        <Item label="settings group" wide>
          <SectionCard label="Notifications">
            <SettingRow label="Push notifications" hint="On this device." control={<Switch checked={on} onChange={setOn} label="Push notifications" />} />
            <SettingRow label="New reply sound" hint="Plays when a reply lands." control={<Switch checked={off} onChange={setOff} label="New reply sound" />} />
            <SettingRow label="Theme" control={<Segmented label="Theme" markerId="gal-seg-theme" value="dark" onChange={() => {}} options={[{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }]} />} />
            <SettingRow tone="danger" label="Sign out" hint="Ends the session on this device." control={<Button variant="danger" size="sm" icon="signOut">Sign out</Button>} />
          </SectionCard>
        </Item>
      </Section>

      <Section name="Table" note="mono numerals, right aligned, sticky header">
        <Item label="rows + selection" wide>
          <Table
            label="Sends"
            rows={[
              { id: 's1', lane: 'Rise warm', sent: 42, replied: 11, rate: '26.2%', state: 'Running' },
              { id: 's2', lane: 'Arch cold', sent: 118, replied: 9, rate: '7.6%', state: 'Running' },
              { id: 's3', lane: 'Poland probe', sent: 0, replied: 0, rate: 'No reading', state: 'Held' },
            ]}
            rowKey={(r) => r.id}
            isSelected={(r) => r.id === 's2'}
            onRowClick={() => {}}
            columns={[
              { id: 'lane', header: 'Lane', cell: (r) => <span className="ds-t-body">{r.lane}</span> },
              { id: 'state', header: 'State', cell: (r) => <Chip tone={r.state === 'Held' ? 'attention' : 'quiet'}>{r.state}</Chip> },
              { id: 'sent', header: 'Sent', numeric: true, cell: (r) => r.sent },
              { id: 'replied', header: 'Replied', numeric: true, cell: (r) => r.replied },
              { id: 'rate', header: 'Reply rate', numeric: true, cell: (r) => r.rate },
            ]}
          />
        </Item>
      </Section>

      <Section name="StatTile">
        <Item label="up"><StatTile label="Replies" value="42" delta={{ dir: 'up', text: '+8' }} note="Last seven days" spark={[.3, .5, .4, .7, .6, .9, 1]} /></Item>
        <Item label="down"><StatTile label="Accept rate" value="9.3%" delta={{ dir: 'down', text: '-1.4' }} note="Cold lane" /></Item>
        <Item label="flat"><StatTile label="Calls booked" value="3" delta={{ dir: 'flat', text: 'same' }} /></Item>
        <Item label="no reading"><StatTile label="Impressions" note="The read did not land." tone="quiet" /></Item>
      </Section>

      <Section name="Stepper">
        <Item label="four stages" wide>
          <Stepper
            label="Draft stage"
            steps={[
              { id: '1', label: 'Idea', state: 'done' },
              { id: '2', label: 'Written', state: 'done' },
              { id: '3', label: 'In review', state: 'current' },
              { id: '4', label: 'Scheduled', state: 'todo' },
            ]}
          />
        </Item>
      </Section>

      <Section name="Banner">
        <Item label="neutral" wide><Banner icon="time" title="Two comments queued">The poster takes one at a time. Leave the tab open.</Banner></Item>
        <Item label="accent" wide><Banner tone="accent" icon="check" title="On his board">Nothing published and no date was set.</Banner></Item>
        <Item label="attention" wide><Banner tone="attention" icon="alert" title="A seat is paused" action={<Button size="sm" variant="outline">Open it</Button>}>Sends resume when the window opens.</Banner></Item>
        <Item label="urgent" wide><Banner tone="urgent" icon="blocked" title="The ops queue did not load" action={<Button size="sm" variant="outline" icon="refresh">Try again</Button>} onDismiss={() => {}}>Nothing was lost. This is a read, not a write.</Banner></Item>
      </Section>

      <Section name="EmptyState">
        <Item label="plain">
          <EmptyState icon="inbox" title="Nothing waiting on you" sub="Comment replies, reports and escalations all clear. This is a live read, not a stall." action={<Button size="sm" variant="quiet" icon="refresh">Check again</Button>} />
        </Item>
        <Item label="with ghost rows">
          <EmptyState icon="doc" title="Nothing here yet" sub="The first draft lands as soon as the writer finishes." ghosts />
        </Item>
      </Section>

      <Section name="Skeleton">
        <Item label="shapes">
          <span className="ds-stack-h">
            <Skeleton shape="circle" /><Skeleton shape="line" width="120px" /><Skeleton shape="title" width="80px" />
          </span>
        </Item>
        <Item label="rows" wide><SkeletonRows rows={3} /></Item>
        <Item label="block"><Skeleton shape="block" width="220px" /></Item>
      </Section>

      <Section name="Composer">
        <Item label="empty" wide>
          <Composer value="" onChange={() => {}} onSend={() => {}} onAttach={() => {}} onDictate={() => {}} mode="empty" placeholder="Ask about anything on this screen" note="Enter sends." />
        </Item>
        <Item label="ready with tray" wide>
          <Composer
            value={text || 'Draft the reply to Nadia'}
            onChange={setText}
            onSend={() => {}}
            onAttach={() => {}}
            onDictate={() => {}}
            mode="ready"
            tray={<><Chip icon="image" onRemove={() => {}}>board.png</Chip><Chip icon="doc" onRemove={() => {}}>brief.pdf</Chip></>}
          />
        </Item>
        <Item label="busy" wide>
          <Composer value="Reading the thread" onChange={() => {}} onSend={() => {}} onStop={() => {}} mode="busy" note="Stop ends this turn." />
        </Item>
        <Item label="recording" wide>
          <Composer
            value=""
            onChange={() => {}}
            onSend={() => {}}
            onDictate={() => {}}
            mode="recording"
            tray={<><LevelMeter elapsed={2.4} /><span className="ds-t-mono">Listening. 12s</span></>}
          />
        </Item>
      </Section>

      <Section name="CommandList">
        <Item label="grouped, with an unavailable command" wide>
          <CommandList
            head={<Input label="Command" labelHidden placeholder="Type a command" icon="search" />}
            activeId="c2"
            groups={[
              {
                id: 'move', label: 'Move', items: [
                  { id: 'c1', label: 'Next row', icon: 'down', keys: ['j'] },
                  { id: 'c2', label: 'Open the focused row', icon: 'enter', keys: ['Enter'] },
                  { id: 'c3', label: 'Command palette', icon: 'cmd', keys: ['Cmd', 'K'] },
                ],
              },
              {
                id: 'act', label: 'Act', items: [
                  { id: 'c4', label: 'Approve the selected drafts', icon: 'approve' },
                  { id: 'c5', label: 'Delete the selected drafts', icon: 'discard', ready: false, reason: 'Nothing is selected.' },
                ],
              },
            ]}
            foot={<span className="ds-stack-h"><Kbd><Icon name="up" size={16} /></Kbd><Kbd><Icon name="down" size={16} /></Kbd> to move, Enter to run, Esc to close</span>}
          />
        </Item>
      </Section>

      <Section name="Popover">
        <Item label="menu">
          <div className="gal-stage" data-h="sm">
            <Popover open label="Row actions" style={{ top: 16, left: 16 }}>
              <PopoverItem icon="open">Open the post</PopoverItem>
              <PopoverItem icon="copy">Copy the link</PopoverItem>
              <PopoverItem icon="scheduled">Change the slot</PopoverItem>
              <PopoverItem icon="discard" tone="danger">Discard</PopoverItem>
            </Popover>
          </div>
        </Item>
      </Section>

      <Section name="Toast">
        <Item label="stack with undo" wide>
          <div className="gal-stage" data-h="md">
            <ToastStack
              onDismiss={() => {}}
              items={[
                { id: 't1', icon: 'check', tone: 'clear', message: 'Draft approved', actionLabel: 'Undo', onAction: () => {} },
                { id: 't2', icon: 'alert', tone: 'attention', message: 'One row could not be changed' },
              ]}
            />
          </div>
        </Item>
      </Section>

      <Section name="BulkBar">
        <Item label="selection · partial · running" wide>
          <div className="gal-stage" data-h="lg">
            <BulkBar
              open
              count="3 drafts selected"
              note="Some of these rows cannot take every action. A bulk action runs on all three or none."
              actions={<><Button size="sm" variant="primary">Approve 3</Button><Button size="sm">Skip 3</Button><Button size="sm" variant="danger">Delete 3</Button></>}
              onSelectAll={() => {}}
              selectAllLabel="Select all 12"
              onClear={() => {}}
              progress={{ done: 2, total: 3 }}
            />
          </div>
        </Item>
      </Section>

      <Section name="Dialog">
        <Item label="confirm" wide>
          <div className="gal-stage" data-h="md">
            <Dialog open onClose={() => {}} title="Skip three drafts?" sub="Each one leaves the queue. This screen has no way to bring them back." confirmLabel="Skip 3" onConfirm={() => {}} />
          </div>
        </Item>
        <Item label="danger" wide>
          <div className="gal-stage" data-h="md">
            <Dialog open onClose={() => {}} danger title="Delete three drafts?" sub="This removes them for good. There is no undo." confirmLabel="Delete 3" onConfirm={() => {}} />
          </div>
        </Item>
      </Section>

      <Section name="Sheet">
        <Item label="snap point with a foot" wide>
          <div className="gal-stage" data-h="lg">
            <Sheet
              open
              onClose={() => {}}
              title="Push it later"
              sub="Pick when this comes back."
              foot={<><Button variant="quiet">Cancel</Button><Button variant="primary">Set it</Button></>}
            >
              <List aria-label="When">
                <ListRow onClick={() => {}} title="This evening" tail={<span className="ds-t-mono">18:00</span>} />
                <ListRow onClick={() => {}} title="Tomorrow morning" tail={<span className="ds-t-mono">09:00</span>} />
                <ListRow onClick={() => {}} title="Next Monday" tail={<span className="ds-t-mono">09:00</span>} />
              </List>
            </Sheet>
          </div>
        </Item>
      </Section>

      <Section name="Header">
        <Item label="title, predicate, actions" wide>
          <div className="gal-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <Header
              title="Ops"
              sub="Four waiting on you"
              lead={<Avatar name="Ivan Manfredi" initials="IM" />}
              tail={<><IconButton icon="search" label="Search" /><IconButton icon="refresh" label="Refresh" /></>}
            />
          </div>
        </Item>
      </Section>

      <Section name="Rail" note="grouped nav, counts, severity pips, sliding highlight">
        <Item label="expanded">
          <div className="gal-panel" style={{ padding: 0, width: 240 }}>
            <Rail
              top={<><Avatar name="Ivan Manfredi" initials="IM" /><IconButton icon="collapse" label="Collapse the rail" size="sm" /></>}
              footer={<><RailSeparator /><RailItem icon="settings" label="Settings" markerId="gal-rail-a" /></>}
            >
              <RailItem icon="today" label="Today" active markerId="gal-rail-a" />
              <RailItem icon="dms" label="DMs" count={12} countNote="12 conversations waiting on a reply" markerId="gal-rail-a" />
              <RailGroup label="Content">
                <RailItem icon="content" label="Content" nested count={4} markerId="gal-rail-a" />
                <RailItem icon="magnets" label="Magnets" nested markerId="gal-rail-a" />
                <RailItem icon="styles" label="Styles" nested markerId="gal-rail-a" />
                <RailItem icon="strategy" label="Strategy" nested markerId="gal-rail-a" />
              </RailGroup>
              <RailItem icon="sends" label="Lanes" count={3} sev="attention" markerId="gal-rail-a" />
              <RailItem icon="ops" label="Ops" count={2} sev="urgent" markerId="gal-rail-a" />
              <RailSeparator />
              <RailItem icon="ask" label="Claude" tail={<LiveDot label="Claude is working" />} markerId="gal-rail-a" />
            </Rail>
          </div>
        </Item>
        <Item label="collapsed">
          <div className="gal-panel" style={{ padding: 0, width: 72 }}>
            <Rail collapsed top={<IconButton icon="expand" label="Expand the rail" size="sm" />}>
              <RailItem icon="today" label="Today" active collapsed markerId="gal-rail-b" />
              <RailItem icon="dms" label="DMs" count={12} collapsed markerId="gal-rail-b" />
              <RailItem icon="sends" label="Lanes" count={3} sev="attention" collapsed markerId="gal-rail-b" />
              <RailItem icon="ops" label="Ops" count={2} sev="urgent" collapsed markerId="gal-rail-b" />
              <RailItem icon="settings" label="Settings" collapsed markerId="gal-rail-b" />
            </Rail>
          </div>
        </Item>
      </Section>

      <Section name="TabBar" note="the active place expands, the highlight slides">
        <Item label="six places" wide>
          <div className="gal-panel" style={{ padding: 0, maxWidth: 390 }}>
            <TabBar items={NAV} active="today" onSelect={() => {}} markerId="gal-tabbar-solo" />
          </div>
        </Item>
      </Section>
    </>
  )
}
