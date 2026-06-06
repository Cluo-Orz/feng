declare const brandSymbol: unique symbol;

export type Brand<Base, BrandName extends string> = Base & {
  readonly [brandSymbol]: BrandName;
};

export type BrandedString<BrandName extends string> = Brand<string, BrandName>;

function asBrand<BrandName extends string>(value: string): BrandedString<BrandName> {
  return value as BrandedString<BrandName>;
}

export function makeNonEmptyBrand<BrandName extends string>(
  brandName: BrandName,
  value: string
): BrandedString<BrandName> {
  if (value.trim().length === 0) {
    throw new TypeError(`${brandName} cannot be empty`);
  }

  return asBrand<BrandName>(value);
}
