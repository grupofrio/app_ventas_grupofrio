import type { SavedThermalPrinterSnapshot } from './thermalPrinter.ts';
import type { NativePrintProgress } from './thermalPrinterTypes.ts';

export type PrinterJobState = 'idle' | 'permission' | 'connecting' | 'sending';
export type OutputKind = 'pdf' | 'printer';

export type OutputToken = Readonly<{
  id: number;
  kind: OutputKind;
}>;

export type OutputGate = Readonly<{
  active: OutputToken | null;
  nextId: number;
}>;

export type ThermalPrinterScreenFlowState = Readonly<{
  jobState: PrinterJobState;
  pickerVisible: boolean;
  selectedPrinter: SavedThermalPrinterSnapshot | null;
}>;

export type ThermalPrinterScreenFlowAction =
  | Readonly<{ type: 'job_state'; value: Exclude<PrinterJobState, 'idle'> }>
  | Readonly<{ type: 'job_finished' }>
  | Readonly<{ type: 'picker_opened' }>
  | Readonly<{ type: 'picker_closed' }>
  | Readonly<{ type: 'selection_loaded'; printer: SavedThermalPrinterSnapshot | null }>
  | Readonly<{ type: 'printer_selected'; printer: SavedThermalPrinterSnapshot }>;

export function createOutputGate(): OutputGate {
  return Object.freeze({ active: null, nextId: 1 });
}

export function beginOutput(
  gate: OutputGate,
  kind: OutputKind,
): Readonly<{ gate: OutputGate; token: OutputToken | null }> {
  if (gate.active !== null) return Object.freeze({ gate, token: null });

  const token = Object.freeze({ id: gate.nextId, kind });
  return Object.freeze({
    gate: Object.freeze({ active: token, nextId: gate.nextId + 1 }),
    token,
  });
}

export function isCurrentOutput(gate: OutputGate, token: OutputToken): boolean {
  return gate.active?.id === token.id && gate.active.kind === token.kind;
}

export function releaseOutput(gate: OutputGate, token: OutputToken): OutputGate {
  if (!isCurrentOutput(gate, token)) return gate;
  return Object.freeze({ active: null, nextId: gate.nextId });
}

function snapshotPrinter(
  printer: SavedThermalPrinterSnapshot | null,
): SavedThermalPrinterSnapshot | null {
  if (printer === null) return null;
  return Object.freeze({
    version: 1,
    name: printer.name,
    address: printer.address,
  });
}

export function createThermalPrinterScreenFlowState(): ThermalPrinterScreenFlowState {
  return Object.freeze({
    jobState: 'idle',
    pickerVisible: false,
    selectedPrinter: null,
  });
}

export function reduceThermalPrinterScreenFlow(
  state: ThermalPrinterScreenFlowState,
  action: ThermalPrinterScreenFlowAction,
): ThermalPrinterScreenFlowState {
  switch (action.type) {
    case 'job_state':
      return Object.freeze({ ...state, jobState: action.value });
    case 'job_finished':
      return Object.freeze({ ...state, jobState: 'idle' });
    case 'picker_opened':
      return Object.freeze({ ...state, pickerVisible: true });
    case 'picker_closed':
      return Object.freeze({ ...state, pickerVisible: false });
    case 'selection_loaded':
      return Object.freeze({ ...state, selectedPrinter: snapshotPrinter(action.printer) });
    case 'printer_selected':
      return Object.freeze({
        ...state,
        pickerVisible: true,
        selectedPrinter: snapshotPrinter(action.printer),
      });
  }
}

export function createExplicitReprintAction(
  progress: Pick<NativePrintProgress, 'rasterPayloadAttempted'>,
  reprint: () => Promise<void>,
): Readonly<{ reprint: () => Promise<void> }> | null {
  if (!progress.rasterPayloadAttempted) return null;
  return Object.freeze({ reprint });
}

export async function openSettingsSafely(
  openSettings: () => Promise<unknown>,
  onFailure: () => void,
): Promise<void> {
  try {
    await openSettings();
  } catch {
    onFailure();
  }
}
