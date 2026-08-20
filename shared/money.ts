export type DecimalValue = string | number | null | undefined;

type DecimalParts = {
  negative: boolean;
  whole: string;
  fraction: string;
};

function parseDecimalParts(value: DecimalValue): DecimalParts | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;

  const raw = String(value).replace(/,/g, "").trim();
  const match = raw.match(
    /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/
  );
  if (!match) return null;

  const negative = match[1] === "-";
  const sourceWhole = match[2] ?? "0";
  const sourceFraction = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] ?? 0);
  if (!Number.isSafeInteger(exponent)) return null;

  const sourceDigits = `${sourceWhole}${sourceFraction}`;
  const decimalIndex = sourceWhole.length + exponent;
  let whole: string;
  let fraction: string;

  if (decimalIndex <= 0) {
    whole = "0";
    fraction = `${"0".repeat(-decimalIndex)}${sourceDigits}`;
  } else if (decimalIndex >= sourceDigits.length) {
    whole = `${sourceDigits}${"0".repeat(decimalIndex - sourceDigits.length)}`;
    fraction = "";
  } else {
    whole = sourceDigits.slice(0, decimalIndex);
    fraction = sourceDigits.slice(decimalIndex);
  }

  whole = whole.replace(/^0+(?=\d)/, "") || "0";
  return { negative, whole, fraction };
}

function assertFractionDigits(fractionDigits: number) {
  if (
    !Number.isInteger(fractionDigits) ||
    fractionDigits < 0 ||
    fractionDigits > 12
  ) {
    throw new RangeError("fractionDigits must be an integer between 0 and 12");
  }
}

function incrementDigits(value: string) {
  const digits = value.split("");
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] !== "9") {
      digits[index] = String(Number(digits[index]) + 1);
      return digits.join("");
    }
    digits[index] = "0";
  }
  return `1${digits.join("")}`;
}

function getRoundedDecimalParts(
  value: DecimalValue,
  fractionDigits: number
): DecimalParts | null {
  assertFractionDigits(fractionDigits);
  const parsed = parseDecimalParts(value);
  if (!parsed) return null;

  const paddedFraction = parsed.fraction.padEnd(fractionDigits, "0");
  const keptFraction = paddedFraction.slice(0, fractionDigits);
  let digits = `${parsed.whole}${keptFraction}`;
  const firstDiscardedDigit = parsed.fraction[fractionDigits] ?? "0";
  if (firstDiscardedDigit >= "5") digits = incrementDigits(digits);

  digits = digits.padStart(fractionDigits + 1, "0");
  const splitIndex = digits.length - fractionDigits;
  return {
    negative: parsed.negative && /[1-9]/.test(digits),
    whole: digits.slice(0, splitIndex) || "0",
    fraction: digits.slice(splitIndex),
  };
}

/**
 * Converts a decimal value to integer minor units using decimal half-up
 * rounding. Parsing the decimal representation avoids IEEE-754 midpoint
 * errors such as 9847.335 becoming 9847.33.
 */
export function decimalToMinorUnits(value: DecimalValue, fractionDigits = 2) {
  const rounded = getRoundedDecimalParts(value, fractionDigits);
  if (!rounded) return 0;
  const units = Number(`${rounded.whole}${rounded.fraction}`);
  if (!Number.isSafeInteger(units)) {
    throw new RangeError("The decimal value exceeds safe integer minor units");
  }
  return rounded.negative ? -units : units;
}

export function roundDecimalAmount(value: DecimalValue, fractionDigits = 2) {
  const rounded = getRoundedDecimalParts(value, fractionDigits);
  if (!rounded) return 0;
  return Number(
    `${rounded.negative ? "-" : ""}${rounded.whole}${
      rounded.fraction ? `.${rounded.fraction}` : ""
    }`
  );
}

export function hasAtMostDecimalPlaces(
  value: DecimalValue,
  fractionDigits: number
) {
  assertFractionDigits(fractionDigits);
  const parsed = parseDecimalParts(value);
  if (!parsed) return false;
  return !/[1-9]/.test(parsed.fraction.slice(fractionDigits));
}

export function formatDecimalAmount(
  value: DecimalValue,
  options: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    useGrouping?: boolean;
  } = {}
) {
  const minimumFractionDigits = options.minimumFractionDigits ?? 2;
  const maximumFractionDigits =
    options.maximumFractionDigits ?? minimumFractionDigits;
  assertFractionDigits(minimumFractionDigits);
  assertFractionDigits(maximumFractionDigits);
  if (maximumFractionDigits < minimumFractionDigits) {
    throw new RangeError(
      "maximumFractionDigits must be greater than or equal to minimumFractionDigits"
    );
  }

  const rounded = getRoundedDecimalParts(value, maximumFractionDigits) ?? {
    negative: false,
    whole: "0",
    fraction: "0".repeat(maximumFractionDigits),
  };
  let whole = rounded.whole;
  let fraction = rounded.fraction;

  while (fraction.length > minimumFractionDigits && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }
  if (options.useGrouping !== false) {
    whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  return `${rounded.negative ? "-" : ""}${whole}${
    fraction ? `.${fraction}` : ""
  }`;
}
