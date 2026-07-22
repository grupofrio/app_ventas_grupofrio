package mx.grupofrio.thermalprinter

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
class ThermalTicketRendererTest {
  private val context = ApplicationProvider.getApplicationContext<Context>()
  private val subject = ThermalTicketRenderer(context)

  @Test
  fun `raster width is 384 and stable height matches measured layout`() {
    val ticket = ticket()

    val raster = subject.render(ticket)

    assertEquals(384, raster.width)
    assertEquals(subject.measure(ticket).height, raster.height)
    assertEquals(48 * raster.height, raster.bytes.size)
  }

  @Test
  fun `white background is zero and black divider reaches both edge pixels`() {
    val raster = subject.render(ticket())
    val bits = RasterBits(raster)
    val dividerRow = (0 until raster.height).firstOrNull { y ->
      bits.isInk(0, y) && bits.isInk(383, y)
    }

    assertTrue(raster.bytes.copyOfRange(0, 48).all { it == 0.toByte() })
    assertTrue("Expected a full-width divider row", dividerRow != null)
    assertTrue(bits.isInk(0, dividerRow!!))
    assertTrue(bits.isInk(383, dividerRow))
  }

  @Test
  fun `packed pixels are strictly one bit MSB first for encoder compatibility`() {
    val raster = subject.render(ticket())
    val bits = RasterBits(raster)
    val dividerRow = (0 until raster.height).first { y -> bits.isInk(0, y) && bits.isInk(383, y) }
    val rowStart = dividerRow * 48

    assertEquals(0x80, raster.bytes[rowStart].toInt() and 0x80)
    assertEquals(0x01, raster.bytes[rowStart + 47].toInt() and 0x01)
    assertTrue(raster.bytes.copyOfRange(rowStart, rowStart + 48).all { it == 0xFF.toByte() })
  }

  @Test
  fun `base64 PNG logo is centered inside measured bounds and not clipped`() {
    val encodedLogo = pngBase64(40, 20)
    val logoTicket = ticket(logo = encodedLogo)
    val raster = subject.render(logoTicket)
    val bits = RasterBits(raster)
    val logoTop = 8
    val logoLeft = (384 - 40) / 2
    var logoInk = 0

    for (y in logoTop until logoTop + 20) {
      for (x in 0 until 384) {
        if (bits.isInk(x, y)) {
          logoInk += 1
          assertTrue(x in logoLeft until logoLeft + 40)
        }
      }
    }

    val expectedInk = 40 * 20
    val onePixelPerimeter = 2 * 40 + 2 * 20 - 4
    // The source is pure black and filtering is disabled. Normally all 800 dots survive the Bayer
    // threshold; allowing at most one edge perimeter accommodates Canvas edge conventions without
    // hiding displacement, clipping, or a missing/interior-empty logo.
    assertTrue(
      "Expected $expectedInk logo dots within one perimeter but found $logoInk",
      logoInk in (expectedInk - onePixelPerimeter)..expectedInk,
    )
    assertTrue(bits.isInk(logoLeft + 20, logoTop + 10))
    assertTrue((logoTop until logoTop + 20).all { bits.isInk(logoLeft, it) })
    assertTrue((logoTop until logoTop + 20).all { bits.isInk(logoLeft + 39, it) })
  }

  @Test
  fun `oversized source logo is downscaled to 256 pixels without edge clipping`() {
    val raster = subject.render(ticket(logo = pngBase64(400, 200), logoVersion = "large-logo"))
    val bits = RasterBits(raster)
    val logoTop = 8
    val logoWidth = 256
    val logoHeight = 128
    val logoLeft = (384 - logoWidth) / 2
    var logoInk = 0

    for (y in logoTop until logoTop + logoHeight) {
      for (x in 0 until 384) {
        if (bits.isInk(x, y)) {
          assertTrue(x in logoLeft until logoLeft + logoWidth)
          logoInk += 1
        }
      }
    }

    val expectedInk = logoWidth * logoHeight
    val onePixelPerimeter = 2 * logoWidth + 2 * logoHeight - 4
    assertTrue(
      "Expected $expectedInk scaled logo dots within one perimeter but found $logoInk",
      logoInk in (expectedInk - onePixelPerimeter)..expectedInk,
    )
    assertTrue((logoTop until logoTop + logoHeight).all { bits.isInk(logoLeft, it) })
    assertTrue((logoTop until logoTop + logoHeight).all { bits.isInk(logoLeft + logoWidth - 1, it) })
  }

