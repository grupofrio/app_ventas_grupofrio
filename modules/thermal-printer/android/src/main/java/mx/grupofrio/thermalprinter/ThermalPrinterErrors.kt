package mx.grupofrio.thermalprinter

data class NativePrintProgress(
  val transportBytesWritten: Long = 0,
  val rasterBytesWritten: Long = 0,
  val bandsCompleted: Long = 0,
  val rasterPayloadAttempted: Boolean = false,
) {
  internal fun withRasterPayloadAttempted(): NativePrintProgress =
    if (rasterPayloadAttempted) this else copy(rasterPayloadAttempted = true)

  internal fun afterConfirmedWrite(
    transportBytes: Long,
    rasterBytes: Long,
    completesBand: Boolean,
  ): NativePrintProgress = copy(
    transportBytesWritten = saturatingAdd(transportBytesWritten, transportBytes),
    rasterBytesWritten = saturatingAdd(rasterBytesWritten, rasterBytes),
    bandsCompleted = if (completesBand) saturatingAdd(bandsCompleted, 1) else bandsCompleted,
  )
}

data class NativePrintResult(
  val transportBytesWritten: Long,
  val rasterBytesWritten: Long,
  val bandsCompleted: Long,
  val rasterPayloadAttempted: Boolean,
) {
  internal constructor(progress: NativePrintProgress) : this(
    transportBytesWritten = progress.transportBytesWritten,
    rasterBytesWritten = progress.rasterBytesWritten,
    bandsCompleted = progress.bandsCompleted,
    rasterPayloadAttempted = progress.rasterPayloadAttempted,
  )
}

/** Stable, safe native error details that can be mapped to an Expo rejection. */
class ThermalPrinterException(
  val code: String,
  message: String,
  val phase: String? = null,
  val progress: NativePrintProgress = NativePrintProgress(),
  cause: Throwable? = null,
) : RuntimeException(message, cause)

internal fun invalidTicket(message: String): Nothing =
  throw ThermalPrinterException(INVALID_TICKET_CODE, message)

internal fun ticketTooLarge(message: String): Nothing =
  throw ThermalPrinterException(TICKET_TOO_LARGE_CODE, message)

internal fun bluetoothUnsupported() = ThermalPrinterException(
  code = BLUETOOTH_UNSUPPORTED_CODE,
  message = "Bluetooth is unavailable",
)

internal fun bluetoothDisabled() = ThermalPrinterException(
  code = BLUETOOTH_DISABLED_CODE,
  message = "Bluetooth is turned off",
)

internal fun permissionDenied(cause: SecurityException? = null) = ThermalPrinterException(
  code = PERMISSION_DENIED_CODE,
  message = "Bluetooth permission denied",
  cause = cause,
)

internal fun printerNotBonded() = ThermalPrinterException(
  code = PRINTER_NOT_BONDED_CODE,
  message = "Printer is not bonded",
)

private fun saturatingAdd(current: Long, increment: Long): Long {
  require(current >= 0) { "Progress cannot be negative" }
  require(increment >= 0) { "Progress increment cannot be negative" }
  return if (Long.MAX_VALUE - current < increment) Long.MAX_VALUE else current + increment
}

internal const val INVALID_TICKET_CODE = "invalid_ticket"
internal const val TICKET_TOO_LARGE_CODE = "ticket_too_large"
internal const val CONNECT_TIMEOUT_CODE = "connect_timeout"
internal const val CONNECT_FAILED_CODE = "connect_failed"
internal const val BUSY_CODE = "busy"
internal const val WRITE_TIMEOUT_CODE = "write_timeout"
internal const val WRITE_FAILED_CODE = "write_failed"
internal const val BLUETOOTH_UNSUPPORTED_CODE = "bluetooth_unsupported"
internal const val BLUETOOTH_DISABLED_CODE = "bluetooth_disabled"
internal const val PERMISSION_DENIED_CODE = "permission_denied"
internal const val PRINTER_NOT_BONDED_CODE = "printer_not_bonded"
