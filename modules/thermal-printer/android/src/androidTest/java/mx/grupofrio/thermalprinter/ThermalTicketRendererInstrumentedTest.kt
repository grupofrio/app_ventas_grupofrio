@file:Suppress("DEPRECATION")

package mx.grupofrio.thermalprinter

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import androidx.test.runner.AndroidJUnit4
import com.google.common.truth.Truth.assertThat
import java.io.ByteArrayOutputStream
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ThermalTicketRendererInstrumentedTest {
  private val context = ApplicationProvider.getApplicationContext<Context>()
  private val renderer = ThermalTicketRenderer(context)

  @Test
  fun realCanvasProducesBounded384DotMonochromeCashAndCreditTickets() {
    val cashTicket = ticket(creditNote = null)
    val creditTicket = ticket(
      creditNote = longPromissoryNote(),
    )

    val cash = renderer.render(cashTicket)
    val credit = renderer.render(creditTicket)
    val creditLayout = renderer.measure(creditTicket)

    assertThat(cash.width).isEqualTo(384)
    assertThat(credit.width).isEqualTo(384)
    assertThat(cash.height).isEqualTo(renderer.measure(cashTicket).height)
    assertThat(credit.height).isEqualTo(creditLayout.height)
    assertThat(credit.height).isGreaterThan(cash.height)
    listOf(cash, credit).forEach { raster ->
      val bits = RasterBits(raster)
      assertThat(raster.bytes.size).isEqualTo(48 * raster.height)
      assertThat((0 until raster.height).any { y -> bits.isInk(0, y) && bits.isInk(383, y) }).isTrue()
      assertThat(bits.lastInkRow()).isLessThan(raster.height - 1)
    }

    val evidence = creditEvidence(creditLayout)
    assertThat(evidence.noteCommands.size).isAtLeast(3)
    (evidence.noteCommands + evidence.footerCommand).forEach { command ->
      assertTextCommandHasInk(credit, creditLayout, command)
    }
    creditLayout.commands.filterIsInstance<DrawCommand.Text>()
      .map { it.top to it.bottomExclusive }
      .distinct()
      .sortedBy { it.first }
      .zipWithNext()
      .forEach { (previous, next) -> assertThat(previous.second).isAtMost(next.first) }
  }

  @Test
  fun realAssetsAndCanvasKeepCenteredLogoInsideItsBounds() {
    assertThat(context.assets.open("fonts/SpaceMono-Regular.ttf").use { it.available() }).isGreaterThan(0)
    assertThat(context.assets.open("fonts/SpaceMono-Bold.ttf").use { it.available() }).isGreaterThan(0)
    val raster = renderer.render(ticket(creditNote = null))
    val bits = RasterBits(raster)
    val logoLeft = (384 - LOGO_WIDTH) / 2
    var logoInk = 0
    for (y in LOGO_TOP until LOGO_TOP + LOGO_HEIGHT) {
      for (x in 0 until 384) {
        if (bits.isInk(x, y)) {
          assertThat(x).isAtLeast(logoLeft)
          assertThat(x).isLessThan(logoLeft + LOGO_WIDTH)
          logoInk += 1
        }
      }
    }

    // Canvas implementations may differ at scaled edges; a 5% invariant tolerance avoids a
    // device-dependent screenshot while still detecting clipping, displacement, or a missing logo.
    assertThat(logoInk).isAtLeast((LOGO_WIDTH * LOGO_HEIGHT * 0.95).toInt())
    assertThat(logoInk).isAtMost((LOGO_WIDTH * LOGO_HEIGHT * 1.05).toInt())
  }

  private fun ticket(creditNote: String?) = ThermalTicket(
    schemaVersion = 1,
    branding = TicketBranding(
      logoPngBase64 = pngBase64(LOGO_WIDTH, LOGO_HEIGHT),
      logoVersion = "instrumented-logo-v1",
      legalName = "SOLUCIONES EN PRODUCCIÓN GLACIEM",
      rfcLabel = "RFC: SPG230420F52",
      title = "Ticket de venta",
      footer = "Gracias por su compra",
    ),
    folio = "VENTA-ANDROID",
    formattedDate = "21/07/2026 10:30",
    customerName = "María Muñoz Refrigeración",
    sellerName = "José Ángel Hernández",
    paymentLabel = if (creditNote == null) "Efectivo" else "Crédito",
    lines = listOf(TicketLine(1, "Hielo en cubo", "2 x $50.00", "$100.00")),
    subtotal = "$100.00",
    totalKg = "2 kg",
    total = "$100.00",
    creditNote = creditNote,
  )

  private fun pngBase64(width: Int, height: Int): String {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    return try {
      bitmap.eraseColor(Color.BLACK)
      ByteArrayOutputStream().use { output ->
        check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
        Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
      }
    } finally {
      bitmap.recycle()
    }
  }

  private fun longPromissoryNote(): String = List(10) {
    "Reconozco el adeudo total y pagaré incondicionalmente en la fecha acordada " +
      "sin recortar ninguna condición escrita en este pagaré de crédito."
  }.joinToString(" ")

  private class RasterBits(raster: MonochromeRaster) {
    private val width = raster.width
    private val height = raster.height
    private val bytes = raster.bytes

    fun isInk(x: Int, y: Int): Boolean {
      val packed = bytes[y * (width / 8) + x / 8].toInt() and 0xFF
      return packed and (0x80 ushr (x % 8)) != 0
    }

    fun lastInkRow(): Int = (height - 1 downTo 0).first { y ->
      (0 until width).any { x -> isInk(x, y) }
    }

    fun hasInk(band: RowBand): Boolean = (band.top until band.bottomExclusive).any { y ->
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
    assertThat(noteDividerIndex).isAtLeast(0)
    assertThat(noteDividerIndex).isLessThan(footerIndex)
    return CreditEvidence(
      noteCommands = layout.commands.subList(noteDividerIndex + 1, footerIndex)
        .filterIsInstance<DrawCommand.Text>(),
      footerCommand = layout.commands[footerIndex] as DrawCommand.Text,
    )
  }

  private fun assertTextCommandHasInk(
    raster: MonochromeRaster,
    layout: TicketLayout,
    command: DrawCommand.Text,
  ) {
    val band = RowBand(command.top.toInt(), command.bottomExclusive.toInt())
    // The renderer and instrumented assertion share the font-metric-derived command box; adjacent
    // boxes are required to be disjoint, so a missing line cannot borrow another row's ink.
    assertThat(band.top).isAtLeast(0)
    assertThat(band.bottomExclusive).isAtMost(layout.height)
    assertThat(RasterBits(raster).hasInk(band)).isTrue()
  }

  private companion object {
    const val LOGO_TOP = 8
    const val LOGO_WIDTH = 40
    const val LOGO_HEIGHT = 20
  }
}