  @Test
  fun `cash and credit fixtures do not clip and credit raster is taller`() {
    val cash = subject.render(ticket())
    val credit = subject.render(ticket(creditNote = "Pagaré: pagaré este total incondicionalmente."))

    assertTrue(credit.height > cash.height)
    listOf(cash, credit).forEach { raster ->
      val bits = RasterBits(raster)
      val inkRows = (0 until raster.height).filter { y -> (0 until 384).any { x -> bits.isInk(x, y) } }
      assertTrue(inkRows.isNotEmpty())
      assertTrue(inkRows.max() < raster.height - 1)
    }
  }

  @Test
  @GraphicsMode(GraphicsMode.Mode.NATIVE)
  fun `every promissory note line and final footer leave ink inside their command bands`() {
    val creditTicket = ticket(
      creditNote = longPromissoryNote(),
    )
    val layout = subject.measure(creditTicket)
    val raster = subject.render(creditTicket)
    val evidence = creditEvidence(layout)

    assertTrue(
      "Fixture must wrap the promissory note; found ${evidence.noteCommands.size} commands",
      evidence.noteCommands.size >= 3,
    )
    (evidence.noteCommands + evidence.footerCommand).forEach { command ->
      assertTextCommandHasInk(raster, layout, command)
    }
  }

  @Test
  @GraphicsMode(GraphicsMode.Mode.NATIVE)
  fun `pixel evidence rejects an omitted final promissory line or footer command`() {
    val creditTicket = ticket(
      creditNote = longPromissoryNote(),
    )
    val layout = subject.measure(creditTicket)
    val raster = subject.render(creditTicket)
    val evidence = creditEvidence(layout)
    val omittedTargets = listOf(evidence.noteCommands.last(), evidence.footerCommand)

    omittedTargets.forEach { omitted ->
      val rasterWithOmittedBand = raster.clearing(textLineBand(omitted))
      assertThrows(AssertionError::class.java) {
        assertTextCommandHasInk(rasterWithOmittedBand, layout, omitted)
      }
    }
  }

  @Test
  fun `repeated renders have identical height and bytes`() {
    val ticket = ticket(creditNote = "Pagaré estable para impresión térmica")

    val first = subject.render(ticket)
    val second = subject.render(ticket)

    assertEquals(first.height, second.height)
    assertArrayEquals(first.bytes, second.bytes)
  }

  @Test
  fun `renderer loads the exact packaged Space Mono assets`() {
    val regularBytes = context.assets.open("fonts/SpaceMono-Regular.ttf").use { it.readBytes() }
    val boldBytes = context.assets.open("fonts/SpaceMono-Bold.ttf").use { it.readBytes() }
    val fonts = PackagedFontProvider(context.assets)

    assertEquals(98_320, regularBytes.size)
    assertEquals(
      "508a2a382b46a55be24d9edb70ce7d59be695cd5808e641fda24c40864b0d5d2",
      regularBytes.sha256(),
    )
    assertEquals(97_256, boldBytes.size)
    assertEquals(
      "35da133403a96d2972f91744f4e8dd3f3d0155e6b9aedbaf14266efa58c12d2d",
      boldBytes.sha256(),
    )
    assertNotSame(fonts.typeface(bold = false), fonts.typeface(bold = true))
  }

