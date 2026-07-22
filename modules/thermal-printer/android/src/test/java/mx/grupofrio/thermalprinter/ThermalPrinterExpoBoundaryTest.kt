package mx.grupofrio.thermalprinter

import expo.modules.kotlin.Promise
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class ThermalPrinterExpoBoundaryTest {
  @Test
  fun `successful native values resolve unchanged`() {
    val promise = RecordingPromise()
    val value = listOf(mapOf("name" to "MP210", "address" to "AA:01"))

    settleThermalPrinterCall(promise) { value }

    assertSame(value, promise.resolved)
    assertNull(promise.rejection)
  }

  @Test
  fun `directory and bonding errors reject with stable safe metadata and zero progress`() {
    val cases = listOf(
      bluetoothUnsupported(),
      bluetoothDisabled(),
      permissionDenied(SecurityException("private Android permission detail")),
      printerNotBonded(),
    )

    cases.forEach { domainError ->
      val promise = RecordingPromise()

      settleThermalPrinterCall(promise) { throw domainError }

      val rejection = requireNotNull(promise.rejection)
      assertNull(promise.resolved)
      assertEquals(domainError.code, rejection.code)
      val envelope = JSONObject(requireNotNull(rejection.message))
      assertEquals(setOf("message", "phase", "progress"), envelope.keys().asSequence().toSet())
      assertEquals(domainError.message, envelope.getString("message"))
      assertEquals(true, envelope.isNull("phase"))
      val progress = envelope.getJSONObject("progress")
      assertEquals(
        setOf(
          "transportBytesWritten",
          "rasterBytesWritten",
          "bandsCompleted",
          "rasterPayloadAttempted",
        ),
        progress.keys().asSequence().toSet(),
      )
      assertEquals(0L, progress.getLong("transportBytesWritten"))
      assertEquals(0L, progress.getLong("rasterBytesWritten"))
      assertEquals(0L, progress.getLong("bandsCompleted"))
      assertEquals(false, progress.getBoolean("rasterPayloadAttempted"))
      assertFalse(rejection.message.orEmpty().contains("private"))
      assertFalse(rejection.message.orEmpty().contains("SecurityException"))
    }
  }

  @Test
  fun `print error envelope preserves conservative progress without cause detail`() {
    val promise = RecordingPromise()
    val progress = NativePrintProgress(
      transportBytesWritten = 2_050,
      rasterBytesWritten = 0,
      bandsCompleted = 0,
      rasterPayloadAttempted = true,
    )
    val domainError = ThermalPrinterException(
      code = WRITE_FAILED_CODE,
      message = "Printer write failed",
      phase = "write",
      progress = progress,
      cause = IllegalStateException("private socket detail"),
    )

    settleThermalPrinterCall(promise) { throw domainError }

    val rejection = requireNotNull(promise.rejection)
    assertEquals(WRITE_FAILED_CODE, rejection.code)
    val envelope = JSONObject(requireNotNull(rejection.message))
    assertEquals("Printer write failed", envelope.getString("message"))
    assertEquals("write", envelope.getString("phase"))
    val encodedProgress = envelope.getJSONObject("progress")
    assertEquals(2_050L, encodedProgress.getLong("transportBytesWritten"))
    assertEquals(0L, encodedProgress.getLong("rasterBytesWritten"))
    assertEquals(0L, encodedProgress.getLong("bandsCompleted"))
    assertEquals(true, encodedProgress.getBoolean("rasterPayloadAttempted"))
    assertFalse(rejection.message.orEmpty().contains("private"))
    assertFalse(rejection.message.orEmpty().contains("IllegalStateException"))
  }

  private class RecordingPromise : Promise {
    var resolved: Any? = null
    var rejection: Rejection? = null

    override fun resolve(value: Any?) {
      check(rejection == null)
      resolved = value
    }

    override fun reject(code: String, message: String?, cause: Throwable?) {
      check(resolved == null)
      // PromiseImpl's JSI callback materializes only code and message. Deliberately ignore cause.
      rejection = Rejection(code, message)
    }
  }

  private data class Rejection(
    val code: String,
    val message: String?,
  )
}
