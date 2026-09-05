import type { ReactNode } from 'react'
import { cx } from './util'

export interface TableColumn<Row> {
  id: string
  header: ReactNode
  /** Numbers are mono, tabular and right-aligned so a column reads as a column. */
  numeric?: boolean
  align?: 'start' | 'end'
  width?: string
  cell: (row: Row) => ReactNode
}

export interface TableProps<Row> {
  columns: Array<TableColumn<Row>>
  rows: Row[]
  rowKey: (row: Row) => string
  /** Names the table for a screen reader. */
  label: string
  onRowClick?: (row: Row) => void
  isSelected?: (row: Row) => boolean
  /** Rendered in place of the body when there is nothing to show. */
  empty?: ReactNode
  className?: string
}

/** Hairline-separated rows, a sticky header, hover as a wash. No row boxes. */
export function Table<Row>({
  columns, rows, rowKey, label, onRowClick, isSelected, empty, className,
}: TableProps<Row>) {
  if (rows.length === 0 && empty) {
    return <div data-ds="Table" data-empty="true" className={cx('ds-table-wrap', className)}>{empty}</div>
  }
  return (
    <div data-ds="Table" className={cx('ds-table-wrap', className)}>
      <table className="ds-table">
        <caption className="ds-sr">{label}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                data-align={c.numeric ? 'end' : c.align}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              data-interactive={Boolean(onRowClick)}
              data-selected={isSelected?.(r) ?? false}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
            >
              {columns.map((c) => (
                <td key={c.id} data-numeric={c.numeric || undefined} data-align={c.align}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
