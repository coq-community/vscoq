import { Position, Range } from "vscode";

// 'sticky' flag is not yet supported :()
const lineEndingRE = /([^\r\n]*)(\r\n|\r|\n)?/;

export interface RangeDelta {
  start: Position;
  end: Position;
  linesDelta: number;
  charactersDelta: number; // delta for positions on the same line as the end position
}

const formatTimSpanNumber = new Intl.NumberFormat(undefined, <
  Intl.NumberFormatOptions
>{ useGrouping: false, minimumIntegerDigits: 2, maximumFractionDigits: 0 });
export function formatTimeSpanMS(durationMS: number) {
  const days = Math.floor(durationMS / 1000 / 60 / 60 / 24);
  const hours = Math.floor(durationMS / 1000 / 60 / 60) - days * 24;
  const minutes = Math.floor(durationMS / 1000 / 60) - hours * 60;
  const seconds = Math.floor(durationMS / 1000) - minutes * 60;

  if (days > 0)
    return `${days}.${formatTimSpanNumber.format(
      hours
    )}:${formatTimSpanNumber.format(minutes)}:${formatTimSpanNumber.format(
      seconds
    )}`;
  else
    return `${hours}:${formatTimSpanNumber.format(
      minutes
    )}:${formatTimSpanNumber.format(seconds)}`;
  // else if(hours > 0)
  //   return `${hours}:${formatTimSpanNumber.format(minutes)}:${formatTimSpanNumber.format(seconds)}`;
  // else if(minutes > 0)
  //   return `${minutes}:${formatTimSpanNumber.format(seconds)}`;
  // else
  //   return `${seconds}`;
}

export function positionIsBefore(pos1: Position, pos2: Position): boolean {
  return (
    pos1.line < pos2.line ||
    (pos1.line === pos2.line && pos1.character < pos2.character)
  );
}

export function positionIsBeforeOrEqual(
  pos1: Position,
  pos2: Position
): boolean {
  return (
    pos1.line < pos2.line ||
    (pos1.line === pos2.line && pos1.character <= pos2.character)
  );
}

export function positionIsAfter(pos1: Position, pos2: Position): boolean {
  return (
    pos1.line > pos2.line ||
    (pos1.line === pos2.line && pos1.character > pos2.character)
  );
}

export function positionIsAfterOrEqual(
  pos1: Position,
  pos2: Position
): boolean {
  return (
    pos1.line > pos2.line ||
    (pos1.line === pos2.line && pos1.character >= pos2.character)
  );
}

export function rangeContains(this: any, range: Range, pos: Position): boolean {
  return (
    !this.positionIsBefore(pos, range.start) &&
    this.positionIsBefore(pos, range.end)
  );
}

export function rangeContainsOrTouches(
  this: any,
  range: Range,
  pos: Position
): boolean {
  return (
    !this.positionIsBeforeOrEqual(pos, range.start) &&
    this.positionIsBeforeOrEqual(pos, range.end)
  );
}

export function rangeIntersects(
  this: any,
  range1: Range,
  range2: Range
): boolean {
  return (
    this.rangeContains(range1, range2.start) ||
    this.rangeContains(range1, range2.end)
  );
}

export function rangeTouches(this: any, range1: Range, range2: Range): boolean {
  return (
    this.rangeContainsOrTouches(range1, range2.start) ||
    this.rangeContainsOrTouches(range1, range2.end)
  );
}

export function locationAt(text: string, pos: Position): number {
  let line = pos.line;
  let lastIndex = 0;
  while (line > 0) {
    const match = lineEndingRE.exec(text.substring(lastIndex));
    if (!match || match[2] === "" || match[2] === undefined)
      // no line-ending found
      return -1;
    // the position is beyond the length of text
    else {
      lastIndex += match[0].length;
      --line;
    }
  }
  return lastIndex + pos.character;
}

/**
 * @returns the Position (line, column) for the location (character position)
 */
export function positionAt(text: string, offset: number): Position {
  if (offset > text.length) offset = text.length;
  let line = 0;
  let lastIndex = 0;
  while (true) {
    const match = lineEndingRE.exec(text.substring(lastIndex));
    if (!match || lastIndex + match[1].length >= offset)
      return new Position(line, offset - lastIndex);
    lastIndex += match[0].length;
    ++line;
  }
}

/**
 * @returns the lines and characters represented by the text
 */
export function toRangeDelta(oldRange: Range, text: string): RangeDelta {
  const newEnd = positionAt(text, text.length);
  let charsDelta;
  if (oldRange.start.line === oldRange.end.line)
    charsDelta =
      newEnd.character - (oldRange.end.character - oldRange.start.character);
  else charsDelta = newEnd.character - oldRange.end.character;

  return {
    start: oldRange.start,
    end: oldRange.end,
    linesDelta: newEnd.line - (oldRange.end.line - oldRange.start.line),
    charactersDelta: charsDelta
  };
}

export function positionRangeDeltaTranslate(
  pos: Position,
  delta: RangeDelta
): Position {
  if (positionIsBefore(pos, delta.end)) return pos;
  else if (delta.end.line === pos.line) {
    let x = pos.character + delta.charactersDelta;
    if (delta.linesDelta > 0) x = x - delta.end.character;
    else if (
      delta.start.line === delta.end.line + delta.linesDelta &&
      delta.linesDelta < 0
    )
      x = x + delta.start.character;
    return new Position(pos.line + delta.linesDelta, x);
  } // if(pos.line > delta.end.line)
  else return new Position(pos.line + delta.linesDelta, pos.character);
}

export function positionRangeDeltaTranslateEnd(
  pos: Position,
  delta: RangeDelta
): Position {
  if (positionIsBeforeOrEqual(pos, delta.end)) return pos;
  else if (delta.end.line === pos.line) {
    let x = pos.character + delta.charactersDelta;
    if (delta.linesDelta > 0) x = x - delta.end.character;
    else if (
      delta.start.line === delta.end.line + delta.linesDelta &&
      delta.linesDelta < 0
    )
      x = x + delta.start.character;
    return new Position(pos.line + delta.linesDelta, x);
  } // if(pos.line > delta.end.line)
  else return new Position(pos.line + delta.linesDelta, pos.character);
}

export function rangeTranslate(range: Range, delta: RangeDelta) {
  return new Range(
    positionRangeDeltaTranslate(range.start, delta),
    positionRangeDeltaTranslateEnd(range.end, delta)
  );
}
