/** @jsx h */
export function conditionalRender(show: boolean, label: string) {
  const items: string[] = [];
  if (show) {
    items.push(<p>{label}</p>);
  }
  return items.join("");
}
