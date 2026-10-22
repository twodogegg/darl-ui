import { Button } from './ui'
import { id } from '../data'

export default function OutlineTable({ title, itemLabel, prefix, columns, rows, onChange }) {
  function update(rowId, key, value) {
    onChange(rows.map((row) => row.id === rowId ? { ...row, [key]: value } : row))
  }
  function add() {
    onChange([...rows, {
      id: id(),
      ...Object.fromEntries(columns.map((column) => [column.key, ''])),
    }])
  }
  return (
    <section aria-label={title} className="outline-table-section">
      <h3>{title}</h3>
      <table className="outline-table" aria-label={title}>
        <colgroup>
          <col style={{ width: '6%' }} />
          {columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
          <col style={{ width: '5%' }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">编号</th>
            {columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}
            <th scope="col"><span className="visually-hidden">操作</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const number = `${prefix}${String(index + 1).padStart(2, '0')}`
            return (
              <tr key={row.id}>
                <th scope="row">{number}</th>
                {columns.map((column) => {
                  const label = `${itemLabel} ${number} ${column.label}`
                  return (
                    <td key={column.key} data-label={column.label}>
                      {column.type === 'text' ? (
                        <input aria-label={label} value={row[column.key] ?? ''} maxLength={100} placeholder={column.label} onChange={(e) => update(row.id, column.key, e.target.value)} />
                      ) : (
                        <textarea aria-label={label} value={row[column.key] ?? ''} rows={3} maxLength={10000} placeholder={column.label} onChange={(e) => update(row.id, column.key, e.target.value)} />
                      )}
                    </td>
                  )
                })}
                <td className="outline-row-actions">
                  <Button aria-label={`删除${itemLabel} ${number}`} onClick={() => onChange(rows.filter((item) => item.id !== row.id))}>×</Button>
                </td>
              </tr>
            )
          })}
          {!rows.length && <tr><td colSpan={columns.length + 2} className="outline-table-empty">暂无{itemLabel}，点击下方按钮新增。</td></tr>}
        </tbody>
      </table>
      <Button className="outline-add-row" onClick={add}>＋ 新增{itemLabel}</Button>
    </section>
  )
}
