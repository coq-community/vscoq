export function makeBreakingText(text: string): Text[] {
  var txt = //makeElement('span',{class:'breakText',ondblclick: ''},
    // document.createTextNode(Array.prototype.map.call(text, (c) => /[\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/.test(c) ? ' ' : c).join(''));
    document.createTextNode(
      text.replace(
        /[\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g,
        " "
      )
    );
  //);
  // txt.ondblclick = onDoubleClickBreakableText;
  return [txt];
}
