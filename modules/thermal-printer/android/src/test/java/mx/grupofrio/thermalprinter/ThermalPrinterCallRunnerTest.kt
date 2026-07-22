package mx.grupofrio.thermalprinter

import expo.modules.kotlin.Promise
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ThermalPrinterCallRunnerTest {
  @Test
  fun `lifecycle cancellation interrupts work without settling destroyed Promise`() {
    val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    val entered = CountDownLatch(1)
    val exited = CountDownLatch(1)
    val promise = RecordingPromise()
    ThermalPrinterCallRunner(scope).launch(promise) {
      entered.countDown()
      try {
        CountDownLatch(1).await()
      } catch (_: InterruptedException) {
        throw ThermalPrinterException(WRITE_FAILED_CODE, "Printer write failed", phase = "write")
      } finally {
        exited.countDown()
      }
    }

    assertTrue("Print work never started", entered.await(2, TimeUnit.SECONDS))
    scope.cancel()

    assertTrue("Cancelled print work was not interrupted", exited.await(2, TimeUnit.SECONDS))
    assertFalse(promise.awaitSettlement(200, TimeUnit.MILLISECONDS))
    assertEquals(0, promise.settlementCount.get())
  }

  @Test
  fun `unexpected throwable rejects once with stable safe error`() {
    val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    val promise = RecordingPromise()
    try {
      ThermalPrinterCallRunner(scope).launch(promise) {
        throw IllegalStateException("private socket detail")
      }

      assertTrue("Unexpected failure left the Promise pending", promise.awaitSettlement())
      assertEquals("unexpected_error", promise.rejectionCode)
      assertFalse(promise.rejectionMessage.orEmpty().contains("private socket detail"))
      assertEquals(1, promise.settlementCount.get())
    } finally {
      scope.cancel()
    }
  }

  @Test
  fun `second print reaches shared gate concurrently and settles busy before first finishes`() {
    val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    val firstEnteredGate = CountDownLatch(1)
    val releaseFirst = CountDownLatch(1)
    val transport = GateBlockingTransport(firstEnteredGate, releaseFirst)
    val coordinator = ThermalPrinterPrintCoordinator(
      bondedPrinterVerifier = BondedPrinterVerifier { },
      renderer = TicketRasterRenderer { MonochromeRaster(384, 1, ByteArray(48)) },
      transport = transport,
    )
    val runner = ThermalPrinterCallRunner(scope)
    val first = RecordingPromise()
    val second = RecordingPromise()
    try {
      runner.launch(first) { coordinator.printTicket(ADDRESS, validRecord()) }
      assertTrue("First print never acquired the shared gate", firstEnteredGate.await(2, TimeUnit.SECONDS))

      runner.launch(second) { coordinator.printTicket(ADDRESS, validRecord()) }

      assertTrue("Second print did not settle while first remained blocked", second.awaitSettlement())
      assertEquals(BUSY_CODE, second.rejectionCode)
      assertEquals(1, second.settlementCount.get())
      assertFalse("First print must still be blocked", first.isSettled())
      assertEquals(2, transport.gateAttempts.get())

      releaseFirst.countDown()
      assertTrue("First print did not settle after release", first.awaitSettlement())
      assertNull(first.rejectionCode)
      assertEquals(1, first.settlementCount.get())
      assertEquals(1, second.settlementCount.get())
    } finally {
      releaseFirst.countDown()
      first.awaitSettlement()
      scope.cancel()
    }
  }

  private class GateBlockingTransport(
    private val firstEnteredGate: CountDownLatch,
    private val releaseFirst: CountDownLatch,
  ) : RasterPrintTransport {
    val gateAttempts = AtomicInteger()

    override fun print(address: String, raster: MonochromeRaster): NativePrintResult {
      gateAttempts.incrementAndGet()
      if (!ProcessPrintGate.tryAcquire()) {
        throw ThermalPrinterException(BUSY_CODE, "Printer is busy", phase = "gate")
      }
      try {
        firstEnteredGate.countDown()
        check(releaseFirst.await(2, TimeUnit.SECONDS)) { "Timed out waiting to release first print" }
        return NativePrintResult(0, 0, 0, false)
      } finally {
        ProcessPrintGate.release()
      }
    }
  }

  private class RecordingPromise : Promise {
    private val settled = CountDownLatch(1)
    val settlementCount = AtomicInteger()
    @Volatile var rejectionCode: String? = null
    @Volatile var rejectionMessage: String? = null

    override fun resolve(value: Any?) {
      settlementCount.incrementAndGet()
      settled.countDown()
    }

    override fun reject(code: String, message: String?, cause: Throwable?) {
      rejectionCode = code
      rejectionMessage = message
      settlementCount.incrementAndGet()
      settled.countDown()
    }

    fun awaitSettlement(
      timeout: Long = 2,
      unit: TimeUnit = TimeUnit.SECONDS,
    ): Boolean = settled.await(timeout, unit)

    fun isSettled(): Boolean = settled.count == 0L
  }

  private fun validRecord() = ThermalTicketDocumentRecord().apply {
    schemaVersion = 1
    branding = ThermalTicketBrandingRecord().apply {
      logoPngBase64 = "AAAA"
      logoVersion = "runner-v1"
      legalName = "Razón Social"
      rfcLabel = "RFC: AAA010101AAA"
      title = "Ticket"
      footer = "Gracias"
    }
    folio = "RUNNER-1"
    formattedDate = "22/07/2026"
    customerName = "Cliente"
    sellerName = "Vendedor"
    paymentLabel = "Contado"
    lines = mutableListOf(ThermalTicketLineRecord().apply {
      productId = 1.0
      productName = "Producto"
      quantityAndUnitPrice = "1 kg x $10.00"
      lineTotal = "$10.00"
    })
    subtotal = "$10.00"
    totalKg = "1 kg"
    total = "$10.00"
  }

  private companion object {
    const val ADDRESS = "AA:BB:CC:DD:EE:FF"
  }
}
