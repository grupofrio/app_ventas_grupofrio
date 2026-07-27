package mx.grupofrio.thermalprinter

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ThermalPrinterModuleTest {
  @Test
  fun `valid ticket is rendered and sent with the complete native result`() {
    val raster = MonochromeRaster(384, 1, ByteArray(48))
    val expected = NativePrintResult(4_100, 4_000, 2, true)
    val renderer = RecordingRenderer(raster)
    val transport = RecordingTransport(result = expected)
    val verifier = RecordingBondVerifier()
    val subject = coordinator(verifier, renderer, transport)

    val actual = subject.printTicket(ADDRESS, validRecord())

    assertSame(expected, actual)
    assertEquals(listOf(ADDRESS), verifier.addresses)
    assertEquals(1, renderer.tickets.size)
    assertEquals("F-42", renderer.tickets.single().folio)
    assertEquals(null, renderer.tickets.single().localReference)
    assertEquals(listOf(ADDRESS to raster), transport.jobs)
  }

  @Test
  fun `optional local reference is normalized before rendering`() {
    val renderer = RecordingRenderer(MonochromeRaster(384, 1, ByteArray(48)))
    val record = validRecord().apply {
      localReference = " \u200Bmobile-op-1\r\n "
    }

    coordinator(renderer = renderer).printTicket(ADDRESS, record)

    assertEquals("mobile-op-1", renderer.tickets.single().localReference)
  }

  @Test
  fun `valid exchange ticket is rendered and sent with exchange metadata preserved`() {
    val raster = MonochromeRaster(384, 1, ByteArray(48))
    val expected = NativePrintResult(2_048, 2_000, 1, true)
    val renderer = RecordingRenderer(raster)
    val transport = RecordingTransport(result = expected)
    val subject = coordinator(renderer = renderer, transport = transport)
    val document = validRecord().apply {
      branding!!.title = "NOTA DE CAMBIO"
      customerName = "Cliente intercambio"
      paymentLabel = "N/A"
      subtotal = "$0.00"
      totalKg = "0 kg"
      total = "$0.00"
      lines = mutableListOf(
        validLineRecord(1, "ENTREGA", "Hielo cristalino", "3 x 20 kg", "60 kg"),
        validLineRecord(2, "MERMA", "Hielo derretido", "1 x 10 kg", "10 kg"),
      )
      setRecordField("ticketKind", "exchange")
      setRecordField(
        "exchangeNotes",
        "Cambio autorizado por calidad con revisión de almacén.",
      )
    }

    val actual = subject.printTicket(ADDRESS, document)

    assertSame(expected, actual)
    assertEquals(listOf(ADDRESS), transport.jobs.map { it.first })
    val rendered = renderer.tickets.single()
    assertEquals("exchange", rendered.stringField("ticketKind"))
    assertEquals(
      "Cambio autorizado por calidad con revisión de almacén.",
      rendered.stringField("exchangeNotes"),
    )
    assertEquals(
      listOf("ENTREGA", "MERMA"),
      rendered.lines.map { line -> line.stringField("sectionLabel") },
    )
  }

  @Test
  fun `unbonded address fails before invalid record conversion or resource-heavy work`() {
    val verifier = RecordingBondVerifier(
      error = ThermalPrinterException(PRINTER_NOT_BONDED_CODE, "Printer is not bonded"),
    )
    val renderer = RecordingRenderer(MonochromeRaster(384, 1, ByteArray(48)))
    val transport = RecordingTransport()

    val error = assertThrows(ThermalPrinterException::class.java) {
      coordinator(verifier, renderer, transport).printTicket("gone", ThermalTicketDocumentRecord())
    }

    assertEquals(PRINTER_NOT_BONDED_CODE, error.code)
    assertEquals(NativePrintProgress(), error.progress)
    assertEquals(listOf("gone"), verifier.addresses)
    assertTrue(renderer.tickets.isEmpty())
    assertTrue(transport.jobs.isEmpty())
  }

  @Test
  fun `invalid bonded ticket is rejected before rendering or transport`() {
    val renderer = RecordingRenderer(MonochromeRaster(384, 1, ByteArray(48)))
    val transport = RecordingTransport()

    val error = assertThrows(ThermalPrinterException::class.java) {
      coordinator(renderer = renderer, transport = transport)
        .printTicket(ADDRESS, ThermalTicketDocumentRecord())
    }

    assertEquals(INVALID_TICKET_CODE, error.code)
    assertEquals(NativePrintProgress(), error.progress)
    assertTrue(renderer.tickets.isEmpty())
    assertTrue(transport.jobs.isEmpty())
  }

  @Test
  fun `renderer domain failure remains stable and never reaches transport`() {
    val expected = ThermalPrinterException(
      code = TICKET_TOO_LARGE_CODE,
      message = "Ticket is too tall",
    )
    val transport = RecordingTransport()

    val error = assertThrows(ThermalPrinterException::class.java) {
      coordinator(
        renderer = TicketRasterRenderer { throw expected },
        transport = transport,
      ).printTicket(ADDRESS, validRecord())
    }

    assertSame(expected, error)
    assertTrue(transport.jobs.isEmpty())
  }

  @Test
  fun `encoder contract failure is mapped to invalid ticket without leaking detail`() {
    val transport = RecordingTransport(error = IllegalArgumentException("sensitive raster detail"))

    val error = assertThrows(ThermalPrinterException::class.java) {
      coordinator(transport = transport).printTicket(ADDRESS, validRecord())
    }

    assertEquals(INVALID_TICKET_CODE, error.code)
    assertEquals("Ticket raster could not be encoded", error.message)
    assertFalse(error.message!!.contains("sensitive"))
    assertEquals(NativePrintProgress(), error.progress)
  }

  @Test
  fun `transport failure preserves conservative partial progress unchanged`() {
    val progress = NativePrintProgress(
      transportBytesWritten = 2,
      rasterBytesWritten = 0,
      bandsCompleted = 0,
      rasterPayloadAttempted = true,
    )
    val expected = ThermalPrinterException(
      code = WRITE_FAILED_CODE,
      message = "Printer write failed",
      phase = "write",
      progress = progress,
    )

    val error = assertThrows(ThermalPrinterException::class.java) {
      coordinator(transport = RecordingTransport(error = expected))
        .printTicket(ADDRESS, validRecord())
    }

    assertSame(expected, error)
    assertEquals(progress, error.progress)
    assertTrue(error.progress.rasterPayloadAttempted)
    assertEquals(0, error.progress.rasterBytesWritten)
  }

  @Test
  fun `diagnostic uses the same bonding renderer and transport orchestration`() {
    val sourceRaster = MonochromeRaster(384, 2, ByteArray(96))
    val renderer = RecordingRenderer(sourceRaster)
    val transport = RecordingTransport(
      result = NativePrintResult(110, 96, 1, true),
    )
    val verifier = RecordingBondVerifier()
    val branding = validRecord().branding!!

    val result = coordinator(verifier, renderer, transport).printDiagnostic(ADDRESS, branding)

    assertEquals(NativePrintResult(110, 96, 1, true), result)
    assertEquals(listOf(ADDRESS), verifier.addresses)
    val diagnostic = renderer.tickets.single()
    assertEquals("Razón Social", diagnostic.branding.legalName)
    assertTrue(diagnostic.folio.contains("384 dots"))
    val sentRaster = transport.jobs.single().second
    assertEquals(384, sentRaster.width)
    assertEquals(0xFF.toByte(), sentRaster.bytes.first())
    assertEquals(0xFF.toByte(), sentRaster.bytes[47])
  }

  @Test
  fun `unbonded diagnostic fails before branding conversion and renderer`() {
    val verifier = RecordingBondVerifier(error = printerNotBonded())
    val renderer = RecordingRenderer(MonochromeRaster(384, 2, ByteArray(96)))
    val transport = RecordingTransport()

    val error = assertThrows(ThermalPrinterException::class.java) {
      coordinator(verifier, renderer, transport)
        .printDiagnostic("gone", ThermalTicketBrandingRecord())
    }

    assertEquals(PRINTER_NOT_BONDED_CODE, error.code)
    assertEquals(NativePrintProgress(), error.progress)
    assertTrue(renderer.tickets.isEmpty())
    assertTrue(transport.jobs.isEmpty())
  }

  private fun coordinator(
    verifier: BondedPrinterVerifier = RecordingBondVerifier(),
    renderer: TicketRasterRenderer = RecordingRenderer(
      MonochromeRaster(384, 1, ByteArray(48)),
    ),
    transport: RasterPrintTransport = RecordingTransport(),
  ) = ThermalPrinterPrintCoordinator(verifier, renderer, transport)

  private fun validRecord() = ThermalTicketDocumentRecord().apply {
    schemaVersion = 1
    branding = ThermalTicketBrandingRecord().apply {
      logoPngBase64 = "AAAA"
      logoVersion = "test-v1"
      legalName = "Razón Social"
      rfcLabel = "RFC: AAA010101AAA"
      title = "Ticket"
      footer = "Gracias"
    }
    folio = "F-42"
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

  private fun validLineRecord(
    id: Int,
    sectionLabel: String? = null,
    productName: String = "Producto",
    quantityAndUnitPrice: String = "1 kg x $10.00",
    lineTotal: String = "$10.00",
  ) = ThermalTicketLineRecord().apply {
    productId = id.toDouble()
    this.productName = productName
    this.quantityAndUnitPrice = quantityAndUnitPrice
    this.lineTotal = lineTotal
    if (sectionLabel != null) setRecordField("sectionLabel", sectionLabel)
  }

  private fun Any.setRecordField(name: String, value: Any?) {
    val field = javaClass.getDeclaredField(name)
    field.isAccessible = true
    field.set(this, value)
  }

  private fun Any.stringField(name: String): String? {
    val field = javaClass.getDeclaredField(name)
    field.isAccessible = true
    return field.get(this) as String?
  }

  private class RecordingBondVerifier(
    private val error: ThermalPrinterException? = null,
  ) : BondedPrinterVerifier {
    val addresses = mutableListOf<String>()

    override fun requireBonded(address: String) {
      addresses += address
      error?.let { throw it }
    }
  }

  private class RecordingRenderer(
    private val raster: MonochromeRaster,
  ) : TicketRasterRenderer {
    val tickets = mutableListOf<ThermalTicket>()

    override fun render(ticket: ThermalTicket): MonochromeRaster {
      tickets += ticket
      return raster
    }
  }

  private class RecordingTransport(
    private val result: NativePrintResult = NativePrintResult(0, 0, 0, false),
    private val error: Throwable? = null,
  ) : RasterPrintTransport {
    val jobs = mutableListOf<Pair<String, MonochromeRaster>>()

    override fun print(address: String, raster: MonochromeRaster): NativePrintResult {
      jobs += address to raster
      error?.let { throw it }
      return result
    }
  }

  private companion object {
    const val ADDRESS = "AA:BB:CC:DD:EE:FF"
  }
}