  @Test
  fun `malformed base64 and decoded non-images are invalid tickets`() {
    listOf("%%%not-base64%%%", Base64.encodeToString("not an image".toByteArray(), Base64.NO_WRAP))
      .forEach { logo ->
        val error = assertThrows(ThermalPrinterException::class.java) {
          subject.render(ticket(logo = logo, logoVersion = logo.take(8)))
        }
        assertEquals("invalid_ticket", error.code)
      }
  }

  @Test
  fun `excessive encoded decoded dimensions and pixels fail before render bitmap allocation`() {
    val tracker = TrackingBitmapAllocator()
    val renderer = ThermalTicketRenderer(context, bitmapAllocator = tracker)
    val tooMuchDecoded = Base64.encodeToString(ByteArray(2_097_153), Base64.NO_WRAP)
    val cases = listOf(
      "A".repeat(MAX_LOGO_BASE64_CHARS + 4),
      tooMuchDecoded,
      pngBase64(2_049, 1),
      pngBase64(1_025, 1_025),
    )

    cases.forEachIndexed { index, logo ->
      val error = assertThrows(ThermalPrinterException::class.java) {
        renderer.render(ticket(logo = logo, logoVersion = "oversized-$index"))
      }
      assertEquals("invalid_ticket", error.code)
      assertTrue(tracker.created.isEmpty())
    }
  }

  @Test
  fun `ticket over 6000 fails before allocating the ARGB render bitmap`() {
    val tracker = TrackingBitmapAllocator()
    val renderer = ThermalTicketRenderer(context, bitmapAllocator = tracker)
    val huge = ticket(
      lines = List(260) { index ->
        TicketLine(
          index.toLong(),
          "Producto número $index con descripción refrigerada suficientemente larga",
          "1 x $10.00",
          "$10.00",
        )
      },
    )

    val error = assertThrows(ThermalPrinterException::class.java) { renderer.render(huge) }

    assertEquals("ticket_too_large", error.code)
    assertTrue(tracker.created.isEmpty())
  }

  @Test
  fun `temporary ARGB bitmap is recycled after normal rendering`() {
    val tracker = TrackingBitmapAllocator()
    val renderer = ThermalTicketRenderer(context, bitmapAllocator = tracker)

    renderer.render(ticket())

    assertEquals(1, tracker.created.size)
    assertTrue(tracker.created.single().isRecycled)
  }

  @Test
  fun `temporary bitmap is recycled when rendering rejects an allocator result`() {
    lateinit var allocated: Bitmap
    val renderer = ThermalTicketRenderer(
      context,
      bitmapAllocator = RenderBitmapAllocator { width, height ->
        Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565).also { allocated = it }
      },
    )

    val error = assertThrows(ThermalPrinterException::class.java) { renderer.render(ticket()) }

