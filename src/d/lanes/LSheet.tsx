/* The Lanes ledgers (Delivery, Daily ledger, Channels, Send log, Recurring
   problems) were right-hand sheets opened from a key strip. Lanes 3 draws them
   INSIDE the seat's sections. Same component, same reads: under <Inline> the
   sheet renders its body in place (its sub line as the first note), anywhere
   else it is still the sheet. */
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'
import { Sheet as DSheet } from '../ui/Sheet'

const InlineCtx = createContext(false)

export function Inline({ children }: { children: ReactNode }) {
  return <InlineCtx.Provider value>{children}</InlineCtx.Provider>
}

export function useInline(): boolean {
  return useContext(InlineCtx)
}

export function Sheet(props: ComponentProps<typeof DSheet>) {
  const inline = useContext(InlineCtx)
  if (!inline) return <DSheet {...props} />
  return (
    <div className="dl-inl">
      {props.sub != null && <p className="dl-sl dl-dimt">{props.sub}</p>}
      {props.children}
    </div>
  )
}
