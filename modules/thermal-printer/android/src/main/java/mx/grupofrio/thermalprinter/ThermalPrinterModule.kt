package mx.grupofrio.thermalprinter

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ThermalPrinterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KoldThermalPrinter")
  }
}
