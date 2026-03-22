/** @jsx h */
export function dynamicCheckbox(label: string, enabled: boolean) {
  return (
    <form>
      <input type="checkbox" checked={enabled} />
      <label>{label}</label>
    </form>
  );
}
