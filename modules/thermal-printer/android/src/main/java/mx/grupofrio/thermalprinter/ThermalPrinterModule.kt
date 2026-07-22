package mx.grupofrio.thermalprinter

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ThermalPrinterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KoldThermalPrinter")

    AsyncFunction("getBluetoothState") {
      bluetoothDirectory().getBluetoothState().wireValue
    }

    AsyncFunction("getBondedDevices") {
      bluetoothDirectory().getBondedDevices().map { device ->
        mapOf(
          "name" to device.name,
          "address" to device.address,
        )
      }
    }
  }

  private fun bluetoothDirectory(): BluetoothDeviceDirectory {
    val reactContext = appContext.reactContext ?: throw bluetoothUnsupported()
    return BluetoothDeviceDirectory(reactContext.applicationContext)
  }
}
