export function TableBlock(props: { title?: string | undefined; columns: string[]; rows: Array<Array<string | number | boolean | null>> }) {
  return (
    <div className="table-shell">
      {props.title ? <h3>{props.title}</h3> : null}
      <table>
        <thead><tr>{props.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>
          {props.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{String(cell ?? "")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
