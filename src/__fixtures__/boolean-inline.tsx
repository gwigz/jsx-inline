/** @jsx h */
export function toggleRow(name: string, active: boolean) {
  const rows: string[] = [];
  rows.push(<input type="checkbox" checked={active} name={name} />);
  return rows.join("");
}
