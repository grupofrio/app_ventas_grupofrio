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
  fun `every Task 7 error rejects with stable safe metadata and zero progress`() {
    val cases = listOf(
      bluetoothUnsupported(),
      bluetoothDisabled(),
      permissionDenied(SecurityException("private Android permission detail")),
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
