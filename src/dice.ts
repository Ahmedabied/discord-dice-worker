export interface DiceSpec {
  count: number;
  sides: number;
  modifier: number;
  notation: string;
}

export interface RollResult {
  values: number[];
  total: number;
}

export type RandomUint32 = () => number;

const ASCII_OUTER_WHITESPACE = "[\\t\\n\\v\\f\\r ]*";
const DICE_PATTERN = new RegExp(
  `^${ASCII_OUTER_WHITESPACE}([0-9]*)[dD]([0-9]+)([+-][0-9]+)?${ASCII_OUTER_WHITESPACE}$`,
);

export function parseDiceNotation(input: string): DiceSpec | null {
  if (input.length > 32) {
    return null;
  }

  const match = DICE_PATTERN.exec(input);
  if (!match) {
    return null;
  }

  const count = match[1] === "" ? 1 : Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] === undefined ? 0 : Number(match[3]);

  if (
    !Number.isSafeInteger(count) ||
    !Number.isSafeInteger(sides) ||
    !Number.isSafeInteger(modifier) ||
    count < 1 ||
    count > 100 ||
    sides < 2 ||
    sides > 1_000 ||
    modifier < -1_000_000 ||
    modifier > 1_000_000
  ) {
    return null;
  }

  const modifierText = modifier > 0 ? `+${modifier}` : modifier < 0 ? String(modifier) : "";
  return {
    count,
    sides,
    modifier,
    notation: `${count}d${sides}${modifierText}`,
  };
}

function secureRandomUint32(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0]!;
}

export function rollDie(sides: number, randomUint32: RandomUint32 = secureRandomUint32): number {
  const range = 0x1_0000_0000;
  const acceptanceLimit = Math.floor(range / sides) * sides;

  let value: number;
  do {
    value = randomUint32();
  } while (value >= acceptanceLimit);

  return (value % sides) + 1;
}

export function rollDice(
  spec: DiceSpec,
  randomUint32: RandomUint32 = secureRandomUint32,
): RollResult {
  const values = Array.from({ length: spec.count }, () => rollDie(spec.sides, randomUint32));
  const total = values.reduce((sum, value) => sum + value, spec.modifier);
  return { values, total };
}

export function formatRoll(spec: DiceSpec, result: RollResult): string {
  return `${spec.notation}: [${result.values.join(", ")}] = ${result.total}`;
}
