export abstract class ProtocolTypeBase {
  public abstract encode(): string;
}

export type ProtocolSimpleType = ProtocolTypeBase | string | number | boolean;
export type ProtocolType = ProtocolSimpleType | ProtocolSimpleType[];

export function encode(value: ProtocolType): string {
  if (value instanceof ProtocolTypeBase) return value.encode();
  else if (value instanceof Array)
    return `<list>${value.map(v => encode(v)).join("")}</list>`;
  else if (typeof value === "string") return `<string>${value}</string>`;
  else if (typeof value === "number") return `<int>${value}</int>`;
  else if (typeof value === "boolean") return `<bool val="${value}"/>`;
}

export class Pair<
  T1 extends ProtocolType,
  T2 extends ProtocolType
> extends ProtocolTypeBase {
  public readonly value: [T1, T2];
  constructor(v1: T1, v2: T2) {
    super();
    this.value = [v1, v2];
  }
  public encode() {
    return `<pair>${encode(this.value[0])}${encode(this.value[1])}</pair>`;
  }
}

export class Option<T extends ProtocolType> extends ProtocolTypeBase {
  constructor(public readonly value?: T) {
    super();
  }

  public isNone() {
    return this.value === undefined;
  }

  public isSome() {
    return this.value !== undefined;
  }

  public encode() {
    if (this.isSome())
      return `<option val="some">${encode(this.value)}</option>`;
    else return `<option val="none"></option>`;
  }
}

/** This is the stupidest type *EVER*. Wtf were they thinking?! */
export class OptionValue extends ProtocolTypeBase {
  constructor(
    public readonly value:
      | number
      | boolean
      | string
      | Option<string>
      | Option<number>
  ) {
    super();
  }

  public encode() {
    if (this.value instanceof Option && typeof this.value.value === "string")
      return `<option_value val="stringoptvalue">${this.value.encode()}</option_value>`;
    else if (
      this.value instanceof Option &&
      typeof this.value.value === "number"
    )
      return `<option_value val="intvalue">${this.value.encode()}</option_value>`;
    else if (typeof this.value === "number")
      return `<option_value val="intvalue">${encode(
        new Option(this.value)
      )}</option_value>`;
    else if (typeof this.value === "boolean")
      return `<option_value val="boolvalue">${encode(
        this.value
      )}</option_value>`;
    else if (typeof this.value === "string")
      return `<option_value val="stringvalue">${encode(
        this.value
      )}</option_value>`;
  }
}

export class OptionBoolValue extends ProtocolTypeBase {
  constructor(public readonly value: boolean) {
    super();
  }

  public encode() {
    return `<option_value val="boolvalue"><bool val="${
      this.value ? "true" : "false"
    }"/></option_value>`;
  }
}

export class Unit extends ProtocolTypeBase {
  public encode() {
    return `<unit/>`;
  }
}

export class Unknown extends ProtocolTypeBase {
  constructor(public readonly value: ProtocolType) {
    super();
  }
  public encode() {
    return encode(this.value);
  }
}

export class Status extends ProtocolTypeBase {
  constructor(
    /** Module path of the current proof */
    public readonly path: string[],
    /** Current proof name. `None` if no focussed proof is in progress */
    public readonly proofName: Option<string>,
    /** List of all pending proofs. Order is not significant */
    public readonly allProofs: string[],
    /** An id describing the state of the current proof. */
    public readonly proofNumber: number
  ) {
    super();
  }

  // static decode(path: ProtocolType, proofName: ProtocolType, allProofs: ProtocolType, proofNumber: ProtocolType) : Status|Unknown {
  //   if(path instanceof Array && typeof path[0] === 'string' &&
  //     proofName instance)
  // }

  public encode() {
    return `<status>${encode(this.path)}${encode(this.proofName)}${encode(
      this.allProofs
    )}${encode(this.proofNumber)}</status>`;
  }
}
