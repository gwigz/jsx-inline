/** @jsx h */
export function styledBox(content: string) {
  return (
    <div>
      <style>{`.container { color: red } .title { font-weight: bold }`}</style>
      <div class="container" id="main-box">
        <span class="title">{content}</span>
      </div>
    </div>
  );
}