    assertEquals("invalid_ticket", error.code)
    assertTrue(allocated.isRecycled)
  }

  private class RasterBits(raster: MonochromeRaster) {
    private val width = raster.width
    private val height = raster.height
    private val bytes = raster.bytes

    fun isInk(x: Int, y: Int): Boolean {
      val packed = bytes[y * (width / 8) + x / 8].toInt() and 0xFF
      return packed and (0x80 ushr (x % 8)) != 0
    }

    fun hasInk(band: RowBand): Boolean = (band.top until band.bottomExclusive).any { y ->
      (0 until width).any { x -> isInk(x, y) }
    }

    fun inkRows(): List<Int> = (0 until height).filter { y ->
      (0 until width).any { x -> isInk(x, y) }
    }
  }

  private data class RowBand(val top: Int, val bottomExclusive: Int)

  private data class CreditEvidence(
    val noteCommands: List<DrawCommand.Text>,
    val footerCommand: DrawCommand.Text,
  )

  private fun creditEvidence(layout: TicketLayout): CreditEvidence {
    val footerIndex = layout.commands.indexOfLast { it is DrawCommand.Text }
    val noteDividerIndex = layout.commands.indexOfLast { it is DrawCommand.Divider }
    assertTrue("Credit divider must precede footer", noteDividerIndex in 0 until footerIndex)
    val noteCommands = layout.commands.subList(noteDividerIndex + 1, footerIndex)
      .filterIsInstance<DrawCommand.Text>()
    return CreditEvidence(
      noteCommands = noteCommands,
      footerCommand = layout.commands[footerIndex] as DrawCommand.Text,
    )
  }

  private fun textLineBand(command: DrawCommand.Text): RowBand {
    val top = (command.baseline - command.style.sizePx).toInt()
    return RowBand(top, top + command.style.lineHeightPx)
  }

  private fun assertTextCommandHasInk(
    raster: MonochromeRaster,
    layout: TicketLayout,
    command: DrawCommand.Text,
  ) {
    val band = textLineBand(command)
    // The tolerance is the complete line box allocated by the layout: textSize above the baseline
    // plus the remaining lineHeight leading below it. It is portable across Canvas font metrics and
    // cannot borrow ink from an adjacent command's non-overlapping line box.
    assertTrue("Text command starts outside its layout", band.top >= 0)
    assertTrue("Text command ends outside its layout", band.bottomExclusive <= layout.height)
    val bits = RasterBits(raster)
    if (!bits.hasInk(band)) {
      val nearbyInkRows = bits.inkRows()
        .filter { it in (band.top - 40)..(band.bottomExclusive + 40) }
      throw AssertionError(
        "Expected '${command.text}' ink in rows ${band.top}..<${band.bottomExclusive}; " +
          "nearby ink rows=$nearbyInkRows",
      )
    }
  }

  private fun MonochromeRaster.clearing(band: RowBand): MonochromeRaster {
    val copy = bytes
    val bytesPerRow = width / 8
    copy.fill(0, band.top * bytesPerRow, band.bottomExclusive * bytesPerRow)
    return MonochromeRaster(width, height, copy)
  }

  private fun ByteArray.sha256(): String = MessageDigest.getInstance("SHA-256")
    .digest(this)
    .joinToString("") { "%02x".format(it) }

  private fun longPromissoryNote(): String = List(10) {
    "Reconozco el adeudo total y pagaré incondicionalmente en la fecha acordada " +
      "sin recortar ninguna condición escrita en este pagaré de crédito."
  }.joinToString(" ")

  private fun pngBase64(width: Int, height: Int): String {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    return try {
      bitmap.eraseColor(Color.BLACK)
      ByteArrayOutputStream().use { output ->
        assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
        Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
      }
    } finally {
      bitmap.recycle()
    }
  }

  private fun ticket(
    logo: String = pngBase64(32, 16),
    logoVersion: String = "test-logo-v1",
    creditNote: String? = null,
    lines: List<TicketLine> = listOf(
      TicketLine(1, "Hielo en cubo de excelente calidad", "2 x $50.00", "$100.00"),
    ),
  ) = ThermalTicket(
    schemaVersion = 1,
    branding = TicketBranding(
      logoPngBase64 = logo,
      logoVersion = logoVersion,
      legalName = "SOLUCIONES EN PRODUCCIÓN GLACIEM",
      rfcLabel = "RFC: SPG230420F52",
      title = "Ticket de venta",
      footer = "Gracias por su compra",
    ),
    folio = "VENTA-42",
    formattedDate = "21/07/2026 10:30",
    customerName = "María Muñoz",
    sellerName = "José Hernández",
    paymentLabel = if (creditNote == null) "Efectivo" else "Crédito",
    lines = lines,
    subtotal = "$100.00",
    totalKg = "2 kg",
    total = "$100.00",
    creditNote = creditNote,
  )

  private class TrackingBitmapAllocator : RenderBitmapAllocator {
    val created = mutableListOf<Bitmap>()

    override fun create(width: Int, height: Int): Bitmap =
      Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also(created::add)
  }
}
