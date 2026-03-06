type ParseFn<T> = (input: unknown) => T;

export class ZodType<T> {
  constructor(protected readonly parser: ParseFn<T>) {}

  parse(input: unknown): T {
    return this.parser(input);
  }

  optional(): ZodType<T | undefined> {
    return new ZodType<T | undefined>((input) => {
      if (typeof input === 'undefined') return undefined;
      return this.parse(input);
    });
  }

  default(defaultValue: T): ZodType<T> {
    return new ZodType<T>((input) => {
      if (typeof input === 'undefined') return defaultValue;
      return this.parse(input);
    });
  }
}

class ZodString extends ZodType<string> {
  min(minLength: number): ZodString {
    return new ZodString((input) => {
      const value = this.parse(input);
      if (value.length < minLength) throw new Error(`Expected at least ${minLength} characters`);
      return value;
    });
  }
}

type Shape = Record<string, ZodType<unknown>>;
type InferShape<T extends Shape> = { [K in keyof T]: T[K] extends ZodType<infer U> ? U : never };

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

export const z = {
  string() {
    return new ZodString((input) => {
      if (typeof input !== 'string') throw new Error('Expected string');
      return input;
    });
  },
  boolean() {
    return new ZodType<boolean>((input) => {
      if (typeof input !== 'boolean') throw new Error('Expected boolean');
      return input;
    });
  },
  object<T extends Shape>(shape: T) {
    return new ZodType<InferShape<T>>((input) => {
      if (!isRecord(input)) throw new Error('Expected object');
      const out: Record<string, unknown> = {};
      for (const [key, parser] of Object.entries(shape)) {
        out[key] = parser.parse(input[key]);
      }
      return out as InferShape<T>;
    });
  },
  array<T>(item: ZodType<T>) {
    return new ZodType<T[]>((input) => {
      if (!Array.isArray(input)) throw new Error('Expected array');
      return input.map(entry => item.parse(entry));
    });
  },
  union<T extends readonly [ZodType<unknown>, ...ZodType<unknown>[]]>(types: T) {
    return new ZodType<T[number] extends ZodType<infer U> ? U : never>((input) => {
      for (const type of types) {
        try {
          return type.parse(input) as never;
        } catch {
          continue;
        }
      }
      throw new Error('No union variant matched');
    });
  },
  record(_keyType: ZodString, valueType: ZodString) {
    return new ZodType<Record<string, string>>((input) => {
      if (!isRecord(input)) throw new Error('Expected record');
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(input)) out[k] = valueType.parse(v);
      return out;
    });
  },
  enum<T extends [string, ...string[]]>(values: T) {
    return new ZodType<T[number]>((input) => {
      if (typeof input !== 'string' || !values.includes(input)) throw new Error('Expected enum value');
      return input as T[number];
    });
  },
};

export type infer<T extends ZodType<unknown>> = T extends ZodType<infer U> ? U : never;
