import assert from 'node:assert/strict';
import test from 'node:test';

import type ThermalPrinterModule from '../modules/thermal-printer/index.ts';
import type { ThermalPrinterNativeModule } from '../modules/thermal-printer/src/ThermalPrinterModule.ts';

type Assert<Type extends true> = Type;
type IsAny<Type> = 0 extends 1 & Type ? true : false;
type IsExact<Left, Right> =
  (<Type>() => Type extends Left ? 1 : 2) extends
  (<Type>() => Type extends Right ? 1 : 2)
    ? (<Type>() => Type extends Right ? 1 : 2) extends
        (<Type>() => Type extends Left ? 1 : 2)
      ? true
      : false
    : false;

type BoundaryType = typeof ThermalPrinterModule;
type _BoundaryIsNotAny = Assert<IsAny<BoundaryType> extends false ? true : false>;
type _BoundaryIsExact = Assert<
  IsExact<BoundaryType, ThermalPrinterNativeModule | null>
>;

function assertNullable(module: BoundaryType) {
  // @ts-expect-error The optional native boundary must be narrowed before use.
  const available: ThermalPrinterNativeModule = module;
  void available;
}

function assertNoUnimplementedMethods(module: NonNullable<BoundaryType>) {
  // @ts-expect-error The initial scaffold does not expose a print method yet.
  module.print();
}

void assertNullable;
void assertNoUnimplementedMethods;

test('thermal printer boundary keeps its compile-time contract', () => {
  assert.ok(true);
});
