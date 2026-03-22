/** @jsx h */
export function checkboxForm(name: string) {
  return (
    <form>
      <input type="checkbox" checked={true} name={name} />
      <label>{name}</label>
    </form>
  );
}
