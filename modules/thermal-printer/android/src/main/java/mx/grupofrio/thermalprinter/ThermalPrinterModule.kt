package mx.grupofrio.thermalprinter

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class ThermalPrinterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KoldThermalPrinter")

    AsyncFunction("getBluetoothState") { promise: Promise ->
      settleThermalPrinterCall(promise) {
        bluetoothDirectory().getBluetoothState().wireValue
      }
    }

    AsyncFunction("getBondedDevices") { promise: Promise ->
      settleThermalPrinterCall(promise) {
        bluetoothDirectory().getBondedDevices().map { device ->
          mapOf(
            "name" to device.name,
            "address" to device.address,
          )
        }
      }
    }
  }

  private fun bluetoothDirectory(): BluetoothDeviceDirectory {
    val reactContext = appContext.reactContext ?: throw bluetoothUnsupported()
    return BluetoothDeviceDirectory(reactContext.applicationContext)
  }
}

internal fun settleThermalPrinterCall(
  promise: Promise,
  block: () -> Any?,
) {
  try {
    promise.resolve(block())
  } catch (error: ThermalPrinterException) {
    promise.reject(CodedException(error.code, error.toExpoErrorEnvelope(), error))
  }
}

private fun ThermalPrinterException.toExpoErrorEnvelope(): String = JSONObject()
  .put("message", message ?: "Thermal printer failed")
  .put("phase", phase ?: JSONObject.NULL)
  .put(
    "progress",
    JSONObject()
      .put("transportBytesWritten", progress.transportBytesWritten)
      .put("rasterBytesWritten", progress.rasterBytesWritten)
      .put("bandsCompleted", progress.bandsCompleted)
      .put("rasterPayloadAttempted", progress.rasterPayloadAttempted),
  )
  .toString()
