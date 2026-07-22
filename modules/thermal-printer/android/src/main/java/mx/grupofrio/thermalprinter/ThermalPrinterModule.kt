package mx.grupofrio.thermalprinter

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

internal fun interface BondedPrinterVerifier {
  fun requireBonded(address: String)
}

internal fun interface TicketRasterRenderer {
  fun render(ticket: ThermalTicket): MonochromeRaster
}

internal fun interface RasterPrintTransport {
  fun print(address: String, raster: MonochromeRaster): NativePrintResult
}

internal class ThermalPrinterPrintCoordinator(
  private val bondedPrinterVerifier: BondedPrinterVerifier,
  private val renderer: TicketRasterRenderer,
  private val transport: RasterPrintTransport,
  private val diagnosticFactory: DiagnosticTicketFactory = DiagnosticTicketFactory(),
) {
  fun printTicket(
    address: String,
    document: ThermalTicketDocumentRecord,
  ): NativePrintResult {
    // Bonding is deliberately checked before record conversion, logo decoding, layout, or bitmap
    // allocation so a stale selection fails without resource-heavy work.
    bondedPrinterVerifier.requireBonded(address)
    return renderAndPrint(address, document.toDomain(), addDiagnosticMarks = false)
  }

  fun printDiagnostic(
    address: String,
    branding: ThermalTicketBrandingRecord,
  ): NativePrintResult {
    bondedPrinterVerifier.requireBonded(address)
    return renderAndPrint(
      address,
      diagnosticFactory.create(branding.toDomain()),
      addDiagnosticMarks = true,
    )
  }

  private fun renderAndPrint(
    address: String,
    ticket: ThermalTicket,
    addDiagnosticMarks: Boolean,
  ): NativePrintResult {
    val raster = try {
      renderer.render(ticket)
    } catch (error: ThermalPrinterException) {
      throw error
    } catch (_: Exception) {
      invalidTicket("Ticket could not be rendered")
    }
    val finalRaster = if (addDiagnosticMarks) {
      diagnosticFactory.addCalibrationMarks(raster)
    } else {
      raster
    }

    return try {
      transport.print(address, finalRaster)
    } catch (error: ThermalPrinterException) {
      throw error
    } catch (_: IllegalArgumentException) {
      // Encoder precondition failures describe an invalid raster, not a Bluetooth failure.
      invalidTicket("Ticket raster could not be encoded")
    } catch (error: Exception) {
      throw ThermalPrinterException(
        code = WRITE_FAILED_CODE,
        message = "Printer write failed",
        phase = "write",
        cause = error,
      )
    }
  }
}

class ThermalPrinterModule : Module() {
  @Volatile private var cachedPrintCoordinator: ThermalPrinterPrintCoordinator? = null

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

    AsyncFunction("printTicket") {
        address: String,
        document: ThermalTicketDocumentRecord,
        promise: Promise,
      ->
      settleThermalPrinterCall(promise) {
        printCoordinator().printTicket(address, document).toWireValue()
      }
    }

    AsyncFunction("printDiagnostic") {
        address: String,
        branding: ThermalTicketBrandingRecord,
        promise: Promise,
      ->
      settleThermalPrinterCall(promise) {
        printCoordinator().printDiagnostic(address, branding).toWireValue()
      }
    }
  }

  private fun bluetoothDirectory(): BluetoothDeviceDirectory {
    val reactContext = appContext.reactContext ?: throw bluetoothUnsupported()
    return BluetoothDeviceDirectory(reactContext.applicationContext)
  }

  @Synchronized
  private fun printCoordinator(): ThermalPrinterPrintCoordinator {
    cachedPrintCoordinator?.let { return it }
    val reactContext = appContext.reactContext ?: throw bluetoothUnsupported()
    val applicationContext = reactContext.applicationContext
    val directory = BluetoothDeviceDirectory(applicationContext)
    return ThermalPrinterPrintCoordinator(
      bondedPrinterVerifier = BondedPrinterVerifier { address ->
        if (directory.getBondedDevices().none { device ->
            device.address.equals(address, ignoreCase = true)
          }
        ) {
          throw printerNotBonded()
        }
      },
      renderer = TicketRasterRenderer(ThermalTicketRenderer(applicationContext)::render),
      transport = RasterPrintTransport(BluetoothPrinterTransport(applicationContext)::print),
    ).also { cachedPrintCoordinator = it }
  }
}

private fun NativePrintResult.toWireValue(): Map<String, Any> = mapOf(
  "transportBytesWritten" to transportBytesWritten,
  "rasterBytesWritten" to rasterBytesWritten,
  "bandsCompleted" to bandsCompleted,
  "rasterPayloadAttempted" to rasterPayloadAttempted,
)

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
